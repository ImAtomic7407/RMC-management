import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "../../shared/auth";
import { prisma } from "../../shared/prisma";

type PracticeDb = typeof prisma;

const SECTION_ORDER: Array<"PHYSICS" | "CHEMISTRY" | "MATHS"> = ["PHYSICS", "CHEMISTRY", "MATHS"];

type StudentProfileRow = {
  id: number;
  student_uid: string;
  batch_id: number;
  user: {
    full_name: string | null;
  };
  batch: {
    id: number;
    name: string;
    active: boolean;
  };
};

type PracticePaperRow = Prisma.question_papersGetPayload<{
  include: {
    batch: true;
    sections: {
      orderBy: {
        section_order: "asc";
      };
    };
    questions: {
      where: {
        is_active: true;
      };
      orderBy: [
        {
          section_code: "asc";
        },
        {
          question_order: "asc";
        },
      ];
      include: {
        options: {
          orderBy: {
            option_order: "asc";
          };
        };
        media: {
          orderBy: [
            {
              purpose: "asc";
            },
            {
              sort_order: "asc";
            },
            {
              created_at: "asc";
            },
          ];
        };
      };
    };
  };
}>;

type PracticeVersionRow = Prisma.question_paper_versionsGetPayload<{
  include: {
    sections: {
      orderBy: {
        section_order: "asc";
      };
    };
    questions: {
      orderBy: [
        {
          section_code: "asc";
        },
        {
          question_order: "asc";
        },
      ];
      include: {
        options: {
          orderBy: {
            option_order: "asc";
          };
        };
        media: {
          orderBy: [
            {
              purpose: "asc";
            },
            {
              sort_order: "asc";
            },
            {
              created_at: "asc";
            },
          ];
        };
      };
    };
  };
}>;

type PracticeAttemptRow = Prisma.practice_attemptsGetPayload<{
  include: {
    practice_question_paper: {
      include: {
        batch: true;
      };
    };
    practice_question_paper_version: {
      include: {
        sections: {
          orderBy: {
            section_order: "asc";
          };
        };
        questions: {
          orderBy: [
            {
              section_code: "asc";
            },
            {
              question_order: "asc";
            },
          ];
          include: {
            options: {
              orderBy: {
                option_order: "asc";
              };
            };
            media: {
              orderBy: [
                {
                  purpose: "asc";
                },
                {
                  sort_order: "asc";
                },
                {
                  created_at: "asc";
                },
              ];
            };
          };
        };
      };
    };
    attempt_answers: {
      orderBy: {
        saved_at: "asc";
      };
    };
    attempt_result: true;
    attempt_section_results: true;
  };
}>;

type PracticeAnswerRow = PracticeAttemptRow["attempt_answers"][number];

function sectionLabel(sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS") {
  switch (sectionCode) {
    case "PHYSICS":
      return "Physics";
    case "CHEMISTRY":
      return "Chemistry";
    case "MATHS":
      return "Maths";
  }
}

function percentageFrom(totalScore: Prisma.Decimal, maxScore: Prisma.Decimal) {
  if (maxScore.equals(0)) {
    return "0.00";
  }
  return totalScore.mul(100).div(maxScore).toFixed(2);
}

function canonicalizeIntegerAnswer(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new Error("Invalid integer answer.");
  }

  let body = trimmed;
  let negative = false;
  if (body.startsWith("+") || body.startsWith("-")) {
    negative = body.startsWith("-");
    body = body.slice(1);
  }

  body = body.replace(/^0+/, "");
  if (!body) {
    body = "0";
  }

  if (body === "0") {
    return "0";
  }

  return negative ? `-${body}` : body;
}

function emptySection(sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS") {
  return {
    section_code: sectionCode,
    score: new Prisma.Decimal(0),
    max_score: new Prisma.Decimal(0),
    correct_count: 0,
    wrong_count: 0,
    unattempted_count: 0,
  };
}

function sortSections<T extends { section_code: "PHYSICS" | "CHEMISTRY" | "MATHS" }>(sections: T[]) {
  return [...sections].sort((left, right) => SECTION_ORDER.indexOf(left.section_code) - SECTION_ORDER.indexOf(right.section_code));
}

function buildSectionTotals(sectionCodes: Array<"PHYSICS" | "CHEMISTRY" | "MATHS"> = SECTION_ORDER) {
  return new Map<"PHYSICS" | "CHEMISTRY" | "MATHS", ReturnType<typeof emptySection>>(
    sectionCodes.map((sectionCode) => [sectionCode, emptySection(sectionCode)]),
  );
}

function validateQuestionPaperPracticeSettings(paper: PracticePaperRow) {
  if (paper.status === "ARCHIVED") {
    throw new Error("Archived question papers cannot be used for practice.");
  }
  if (!paper.is_self_practice_enabled) {
    throw new Error("Self-practice is not enabled for this paper.");
  }
  if (!paper.questions.length) {
    throw new Error("Practice paper must contain at least one active question.");
  }
}

