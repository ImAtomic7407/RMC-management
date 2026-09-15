import { ExamStatus, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import type { AuthenticatedUser } from "../../shared/auth";
import { recalculateAttemptResult } from "../results/service";
import { regenerateExamLeaderboard, regenerateBatchLeaderboard } from "../leaderboard/service";

export class ExamWorkflowError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ExamWorkflowError";
    this.code = code;
    this.status = status;
  }
}

class AsyncQueueLock {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const examWorkflowLocks = new Map<number, AsyncQueueLock>();

function withExamWorkflowLock<T>(examId: number, task: () => Promise<T>) {
  let lock = examWorkflowLocks.get(examId);
  if (!lock) {
    lock = new AsyncQueueLock();
    examWorkflowLocks.set(examId, lock);
  }
  return lock.runExclusive(task).finally(() => {
    // Clean up the lock entry once no more tasks are queued, preventing
    // unbounded growth of the map across many exams in a long-running server.
    examWorkflowLocks.delete(examId);
  });
}

type CreateExamInput = {
  title: string;
  batch_id: number;
  exam_mode: "LIVE" | "PRACTICE";
  duration_seconds: number;
  exam_date_time?: string | null;
  instructions?: string | null;
  solution_release_policy: "AFTER_EXAM_END" | "AFTER_RESULT_RELEASE" | "NEVER" | "PRACTICE_UNLOCK_RULE";
  sections: Array<{
    section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
    question_count_target: number;
    default_marks: number;
    default_negative_marks: number;
  }>;
};

function normalizeSections(sections: CreateExamInput["sections"]) {
  const expected = new Set<CreateExamInput["sections"][number]["section_code"]>(["PHYSICS", "CHEMISTRY", "MATHS"]);
  const incoming = new Set(sections.map((section) => section.section_code));

  if (sections.length !== 3 || expected.size !== incoming.size || [...expected].some((code) => !incoming.has(code))) {
    throw new Error("Exactly three sections are required: PHYSICS, CHEMISTRY, MATHS.");
  }

  const order: Array<CreateExamInput["sections"][number]["section_code"]> = ["PHYSICS", "CHEMISTRY", "MATHS"];
  return order.map((section_code, index) => {
    const found = sections.find((section) => section.section_code === section_code);
    if (!found) {
      throw new Error(`Missing required section: ${section_code}`);
    }
    return {
      ...found,
      section_order: index + 1,
    };
  });
}

export async function createExam(input: CreateExamInput, actor: AuthenticatedUser) {
  const sections = normalizeSections(input.sections);

  return prisma.$transaction(async (tx) => {
    const exam = await tx.exams.create({
      data: {
        title: input.title,
        batch_id: input.batch_id,
        status: "DRAFT",
        exam_mode: input.exam_mode,
        duration_seconds: input.duration_seconds,
        instructions: input.instructions ?? null,
        solution_release_policy: input.solution_release_policy,
        exam_date_time: input.exam_date_time ? new Date(input.exam_date_time) : null,
        created_by: actor.id,
      },
    });

    await tx.exam_sections.createMany({
      data: sections.map((section) => ({
        exam_id: exam.id,
        section_code: section.section_code,
        section_order: section.section_order,
        question_count_target: section.question_count_target,
        default_marks: section.default_marks,
        default_negative_marks: section.default_negative_marks,
      })),
    });

    return tx.exams.findUniqueOrThrow({
      where: { id: exam.id },
      include: {
        batch: true,
        exam_sections: true,
      },
    });
  });
}

const scopeToStatus: Record<"draft" | "scheduled" | "published" | "closed" | "released", ExamStatus> = {
  draft: ExamStatus.DRAFT,
  scheduled: ExamStatus.SCHEDULED,
  published: ExamStatus.PUBLISHED,
  closed: ExamStatus.CLOSED,
  released: ExamStatus.RESULT_RELEASED,
};

export async function listExams(scope: "all" | "draft" | "scheduled" | "published" | "closed" | "released" | undefined, actor: AuthenticatedUser) {
  const where = scope && scope !== "all"
    ? {
        status: scopeToStatus[scope],
      }
    : {};


  return prisma.exams.findMany({
    where,
    orderBy: { created_at: "desc" },
    include: {
      batch: true,
      exam_sections: {
        orderBy: { section_order: "asc" },
      },
    },
  });
}

export async function getExamById(examId: number, actor: AuthenticatedUser) {
  return prisma.exams.findFirst({
    where:
      { id: examId },
    include: {
      batch: true,
      created_user: {
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          full_name: true,
        },
      },
      updated_user: {
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          full_name: true,
        },
      },
      exam_sections: {
        orderBy: { section_order: "asc" },
      },
      question_paper: true,
      question_paper_version: {
        include: {
          sections: {
            orderBy: { section_order: "asc" },
          },
          questions: {
            orderBy: [
              { section_code: "asc" },
              { question_order: "asc" },
            ],
            select: {
              id: true,
              section_code: true,
              question_type: true,
              question_order: true,
            },
          },
        },
      },
    },
  });
}

