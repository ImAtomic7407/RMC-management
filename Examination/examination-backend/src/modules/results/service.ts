import { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "../../shared/auth";
import { prisma } from "../../shared/prisma";

type ResultDb = typeof prisma;

type ResultQuestionRow = Prisma.questionsGetPayload<{
  include: {
    question_options: true;
  };
}>;

type ResultAnswerRow = Prisma.attempt_answersGetPayload<{
  include: {
    selected_option: true;
    question: {
      include: {
        question_options: true;
      };
    };
  };
}>;

type ResultAttemptRow = Prisma.exam_attemptsGetPayload<{
  include: {
    exam: {
      include: {
        batch: true;
        exam_sections: {
          orderBy: {
            section_order: "asc";
          };
        };
        question_paper_version: {
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
      };
    };
    student: {
      include: {
        user: true;
        batch: true;
      };
    };
    attempt_answers: {
      include: {
        selected_option: true;
        question: {
          include: {
            question_options: true;
          };
        };
      };
    };
    attempt_result: true;
    attempt_section_results: true;
    leaderboard_entries: {
      where: {
        scope_type: "EXAM";
      };
      orderBy: {
        rank: "asc";
      };
    };
  };
}>;

type VersionSectionRow = Prisma.question_paper_version_sectionsGetPayload<{}>;

type VersionQuestionRow = Prisma.question_paper_version_questionsGetPayload<{
  include: {
    options: true;
    media: true;
  };
}>;

type VersionQuestionMediaRow = VersionQuestionRow["media"][number];

type VersionSnapshotRow = Prisma.question_paper_versionsGetPayload<{
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

type AssignedPaperInstanceForReviewRow = Prisma.student_exam_paper_instancesGetPayload<{
  include: {
    questions: {
      orderBy: {
        student_question_order: "asc";
      };
    };
  };
}>;

type AnswerLookupMaps = {
  byAssignedQuestionId: Map<number, ResultAnswerRow>;
  byVersionQuestionId: Map<number, ResultAnswerRow>;
  byLegacyQuestionId: Map<number, ResultAnswerRow>;
  byLegacyOrder: Map<string, ResultAnswerRow>;
};

type SectionCode = "PHYSICS" | "CHEMISTRY" | "MATHS";

type ScoreSection = {
  section_code: SectionCode;
  score: Prisma.Decimal;
  max_score: Prisma.Decimal;
  correct_count: number;
  wrong_count: number;
  unattempted_count: number;
};

const SECTION_ORDER: Array<SectionCode> = ["PHYSICS", "CHEMISTRY", "MATHS"];

function canonicalizeIntegerAnswer(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid integer answer encountered during result calculation.");
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

function emptySection(sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS"): ScoreSection {
  return {
    section_code: sectionCode,
    score: new Prisma.Decimal(0),
    max_score: new Prisma.Decimal(0),
    correct_count: 0,
    wrong_count: 0,
    unattempted_count: 0,
  };
}

function percentageFrom(totalScore: Prisma.Decimal, maxScore: Prisma.Decimal) {
  if (maxScore.equals(0)) {
    return "0.00";
  }

  return totalScore.mul(100).div(maxScore).toFixed(2);
}

function negativeScore(value: Prisma.Decimal) {
  return value.mul(-1);
}

function buildSectionTotals(sectionCodes: Array<"PHYSICS" | "CHEMISTRY" | "MATHS"> = SECTION_ORDER) {
  return new Map<"PHYSICS" | "CHEMISTRY" | "MATHS", ScoreSection>(
    sectionCodes.map((sectionCode) => [sectionCode, emptySection(sectionCode)]),
  );
}

function sortSections<T extends { section_code: "PHYSICS" | "CHEMISTRY" | "MATHS" }>(sections: T[]) {
  return [...sections].sort(
    (left, right) => SECTION_ORDER.indexOf(left.section_code) - SECTION_ORDER.indexOf(right.section_code),
  );
}

function scoreQuestion(question: ResultQuestionRow, answer: ResultAnswerRow | null) {
  if (question.question_type === "MCQ") {
    if (!answer?.selected_option_id) {
      return {
        score: new Prisma.Decimal(0),
        correct: false,
        wrong: false,
        unattempted: true,
      };
    }

    const selectedOption = answer.selected_option;
    if (!selectedOption || selectedOption.question_id !== question.id) {
      return {
        score: negativeScore(question.negative_marks),
        correct: false,
        wrong: true,
        unattempted: false,
      };
    }

    if (selectedOption.is_correct) {
      return {
        score: question.marks,
        correct: true,
        wrong: false,
        unattempted: false,
      };
    }

    return {
      score: negativeScore(question.negative_marks),
      correct: false,
      wrong: true,
      unattempted: false,
    };
  }

  const submitted = canonicalizeIntegerAnswer(answer?.integer_answer);
  const expected = canonicalizeIntegerAnswer(question.correct_integer_answer);

  if (!submitted) {
    return {
      score: new Prisma.Decimal(0),
      correct: false,
      wrong: false,
      unattempted: true,
    };
  }

  if (!expected) {
    throw new Error(`Question ${question.id} is missing an integer answer.`);
  }

  if (isIntegerAnswerCorrect(submitted, expected)) {
    return {
      score: question.marks,
      correct: true,
      wrong: false,
      unattempted: false,
    };
  }

  return {
    score: negativeScore(question.negative_marks),
    correct: false,
    wrong: true,
    unattempted: false,
  };
}

function buildAnswerLookupMaps(attempt: ResultAttemptRow): AnswerLookupMaps {
  const byAssignedQuestionId = new Map<number, ResultAnswerRow>();
  const byVersionQuestionId = new Map<number, ResultAnswerRow>();
  const byLegacyQuestionId = new Map<number, ResultAnswerRow>();
  const byLegacyOrder = new Map<string, ResultAnswerRow>();

  for (const answer of attempt.attempt_answers) {
    if (answer.assigned_question_id != null) {
      byAssignedQuestionId.set(answer.assigned_question_id, answer as ResultAnswerRow);
    }
    if (answer.version_question_id != null) {
      byVersionQuestionId.set(answer.version_question_id, answer as ResultAnswerRow);
    }
    byLegacyQuestionId.set(answer.question_id, answer as ResultAnswerRow);
    byLegacyOrder.set(`${answer.question.section_code}:${answer.question.question_order}`, answer as ResultAnswerRow);
  }

  return { byAssignedQuestionId, byVersionQuestionId, byLegacyQuestionId, byLegacyOrder };
}

function mapVersionQuestionAnswer(versionQuestion: VersionQuestionRow, answerMaps: AnswerLookupMaps) {
  const byVersion = answerMaps.byVersionQuestionId.get(versionQuestion.id);
  if (byVersion) {
    return byVersion;
  }

  if (versionQuestion.original_question_id) {
    const byOriginal = answerMaps.byLegacyQuestionId.get(versionQuestion.original_question_id);
    if (byOriginal) {
      return byOriginal;
    }
  }

  return answerMaps.byLegacyOrder.get(`${versionQuestion.section_code}:${versionQuestion.question_order}`) ?? null;
}

function mapAssignedQuestionAnswer(
  assignedQuestion: { id: number; version_question_id: number; section_code: SectionCode; original_question_order: number },
  versionQuestion: VersionQuestionRow,
  answerMaps: AnswerLookupMaps,
) {
  const byAssigned = answerMaps.byAssignedQuestionId.get(assignedQuestion.id);
  if (byAssigned) {
    return byAssigned;
  }

  const byVersion = answerMaps.byVersionQuestionId.get(versionQuestion.id);
  if (byVersion) {
    return byVersion;
  }

  if (versionQuestion.original_question_id) {
    const byOriginal = answerMaps.byLegacyQuestionId.get(versionQuestion.original_question_id);
    if (byOriginal) {
      return byOriginal;
    }
  }

  return answerMaps.byLegacyOrder.get(`${assignedQuestion.section_code}:${assignedQuestion.original_question_order}`) ?? null;
}

function mapVersionSelectedOption(versionQuestion: VersionQuestionRow, answer: ResultAnswerRow | null) {
  if (!answer?.selected_option_id) {
    return null;
  }

  const byOriginalId = versionQuestion.options.find((option) => option.original_option_id === answer.selected_option_id);
  if (byOriginalId) {
    return byOriginalId;
  }

  const selectedOptionLabel = answer.selected_option?.option_label;
  if (selectedOptionLabel) {
    const byLabel = versionQuestion.options.find((option) => option.option_label === selectedOptionLabel);
    if (byLabel) {
      return byLabel;
    }
  }

  return null;
}

function scoreVersionQuestion(versionQuestion: VersionQuestionRow, answer: ResultAnswerRow | null) {
  if (versionQuestion.question_type === "MCQ") {
    if (!answer?.selected_option_id) {
      return {
        score: new Prisma.Decimal(0),
        correct: false,
        wrong: false,
        unattempted: true,
      };
    }

    const selectedOption = mapVersionSelectedOption(versionQuestion, answer);
    if (!selectedOption) {
      return {
        score: negativeScore(versionQuestion.negative_marks),
        correct: false,
        wrong: true,
        unattempted: false,
      };
    }

    if (selectedOption.is_correct) {
      return {
        score: versionQuestion.marks,
        correct: true,
        wrong: false,
        unattempted: false,
      };
    }

    return {
      score: negativeScore(versionQuestion.negative_marks),
      correct: false,
      wrong: true,
      unattempted: false,
    };
  }

  const submitted = canonicalizeIntegerAnswer(answer?.integer_answer);
  const expected = canonicalizeIntegerAnswer(versionQuestion.correct_integer_answer);

  if (!submitted) {
    return {
      score: new Prisma.Decimal(0),
      correct: false,
      wrong: false,
      unattempted: true,
    };
  }

  if (!expected) {
    throw new Error(`Version question ${versionQuestion.id} is missing an integer answer.`);
  }

  if (isIntegerAnswerCorrect(submitted, expected)) {
    return {
      score: versionQuestion.marks,
      correct: true,
      wrong: false,
      unattempted: false,
    };
  }

  return {
    score: negativeScore(versionQuestion.negative_marks),
    correct: false,
    wrong: true,
    unattempted: false,
  };
}

async function loadAttemptForRecalc(db: ResultDb, attemptId: number) {
  const attempt = await db.exam_attempts.findUnique({
    where: { id: attemptId },
    include: {
      exam: {
        include: {
          batch: true,
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
            },
          },
        },
      },
      student: {
        include: {
          user: true,
          batch: true,
        },
      },
      attempt_answers: {
        include: {
          selected_option: true,
          question: {
            include: {
              question_options: true,
            },
          },
        },
      },
      attempt_result: true,
      attempt_section_results: true,
      leaderboard_entries: {
        where: {
          scope_type: "EXAM",
        },
        orderBy: {
          rank: "asc",
        },
      },
    },
  });

  if (!attempt) {
    throw new Error("Attempt not found.");
  }

  return attempt as ResultAttemptRow;
}

async function loadQuestionPaperVersionSnapshot(db: ResultDb, versionId: number) {
  const version = await db.question_paper_versions.findUnique({
    where: { id: versionId },
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
              {
                purpose: "asc",
              },
              {
                sort_order: "asc",
              },
              {
                created_at: "asc",
              },
            ],
          },
        },
      },
    },
  });

  if (!version) {
    throw new Error("Question paper version not found.");
  }

  return version as VersionSnapshotRow;
}