function mapPracticePaperSummary(
  paper: PracticePaperRow,
  studentAttempt?: {
    id: number;
    status: "IN_PROGRESS" | "SUBMITTED" | "AUTO_SUBMITTED" | "EXPIRED" | "CANCELLED";
    started_at: Date;
    ends_at: Date | null;
    submitted_at: Date | null;
  } | null,
) {
  return {
    paper_id: paper.id,
    title: paper.title,
    category: paper.category,
    batch_id: paper.batch_id,
    batch_name: paper.batch?.name ?? null,
    is_self_practice_enabled: paper.is_self_practice_enabled,
    duration_seconds: paper.self_practice_duration_seconds ?? null,
    solution_policy: paper.self_practice_solution_policy ?? "AFTER_SUBMIT",
    not_ranked: true,
    section_count: paper.sections.length,
    total_question_count: paper.questions.length,
    sections: paper.sections.map((section) => ({
      section_code: section.section_code,
      section_title: sectionLabel(section.section_code),
      section_order: section.section_order,
      question_count_target: section.question_count_target,
      default_marks: section.default_marks.toString(),
      default_negative_marks: section.default_negative_marks.toString(),
      question_count: paper.questions.filter((question) => question.section_code === section.section_code).length,
    })),
    current_attempt: studentAttempt
      ? {
          attempt_id: studentAttempt.id,
          status: studentAttempt.status,
          started_at: studentAttempt.started_at,
          ends_at: studentAttempt.ends_at,
          submitted_at: studentAttempt.submitted_at,
        }
      : null,
  };
}

function mapQuestionMediaForLive(
  attemptId: number,
  versionQuestionId: number,
  media: {
    id: number;
    purpose: "QUESTION" | "SOLUTION";
    mime_type: string;
    width: number | null;
    height: number | null;
    sort_order: number;
    created_at: Date;
  },
) {
  return {
    id: media.id,
    purpose: "QUESTION" as const,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    created_at: media.created_at,
    url: `/api/student/practice/attempts/${attemptId}/questions/${versionQuestionId}/media/${media.id}`,
  };
}

function mapSolutionMediaForReview(
  attemptId: number,
  versionQuestionId: number,
  media: {
    id: number;
    purpose: "QUESTION" | "SOLUTION";
    mime_type: string;
    width: number | null;
    height: number | null;
    sort_order: number;
    created_at: Date;
  },
) {
  return {
    id: media.id,
    purpose: "SOLUTION" as const,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    created_at: media.created_at,
    url: `/api/student/practice/results/${attemptId}/review/questions/${versionQuestionId}/solution/${media.id}`,
  };
}

function mapQuestionMediaForReview(
  attemptId: number,
  versionQuestionId: number,
  media: {
    id: number;
    purpose: "QUESTION" | "SOLUTION";
    mime_type: string;
    width: number | null;
    height: number | null;
    sort_order: number;
    created_at: Date;
  },
) {
  return {
    id: media.id,
    purpose: "QUESTION" as const,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    created_at: media.created_at,
    url: `/api/student/practice/results/${attemptId}/review/questions/${versionQuestionId}/media/${media.id}`,
  };
}

function mapLiveQuestion(
  attemptId: number,
  question: PracticeVersionRow["questions"][number],
  savedAnswer?: PracticeAnswerRow | null,
) {
  return {
    version_question_id: question.id,
    section_code: question.section_code,
    question_type: question.question_type,
    question_order: question.question_order,
    question_text: question.question_text,
    marks: question.marks.toString(),
    negative_marks: question.negative_marks.toString(),
    question_media: question.media
      .filter((media) => media.purpose === "QUESTION")
      .map((media) => mapQuestionMediaForLive(attemptId, question.id, media)),
    options: question.options.map((option) => ({
      version_option_id: option.id,
      option_label: option.option_label,
      option_text: option.option_text ?? "",
      option_order: option.option_order,
    })),
    saved_answer: savedAnswer
      ? {
          selected_option_id: savedAnswer.selected_option_id ?? null,
          integer_answer: savedAnswer.integer_answer ?? null,
          is_marked_for_review: savedAnswer.is_marked_for_review,
        }
      : null,
  };
}

function mapStudentAnswerForReview(question: PracticeVersionRow["questions"][number], answer: PracticeAnswerRow | null) {
  if (!answer) {
    return {
      selected_option_label: null as string | null,
      selected_option_id: null as number | null,
      integer_answer: null as string | null,
    };
  }

  if (question.question_type === "MCQ") {
    const selected = question.options.find((option) => option.id === answer.selected_option_id);
    return {
      selected_option_label: selected?.option_label ?? null,
      selected_option_id: answer.selected_option_id ?? null,
      integer_answer: null,
    };
  }

  return {
    selected_option_label: null,
    selected_option_id: null,
    integer_answer: answer.integer_answer ?? null,
  };
}

