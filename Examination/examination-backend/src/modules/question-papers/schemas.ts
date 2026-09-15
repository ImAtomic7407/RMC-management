import { z } from "zod";

export const questionPaperSectionCodeSchema = z.enum(["PHYSICS", "CHEMISTRY", "MATHS"]);
export const questionTypeSchema = z.enum(["MCQ", "INTEGER"]);
export const questionMediaPurposeSchema = z.enum(["QUESTION", "SOLUTION"]);
export const examModeSchema = z.enum(["LIVE", "PRACTICE"]);
export const solutionReleasePolicySchema = z.enum([
  "AFTER_EXAM_END",
  "AFTER_RESULT_RELEASE",
  "NEVER",
  "PRACTICE_UNLOCK_RULE",
]);

const sectionInputSchema = z.object({
  section_code: questionPaperSectionCodeSchema,
  question_count_target: z.number().int().min(0).max(1000).default(30),
  default_marks: z.number().positive().max(1000).default(4),
  default_negative_marks: z.preprocess((value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.abs(value);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return value;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return Math.abs(parsed);
      }
    }
    return value;
  }, z.number().nonnegative().max(1000).default(1)),
});

const mcqOptionSchema = z.object({
  option_label: z.enum(["A", "B", "C", "D"]),
  option_text: z.string().max(1000).optional().nullable().default(""),
});

export const questionPaperCreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    batch_id: z.number().int().positive().optional().nullable(),
    category: z.string().max(120).optional().nullable(),
    instructions: z.string().max(5000).optional().nullable(),
    is_self_practice_enabled: z.boolean().optional().default(false),
    self_practice_duration_seconds: z.number().int().positive().max(24 * 60 * 60).optional().nullable(),
    self_practice_solution_policy: z.enum(["AFTER_SUBMIT", "AFTER_CORRECT", "AFTER_TWO_WRONG", "NEVER"]).optional().nullable(),
    sections: z.array(sectionInputSchema).length(3).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.is_self_practice_enabled && !data.self_practice_solution_policy) {
      ctx.addIssue({
        code: "custom",
        message: "Self-practice solution policy is required when self-practice is enabled.",
        path: ["self_practice_solution_policy"],
      });
    }
  });

export const questionPaperUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    batch_id: z.number().int().positive().optional().nullable(),
    category: z.string().max(120).optional().nullable(),
    instructions: z.string().max(5000).optional().nullable(),
    is_self_practice_enabled: z.boolean().optional(),
    self_practice_duration_seconds: z.number().int().positive().max(24 * 60 * 60).optional().nullable(),
    self_practice_solution_policy: z.enum(["AFTER_SUBMIT", "AFTER_CORRECT", "AFTER_TWO_WRONG", "NEVER"]).optional().nullable(),
    sections: z.array(sectionInputSchema).length(3).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.is_self_practice_enabled && !data.self_practice_solution_policy) {
      ctx.addIssue({
        code: "custom",
        message: "Self-practice solution policy is required when self-practice is enabled.",
        path: ["self_practice_solution_policy"],
      });
    }
  });

export const questionPaperIdParamSchema = z.object({
  paperId: z.coerce.number().int().positive(),
});

export const questionPaperQuestionIdParamSchema = z.object({
  paperId: z.coerce.number().int().positive(),
  questionId: z.coerce.number().int().positive(),
});

export const questionPaperMediaIdParamSchema = z.object({
  paperId: z.coerce.number().int().positive(),
  questionId: z.coerce.number().int().positive(),
  mediaId: z.coerce.number().int().positive(),
});

export const paperQuestionListQuerySchema = z.object({
  include_inactive: z.coerce.boolean().optional().default(true),
});