function mapAttemptResultResponse(attempt: ResultAttemptRow) {
  const result = attempt.attempt_result;
  const sections = sortSections([...attempt.attempt_section_results])
    .map((section) => ({
      section_code: section.section_code,
      score: section.score.toString(),
      max_score: section.max_score.toString(),
      correct_count: section.correct_count,
      wrong_count: section.wrong_count,
      unattempted_count: section.unattempted_count,
    }));

  return {
    attempt_id: attempt.id,
    total_score: result?.total_score.toString() ?? "0",
    max_score: result?.max_score.toString() ?? "0",
    percentage: result?.percentage.toString() ?? "0.00",
    correct_count: result?.correct_count ?? 0,
    wrong_count: result?.wrong_count ?? 0,
    unattempted_count: result?.unattempted_count ?? 0,
    rank_exam: result?.rank_exam ?? null,
    rank_batch: result?.rank_batch ?? null,
    rank_overall: result?.rank_overall ?? null,
    evaluated_question_paper_version_id: result?.evaluated_question_paper_version_id ?? null,
    evaluated_question_paper_version_number: result?.evaluated_question_paper_version_number ?? null,
    assigned_paper_instance_id: result?.assigned_paper_instance_id ?? null,
    scoring_source: result?.scoring_source ?? null,
    sections,
  };
}

