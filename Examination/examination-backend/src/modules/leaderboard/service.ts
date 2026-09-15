import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "../../shared/auth";
import { prisma } from "../../shared/prisma";

type LeaderboardDb = typeof prisma;

type ScopeType = "EXAM" | "BATCH" | "OVERALL";

type LeaderboardActor = AuthenticatedUser;

type AttemptResultRow = Prisma.attempt_resultsGetPayload<{
  include: {
    attempt: {
      include: {
        exam: {
          include: {
            batch: true;
          };
        };
        student: {
          include: {
            user: true;
            batch: true;
          };
        };
      };
    };
  };
}>;

type LeaderboardEntryRow = Prisma.leaderboard_entriesGetPayload<{
  include: {
    attempt: {
      include: {
        exam: {
          include: {
            batch: true;
          };
        };
        student: {
          include: {
            user: true;
            batch: true;
          };
        };
        attempt_result: true;
      };
    };
    student: {
      include: {
        user: true;
        batch: true;
      };
    };
  };
}>;

type StudentLeaderboardEntry = {
  rank: number;
  attempt_id: number;
  student_id: number;
  student_uid: string;
  full_name: string | null;
  batch_id: number;
  batch_name: string;
  score: string;
  percentage: string;
  wrong_count: number;
  correct_count: number;
  submitted_at: Date | null;
  tie_break_value: number | null;
  scoring_source: string | null;
  evaluated_question_paper_version_id: number | null;
  evaluated_question_paper_version_number: number | null;
};

type OverallAggregate = {
  student_id: number;
  attempt_id: number;
  student_uid: string;
  full_name: string | null;
  batch_id: number;
  batch_name: string;
  total_score_sum: Prisma.Decimal;
  max_score_sum: Prisma.Decimal;
  average_percentage: Prisma.Decimal;
  exams_count: number;
  latest_submitted_at_ms: number;
};

function toDecimal(value: string | number | Prisma.Decimal) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

const OFFICIAL_VERSION_SCORING_SOURCE = "QUESTION_PAPER_VERSION";
const OFFICIAL_LEGACY_SCORING_SOURCE = "LEGACY_EXAM_QUESTIONS";

function isOfficialResultRowForExam(row: { scoring_source: string | null }, examHasVersion: boolean) {
  if (examHasVersion) {
    return row.scoring_source === OFFICIAL_VERSION_SCORING_SOURCE;
  }

  return row.scoring_source == null || row.scoring_source === OFFICIAL_LEGACY_SCORING_SOURCE;
}

function isOfficialResultRowForOverall(row: { scoring_source: string | null; examHasVersion: boolean }) {
  return isOfficialResultRowForExam({ scoring_source: row.scoring_source }, row.examHasVersion);
}

function examSortKey(left: AttemptResultRow, right: AttemptResultRow) {
  const leftResult = left;
  const rightResult = right;
  const scoreCompare = rightResult.total_score.comparedTo(leftResult.total_score);
  if (scoreCompare !== 0) return scoreCompare;

  const pctCompare = rightResult.percentage.comparedTo(leftResult.percentage);
  if (pctCompare !== 0) return pctCompare;

  const wrongCompare = leftResult.wrong_count - rightResult.wrong_count;
  if (wrongCompare !== 0) return wrongCompare;

  const correctCompare = rightResult.correct_count - leftResult.correct_count;
  if (correctCompare !== 0) return correctCompare;

  const submittedLeft = leftResult.attempt.submitted_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const submittedRight = rightResult.attempt.submitted_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const submittedCompare = submittedLeft - submittedRight;
  if (submittedCompare !== 0) return submittedCompare;

  return leftResult.attempt_id - rightResult.attempt_id;
}

function examSameRankKey(left: AttemptResultRow, right: AttemptResultRow) {
  return (
    left.total_score.equals(right.total_score) &&
    left.percentage.equals(right.percentage) &&
    left.wrong_count === right.wrong_count &&
    left.correct_count === right.correct_count
  );
}

function overallSortKey(left: OverallAggregate, right: OverallAggregate) {
  const pctCompare = right.average_percentage.comparedTo(left.average_percentage);
  if (pctCompare !== 0) return pctCompare;

  const scoreCompare = right.total_score_sum.comparedTo(left.total_score_sum);
  if (scoreCompare !== 0) return scoreCompare;

  const examsCompare = right.exams_count - left.exams_count;
  if (examsCompare !== 0) return examsCompare;

  return left.student_id - right.student_id;
}

