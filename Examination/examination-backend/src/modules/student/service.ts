import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import type { AuthenticatedUser } from "../../shared/auth";
import { broadcastExamRealtime } from "../../shared/realtime";
import { recalculateAttemptResult } from "../results/service";
import { ensureStudentGateAccess, linkGateAttempt, mapGateStatus, ExamGateError } from "../exam-gate/service";
import { loadAssignedStudentPaperPayload, unlockStudentAssignedPaperReview } from "../exam-gate/service";
import { selectNonAttendeePracticeQuestions } from "../exam-gate/assigned-paper";
import { log } from "../../shared/logger";

type StudentDb = typeof prisma;

type SafeExamMedia = {
  id: number;
  purpose: "QUESTION";
  mime_type: string;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: Date;
  access_url: string;
};

type RawQuestionMedia = Prisma.question_mediaGetPayload<{}>;

type SafeOption = {
  id: number;
  option_label: string;
  option_text: string;
  option_order: number;
};

type StudentQuestionRow = Prisma.questionsGetPayload<{
  include: {
    question_media: true;
    question_options: true;
  };
}>;

type SafeQuestion = {
  id: number;
  section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
  question_type: "MCQ" | "INTEGER";
  question_order: number;
  question_text: string | null;
  marks: Prisma.Decimal;
  negative_marks: Prisma.Decimal;
  difficulty: string | null;
  topic: string | null;
  chapter: string | null;
  source_type: "TEXT" | "IMAGE" | "MIXED";
  is_active: boolean;
  question_media: SafeExamMedia[];
  question_options: SafeOption[];
};

type SafeExam = {
  id: number;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "LIVE" | "PUBLISHED" | "CLOSED" | "RESULT_RELEASED" | "ARCHIVED";
  exam_mode: "LIVE" | "PRACTICE";
  duration_seconds: number;
  exam_date_time: Date | null;
  instructions: string | null;
  batch: {
    id: number;
    name: string;
  };
  question_paper_version_id?: number | null;
  question_paper_version?: {
    id: number;
    version_number: number;
    title_snapshot: string;
    sections: Array<{
      id: number;
    }>;
    questions: Array<{
      id: number;
    }>;
  } | null;
};

type SafeAttempt = {
  id: number;
  status: "IN_PROGRESS" | "SUBMITTED" | "AUTO_SUBMITTED" | "EXPIRED" | "CANCELLED";
  started_at: Date;
  ends_at: Date;
  submitted_at: Date | null;
  is_auto_submitted: boolean;
  device_id?: string | null;
  assigned_paper_instance_id?: number | null;
  updated_at?: Date;
};

type SafeSolutionMedia = {
  id: number;
  question_id: number;
  purpose: "SOLUTION";
  mime_type: string;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: Date;
};

type VersionQuestionOptionRow = {
  id: number;
  option_label: string;
  option_text: string | null;
  option_order: number;
  is_correct: boolean;
  original_option_id: number | null;
};

type VersionQuestionMediaRow = {
  id: number;
  purpose: "QUESTION" | "SOLUTION";
  storage_url: string;
  mime_type: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: Date;
};

type VersionQuestionRow = {
  id: number;
  original_question_id: number | null;
  section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
  question_type: "MCQ" | "INTEGER";
  question_order: number;
  question_text: string | null;
  correct_integer_answer: string | null;
  question_time_limit_seconds: number | null;
  marks: Prisma.Decimal;
  negative_marks: Prisma.Decimal;
  is_active_snapshot: boolean;
  options: VersionQuestionOptionRow[];
  media: VersionQuestionMediaRow[];
};

type VersionExamRow = {
  id: number;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "LIVE" | "PUBLISHED" | "CLOSED" | "RESULT_RELEASED" | "ARCHIVED";
  exam_mode: "LIVE" | "PRACTICE";
  duration_seconds: number;
  exam_date_time: Date | null;
  instructions: string | null;
  batch: {
    id: number;
    name: string;
  };
  exam_sections: Array<{
    id: number;
    exam_id: number;
    section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
    section_order: number;
    question_count_target: number;
    default_marks: Prisma.Decimal;
    default_negative_marks: Prisma.Decimal;
  }>;
  question_paper_version: {
    id: number;
    version_number: number;
    title_snapshot: string;
    instructions_snapshot: string | null;
    sections: Array<{
      id: number;
      version_id: number;
      section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
      section_order: number;
      question_count_target: number;
      default_marks: Prisma.Decimal;
      default_negative_marks: Prisma.Decimal;
    }>;
    questions: VersionQuestionRow[];
  } | null;
};

type PracticeQuestionRow = Prisma.questionsGetPayload<{
  include: {
    exam: {
      include: {
        batch: true;
        exam_sections: true;
      };
    };
    question_options: true;
    question_media: {
      where: {
        purpose: "SOLUTION";
      };
      orderBy: {
        sort_order: "asc";
      };
    };
  };
}>;

type StudentPracticeAttemptRow = Prisma.practice_question_attemptsGetPayload<{}>;

const ACCESSIBLE_EXAM_STATUSES = ["PUBLISHED", "CLOSED", "RESULT_RELEASED"] as const;
const STUDENT_VISIBLE_EXAM_STATUSES = ["SCHEDULED", "LIVE", "PUBLISHED", "CLOSED", "RESULT_RELEASED"] as const;

function examAssignmentWhere(student: { batch_id: number; student_uid: string; batch_memberships?: Array<{ batch_id: number }> }) {
  const batchIds = Array.from(new Set([student.batch_id, ...(student.batch_memberships ?? []).map((membership) => membership.batch_id)]));
  return {
    OR: [
      // Exams assigned via the exam_assignments table (question-paper scheduling flow)
      {
        exam_assignments: {
          some: {
            batch_id: {
              in: batchIds,
            },
          },
        },
      },
      // Exams assigned directly to the student by UID
      {
        exam_assignments: {
          some: {
            student_uid: student.student_uid,
          },
        },
      },
      // Exams created via the direct "Create Exam" flow — they have batch_id on the
      // exam itself but no exam_assignments rows.
      {
        batch_id: {
          in: batchIds,
        },
      },
    ],
  };
}

async function loadStudentProfile(db: StudentDb, userId: number) {
  const student = await db.student_profiles.findFirst({
    where: {
      user_id: userId,
      active: true,
    },
    select: {
      id: true,
      student_uid: true,
      batch_id: true,
      class_name: true,
      roll_no: true,
      active: true,
      batch_memberships: {
        select: {
          batch_id: true,
          batch: {
            select: {
              id: true,
              name: true,
              active: true,
            },
          },
        },
      },
      batch: {
        select: {
          id: true,
          name: true,
          active: true,
        },
      },
    },
  });

  if (!student || !student.batch.active) {
    throw new Error("Student profile not found.");
  }

  return student;
}

async function loadAccessibleExam(db: StudentDb, examId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      status: {
        in: [...ACCESSIBLE_EXAM_STATUSES],
      },
      ...examAssignmentWhere(student),
    },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
        },
      },
      exam_sections: {
        orderBy: {
          section_order: "asc",
        },
      },
    },
  });

  if (!exam) {
    throw new Error("Exam not found.");
  }

  return exam;
}

async function loadExamWithQuestions(db: StudentDb, examId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      status: {
        in: [...ACCESSIBLE_EXAM_STATUSES],
      },
      ...examAssignmentWhere(student),
    },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
        },
      },
      exam_sections: {
        orderBy: {
          section_order: "asc",
        },
      },
      questions: {
        where: {
          is_active: true,
        },
        orderBy: [
          {
            section_code: "asc",
          },
          {
            question_order: "asc",
          },
        ],
        include: {
          question_options: {
            orderBy: {
              option_order: "asc",
            },
          },
          question_media: {
            where: {
              purpose: "QUESTION",
            },
            orderBy: {
              sort_order: "asc",
            },
          },
        },
      },
    },
  });

  if (!exam) {
    throw new Error("Exam not found.");
  }

  return exam;
}

async function loadVersionedExamWithQuestions(db: StudentDb, examId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      ...examAssignmentWhere(student),
      question_paper_version_id: {
        not: null,
      },
    },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
        },
      },
      exam_sections: {
        orderBy: {
          section_order: "asc",
        },
      },
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
            where: {
              is_active_snapshot: true,
            },
            orderBy: [
              {
                section_code: "asc",
              },
              {
                question_order: "asc",
              },
            ],
            include: {
              options: {
                orderBy: {
                  option_order: "asc",
                },
              },
              media: {
                orderBy: [
                  { purpose: "asc" },
                  { sort_order: "asc" },
                  { created_at: "asc" },
                ],
              },
            },
          },
        },
      },
    },
  });

  if (!exam || !exam.question_paper_version) {
    throw new Error("Exam not found.");
  }

  return exam as VersionExamRow;
}