export const paperQuestionCreateSchema = z
  .object({
    section_code: questionPaperSectionCodeSchema,
    question_type: questionTypeSchema,
    question_text: z.string().max(5000).optional().nullable(),
    marks: z.number().positive().max(1000).optional(),
    negative_marks: z.preprocess((value) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.abs(value);
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return value;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          return Math.abs(parsed);
        }
      }
      return value;
    }, z.number().nonnegative().max(1000).optional()),
    options: z.array(mcqOptionSchema).length(4).optional(),
    correct_option_label: z.enum(["A", "B", "C", "D"]).optional(),
    correct_integer_answer: z.string().regex(/^[+-]?\d+(\.\d+)?$/).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.question_type === "MCQ") {
      if (!data.options) {
        ctx.addIssue({
          code: "custom",
          message: "MCQ questions require four options.",
          path: ["options"],
        });
      }
      if (!data.correct_option_label) {
        ctx.addIssue({
          code: "custom",
          message: "MCQ questions require a correct option label.",
          path: ["correct_option_label"],
        });
      }
    }
    if (data.question_type === "INTEGER" && !data.correct_integer_answer) {
      ctx.addIssue({
        code: "custom",
        message: "INTEGER questions require a correct integer answer.",
        path: ["correct_integer_answer"],
      });
    }
  });

export const paperQuestionUpdateSchema = z
  .object({
    section_code: questionPaperSectionCodeSchema.optional(),
    question_type: questionTypeSchema.optional(),
    question_text: z.string().max(5000).optional().nullable(),
    marks: z.number().positive().max(1000).optional(),
    negative_marks: z.preprocess((value) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.abs(value);
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          return value;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          return Math.abs(parsed);
        }
      }
      return value;
    }, z.number().nonnegative().max(1000).optional()),
    options: z.array(mcqOptionSchema).length(4).optional(),
    correct_option_label: z.enum(["A", "B", "C", "D"]).optional(),
    correct_integer_answer: z.string().regex(/^[+-]?\d+(\.\d+)?$/).optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.question_type === "MCQ" || (data.question_type === undefined && data.options)) {
      if (!data.correct_option_label) {
        ctx.addIssue({
          code: "custom",
          message: "MCQ updates require a correct option label.",
          path: ["correct_option_label"],
        });
      }
    }
    if (data.question_type === "INTEGER" && !data.correct_integer_answer) {
      ctx.addIssue({
        code: "custom",
        message: "INTEGER updates require a correct integer answer.",
        path: ["correct_integer_answer"],
      });
    }
  });

export const paperQuestionReorderSchema = z.object({
  section_code: questionPaperSectionCodeSchema,
  questions: z
    .array(
      z.object({
        question_id: z.number().int().positive(),
        question_order: z.number().int().positive(),
      }),
    )
    .min(1),
});

export const paperMediaUploadSchema = z.object({
  purpose: questionMediaPurposeSchema,
  sort_order: z.coerce.number().int().min(0).default(0),
});

const isoDateTimeLikeSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return trimmed;
}, z.string().datetime());

export const scheduleExamSchema = z.object({
  question_paper_id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  batch_id: z.number().int().positive().optional().nullable(),
  batch_ids: z.array(z.number().int().positive()).min(1).optional().nullable(),
  exam_mode: examModeSchema,
  scheduled_at: isoDateTimeLikeSchema,
  duration_seconds: z.number().int().positive().max(24 * 60 * 60),
  solution_release_policy: solutionReleasePolicySchema,
  // Per-section delivery: how many questions each student actually receives.
  // If omitted, defaults to section.question_count_target (all questions in section).
  section_delivery: z
    .array(
      z.object({
        section_code: questionPaperSectionCodeSchema,
        questions_to_deliver: z.number().int().min(1).max(1000),
        // NULL = no section timer (students use the full exam duration freely).
        section_time_limit_seconds: z.number().int().min(60).max(10800).nullable().optional(),
      }),
    )
    .length(3)
    .optional(),
});

export const questionPaperListQuerySchema = z.object({
  include_archived: z.coerce.boolean().optional().default(true),
});