function reviewSectionTitle(sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS") {
  switch (sectionCode) {
    case "PHYSICS":
      return "Physics";
    case "CHEMISTRY":
      return "Chemistry";
    case "MATHS":
      return "Maths";
  }
}

function buildReviewMediaUrl(
  attemptId: number,
  versionQuestionId: number,
  mediaId: number,
  purpose: "QUESTION" | "SOLUTION",
) {
  return purpose === "QUESTION"
    ? `/api/student/results/${attemptId}/review/questions/${versionQuestionId}/media/${mediaId}`
    : `/api/student/results/${attemptId}/review/questions/${versionQuestionId}/solution/${mediaId}`;
}

function mapReviewMedia(
  attemptId: number,
  versionQuestionId: number,
  media: VersionQuestionMediaRow,
) {
  const mediaUrl = buildReviewMediaUrl(attemptId, versionQuestionId, media.id, media.purpose);
  return {
    id: media.id,
    purpose: media.purpose,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    created_at: media.created_at,
    url: mediaUrl,
    // Client (SecureAttemptScreen / review screen / examPaperCache) keys media off
    // `access_url`; emit it alongside `url` so review images don't resolve to
    // `<base>undefined` (same fix as the assigned-paper payload).
    access_url: mediaUrl,
  };
}

function mapReviewQuestion(
  attemptId: number,
  versionQuestion: VersionQuestionRow,
  answer: ResultAnswerRow | null,
  assignedMeta?: {
    assigned_question_id: number;
    student_question_order: number;
    section_question_order: number;
    original_question_order: number;
  } | null,
) {
  const evaluation = scoreVersionQuestion(versionQuestion, answer);
  const selectedVersionOption = mapVersionSelectedOption(versionQuestion, answer);
  const correctVersionOption = versionQuestion.options.find((option) => option.is_correct) ?? null;

  return {
    assigned_question_id: assignedMeta?.assigned_question_id ?? null,
    version_question_id: versionQuestion.id,
    section_code: versionQuestion.section_code,
    question_order: versionQuestion.question_order,
    student_question_order: assignedMeta?.student_question_order ?? null,
    section_question_order: assignedMeta?.section_question_order ?? null,
    original_question_order: assignedMeta?.original_question_order ?? null,
    question_type: versionQuestion.question_type,
    question_text: versionQuestion.question_text,
    question_media: versionQuestion.media
      .filter((media) => media.purpose === "QUESTION")
      .map((media) => mapReviewMedia(attemptId, versionQuestion.id, media)),
    options: versionQuestion.options.map((option) => ({
      version_option_id: option.id,
      option_label: option.option_label,
      option_text: option.option_text ?? "",
      option_order: option.option_order,
    })),
    student_answer: {
      selected_option_label: selectedVersionOption?.option_label ?? null,
      selected_option_id: selectedVersionOption?.id ?? null,
      integer_answer: versionQuestion.question_type === "INTEGER" ? canonicalizeIntegerAnswer(answer?.integer_answer) : null,
    },
    correct_answer: {
      correct_option_label: correctVersionOption?.option_label ?? null,
      correct_option_id: correctVersionOption?.id ?? null,
      correct_integer_answer: versionQuestion.question_type === "INTEGER" ? canonicalizeIntegerAnswer(versionQuestion.correct_integer_answer) : null,
    },
    status: evaluation.correct ? ("CORRECT" as const) : evaluation.wrong ? ("WRONG" as const) : ("UNATTEMPTED" as const),
    marks_awarded: evaluation.score.toString(),
    max_marks: versionQuestion.marks.toString(),
    negative_marks: versionQuestion.negative_marks.toString(),
    solution: {
      explanation_text: null,
      solution_media: versionQuestion.media
        .filter((media) => media.purpose === "SOLUTION")
        .map((media) => mapReviewMedia(attemptId, versionQuestion.id, media)),
    },
  };
}

