import { Router, type Response } from "express";
import { createReadStream } from "node:fs";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, writeAuthAuditLog, requireSchemaReady } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";
import { examIdParamSchema } from "../exams/schemas.js";
import { resultAttemptIdParamSchema } from "./schemas.js";
import { studentVersionQuestionIdParamSchema, studentMediaIdParamSchema } from "../student/schemas.js";
import {
  getExamResultDetail,
  getStudentResultReview,
  listExamResults,
  readStudentResultReviewMediaFile,
  recalculateAttemptResult,
} from "./service.js";

const router = Router();

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

router.post("/attempts/:attemptId/recalculate", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = resultAttemptIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await recalculateAttemptResult(prisma, parsed.data.attemptId);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "RESULT_RECALCULATE",
      entityType: "exam_attempts",
      entityId: String(parsed.data.attemptId),
      metadata: {
        total_score: result.result.total_score,
        percentage: result.result.percentage,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      result: result.result,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "RESULT_RECALCULATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to recalculate result.",
    });
  }
});

router.get("/exams/:examId/results", async (req: AuthenticatedRequest, res: Response) => {
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
    const payload = await listExamResults(prisma, parsed.data.examId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_RESULTS_LIST",
      entityType: "exams",
      entityId: String(parsed.data.examId),
      metadata: {
        result_count: payload.results.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      exam: payload.exam,
      results: payload.results,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Failed to load results.",
    });
  }
});

router.get("/exams/:examId/results/:attemptId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = examIdParamSchema.safeParse(req.params);
  const attemptParsed = resultAttemptIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : attemptParsed.error!.flatten(),
    });
    return;
  }

  try {
    const payload = await getExamResultDetail(prisma, examParsed.data.examId, attemptParsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "EXAM_RESULT_DETAIL",
      entityType: "exam_attempts",
      entityId: String(attemptParsed.data.attemptId),
      metadata: {
        exam_id: examParsed.data.examId,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      exam: payload.exam,
      attempt: payload.attempt,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Failed to load result.",
    });
  }
});

// Teacher/Admin review of any submitted attempt — same payload shape as the
// student review endpoint so the app can reuse the result summary screen.
router.get("/attempts/:attemptId/review", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Examination database schema is not ready yet." });
    return;
  }

  const parsed = resultAttemptIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }

  try {
    const payload = await getStudentResultReview(prisma, parsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "TEACHER_RESULT_REVIEW",
      entityType: "exam_attempts",
      entityId: String(parsed.data.attemptId),
      metadata: { exam_id: payload.review.exam_id },
      ipAddress: req.ip,
    });
    res.status(200).json({ status: "success", review: payload.review });
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "REVIEW_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unable to load review.",
    });
  }
});

function teacherReviewMediaHandler(purpose: "QUESTION" | "SOLUTION") {
  return async (req: AuthenticatedRequest, res: Response) => {
    if (!(await requireSchemaReady())) {
      res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Examination database schema is not ready yet." });
      return;
    }

    const attemptParsed = resultAttemptIdParamSchema.safeParse(req.params);
    const questionParsed = studentVersionQuestionIdParamSchema.safeParse(req.params);
    const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
    if (!attemptParsed.success || !questionParsed.success || !mediaParsed.success) {
      res.status(400).json({ status: "error", code: "VALIDATION_ERROR" });
      return;
    }

    try {
      const media = await readStudentResultReviewMediaFile(
        prisma,
        attemptParsed.data.attemptId,
        questionParsed.data.versionQuestionId,
        mediaParsed.data.mediaId,
        req.auth!.user,
        purpose,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", media.media.mime_type);
      res.setHeader("Content-Disposition", `inline; filename="review-${purpose.toLowerCase()}-${media.media.id}.bin"`);
      createReadStream(media.absolutePath).pipe(res);
    } catch (error) {
      res.status(403).json({
        status: "error",
        code: "REVIEW_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to load review media.",
      });
    }
  };
}

router.get("/attempts/:attemptId/review/questions/:versionQuestionId/media/:mediaId", teacherReviewMediaHandler("QUESTION"));
router.get("/attempts/:attemptId/review/questions/:versionQuestionId/solution/:mediaId", teacherReviewMediaHandler("SOLUTION"));

export { router as resultsRouter };

