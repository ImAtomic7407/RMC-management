import { z } from "zod";

export const sectionCodeSchema = z.enum(["PHYSICS", "CHEMISTRY", "MATHS"]);
export const examModeSchema = z.enum(["LIVE", "PRACTICE"]);
export const solutionReleasePolicySchema = z.enum([
  "AFTER_EXAM_END",
  "AFTER_RESULT_RELEASE",
  "NEVER",
  "PRACTICE_UNLOCK_RULE",
]);

export const examSectionInputSchema = z.object({
  section_code: sectionCodeSchema,
  question_count_target: z.number().int().min(0).max(1000),
  default_marks: z.number().positive().max(1000),
  default_negative_marks: z.number().nonnegative().max(1000).default(0),
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

export const createExamSchema = z.object({
  title: z.string().min(1).max(200),
  batch_id: z.number().int().positive(),
  exam_mode: examModeSchema,
  duration_seconds: z.number().int().positive().max(24 * 60 * 60),
  exam_date_time: isoDateTimeLikeSchema.optional().nullable(),
  instructions: z.string().max(5000).optional().nullable(),
  solution_release_policy: solutionReleasePolicySchema,
  sections: z.array(examSectionInputSchema).length(3),
});

export const examIdParamSchema = z.object({
  examId: z.coerce.number().int().positive(),
});

export const examListQuerySchema = z.object({
  scope: z.enum(["all", "draft", "scheduled", "published", "closed", "released"]).optional(),
});