function mapCorrectAnswerForReview(question: PracticeVersionRow["questions"][number], revealCorrectAnswer: boolean) {
  if (!revealCorrectAnswer) {
    return {
      correct_option_label: null as string | null,
      correct_option_id: null as number | null,
      correct_integer_answer: null as string | null,
    };
  }

  if (question.question_type === "MCQ") {
    const correct = question.options.find((option) => option.is_correct) ?? null;
    return {
      correct_option_label: correct?.option_label ?? null,
      correct_option_id: correct?.id ?? null,
      correct_integer_answer: null,
    };
  }

  return {
    correct_option_label: null,
    correct_option_id: null,
    correct_integer_answer: question.correct_integer_answer ?? null,
  };
}

function scorePracticeQuestion(
  question: PracticeVersionRow["questions"][number],
  answer: PracticeAnswerRow | null,
) {
  if (question.question_type === "MCQ") {
    if (!answer?.selected_option_id) {
      return {
        score: new Prisma.Decimal(0),
        correct: false,
        wrong: false,
        unattempted: true,
      };
    }
    const selected = question.options.find((option) => option.id === answer.selected_option_id);
    if (!selected) {
      return {
        score: question.negative_marks.mul(-1),
        correct: false,
        wrong: true,
        unattempted: false,
      };
    }
    if (selected.is_correct) {
      return {
        score: question.marks,
        correct: true,
        wrong: false,
        unattempted: false,
      };
    }
    return {
      score: question.negative_marks.mul(-1),
      correct: false,
      wrong: true,
      unattempted: false,
    };
  }

  const submitted = canonicalizeIntegerAnswer(answer?.integer_answer ?? null);
  const expected = canonicalizeIntegerAnswer(question.correct_integer_answer ?? null);
  if (!submitted) {
    return {
      score: new Prisma.Decimal(0),
      correct: false,
      wrong: false,
      unattempted: true,
    };
  }
  if (!expected) {
    return {
      score: question.negative_marks.mul(-1),
      correct: false,
      wrong: true,
      unattempted: false,
    };
  }
  if (submitted === expected) {
    return {
      score: question.marks,
      correct: true,
      wrong: false,
      unattempted: false,
    };
  }
  return {
    score: question.negative_marks.mul(-1),
    correct: false,
    wrong: true,
    unattempted: false,
  };
}