function overallSameRankKey(left: OverallAggregate, right: OverallAggregate) {
  return (
    left.average_percentage.equals(right.average_percentage) &&
    left.total_score_sum.equals(right.total_score_sum) &&
    left.exams_count === right.exams_count
  );
}

function competitionRank<T>(rows: T[], isSameRank: (left: T, right: T) => boolean) {
  const ranks: number[] = [];
  let currentRank = 0;
  let position = 0;
  for (const row of rows) {
    position += 1;
    if (position === 1) {
      currentRank = 1;
    } else if (!isSameRank(rows[position - 2]!, row)) {
      currentRank = position;
    }
    ranks.push(currentRank);
  }
  return ranks;
}

async function loadExamForActor(db: LeaderboardDb, examId: number, actor: LeaderboardActor, requireReleased = true) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      ...(requireReleased ? { status: "RESULT_RELEASED" } : {}),
    },
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
    throw new Error("Exam not found.");
  }
  return exam;
}

async function loadBatch(db: LeaderboardDb, batchId: number) {
  const batch = await db.batches.findFirst({
    where: { id: batchId },
  });
  if (!batch) {
    throw new Error("Batch not found.");
  }
  return batch;
}

function mapLeaderboardEntry(row: AttemptResultRow, rank: number): StudentLeaderboardEntry {
  return {
    rank,
    attempt_id: row.attempt_id,
    student_id: row.attempt.student_id,
    student_uid: row.attempt.student.student_uid,
    full_name: row.attempt.student.user.full_name,
    batch_id: row.attempt.student.batch_id,
    batch_name: row.attempt.student.batch.name,
    score: row.total_score.toString(),
    percentage: row.percentage.toString(),
    wrong_count: row.wrong_count,
    correct_count: row.correct_count,
    submitted_at: row.attempt.submitted_at,
    tie_break_value: row.attempt_id,
    scoring_source: row.scoring_source ?? null,
    evaluated_question_paper_version_id: row.evaluated_question_paper_version_id ?? null,
    evaluated_question_paper_version_number: row.evaluated_question_paper_version_number ?? null,
  };
}

async function upsertLeaderboardScope(db: LeaderboardDb, scopeType: ScopeType, scopeId: number | null, rows: StudentLeaderboardEntry[]) {
  await db.$transaction(async (tx) => {
    await tx.leaderboard_entries.deleteMany({
      where: {
        scope_type: scopeType,
        scope_id: scopeId,
      },
    });

    if (!rows.length) {
      return;
    }

    await tx.leaderboard_entries.createMany({
      data: rows.map((row) => ({
        scope_type: scopeType,
        scope_id: scopeId,
        attempt_id: row.attempt_id,
        student_id: row.student_id,
        rank: row.rank,
        score: new Prisma.Decimal(row.score),
        percentage: new Prisma.Decimal(row.percentage),
        tie_break_value: row.tie_break_value,
      })),
    });

    if (scopeType === "EXAM") {
      for (const row of rows) {
        await tx.attempt_results.update({
          where: {
            attempt_id: row.attempt_id,
          },
          data: {
            rank_exam: row.rank,
          },
        });
      }
    } else if (scopeType === "BATCH") {
      for (const row of rows) {
        await tx.attempt_results.update({
          where: {
            attempt_id: row.attempt_id,
          },
          data: {
            rank_batch: row.rank,
          },
        });
      }
    }
  });
}

function loadAttemptResultFilter(row: AttemptResultRow, examHasVersion: boolean) {
  return isOfficialResultRowForExam(
    {
      scoring_source: row.scoring_source ?? null,
    },
    examHasVersion,
  );
}

