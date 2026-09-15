import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { ExamStatus, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import type { AuthenticatedUser } from "../../shared/auth";

type PaperDb = typeof prisma;
type PaperTransactionDb = Prisma.TransactionClient;

const FIXED_SECTION_CODES = ["PHYSICS", "CHEMISTRY", "MATHS"] as const;
const FIXED_MCQ_LABELS = ["A", "B", "C", "D"] as const;
type FixedSectionCode = (typeof FIXED_SECTION_CODES)[number];
type FixedMcqLabel = (typeof FIXED_MCQ_LABELS)[number];

type SectionInput = {
  section_code: FixedSectionCode;
  question_count_target: number;
  default_marks: number;
  default_negative_marks: number;
};

type QuestionPaperCreateInput = {
  title: string;
  batch_id?: number | null;
  category?: string | null;
  instructions?: string | null;
  is_self_practice_enabled?: boolean;
  self_practice_duration_seconds?: number | null;
  self_practice_solution_policy?: "AFTER_SUBMIT" | "AFTER_CORRECT" | "AFTER_TWO_WRONG" | "NEVER" | null;
  sections?: SectionInput[];
};

type QuestionPaperUpdateInput = {
  title?: string;
  batch_id?: number | null;
  category?: string | null;
  instructions?: string | null;
  is_self_practice_enabled?: boolean;
  self_practice_duration_seconds?: number | null;
  self_practice_solution_policy?: "AFTER_SUBMIT" | "AFTER_CORRECT" | "AFTER_TWO_WRONG" | "NEVER" | null;
  sections?: SectionInput[];
};

type PaperQuestionCreateInput = {
  section_code: FixedSectionCode;
  question_type: "MCQ" | "INTEGER";
  question_text?: string | null;
  marks?: number;
  negative_marks?: number;
  options?: Array<{ option_label: FixedMcqLabel; option_text?: string | null }>;
  correct_option_label?: FixedMcqLabel;
  correct_integer_answer?: string;
};

type PaperQuestionUpdateInput = {
  section_code?: FixedSectionCode;
  question_type?: "MCQ" | "INTEGER";
  question_text?: string | null;
  marks?: number;
  negative_marks?: number;
  options?: Array<{ option_label: FixedMcqLabel; option_text?: string | null }>;
  correct_option_label?: FixedMcqLabel;
  correct_integer_answer?: string;
  is_active?: boolean;
};

type ReorderItem = {
  question_id: number;
  question_order: number;
};

type PaperMediaUploadInput = {
  purpose: "QUESTION" | "SOLUTION";
  sortOrder: number;
  file: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
  };
};

type ScheduleExamInput = {
  question_paper_id: number;
  title: string;
  batch_id?: number | null;
  /** When provided, overrides batch_id — one exam is created and assigned to all listed batches. */
  batch_ids?: number[] | null;
  exam_mode: "LIVE" | "PRACTICE";
  scheduled_at: string;
  duration_seconds: number;
  solution_release_policy: "AFTER_EXAM_END" | "AFTER_RESULT_RELEASE" | "NEVER" | "PRACTICE_UNLOCK_RULE";
  section_delivery?: Array<{ section_code: FixedSectionCode; questions_to_deliver: number; section_time_limit_seconds?: number | null }>;
};

const QUESTION_PAPER_MEDIA_ROOT = path.resolve(process.cwd(), "uploads/question-paper-media");

function accessWhere(actor: AuthenticatedUser, paperId: number) {
  return { id: paperId };
}

