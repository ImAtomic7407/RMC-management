import { Router, type Response } from "express";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, requireSchemaReady, writeAuthAuditLog } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";
import { recalculateAttemptResult } from "../results/service.js";
import { broadcastExamRealtime } from "../../shared/realtime.js";

const router = Router();

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

// GET /exam/:examId - List attempts for an exam
router.get("/exam/:examId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseInt(req.params.examId as string, 10);
  if (isNaN(examId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid examId.",
    });
    return;
  }

  try {
    const attempts = await prisma.exam_attempts.findMany({
      where: { exam_id: examId },
      include: {
        student: {
          include: {
            user: {
              select: {
                full_name: true,
                username: true,
              },
            },
          },
        },
        attempt_result: true,
      },
    });

    res.status(200).json({
      status: "success",
      attempts,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch attempts.",
    });
  }
});

// GET /:attemptId - Get detailed attempt information
router.get("/:attemptId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptId = parseInt(req.params.attemptId as string, 10);
  if (isNaN(attemptId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid attemptId.",
    });
    return;
  }

  try {
    const attempt = await prisma.exam_attempts.findUnique({
      where: { id: attemptId },
      include: {
        student: {
          include: {
            user: {
              select: {
                full_name: true,
                username: true,
              },
            },
          },
        },
        attempt_answers: {
          include: {
            question: true,
            selected_option: true,
          },
        },
        attempt_section_results: true,
        attempt_result: true,
      },
    });

    if (!attempt) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Attempt not found.",
      });
      return;
    }

    res.status(200).json({
      status: "success",
      attempt,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch attempt details.",
    });
  }
});

// POST /:attemptId/force-submit - Force submit and recalculate
router.post("/:attemptId/force-submit", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptId = parseInt(req.params.attemptId as string, 10);
  if (isNaN(attemptId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid attemptId.",
    });
    return;
  }

  try {
    const attempt = await prisma.exam_attempts.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Attempt not found.",
      });
      return;
    }

    // Update attempt status to AUTO_SUBMITTED if not already submitted
    if (attempt.status !== "SUBMITTED" && attempt.status !== "AUTO_SUBMITTED") {
      await prisma.exam_attempts.update({
        where: { id: attemptId },
        data: {
          status: "AUTO_SUBMITTED",
          submitted_at: new Date(),
          is_auto_submitted: true,
        },
      });
    }

    // Call existing recalculateAttemptResult from results module
    const recalcResult = await recalculateAttemptResult(prisma, attemptId);

    // Broadcast remote submit to WebSocket
    broadcastExamRealtime({
      type: "attempt.updated",
      examId: attempt.exam_id,
      studentId: attempt.student_id,
      attemptId: attempt.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "force_submitted",
        status: "AUTO_SUBMITTED",
      },
    });

    // Write audit log
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "ATTEMPT_FORCE_SUBMIT",
      entityType: "exam_attempts",
      entityId: String(attemptId),
      metadata: {
        exam_id: attempt.exam_id,
        student_id: attempt.student_id,
        total_score: recalcResult.result.total_score,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      message: "Attempt force submitted and results calculated successfully.",
      result: recalcResult.result,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "FORCE_SUBMIT_FAILED",
      message: error instanceof Error ? error.message : "Failed to force submit attempt.",
    });
  }
});

// POST /:attemptId/warn - Warn a student during their attempt
router.post("/:attemptId/warn", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptId = parseInt(req.params.attemptId as string, 10);
  if (isNaN(attemptId)) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid attemptId.",
    });
    return;
  }

  const warningMessage = req.body.message || "Exam security warning. Please stay on the exam screen.";

  try {
    const attempt = await prisma.exam_attempts.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Attempt not found.",
      });
      return;
    }

    // Record violation warning in exam_attempt_violations
    await prisma.exam_attempt_violations.create({
      data: {
        exam_id: attempt.exam_id,
        attempt_id: attempt.id,
        student_id: attempt.student_id,
        device_id: attempt.device_id,
        violation_type: "LOW_VOLUME_WARNING",
        severity: "WARNING",
        message: warningMessage,
        metadata_json: JSON.stringify({ source: "teacher_forced_warning" }),
      },
    });

    // Broadcast warning to WebSocket
    broadcastExamRealtime({
      type: "exam.updated",
      examId: attempt.exam_id,
      studentId: attempt.student_id,
      attemptId: attempt.id,
      actorRole: req.auth!.user.role,
      payload: {
        action: "violation_logged",
        severity: "WARNING",
        message: warningMessage,
      },
    });

    // Write audit log
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "ATTEMPT_WARN",
      entityType: "exam_attempts",
      entityId: String(attemptId),
      metadata: {
        exam_id: attempt.exam_id,
        student_id: attempt.student_id,
        message: warningMessage,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      message: "Warning successfully sent to student.",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      code: "WARN_FAILED",
      message: error instanceof Error ? error.message : "Failed to record warning.",
    });
  }
});

export { router as attemptsRouter };