async function transitionExamStatus(examId: number, nextStatus: "PUBLISHED" | "CLOSED" | "RESULT_RELEASED", actor: AuthenticatedUser) {
  const current = await prisma.exams.findFirst({
    where:
      { id: examId },
    include: {
      exam_sections: true,
    },
  });

  if (!current) {
    return null;
  }

  const now = new Date();
  const update: Record<string, unknown> = {
    status: nextStatus,
    updated_by: actor.id,
  };

  if (nextStatus === "PUBLISHED") {
    update.published_at = now;
  }
  if (nextStatus === "CLOSED") {
    update.closed_at = now;
  }
  if (nextStatus === "RESULT_RELEASED") {
    update.result_released_at = now;
  }

  return prisma.exams.update({
    where: { id: examId },
    data: update,
    include: {
      batch: true,
      exam_sections: {
        orderBy: { section_order: "asc" },
      },
    },
  });
}

function workflowError(code: string, status: number, message: string): never {
  throw new ExamWorkflowError(code, status, message);
}

async function loadExamForWorkflow(examId: number, actor: AuthenticatedUser) {
  const exam = await prisma.exams.findFirst({
    where:
      { id: examId },
    include: {
      batch: true,
      question_paper_version: {
        select: {
          id: true,
          version_number: true,
        },
      },
    },
  });

  if (!exam) {
    return null;
  }

  return exam;
}

async function ensureAttemptResultsForRelease(examId: number) {
  const attempts = await prisma.exam_attempts.findMany({
    where: {
      exam_id: examId,
      status: {
        in: ["SUBMITTED", "AUTO_SUBMITTED"],
      },
    },
    select: {
      id: true,
      status: true,
      attempt_result: {
        select: {
          id: true,
        },
      },
    },
  });

  const missing = attempts.filter((attempt) => !attempt.attempt_result);
  for (const attempt of missing) {
    await recalculateAttemptResult(prisma, attempt.id);
  }

  return {
    total_terminal_attempts: attempts.length,
    missing_results_repaired: missing.length,
  };
}

