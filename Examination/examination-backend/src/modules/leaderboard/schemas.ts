import { z } from "zod";

export const leaderboardExamIdParamSchema = z.object({
  examId: z.coerce.number().int().positive(),
});

export const leaderboardBatchIdParamSchema = z.object({
  batchId: z.coerce.number().int().positive(),
});

export const studentLeaderboardQuerySchema = z.object({
  scope: z.enum(["exam", "batch", "overall"]).default("exam"),
  examId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
});