function mapVersionedExamPaper(exam: VersionExamRow) {
  const version = exam.question_paper_version;
  if (!version) {
    throw new Error("Exam not found.");
  }

  return {
    exam: {
      id: exam.id,
      title: exam.title,
      exam_mode: exam.exam_mode,
      status: exam.status,
      duration_seconds: exam.duration_seconds,
      exam_date_time: exam.exam_date_time,
      instructions: exam.instructions,
      batch: exam.batch,
      question_paper_version_id: version.id,
      question_paper_version: {
        id: version.id,
        version_number: version.version_number,
        title_snapshot: version.title_snapshot,
        instructions_snapshot: version.instructions_snapshot,
        sections: version.sections,
      },
      exam_sections: version.sections,
    },
    questions: version.questions.map((question) => mapVersionQuestion(question, exam.id, exam.status === "LIVE")),
  };
}

async function loadCurrentAttempt(db: StudentDb, examId: number, studentId: number) {
  const attempt = await db.exam_attempts.findFirst({
    where: {
      exam_id: examId,
      student_id: studentId,
    },
    orderBy: {
      created_at: "desc",
    },
  });

  return attempt;
}

function getRemainingSeconds(endsAt: Date, now = new Date()) {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 1000));
}

function examLifecycleError(status: "DRAFT" | "SCHEDULED" | "LIVE" | "PUBLISHED" | "CLOSED" | "RESULT_RELEASED" | "ARCHIVED") {
  if (status === "CLOSED") {
    return new ExamGateError("EXAM_CLOSED", 409, "The exam has been closed.");
  }
  if (status === "RESULT_RELEASED") {
    return new ExamGateError("EXAM_RESULT_RELEASED", 409, "The result has already been released.");
  }
  return new ExamGateError("EXAM_NOT_LIVE", 403, "The exam is not live yet.");
}

function attemptTerminalError(status: SafeAttempt["status"]) {
  if (status === "SUBMITTED" || status === "AUTO_SUBMITTED") {
    return new ExamGateError("ATTEMPT_ALREADY_SUBMITTED", 409, "This attempt has already been submitted.");
  }
  if (status === "EXPIRED") {
    return new ExamGateError("ATTEMPT_EXPIRED", 409, "This attempt has expired.");
  }
  return new ExamGateError("ATTEMPT_NOT_RESUMABLE", 409, "This attempt cannot be resumed.");
}

function normalizeAttemptStatus(attempt: SafeAttempt | null, now = new Date()) {
  if (!attempt) {
    return {
      status: "NOT_STARTED" as const,
    };
  }

  if (attempt.status === "IN_PROGRESS" && attempt.ends_at <= now) {
    return {
      status: "EXPIRED" as const,
      attempt: {
        ...attempt,
        status: "EXPIRED" as const,
      },
    };
  }

  return {
    status: attempt.status,
    attempt,
  };
}

function safeMediaAccessUrl(examId: number, questionId: number, mediaId: number) {
  return `/api/student/exams/${examId}/questions/${questionId}/media/${mediaId}`;
}

function canonicalizeIntegerAnswer(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid integer answer.");
  }

  const negative = trimmed.startsWith("-");
  const body = trimmed.replace(/^[+-]/, "");
  const [intPart, decPart] = body.split(".");
  const normalizedInt = intPart.replace(/^0+/, "") || "0";
  const normalizedDec = decPart ? decPart.replace(/0+$/, "") : "";
  const normalized = normalizedDec.length > 0 ? `${normalizedInt}.${normalizedDec}` : normalizedInt;

  if (negative && normalized !== "0") {
    return `-${normalized}`;
  }
  return normalized;
}

/**
 * Returns true if submitted is within the accepted tolerance of the correct answer.
 * Tolerance = ±1.5. For non-negative correct answers the lower bound is floored at 0
 * (a student cannot answer a negative value when the expected answer is ≥ 0).
 */
function isIntegerAnswerCorrect(submitted: string, correct: string): boolean {
  const sub = parseFloat(submitted);
  const exp = parseFloat(correct);
  if (!Number.isFinite(sub) || !Number.isFinite(exp)) {
    return false;
  }
  const TOLERANCE = 1.5;
  const lower = exp >= 0 ? Math.max(0, exp - TOLERANCE) : exp - TOLERANCE;
  const upper = exp + TOLERANCE;
  return sub >= lower && sub <= upper;
}

function practiceAnswerDisplayValue(input: { selected_option_id?: number; integer_answer?: string }) {
  if (input.selected_option_id !== undefined) {
    return `option:${input.selected_option_id}`;
  }

  return canonicalizeIntegerAnswer(input.integer_answer);
}

function mapQuestion(question: StudentQuestionRow, examId: number, hideAnswers = false) {
  return {
    id: question.id,
    section_code: question.section_code,
    question_type: question.question_type,
    question_order: question.question_order,
    question_text: question.question_text,
    marks: question.marks,
    negative_marks: question.negative_marks,
    difficulty: question.difficulty,
    topic: question.topic,
    chapter: question.chapter,
    source_type: question.source_type,
    question_media: (question.question_media as RawQuestionMedia[]).filter((media) => media.purpose === "QUESTION").map((media) => ({
      id: media.id,
      purpose: "QUESTION" as const,
      mime_type: media.mime_type,
      width: media.width,
      height: media.height,
      sort_order: media.sort_order,
      created_at: media.created_at,
      access_url: safeMediaAccessUrl(examId, question.id, media.id),
    })),
    correct_integer_answer: hideAnswers ? undefined : (question.correct_integer_answer ?? null),
    question_time_limit_seconds: question.question_time_limit_seconds ?? null,
    question_options: question.question_options.map((option) => ({
      id: option.id,
      option_label: option.option_label,
      option_text: option.option_text,
      option_order: option.option_order,
      ...(hideAnswers ? {} : { is_correct: option.is_correct }),
    })),
  };
}

function mapVersionQuestion(question: VersionQuestionRow, examId: number, hideAnswers = false) {
  return {
    id: question.id,
    section_code: question.section_code,
    question_type: question.question_type,
    question_order: question.question_order,
    question_text: question.question_text,
    marks: question.marks,
    negative_marks: question.negative_marks,
    source_type: question.media.some((media) => media.purpose === "QUESTION") && question.question_text ? "MIXED" : question.media.some((media) => media.purpose === "QUESTION") ? "IMAGE" : "TEXT",
    question_media: question.media
      .filter((media) => media.purpose === "QUESTION")
      .map((media) => ({
        id: media.id,
        purpose: "QUESTION" as const,
        mime_type: media.mime_type,
        width: media.width,
        height: media.height,
        sort_order: media.sort_order,
        created_at: media.created_at,
        access_url: safeMediaAccessUrl(examId, question.id, media.id),
      })),
    correct_integer_answer: hideAnswers ? undefined : (question.correct_integer_answer ?? null),
    question_time_limit_seconds: question.question_time_limit_seconds ?? null,
    question_options: question.options.map((option) => ({
      id: option.id,
      option_label: option.option_label,
      option_text: option.option_text ?? "",
      option_order: option.option_order,
      ...(hideAnswers ? {} : { is_correct: option.is_correct }),
    })),
  };
}

function mapExamSummary(exam: SafeExam, attemptState: ReturnType<typeof normalizeAttemptStatus>) {
  return {
    id: exam.id,
    title: exam.title,
    exam_mode: exam.exam_mode,
    status: exam.status,
    duration_seconds: exam.duration_seconds,
    exam_date_time: exam.exam_date_time,
    batch: exam.batch,
    question_paper_version_id: exam.question_paper_version_id ?? null,
    question_paper_version: exam.question_paper_version
      ? {
          id: exam.question_paper_version.id,
          version_number: exam.question_paper_version.version_number,
          title_snapshot: exam.question_paper_version.title_snapshot,
          section_count: exam.question_paper_version.sections.length,
          question_count: exam.question_paper_version.questions.length,
        }
      : null,
    attempt: {
      status: attemptState.status,
      ...(attemptState.attempt
        ? {
            attempt_id: attemptState.attempt.id,
            started_at: attemptState.attempt.started_at,
            ends_at: attemptState.attempt.ends_at,
            submitted_at: attemptState.attempt.submitted_at,
            is_auto_submitted: attemptState.attempt.is_auto_submitted,
          }
        : {}),
    },
  };
}