function normalizeQuestionText(value?: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIntegerAnswer(value: string) {
  const trimmed = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("INTEGER answers must be a number (decimals like 1.25 are allowed).");
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

function normalizeMcqOptions(options: Array<{ option_label: string; option_text?: string | null }>) {
  if (options.length !== FIXED_MCQ_LABELS.length) {
    throw new Error("MCQ questions must contain exactly four options: A, B, C, and D.");
  }

  const map = new Map<FixedMcqLabel, string>();
  for (const option of options) {
    const label = option.option_label.trim().toUpperCase() as FixedMcqLabel;
    if (!FIXED_MCQ_LABELS.includes(label)) {
      throw new Error("MCQ option labels must be A, B, C, and D.");
    }
    if (map.has(label)) {
      throw new Error("MCQ option labels must be unique.");
    }
    map.set(label, (option.option_text ?? "").trim());
  }

  for (const label of FIXED_MCQ_LABELS) {
    if (!map.has(label)) {
      throw new Error("MCQ questions must contain exactly four options: A, B, C, and D.");
    }
  }

  return FIXED_MCQ_LABELS.map((label) => ({
    option_label: label,
    option_text: map.get(label) ?? "",
  }));
}

function fixedSectionDefaults(): SectionInput[] {
  return [
    {
      section_code: "PHYSICS",
      question_count_target: 30,
      default_marks: 4,
      default_negative_marks: 1,
    },
    {
      section_code: "CHEMISTRY",
      question_count_target: 30,
      default_marks: 4,
      default_negative_marks: 1,
    },
    {
      section_code: "MATHS",
      question_count_target: 30,
      default_marks: 4,
      default_negative_marks: 1,
    },
  ];
}

function normalizeSectionsInput(sections?: SectionInput[]) {
  if (!sections || sections.length === 0) {
    return fixedSectionDefaults().map((section, index) => ({
      ...section,
      section_order: index + 1,
    }));
  }

  if (sections.length !== 3) {
    throw new Error("Exactly three sections are required: PHYSICS, CHEMISTRY, MATHS.");
  }

  const expected = new Set<FixedSectionCode>(FIXED_SECTION_CODES);
  const incoming = new Set(sections.map((section) => section.section_code));
  if (expected.size !== incoming.size || [...expected].some((code) => !incoming.has(code))) {
    throw new Error("Exactly three sections are required: PHYSICS, CHEMISTRY, MATHS.");
  }

  return FIXED_SECTION_CODES.map((section_code, index) => {
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

function sectionSummaryWithCounts(
  section: {
    section_code: FixedSectionCode;
    section_order: number;
    question_count_target: number;
    default_marks: Prisma.Decimal;
    default_negative_marks: Prisma.Decimal;
  },
  counts: { total: number; active: number },
) {
  return {
    ...section,
    question_count: counts.total,
    active_question_count: counts.active,
  };
}

async function loadQuestionPaperCountMap(db: PaperDb, paperId: number) {
  const questions = await db.paper_questions.findMany({
    where: { question_paper_id: paperId },
    select: {
      section_code: true,
      is_active: true,
    },
  });

  return questions.reduce(
    (acc, question) => {
      const key = question.section_code as FixedSectionCode;
      const current = acc[key] ?? { total: 0, active: 0 };
      current.total += 1;
      if (question.is_active) {
        current.active += 1;
      }
      acc[key] = current;
      return acc;
    },
    {
      PHYSICS: { total: 0, active: 0 },
      CHEMISTRY: { total: 0, active: 0 },
      MATHS: { total: 0, active: 0 },
    } as Record<FixedSectionCode, { total: number; active: number }>,
  );
}

async function loadQuestionPaperDetail(db: PaperDb, paperId: number, actor: AuthenticatedUser) {
  const paper = await db.question_papers.findFirst({
    where: accessWhere(actor, paperId),
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
      sections: {
        orderBy: {
          section_order: "asc",
        },
      },
    },
  });

  if (!paper) {
    return null;
  }

  const counts = await loadQuestionPaperCountMap(db, paper.id);
  return {
    ...paper,
    sections: paper.sections.map((section) => sectionSummaryWithCounts(section, counts[section.section_code as FixedSectionCode])),
  };
}

function questionMediaAccessUrl(paperId: number, questionId: number, mediaId: number) {
  return `/api/question-papers/${paperId}/questions/${questionId}/media/${mediaId}`;
}

function mapSourceMedia(paperId: number, questionId: number, media: {
  id: number;
  paper_question_id: number;
  purpose: "QUESTION" | "SOLUTION";
  storage_url: string;
  mime_type: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  uploaded_by: number;
  created_at: Date;
}) {
  return {
    id: media.id,
    question_id: media.paper_question_id,
    purpose: media.purpose,
    storage_url: media.storage_url,
    mime_type: media.mime_type,
    checksum: media.checksum,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    uploaded_by: media.uploaded_by,
    created_at: media.created_at,
    access_url: questionMediaAccessUrl(paperId, questionId, media.id),
  };
}

async function loadEditablePaper(db: PaperDb, paperId: number, actor: AuthenticatedUser) {
  return db.question_papers.findFirst({
    where: accessWhere(actor, paperId),
    include: {
      sections: {
        orderBy: {
          section_order: "asc",
        },
      },
    },
  });
}

async function assertEditablePaper(db: PaperDb, paperId: number, actor: AuthenticatedUser) {
  const paper = await loadEditablePaper(db, paperId, actor);
  if (!paper) {
    throw new Error("Question paper not found.");
  }
  if (paper.status === "ARCHIVED") {
    throw new Error("Question paper is archived.");
  }
  return paper;
}

async function getNextQuestionOrder(db: PaperDb, paperId: number, sectionCode: FixedSectionCode) {
  const last = await db.paper_questions.findFirst({
    where: {
      question_paper_id: paperId,
      section_code: sectionCode,
    },
    orderBy: {
      question_order: "desc",
    },
    select: {
      question_order: true,
    },
  });

  return (last?.question_order ?? 0) + 1;
}

function ensureActiveQuestionTarget(counts: Record<FixedSectionCode, { total: number; active: number }>, section: { section_code: FixedSectionCode; question_count_target: number }) {
  if (section.question_count_target > 0 && counts[section.section_code].active >= section.question_count_target) {
    throw new Error(`Question count target reached for ${section.section_code}.`);
  }
}

async function loadQuestionForEdit(db: PaperDb, paperId: number, questionId: number, actor: AuthenticatedUser) {
  const paper = await assertEditablePaper(db, paperId, actor);
  const question = await db.paper_questions.findFirst({
    where: {
      id: questionId,
      question_paper_id: paperId,
    },
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
  });

  if (!question) {
    return null;
  }

  return { paper, question };
}

function mapQuestionResponse(paperId: number, question: {
  id: number;
  question_paper_id: number;
  section_code: FixedSectionCode;
  question_type: "MCQ" | "INTEGER";
  question_order: number;
  question_text: string | null;
  correct_integer_answer: string | null;
  marks: Prisma.Decimal;
  negative_marks: Prisma.Decimal;
  is_active: boolean;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  options: Array<{
    id: number;
    paper_question_id: number;
    option_label: string;
    option_text: string | null;
    option_order: number;
    is_correct: boolean;
    created_at: Date;
    updated_at: Date;
  }>;
  media: Array<{
    id: number;
    paper_question_id: number;
    purpose: "QUESTION" | "SOLUTION";
    storage_url: string;
    mime_type: string;
    checksum: string | null;
    width: number | null;
    height: number | null;
    sort_order: number;
    uploaded_by: number;
    created_at: Date;
  }>;
}) {
  return {
    id: question.id,
    question_paper_id: question.question_paper_id,
    section_code: question.section_code,
    question_type: question.question_type,
    question_order: question.question_order,
    question_text: question.question_text,
    correct_integer_answer: question.correct_integer_answer,
    marks: question.marks,
    negative_marks: question.negative_marks,
    is_active: question.is_active,
    created_by: question.created_by,
    created_at: question.created_at,
    updated_at: question.updated_at,
    question_options: question.options,
    question_media: question.media.map((media) => mapSourceMedia(paperId, question.id, media)),
  };
}

function resolveStorageDirectory(purpose: "QUESTION" | "SOLUTION") {
  return path.resolve(QUESTION_PAPER_MEDIA_ROOT, purpose.toLowerCase());
}

function resolveStorageUrl(purpose: "QUESTION" | "SOLUTION", filename: string) {
  return `/uploads/question-paper-media/${purpose.toLowerCase()}/${filename}`;
}

function resolveAbsoluteStoragePath(storageUrl: string) {
  return path.resolve(process.cwd(), storageUrl.replace(/^\//, ""));
}

function fileNameFrom(paperId: number, questionId: number, purpose: "QUESTION" | "SOLUTION", extension: string) {
  return `${paperId}-${questionId}-${purpose.toLowerCase()}-${crypto.randomUUID()}.${extension}`;
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function detectMimeType(buffer: Buffer) {
  if (buffer.length < 12) {
    return null;
  }

  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (isPng) {
    return "image/png";
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) {
    return "image/jpeg";
  }

  const isWebp = buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (isWebp) {
    return "image/webp";
  }

  return null;
}

function validateImageUpload(file: PaperMediaUploadInput["file"]) {
  const detected = detectMimeType(file.buffer);
  if (!detected) {
    throw new Error("Only JPEG, PNG, and WEBP images are allowed.");
  }

  const extension = extensionForMimeType(detected);
  if (!extension) {
    throw new Error("Unsupported image type.");
  }

  return {
    mimeType: detected,
    extension,
  };
}

async function ensureStorageDirectory(purpose: "QUESTION" | "SOLUTION") {
  const directory = resolveStorageDirectory(purpose);
  await mkdir(directory, { recursive: true });
  return directory;
}

function countWarnings(sections: Array<{ section_code: FixedSectionCode; question_count_target: number }>, counts: Record<FixedSectionCode, { active: number }>) {
  const warnings: string[] = [];
  for (const section of sections) {
    const active = counts[section.section_code].active;
    if (section.question_count_target > 0 && active !== section.question_count_target) {
      warnings.push(`Section ${section.section_code} has ${active} active questions but target is ${section.question_count_target}.`);
    }
  }
  return warnings;
}

function resolveQuestionSourceType(question: {
  question_text: string | null;
  media: Array<{ purpose: "QUESTION" | "SOLUTION" }>;
}) {
  const hasQuestionMedia = question.media.some((item) => item.purpose === "QUESTION");
  if (hasQuestionMedia && question.question_text) {
    return "MIXED" as const;
  }
  if (hasQuestionMedia) {
    return "IMAGE" as const;
  }
  return "TEXT" as const;
}

async function copySnapshotQuestionRows(tx: PaperTransactionDb, args: {
  examId: number;
  actorId: number;
  sourceQuestion: {
    id: number;
    section_code: FixedSectionCode;
    question_type: "MCQ" | "INTEGER";
    question_order: number;
    question_text: string | null;
    correct_integer_answer: string | null;
    marks: Prisma.Decimal;
    negative_marks: Prisma.Decimal;
    is_active: boolean;
    options: Array<{
      id: number;
      option_label: string;
      option_text: string | null;
      option_order: number;
      is_correct: boolean;
    }>;
    media: Array<{
      id: number;
      purpose: "QUESTION" | "SOLUTION";
      storage_url: string;
      mime_type: string;
      checksum: string | null;
      width: number | null;
      height: number | null;
      sort_order: number;
      uploaded_by: number;
    }>;
  };
}) {
  const { examId, actorId, sourceQuestion } = args;
  const snapshotQuestion = await tx.questions.create({
    data: {
      exam_id: examId,
      section_code: sourceQuestion.section_code,
      question_type: sourceQuestion.question_type,
      question_order: sourceQuestion.question_order,
      question_text: sourceQuestion.question_text,
      correct_integer_answer: sourceQuestion.correct_integer_answer,
      answer_explanation_text: null,
      marks: sourceQuestion.marks,
      negative_marks: sourceQuestion.negative_marks,
      difficulty: null,
      topic: null,
      chapter: null,
      source_type: resolveQuestionSourceType(sourceQuestion),
      is_active: sourceQuestion.is_active,
      created_by: actorId,
    },
  });

  if (sourceQuestion.question_type === "MCQ") {
    await tx.question_options.createMany({
      data: sourceQuestion.options.map((option) => ({
        question_id: snapshotQuestion.id,
        option_label: option.option_label,
        option_text: option.option_text ?? "",
        option_order: option.option_order,
        is_correct: option.is_correct,
      })),
    });
  }

  if (sourceQuestion.media.length > 0) {
    await tx.question_media.createMany({
      data: sourceQuestion.media.map((media) => ({
        question_id: snapshotQuestion.id,
        purpose: media.purpose,
        storage_url: media.storage_url,
        mime_type: media.mime_type,
        checksum: media.checksum,
        width: media.width,
        height: media.height,
        sort_order: media.sort_order,
        uploaded_by: media.uploaded_by,
      })),
    });
  }

  return snapshotQuestion;
}

async function getVersionSummary(db: PaperDb, versionId: number) {
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
      },
    },
  });

  if (!version) {
    return null;
  }

  return {
    id: version.id,
    question_paper_id: version.question_paper_id,
    version_number: version.version_number,
    title_snapshot: version.title_snapshot,
    instructions_snapshot: version.instructions_snapshot,
    created_from_status: version.created_from_status,
    created_by: version.created_by,
    created_at: version.created_at,
    section_count: version.sections.length,
    question_count: version.questions.length,
    sections: version.sections.map((section) => ({
      id: section.id,
      version_id: section.version_id,
      section_code: section.section_code,
      section_order: section.section_order,
      question_count_target: section.question_count_target,
      default_marks: section.default_marks,
      default_negative_marks: section.default_negative_marks,
    })),
  };
}

export async function listQuestionPapers(db: PaperDb, actor: AuthenticatedUser, includeArchived = true) {
  const papers = await db.question_papers.findMany({
    where: includeArchived
      ? {}
      : { status: "DRAFT" },
    orderBy: {
      created_at: "desc",
    },
    include: {
      batch: true,
      sections: {
        orderBy: {
          section_order: "asc",
        },
      },
    },
  });

  const results = [];
  for (const paper of papers) {
    const counts = await loadQuestionPaperCountMap(db, paper.id);
    results.push({
      ...paper,
      sections: paper.sections.map((section) => sectionSummaryWithCounts(section, counts[section.section_code as FixedSectionCode])),
    });
  }

  return results;
}

export async function createQuestionPaper(db: PaperDb, actor: AuthenticatedUser, input: QuestionPaperCreateInput) {
  const sections = normalizeSectionsInput(input.sections);
  const paper = await db.$transaction(async (tx) => {
    const created = await tx.question_papers.create({
      data: {
        title: input.title,
        batch_id: input.batch_id ?? null,
        category: input.category ?? null,
        status: "DRAFT",
        instructions: input.instructions ?? null,
        is_self_practice_enabled: input.is_self_practice_enabled ?? false,
        self_practice_duration_seconds: input.self_practice_duration_seconds ?? null,
        self_practice_solution_policy:
          input.is_self_practice_enabled === true
            ? input.self_practice_solution_policy ?? "AFTER_SUBMIT"
            : input.self_practice_solution_policy ?? null,
        created_by: actor.id,
      },
    });

    await tx.question_paper_sections.createMany({
      data: sections.map((section) => ({
        question_paper_id: created.id,
        section_code: section.section_code,
        section_order: section.section_order,
        question_count_target: section.question_count_target,
        default_marks: section.default_marks,
        default_negative_marks: section.default_negative_marks,
      })),
    });

    return created;
  });

  return loadQuestionPaperDetail(db, paper.id, actor);
}

export async function updateQuestionPaper(db: PaperDb, paperId: number, actor: AuthenticatedUser, input: QuestionPaperUpdateInput) {
  const paper = await assertEditablePaper(db, paperId, actor);
  const sections = input.sections ? normalizeSectionsInput(input.sections) : null;

  await db.$transaction(async (tx) => {
    await tx.question_papers.update({
      where: { id: paper.id },
      data: {
        title: input.title ?? paper.title,
        batch_id: input.batch_id !== undefined ? input.batch_id : paper.batch_id,
        category: input.category !== undefined ? input.category : paper.category,
        instructions: input.instructions !== undefined ? input.instructions : paper.instructions,
        is_self_practice_enabled:
          input.is_self_practice_enabled !== undefined ? input.is_self_practice_enabled : paper.is_self_practice_enabled,
        self_practice_duration_seconds:
          input.self_practice_duration_seconds !== undefined
            ? input.self_practice_duration_seconds
            : paper.self_practice_duration_seconds,
        self_practice_solution_policy:
          input.self_practice_solution_policy !== undefined
            ? input.self_practice_solution_policy
            : paper.self_practice_solution_policy,
      },
    });

    if (sections) {
      await tx.question_paper_sections.deleteMany({
        where: { question_paper_id: paper.id },
      });
      await tx.question_paper_sections.createMany({
        data: sections.map((section) => ({
          question_paper_id: paper.id,
          section_code: section.section_code,
          section_order: section.section_order,
          question_count_target: section.question_count_target,
          default_marks: section.default_marks,
          default_negative_marks: section.default_negative_marks,
        })),
      });
    }
  });

  return loadQuestionPaperDetail(db, paper.id, actor);
}

export async function archiveQuestionPaper(db: PaperDb, paperId: number, actor: AuthenticatedUser) {
  const paper = await assertEditablePaper(db, paperId, actor);
  await db.question_papers.update({
    where: { id: paper.id },
    data: {
      status: "ARCHIVED",
    },
  });

  return loadQuestionPaperDetail(db, paper.id, actor);
}

export async function getQuestionPaper(db: PaperDb, paperId: number, actor: AuthenticatedUser) {
  return loadQuestionPaperDetail(db, paperId, actor);
}

export async function listPaperQuestions(db: PaperDb, paperId: number, actor: AuthenticatedUser, includeInactive = true) {
  const paper = await assertEditablePaper(db, paperId, actor);
  const questions = await db.paper_questions.findMany({
    where: {
      question_paper_id: paper.id,
      ...(includeInactive ? {} : { is_active: true }),
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
  });

  return {
    paper: await loadQuestionPaperDetail(db, paper.id, actor),
    questions: questions.map((question) => mapQuestionResponse(paper.id, question)),
  };
}

type ExistingPaperQuestion = {
  section_code: FixedSectionCode;
  question_type: "MCQ" | "INTEGER";
  marks: Prisma.Decimal;
  negative_marks: Prisma.Decimal;
  is_active: boolean;
  question_text: string | null;
  correct_integer_answer: string | null;
  options: Array<{
    option_label: string;
    option_text: string | null;
    option_order: number;
    is_correct: boolean;
  }>;
};

function normalizeQuestionInput(paper: Awaited<ReturnType<typeof assertEditablePaper>>, input: PaperQuestionCreateInput | PaperQuestionUpdateInput, currentQuestion?: ExistingPaperQuestion) {
  const nextSection = input.section_code ?? currentQuestion?.section_code ?? undefined;
  if (!nextSection) {
    throw new Error("section_code is required.");
  }

  const section = paper.sections.find((entry) => entry.section_code === nextSection);
  if (!section) {
    throw new Error(`Unknown section: ${nextSection}`);
  }

  const nextType = input.question_type ?? currentQuestion?.question_type;
  if (!nextType) {
    throw new Error("question_type is required.");
  }

  const nextMarks = input.marks ?? currentQuestion?.marks?.toNumber?.() ?? section.default_marks;
  const nextNegative = input.negative_marks ?? currentQuestion?.negative_marks?.toNumber?.() ?? section.default_negative_marks;

  return {
    section,
    nextSection,
    nextType,
    nextMarks,
    nextNegative,
  };
}

export async function createPaperQuestion(db: PaperDb, paperId: number, actor: AuthenticatedUser, input: PaperQuestionCreateInput) {
  const paper = await assertEditablePaper(db, paperId, actor);
  const counts = await loadQuestionPaperCountMap(db, paper.id);
  const section = paper.sections.find((entry) => entry.section_code === input.section_code);
  if (!section) {
    throw new Error(`Unknown section: ${input.section_code}`);
  }
  ensureActiveQuestionTarget(counts, section);

  const questionOrder = await getNextQuestionOrder(db, paper.id, input.section_code);
  const normalizedText = normalizeQuestionText(input.question_text);

  const created = await db.$transaction(async (tx) => {
    const question = await tx.paper_questions.create({
      data: {
        question_paper_id: paper.id,
        section_code: input.section_code,
        question_type: input.question_type,
        question_order: questionOrder,
        question_text: normalizedText,
        correct_integer_answer:
          input.question_type === "INTEGER"
            ? input.correct_integer_answer
              ? normalizeIntegerAnswer(input.correct_integer_answer)
              : null
            : null,
        marks: input.marks ?? section.default_marks,
        negative_marks: input.negative_marks ?? section.default_negative_marks,
        is_active: true,
        created_by: actor.id,
      },
    });

    if (input.question_type === "MCQ") {
      if (!input.options || !input.correct_option_label) {
        throw new Error("MCQ questions require four options and a correct option label.");
      }
      const options = normalizeMcqOptions(input.options);
      await tx.paper_question_options.createMany({
        data: options.map((option, index) => ({
          paper_question_id: question.id,
          option_label: option.option_label,
          option_text: option.option_text,
          option_order: index + 1,
          is_correct: option.option_label === input.correct_option_label,
        })),
      });
    }

    return tx.paper_questions.findUniqueOrThrow({
      where: { id: question.id },
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
    });
  });

  return mapQuestionResponse(paper.id, created);
}

export async function getPaperQuestion(db: PaperDb, paperId: number, questionId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionForEdit(db, paperId, questionId, actor);
  if (!loaded) {
    return null;
  }

  return mapQuestionResponse(loaded.paper.id, loaded.question);
}

export async function updatePaperQuestion(db: PaperDb, paperId: number, questionId: number, actor: AuthenticatedUser, input: PaperQuestionUpdateInput) {
  const loaded = await loadQuestionForEdit(db, paperId, questionId, actor);
  if (!loaded) {
    return null;
  }

  const current = loaded.question;
  if (input.question_type && input.question_type !== current.question_type) {
    throw new Error("Question type cannot be changed after creation.");
  }

  const normalized = normalizeQuestionInput(loaded.paper, input, current);
  const nextIsActive = input.is_active ?? current.is_active;
  const counts = await loadQuestionPaperCountMap(db, loaded.paper.id);
  if (nextIsActive && (input.section_code && input.section_code !== current.section_code || !current.is_active)) {
    ensureActiveQuestionTarget(counts, normalized.section);
  }

  const nextQuestionOrder = input.section_code && input.section_code !== current.section_code ? await getNextQuestionOrder(db, loaded.paper.id, normalized.nextSection) : current.question_order;
  const nextText = input.question_text !== undefined ? normalizeQuestionText(input.question_text) : current.question_text;

  if (normalized.nextType === "MCQ") {
    const options = input.options ?? current.options.map((option) => ({
      option_label: option.option_label as FixedMcqLabel,
      option_text: option.option_text,
    }));
    normalizeMcqOptions(options);
    if (!input.correct_option_label && !current.options.some((option) => option.is_correct)) {
      throw new Error("MCQ questions require a correct option label.");
    }
  }

  if (normalized.nextType === "INTEGER" && input.options) {
    throw new Error("INTEGER questions do not accept MCQ options.");
  }

  const updated = await db.$transaction(async (tx) => {
    const question = await tx.paper_questions.update({
      where: { id: current.id },
      data: {
        section_code: normalized.nextSection,
        question_type: normalized.nextType,
        question_order: nextQuestionOrder,
        question_text: nextText,
        correct_integer_answer:
          normalized.nextType === "INTEGER"
            ? input.correct_integer_answer !== undefined
              ? normalizeIntegerAnswer(input.correct_integer_answer)
              : current.correct_integer_answer
            : null,
        marks: input.marks ?? (input.section_code && input.section_code !== current.section_code ? normalized.section.default_marks : current.marks),
        negative_marks: input.negative_marks ?? (input.section_code && input.section_code !== current.section_code ? normalized.section.default_negative_marks : current.negative_marks),
        is_active: nextIsActive,
      },
    });

    if (normalized.nextType === "MCQ") {
      const nextOptions = normalizeMcqOptions(
        input.options ?? current.options.map((option) => ({
          option_label: option.option_label as FixedMcqLabel,
          option_text: option.option_text,
        })),
      );
      const correctLabel =
        input.correct_option_label ??
        (current.options.find((option) => option.is_correct)?.option_label as FixedMcqLabel | undefined) ??
        null;
      if (!correctLabel) {
        throw new Error("MCQ questions require a correct option label.");
      }

      await tx.paper_question_options.deleteMany({
        where: { paper_question_id: current.id },
      });
      await tx.paper_question_options.createMany({
        data: nextOptions.map((option, index) => ({
          paper_question_id: current.id,
          option_label: option.option_label,
          option_text: option.option_text,
          option_order: index + 1,
          is_correct: option.option_label === correctLabel,
        })),
      });
    }

    return tx.paper_questions.findUniqueOrThrow({
      where: { id: question.id },
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
    });
  });

  return mapQuestionResponse(loaded.paper.id, updated);
}

export async function deletePaperQuestion(db: PaperDb, paperId: number, questionId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionForEdit(db, paperId, questionId, actor);
  if (!loaded) {
    return null;
  }

  const updated = await db.paper_questions.update({
    where: { id: loaded.question.id },
    data: {
      is_active: false,
    },
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
  });

  return mapQuestionResponse(loaded.paper.id, updated);
}

export async function reorderPaperQuestions(db: PaperDb, paperId: number, actor: AuthenticatedUser, sectionCode: FixedSectionCode, items: ReorderItem[]) {
  const paper = await assertEditablePaper(db, paperId, actor);
  const section = paper.sections.find((entry) => entry.section_code === sectionCode);
  if (!section) {
    throw new Error(`Unknown section: ${sectionCode}`);
  }

  const questions = await db.paper_questions.findMany({
    where: { question_paper_id: paper.id, section_code: sectionCode },
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

  const maxOrder = Math.max(...items.map((item) => item.question_order));
  if (section.question_count_target > 0 && maxOrder > section.question_count_target) {
    throw new Error(`Question order cannot exceed target count for ${sectionCode}.`);
  }

  await db.$transaction(async (tx) => {
    for (const item of items) {
      await tx.paper_questions.update({
        where: { id: item.question_id },
        data: {
          question_order: -1000 - item.question_order,
        },
      });
    }

    for (const item of items) {
      await tx.paper_questions.update({
        where: { id: item.question_id },
        data: {
          question_order: item.question_order,
        },
      });
    }
  });

  const reordered = await db.paper_questions.findMany({
    where: {
      question_paper_id: paper.id,
      section_code: sectionCode,
    },
    orderBy: {
      question_order: "asc",
    },
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
  });

  return reordered.map((question) => mapQuestionResponse(paper.id, question));
}

export async function listPaperQuestionMedia(db: PaperDb, paperId: number, questionId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionForEdit(db, paperId, questionId, actor);
  if (!loaded) {
    throw new Error("Question not found.");
  }

  const media = await db.paper_question_media.findMany({
    where: {
      paper_question_id: loaded.question.id,
    },
    orderBy: [
      { purpose: "asc" },
      { sort_order: "asc" },
      { created_at: "asc" },
    ],
  });

  return {
    paper: loaded.paper,
    question: loaded.question,
    media: media.map((entry) => ({
      id: entry.id,
      question_id: entry.paper_question_id,
      purpose: entry.purpose,
      storage_url: entry.storage_url,
      mime_type: entry.mime_type,
      checksum: entry.checksum,
      width: entry.width,
      height: entry.height,
      sort_order: entry.sort_order,
      uploaded_by: entry.uploaded_by,
      created_at: entry.created_at,
      access_url: questionMediaAccessUrl(paperId, questionId, entry.id),
    })),
  };
}

async function loadQuestionPaperMediaById(db: PaperDb, paperId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  // Use the read-only paper check so teachers can view images from archived papers.
  // assertEditablePaper (used by loadQuestionForEdit) throws for ARCHIVED status,
  // which would make all question images disappear after an exam is closed.
  const paper = await loadEditablePaper(db, paperId, actor);
  if (!paper) {
    return null;
  }
  const question = await db.paper_questions.findFirst({
    where: { id: questionId, question_paper_id: paperId },
  });
  if (!question) {
    return null;
  }
  const loaded = { paper, question };

  const media = await db.paper_question_media.findFirst({
    where: {
      id: mediaId,
      paper_question_id: loaded.question.id,
    },
  });

  if (!media) {
    return null;
  }

  return {
    paper: loaded.paper,
    question: loaded.question,
    media,
  };
}

export async function readPaperQuestionMediaFile(db: PaperDb, paperId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionPaperMediaById(db, paperId, questionId, mediaId, actor);
  if (!loaded) {
    return null;
  }

  const absolutePath = resolveAbsoluteStoragePath(loaded.media.storage_url);
  await stat(absolutePath);

  return {
    media: loaded.media,
    absolutePath,
  };
}

export async function uploadPaperQuestionMedia(db: PaperDb, paperId: number, questionId: number, actor: AuthenticatedUser, input: PaperMediaUploadInput) {
  const loaded = await loadQuestionForEdit(db, paperId, questionId, actor);
  if (!loaded) {
    throw new Error("Question not found.");
  }

  const { mimeType, extension } = validateImageUpload(input.file);
  const directory = await ensureStorageDirectory(input.purpose);
  const filename = fileNameFrom(paperId, questionId, input.purpose, extension);
  const relativeUrl = resolveStorageUrl(input.purpose, filename);
  const absolutePath = path.resolve(directory, filename);
  const checksum = crypto.createHash("sha256").update(input.file.buffer).digest("hex");

  await writeFile(absolutePath, input.file.buffer);

  try {
    const media = await db.paper_question_media.create({
      data: {
        paper_question_id: loaded.question.id,
        purpose: input.purpose,
        storage_url: relativeUrl,
        mime_type: mimeType,
        checksum,
        width: null,
        height: null,
        sort_order: input.sortOrder,
        uploaded_by: actor.id,
      },
    });

    return media;
  } catch (error) {
    await rm(absolutePath, { force: true });
    throw error;
  }
}

export async function replacePaperQuestionMedia(db: PaperDb, paperId: number, questionId: number, mediaId: number, actor: AuthenticatedUser, input: PaperMediaUploadInput) {
  const loaded = await loadQuestionPaperMediaById(db, paperId, questionId, mediaId, actor);
  if (!loaded) {
    throw new Error("Media not found.");
  }

  const { mimeType, extension } = validateImageUpload(input.file);
  const directory = await ensureStorageDirectory(input.purpose);
  const filename = fileNameFrom(paperId, questionId, input.purpose, extension);
  const relativeUrl = resolveStorageUrl(input.purpose, filename);
  const absolutePath = path.resolve(directory, filename);
  const checksum = crypto.createHash("sha256").update(input.file.buffer).digest("hex");

  await writeFile(absolutePath, input.file.buffer);

  try {
    const updated = await db.paper_question_media.update({
      where: { id: loaded.media.id },
      data: {
        purpose: input.purpose,
        storage_url: relativeUrl,
        mime_type: mimeType,
        checksum,
        width: null,
        height: null,
        sort_order: input.sortOrder,
        uploaded_by: actor.id,
      },
    });

    return updated;
  } catch (error) {
    await rm(absolutePath, { force: true });
    throw error;
  }
}

export async function deletePaperQuestionMedia(db: PaperDb, paperId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionPaperMediaById(db, paperId, questionId, mediaId, actor);
  if (!loaded) {
    return null;
  }

  return db.paper_question_media.delete({
    where: { id: loaded.media.id },
  });
}

export async function scheduleExamFromQuestionPaper(db: PaperDb, actor: AuthenticatedUser, input: ScheduleExamInput) {
  const paper = await db.question_papers.findFirst({
    where: accessWhere(actor, input.question_paper_id),
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
  });

  if (!paper) {
    throw new Error("Question paper not found.");
  }
  if (paper.status === "ARCHIVED") {
    throw new Error("Archived question papers cannot be scheduled.");
  }

  const counts = await loadQuestionPaperCountMap(db, paper.id);
  const activeQuestions = paper.questions.filter((question) => question.is_active);
  if (activeQuestions.length === 0) {
    throw new Error("Question paper must contain at least one active question before scheduling.");
  }

  const sections = normalizeSectionsInput(
    paper.sections.map((section) => ({
      section_code: section.section_code as FixedSectionCode,
      question_count_target: section.question_count_target,
      default_marks: Number(section.default_marks),
      default_negative_marks: Number(section.default_negative_marks),
    })),
  );

  const warnings = countWarnings(
    sections,
    {
      PHYSICS: { active: counts.PHYSICS.active },
      CHEMISTRY: { active: counts.CHEMISTRY.active },
      MATHS: { active: counts.MATHS.active },
    },
  );

  const scheduledAt = new Date(input.scheduled_at);

  const result = await db.$transaction(async (tx) => {
    const latestVersion = await tx.question_paper_versions.findFirst({
      where: { question_paper_id: paper.id },
      orderBy: { version_number: "desc" },
      select: { version_number: true },
    });
    const versionNumber = (latestVersion?.version_number ?? 0) + 1;

    const version = await tx.question_paper_versions.create({
      data: {
        question_paper_id: paper.id,
        version_number: versionNumber,
        title_snapshot: paper.title,
        instructions_snapshot: paper.instructions,
        created_from_status: paper.status,
        created_by: actor.id,
      },
    });

    await tx.question_paper_version_sections.createMany({
      data: sections.map((section) => ({
        version_id: version.id,
        section_code: section.section_code,
        section_order: section.section_order,
        question_count_target: section.question_count_target,
        default_marks: section.default_marks,
        default_negative_marks: section.default_negative_marks,
      })),
    });

    for (const sourceQuestion of activeQuestions) {
      const versionQuestion = await tx.question_paper_version_questions.create({
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
        await tx.question_paper_version_options.createMany({
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
        await tx.question_paper_version_media.createMany({
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

    // exam.batch_id holds the primary batch (first in list) for display/leaderboard labelling.
    const primaryBatchId: number | null = (() => {
      if (Array.isArray(input.batch_ids) && input.batch_ids.length > 0) return input.batch_ids[0];
      return input.batch_id ?? null;
    })();

    const exam = await tx.exams.create({
      data: {
        title: input.title,
        batch_id: primaryBatchId,
        question_paper_id: paper.id,
        question_paper_version_id: version.id,
        status: ExamStatus.SCHEDULED,
        exam_mode: input.exam_mode,
        duration_seconds: input.duration_seconds,
        instructions: paper.instructions,
        solution_release_policy: input.solution_release_policy,
        exam_date_time: scheduledAt,
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

    const deliveryMap = new Map(
      (input.section_delivery ?? []).map((d) => [d.section_code, d]),
    );
    await tx.exam_section_delivery_rules.createMany({
      data: sections.map((section) => {
        const sectionDelivery = deliveryMap.get(section.section_code as FixedSectionCode);
        const questionsToDeliver = sectionDelivery?.questions_to_deliver ?? (section.question_count_target > 0 ? section.question_count_target : 0);
        return {
          exam_id: exam.id,
          section_code: section.section_code,
          questions_to_deliver: questionsToDeliver,
          selection_strategy: "ROTATED_SUBSET",
          order_strategy: "ROTATED_SHUFFLED",
          section_time_limit_seconds: sectionDelivery?.section_time_limit_seconds ?? null,
        };
      }),
    });

    // Resolve the set of batch IDs to assign: batch_ids takes priority over batch_id.
    const resolvedBatchIds: number[] = (() => {
      if (Array.isArray(input.batch_ids) && input.batch_ids.length > 0) return input.batch_ids;
      if (input.batch_id != null) return [input.batch_id];
      return [];
    })();

    if (resolvedBatchIds.length > 0) {
      await tx.exam_assignments.createMany({
        data: resolvedBatchIds.map((batchId) => ({
          exam_id: exam.id,
          batch_id: batchId,
          student_uid: null,
          visible_from: scheduledAt,
          visible_until: null,
          created_by: actor.id,
        })),
      });
    }

    for (const sourceQuestion of activeQuestions) {
      await copySnapshotQuestionRows(tx, {
        examId: exam.id,
        actorId: actor.id,
        sourceQuestion,
      });
    }

    const createdExam = await tx.exams.findUniqueOrThrow({
      where: { id: exam.id },
      include: {
        batch: true,
        exam_sections: {
          orderBy: {
            section_order: "asc",
          },
        },
        question_paper: true,
        question_paper_version: {
          include: {
            sections: {
              orderBy: {
                section_order: "asc",
              },
            },
            questions: {
              orderBy: [
                { section_code: "asc" },
                { question_order: "asc" },
              ],
            },
          },
        },
      },
    });

    return {
      exam: createdExam,
      version,
    };
  });

  const versionSummary = await getVersionSummary(db, result.version.id);
  return {
    exam: result.exam,
    question_paper_version: versionSummary,
    warnings,
  };
}