async function loadStudentProfile(db: PracticeDb, userId: number): Promise<StudentProfileRow> {
  const student = await db.student_profiles.findFirst({
    where: {
      user_id: userId,
      active: true,
    },
    select: {
      id: true,
      student_uid: true,
      batch_id: true,
      user: {
        select: {
          full_name: true,
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

async function loadPracticePaperForStudent(db: PracticeDb, paperId: number, student: StudentProfileRow) {
  const paper = await db.question_papers.findFirst({
    where: {
      id: paperId,
      is_self_practice_enabled: true,
      status: {
        not: "ARCHIVED",
      },
      OR: [{ batch_id: null }, { batch_id: student.batch_id }],
    },
    include: {
      batch: true,
      sections: {
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
  });

  if (!paper) {
    throw new Error("Practice paper not found.");
  }
  validateQuestionPaperPracticeSettings(paper);
  return paper as PracticePaperRow;
}

async function loadPracticeAttempt(db: PracticeDb, attemptId: number, student: StudentProfileRow) {
  const attempt = await db.practice_attempts.findFirst({
    where: {
      id: attemptId,
      student_id: student.id,
    },
    include: {
      practice_question_paper: {
        include: {
          batch: true,
        },
      },
      practice_question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
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
      attempt_answers: {
        orderBy: {
          saved_at: "asc",
        },
      },
      attempt_result: true,
      attempt_section_results: true,
    },
  });

  if (!attempt) {
    throw new Error("Practice attempt not found.");
  }

  return attempt as PracticeAttemptRow;
}

async function loadPracticeAttemptById(db: PracticeDb, attemptId: number) {
  const attempt = await db.practice_attempts.findUnique({
    where: {
      id: attemptId,
    },
    include: {
      practice_question_paper: {
        include: {
          batch: true,
        },
      },
      practice_question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
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
      attempt_answers: {
        orderBy: {
          saved_at: "asc",
        },
      },
      attempt_result: true,
      attempt_section_results: true,
    },
  });

  if (!attempt) {
    throw new Error("Practice attempt not found.");
  }

  return attempt as PracticeAttemptRow;
}

async function loadCurrentPracticeAttempt(db: PracticeDb, paperId: number, studentId: number) {
  return db.practice_attempts.findFirst({
    where: {
      practice_question_paper_id: paperId,
      student_id: studentId,
      status: "IN_PROGRESS",
    },
    orderBy: {
      created_at: "desc",
    },
  });
}

async function createPracticeVersionSnapshot(db: Prisma.TransactionClient, paper: PracticePaperRow, actorId: number) {
  const latestVersion = await db.question_paper_versions.findFirst({
    where: {
      question_paper_id: paper.id,
    },
    orderBy: {
      version_number: "desc",
    },
    select: {
      version_number: true,
    },
  });

  const version = await db.question_paper_versions.create({
    data: {
      question_paper_id: paper.id,
      version_number: (latestVersion?.version_number ?? 0) + 1,
      title_snapshot: paper.title,
      instructions_snapshot: paper.instructions,
      created_from_status: paper.status,
      created_by: actorId,
    },
  });

  await db.question_paper_version_sections.createMany({
    data: paper.sections.map((section) => ({
      version_id: version.id,
      section_code: section.section_code,
      section_order: section.section_order,
      question_count_target: section.question_count_target,
      default_marks: section.default_marks,
      default_negative_marks: section.default_negative_marks,
    })),
  });

  for (const sourceQuestion of paper.questions) {
    const versionQuestion = await db.question_paper_version_questions.create({
      data: {
        version_id: version.id,
        original_question_id: sourceQuestion.id,
        section_code: sourceQuestion.section_code,
        question_type: sourceQuestion.question_type,
        question_order: sourceQuestion.question_order,
        question_text: sourceQuestion.question_text,
        correct_integer_answer: sourceQuestion.correct_integer_answer,
        marks: sourceQuestion.marks,
        negative_marks: sourceQuestion.negative_marks,
        is_active_snapshot: sourceQuestion.is_active,
      },
    });

    if (sourceQuestion.question_type === "MCQ") {
      await db.question_paper_version_options.createMany({
        data: sourceQuestion.options.map((option) => ({
          version_question_id: versionQuestion.id,
          original_option_id: option.id,
          option_label: option.option_label,
          option_text: option.option_text,
          option_order: option.option_order,
          is_correct: option.is_correct,
        })),
      });
    }

    if (sourceQuestion.media.length > 0) {
      await db.question_paper_version_media.createMany({
        data: sourceQuestion.media.map((media) => ({
          version_question_id: versionQuestion.id,
          original_media_id: media.id,
          purpose: media.purpose,
          storage_url: media.storage_url,
          mime_type: media.mime_type,
          checksum: media.checksum,
          width: media.width,
          height: media.height,
          sort_order: media.sort_order,
        })),
      });
    }
  }

  return db.question_paper_versions.findUniqueOrThrow({
    where: {
      id: version.id,
    },
    include: {
      sections: {
        orderBy: {
          section_order: "asc",
        },
      },
      questions: {
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
  }) as Promise<PracticeVersionRow>;
}

function mapPracticeAttemptPayload(attempt: PracticeAttemptRow) {
  const version = attempt.practice_question_paper_version;
  if (!version) {
    throw new Error("Practice attempt version not found.");
  }

  const answersByQuestionId = new Map(attempt.attempt_answers.map((answer) => [answer.version_question_id, answer]));

  return {
    attempt: {
      id: attempt.id,
      attempt_context: attempt.attempt_context,
      status: attempt.status,
      counts_for_leaderboard: attempt.counts_for_leaderboard,
      counts_for_official_result: attempt.counts_for_official_result,
      started_at: attempt.started_at,
      ends_at: attempt.ends_at,
      submitted_at: attempt.submitted_at,
      is_auto_submitted: attempt.is_auto_submitted,
      solution_policy_snapshot: attempt.solution_policy_snapshot,
      duration_seconds_snapshot: attempt.duration_seconds_snapshot,
      practice_question_paper_id: attempt.practice_question_paper_id,
      practice_question_paper_version_id: attempt.practice_question_paper_version_id,
    practice_question_paper_version_number: version.version_number,
      paper: {
        id: attempt.practice_question_paper.id,
        title: version.title_snapshot,
        category: attempt.practice_question_paper.category,
        batch_id: attempt.practice_question_paper.batch_id,
        batch_name: attempt.practice_question_paper.batch?.name ?? null,
        not_ranked: true,
      },
      sections: version.sections.map((section) => ({
        section_code: section.section_code,
        section_title: sectionLabel(section.section_code),
        section_order: section.section_order,
        question_count_target: section.question_count_target,
        default_marks: section.default_marks.toString(),
        default_negative_marks: section.default_negative_marks.toString(),
      })),
    },
    questions: version.questions.map((question) => mapLiveQuestion(attempt.id, question, answersByQuestionId.get(question.id) ?? null)),
  };
}

function buildPracticeResultSummary(attempt: PracticeAttemptRow) {
  const result = attempt.attempt_result;
  if (!result) {
    throw new Error("Practice result not found.");
  }

  return {
    attempt_id: attempt.id,
    paper: {
      id: attempt.practice_question_paper.id,
      title: attempt.practice_question_paper_version.title_snapshot,
      category: attempt.practice_question_paper.category,
      batch_id: attempt.practice_question_paper.batch_id,
      batch_name: attempt.practice_question_paper.batch?.name ?? null,
      not_ranked: true,
    },
    practice_question_paper_id: attempt.practice_question_paper_id,
    practice_question_paper_version_id: attempt.practice_question_paper_version_id,
    practice_question_paper_version_number: attempt.practice_question_paper_version.version_number,
    attempt_context: attempt.attempt_context,
    counts_for_leaderboard: attempt.counts_for_leaderboard,
    counts_for_official_result: attempt.counts_for_official_result,
    not_ranked: true,
    status: attempt.status,
    started_at: attempt.started_at,
    ends_at: attempt.ends_at,
    submitted_at: attempt.submitted_at,
    total_score: result.total_score.toString(),
    max_score: result.max_score.toString(),
    percentage: result.percentage.toString(),
    correct_count: result.correct_count,
    wrong_count: result.wrong_count,
    unattempted_count: result.unattempted_count,
    evaluated_question_paper_version_id: result.evaluated_question_paper_version_id ?? null,
    evaluated_question_paper_version_number: result.evaluated_question_paper_version_number ?? null,
    scoring_source: result.scoring_source ?? null,
    sections: attempt.attempt_section_results
      .slice()
      .sort((left, right) => SECTION_ORDER.indexOf(left.section_code) - SECTION_ORDER.indexOf(right.section_code))
      .map((section) => ({
        section_code: section.section_code,
        section_title: sectionLabel(section.section_code),
        score: section.score.toString(),
        max_score: section.max_score.toString(),
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
      })),
  };
}

async function recalculatePracticeAttemptResult(db: PracticeDb, attemptId: number) {
  const attempt = await loadPracticeAttemptById(db, attemptId);

  const version = attempt.practice_question_paper_version;
  if (!version) {
    throw new Error("Practice version not found.");
  }

  const answerMap = new Map<number, PracticeAnswerRow>();
  for (const answer of attempt.attempt_answers) {
    answerMap.set(answer.version_question_id, answer);
  }

  const sectionTotals = buildSectionTotals(version.sections.map((section) => section.section_code));
  let totalScore = new Prisma.Decimal(0);
  let maxScore = new Prisma.Decimal(0);
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  for (const question of version.questions) {
    if (!question.is_active_snapshot) {
      continue;
    }

    const section = sectionTotals.get(question.section_code)!;
    section.max_score = section.max_score.plus(question.marks);
    maxScore = maxScore.plus(question.marks);

    const evaluation = scorePracticeQuestion(question, answerMap.get(question.id) ?? null);
    section.score = section.score.plus(evaluation.score);
    totalScore = totalScore.plus(evaluation.score);

    if (evaluation.correct) {
      section.correct_count += 1;
      correctCount += 1;
    } else if (evaluation.wrong) {
      section.wrong_count += 1;
      wrongCount += 1;
    } else {
      section.unattempted_count += 1;
      unattemptedCount += 1;
    }
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.practice_attempt_section_results.deleteMany({
      where: {
        practice_attempt_id: attempt.id,
      },
    });
    await tx.practice_attempt_results.deleteMany({
      where: {
        practice_attempt_id: attempt.id,
      },
    });

    await tx.practice_attempt_section_results.createMany({
      data: sortSections(Array.from(sectionTotals.values())).map((section) => ({
        practice_attempt_id: attempt.id,
        section_code: section.section_code,
        score: section.score,
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
        max_score: section.max_score,
      })),
    });

    await tx.practice_attempt_results.create({
      data: {
        practice_attempt_id: attempt.id,
        total_score: totalScore,
        max_score: maxScore,
        percentage: new Prisma.Decimal(percentageFrom(totalScore, maxScore)),
        correct_count: correctCount,
        wrong_count: wrongCount,
        unattempted_count: unattemptedCount,
        result_released_at: now,
        evaluated_question_paper_version_id: attempt.practice_question_paper_version_id,
        evaluated_question_paper_version_number: attempt.practice_question_paper_version.version_number,
        scoring_source: "SELF_PRACTICE_VERSION",
      },
    });
  });

  return loadPracticeAttemptById(db, attempt.id);
}

export async function listStudentPracticePapers(db: PracticeDb, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const papers = await db.question_papers.findMany({
    where: {
      is_self_practice_enabled: true,
      status: {
        not: "ARCHIVED",
      },
      OR: [{ batch_id: null }, { batch_id: student.batch_id }],
    },
    include: {
      batch: true,
      sections: {
        orderBy: {
          section_order: "asc",
        },
      },
      questions: {
        where: {
          is_active: true,
        },
        select: {
          id: true,
          section_code: true,
        },
      },
    },
    orderBy: {
      updated_at: "desc",
    },
  });

  const attempts = await Promise.all(
    papers.map((paper) =>
      db.practice_attempts.findFirst({
        where: {
          practice_question_paper_id: paper.id,
          student_id: student.id,
          status: "IN_PROGRESS",
        },
        orderBy: {
          created_at: "desc",
        },
        select: {
          id: true,
          status: true,
          started_at: true,
          ends_at: true,
          submitted_at: true,
        },
      }),
    ),
  );

  return {
    student,
    papers: papers.map((paper, index) => mapPracticePaperSummary(paper as PracticePaperRow, attempts[index])),
  };
}

export async function startOrResumeStudentPractice(db: PracticeDb, paperId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const existing = await loadCurrentPracticeAttempt(db, paperId, student.id);

  if (existing) {
    const attempt = await loadPracticeAttempt(db, existing.id, student);
    if (attempt.status === "IN_PROGRESS" && attempt.ends_at && attempt.ends_at <= new Date()) {
      await db.practice_attempts.update({
        where: {
          id: attempt.id,
        },
        data: {
          status: "EXPIRED",
        },
      });
      throw new Error("Your practice attempt has expired.");
    }
    return {
      status: "resumed" as const,
      paper: {
        id: attempt.practice_question_paper.id,
        title: attempt.practice_question_paper_version.title_snapshot,
        category: attempt.practice_question_paper.category,
        batch_id: attempt.practice_question_paper.batch_id,
        batch_name: attempt.practice_question_paper.batch?.name ?? null,
        is_self_practice_enabled: true,
        duration_seconds: attempt.duration_seconds_snapshot ?? null,
        solution_policy: attempt.solution_policy_snapshot,
        not_ranked: true,
      },
      practice: mapPracticeAttemptPayload(attempt),
    };
  }

  const paper = await loadPracticePaperForStudent(db, paperId, student);
  const startedAt = new Date();
  const durationSeconds = paper.self_practice_duration_seconds ?? null;
  const endsAt = durationSeconds ? new Date(startedAt.getTime() + durationSeconds * 1000) : null;

  const created = await db.$transaction(async (tx) => {
    const version = await createPracticeVersionSnapshot(tx, paper, actor.id);
    const attempt = await tx.practice_attempts.create({
      data: {
        student_id: student.id,
        practice_question_paper_id: paper.id,
        practice_question_paper_version_id: version.id,
        attempt_context: "SELF_PRACTICE",
        counts_for_leaderboard: false,
        counts_for_official_result: false,
        duration_seconds_snapshot: durationSeconds,
        solution_policy_snapshot: paper.self_practice_solution_policy ?? "AFTER_SUBMIT",
        status: "IN_PROGRESS",
        started_at: startedAt,
        ends_at: endsAt,
        is_auto_submitted: false,
        server_time_offset_ms: 0,
      },
    });

    return {
      attempt,
    };
  });

  const attempt = await loadPracticeAttempt(db, created.attempt.id, student);
  return {
    status: "started" as const,
    paper: {
      id: paper.id,
      title: attempt.practice_question_paper_version.title_snapshot,
      category: paper.category,
      batch_id: paper.batch_id,
      batch_name: paper.batch?.name ?? null,
      is_self_practice_enabled: true,
      duration_seconds: durationSeconds,
      solution_policy: paper.self_practice_solution_policy ?? "AFTER_SUBMIT",
      not_ranked: true,
    },
    practice: mapPracticeAttemptPayload(attempt),
  };
}

export async function getStudentPracticeAttempt(db: PracticeDb, attemptId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);
  if (attempt.status === "IN_PROGRESS" && attempt.ends_at && attempt.ends_at <= new Date()) {
    await db.practice_attempts.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "EXPIRED",
      },
    });
    throw new Error("Your practice attempt has expired.");
  }

  return {
    practice: mapPracticeAttemptPayload(attempt),
  };
}

export async function saveStudentPracticeAnswer(
  db: PracticeDb,
  attemptId: number,
  actor: AuthenticatedUser,
  input: {
    question_id: number;
    selected_option_id?: number;
    integer_answer?: string;
    is_marked_for_review?: boolean;
  },
) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);
  if (attempt.status !== "IN_PROGRESS") {
    throw new Error("Practice attempt is not active.");
  }
  if (attempt.ends_at && attempt.ends_at <= new Date()) {
    await db.practice_attempts.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "EXPIRED",
      },
    });
    throw new Error("Your practice attempt has expired.");
  }

  const version = attempt.practice_question_paper_version;
  const versionQuestion = version.questions.find((question) => question.id === input.question_id);
  if (!versionQuestion) {
    throw new Error("Question not found.");
  }

  let selectedOptionId: number | null = null;
  let integerAnswer: string | null = null;

  if (versionQuestion.question_type === "MCQ") {
    if (input.selected_option_id === undefined) {
      throw new Error("selected_option_id is required for MCQ questions.");
    }
    const option = versionQuestion.options.find((entry) => entry.id === input.selected_option_id);
    if (!option) {
      throw new Error("Selected option does not belong to this question.");
    }
    selectedOptionId = option.id;
  } else {
    if (input.integer_answer === undefined) {
      throw new Error("integer_answer is required for integer questions.");
    }
    integerAnswer = canonicalizeIntegerAnswer(input.integer_answer);
  }

  const now = new Date();
  const saved = await db.practice_attempt_answers.upsert({
    where: {
      practice_attempt_id_version_question_id: {
        practice_attempt_id: attempt.id,
        version_question_id: versionQuestion.id,
      },
    },
    create: {
      practice_attempt_id: attempt.id,
      version_question_id: versionQuestion.id,
      selected_option_id: selectedOptionId,
      integer_answer: integerAnswer,
      is_marked_for_review: input.is_marked_for_review ?? false,
      saved_at: now,
    },
    update: {
      selected_option_id: selectedOptionId,
      integer_answer: integerAnswer,
      is_marked_for_review: input.is_marked_for_review ?? false,
      saved_at: now,
    },
  });

  return {
    saved,
    practice_question_id: input.question_id,
  };
}