export async function listStudentExams(db: StudentDb, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);

  const exams = await db.exams.findMany({
    where: {
      status: {
        in: [...STUDENT_VISIBLE_EXAM_STATUSES],
      },
      ...examAssignmentWhere(student),
    },
    orderBy: {
      created_at: "desc",
    },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
        },
      },
      question_paper_version: {
        select: {
          id: true,
          version_number: true,
          title_snapshot: true,
          sections: {
            select: {
              id: true,
            },
          },
          questions: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  const attemptStates = await Promise.all(
    exams.map(async (exam) => {
      const attempt = (await loadCurrentAttempt(db, exam.id, student.id)) as SafeAttempt | null;
      return normalizeAttemptStatus(attempt);
    }),
  );

  return {
    student,
    exams: exams.map((exam, index) => mapExamSummary(exam as SafeExam, attemptStates[index])),
  };
}

export async function getStudentExamPaper(db: StudentDb, examId: number, actor: AuthenticatedUser, deviceId?: string | null) {
  const gateAccess = await ensureStudentGateAccess(db, examId, actor, {
    deviceId: deviceId ?? undefined,
    requireLive: false,
  });
  const student = gateAccess.student;
  const exam = gateAccess.exam;
  const attempt = (await loadCurrentAttempt(db, examId, student.id)) as SafeAttempt | null;
  const attemptState = normalizeAttemptStatus(attempt);

  if (exam.status === "CLOSED" && attemptState.status !== "IN_PROGRESS") {
    throw new Error("This exam is closed.");
  }

  const assignedPayload = await loadAssignedStudentPaperPayload(db, examId, student.id);
  if (assignedPayload) {
    const versioned = await loadVersionedExamWithQuestions(db, examId, student);
    const assignedQuestions = assignedPayload.livePackage.sections.flatMap((section) =>
      section.questions.map((question) => ({
        ...question,
        section_code: section.section_code,
      })),
    );

    return {
      exam: mapVersionedExamPaper(versioned).exam,
      attempt: attemptState,
      questions: assignedQuestions,
      gate: mapGateStatus(gateAccess.gateSession, gateAccess.exam, attempt ? attemptState.status : null),
      assigned_paper: assignedPayload.livePackage,
      locked_review_package: assignedPayload.lockedReviewPackage,
    };
  }

  if (exam.question_paper_version_id) {
    const versioned = await loadVersionedExamWithQuestions(db, examId, student);
    return {
      exam: mapVersionedExamPaper(versioned).exam,
      attempt: attemptState,
      questions: mapVersionedExamPaper(versioned).questions,
      gate: mapGateStatus(gateAccess.gateSession, gateAccess.exam, attempt ? attemptState.status : null),
      assigned_paper: null,
      locked_review_package: null,
    };
  }

  const legacyExam = await loadExamWithQuestions(db, examId, student);

  return {
    exam: {
      id: legacyExam.id,
      title: legacyExam.title,
      exam_mode: legacyExam.exam_mode,
      status: legacyExam.status,
      duration_seconds: legacyExam.duration_seconds,
      exam_date_time: legacyExam.exam_date_time,
      instructions: legacyExam.instructions,
      batch: legacyExam.batch,
      exam_sections: legacyExam.exam_sections,
    },
    attempt: attemptState,
    questions: legacyExam.questions.map((question) => mapQuestion(question, legacyExam.id, legacyExam.status === "LIVE")),
    gate: mapGateStatus(gateAccess.gateSession, gateAccess.exam, attempt ? attemptState.status : null),
    assigned_paper: null,
    locked_review_package: null,
  };
}

export async function startOrResumeAttempt(
  db: StudentDb,
  examId: number,
  actor: AuthenticatedUser,
  input: {
    device_id?: string | null;
  } = {},
) {
  if (!input.device_id) {
    throw new ExamGateError("QR_VERIFICATION_REQUIRED", 403, "QR verification is required before starting this exam.");
  }

  const gateAccess = await ensureStudentGateAccess(db, examId, actor, {
    deviceId: input.device_id ?? undefined,
    requireLive: false,
  });
  const student = gateAccess.student;
  const exam = gateAccess.exam;
  const session = gateAccess.gateSession;

  if (!session.has_overlay_permission && !session.bypass_restrictions) {
    throw new ExamGateError("OVERLAY_PERMISSION_REQUIRED", 403, "Overlay permission must be granted before starting the exam.");
  }

  const now = new Date();
  const assignedPayload = await loadAssignedStudentPaperPayload(db, examId, student.id);
  const assignedPaper = assignedPayload?.livePackage ?? null;
  if (!assignedPaper) {
    throw new ExamGateError("ASSIGNED_PAPER_NOT_FOUND", 404, "Assigned paper not found.");
  }

  const existing = (await loadCurrentAttempt(db, examId, student.id)) as SafeAttempt | null;
  if (existing) {
    if (exam.status !== "LIVE") {
      throw examLifecycleError(exam.status);
    }
    if (existing.assigned_paper_instance_id && existing.assigned_paper_instance_id !== assignedPaper.instance_id) {
      throw new ExamGateError("ATTEMPT_NOT_RESUMABLE", 409, "Assigned paper instance does not match this attempt.");
    }

    // Auto-reopen attempt if teacher verified the student after the attempt was submitted/expired/cancelled
    if (existing.status !== "IN_PROGRESS" && gateAccess.gateSession.verified_at) {
      const verifiedAt = new Date(gateAccess.gateSession.verified_at);
      const attemptUpdatedAt = existing.updated_at ? new Date(existing.updated_at) : new Date(existing.started_at);
      if (verifiedAt > attemptUpdatedAt) {
        log.student.info("Auto-reopening attempt because student was re-verified by teacher", {
          attempt_id: existing.id,
          student_id: student.id,
          verified_at: verifiedAt.toISOString(),
          attempt_updated_at: attemptUpdatedAt.toISOString(),
        });

        const elapsedMs = (existing.submitted_at ? new Date(existing.submitted_at).getTime() : attemptUpdatedAt.getTime()) - new Date(existing.started_at).getTime();
        const totalDurationMs = exam.duration_seconds * 1000;
        const remainingMs = Math.max(300000, totalDurationMs - elapsedMs); // at least 5 minutes
        const newEndsAt = new Date(now.getTime() + remainingMs);

        const updatedAttempt = await db.exam_attempts.update({
          where: { id: existing.id },
          data: {
            status: "IN_PROGRESS",
            submitted_at: null,
            is_auto_submitted: false,
            ends_at: newEndsAt,
            updated_at: now,
          },
        });

        Object.assign(existing, updatedAttempt);
      }
    }

    if (existing.status !== "IN_PROGRESS") {
      throw attemptTerminalError(existing.status);
    }
    if (existing.device_id && input.device_id && existing.device_id !== input.device_id) {
      throw new ExamGateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the verified gate session.");
    }
    if (input.device_id && !existing.device_id) {
      await db.exam_attempts.update({
        where: { id: existing.id },
        data: {
          device_id: input.device_id,
        },
      });
    }

    if (existing.assigned_paper_instance_id !== assignedPaper.instance_id) {
      await db.exam_attempts.update({
        where: { id: existing.id },
        data: {
          assigned_paper_instance_id: assignedPaper.instance_id,
        },
      });
    }

    if (existing.ends_at <= now) {
      await db.exam_attempts.update({
        where: { id: existing.id },
        data: {
          status: "EXPIRED",
          updated_at: now,
        },
      });
      throw new ExamGateError("ATTEMPT_EXPIRED", 409, "Your attempt has expired.");
    }

    await linkGateAttempt(db, exam.id, student.id, existing.id);

    broadcastExamRealtime({
      type: "attempt.updated",
      examId: exam.id,
      studentId: student.id,
      attemptId: existing.id,
      actorRole: actor.role,
      payload: {
        action: "resumed",
        status: existing.status,
        device_id: existing.device_id ?? null,
        assigned_paper_instance_id: assignedPaper.instance_id,
      },
    });
    return {
      status: "resumed" as const,
      state_code: "RESUMED_EXISTING_ATTEMPT" as const,
      started_new_attempt: false,
      resumed_existing_attempt: true,
      attempt_status: existing.status,
      attempt_id: existing.id,
      ends_at: existing.ends_at.toISOString(),
      remaining_seconds: getRemainingSeconds(existing.ends_at, now),
      attempt: existing,
      assigned_paper_instance_id: assignedPaper.instance_id,
    };
  }

  if (exam.status !== "LIVE") {
    throw examLifecycleError(exam.status);
  }

  const startedAt = now;
  // Late-entry fairness: a student who joins after the exam has begun only gets
  // the time remaining until the exam's GLOBAL end — not a fresh full window.
  // Global end is anchored to when the exam actually started (manual start) or
  // its scheduled time, plus the exam duration. On-time joiners are unaffected
  // (their full window ends at/before the global end).
  const fullWindowEnd = new Date(startedAt.getTime() + exam.duration_seconds * 1000);
  const examAnchor = exam.started_at ?? exam.exam_date_time ?? null;
  const globalEnd = examAnchor
    ? new Date(new Date(examAnchor).getTime() + exam.duration_seconds * 1000)
    : null;
  const endsAt = globalEnd && globalEnd < fullWindowEnd ? globalEnd : fullWindowEnd;

  if (endsAt.getTime() - now.getTime() < 1000) {
    throw new ExamGateError("EXAM_ALREADY_ENDED", 409, "This exam has already ended — you can no longer join.");
  }

  let attempt: SafeAttempt;
  try {
    attempt = (await db.exam_attempts.create({
      data: {
        exam_id: exam.id,
        student_id: student.id,
        status: "IN_PROGRESS",
        started_at: startedAt,
        ends_at: endsAt,
        is_auto_submitted: false,
        device_id: input.device_id ?? null,
        assigned_paper_instance_id: assignedPaper.instance_id,
        server_time_offset_ms: 0,
      },
    })) as SafeAttempt;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrentAttempt = (await loadCurrentAttempt(db, examId, student.id)) as SafeAttempt | null;
      if (!concurrentAttempt) {
        throw error;
      }
      if (concurrentAttempt.assigned_paper_instance_id && concurrentAttempt.assigned_paper_instance_id !== assignedPaper.instance_id) {
        throw new ExamGateError("ATTEMPT_NOT_RESUMABLE", 409, "Assigned paper instance does not match this attempt.");
      }
      if (concurrentAttempt.status !== "IN_PROGRESS") {
        throw attemptTerminalError(concurrentAttempt.status);
      }
      if (concurrentAttempt.device_id && concurrentAttempt.device_id !== input.device_id) {
        throw new ExamGateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the verified gate session.");
      }
      attempt = concurrentAttempt;
    } else {
      throw error;
    }
  }

  await linkGateAttempt(db, exam.id, student.id, attempt.id);

  log.student.info("Exam attempt started", {
    exam_id:    exam.id,
    student_id: student.id,
    attempt_id: attempt.id,
    device_id:  attempt.device_id ?? "none",
    ends_at:    attempt.ends_at?.toISOString() ?? "?",
    duration_s: exam.duration_seconds,
  });

  broadcastExamRealtime({
    type: "attempt.updated",
    examId: exam.id,
    studentId: student.id,
    attemptId: attempt.id,
    actorRole: actor.role,
    payload: {
      action: "started",
      status: attempt.status,
      device_id: attempt.device_id ?? null,
      started_at: attempt.started_at?.toISOString() ?? null,
      ends_at: attempt.ends_at?.toISOString() ?? null,
      assigned_paper_instance_id: assignedPaper.instance_id,
    },
  });

  return {
    status: "started" as const,
    state_code: "STARTED_NEW_ATTEMPT" as const,
    started_new_attempt: true,
    resumed_existing_attempt: false,
    attempt_status: attempt.status,
    attempt_id: attempt.id,
    ends_at: attempt.ends_at.toISOString(),
    remaining_seconds: getRemainingSeconds(attempt.ends_at, startedAt),
    attempt,
    assigned_paper_instance_id: assignedPaper.instance_id,
  };
}

