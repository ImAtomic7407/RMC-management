import { z } from "zod";

export const sectionCodeSchema = z.enum(["PHYSICS", "CHEMISTRY", "MATHS"]);
export const questionTypeSchema = z.enum(["MCQ", "INTEGER"]);

const commonQuestionFieldsSchema = z.object({
  section_code: sectionCodeSchema,
  question_type: questionTypeSchema,
  question_text: z.string().max(5000).optional().nullable(),
  marks: z.number().positive().max(1000),
  negative_marks: z.number().nonnegative().max(1000).default(0),
  difficulty: z.string().max(30).optional().nullable(),
  topic: z.string().max(120).optional().nullable(),
  chapter: z.string().max(120).optional().nullable(),
  // Per-question timer for live exams: 60–300 seconds (1–5 min). NULL = no timer.
  question_time_limit_seconds: z.number().int().min(60).max(300).optional().nullable(),
});

const mcqOptionSchema = z.object({
  option_label: z.string().min(1).max(10),
  option_text: z.string().max(1000).optional().nullable().default(""),
});

export const createMcqQuestionSchema = commonQuestionFieldsSchema.extend({
  question_type: z.literal("MCQ"),
  options: z.array(mcqOptionSchema).min(4).max(4),
  correct_option_label: z.string().min(1).max(10),
});

export const createIntegerQuestionSchema = commonQuestionFieldsSchema.extend({
  question_type: z.literal("INTEGER"),
  correct_integer_answer: z.string().regex(/^-?\d+$/),
});

export const createQuestionSchema = z.discriminatedUnion("question_type", [
  createMcqQuestionSchema,
  createIntegerQuestionSchema,
]);

export const updateQuestionSchema = z
  .object({
    question_type: questionTypeSchema.optional(),
    section_code: sectionCodeSchema.optional(),
    question_text: z.string().max(5000).optional().nullable(),
    marks: z.number().positive().max(1000).optional(),
    negative_marks: z.number().nonnegative().max(1000).optional(),
    difficulty: z.string().max(30).optional().nullable(),
    topic: z.string().max(120).optional().nullable(),
    chapter: z.string().max(120).optional().nullable(),
    question_time_limit_seconds: z.number().int().min(60).max(300).optional().nullable(),
    options: z.array(mcqOptionSchema).min(4).max(4).optional(),
    correct_option_label: z.string().min(1).max(10).optional(),
    correct_integer_answer: z.string().regex(/^-?\d+$/).optional(),
  })
  .refine(
    (data) => {
      if (data.question_type === "MCQ" || data.question_type === undefined) {
        return data.options === undefined || data.correct_option_label !== undefined || data.question_type !== "MCQ";
      }
      if (data.question_type === "INTEGER") {
        return data.correct_integer_answer !== undefined || data.question_type !== "INTEGER";
      }
      return true;
    },
    {
      message: "MCQ updates require typed options and correct_option_label when options are changed; INTEGER updates require correct_integer_answer when changed.",
      path: ["question_type"],
    },
  );

export const reorderQuestionSchema = z.object({
  section_code: sectionCodeSchema,
  questions: z
    .array(
      z.object({
        question_id: z.number().int().positive(),
        question_order: z.number().int().positive(),
      }),
    )
    .min(1),
});

export const examIdParamSchema = z.object({
  examId: z.coerce.number().int().positive(),
});

export const questionIdParamSchema = z.object({
  questionId: z.coerce.number().int().positive(),
});

export const questionListQuerySchema = z.object({
  include_inactive: z.coerce.boolean().optional().default(true),
});
