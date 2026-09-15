import { Router, type Response } from "express";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, requireSchemaReady, writeAuthAuditLog } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";
import { leaderboardBatchIdParamSchema, leaderboardExamIdParamSchema } from "./schemas.js";
import { getBatchLeaderboard, getExamLeaderboard, getOverallLeaderboard, regenerateBatchLeaderboard, regenerateExamLeaderboard, regenerateOverallLeaderboard } from "./service.js";

const router = Router();

router.use(requireAuthMiddleware);

// All routes are teacher/admin only EXCEPT /student/:studentId/exams, which any
// authenticated user may call — it only exposes RESULT_RELEASED results, the same
// visibility level as the leaderboard itself (students can open peers' summaries).
const teacherOnly = requireRoleMiddleware("ADMIN", "TEACHER");

router.post("/exams/:examId/regenerate", teacherOnly, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = leaderboardExamIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await regenerateExamLeaderboard(prisma, parsed.data.examId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "LEADERBOARD_EXAM_REGENERATE",
      entityType: "exams",
      entityId: String(parsed.data.examId),
      metadata: { generated: payload.generated, skipped: payload.skipped },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      generated: payload.generated,
      skipped: payload.skipped,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "LEADERBOARD_REGENERATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to regenerate leaderboard.",
    });
  }
});

router.get("/exams/:examId", teacherOnly, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = leaderboardExamIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await getExamLeaderboard(prisma, parsed.data.examId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "LEADERBOARD_EXAM_VIEW",
      entityType: "exams",
      entityId: String(parsed.data.examId),
      metadata: { generated: payload.generated },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      exam: payload.exam,
      leaderboard: payload.leaderboard,
      generated: payload.generated,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Failed to load leaderboard.",
    });
  }
});

router.post("/exams/:examId/batches/:batchId/regenerate", teacherOnly, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = leaderboardExamIdParamSchema.safeParse(req.params);
  const batchParsed = leaderboardBatchIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !batchParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : batchParsed.error!.flatten(),
    });
    return;
  }

  try {
    const payload = await regenerateBatchLeaderboard(prisma, examParsed.data.examId, batchParsed.data.batchId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "LEADERBOARD_BATCH_REGENERATE",
      entityType: "batches",
      entityId: String(batchParsed.data.batchId),
      metadata: {
        exam_id: examParsed.data.examId,
        generated: payload.generated,
        skipped: payload.skipped,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      generated: payload.generated,
      skipped: payload.skipped,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "LEADERBOARD_REGENERATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to regenerate leaderboard.",
    });
  }
});

router.get("/exams/:examId/batches/:batchId", teacherOnly, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = leaderboardExamIdParamSchema.safeParse(req.params);
  const batchParsed = leaderboardBatchIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !batchParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : batchParsed.error!.flatten(),
    });
    return;
  }

  try {
    const payload = await getBatchLeaderboard(prisma, examParsed.data.examId, batchParsed.data.batchId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "LEADERBOARD_BATCH_VIEW",
      entityType: "batches",
      entityId: String(batchParsed.data.batchId),
      metadata: {
        exam_id: examParsed.data.examId,
        generated: payload.generated,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      exam: payload.exam,
      batch: payload.batch,
      leaderboard: payload.leaderboard,
      generated: payload.generated,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Failed to load leaderboard.",
    });
  }
});

router.post("/overall/regenerate", teacherOnly, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  try {
    const payload = await regenerateOverallLeaderboard(prisma, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "LEADERBOARD_OVERALL_REGENERATE",
      entityType: "leaderboard_entries",
      entityId: "overall",
      metadata: {
        generated: payload.generated,
        skipped: payload.skipped,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      generated: payload.generated,
      skipped: payload.skipped,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "LEADERBOARD_REGENERATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to regenerate leaderboard.",
    });
  }
});

router.get("/overall", teacherOnly, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  try {
    const payload = await getOverallLeaderboard(prisma, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "LEADERBOARD_OVERALL_VIEW",
      entityType: "leaderboard_entries",
      entityId: "overall",
      metadata: {
        generated: payload.generated,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      leaderboard: payload.leaderboard,
      generated: payload.generated,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Failed to load leaderboard.",
    });
  }
});

// GET /api/leaderboard/student/:studentId/exams
// Teacher view: all released exam results for a specific student.
// Optional query: ?batchId=<id> to restrict to exams conducted for that batch.
router.get("/student/:studentId/exams", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Database schema not ready." });
    return;
  }
  const studentId = parseInt(String(req.params.studentId ?? ""), 10);
  const batchIdRaw = Array.isArray(req.query.batchId) ? req.query.batchId[0] : req.query.batchId;
  const batchId   = batchIdRaw ? parseInt(String(batchIdRaw), 10) : undefined;
  if (isNaN(studentId)) {
    res.status(400).json({ status: "error", message: "Invalid studentId." });
    return;
  }
  try {
    const student = await prisma.student_profiles.findFirst({
      where: { id: studentId },
      include: { user: true, batch: true },
    });
    if (!student) {
      res.status(404).json({ status: "error", message: "Student not found." });
      return;
    }

    const attempts = await prisma.exam_attempts.findMany({
      where: {
        student_id: studentId,
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
        attempt_result: { isNot: null },
        exam: {
          status: "RESULT_RELEASED",
          ...(batchId ? { batch_id: batchId } : {}),
        },
      },
      include: {
        exam: { include: { batch: true } },
        attempt_result: true,
        attempt_section_results: { orderBy: { section_code: "asc" } },
      },
      orderBy: { submitted_at: "desc" },
    });

    res.status(200).json({
      status: "success",
      student: {
        id: student.id,
        student_uid: student.student_uid,
        full_name: student.user.full_name,
        batch_id: student.batch_id,
        batch_name: student.batch.name,
      },
      results: attempts.map((attempt) => ({
        attempt_id: attempt.id,
        exam: {
          id: attempt.exam.id,
          title: attempt.exam.title,
          exam_mode: attempt.exam.exam_mode,
          status: attempt.exam.status,
          batch_name: attempt.exam.batch?.name ?? null,
          batch_id: attempt.exam.batch_id ?? null,
        },
        total_score: attempt.attempt_result?.total_score.toString() ?? "0",
        max_score: attempt.attempt_result?.max_score.toString() ?? "0",
        percentage: attempt.attempt_result?.percentage.toString() ?? "0.00",
        correct_count: attempt.attempt_result?.correct_count ?? 0,
        wrong_count: attempt.attempt_result?.wrong_count ?? 0,
        unattempted_count: attempt.attempt_result?.unattempted_count ?? 0,
        submitted_at: attempt.submitted_at,
        status: attempt.status,
        scoring_source: attempt.attempt_result?.scoring_source ?? null,
        sections: attempt.attempt_section_results.map((s) => ({
          section_code: s.section_code,
          score: s.score.toString(),
          max_score: s.max_score.toString(),
          correct_count: s.correct_count,
          wrong_count: s.wrong_count,
          unattempted_count: s.unattempted_count,
        })),
      })),
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error instanceof Error ? error.message : "Failed to load student exam history." });
  }
});

export { router as leaderboardRouter };
