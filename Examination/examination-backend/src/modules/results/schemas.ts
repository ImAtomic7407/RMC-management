import { z } from "zod";

export const resultAttemptIdParamSchema = z.object({
  attemptId: z.coerce.number().int().positive(),
});

export const resultExamIdParamSchema = z.object({
  examId: z.coerce.number().int().positive(),
});

