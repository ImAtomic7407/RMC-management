import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env"), override: true });
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("30d"),
  PORT: z.string().optional(),
  ENABLE_EXAM_DEV_SEED: z.string().optional(),
  // RMC integration
  RMC_API_URL: z.string().url().optional(),
  RMC_INTERNAL_SECRET: z.string().optional(),
  RMC_AUTH_ENABLED: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => i.path.join(".") + ": " + i.message)
    .join("; ");
  throw new Error("Invalid environment configuration: " + issues);
}

export const env = {
  ...parsed.data,
  PORT: parsed.data.PORT ?? "4200",
  JWT_EXPIRES_IN: parsed.data.JWT_EXPIRES_IN ?? "30d",
  ENABLE_EXAM_DEV_SEED: parsed.data.ENABLE_EXAM_DEV_SEED ?? "false",
  RMC_API_URL: parsed.data.RMC_API_URL ?? "",
  RMC_INTERNAL_SECRET: parsed.data.RMC_INTERNAL_SECRET ?? "",
  RMC_AUTH_ENABLED: parsed.data.RMC_AUTH_ENABLED === "true",
};