export async function submitStudentPracticeAttempt(db: PracticeDb, attemptId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);

  if (attempt.status !== "IN_PROGRESS") {
    return {
      status: attempt.status,
      attempt: mapPracticeAttemptPayload(attempt),
      result: attempt.attempt_result,
    };
  }

  const now = new Date();
  const nextStatus = attempt.ends_at && attempt.ends_at <= now ? "AUTO_SUBMITTED" : "SUBMITTED";
  const updatedAttempt = await db.practice_attempts.update({
    where: {
      id: attempt.id,
    },
    data: {
      status: nextStatus,
      submitted_at: now,
      is_auto_submitted: nextStatus === "AUTO_SUBMITTED",
    },
  });

  const refreshed = await recalculatePracticeAttemptResult(db, updatedAttempt.id);
  if (!refreshed) {
    throw new Error("Practice attempt not found.");
  }

  const resultAttempt = await loadPracticeAttempt(db, attempt.id, student);
  return {
    status: nextStatus,
    attempt: mapPracticeAttemptPayload(resultAttempt),
    result: resultAttempt.attempt_result,
  };
}

export async function listStudentPracticeResults(db: PracticeDb, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const attempts = await db.practice_attempts.findMany({
    where: {
      student_id: student.id,
      status: {
        in: ["SUBMITTED", "AUTO_SUBMITTED"],
      },
      attempt_result: {
        isNot: null,
      },
    },
    include: {
      practice_question_paper: {
        include: {
          batch: true,
        },
      },
      practice_question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
        },
      },
      attempt_result: true,
      attempt_section_results: true,
    },
    orderBy: {
      submitted_at: "desc",
    },
  });

  return {
    student,
    results: attempts.map((attempt) => buildPracticeResultSummary(attempt as PracticeAttemptRow)),
  };
}

