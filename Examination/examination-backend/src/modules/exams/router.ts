import { Router, type Response } from "express";
import { createExamSchema, examIdParamSchema, examListQuerySchema } from "./schemas";
import {
  createExam,
  deleteExam,
  finalizeExam,
  getExamById,
  listExams,
  publishExam,
  releaseExamResult,
  ExamWorkflowError,
} from "./service";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, writeAuthAuditLog } from "../../shared/auth";
import { requireSchemaReady } from "../../shared/auth";
import { prisma } from "../../shared/prisma.js";
import { broadcastExamRealtime } from "../../shared/realtime";
import { regenerateBatchLeaderboard, regenerateExamLeaderboard, regenerateOverallLeaderboard } from "../leaderboard/service";
import { scheduleExamSchema } from "../question-papers/schemas.js";
import { scheduleExamFromQuestionPaper } from "../question-papers/service.js";
import { examGateTeacherVerifySchema } from "../exam-gate/schemas.js";
import { getPaperDistributionStats, isExamGateError, listExamGateSessions, resetExamGateSessions, setStudentBypassRestrictions, startManualExam, verifyStudentGateQr } from "../exam-gate/service.js";

const router = Router();

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

router.post("/schedule", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = scheduleExamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const scheduleResult = await scheduleExamFromQuestionPaper(prisma, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_SCHEDULE",
      entityType: "exams",
      entityId: String(scheduleResult.exam.id),
      metadata: {
        question_paper_id: scheduleResult.exam.question_paper_id,
        question_paper_version_id: scheduleResult.exam.question_paper_version_id,
        version_number: scheduleResult.question_paper_version?.version_number,
      },
      ipAddress: req.ip,
    });
    broadcastExamRealtime({
      type: "exam.updated",
      examId: scheduleResult.exam.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "scheduled",
        status: scheduleResult.exam.status,
        question_paper_version_id: scheduleResult.exam.question_paper_version_id,
      },
    });
    res.status(201).json({
      status: "success",
      exam: scheduleResult.exam,
      question_paper_version: scheduleResult.question_paper_version,
      warnings: scheduleResult.warnings,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "EXAM_SCHEDULE_FAILED",
      message: error instanceof Error ? error.message : "Failed to schedule exam.",
    });
  }
});

router.post("/:examId/start", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const exam = await startManualExam(prisma, parsed.data.examId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_START",
      entityType: "exams",
      entityId: String(exam.id),
      metadata: {
        question_paper_id: exam.question_paper_id,
        question_paper_version_id: exam.question_paper_version_id,
      },
      ipAddress: req.ip,
    });
    broadcastExamRealtime({
      type: "exam.updated",
      examId: exam.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "started",
        status: exam.status,
        started_at: exam.started_at?.toISOString() ?? null,
      },
    });
    res.status(200).json({
      status: "success",
      exam,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start exam.";
    const code = message.includes("frozen paper version")
      ? "EXAM_VERSION_REQUIRED"
      : message.includes("cannot be started")
        ? "EXAM_CANNOT_START"
        : "EXAM_START_FAILED";
    res.status(400).json({
      status: "error",
      code,
      message,
    });
  }
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = createExamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const exam = await createExam(parsed.data, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_CREATE",
      entityType: "exams",
      entityId: String(exam.id),
      metadata: {
        title: exam.title,
        batch_id: exam.batch_id,
        section_count: exam.exam_sections.length,
      },
      ipAddress: req.ip,
    });
    broadcastExamRealtime({
      type: "exam.updated",
      examId: exam.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "created",
        status: exam.status,
      },
    });
    res.status(201).json({
      status: "success",
      exam,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "EXAM_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to create exam.",
    });
  }
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const exams = await listExams(parsed.data.scope, req.auth!.user);
  res.status(200).json({
    status: "success",
    count: exams.length,
    exams,
  });
});

router.get("/:examId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const exam = await getExamById(parsed.data.examId, req.auth!.user);
  if (!exam) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: "Exam not found.",
    });
    return;
  }

  res.status(200).json({
    status: "success",
    exam,
  });
});

router.get("/:examId/gate/sessions", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await listExamGateSessions(prisma, parsed.data.examId, req.auth!.user);
    res.status(200).json({
      status: "success",
      exam: payload.exam,
      gate_sessions: payload.gate_sessions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load gate sessions.";
    res.status(404).json({
      status: "error",
      code: "EXAM_NOT_FOUND",
      message,
    });
  }
});