function mapReviewSectionTitle(sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS") {
  return reviewSectionTitle(sectionCode);
}

function buildReviewAnswerMaps(attempt: ResultAttemptRow) {
  return buildAnswerLookupMaps(attempt);
}

async function loadOfficialReviewAttempt(db: ResultDb, attemptId: number, actor: AuthenticatedUser) {
  const attempt = await loadAttemptForRecalc(db, attemptId);
  // A STUDENT may only review their OWN attempts. (Teachers/Admins reach this via
  // the ADMIN/TEACHER-gated results router and may review any attempt.) The combined
  // app never requests another student's attempt, but this blocks API tampering —
  // there is no public student leaderboard that would make peer results visible.
  if (actor.role === "STUDENT" && attempt.student_id !== actor.id) {
    throw new Error("Attempt not found.");
  }
  if (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED") {
    throw new Error("Review is only available for submitted official exams.");
  }
  if (attempt.exam.status !== "RESULT_RELEASED") {
    throw new Error("Review is only available after result release.");
  }
  if (!attempt.attempt_result) {
    throw new Error("Result is not available yet.");
  }
  if (!attempt.exam.question_paper_version_id) {
    throw new Error("Review is only available for versioned exams.");
  }

  const version = await loadQuestionPaperVersionSnapshot(db, attempt.exam.question_paper_version_id);
  const assignedPaper = await db.student_exam_paper_instances.findFirst({
    where: {
      exam_id: attempt.exam_id,
      student_id: attempt.student_id,
    },
    include: {
      questions: {
        orderBy: {
          student_question_order: "asc",
        },
      },
    },
  });

  return {
    attempt,
    version,
    assignedPaper: assignedPaper as AssignedPaperInstanceForReviewRow | null,
  };
}

function buildReviewPayload(
  attempt: ResultAttemptRow,
  version: VersionSnapshotRow,
  assignedPaper: AssignedPaperInstanceForReviewRow | null = null,
) {
  const answerMaps = buildReviewAnswerMaps(attempt);
  const sectionResults = new Map(
    attempt.attempt_section_results.map((section) => [section.section_code, section]),
  );
  const rank = attempt.attempt_result?.rank_exam ?? attempt.leaderboard_entries[0]?.rank ?? null;
  const versionQuestionMap = new Map<number, VersionQuestionRow>(
    version.questions.map((question): [number, VersionQuestionRow] => [question.id, question]),
  );
  const assignedQuestionsBySection: Map<SectionCode, AssignedPaperInstanceForReviewRow["questions"]> | null = assignedPaper
    ? new Map<SectionCode, AssignedPaperInstanceForReviewRow["questions"]>(
        SECTION_ORDER.map((sectionCode) => [
          sectionCode,
          assignedPaper.questions
            .filter((question: AssignedPaperInstanceForReviewRow["questions"][number]) => question.section_code === sectionCode)
            .sort((left: AssignedPaperInstanceForReviewRow["questions"][number], right: AssignedPaperInstanceForReviewRow["questions"][number]) => left.student_question_order - right.student_question_order),
        ]),
      )
    : null;

  const sections = version.sections.map((section) => {
    const sectionResult = sectionResults.get(section.section_code);
    const questions = assignedQuestionsBySection
      ? (() => {
          const mapped = (assignedQuestionsBySection.get(section.section_code) ?? []).map((assignedQuestion: AssignedPaperInstanceForReviewRow["questions"][number]) => {
            const versionQuestion = versionQuestionMap.get(assignedQuestion.version_question_id);
            if (!versionQuestion) {
              return null;
            }
            return mapReviewQuestion(
              attempt.id,
              versionQuestion,
              mapAssignedQuestionAnswer(
                {
                  id: assignedQuestion.id,
                  version_question_id: assignedQuestion.version_question_id,
                  section_code: assignedQuestion.section_code,
                  original_question_order: assignedQuestion.original_question_order,
                },
                versionQuestion,
                answerMaps,
              ),
              {
                assigned_question_id: assignedQuestion.id,
                student_question_order: assignedQuestion.student_question_order,
                section_question_order: assignedQuestion.section_question_order,
                original_question_order: assignedQuestion.original_question_order,
              },
            );
          });
          return mapped.filter(
            (question: ReturnType<typeof mapReviewQuestion> | null): question is ReturnType<typeof mapReviewQuestion> =>
              question !== null,
          );
        })()
      : version.questions
          .filter((question: VersionQuestionRow) => question.section_code === section.section_code)
          .map((question: VersionQuestionRow) =>
            mapReviewQuestion(
              attempt.id,
              question,
              mapVersionQuestionAnswer(question, answerMaps),
            ),
          );

    return {
      section_code: section.section_code,
      section_title: mapReviewSectionTitle(section.section_code),
      section_order: section.section_order,
      score: sectionResult?.score.toString() ?? "0",
      max_score: sectionResult?.max_score.toString() ?? "0",
      correct_count: sectionResult?.correct_count ?? 0,
      wrong_count: sectionResult?.wrong_count ?? 0,
      unattempted_count: sectionResult?.unattempted_count ?? 0,
      questions,
    };
  });

  return {
    attempt_id: attempt.id,
    exam_id: attempt.exam.id,
    exam_title: attempt.exam.title,
    exam_mode: attempt.exam.exam_mode,
    question_paper_version_id: version.id,
    question_paper_version_number: version.version_number,
    student: {
      id: attempt.student.id,
      name: attempt.student.user.full_name,
    },
    assigned_paper: assignedPaper
      ? {
          instance_id: assignedPaper.id,
          assigned_student_number: assignedPaper.assigned_student_number,
          review_package_lock_status: assignedPaper.review_package_lock_status,
          variant_seed_public_id: `vsp_${assignedPaper.variant_seed.slice(0, 12)}`,
        }
      : null,
    summary: {
      total_score: attempt.attempt_result?.total_score.toString() ?? "0",
      max_score: attempt.attempt_result?.max_score.toString() ?? "0",
      percentage: attempt.attempt_result?.percentage.toString() ?? "0.00",
      rank,
      correct_count: attempt.attempt_result?.correct_count ?? 0,
      wrong_count: attempt.attempt_result?.wrong_count ?? 0,
      unattempted_count: attempt.attempt_result?.unattempted_count ?? 0,
    },
    sections,
  };
}