export async function getStudentPracticeResultDetail(db: PracticeDb, attemptId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);
  if (!attempt.attempt_result) {
    throw new Error("Practice result not found.");
  }

  return {
    student,
    attempt: buildPracticeResultSummary(attempt),
  };
}

function buildPracticeReviewQuestion(
  attempt: PracticeAttemptRow,
  question: PracticeVersionRow["questions"][number],
  answer: PracticeAnswerRow | null,
  revealSolutions: boolean,
) {
  const evaluation = scorePracticeQuestion(question, answer);
  const studentAnswer = mapStudentAnswerForReview(question, answer);
  const correctAnswer = mapCorrectAnswerForReview(question, revealSolutions);

  return {
    version_question_id: question.id,
    question_order: question.question_order,
    question_type: question.question_type,
    question_text: question.question_text,
    question_media: question.media
      .filter((media) => media.purpose === "QUESTION")
      .map((media) => mapQuestionMediaForReview(attempt.id, question.id, media)),
    options: question.options.map((option) => ({
      version_option_id: option.id,
      option_label: option.option_label,
      option_text: option.option_text ?? "",
      option_order: option.option_order,
    })),
    student_answer: studentAnswer,
    correct_answer: correctAnswer,
    status: evaluation.correct ? "CORRECT" : evaluation.wrong ? "WRONG" : "UNATTEMPTED",
    marks_awarded: evaluation.score.toString(),
    max_marks: question.marks.toString(),
    negative_marks: question.negative_marks.toString(),
    solution: revealSolutions
      ? {
          explanation_text: null as string | null,
          solution_media: question.media
            .filter((media) => media.purpose === "SOLUTION")
            .map((media) => mapSolutionMediaForReview(attempt.id, question.id, media)),
        }
      : {
          explanation_text: null as string | null,
          solution_media: [],
        },
  };
}