async function loadVersionedQuestionContext(db: StudentDb, examId: number, questionId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      ...examAssignmentWhere(student),
      question_paper_version_id: {
        not: null,
      },
    },
    include: {
      question_paper_version: {
        include: {
          questions: {
            where: {
              is_active_snapshot: true,
            },
            orderBy: [
              {
                section_code: "asc",
              },
              {
                question_order: "asc",
              },
            ],
            include: {
              options: {
                orderBy: {
                  option_order: "asc",
                },
              },
              media: {
                orderBy: [
                  { purpose: "asc" },
                  { sort_order: "asc" },
                  { created_at: "asc" },
                ],
              },
            },
          },
        },
      },
    },
  });

  if (!exam || !exam.question_paper_version) {
    return null;
  }

  const versionQuestion = exam.question_paper_version.questions.find((entry) => entry.id === questionId);
  if (!versionQuestion) {
    return null;
  }

  const liveQuestion = await db.questions.findFirst({
    where: {
      exam_id: exam.id,
      section_code: versionQuestion.section_code,
      question_order: versionQuestion.question_order,
      is_active: true,
    },
    include: {
      question_options: {
        orderBy: {
          option_order: "asc",
        },
      },
      question_media: {
        where: {
          purpose: "QUESTION",
        },
        orderBy: {
          sort_order: "asc",
        },
      },
    },
  });

  return liveQuestion
    ? {
        exam,
        versionQuestion,
        liveQuestion,
      }
    : null;
}