async function buildLegacyResultSnapshot(db: ResultDb, attempt: ResultAttemptRow) {
  const activeQuestions = await db.questions.findMany({
    where: {
      exam_id: attempt.exam_id,
      is_active: true,
    },
    include: {
      question_options: true,
    },
    orderBy: [
      {
        section_code: "asc",
      },
      {
        question_order: "asc",
      },
    ],
  });

  const answerMap = new Map<number, ResultAnswerRow>();
  for (const answer of attempt.attempt_answers) {
    answerMap.set(answer.question_id, answer as ResultAnswerRow);
  }

  const sectionTotals = buildSectionTotals();
  let totalScore = new Prisma.Decimal(0);
  let maxScore = new Prisma.Decimal(0);
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  for (const question of activeQuestions as ResultQuestionRow[]) {
    const section = sectionTotals.get(question.section_code)!;
    section.max_score = section.max_score.plus(question.marks);
    maxScore = maxScore.plus(question.marks);

    const evaluation = scoreQuestion(question, answerMap.get(question.id) ?? null);
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
  const resultReleasedAt = attempt.exam.status === "RESULT_RELEASED" ? attempt.exam.result_released_at ?? now : null;

  await db.$transaction(async (tx) => {
    await tx.attempt_section_results.deleteMany({
      where: {
        attempt_id: attempt.id,
      },
    });
    await tx.attempt_results.deleteMany({
      where: {
        attempt_id: attempt.id,
      },
    });

    await tx.attempt_section_results.createMany({
      data: sortSections(Array.from(sectionTotals.values())).map((section) => ({
        attempt_id: attempt.id,
        section_code: section.section_code,
        score: section.score,
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
        max_score: section.max_score,
      })),
    });

    await tx.attempt_results.create({
      data: {
        attempt_id: attempt.id,
        total_score: totalScore,
        max_score: maxScore,
        percentage: new Prisma.Decimal(percentageFrom(totalScore, maxScore)),
        correct_count: correctCount,
        wrong_count: wrongCount,
        unattempted_count: unattemptedCount,
        rank_exam: null,
        rank_batch: null,
        rank_overall: null,
        result_released_at: resultReleasedAt,
        scoring_source: "LEGACY_EXAM_QUESTIONS",
      },
    });
  });

  return loadAttemptForRecalc(db, attempt.id);
}

async function buildVersionResultSnapshot(db: ResultDb, attempt: ResultAttemptRow) {
  const versionId = attempt.exam.question_paper_version_id;
  if (!versionId) {
    return buildLegacyResultSnapshot(db, attempt);
  }

  const version = await loadQuestionPaperVersionSnapshot(db, versionId);
  const answerMaps = buildAnswerLookupMaps(attempt);
  const assignedPaper = await db.student_exam_paper_instances.findFirst({
    where: {
      exam_id: attempt.exam_id,
      student_id: attempt.student_id,
    },
    include: {
      questions: {
        orderBy: {
          student_question_order: "asc",
        },
      },
    },
  });

  const sectionTotals = buildSectionTotals(version.sections.map((section) => section.section_code));
  let totalScore = new Prisma.Decimal(0);
  let maxScore = new Prisma.Decimal(0);
  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;

  if (assignedPaper) {
    const versionQuestionMap = new Map<number, VersionQuestionRow>(
      version.questions.map((question): [number, VersionQuestionRow] => [question.id, question]),
    );

    for (const assignedQuestion of assignedPaper.questions) {
      const versionQuestion = versionQuestionMap.get(assignedQuestion.version_question_id);
      if (!versionQuestion) {
        throw new Error(`Assigned paper question ${assignedQuestion.id} is missing version question ${assignedQuestion.version_question_id}.`);
      }

      const section = sectionTotals.get(assignedQuestion.section_code);
      if (!section) {
        throw new Error(`Assigned paper question ${assignedQuestion.id} has unknown section ${assignedQuestion.section_code}.`);
      }

      section.max_score = section.max_score.plus(versionQuestion.marks);
      maxScore = maxScore.plus(versionQuestion.marks);

      const answer = mapAssignedQuestionAnswer(assignedQuestion, versionQuestion, answerMaps);
      const evaluation = scoreVersionQuestion(versionQuestion, answer);
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
  } else {
    const activeQuestions = version.questions.filter((question) => question.is_active_snapshot);

    for (const question of activeQuestions as VersionQuestionRow[]) {
      const section = sectionTotals.get(question.section_code)!;
      section.max_score = section.max_score.plus(question.marks);
      maxScore = maxScore.plus(question.marks);

      const answer = mapVersionQuestionAnswer(question, answerMaps);
      const evaluation = scoreVersionQuestion(question, answer);
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
  }

  const now = new Date();
  const resultReleasedAt = attempt.exam.status === "RESULT_RELEASED" ? attempt.exam.result_released_at ?? now : null;

  await db.$transaction(async (tx) => {
    await tx.attempt_section_results.deleteMany({
      where: {
        attempt_id: attempt.id,
      },
    });
    await tx.attempt_results.deleteMany({
      where: {
        attempt_id: attempt.id,
      },
    });

    await tx.attempt_section_results.createMany({
      data: sortSections(Array.from(sectionTotals.values())).map((section) => ({
        attempt_id: attempt.id,
        section_code: section.section_code,
        score: section.score,
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
        max_score: section.max_score,
      })),
    });

    await tx.attempt_results.create({
      data: {
        attempt_id: attempt.id,
        assigned_paper_instance_id: assignedPaper?.id ?? null,
        total_score: totalScore,
        max_score: maxScore,
        percentage: new Prisma.Decimal(percentageFrom(totalScore, maxScore)),
        correct_count: correctCount,
        wrong_count: wrongCount,
        unattempted_count: unattemptedCount,
        rank_exam: null,
        rank_batch: null,
        rank_overall: null,
        result_released_at: resultReleasedAt,
        evaluated_question_paper_version_id: version.id,
        evaluated_question_paper_version_number: version.version_number,
        scoring_source: "QUESTION_PAPER_VERSION",
      },
    });
  });

  return loadAttemptForRecalc(db, attempt.id);
}

async function buildResultSnapshot(db: ResultDb, attempt: ResultAttemptRow) {
  if (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED") {
    throw new Error("Attempt must be submitted before result recalculation.");
  }

  if (attempt.exam.question_paper_version_id) {
    return buildVersionResultSnapshot(db, attempt);
  }

  return buildLegacyResultSnapshot(db, attempt);
}

function isResultVisibleToStudent(attempt: ResultAttemptRow) {
  return attempt.exam.status === "RESULT_RELEASED";
}

export async function recalculateAttemptResult(db: ResultDb, attemptId: number) {
  const attempt = await loadAttemptForRecalc(db, attemptId);
  const refreshed = await buildResultSnapshot(db, attempt);
  return {
    attempt: refreshed,
    result: mapAttemptResultResponse(refreshed),
  };
}

export async function listExamResults(db: ResultDb, examId: number, actor: AuthenticatedUser) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
    },
    include: {
      batch: true,
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
        },
      },
    },
  });

  if (!exam) {
    throw new Error("Exam not found.");
  }

  const attempts = await db.exam_attempts.findMany({
    where: {
      exam_id: exam.id,
      status: {
        in: ["SUBMITTED", "AUTO_SUBMITTED"],
      },
      attempt_result: {
        isNot: null,
      },
    },
    include: {
      student: {
        include: {
          user: true,
          batch: true,
        },
      },
      attempt_result: true,
      attempt_section_results: true,
    },
    orderBy: {
      submitted_at: "asc",
    },
  });

  return {
    exam,
    results: attempts.map((attempt) => ({
      attempt_id: attempt.id,
      student: {
        id: attempt.student.id,
        student_uid: attempt.student.student_uid,
        full_name: attempt.student.user.full_name,
        batch_id: attempt.student.batch_id,
        batch_name: attempt.student.batch.name,
      },
      total_score: attempt.attempt_result?.total_score.toString() ?? "0",
      max_score: attempt.attempt_result?.max_score.toString() ?? "0",
      percentage: attempt.attempt_result?.percentage.toString() ?? "0.00",
      correct_count: attempt.attempt_result?.correct_count ?? 0,
      wrong_count: attempt.attempt_result?.wrong_count ?? 0,
      unattempted_count: attempt.attempt_result?.unattempted_count ?? 0,
      submitted_at: attempt.submitted_at,
      status: attempt.status,
      question_paper_id: exam.question_paper_id ?? null,
      question_paper_version_id: exam.question_paper_version_id ?? null,
      question_paper_version: exam.question_paper_version
        ? {
            id: exam.question_paper_version.id,
            version_number: exam.question_paper_version.version_number,
            title_snapshot: exam.question_paper_version.title_snapshot,
            section_count: exam.question_paper_version.sections.length,
          }
        : null,
      evaluated_question_paper_version_id: attempt.attempt_result?.evaluated_question_paper_version_id ?? null,
      evaluated_question_paper_version_number: attempt.attempt_result?.evaluated_question_paper_version_number ?? null,
      assigned_paper_instance_id: attempt.attempt_result?.assigned_paper_instance_id ?? null,
      scoring_source: attempt.attempt_result?.scoring_source ?? null,
      sections: sortSections([...attempt.attempt_section_results]).map((section) => ({
        section_code: section.section_code,
        score: section.score.toString(),
        max_score: section.max_score.toString(),
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
      })),
    })),
  };
}

