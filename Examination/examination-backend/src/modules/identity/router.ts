import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { syncRmcRoster } from "./rmc-sync";
import { getDatabaseReadiness } from "../../shared/db-readiness";
import {
  type AuthenticatedRequest,
  requireAuthMiddleware,
  requireRoleMiddleware,
  requireSignedTokenMiddleware,
  type TokenAuthenticatedRequest,
  writeAuthAuditLog,
} from "../../shared/auth";
import {
  batchUpsertSchema,
  singleBatchUpsertSchema,
  singleOrManyStudentSchema,
  singleOrManyTeacherSchema,
  studentBridgeRecordSchema,
  teacherBridgeRecordSchema,
} from "./schemas";
import {
  importStudentRecord,
  importTeacherRecord,
  normalizeBatchInputs,
  normalizeStudentInputs,
  normalizeTeacherInputs,
  upsertBatch,
  verifyStudentRecord,
  verifyTeacherRecord,
} from "./service";

const router = Router();

router.get("/health", requireSignedTokenMiddleware, async (_req: TokenAuthenticatedRequest, res: Response) => {
  const database = await getDatabaseReadiness();
  res.status(200).json({
    status: "success",
    database,
    identity: {
      ready: database.connected && database.schemaReady,
    },
  });
});

router.post("/batches/upsert", requireAuthMiddleware, requireRoleMiddleware("ADMIN"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = singleBatchUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const records = normalizeBatchInputs(parsed.data);
  const results = [];
  for (const record of records) {
    results.push(await upsertBatch(batchUpsertSchema.parse(record)));
  }

  if (req.auth) {
    await writeAuthAuditLog({
      actorUserId: req.auth.user.id,
      actorRole: req.auth.user.role,
      action: "IDENTITY_BATCH_UPSERT",
      entityType: "batches",
      entityId: "bulk",
      metadata: { count: results.length },
      ipAddress: req.ip,
    });
  }

  res.status(200).json({
    status: "success",
    count: results.length,
    batches: results,
  });
});

router.post("/students/verify", requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = singleOrManyStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const records = normalizeStudentInputs(parsed.data);
  const results = [];
  for (const record of records) {
    results.push(await verifyStudentRecord(studentBridgeRecordSchema.parse(record)));
  }

  res.status(200).json({
    status: "success",
    count: results.length,
    students: results,
  });
});

router.post("/students/import", requireAuthMiddleware, requireRoleMiddleware("ADMIN"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = singleOrManyStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const records = normalizeStudentInputs(parsed.data);
  const results = [];
  for (const record of records) {
    results.push(await importStudentRecord(studentBridgeRecordSchema.parse(record)));
  }

  if (req.auth) {
    await writeAuthAuditLog({
      actorUserId: req.auth.user.id,
      actorRole: req.auth.user.role,
      action: "IDENTITY_STUDENT_IMPORT",
      entityType: "student_profiles",
      entityId: "bulk",
      metadata: { count: results.length },
      ipAddress: req.ip,
    });
  }

  res.status(200).json({
    status: "success",
    count: results.length,
    students: results,
  });
});

router.post("/teachers/verify", requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = singleOrManyTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const records = normalizeTeacherInputs(parsed.data);
  const results = [];
  for (const record of records) {
    results.push(await verifyTeacherRecord(teacherBridgeRecordSchema.parse(record)));
  }

  res.status(200).json({
    status: "success",
    count: results.length,
    teachers: results,
  });
});

router.post("/teachers/import", requireAuthMiddleware, requireRoleMiddleware("ADMIN"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = singleOrManyTeacherSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const records = normalizeTeacherInputs(parsed.data);
  const results = [];
  for (const record of records) {
    results.push(await importTeacherRecord(teacherBridgeRecordSchema.parse(record)));
  }

  if (req.auth) {
    await writeAuthAuditLog({
      actorUserId: req.auth.user.id,
      actorRole: req.auth.user.role,
      action: "IDENTITY_TEACHER_IMPORT",
      entityType: "teacher_profiles",
      entityId: "bulk",
      metadata: { count: results.length },
      ipAddress: req.ip,
    });
  }

  res.status(200).json({
    status: "success",
    count: results.length,
    teachers: results,
  });
});

// GET /api/identity/batches — list all batches (teachers + admins)
router.get("/batches", requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"), async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { prisma } = await import("../../shared/prisma.js");
    const batches = await prisma.batches.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    res.status(200).json({ status: "success", batches });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Failed to list batches." });
  }
});

// ── RMC Roster Sync ──────────────────────────────────────────────────────────
// Pull the full student + staff list from RMC and upsert into examination DB.
// ADMIN only. Safe to call repeatedly (all operations are upserts).

router.post("/rmc-sync", requireAuthMiddleware, requireRoleMiddleware("ADMIN"), async (req: AuthenticatedRequest, res: Response) => {
  if (!env.RMC_API_URL || !env.RMC_INTERNAL_SECRET) {
    res.status(503).json({
      status: "error",
      code: "RMC_NOT_CONFIGURED",
      message: "RMC_API_URL or RMC_INTERNAL_SECRET is not set. Configure them in .env.",
    });
    return;
  }

  try {
    const syncResult = await syncRmcRoster();

    if (req.auth) {
      await writeAuthAuditLog({
        actorUserId: req.auth.user.id,
        actorRole: req.auth.user.role,
        action: "IDENTITY_RMC_SYNC",
        entityType: "identity_bridge",
        entityId: "bulk",
        metadata: syncResult,
        ipAddress: req.ip,
      });
    }

    res.status(200).json({ status: "success", ...syncResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ status: "error", code: "RMC_SYNC_FAILED", message: msg });
  }
});

export { router as identityRouter };