function buildPracticeReviewPayload(attempt: PracticeAttemptRow, studentName: string | null) {
  const result = attempt.attempt_result;
  if (!result) {
    throw new Error("Practice result not found.");
  }
  if (!attempt.practice_question_paper_version) {
    throw new Error("Practice version not found.");
  }

  const policy = attempt.solution_policy_snapshot;
  const revealSolutions = policy === "AFTER_SUBMIT";
  if (policy === "AFTER_CORRECT" || policy === "AFTER_TWO_WRONG") {
    throw new Error("This self-practice solution policy is not supported yet.");
  }

  const answerMap = new Map(attempt.attempt_answers.map((answer) => [answer.version_question_id, answer]));

  const sections = attempt.practice_question_paper_version.sections.map((section) => {
    const questions = attempt.practice_question_paper_version.questions
      .filter((question) => question.section_code === section.section_code && question.is_active_snapshot)
      .map((question) => buildPracticeReviewQuestion(attempt, question, answerMap.get(question.id) ?? null, revealSolutions));

    const sectionResult = attempt.attempt_section_results.find((entry) => entry.section_code === section.section_code);
    return {
      section_code: section.section_code,
      section_title: sectionLabel(section.section_code),
      score: sectionResult?.score.toString() ?? "0",
      max_score: sectionResult?.max_score.toString() ?? "0",
      correct_count: sectionResult?.correct_count ?? 0,
      wrong_count: sectionResult?.wrong_count ?? 0,
      unattempted_count: sectionResult?.unattempted_count ?? 0,
      attempted_count: (sectionResult?.correct_count ?? 0) + (sectionResult?.wrong_count ?? 0),
      total_questions: questions.length,
      questions,
    };
  });

  return {
    attempt_id: attempt.id,
    paper: {
      id: attempt.practice_question_paper.id,
      title: attempt.practice_question_paper_version.title_snapshot,
      category: attempt.practice_question_paper.category,
      batch_id: attempt.practice_question_paper.batch_id,
      batch_name: attempt.practice_question_paper.batch?.name ?? null,
      not_ranked: true,
    },
    practice_question_paper_id: attempt.practice_question_paper_id,
    practice_question_paper_version_id: attempt.practice_question_paper_version_id,
    practice_question_paper_version_number: attempt.practice_question_paper_version.version_number,
    student: {
      id: attempt.student_id,
      name: studentName,
    },
    summary: {
      total_score: result.total_score.toString(),
      max_score: result.max_score.toString(),
      percentage: result.percentage.toString(),
      correct_count: result.correct_count,
      wrong_count: result.wrong_count,
      unattempted_count: result.unattempted_count,
      rank: null as number | null,
    },
    solution_policy: policy,
    sections,
  };
}