export async function getExamResultDetail(db: ResultDb, examId: number, attemptId: number, actor: AuthenticatedUser) {
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
    },
    include: {
      batch: true,
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
        },
      },
    },
  });

  if (!exam) {
    throw new Error("Exam not found.");
  }

  const attempt = await loadAttemptForRecalc(db, attemptId);
  if (attempt.exam_id !== exam.id) {
    throw new Error("Attempt does not belong to this exam.");
  }

  return {
    exam,
    attempt: {
      attempt_id: attempt.id,
      student: {
        id: attempt.student.id,
        student_uid: attempt.student.student_uid,
        full_name: attempt.student.user.full_name,
        batch_id: attempt.student.batch_id,
        batch_name: attempt.student.batch.name,
      },
      question_paper_id: exam.question_paper_id ?? null,
      question_paper_version_id: exam.question_paper_version_id ?? null,
      question_paper_version: exam.question_paper_version
        ? {
            id: exam.question_paper_version.id,
            version_number: exam.question_paper_version.version_number,
            title_snapshot: exam.question_paper_version.title_snapshot,
            section_count: exam.question_paper_version.sections.length,
          }
        : null,
      status: attempt.status,
      started_at: attempt.started_at,
      ends_at: attempt.ends_at,
      submitted_at: attempt.submitted_at,
      is_auto_submitted: attempt.is_auto_submitted,
      total_score: attempt.attempt_result?.total_score.toString() ?? "0",
      max_score: attempt.attempt_result?.max_score.toString() ?? "0",
      percentage: attempt.attempt_result?.percentage.toString() ?? "0.00",
      correct_count: attempt.attempt_result?.correct_count ?? 0,
      wrong_count: attempt.attempt_result?.wrong_count ?? 0,
      unattempted_count: attempt.attempt_result?.unattempted_count ?? 0,
      evaluated_question_paper_version_id: attempt.attempt_result?.evaluated_question_paper_version_id ?? null,
      evaluated_question_paper_version_number: attempt.attempt_result?.evaluated_question_paper_version_number ?? null,
      scoring_source: attempt.attempt_result?.scoring_source ?? null,
      sections: attempt.attempt_section_results.map((section) => ({
        section_code: section.section_code,
        score: section.score.toString(),
        max_score: section.max_score.toString(),
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
      })),
    },
  };
}

