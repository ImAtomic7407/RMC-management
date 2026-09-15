import { z } from "zod";

export const questionMediaPurposeSchema = z.enum(["QUESTION", "SOLUTION"]);

export const questionMediaUploadSchema = z.object({
  purpose: questionMediaPurposeSchema,
  sort_order: z.coerce.number().int().min(0).default(0),
});

export const questionMediaIdParamSchema = z.object({
  mediaId: z.coerce.number().int().positive(),
});