export async function saveStudentAnswer(
  db: StudentDb,
  attemptId: number,
  actor: AuthenticatedUser,
  input: {
    question_id?: number;
    assigned_question_id?: number;
    version_question_id?: number;
    device_id?: string | null;
    selected_option_id?: number;
    integer_answer?: string;
    is_marked_for_review: boolean;
    timed_out?: boolean;
  },
) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await db.exam_attempts.findFirst({
    where: {
      id: attemptId,
      student_id: student.id,
    },
    include: {
      attempt_result: true,
    },
  });
  if (!attempt) {
    throw new ExamGateError("ATTEMPT_NOT_RESUMABLE", 404, "Attempt not found.");
  }

  const now = new Date();
  if (attempt.status !== "IN_PROGRESS") {
    throw attemptTerminalError(attempt.status);
  }

  const exam = await db.exams.findFirst({
    where: { id: attempt.exam_id },
    select: {
      id: true,
      status: true,
      question_paper_version_id: true,
    },
  });
  if (!exam) {
    throw new ExamGateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }

  if (exam.status !== "LIVE") {
    throw examLifecycleError(exam.status);
  }

  if (attempt.ends_at <= now) {
    await db.exam_attempts.update({
      where: { id: attempt.id },
      data: {
        status: "EXPIRED",
        updated_at: now,
      },
    });
    throw new ExamGateError("ATTEMPT_EXPIRED", 409, "Attempt time has expired.");
  }

  if (input.device_id && attempt.device_id && input.device_id !== attempt.device_id) {
    throw new ExamGateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the verified gate session.");
  }

  // Gate verification is only required for versioned (official assigned-paper) exams.
  // Non-versioned exams don't have a gate session — skip the check so answers can sync.
  if (exam.question_paper_version_id) {
    await ensureStudentGateAccess(db, attempt.exam_id, actor, {
      deviceId: attempt.device_id ?? input.device_id ?? undefined,
      requireLive: false,
    });
  }

  const assignedPayload = exam.question_paper_version_id ? await loadAssignedStudentPaperPayload(db, exam.id, student.id) : null;
  const assignedPaperInstanceId = assignedPayload?.livePackage.instance_id ?? null;
  const assignedQuestions =
    assignedPayload?.livePackage.sections.flatMap(
      (
        section: {
          section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
          questions: Array<{
            assigned_question_id: number;
            version_question_id: number;
            student_question_order: number;
            section_question_order: number;
            original_question_order: number;
            question_type: "MCQ" | "INTEGER";
            question_text: string | null;
            question_media: Array<unknown>;
            options: Array<unknown>;
          }>;
        },
      ) =>
        section.questions.map((question) => ({
          ...question,
          section_code: section.section_code,
        })),
    ) ?? [];
  const officialAssignedPaperMode = Boolean(exam.question_paper_version_id && assignedPaperInstanceId);

  if (exam.question_paper_version_id && !assignedPaperInstanceId) {
    throw new ExamGateError("ASSIGNED_PAPER_NOT_FOUND", 404, "Assigned paper not found.");
  }

  if (officialAssignedPaperMode) {
    if (input.assigned_question_id === undefined || input.version_question_id === undefined) {
      throw new ExamGateError(
        "ASSIGNED_QUESTION_MISMATCH",
        409,
        "Assigned question and version question are required for official exam answers.",
      );
    }
  }

  const assignedQuestionById =
    input.assigned_question_id !== undefined
      ? assignedQuestions.find((entry) => entry.assigned_question_id === input.assigned_question_id) ?? null
      : null;
  const assignedQuestionByVersion =
    input.version_question_id !== undefined
      ? assignedQuestions.find((entry) => entry.version_question_id === input.version_question_id) ?? null
      : null;

  if (input.assigned_question_id !== undefined && !assignedQuestionById) {
    throw new ExamGateError("ASSIGNED_QUESTION_MISMATCH", 409, "Assigned question does not belong to this student package.");
  }
  if (
    input.assigned_question_id !== undefined &&
    input.version_question_id !== undefined &&
    assignedQuestionById?.version_question_id !== input.version_question_id
  ) {
    throw new ExamGateError("ASSIGNED_QUESTION_MISMATCH", 409, "Version question does not match the assigned question.");
  }
  if (input.version_question_id !== undefined && !assignedQuestionByVersion && assignedQuestions.length > 0) {
    throw new ExamGateError("ASSIGNED_QUESTION_MISMATCH", 409, "Version question does not belong to this student package.");
  }
  if (officialAssignedPaperMode && (!assignedQuestionById || !assignedQuestionByVersion)) {
    throw new ExamGateError("ASSIGNED_QUESTION_MISMATCH", 409, "Assigned question does not belong to this student package.");
  }

  const assignedQuestion =
    assignedQuestionById ??
    assignedQuestionByVersion ??
    (!officialAssignedPaperMode && input.question_id !== undefined
      ? assignedQuestions.find((entry) => entry.assigned_question_id === input.question_id) ??
        assignedQuestions.find((entry) => entry.version_question_id === input.question_id) ??
        null
      : null);

  const versionQuestionId =
    input.version_question_id ??
    assignedQuestion?.version_question_id ??
    (input.question_id !== undefined ? input.question_id : undefined) ??
    null;

  const versionQuestion =
    exam.question_paper_version_id && versionQuestionId !== null
      ? await db.question_paper_version_questions.findFirst({
          where: {
            id: versionQuestionId,
          },
          include: {
            options: {
              orderBy: {
                option_order: "asc",
              },
            },
          },
        })
      : null;

  // Look up the exam-snapshot question by (section_code, question_order) — the unique
  // index that is guaranteed to exist for every versioned exam question.
  // NOTE: versionQuestion.original_question_id references paper_questions (the template
  // repository), NOT the questions table (per-exam snapshots), so we must NOT use it as
  // a direct id lookup against db.questions — that would always return null and produce a
  // spurious 404 ASSIGNED_QUESTION_MISMATCH error during live-exam answer saves.
  const question = versionQuestion
    ? await db.questions.findFirst({
        where: {
          exam_id: exam.id,
          section_code: versionQuestion.section_code,
          question_order: versionQuestion.question_order,
          is_active: true,
        },
        select: {
          id: true,
          question_type: true,
          question_order: true,
          section_code: true,
          question_options: {
            orderBy: {
              option_order: "asc",
            },
            select: {
              id: true,
              option_label: true,
            },
          },
        },
      })
    : !officialAssignedPaperMode && input.question_id !== undefined
      ? await db.questions.findFirst({
          where: {
            id: input.question_id,
            exam_id: attempt.exam_id,
            is_active: true,
          },
          select: {
            id: true,
            question_type: true,
            question_order: true,
            section_code: true,
            question_options: {
              orderBy: {
                option_order: "asc",
              },
              select: {
                id: true,
                option_label: true,
              },
            },
          },
        })
      : null;

  if (!question) {
    throw new ExamGateError("ASSIGNED_QUESTION_MISMATCH", 404, "Question not found.");
  }

  let selectedOptionId: number | null = null;
  let integerAnswer: string | null = null;

  if (question.question_type === "MCQ") {
    if (input.selected_option_id !== undefined) {
      if (versionQuestion) {
        const versionOption = versionQuestion.options.find((option) => option.id === input.selected_option_id);
        if (!versionOption) {
          throw new ExamGateError("OPTION_NOT_FOR_THIS_QUESTION", 409, "Selected option does not belong to this question.");
        }

        const matchedQuestionOption =
          (versionOption.original_option_id != null
            ? await db.question_options.findFirst({
                where: {
                  id: versionOption.original_option_id,
                  question_id: question.id,
                },
                select: { id: true },
              })
            : null) ??
          (await db.question_options.findFirst({
            where: {
              question_id: question.id,
              option_label: versionOption.option_label,
            },
            select: { id: true },
          }));

        if (!matchedQuestionOption) {
          throw new ExamGateError("OPTION_NOT_FOR_THIS_QUESTION", 409, "Selected option does not belong to this question.");
        }
        selectedOptionId = matchedQuestionOption.id;
      } else {
        const option = await db.question_options.findFirst({
          where: {
            id: input.selected_option_id,
            question_id: question.id,
          },
          select: { id: true },
        });
        if (!option) {
          throw new ExamGateError("OPTION_NOT_FOR_THIS_QUESTION", 409, "Selected option does not belong to this question.");
        }
        selectedOptionId = option.id;
      }
    }
  } else {
    if (input.integer_answer !== undefined) {
      integerAnswer = input.integer_answer;
    }
  }

  const saved = await db.attempt_answers.upsert({
    where: {
      attempt_id_question_id: {
        attempt_id: attempt.id,
        question_id: question.id,
      },
    },
    create: {
      attempt_id: attempt.id,
      question_id: question.id,
      assigned_question_id: assignedQuestion?.assigned_question_id ?? null,
      version_question_id: versionQuestion?.id ?? null,
      selected_option_id: selectedOptionId,
      integer_answer: integerAnswer,
      is_marked_for_review: input.is_marked_for_review,
      timed_out: input.timed_out ?? false,
      saved_at: now,
    },
    update: {
      assigned_question_id: assignedQuestion?.assigned_question_id ?? null,
      version_question_id: versionQuestion?.id ?? null,
      selected_option_id: selectedOptionId,
      integer_answer: integerAnswer,
      is_marked_for_review: input.is_marked_for_review,
      timed_out: input.timed_out ?? false,
      saved_at: now,
    },
  });

  if (assignedPaperInstanceId && attempt.assigned_paper_instance_id !== assignedPaperInstanceId) {
    await db.exam_attempts.update({
      where: { id: attempt.id },
      data: {
        assigned_paper_instance_id: assignedPaperInstanceId,
      },
    });
  }

  broadcastExamRealtime({
    type: "attempt.updated",
    examId: attempt.exam_id,
    studentId: student.id,
    attemptId: attempt.id,
    actorRole: actor.role,
    payload: {
      action: "answer_saved",
      question_id: input.question_id ?? null,
      assigned_question_id: assignedQuestion?.assigned_question_id ?? null,
      version_question_id: versionQuestion?.id ?? null,
      marked_for_review: input.is_marked_for_review,
      saved_at: now.toISOString(),
    },
  });

  return {
    saved,
    submitted_question_id: input.question_id ?? assignedQuestion?.assigned_question_id ?? versionQuestion?.id ?? question.id,
    assigned_question_id: assignedQuestion?.assigned_question_id ?? null,
    version_question_id: versionQuestion?.id ?? null,
  };
}