router.post("/:examId/gate/reset-sessions", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Examination database schema is not ready yet." });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }

  try {
    const result = await resetExamGateSessions(prisma, parsed.data.examId, req.auth!.user);
    res.status(200).json({
      status: "success",
      message: `Reset ${result.sessions_reset} gate session(s) and cleared ${result.paper_instances_deleted} paper instance(s). Students must show QR again.`,
      sessions_reset: result.sessions_reset,
      paper_instances_deleted: result.paper_instances_deleted,
      exam: result.exam,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({ status: "error", code: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to reset gate sessions.";
    res.status(500).json({ status: "error", code: "INTERNAL_ERROR", message });
  }
});

router.get("/:examId/gate/paper-distribution-stats", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Examination database schema is not ready yet." });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }

  try {
    const full = req.query.full === "true";
    const stats = await getPaperDistributionStats(prisma, parsed.data.examId, req.auth!.user, { full });
    res.status(200).json({ status: "success", ...stats });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({ status: "error", code: error.code, message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to compute distribution stats.";
    res.status(500).json({ status: "error", code: "INTERNAL_ERROR", message });
  }
});

router.post("/:examId/gate/verify-qr", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsedExam = examIdParamSchema.safeParse(req.params);
  const parsedBody = examGateTeacherVerifySchema.safeParse(req.body);
  if (!parsedExam.success || !parsedBody.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !parsedExam.success ? parsedExam.error.flatten() : parsedBody.error!.flatten(),
    });
    return;
  }

  try {
    const payload = await verifyStudentGateQr(prisma, parsedExam.data.examId, req.auth!.user, parsedBody.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_GATE_VERIFY_QR",
      entityType: "exam_gate_sessions",
      entityId: String(payload.gate_session?.id ?? 0),
      metadata: {
        exam_id: parsedExam.data.examId,
        student_id: parsedBody.data.student_id,
        gate_status: payload.gate_session?.gate_status,
        device_bind_status: payload.gate_session?.device_bind_status,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      gate_session: payload.gate_session,
      assigned_paper: payload.assigned_paper?.livePackage ?? null,
      locked_review_package: payload.assigned_paper?.lockedReviewPackage ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify QR.";
    const code = message.includes("expired")
      ? "QR_TOKEN_EXPIRED"
      : message.includes("UID")
        ? "UID_MISMATCH"
        : message.includes("Device")
          ? "DEVICE_BIND_MISMATCH"
          : message.includes("assigned")
            ? "STUDENT_NOT_ASSIGNED"
            : message.includes("scheduled or started") || message.includes("not ready")
              ? "EXAM_NOT_READY"
              : "QR_VERIFICATION_FAILED";
    res.status(403).json({
      status: "error",
      code,
      message,
    });
  }
});

router.post("/:examId/publish", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const exam = await publishExam(parsed.data.examId, req.auth!.user);
    if (!exam) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Exam not found.",
      });
      return;
    }
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_PUBLISH",
      entityType: "exams",
      entityId: String(exam.id),
      metadata: {
        status: exam.status,
      },
      ipAddress: req.ip,
    });
    broadcastExamRealtime({
      type: "exam.updated",
      examId: exam.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "published",
        status: exam.status,
        published_at: exam.published_at?.toISOString() ?? null,
      },
    });
    res.status(200).json({
      status: "success",
      exam,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "EXAM_PUBLISH_FAILED",
      message: error instanceof Error ? error.message : "Failed to publish exam.",
    });
  }
});

