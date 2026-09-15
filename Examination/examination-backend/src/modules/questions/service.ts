import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import type { AuthenticatedUser } from "../../shared/auth";

type QuestionDb = Pick<typeof prisma, "exams" | "exam_sections" | "questions" | "question_options" | "question_media">;
type ExamWithSections = Prisma.examsGetPayload<{ include: { exam_sections: true } }>;
type QuestionMediaRow = Prisma.question_mediaGetPayload<{}>;
type QuestionListRow = Prisma.questionsGetPayload<{ include: { question_options: true; question_media: true } }>;
type QuestionDetailRow = Prisma.questionsGetPayload<{
  include: {
    question_options: true;
    question_media: true;
    exam: { include: { exam_sections: true } };
  };
}>;

const FIXED_MCQ_LABELS = ["A", "B", "C", "D"] as const;
type FixedMcqLabel = (typeof FIXED_MCQ_LABELS)[number];

function normalizeQuestionText(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMcqOptions(
  options: Array<{ option_label: string; option_text: string | null | undefined }>,
  strict = true,
) {
  if (strict && options.length !== FIXED_MCQ_LABELS.length) {
    throw new Error("MCQ questions must contain exactly four options: A, B, C, and D.");
  }

  const optionMap = new Map<FixedMcqLabel, string>();
  for (const option of options) {
    const label = option.option_label.trim().toUpperCase();
    if (!FIXED_MCQ_LABELS.includes(label as FixedMcqLabel)) {
      throw new Error("MCQ option labels must be A, B, C, and D.");
    }
    const normalizedLabel = label as FixedMcqLabel;
    if (optionMap.has(normalizedLabel)) {
      throw new Error("MCQ option labels must be unique.");
    }
    optionMap.set(normalizedLabel, (option.option_text ?? "").toString().trim());
  }

  if (strict) {
    for (const label of FIXED_MCQ_LABELS) {
      if (!optionMap.has(label)) {
        throw new Error("MCQ questions must contain exactly four options: A, B, C, and D.");
      }
    }
  }

  return FIXED_MCQ_LABELS.map((label) => ({
    option_label: label,
    option_text: optionMap.get(label) ?? "",
  }));
}

function teacherMediaAccessUrl(examId: number, questionId: number, mediaId: number) {
  return `/api/exams/${examId}/questions/${questionId}/media/${mediaId}`;
}

function mapQuestionMedia(examId: number, questionId: number, media: QuestionMediaRow) {
  return {
    id: media.id,
    question_id: media.question_id,
    purpose: media.purpose,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    created_at: media.created_at,
    access_url: teacherMediaAccessUrl(examId, questionId, media.id),
  };
}

type CreateQuestionInput =
  | {
      section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
      question_type: "MCQ";
      question_text?: string | null;
      marks: number;
      negative_marks: number;
      difficulty?: string | null;
      topic?: string | null;
      chapter?: string | null;
      question_time_limit_seconds?: number | null;
      options: Array<{ option_label: string; option_text: string | null | undefined }>;
      correct_option_label: string;
    }
  | {
      section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
      question_type: "INTEGER";
      question_text?: string | null;
      marks: number;
      negative_marks: number;
      difficulty?: string | null;
      topic?: string | null;
      chapter?: string | null;
      question_time_limit_seconds?: number | null;
      correct_integer_answer: string;
    };

type UpdateQuestionInput = {
  question_type?: "MCQ" | "INTEGER";
  section_code?: "PHYSICS" | "CHEMISTRY" | "MATHS";
  question_text?: string | null;
  marks?: number;
  negative_marks?: number;
  difficulty?: string | null;
  topic?: string | null;
  chapter?: string | null;
  question_time_limit_seconds?: number | null;
  options?: Array<{ option_label: string; option_text: string | null | undefined }>;
  correct_option_label?: string;
  correct_integer_answer?: string;
};

type ReorderItem = {
  question_id: number;
  question_order: number;
};

function examAccessWhere(actor: AuthenticatedUser, examId: number) {
  return { id: examId };
}

async function loadEditableExam(db: QuestionDb, examId: number, actor: AuthenticatedUser) {
  return db.exams.findFirst({
    where: examAccessWhere(actor, examId),
    include: {
      exam_sections: true,
    },
  });
}

async function assertDraftExam(db: QuestionDb, examId: number, actor: AuthenticatedUser) {
  const exam = await loadEditableExam(db, examId, actor);
  if (!exam) {
    throw new Error("Exam not found.");
  }
  if (exam.status !== "DRAFT") {
    throw new Error("Questions can only be edited while the exam is in DRAFT status.");
  }
  return exam;
}

function ensureThreeSections(examSections: Array<{ section_code: string }>) {
  const codes = new Set(examSections.map((section) => section.section_code));
  if (codes.size !== 3 || !codes.has("PHYSICS") || !codes.has("CHEMISTRY") || !codes.has("MATHS")) {
    throw new Error("Exam must have exactly three configured sections.");
  }
}

async function getSectionQuestionStats(db: QuestionDb, examId: number) {
  const questions = await db.questions.findMany({
    where: { exam_id: examId },
    select: {
      section_code: true,
      is_active: true,
      question_order: true,
      id: true,
    },
  });

  return questions.reduce(
    (acc, question) => {
      const section = acc[question.section_code] ?? {
        activeCount: 0,
        maxOrder: 0,
        totalCount: 0,
      };
      section.totalCount += 1;
      if (question.is_active) {
        section.activeCount += 1;
      }
      if (question.question_order > section.maxOrder) {
        section.maxOrder = question.question_order;
      }
      acc[question.section_code] = section;
      return acc;
    },
    {
      PHYSICS: { activeCount: 0, maxOrder: 0, totalCount: 0 },
      CHEMISTRY: { activeCount: 0, maxOrder: 0, totalCount: 0 },
      MATHS: { activeCount: 0, maxOrder: 0, totalCount: 0 },
    } as Record<"PHYSICS" | "CHEMISTRY" | "MATHS", { activeCount: number; maxOrder: number; totalCount: number }>,
  );
}

function validateQuestionOptions(options: Array<{ option_label: string; option_text: string | null | undefined }>, correctLabel: string) {
  normalizeMcqOptions(options, true);
  const normalizedCorrectLabel = correctLabel.trim().toUpperCase();
  if (!FIXED_MCQ_LABELS.includes(normalizedCorrectLabel as FixedMcqLabel)) {
    throw new Error("correct_option_label must be one of A, B, C, or D.");
  }
}

async function nextQuestionOrder(db: QuestionDb, examId: number, sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS") {
  const last = await db.questions.findFirst({
    where: { exam_id: examId, section_code: sectionCode },
    orderBy: { question_order: "desc" },
    select: { question_order: true },
  });
  return (last?.question_order ?? 0) + 1;
}

async function getExamSectionTargets(db: QuestionDb, examId: number) {
  const sections = await db.exam_sections.findMany({
    where: { exam_id: examId },
    select: {
      section_code: true,
      question_count_target: true,
      section_order: true,
    },
  });
  ensureThreeSections(sections);
  return sections;
}

async function loadQuestionForEdit(db: QuestionDb, examId: number, questionId: number, actor: AuthenticatedUser): Promise<QuestionDetailRow | null> {
  const exam = await loadEditableExam(db, examId, actor);
  if (!exam) {
    return null;
  }

  return db.questions.findFirst({
    where: {
      id: questionId,
      exam_id: examId,
    },
    include: {
      question_options: {
        orderBy: { option_order: "asc" },
      },
      question_media: {
        orderBy: [
          { purpose: "asc" },
          { sort_order: "asc" },
          { created_at: "asc" },
        ],
      },
      exam: {
        include: {
          exam_sections: true,
        },
      },
    },
  });
}

function mapQuestionSummary(question: QuestionListRow) {
  return {
    id: question.id,
    exam_id: question.exam_id,
    section_code: question.section_code,
    question_type: question.question_type,
    question_order: question.question_order,
    question_text: question.question_text,
    correct_integer_answer: question.correct_integer_answer,
    answer_explanation_text: question.answer_explanation_text,
    marks: question.marks,
    negative_marks: question.negative_marks,
    difficulty: question.difficulty,
    topic: question.topic,
    chapter: question.chapter,
    source_type: question.source_type,
    is_active: question.is_active,
    created_by: question.created_by,
    updated_by: question.updated_by,
    created_at: question.created_at,
    updated_at: question.updated_at,
    question_options: question.question_options,
    question_media: question.question_media.map((media) => mapQuestionMedia(question.exam_id, question.id, media)),
  };
}

async function validateReorderTarget(db: QuestionDb, examId: number, sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS", items: ReorderItem[]) {
  const questions = await db.questions.findMany({
    where: { exam_id: examId, section_code: sectionCode },
    select: { id: true },
  });
  if (questions.length !== items.length) {
    throw new Error("Reorder payload must include every question in the section.");
  }

  const ids = new Set(questions.map((question) => question.id));
  const itemIds = new Set(items.map((item) => item.question_id));
  if (ids.size !== itemIds.size || [...ids].some((id) => !itemIds.has(id))) {
    throw new Error("Reorder payload must include only the current section questions.");
  }

  const orders = new Set<number>();
  for (const item of items) {
    if (orders.has(item.question_order)) {
      throw new Error("Question orders must be unique within a section.");
    }
    orders.add(item.question_order);
  }
}

export async function createQuestion(db: QuestionDb, examId: number, actor: AuthenticatedUser, input: CreateQuestionInput) {
  const exam = await assertDraftExam(db, examId, actor);
  const sections = await getExamSectionTargets(db, examId);
  const section = sections.find((item) => item.section_code === input.section_code);
  if (!section) {
    throw new Error(`Unknown section: ${input.section_code}`);
  }

  const stats = await getSectionQuestionStats(db, examId);
  if (stats[input.section_code].activeCount >= section.question_count_target) {
    throw new Error(`Question count target reached for ${input.section_code}.`);
  }

  if (input.question_type === "MCQ") {
    validateQuestionOptions(input.options, input.correct_option_label);
  }

  return prisma.$transaction(async (tx) => {
    const questionOrder = await nextQuestionOrder(tx, examId, input.section_code);
    const question = await tx.questions.create({
      data: {
        exam_id: examId,
        section_code: input.section_code,
        question_type: input.question_type,
        question_order: questionOrder,
        question_text: normalizeQuestionText(input.question_text),
        correct_integer_answer: input.question_type === "INTEGER" ? input.correct_integer_answer : null,
        answer_explanation_text: null,
        marks: input.marks,
        negative_marks: input.negative_marks,
        difficulty: input.difficulty ?? null,
        topic: input.topic ?? null,
        chapter: input.chapter ?? null,
        source_type: "TEXT",
        is_active: true,
        question_time_limit_seconds: input.question_time_limit_seconds ?? null,
        created_by: actor.id,
      },
    });

    if (input.question_type === "MCQ") {
      const normalizedCorrectLabel = input.correct_option_label.trim().toUpperCase();
      const normalizedOptions = normalizeMcqOptions(input.options, true);
      await tx.question_options.createMany({
        data: normalizedOptions.map((option, index) => ({
          question_id: question.id,
          option_label: option.option_label,
          option_text: option.option_text,
          option_order: index + 1,
          is_correct: option.option_label === normalizedCorrectLabel,
        })),
      });
    }

    return tx.questions.findUniqueOrThrow({
      where: { id: question.id },
      include: {
        question_options: {
          orderBy: { option_order: "asc" },
        },
        question_media: {
          orderBy: [
            { purpose: "asc" },
            { sort_order: "asc" },
            { created_at: "asc" },
          ],
        },
        exam: {
          include: {
            exam_sections: true,
          },
        },
      },
    });
  });
}

export async function listQuestions(db: QuestionDb, examId: number, actor: AuthenticatedUser) {
  const exam = await loadEditableExam(db, examId, actor);
  if (!exam) {
    throw new Error("Exam not found.");
  }

  const questions = await db.questions.findMany({
    where: { exam_id: examId },
    orderBy: [
      { section_code: "asc" },
      { question_order: "asc" },
    ],
    include: {
      question_options: {
        orderBy: { option_order: "asc" },
      },
      question_media: {
        orderBy: [
          { purpose: "asc" },
          { sort_order: "asc" },
          { created_at: "asc" },
        ],
      },
      exam: {
        include: {
          exam_sections: true,
        },
      },
    },
  });

  return {
    exam,
    questions: questions.map(mapQuestionSummary),
  };
}

export async function getQuestionDetail(db: QuestionDb, examId: number, questionId: number, actor: AuthenticatedUser) {
  const question = await loadQuestionForEdit(db, examId, questionId, actor);
  if (!question) {
    return null;
  }

  return {
    id: question.id,
    exam_id: question.exam_id,
    section_code: question.section_code,
    question_type: question.question_type,
    question_order: question.question_order,
    question_text: question.question_text,
    correct_integer_answer: question.correct_integer_answer,
    answer_explanation_text: question.answer_explanation_text,
    marks: question.marks,
    negative_marks: question.negative_marks,
    difficulty: question.difficulty,
    topic: question.topic,
    chapter: question.chapter,
    source_type: question.source_type,
    is_active: question.is_active,
    question_time_limit_seconds: question.question_time_limit_seconds ?? null,
    created_by: question.created_by,
    updated_by: question.updated_by,
    created_at: question.created_at,
    updated_at: question.updated_at,
    question_options: question.question_options,
    question_media: question.question_media.map((media) => mapQuestionMedia(question.exam_id, question.id, media)),
    exam: question.exam,
  };
}

export async function updateQuestion(db: QuestionDb, examId: number, questionId: number, actor: AuthenticatedUser, input: UpdateQuestionInput) {
  const exam = await assertDraftExam(db, examId, actor);
  const current = await loadQuestionForEdit(db, examId, questionId, actor);
  if (!current) {
    return null;
  }

  if (input.question_type && input.question_type !== current.question_type) {
    throw new Error("Question type cannot be changed after creation.");
  }

  const nextSection = input.section_code ?? current.section_code;
  const sections = await getExamSectionTargets(db, examId);
  const target = sections.find((section) => section.section_code === nextSection)?.question_count_target;
  if (target === undefined) {
    throw new Error(`Unknown section: ${nextSection}`);
  }

  const stats = await getSectionQuestionStats(db, examId);
  const currentWasActive = current.is_active;
  const sectionChange = current.section_code !== nextSection;

  if (currentWasActive && sectionChange) {
    if (stats[nextSection].activeCount >= target) {
      throw new Error(`Question count target reached for ${nextSection}.`);
    }
  }
  const nextType = input.question_type ?? current.question_type;
  if (nextType === "MCQ" && input.options && !input.correct_option_label) {
    throw new Error("correct_option_label is required when replacing MCQ options.");
  }
  if (nextType === "INTEGER" && input.options) {
    throw new Error("INTEGER questions do not accept MCQ options.");
  }
  if (nextType === "INTEGER" && input.correct_option_label !== undefined) {
    throw new Error("INTEGER questions do not accept correct_option_label.");
  }
  if (nextType === "MCQ" && input.correct_integer_answer !== undefined) {
    throw new Error("MCQ questions do not accept correct_integer_answer.");
  }

  if (nextType === "MCQ") {
    const optionsToPersist = normalizeMcqOptions(
      input.options ?? current.question_options.map((option) => ({
        option_label: option.option_label,
        option_text: option.option_text,
      })),
      true,
    );
    const correctLabel = (input.correct_option_label ?? current.question_options.find((option) => option.is_correct)?.option_label ?? "")
      .trim()
      .toUpperCase();
    if (!correctLabel) {
      throw new Error("MCQ questions require a correct option.");
    }
    validateQuestionOptions(optionsToPersist, correctLabel);
  }

  return prisma.$transaction(async (tx) => {
    const questionOrder = sectionChange ? await nextQuestionOrder(tx, examId, nextSection) : current.question_order;
    const updated = await tx.questions.update({
      where: { id: questionId },
      data: {
        section_code: nextSection,
        question_order: questionOrder,
        question_text: input.question_text !== undefined ? normalizeQuestionText(input.question_text) : current.question_text,
        marks: input.marks ?? current.marks,
        negative_marks: input.negative_marks ?? current.negative_marks,
        difficulty: input.difficulty !== undefined ? input.difficulty : current.difficulty,
        topic: input.topic ?? null,
        chapter: input.chapter ?? null,
        correct_integer_answer:
          nextType === "INTEGER"
            ? input.correct_integer_answer ?? current.correct_integer_answer
            : null,
        question_time_limit_seconds:
          input.question_time_limit_seconds !== undefined
            ? input.question_time_limit_seconds
            : current.question_time_limit_seconds,
        updated_by: actor.id,
      },
    });

    if (nextType === "MCQ") {
      const optionsToPersist = normalizeMcqOptions(
        input.options ?? current.question_options.map((option) => ({
          option_label: option.option_label,
          option_text: option.option_text,
        })),
        true,
      );
      const correctLabel = (input.correct_option_label ?? current.question_options.find((option) => option.is_correct)?.option_label ?? "")
        .trim()
        .toUpperCase();
      if (!correctLabel) {
        throw new Error("MCQ questions require a correct option.");
      }
      await tx.question_options.deleteMany({
        where: { question_id: questionId },
      });
      await tx.question_options.createMany({
        data: optionsToPersist.map((option, index) => ({
          question_id: questionId,
          option_label: option.option_label,
          option_text: option.option_text,
          option_order: index + 1,
          is_correct: option.option_label === correctLabel,
        })),
      });
    }

    return tx.questions.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        question_options: {
          orderBy: { option_order: "asc" },
        },
        question_media: {
          orderBy: [
            { purpose: "asc" },
            { sort_order: "asc" },
            { created_at: "asc" },
          ],
        },
        exam: {
          include: {
            exam_sections: true,
          },
        },
      },
    });
  });
}