export async function submitStudentAttempt(db: StudentDb, attemptId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await db.exam_attempts.findFirst({
    where: {
      id: attemptId,
      student_id: student.id,
    },
  });
  if (!attempt) {
    throw new ExamGateError("ATTEMPT_NOT_RESUMABLE", 404, "Attempt not found.");
  }

  const now = new Date();
  if (attempt.status !== "IN_PROGRESS") {
    const attemptResult = (attempt as SafeAttempt & { attempt_result?: unknown | null }).attempt_result ?? null;
    if (!attemptResult) {
      try {
        const refreshed = await recalculateAttemptResult(db, attempt.id);
        return {
          status: refreshed.attempt.status,
          state_code: refreshed.attempt.status === "SUBMITTED" || refreshed.attempt.status === "AUTO_SUBMITTED"
            ? "ATTEMPT_ALREADY_SUBMITTED"
            : refreshed.attempt.status === "EXPIRED"
              ? "ATTEMPT_EXPIRED"
              : "ATTEMPT_NOT_RESUMABLE",
          attempt: refreshed.attempt,
        };
      } catch {
        // Fall through to a safe terminal response if repair fails.
      }
    }
    return {
      status: attempt.status,
      state_code: attempt.status === "SUBMITTED" || attempt.status === "AUTO_SUBMITTED"
        ? "ATTEMPT_ALREADY_SUBMITTED"
        : attempt.status === "EXPIRED"
          ? "ATTEMPT_EXPIRED"
          : "ATTEMPT_NOT_RESUMABLE",
      attempt,
    };
  }

  const exam = await db.exams.findFirst({
    where: { id: attempt.exam_id },
    select: {
      id: true,
      status: true,
    },
  });

  if (!exam) {
    throw new ExamGateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }

  if (exam.status !== "LIVE") {
    throw examLifecycleError(exam.status);
  }

  await ensureStudentGateAccess(db, attempt.exam_id, actor, {
    deviceId: attempt.device_id ?? undefined,
    requireLive: false,
  });

  const nextStatus = attempt.ends_at <= now ? "AUTO_SUBMITTED" : "SUBMITTED";
  const transitioned = await db.$transaction(async (tx) => {
    const current = await tx.exam_attempts.findFirst({
      where: {
        id: attempt.id,
        student_id: student.id,
      },
    });
    if (!current) {
      return {
        kind: "missing" as const,
        attempt: null,
      };
    }

    if (current.status !== "IN_PROGRESS") {
      return {
        kind: "terminal" as const,
        attempt: current,
      };
    }

    const updateResult = await tx.exam_attempts.updateMany({
      where: {
        id: current.id,
        student_id: student.id,
        status: "IN_PROGRESS",
      },
      data: {
        status: nextStatus,
        submitted_at: now,
        is_auto_submitted: nextStatus === "AUTO_SUBMITTED",
        updated_at: now,
      },
    });

    if (updateResult.count === 0) {
      const refreshed = await tx.exam_attempts.findFirst({
        where: {
          id: current.id,
          student_id: student.id,
        },
      });
      return {
        kind: "terminal" as const,
        attempt: refreshed ?? current,
      };
    }

    const updated = await tx.exam_attempts.findFirst({
      where: {
        id: current.id,
        student_id: student.id,
      },
    });
    return {
      kind: "updated" as const,
      attempt: updated ?? current,
    };
  });

  if (transitioned.kind !== "updated" || !transitioned.attempt) {
    return {
      status: transitioned.attempt?.status ?? attempt.status,
      state_code:
        transitioned.attempt?.status === "SUBMITTED" || transitioned.attempt?.status === "AUTO_SUBMITTED"
          ? "ATTEMPT_ALREADY_SUBMITTED"
          : transitioned.attempt?.status === "EXPIRED"
            ? "ATTEMPT_EXPIRED"
            : "ATTEMPT_NOT_RESUMABLE",
      attempt: transitioned.attempt ?? attempt,
    };
  }

  const updated = transitioned.attempt;
  if (!updated) {
    throw new ExamGateError("ATTEMPT_NOT_RESUMABLE", 409, "Attempt cannot be submitted.");
  }

  const result = await recalculateAttemptResult(db, updated.id);

  log.student.info(`Attempt ${nextStatus === "AUTO_SUBMITTED" ? "AUTO-SUBMITTED" : "submitted"}`, {
    exam_id:     attempt.exam_id,
    student_id:  student.id,
    attempt_id:  updated.id,
    status:      updated.status,
    total_score: result.result?.total_score ?? "n/a",
    max_score:   result.result?.max_score ?? "n/a",
  });

  broadcastExamRealtime({
    type: "attempt.updated",
    examId: attempt.exam_id,
    studentId: student.id,
    attemptId: updated.id,
    actorRole: actor.role,
    payload: {
      action: "submitted",
      status: updated.status,
      submitted_at: updated.submitted_at?.toISOString() ?? null,
      is_auto_submitted: updated.is_auto_submitted,
      total_score: result.result?.total_score ?? null,
      max_score: result.result?.max_score ?? null,
    },
  });

  return {
    status: nextStatus,
    state_code: nextStatus === "AUTO_SUBMITTED" ? "ATTEMPT_AUTO_SUBMITTED" : "ATTEMPT_SUBMITTED",
    attempt_status: updated.status,
    attempt: updated,
    result: result.result,
  };
}

export async function loadStudentQuestionMedia(db: StudentDb, examId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);

  // Finished exams (CLOSED / RESULT_RELEASED) are served to PRACTICE and REVIEW.
  // The live gate (QR verification + device binding) does not apply once an exam
  // has ended, and the gate loader (loadGateExamForStudent) outright rejects
  // finished exams with EXAM_NOT_FOUND. So authorize finished-exam media by
  // batch/UID assignment instead. Live / upcoming exams keep the strict gate.
  const finishedExam = await db.exams.findFirst({
    where: {
      id: examId,
      status: { in: ["CLOSED", "RESULT_RELEASED"] },
      ...examAssignmentWhere(student),
    },
  });

  let exam: { id: number; status: string; question_paper_version_id: number | null };
  if (finishedExam) {
    exam = finishedExam;
  } else {
    const gateAccess = await ensureStudentGateAccess(db, examId, actor, {
      requireLive: false,
    });
    exam = gateAccess.exam;
    const attempt = (await loadCurrentAttempt(db, examId, student.id)) as SafeAttempt | null;
    const attemptState = normalizeAttemptStatus(attempt);
    if (!["PUBLISHED", "LIVE", "CLOSED", "RESULT_RELEASED"].includes(exam.status) && attemptState.status !== "IN_PROGRESS") {
      throw new Error("This exam is not available.");
    }
  }

  const attempt = (await loadCurrentAttempt(db, examId, student.id)) as SafeAttempt | null;
  const attemptState = normalizeAttemptStatus(attempt);

  // A versioned exam's practice paper may reference EITHER version-question ids
  // (the attendee's shuffled assigned paper, Step 1) OR base question ids (the
  // non-attendee deterministic fallback, Step 2). Try the version space first,
  // then fall back to the base questions/question_media tables, so the image
  // resolves regardless of which id-space the access_url was built from.
  if (exam.question_paper_version_id) {
    const versioned = await loadVersionedQuestionContext(db, examId, questionId, student);
    const versionMedia = versioned?.versionQuestion.media.find((entry) => entry.id === mediaId && entry.purpose === "QUESTION");
    if (versionMedia) {
      return {
        media: {
          id: versionMedia.id,
          question_id: versioned!.versionQuestion.id,
          purpose: versionMedia.purpose,
          storage_url: versionMedia.storage_url,
          mime_type: versionMedia.mime_type,
          checksum: versionMedia.checksum,
          width: versionMedia.width,
          height: versionMedia.height,
          sort_order: versionMedia.sort_order,
          created_at: versionMedia.created_at,
        },
        exam,
        attempt: attemptState,
      };
    }
  }

  const question = await db.questions.findFirst({
    where: {
      id: questionId,
      exam_id: exam.id,
      is_active: true,
    },
    select: {
      id: true,
    },
  });
  if (!question) {
    throw new Error("Question not found.");
  }

  const media = await db.question_media.findFirst({
    where: {
      id: mediaId,
      question_id: question.id,
      purpose: "QUESTION",
    },
    select: {
      id: true,
      question_id: true,
      purpose: true,
      storage_url: true,
      mime_type: true,
      checksum: true,
      width: true,
      height: true,
      sort_order: true,
      uploaded_by: true,
      created_at: true,
    },
  });

  if (!media) {
    throw new Error("Media not found.");
  }

  return {
    media,
    exam,
    attempt: attemptState,
  };
}

function solutionMediaShape(media: SafeSolutionMedia) {
  return {
    id: media.id,
    question_id: media.question_id,
    purpose: media.purpose,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    created_at: media.created_at,
  };
}

async function loadQuestionForPracticeAnswer(db: StudentDb, questionId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const question = await db.questions.findFirst({
    where: {
      id: questionId,
      is_active: true,
    },
    include: {
      exam: {
        include: {
          batch: true,
          exam_sections: true,
        },
      },
      question_options: {
        orderBy: {
          option_order: "asc",
        },
      },
    },
  });

  if (!question) {
    throw new Error("Question not found.");
  }

  const exam = await loadAccessibleExam(db, question.exam_id, student);
  if (exam.exam_mode !== "PRACTICE") {
    throw new Error("Practice answer checking is only available for practice exams.");
  }
  if (exam.solution_release_policy !== "PRACTICE_UNLOCK_RULE") {
    throw new Error("Practice solution unlock is not enabled for this exam.");
  }

  return {
    exam,
    question: question as PracticeQuestionRow,
  };
}