export async function finalizeExam(examId: number, actor: AuthenticatedUser) {
  return withExamWorkflowLock(examId, async () => {
    const exam = await loadExamForWorkflow(examId, actor);
    if (!exam) {
      return null;
    }

    if (exam.status === "RESULT_RELEASED") {
      workflowError("EXAM_RESULT_RELEASED", 409, "The exam result has already been released.");
    }

    const previousStatus = exam.status;
    const now = new Date();
    const closeTimestamp = exam.closed_at ?? now;
    const attempts = await prisma.exam_attempts.findMany({
      where: {
        exam_id: exam.id,
      },
      include: {
        attempt_result: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    if (exam.status !== "CLOSED") {
      await prisma.exams.update({
        where: { id: exam.id },
        data: {
          status: "CLOSED",
          closed_at: closeTimestamp,
          updated_by: actor.id,
        },
      });
    }

    const summary = {
      exam_id: exam.id,
      previous_status: previousStatus,
      new_status: "CLOSED" as const,
      total_attempts: attempts.length,
      already_submitted: 0,
      auto_submitted: 0,
      force_submitted: 0,
      expired_finalized: 0,
      results_created: 0,
      results_existing: 0,
      errors: [] as Array<{
        attempt_id: number;
        student_id: number;
        code: string;
        message: string;
      }>,
    };

    for (const attempt of attempts) {
      try {
        if (attempt.status === "CANCELLED") {
          continue;
        }

        let terminalStatus = attempt.status;
        if (attempt.status === "IN_PROGRESS" || attempt.status === "EXPIRED") {
          terminalStatus = "AUTO_SUBMITTED";
          if (attempt.status === "IN_PROGRESS") {
            summary.auto_submitted += 1;
          } else {
            summary.expired_finalized += 1;
          }

          await prisma.exam_attempts.update({
            where: { id: attempt.id },
            data: {
              status: terminalStatus,
              submitted_at: attempt.attempt_result ? attempt.submitted_at ?? now : now,
              is_auto_submitted: true,
              updated_at: now,
            },
          });
        } else if (attempt.status === "SUBMITTED" || attempt.status === "AUTO_SUBMITTED") {
          summary.already_submitted += 1;
        }

        if (attempt.attempt_result) {
          summary.results_existing += 1;
        } else {
          summary.results_created += 1;
        }

        await recalculateAttemptResult(prisma, attempt.id);
      } catch (error) {
        summary.errors.push({
          attempt_id: attempt.id,
          student_id: (attempt as { student_id: number }).student_id,
          code: error instanceof ExamWorkflowError ? error.code : "FINALIZE_ATTEMPT_FAILED",
          message: error instanceof Error ? error.message : "Unable to finalize attempt.",
        });
      }
    }

    const finalized = await prisma.exams.findUniqueOrThrow({
      where: { id: exam.id },
      include: {
        batch: true,
        question_paper_version: {
          select: {
            id: true,
            version_number: true,
          },
        },
        exam_sections: {
          orderBy: {
            section_order: "asc",
          },
        },
      },
    });

    return {
      exam: finalized,
      summary,
    };
  });
}

export async function publishExam(examId: number, actor: AuthenticatedUser) {
  const exam = await prisma.exams.findFirst({
    where:
      { id: examId },
    include: {
      exam_sections: true,
      questions: true,
      question_paper_version: {
        select: {
          id: true,
          version_number: true,
        },
      },
    },
  });

  if (!exam) {
    return null;
  }

  if (exam.exam_sections.length !== 3) {
    throw new Error("Exactly three sections are required before publishing.");
  }

  const requiredSections = new Set(["PHYSICS", "CHEMISTRY", "MATHS"]);
  for (const section of exam.exam_sections) {
    requiredSections.delete(section.section_code);
  }
  if (requiredSections.size > 0) {
    throw new Error("All three sections must be configured before publishing.");
  }

  if (!exam.question_paper_version_id) {
    throw new Error("A frozen question paper version must be attached before publishing. Schedule or freeze a paper first.");
  }

  return transitionExamStatus(examId, "PUBLISHED", actor);
}

export async function closeExam(examId: number, actor: AuthenticatedUser) {
  return withExamWorkflowLock(examId, async () => transitionExamStatus(examId, "CLOSED", actor));
}

export async function releaseExamResult(examId: number, actor: AuthenticatedUser) {
  return withExamWorkflowLock(examId, async () => {
    const exam = await loadExamForWorkflow(examId, actor);
    if (!exam) {
      return null;
    }

    if (exam.status !== "CLOSED") {
      workflowError("EXAM_NOT_FINALIZED", 409, "The exam must be finalized before releasing results.");
    }

    const pendingAttempts = await prisma.exam_attempts.findMany({
      where: {
        exam_id: exam.id,
        status: {
          notIn: ["SUBMITTED", "AUTO_SUBMITTED", "CANCELLED"],
        },
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (pendingAttempts.length > 0) {
      workflowError("EXAM_NOT_FINALIZED", 409, "All attempts must be finalized before releasing results.");
    }

    await ensureAttemptResultsForRelease(exam.id);

    const released = await transitionExamStatus(examId, "RESULT_RELEASED", actor);

    // Auto-generate leaderboard so ranks are populated immediately on result release.
    // Non-fatal: if this fails the result is still released; admin can regenerate manually.
    try {
      await regenerateExamLeaderboard(prisma, examId, actor);
      if (exam.batch_id) {
        await regenerateBatchLeaderboard(prisma, examId, exam.batch_id, actor);
      }
    } catch {
      // intentionally swallowed — leaderboard regeneration is best-effort here
    }

    return released;
  });
}

export async function deleteExam(examId: number, actor: AuthenticatedUser) {
  const exam = await prisma.exams.findFirst({ where: { id: examId }, select: { id: true, status: true, title: true } });
  if (!exam) workflowError("EXAM_NOT_FOUND", 404, "Exam not found.");
  if (exam.status === "LIVE") workflowError("EXAM_IS_LIVE", 409, "Cannot delete a LIVE exam. Close it first.");
  if (actor.role !== "TEACHER" && actor.role !== "ADMIN") workflowError("FORBIDDEN", 403, "Only teachers or admins can delete exams.");
  await prisma.exams.delete({ where: { id: examId } });
  return { deleted: true, examId, title: exam.title };
}