export async function getStudentResultReview(db: ResultDb, attemptId: number, actor: AuthenticatedUser) {
  const { attempt, version, assignedPaper } = await loadOfficialReviewAttempt(db, attemptId, actor);
  return {
    review: {
      ...buildReviewPayload(attempt, version, assignedPaper),
      student: {
        id: attempt.student.id,
        name: attempt.student.user.full_name,
      },
    },
  };
}

export async function readStudentResultReviewMediaFile(
  db: ResultDb,
  attemptId: number,
  versionQuestionId: number,
  mediaId: number,
  actor: AuthenticatedUser,
  purpose: "QUESTION" | "SOLUTION",
) {
  const { attempt, version } = await loadOfficialReviewAttempt(db, attemptId, actor);
  const versionQuestion = version.questions.find((question) => question.id === versionQuestionId);
  if (!versionQuestion) {
    throw new Error("Question not found.");
  }

  const media = versionQuestion.media.find((entry) => entry.id === mediaId);
  if (!media) {
    throw new Error("Media not found.");
  }

  if (media.purpose !== purpose) {
    throw new Error("Media not found.");
  }

  const absolutePath = media.storage_url.startsWith("/")
    ? `${process.cwd()}${media.storage_url}`
    : `${process.cwd()}/${media.storage_url}`;

  return {
    attempt,
    version,
    versionQuestion,
    media,
    absolutePath,
  };
}