async function respondWithFinalizedExam(req: AuthenticatedRequest, res: Response, examId: number) {
  try {
    const finalized = await finalizeExam(examId, req.auth!.user);
    if (!finalized) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Exam not found.",
      });
      return;
    }

    const { exam, summary } = finalized;
    try {
      await regenerateExamLeaderboard(prisma, exam.id, req.auth!.user);
      if (exam.batch_id != null) {
        await regenerateBatchLeaderboard(prisma, exam.id, exam.batch_id, req.auth!.user);
      }
      await regenerateOverallLeaderboard(prisma, req.auth!.user);
    } catch (leaderboardError) {
      console.warn("[exam-finalize] leaderboard regeneration failed", leaderboardError);
    }

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_FINALIZE",
      entityType: "exams",
      entityId: String(exam.id),
      metadata: {
        status: exam.status,
        summary,
      },
      ipAddress: req.ip,
    });
    broadcastExamRealtime({
      type: "exam.updated",
      examId: exam.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "finalized",
        status: exam.status,
        closed_at: exam.closed_at?.toISOString() ?? null,
      },
    });

    res.status(200).json({
      status: "success",
      exam,
      summary,
    });
  } catch (error) {
    if (error instanceof ExamWorkflowError) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }

    res.status(400).json({
      status: "error",
      code: "EXAM_FINALIZE_FAILED",
      message: error instanceof Error ? error.message : "Failed to finalize exam.",
    });
  }
}

router.post("/:examId/finalize", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  await respondWithFinalizedExam(req, res, parsed.data.examId);
});

router.post("/:examId/close", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  await respondWithFinalizedExam(req, res, parsed.data.examId);
});

router.post("/:examId/release-result", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  let exam;
  try {
    exam = await releaseExamResult(parsed.data.examId, req.auth!.user);
  } catch (error) {
    if (error instanceof ExamWorkflowError) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }

    res.status(400).json({
      status: "error",
      code: "EXAM_RELEASE_FAILED",
      message: error instanceof Error ? error.message : "Failed to release exam results.",
    });
    return;
  }

  if (!exam) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: "Exam not found.",
    });
    return;
  }

  try {
    await regenerateExamLeaderboard(prisma, exam.id, req.auth!.user);
    if (exam.batch_id != null) {
      await regenerateBatchLeaderboard(prisma, exam.id, exam.batch_id, req.auth!.user);
    }
    await regenerateOverallLeaderboard(prisma, req.auth!.user);
  } catch (leaderboardError) {
    console.warn("[exam-release] leaderboard regeneration failed", leaderboardError);
  }

  await writeAuthAuditLog({
    actorUserId: req.auth!.user.id,
    actorRole: req.auth!.user.role,
    action: "EXAM_RESULT_RELEASE",
    entityType: "exams",
    entityId: String(exam.id),
    metadata: {
      status: exam.status,
    },
    ipAddress: req.ip,
  });
  broadcastExamRealtime({
    type: "exam.updated",
    examId: exam.id,
    actorRole: req.auth!.user.role,
    payload: {
      action: "result_released",
      status: exam.status,
      result_released_at: exam.result_released_at?.toISOString() ?? null,
    },
  });

  res.status(200).json({
    status: "success",
    exam,
  });
});

router.patch("/:examId/gate/sessions/:sessionId/restrictions", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Schema not ready." });
    return;
  }
  const examId = parseInt(String(req.params.examId), 10);
  const sessionId = parseInt(String(req.params.sessionId), 10);
  if (isNaN(examId) || isNaN(sessionId)) {
    res.status(400).json({ status: "error", code: "INVALID_PARAMS", message: "Invalid examId or sessionId." });
    return;
  }
  const bypass = req.body?.bypass_restrictions;
  if (typeof bypass !== "boolean") {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", message: "bypass_restrictions must be a boolean." });
    return;
  }
  try {
    const result = await setStudentBypassRestrictions(prisma, examId, sessionId, bypass);
    res.status(200).json({ status: "success", gate_session: result.gate_session });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status((error as any).status).json({ status: "error", code: (error as any).code, message: (error as any).message });
      return;
    }
    res.status(500).json({ status: "error", code: "PATCH_FAILED", message: "Failed to update restriction." });
  }
});

router.delete("/:examId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Schema not ready." });
    return;
  }
  const parsed = examIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await deleteExam(parsed.data.examId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_DELETE",
      entityType: "exams",
      entityId: String(parsed.data.examId),
      metadata: { title: result.title },
      ipAddress: req.ip,
    });
    res.status(200).json({ status: "success", deleted: true, examId: result.examId });
  } catch (error) {
    if (error instanceof ExamWorkflowError) {
      res.status(error.status).json({ status: "error", code: error.code, message: error.message });
      return;
    }
    res.status(500).json({ status: "error", code: "EXAM_DELETE_FAILED", message: error instanceof Error ? error.message : "Failed to delete exam." });
  }
});

export { router as examsRouter };
