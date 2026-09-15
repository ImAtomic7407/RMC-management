import { z } from "zod";

export const studentExamIdParamSchema = z.object({
  examId: z.coerce.number().int().positive(),
});

export const studentAttemptIdParamSchema = z.object({
  attemptId: z.coerce.number().int().positive(),
});

export const studentQuestionIdParamSchema = z.object({
  questionId: z.coerce.number().int().positive(),
});

export const studentVersionQuestionIdParamSchema = z.object({
  versionQuestionId: z.coerce.number().int().positive(),
});

export const studentMediaIdParamSchema = z.object({
  mediaId: z.coerce.number().int().positive(),
});

export const studentExamsQuerySchema = z.object({
  scope: z.enum(["active", "all"]).optional().default("active"),
});

export const studentLeaderboardQuerySchema = z.object({
  scope: z.enum(["exam", "batch", "overall"]).default("exam"),
  examId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
});

export const saveStudentAnswerSchema = z
  .object({
    question_id: z.number().int().positive().optional(),
    assigned_question_id: z.number().int().positive().optional(),
    version_question_id: z.number().int().positive().optional(),
    device_id: z.string().trim().min(1).optional(),
    selected_option_id: z.number().int().positive().optional(),
    integer_answer: z.string().regex(/^-?\d+$/).optional(),
    is_marked_for_review: z.boolean().optional().default(false),
    // True when the per-question timer expired before the student answered.
    // Treated as unattempted (0 marks, no negative penalty).
    timed_out: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      const hasOption = data.selected_option_id !== undefined;
      const hasInteger = data.integer_answer !== undefined;
      return !(hasOption && hasInteger);
    },
    {
      message: "Provide at most one of selected_option_id or integer_answer.",
    },
  )
  .refine(
    (data) => data.question_id !== undefined || data.assigned_question_id !== undefined || data.version_question_id !== undefined,
    {
      message: "Provide a question identifier.",
    },
  );

export const practiceQuestionCheckSchema = z
  .object({
    selected_option_id: z.number().int().positive().optional(),
    integer_answer: z.string().regex(/^[+-]?\d+$/).optional(),
  })
  .refine(
    (data) => {
      const hasOption = data.selected_option_id !== undefined;
      const hasInteger = data.integer_answer !== undefined;
      return hasOption !== hasInteger;
    },
    {
      message: "Provide exactly one of selected_option_id or integer_answer.",
    },
  );

export const studentPracticePaperIdParamSchema = z.object({
  paperId: z.coerce.number().int().positive(),
});

export const studentPracticeAnswerSaveSchema = z
  .object({
    question_id: z.number().int().positive(),
    selected_option_id: z.number().int().positive().optional(),
    integer_answer: z.string().regex(/^[+-]?\d+$/).optional(),
    is_marked_for_review: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      const hasOption = data.selected_option_id !== undefined;
      const hasInteger = data.integer_answer !== undefined;
      return hasOption !== hasInteger;
    },
    {
      message: "Provide exactly one of selected_option_id or integer_answer.",
    },
  );