export async function listStudentResults(db: ResultDb, actor: AuthenticatedUser) {
  const student = await db.student_profiles.findFirst({
    where: {
      user_id: actor.id,
      active: true,
    },
    include: {
      batch: true,
    },
  });

  if (!student) {
    // A freshly-imported student (e.g. a batch with no exams yet) may not have a
    // profile row. That's not an error — they simply have no results to show.
    return { student: null, results: [] };
  }

  const attempts = await db.exam_attempts.findMany({
    where: {
      student_id: student.id,
      exam: {
        status: "RESULT_RELEASED",
      },
      attempt_result: {
        isNot: null,
      },
    },
    include: {
      exam: {
        include: {
          batch: true,
          question_paper_version: {
            include: {
              sections: {
                orderBy: {
                  section_order: "asc",
                },
              },
            },
          },
        },
      },
      attempt_result: true,
      attempt_section_results: true,
      leaderboard_entries: {
        where: {
          scope_type: "EXAM",
        },
        orderBy: {
          rank: "asc",
        },
      },
    },
    orderBy: {
      submitted_at: "desc",
    },
  });

  return {
    student,
    results: attempts.map((attempt) => ({
      attempt_id: attempt.id,
      exam: {
        id: attempt.exam.id,
        title: attempt.exam.title,
        exam_mode: attempt.exam.exam_mode,
        status: attempt.exam.status,
        batch_name: attempt.exam.batch?.name ?? null,
        question_paper_id: attempt.exam.question_paper_id ?? null,
        question_paper_version_id: attempt.exam.question_paper_version_id ?? null,
        question_paper_version: attempt.exam.question_paper_version
          ? {
              id: attempt.exam.question_paper_version.id,
              version_number: attempt.exam.question_paper_version.version_number,
              title_snapshot: attempt.exam.question_paper_version.title_snapshot,
              section_count: attempt.exam.question_paper_version.sections.length,
            }
          : null,
      },
      total_score: attempt.attempt_result?.total_score.toString() ?? "0",
      max_score: attempt.attempt_result?.max_score.toString() ?? "0",
      percentage: attempt.attempt_result?.percentage.toString() ?? "0.00",
      correct_count: attempt.attempt_result?.correct_count ?? 0,
      wrong_count: attempt.attempt_result?.wrong_count ?? 0,
      unattempted_count: attempt.attempt_result?.unattempted_count ?? 0,
      rank_exam: attempt.attempt_result?.rank_exam ?? attempt.leaderboard_entries[0]?.rank ?? null,
      evaluated_question_paper_version_id: attempt.attempt_result?.evaluated_question_paper_version_id ?? null,
      evaluated_question_paper_version_number: attempt.attempt_result?.evaluated_question_paper_version_number ?? null,
      assigned_paper_instance_id: attempt.attempt_result?.assigned_paper_instance_id ?? null,
      scoring_source: attempt.attempt_result?.scoring_source ?? null,
      sections: sortSections([...attempt.attempt_section_results]).map((section) => ({
        section_code: section.section_code,
        score: section.score.toString(),
        max_score: section.max_score.toString(),
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
      })),
    })),
  };
}

export async function getStudentResultDetail(db: ResultDb, attemptId: number, actor: AuthenticatedUser) {
  const student = await db.student_profiles.findFirst({
    where: {
      user_id: actor.id,
      active: true,
    },
    include: {
      batch: true,
    },
  });

  if (!student) {
    throw new Error("Student profile not found.");
  }

  const attempt = await loadAttemptForRecalc(db, attemptId);
  if (attempt.student_id !== student.id) {
    throw new Error("Attempt not found.");
  }

  if (!isResultVisibleToStudent(attempt)) {
    throw new Error("Result is not released yet.");
  }

  return {
    student,
    attempt: {
      attempt_id: attempt.id,
      exam: {
        id: attempt.exam.id,
        title: attempt.exam.title,
        status: attempt.exam.status,
        exam_mode: attempt.exam.exam_mode,
        batch_name: attempt.exam.batch?.name ?? null,
        question_paper_id: attempt.exam.question_paper_id ?? null,
        question_paper_version_id: attempt.exam.question_paper_version_id ?? null,
        question_paper_version: attempt.exam.question_paper_version
          ? {
              id: attempt.exam.question_paper_version.id,
              version_number: attempt.exam.question_paper_version.version_number,
              title_snapshot: attempt.exam.question_paper_version.title_snapshot,
              section_count: attempt.exam.question_paper_version.sections.length,
            }
          : null,
      },
      total_score: attempt.attempt_result?.total_score.toString() ?? "0",
      max_score: attempt.attempt_result?.max_score.toString() ?? "0",
      percentage: attempt.attempt_result?.percentage.toString() ?? "0.00",
      correct_count: attempt.attempt_result?.correct_count ?? 0,
      wrong_count: attempt.attempt_result?.wrong_count ?? 0,
      unattempted_count: attempt.attempt_result?.unattempted_count ?? 0,
      rank_exam: attempt.attempt_result?.rank_exam ?? null,
      evaluated_question_paper_version_id: attempt.attempt_result?.evaluated_question_paper_version_id ?? null,
      evaluated_question_paper_version_number: attempt.attempt_result?.evaluated_question_paper_version_number ?? null,
      assigned_paper_instance_id: attempt.attempt_result?.assigned_paper_instance_id ?? null,
      scoring_source: attempt.attempt_result?.scoring_source ?? null,
      sections: sortSections([...attempt.attempt_section_results]).map((section) => ({
        section_code: section.section_code,
        score: section.score.toString(),
        max_score: section.max_score.toString(),
        correct_count: section.correct_count,
        wrong_count: section.wrong_count,
        unattempted_count: section.unattempted_count,
      })),
    },
  };
}