export async function deactivateQuestion(db: QuestionDb, examId: number, questionId: number, actor: AuthenticatedUser) {
  const exam = await assertDraftExam(db, examId, actor);
  const current = await loadQuestionForEdit(db, examId, questionId, actor);
  if (!current) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    return tx.questions.update({
      where: { id: questionId },
      data: {
        is_active: false,
        updated_by: actor.id,
      },
      include: {
        question_options: {
          orderBy: { option_order: "asc" },
        },
        exam: {
          include: {
            exam_sections: true,
          },
        },
      },
    });
  });
}

export async function reorderQuestions(db: QuestionDb, examId: number, actor: AuthenticatedUser, sectionCode: "PHYSICS" | "CHEMISTRY" | "MATHS", items: ReorderItem[]) {
  const exam = await assertDraftExam(db, examId, actor);
  const section = exam.exam_sections.find((entry) => entry.section_code === sectionCode);
  if (!section) {
    throw new Error(`Unknown section: ${sectionCode}`);
  }

  await validateReorderTarget(db, examId, sectionCode, items);
  const maxOrder = Math.max(...items.map((item) => item.question_order));
  if (maxOrder > section.question_count_target) {
    throw new Error(`Question order cannot exceed target count for ${sectionCode}.`);
  }

  return prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.questions.update({
        where: { id: item.question_id },
        data: { question_order: item.question_order },
      });
    }

    const questions = await tx.questions.findMany({
      where: { exam_id: examId, section_code: sectionCode },
      include: {
        question_options: { orderBy: { option_order: "asc" } },
        question_media: { orderBy: [{ purpose: "asc" }, { sort_order: "asc" }, { created_at: "asc" }] },
      },
      orderBy: { question_order: "asc" },
    });

    return questions.map((q) => mapQuestionSummary(q));
  });
}