async function loadExamResultRows(db: LeaderboardDb, examId: number, batchId?: number) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      status: "RESULT_RELEASED",
    },
    include: {
      batch: true,
      question_paper_version: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!exam) {
    throw new Error("Exam not found.");
  }

  const attempts = await db.attempt_results.findMany({
    where: {
      attempt: {
        exam_id: examId,
        status: {
          in: ["SUBMITTED", "AUTO_SUBMITTED"],
        },
        ...(batchId ? { student: { batch_id: batchId } } : {}),
        exam: {
          status: "RESULT_RELEASED",
        },
      },
    },
    include: {
      attempt: {
        include: {
          student: {
            include: {
              user: true,
              batch: true,
            },
          },
          exam: {
            include: {
              batch: true,
              question_paper_version: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const officialAttempts = attempts.filter((row) => loadAttemptResultFilter(row, Boolean(exam.question_paper_version_id)));
  const sorted = officialAttempts.sort(examSortKey);
  const ranks = competitionRank(sorted, examSameRankKey);
  return {
    exam,
    rows: sorted.map((row, index) => mapLeaderboardEntry(row, ranks[index]!)),
    skipped: attempts.length - officialAttempts.length,
  };
}

/**
 * Loads all official attempt results and aggregates per (student, exam.batch).
 * Each student appears once per batch whose exams they attempted.
 * Within each batch the students are ranked independently.
 *
 * `studentBatchIds` — when provided, only entries for those batches are returned
 * (used by the student-facing overall view to scope to batches they belong to).
 */
async function loadBatchSegmentedAggregates(db: LeaderboardDb, studentBatchIds?: number[]) {
  const rows = await db.attempt_results.findMany({
    where: {
      attempt: {
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
        exam: {
          status: "RESULT_RELEASED",
          // If scoped to specific batches, only pull exams for those batches
          ...(studentBatchIds ? { batch_id: { in: studentBatchIds } } : {}),
        },
      },
    },
    include: {
      attempt: {
        include: {
          student: { include: { user: true, batch: true } },
          exam: {
            include: {
              batch: true,
              question_paper_version: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const officialRows = rows.filter((row) =>
    isOfficialResultRowForOverall({
      scoring_source: row.scoring_source ?? null,
      examHasVersion: Boolean(row.attempt.exam.question_paper_version_id),
    }),
  );

  // Key: `${student_id}:${exam.batch_id}` — each student appears once per batch
  const aggregate = new Map<string, OverallAggregate>();
  let skipped = rows.length - officialRows.length;

  for (const row of officialRows) {
    const examBatchId = row.attempt.exam.batch_id;
    const examBatchName = row.attempt.exam.batch?.name;
    if (!examBatchId || !examBatchName) {
      // Exam has no batch assignment — skip it from batch-segmented standings
      skipped++;
      continue;
    }

    const key = `${row.attempt.student_id}:${examBatchId}`;
    const percentage = toDecimal(row.percentage);
    const current = aggregate.get(key);

    if (!current) {
      aggregate.set(key, {
        student_id: row.attempt.student_id,
        attempt_id: row.attempt_id,
        student_uid: row.attempt.student.student_uid,
        full_name: row.attempt.student.user.full_name,
        batch_id: examBatchId,       // exam's batch, NOT student's home batch
        batch_name: examBatchName,
        total_score_sum: toDecimal(row.total_score),
        max_score_sum: toDecimal(row.max_score),
        average_percentage: percentage,
        exams_count: 1,
        latest_submitted_at_ms: row.attempt.submitted_at?.getTime() ?? 0,
      });
      continue;
    }

    current.total_score_sum = current.total_score_sum.plus(row.total_score);
    current.max_score_sum = current.max_score_sum.plus(row.max_score);
    current.average_percentage = current.average_percentage.plus(percentage);
    current.exams_count += 1;
    const submittedAtMs = row.attempt.submitted_at?.getTime() ?? 0;
    if (submittedAtMs >= current.latest_submitted_at_ms) {
      current.latest_submitted_at_ms = submittedAtMs;
      current.attempt_id = row.attempt_id;
    }
  }

  // Finalise averages, group by batch, rank within each batch independently
  const byBatch = new Map<number, OverallAggregate[]>();
  for (const entry of aggregate.values()) {
    entry.average_percentage = entry.average_percentage.div(entry.exams_count);
    const list = byBatch.get(entry.batch_id) ?? [];
    list.push(entry);
    byBatch.set(entry.batch_id, list);
  }

  const resultRows: Array<StudentLeaderboardEntry & { exams_count: number; max_score_sum: string }> = [];
  for (const batchAggs of byBatch.values()) {
    const sorted = batchAggs.sort(overallSortKey);
    const ranks = competitionRank(sorted, overallSameRankKey);
    sorted.forEach((entry, i) => {
      resultRows.push({
        rank: ranks[i]!,
        attempt_id: entry.attempt_id,
        student_id: entry.student_id,
        student_uid: entry.student_uid,
        full_name: entry.full_name,
        batch_id: entry.batch_id,
        batch_name: entry.batch_name,
        score: entry.total_score_sum.toString(),
        percentage: entry.average_percentage.toString(),
        wrong_count: 0,
        correct_count: 0,
        submitted_at: null,
        tie_break_value: entry.exams_count,
        scoring_source: null,
        evaluated_question_paper_version_id: null,
        evaluated_question_paper_version_number: null,
        exams_count: entry.exams_count,
        max_score_sum: entry.max_score_sum.toString(),
      });
    });
  }

  return { rows: resultRows, skipped };
}

export async function regenerateExamLeaderboard(db: LeaderboardDb, examId: number, actor: LeaderboardActor) {
  const exam = await loadExamForActor(db, examId, actor);
  const leaderboard = await loadExamResultRows(db, exam.id);
  const rows = leaderboard.rows;
  const skipped = leaderboard.skipped;
  await upsertLeaderboardScope(db, "EXAM", exam.id, rows);
  return {
    scope: { type: "EXAM" as const, id: exam.id },
    generated: rows.length,
    skipped,
    exam,
    rows,
  };
}

export async function regenerateBatchLeaderboard(db: LeaderboardDb, examId: number, batchId: number, actor: LeaderboardActor) {
  const exam = await loadExamForActor(db, examId, actor);
  const batch = await loadBatch(db, batchId);
  const leaderboard = await loadExamResultRows(db, exam.id, batch.id);
  const rows = leaderboard.rows;
  const skipped = leaderboard.skipped;
  await upsertLeaderboardScope(db, "BATCH", batch.id, rows);
  return {
    scope: { type: "BATCH" as const, id: batch.id },
    generated: rows.length,
    skipped,
    exam,
    batch,
    rows,
  };
}

export async function regenerateOverallLeaderboard(db: LeaderboardDb, actor: LeaderboardActor) {
  if (actor.role !== "ADMIN" && actor.role !== "TEACHER") {
    throw new Error("Insufficient role permissions.");
  }

  const rowsPayload = await loadBatchSegmentedAggregates(db);
  const rows = rowsPayload.rows;
  const skipped = rowsPayload.skipped;
  // Pre-computed OVERALL entries are kept for legacy; live GET endpoints now
  // query fresh from loadBatchSegmentedAggregates so this cache is best-effort.
  await db.$transaction(async (tx) => {
    await tx.leaderboard_entries.deleteMany({
      where: { scope_type: "OVERALL", scope_id: null },
    });
    if (!rows.length) return;
    await tx.leaderboard_entries.createMany({
      data: rows.map((row) => ({
        scope_type: "OVERALL",
        scope_id: null,
        attempt_id: row.attempt_id,
        student_id: row.student_id,
        rank: row.rank,
        score: new Prisma.Decimal(row.score),
        percentage: new Prisma.Decimal(row.percentage),
        tie_break_value: row.tie_break_value,
      })),
    });
  });

  return {
    scope: { type: "OVERALL" as const, id: null },
    generated: rows.length,
    skipped,
    rows,
  };
}

async function loadScopeEntries(db: LeaderboardDb, scopeType: ScopeType, scopeId: number | null) {
  const entries = await db.leaderboard_entries.findMany({
    where: {
      scope_type: scopeType,
      scope_id: scopeId,
    },
    include: {
      attempt: {
        include: {
          exam: {
            include: {
              batch: true,
              question_paper_version: {
                select: {
                  id: true,
                },
              },
            },
          },
          attempt_result: true,
        },
      },
      student: {
        include: {
          user: true,
          batch: true,
        },
      },
    },
    orderBy: [
      { rank: "asc" },
      { score: "desc" },
      { percentage: "desc" },
      { id: "asc" },
    ],
  });

  const officialEntries = entries.filter((entry) =>
    entry.attempt.exam.status === "RESULT_RELEASED" &&
    entry.attempt.attempt_result
      ? isOfficialResultRowForExam(
          {
            scoring_source: entry.attempt.attempt_result.scoring_source ?? null,
          },
          Boolean(entry.attempt.exam.question_paper_version_id),
        )
      : false,
  );

  return officialEntries.map((entry) => {
    // For exam-scoped entries, the batch shown should be the exam's batch (all students
    // in this leaderboard took the same exam → same batch label). For overall/batch scopes
    // use the student's primary enrollment batch.
    const useExamBatch = scopeType === "EXAM" && entry.attempt.exam.batch != null;
    const batchId   = useExamBatch ? entry.attempt.exam.batch!.id   : entry.student.batch_id;
    const batchName = useExamBatch ? entry.attempt.exam.batch!.name : entry.student.batch.name;

    return {
      rank: entry.rank,
      attempt_id: entry.attempt_id,
      student_id: entry.student_id,
      student_uid: entry.student.student_uid,
      full_name: entry.student.user.full_name,
      batch_id: batchId,
      batch_name: batchName,
      score: entry.score.toString(),
      percentage: entry.percentage.toString(),
      tie_break_value: entry.tie_break_value,
      scoring_source: entry.attempt.attempt_result?.scoring_source ?? null,
      evaluated_question_paper_version_id: entry.attempt.attempt_result?.evaluated_question_paper_version_id ?? null,
      evaluated_question_paper_version_number: entry.attempt.attempt_result?.evaluated_question_paper_version_number ?? null,
      exam: {
        id: entry.attempt.exam.id,
        title: entry.attempt.exam.title,
        status: entry.attempt.exam.status,
        exam_mode: entry.attempt.exam.exam_mode,
        batch_name: entry.attempt.exam.batch?.name ?? null,
        question_paper_version_id: entry.attempt.exam.question_paper_version_id ?? null,
      },
    };
  });
}

export async function getExamLeaderboard(db: LeaderboardDb, examId: number, actor: LeaderboardActor) {
  const exam = await loadExamForActor(db, examId, actor);
  const leaderboard = await loadScopeEntries(db, "EXAM", exam.id);
  return {
    scope: { type: "EXAM" as const, id: exam.id },
    exam,
    leaderboard,
    generated: leaderboard.length,
  };
}

export async function getBatchLeaderboard(db: LeaderboardDb, examId: number, batchId: number, actor: LeaderboardActor) {
  const exam = await loadExamForActor(db, examId, actor);
  const batch = await loadBatch(db, batchId);
  const leaderboard = await loadScopeEntries(db, "BATCH", batch.id);
  return {
    scope: { type: "BATCH" as const, id: batch.id },
    exam,
    batch,
    leaderboard,
    generated: leaderboard.length,
  };
}

export async function getOverallLeaderboard(db: LeaderboardDb, actor: LeaderboardActor) {
  if (actor.role !== "ADMIN" && actor.role !== "TEACHER") {
    throw new Error("Insufficient role permissions.");
  }

  // Compute fresh: per-(student, exam-batch) aggregates so batch tabs are correct
  const { rows } = await loadBatchSegmentedAggregates(db);
  return {
    scope: { type: "OVERALL" as const, id: null },
    leaderboard: rows,
    generated: rows.length,
  };
}

export async function getStudentLeaderboard(db: LeaderboardDb, actor: LeaderboardActor, scope: "exam" | "batch" | "overall", examId?: number, batchId?: number) {
  const student = await db.student_profiles.findFirst({
    where: {
      user_id: actor.id,
      active: true,
    },
    include: {
      batch: true,
      batch_memberships: {
        select: {
          batch_id: true,
        },
      },
    },
  });
  if (!student) {
    throw new Error("Student profile not found.");
  }

  const studentBatchIds = Array.from(new Set([student.batch_id, ...student.batch_memberships.map((membership) => membership.batch_id)]));

  if (scope === "exam") {
    if (!examId) {
      throw new Error("examId is required for exam leaderboard.");
    }
    const exam = await db.exams.findFirst({
      where: {
        id: examId,
        status: "RESULT_RELEASED",
        exam_assignments: {
          some: {
            OR: [
              { batch_id: { in: studentBatchIds } },
              { student_uid: student.student_uid },
            ],
          },
        },
      },
      include: {
        batch: true,
      },
    });
    if (!exam) {
      throw new Error("Leaderboard not available yet.");
    }
    const leaderboard = await loadScopeEntries(db, "EXAM", exam.id);
    return {
      scope: { type: "EXAM" as const, id: exam.id },
      exam,
      leaderboard,
      viewer_student_id: student.id,
    };
  }

  if (scope === "batch") {
    if (!examId || !batchId) {
      throw new Error("examId and batchId are required for batch leaderboard.");
    }
    const exam = await db.exams.findFirst({
      where: {
        id: examId,
        status: "RESULT_RELEASED",
      },
      include: {
        batch: true,
      },
    });
    if (!exam || exam.batch_id !== batchId) {
      throw new Error("Leaderboard not available yet.");
    }
    const leaderboard = await loadScopeEntries(db, "BATCH", batchId);
    return {
      scope: { type: "BATCH" as const, id: batchId },
      exam,
      leaderboard,
      viewer_student_id: student.id,
    };
  }

  // Load ALL batches so students can see the full cross-class leaderboard.
  const { rows } = await loadBatchSegmentedAggregates(db);
  return {
    scope: { type: "OVERALL" as const, id: null },
    leaderboard: rows,
    viewer_student_id: student.id,
  };
}