async function loadQuestionForLiveSolution(db: StudentDb, examId: number, questionId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const exam = await loadAccessibleExam(db, examId, student);
  if (exam.exam_mode !== "LIVE") {
    throw new Error("Live solution access is only available for live exams.");
  }

  const question = await db.questions.findFirst({
    where: {
      id: questionId,
      exam_id: exam.id,
      is_active: true,
    },
    include: {
      question_media: {
        where: {
          purpose: "SOLUTION",
        },
        orderBy: {
          sort_order: "asc",
        },
      },
    },
  });

  if (!question) {
    throw new Error("Question not found.");
  }

  const now = new Date();
  if (exam.solution_release_policy === "NEVER") {
    throw new Error("Solution access is disabled for this exam.");
  }
  if (exam.solution_release_policy === "PRACTICE_UNLOCK_RULE") {
    throw new Error("Practice unlock policy is not available for live exam solution access.");
  }
  if (exam.solution_release_policy === "AFTER_RESULT_RELEASE") {
    if (exam.status !== "RESULT_RELEASED") {
      throw new Error("Solution is not available yet.");
    }
  } else if (exam.solution_release_policy === "AFTER_EXAM_END") {
    if (exam.status !== "CLOSED" && exam.status !== "RESULT_RELEASED") {
      const attempt = await loadCurrentAttempt(db, exam.id, student.id);
      if (!attempt || (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED") || attempt.ends_at > now) {
        throw new Error("Solution is not available yet.");
      }
    }
  }

  const media = (question.question_media as Array<{ id: number; question_id: number; purpose: "SOLUTION"; mime_type: string; width: number | null; height: number | null; sort_order: number; created_at: Date }>).map((entry) => ({
    id: entry.id,
    question_id: entry.question_id,
    purpose: "SOLUTION" as const,
    mime_type: entry.mime_type,
    width: entry.width,
    height: entry.height,
    sort_order: entry.sort_order,
    created_at: entry.created_at,
  }));

  if (!media.length) {
    throw new Error("Solution media not found.");
  }

  return {
    exam,
    question: {
      id: question.id,
      media,
    },
  };
}

async function loadQuestionForPracticeSolution(db: StudentDb, questionId: number, student: Awaited<ReturnType<typeof loadStudentProfile>>) {
  const question = await db.questions.findFirst({
    where: {
      id: questionId,
      is_active: true,
    },
    include: {
      exam: {
        include: {
          batch: true,
          exam_sections: true,
        },
      },
      question_media: {
        where: {
          purpose: "SOLUTION",
        },
        orderBy: {
          sort_order: "asc",
        },
      },
    },
  });

  if (!question) {
    throw new Error("Question not found.");
  }

  const exam = await loadAccessibleExam(db, question.exam_id, student);
  if (exam.exam_mode !== "PRACTICE") {
    throw new Error("Practice solution access is only available for practice exams.");
  }
  if (exam.solution_release_policy !== "PRACTICE_UNLOCK_RULE") {
    throw new Error("Practice solution unlock is not enabled for this exam.");
  }

  const practiceAttempt = await db.practice_question_attempts.findUnique({
    where: {
      student_id_exam_id_question_id: {
        student_id: student.id,
        exam_id: exam.id,
        question_id: question.id,
      },
    },
  });

  if (!practiceAttempt || !practiceAttempt.solution_unlocked) {
    throw new Error("Solution is locked.");
  }

  const media = (question.question_media as Array<{ id: number; question_id: number; purpose: "SOLUTION"; mime_type: string; width: number | null; height: number | null; sort_order: number; created_at: Date }>).map((entry) => ({
    id: entry.id,
    question_id: entry.question_id,
    purpose: "SOLUTION" as const,
    mime_type: entry.mime_type,
    width: entry.width,
    height: entry.height,
    sort_order: entry.sort_order,
    created_at: entry.created_at,
  }));

  if (!media.length) {
    throw new Error("Solution media not found.");
  }

  return {
    exam,
    question: {
      id: question.id,
      media,
    },
    practiceAttempt,
  };
}

export async function checkPracticeAnswer(
  db: StudentDb,
  questionId: number,
  actor: AuthenticatedUser,
  input: {
    selected_option_id?: number;
    integer_answer?: string;
  },
) {
  const student = await loadStudentProfile(db, actor.id);
  const { exam, question } = await loadQuestionForPracticeAnswer(db, questionId, student);
  const now = new Date();

  let correct = false;
  let normalizedAnswer: string | null = practiceAnswerDisplayValue(input);

  if (question.question_type === "MCQ") {
    if (input.selected_option_id === undefined) {
      throw new Error("selected_option_id is required for MCQ questions.");
    }

    const option = question.question_options.find((entry) => entry.id === input.selected_option_id);
    if (!option) {
      throw new Error("Selected option does not belong to this question.");
    }

    correct = option.is_correct;
  } else {
    if (input.integer_answer === undefined) {
      throw new Error("integer_answer is required for integer questions.");
    }

    const submitted = canonicalizeIntegerAnswer(input.integer_answer);
    const expected = canonicalizeIntegerAnswer(question.correct_integer_answer);
    if (!expected) {
      throw new Error(`Question ${question.id} is missing an integer answer.`);
    }
    if (!submitted) {
      throw new Error("integer_answer is required for integer questions.");
    }

    correct = isIntegerAnswerCorrect(submitted, expected);
  }

  const existing = await db.practice_question_attempts.findUnique({
    where: {
      student_id_exam_id_question_id: {
        student_id: student.id,
        exam_id: exam.id,
        question_id: question.id,
      },
    },
  });

  const nextAttemptCount = (existing?.attempt_count ?? 0) + 1;
  const nextWrongCount = (existing?.wrong_count ?? 0) + (correct ? 0 : 1);
  const nextCorrectCount = (existing?.correct_count ?? 0) + (correct ? 1 : 0);
  const unlockedByRule = correct || nextWrongCount >= 2;
  const nextUnlocked = Boolean(existing?.solution_unlocked) || unlockedByRule;

  const updated = await db.practice_question_attempts.upsert({
    where: {
      student_id_exam_id_question_id: {
        student_id: student.id,
        exam_id: exam.id,
        question_id: question.id,
      },
    },
    create: {
      student_id: student.id,
      exam_id: exam.id,
      question_id: question.id,
      attempt_count: nextAttemptCount,
      wrong_count: nextWrongCount,
      correct_count: nextCorrectCount,
      last_answer: normalizedAnswer,
      solution_unlocked: nextUnlocked,
      solution_unlocked_at: nextUnlocked ? now : null,
    },
    update: {
      attempt_count: nextAttemptCount,
      wrong_count: nextWrongCount,
      correct_count: nextCorrectCount,
      last_answer: normalizedAnswer,
      solution_unlocked: nextUnlocked,
      solution_unlocked_at: nextUnlocked && !existing?.solution_unlocked ? now : existing?.solution_unlocked_at ?? (nextUnlocked ? now : null),
    },
  });

  return {
    exam,
    question,
    practiceAttempt: updated,
    correct,
    solutionUnlocked: nextUnlocked,
    feedback: correct ? "Correct" : nextUnlocked ? "Solution unlocked" : "Try again",
  };
}

export async function getStudentPracticeSolution(db: StudentDb, questionId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const { exam, question, practiceAttempt } = await loadQuestionForPracticeSolution(db, questionId, student);

  return {
    exam,
    question: {
      id: question.id,
    },
    practiceAttempt,
    media: question.media.map(solutionMediaShape),
  };
}

export async function getStudentLiveSolution(db: StudentDb, examId: number, questionId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const { exam, question } = await loadQuestionForLiveSolution(db, examId, questionId, student);

  return {
    exam,
    question: {
      id: question.id,
    },
    media: question.media.map(solutionMediaShape),
  };
}

export async function readStudentSolutionMediaFile(db: StudentDb, examId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const { exam, question } = await loadQuestionForLiveSolution(db, examId, questionId, student);
  const media = question.media.find((entry) => entry.id === mediaId);

  if (!media) {
    throw new Error("Media not found.");
  }

  const stored = await db.question_media.findFirst({
    where: {
      id: media.id,
      question_id: question.id,
      purpose: "SOLUTION",
    },
    select: {
      id: true,
      question_id: true,
      purpose: true,
      storage_url: true,
      mime_type: true,
      checksum: true,
      width: true,
      height: true,
      sort_order: true,
      uploaded_by: true,
      created_at: true,
    },
  });

  if (!stored) {
    throw new Error("Media not found.");
  }

  const absolutePath = stored.storage_url.startsWith("/")
    ? `${process.cwd()}${stored.storage_url}`
    : `${process.cwd()}/${stored.storage_url}`;

  return {
    exam,
    question,
    media: stored,
    absolutePath,
  };
}

export async function readStudentPracticeSolutionMediaFile(db: StudentDb, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const { exam, question } = await loadQuestionForPracticeSolution(db, questionId, student);
  const media = question.media.find((entry) => entry.id === mediaId);

  if (!media) {
    throw new Error("Media not found.");
  }

  const stored = await db.question_media.findFirst({
    where: {
      id: mediaId,
    },
    select: {
      id: true,
      storage_url: true,
      mime_type: true,
    },
  });

  if (!stored) {
    throw new Error("Practice solution media not found.");
  }

  const absolutePath = stored.storage_url.startsWith("/")
    ? `${process.cwd()}${stored.storage_url}`
    : `${process.cwd()}/${stored.storage_url}`;

  return {
    exam,
    question,
    media: stored,
    absolutePath,
  };
}

// ── Practice Session for Past Exams ──────────────────────────────────────────
// Returns a deterministically shuffled exam paper so a student can practise a
// CLOSED / RESULT_RELEASED exam from any device.
// • If the student completed the live gate their original assigned question order
//   is restored (same paper, same set).
// • Otherwise a per-student seed derived from student_uid + exam_id gives a
//   unique-but-consistent shuffle on every login.
// Results are NOT stored in exam_attempts → never counted on the leaderboard.

function examPracticeSeed(studentUid: string, examId: number): number {
  let hash = examId * 31;
  for (let i = 0; i < studentUid.length; i++) {
    hash = Math.imul(hash + studentUid.charCodeAt(i), 0x9e3779b9) | 0;
  }
  return Math.abs(hash);
}

function deterministicShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let state = seed;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const j = Math.abs(state) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function startStudentPracticeSession(
  db: StudentDb,
  examId: number,
  actor: AuthenticatedUser,
) {
  const student = await loadStudentProfile(db, actor.id);

  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      status: { in: ["CLOSED", "RESULT_RELEASED"] },
      ...examAssignmentWhere(student),
    },
    include: { batch: { select: { id: true, name: true } } },
  });
  if (!exam) {
    throw new ExamGateError("EXAM_NOT_FOUND", 404, "Exam not found or not available for practice.");
  }

  let practiceQuestions: any[] = [];

  // 1. Restore student's original gate-assigned paper (if they attended live)
  if (exam.question_paper_version_id) {
    const gateSession = await db.exam_gate_sessions.findFirst({
      where: { exam_id: examId, student_id: student.id, gate_status: "VERIFIED" },
      select: { id: true },
    });
    if (gateSession) {
      const assignedPayload = await loadAssignedStudentPaperPayload(db, examId, student.id).catch(() => null);
      if (assignedPayload) {
        const flatQuestions = assignedPayload.livePackage.sections.flatMap((section: any) =>
          section.questions.map((q: any) => ({ ...q, section_code: section.section_code })),
        );
        for (const aq of flatQuestions) {
          const vq = await db.question_paper_version_questions.findFirst({
            where: { id: aq.version_question_id },
            include: {
              options: { orderBy: { option_order: "asc" } },
              media: { orderBy: { sort_order: "asc" } }, // fetch ALL purposes (QUESTION + SOLUTION)
            },
          });
          if (!vq) continue;
          const questionMedia = (vq.media ?? []).filter((m: any) => m.purpose === "QUESTION");
          const solutionMedia = (vq.media ?? []).filter((m: any) => m.purpose === "SOLUTION");
          practiceQuestions.push({
            id: aq.version_question_id,
            section_code: aq.section_code,
            question_type: vq.question_type,
            question_order: aq.student_question_order ?? aq.original_question_order ?? 0,
            question_text: vq.question_text,
            marks: vq.marks,
            negative_marks: vq.negative_marks,
            source_type: "TEXT",
            is_active: true,
            difficulty: null,
            topic: null,
            chapter: null,
            assigned_question_id: aq.assigned_question_id,
            version_question_id: aq.version_question_id,
            question_media: questionMedia.map((media: any) => ({
              id: media.id,
              purpose: "QUESTION" as const,
              mime_type: media.mime_type,
              width: media.width,
              height: media.height,
              sort_order: media.sort_order,
              created_at: media.created_at,
              access_url: safeMediaAccessUrl(examId, aq.version_question_id, media.id),
            })),
            solution_media: solutionMedia.map((media: any) => ({
              id: media.id,
              purpose: "SOLUTION" as const,
              mime_type: media.mime_type,
              width: media.width,
              height: media.height,
              sort_order: media.sort_order,
              created_at: media.created_at,
              access_url: `/api/student/exams/${examId}/questions/${aq.version_question_id}/solution/${media.id}`,
            })),
            correct_integer_answer: vq.correct_integer_answer ?? null,
            question_options: (vq.options ?? []).map((opt: any) => ({
              id: opt.id,
              option_label: opt.option_label,
              option_text: opt.option_text ?? "",
              option_order: opt.option_order,
              is_correct: opt.is_correct,
            })),
          });
        }
      }
    }
  }

  // 1.5 Non-attendee on a VERSIONED exam: build the practice paper from the
  // version paper using the SAME selection logic the live exam used, so the
  // student practises the same per-section question COUNT that was actually
  // delivered (e.g. 10 of a 15-question pool) — not the whole bank. Falls
  // through to the base-bank shuffle (Step 2) for non-versioned exams or if the
  // selection comes back empty.
  if (practiceQuestions.length === 0 && exam.question_paper_version_id) {
    const selection = await selectNonAttendeePracticeQuestions(db, examId, student.id).catch(() => []);
    for (const sel of selection) {
      const vq = await db.question_paper_version_questions.findFirst({
        where: { id: sel.version_question_id },
        include: {
          options: { orderBy: { option_order: "asc" } },
          media: { orderBy: { sort_order: "asc" } }, // all purposes (QUESTION + SOLUTION)
        },
      });
      if (!vq) continue;
      const questionMedia = (vq.media ?? []).filter((m: any) => m.purpose === "QUESTION");
      const solutionMedia = (vq.media ?? []).filter((m: any) => m.purpose === "SOLUTION");
      practiceQuestions.push({
        id: sel.version_question_id,
        section_code: sel.section_code,
        question_type: vq.question_type,
        question_order: sel.student_question_order,
        question_text: vq.question_text,
        marks: vq.marks,
        negative_marks: vq.negative_marks,
        source_type: "TEXT",
        is_active: true,
        difficulty: null,
        topic: null,
        chapter: null,
        version_question_id: sel.version_question_id,
        question_media: questionMedia.map((media: any) => ({
          id: media.id,
          purpose: "QUESTION" as const,
          mime_type: media.mime_type,
          width: media.width,
          height: media.height,
          sort_order: media.sort_order,
          created_at: media.created_at,
          access_url: safeMediaAccessUrl(examId, sel.version_question_id, media.id),
        })),
        solution_media: solutionMedia.map((media: any) => ({
          id: media.id,
          purpose: "SOLUTION" as const,
          mime_type: media.mime_type,
          width: media.width,
          height: media.height,
          sort_order: media.sort_order,
          created_at: media.created_at,
          access_url: `/api/student/exams/${examId}/questions/${sel.version_question_id}/solution/${media.id}`,
        })),
        correct_integer_answer: vq.correct_integer_answer ?? null,
        question_options: (vq.options ?? []).map((opt: any) => ({
          id: opt.id,
          option_label: opt.option_label,
          option_text: opt.option_text ?? "",
          option_order: opt.option_order,
          is_correct: opt.is_correct,
        })),
      });
    }
  }

  // 2. Fallback: deterministic shuffle of the base exam questions
  if (practiceQuestions.length === 0) {
    const rawQuestions = await db.questions.findMany({
      where: { exam_id: examId, is_active: true },
      include: {
        question_media: true, // all purposes — filter below
        question_options: { orderBy: { option_order: "asc" } },
      },
      orderBy: [{ section_code: "asc" }, { question_order: "asc" }],
    });

    const seed = examPracticeSeed(student.student_uid, examId);
    const shuffled = deterministicShuffle(rawQuestions, seed);

    practiceQuestions = shuffled.map((q, idx) => {
      const qMedia = (q.question_media ?? []).filter((m: any) => m.purpose === "QUESTION");
      const sMedia = (q.question_media ?? []).filter((m: any) => m.purpose === "SOLUTION");
      return {
        ...mapQuestion(q, examId),
        question_order: idx + 1,
        correct_integer_answer: q.correct_integer_answer ?? null,
        question_media: qMedia.map((media: any) => ({
          id: media.id,
          purpose: "QUESTION" as const,
          mime_type: media.mime_type,
          width: media.width,
          height: media.height,
          sort_order: media.sort_order,
          created_at: media.created_at,
          access_url: safeMediaAccessUrl(examId, q.id, media.id),
        })),
        solution_media: sMedia.map((media: any) => ({
          id: media.id,
          purpose: "SOLUTION" as const,
          mime_type: media.mime_type,
          width: media.width,
          height: media.height,
          sort_order: media.sort_order,
          created_at: media.created_at,
          access_url: `/api/student/exams/${examId}/questions/${q.id}/solution/${media.id}`,
        })),
        question_options: q.question_options.map((opt: any) => ({
          id: opt.id,
          option_label: opt.option_label,
          option_text: opt.option_text ?? "",
          option_order: opt.option_order,
          is_correct: opt.is_correct,
        })),
      };
    });
  }

  const sectionCodes = [...new Set<string>(practiceQuestions.map((q) => q.section_code))];
  const exam_sections = sectionCodes.map((code, idx) => ({
    section_code: code,
    section_order: idx,
    question_count_target: practiceQuestions.filter((q) => q.section_code === code).length,
    default_marks: null,
    default_negative_marks: null,
  }));

  return {
    exam: {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      exam_mode: "PRACTICE" as const,
      duration_seconds: exam.duration_seconds,
      exam_date_time: exam.exam_date_time,
      instructions: exam.instructions,
      batch: exam.batch,
      exam_sections,
    },
    questions: practiceQuestions,
    attempt: null,
    is_practice: true,
    not_ranked: true,
  };
}
