import { z } from "zod";

export const examGateQrRequestSchema = z.object({
  device_id: z.string().min(1).max(200),
  has_overlay_permission: z.boolean().optional(),
});

export const examGateTeacherVerifySchema = z.object({
  student_id: z.coerce.number().int().positive(),
  uid: z.string().min(1).max(120),
  device_id: z.string().min(1).max(200),
  qr_token: z.string().min(8).max(4000),
});

export const examGatePaperDownloadStatusSchema = z.object({
  device_id: z.string().min(1).max(200),
  paper_download_status: z.enum(["DOWNLOADING", "READY", "FAILED"]),
});

export const examViolationCreateSchema = z.object({
  device_id: z.string().min(1).max(200).optional().nullable(),
  attempt_id: z.coerce.number().int().positive().optional().nullable(),
  gate_session_id: z.coerce.number().int().positive().optional().nullable(),
  violation_type: z.enum([
    "BACK_ATTEMPT",
    "APP_BACKGROUND",
    "APP_SWITCH",
    "SCREEN_OFF",
    "MULTI_WINDOW",
    "OVERLAY_OR_ASSISTANT_TRIGGERED",
    "SCREENSHOT_ATTEMPT",
    "NETWORK_LOST",
    "TIMER_TAMPER_ATTEMPT",
    "LOW_VOLUME_WARNING",
  ]),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  message: z.string().max(500).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const studentExamGateQuerySchema = z.object({
  device_id: z.string().min(1).max(200).optional(),
});

export const studentExamStartSchema = z.object({
  device_id: z.string().min(1).max(200),
});