export async function getStudentPracticeReview(db: PracticeDb, attemptId: number, actor: AuthenticatedUser) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);
  if (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED") {
    throw new Error("Practice review is available after submit.");
  }

  const payload = buildPracticeReviewPayload(attempt, student.user.full_name);
  return {
    review: {
      ...payload,
      student: {
        id: student.id,
        name: student.user.full_name,
      },
    },
  };
}

export async function readStudentPracticeReviewMediaFile(
  db: PracticeDb,
  attemptId: number,
  versionQuestionId: number,
  mediaId: number,
  actor: AuthenticatedUser,
  purpose: "QUESTION" | "SOLUTION",
) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);
  if (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED") {
    throw new Error("Practice review is available after submit.");
  }
  if (!attempt.practice_question_paper_version) {
    throw new Error("Practice version not found.");
  }
  const policy = attempt.solution_policy_snapshot;
  if (purpose === "SOLUTION" && policy !== "AFTER_SUBMIT") {
    throw new Error("Solution is not available for this practice paper.");
  }
  if (policy === "AFTER_CORRECT" || policy === "AFTER_TWO_WRONG") {
    throw new Error("This self-practice solution policy is not supported yet.");
  }

  const versionQuestion = attempt.practice_question_paper_version.questions.find((question) => question.id === versionQuestionId);
  if (!versionQuestion) {
    throw new Error("Question not found.");
  }

  const media = versionQuestion.media.find((entry) => entry.id === mediaId);
  if (!media || media.purpose !== purpose) {
    throw new Error("Media not found.");
  }

  const absolutePath = media.storage_url.startsWith("/")
    ? `${process.cwd()}${media.storage_url}`
    : `${process.cwd()}/${media.storage_url}`;

  return {
    attempt,
    versionQuestion,
    media,
    absolutePath,
  };
}

export async function getStudentPracticeQuestionPaperMediaFile(
  db: PracticeDb,
  attemptId: number,
  versionQuestionId: number,
  mediaId: number,
  actor: AuthenticatedUser,
) {
  const student = await loadStudentProfile(db, actor.id);
  const attempt = await loadPracticeAttempt(db, attemptId, student);
  if (attempt.status !== "IN_PROGRESS") {
    throw new Error("Practice attempt is not active.");
  }
  if (attempt.ends_at && attempt.ends_at <= new Date()) {
    throw new Error("Your practice attempt has expired.");
  }
  if (!attempt.practice_question_paper_version) {
    throw new Error("Practice version not found.");
  }

  const versionQuestion = attempt.practice_question_paper_version.questions.find((question) => question.id === versionQuestionId);
  if (!versionQuestion) {
    throw new Error("Question not found.");
  }

  const media = versionQuestion.media.find((entry) => entry.id === mediaId && entry.purpose === "QUESTION");
  if (!media) {
    throw new Error("Media not found.");
  }

  const absolutePath = media.storage_url.startsWith("/")
    ? `${process.cwd()}${media.storage_url}`
    : `${process.cwd()}/${media.storage_url}`;

  return {
    attempt,
    versionQuestion,
    media,
    absolutePath,
  };
}
