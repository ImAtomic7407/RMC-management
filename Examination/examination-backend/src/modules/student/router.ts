import { createReadStream } from "node:fs";
import path from "node:path";
import { Router, type Response } from "express";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, writeAuthAuditLog } from "../../shared/auth.js";
import { requireSchemaReady } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";
import { resultAttemptIdParamSchema } from "../results/schemas.js";
import { getStudentResultDetail, getStudentResultReview, listStudentResults, readStudentResultReviewMediaFile } from "../results/service.js";
import { getStudentLeaderboard } from "../leaderboard/service.js";
import { studentLeaderboardQuerySchema, studentAttemptIdParamSchema, studentExamIdParamSchema, studentExamsQuerySchema, studentMediaIdParamSchema, studentQuestionIdParamSchema, studentVersionQuestionIdParamSchema, studentPracticePaperIdParamSchema, studentPracticeAnswerSaveSchema, practiceQuestionCheckSchema, saveStudentAnswerSchema } from "./schemas.js";
import { examGatePaperDownloadStatusSchema, examGateQrRequestSchema, examViolationCreateSchema, studentExamGateQuerySchema, studentExamStartSchema } from "../exam-gate/schemas.js";
import { createStudentGateQr, getStudentGateStatus, isExamGateError, mapGateStatus, recordExamViolation, unlockStudentAssignedPaperReview, updateStudentPaperDownloadStatus } from "../exam-gate/service.js";
import { checkPracticeAnswer, getStudentExamPaper, getStudentLiveSolution, getStudentPracticeSolution, listStudentExams, loadStudentQuestionMedia, readStudentPracticeSolutionMediaFile, readStudentSolutionMediaFile, saveStudentAnswer, startOrResumeAttempt, submitStudentAttempt, startStudentPracticeSession } from "./service.js";
import { getStudentPracticeAttempt, getStudentPracticeQuestionPaperMediaFile, getStudentPracticeReview, getStudentPracticeResultDetail, listStudentPracticePapers, listStudentPracticeResults, readStudentPracticeReviewMediaFile, saveStudentPracticeAnswer, startOrResumeStudentPractice, submitStudentPracticeAttempt } from "./self-practice.js";

const router = Router();

/**
 * Safely resolve a DB-stored media `storage_url` to an absolute path, ensuring it
 * cannot escape the uploads root (defense-in-depth against tampered storage_url).
 */
function safeMediaStoragePath(storageUrl: string): string {
  const resolved = path.resolve(process.cwd(), storageUrl.replace(/^\/+/, ""));
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) {
    throw new Error("Invalid media storage path.");
  }
  return resolved;
}

router.use(requireAuthMiddleware, requireRoleMiddleware("STUDENT"));

function parseExamId(req: AuthenticatedRequest, res: Response) {
  const parsed = studentExamIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data.examId;
}

function parsePracticePaperId(req: AuthenticatedRequest, res: Response) {
  const parsed = studentPracticePaperIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data.paperId;
}

function parseQuestionId(req: AuthenticatedRequest, res: Response) {
  const parsed = studentQuestionIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data.questionId;
}

async function respondStudentExamPayload(req: AuthenticatedRequest, res: Response, examId: number, deviceId?: string | null) {
  try {
    const paper = await getStudentExamPaper(prisma, examId, req.auth!.user, deviceId ?? undefined);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_EXAM_PAPER_VIEW",
      entityType: "exams",
      entityId: String(examId),
      metadata: {
        question_count: paper.questions.length,
        question_paper_version_id: "question_paper_version_id" in paper.exam ? paper.exam.question_paper_version_id ?? null : null,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      exam: paper.exam,
      attempt: paper.attempt,
      questions: paper.questions,
      gate: paper.gate ?? null,
      assigned_paper: paper.assigned_paper ?? null,
      locked_review_package: paper.locked_review_package ?? null,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }

    res.status(400).json({
      status: "error",
      code: "EXAM_PAPER_FAILED",
      message: error instanceof Error ? error.message : "Unable to load exam paper.",
    });
  }
}

function parseMediaId(req: AuthenticatedRequest, res: Response) {
  const parsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data.mediaId;
}

router.get("/exams", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = studentExamsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await listStudentExams(prisma, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_EXAMS_LIST",
      entityType: "student",
      entityId: String(req.auth!.user.id),
      metadata: {
        count: result.exams.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      exams: result.exams,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Unable to load exams.",
    });
  }
});

router.get("/exams/:examId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedQuery = studentExamGateQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedQuery.error.flatten(),
    });
    return;
  }

  await respondStudentExamPayload(req, res, examId, parsedQuery.data.device_id ?? null);
});

router.get("/exams/:examId/download-payload", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedQuery = studentExamGateQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedQuery.error.flatten(),
    });
    return;
  }

  await respondStudentExamPayload(req, res, examId, parsedQuery.data.device_id ?? null);
});

router.get("/exams/:examId/assigned-paper/review-unlock", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedQuery = studentExamGateQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedQuery.error.flatten(),
    });
    return;
  }

  try {
    const studentProfile = await prisma.student_profiles.findFirst({
      where: {
        user_id: req.auth!.user.id,
        active: true,
      },
      select: {
        id: true,
      },
    });
    if (!studentProfile) {
      res.status(404).json({
        status: "error",
        code: "STUDENT_NOT_FOUND",
        message: "Student profile not found.",
      });
      return;
    }

    const payload = await unlockStudentAssignedPaperReview(prisma, examId, studentProfile.id, parsedQuery.data.device_id ?? null);
    res.status(200).json({
      status: "success",
      unlock: payload.unlock,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }

    res.status(400).json({
      status: "error",
      code: "REVIEW_UNLOCK_FAILED",
      message: error instanceof Error ? error.message : "Unable to unlock review package.",
    });
  }
});

router.post("/exams/:examId/start", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedBody = studentExamStartSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const result = await startOrResumeAttempt(prisma, examId, req.auth!.user, {
      device_id: parsedBody.data.device_id ?? null,
    });
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_ATTEMPT_START",
      entityType: "exam_attempts",
      entityId: String(result.attempt.id),
      metadata: {
        exam_id: examId,
        status: result.status,
        device_id: parsedBody.data.device_id ?? null,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      result,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "ATTEMPT_START_FAILED",
      message: error instanceof Error ? error.message : "Unable to start attempt.",
    });
  }
});

// Practice a past (CLOSED / RESULT_RELEASED) exam — returns shuffled paper with
// correct answers included. Results are NOT stored in exam_attempts, so they
// are never counted on the leaderboard.
router.post("/exams/:examId/practice/start", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Database schema is not ready." });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) return;

  try {
    const result = await startStudentPracticeSession(prisma, examId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_SESSION_START",
      entityType: "exams",
      entityId: String(examId),
      metadata: { question_count: result.questions.length, not_ranked: true },
      ipAddress: req.ip,
    });
    res.status(200).json({ status: "success", ...result });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({ status: "error", code: error.code, message: error.message });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "PRACTICE_START_FAILED",
      message: error instanceof Error ? error.message : "Unable to start practice session.",
    });
  }
});

router.post("/exams/:examId/gate/qr", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedBody = examGateQrRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const payload = await createStudentGateQr(prisma, examId, req.auth!.user, parsedBody.data.device_id, parsedBody.data.has_overlay_permission);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_GATE_QR_REQUEST",
      entityType: "exam_gate_sessions",
      entityId: String(payload.gate_session?.id ?? 0),
      metadata: {
        exam_id: examId,
        device_id: parsedBody.data.device_id,
      },
      ipAddress: req.ip,
    });
    // Include gate status (can_start_attempt, can_enter_waiting_room) so the
    // Android app can immediately skip the waiting room if the exam is already LIVE.
    const gateStatus = mapGateStatus(
      payload.gate_session as any,
      payload.exam as any,
      null,
    );
    res.status(200).json({
      status: "success",
      qr_payload: payload.qr_payload,
      gate_session: payload.gate_session,
      gate: gateStatus,
      exam_status: payload.exam?.status ?? null,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    // Unexpected server-side error — log it but don't leak internals to the student.
    console.error("[gate/qr] Unexpected error during QR generation:", error);
    res.status(500).json({
      status: "error",
      code: "QR_REQUEST_FAILED",
      message: "Unable to generate your entry QR. Please wait a moment and try again.",
    });
  }
});

router.get("/exams/:examId/gate/status", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  try {
    const hasOverlayPermission = req.query.has_overlay_permission !== undefined
      ? req.query.has_overlay_permission === "true"
      : undefined;
    const payload = await getStudentGateStatus(prisma, examId, req.auth!.user, hasOverlayPermission);
    res.status(200).json({
      status: "success",
      student: payload.student,
      exam: payload.exam,
      gate: payload.gate,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "GATE_STATUS_FAILED",
      message: error instanceof Error ? error.message : "Unable to load gate status.",
    });
  }
});

router.patch("/exams/:examId/gate/paper-download-status", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedBody = examGatePaperDownloadStatusSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const payload = await updateStudentPaperDownloadStatus(prisma, examId, req.auth!.user, parsedBody.data);
    res.status(200).json({
      status: "success",
      student: payload.student,
      exam: payload.exam,
      gate: payload.gate,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "GATE_DOWNLOAD_STATUS_FAILED",
      message: error instanceof Error ? error.message : "Unable to update download status.",
    });
  }
});

router.post("/exams/:examId/violations", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  if (!examId) {
    return;
  }

  const parsedBody = examViolationCreateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsedBody.error.flatten(),
    });
    return;
  }

  try {
    const payload = await recordExamViolation(prisma, examId, req.auth!.user, parsedBody.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_EXAM_VIOLATION",
      entityType: "exam_attempt_violations",
      entityId: String(payload.violation.id),
      metadata: {
        exam_id: examId,
        violation_type: payload.violation.violation_type,
        severity: payload.violation.severity,
      },
      ipAddress: req.ip,
    });
    res.status(201).json({
      status: "success",
      violation: payload.violation,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "VIOLATION_LOG_FAILED",
      message: error instanceof Error ? error.message : "Unable to log violation.",
    });
  }
});

router.patch("/attempts/:attemptId/answers", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  const parsed = saveStudentAnswerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await saveStudentAnswer(prisma, attemptParsed.data.attemptId, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_ANSWER_SAVE",
      entityType: "attempt_answers",
      entityId: String(result.saved.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: parsed.data.question_id ?? parsed.data.assigned_question_id ?? parsed.data.version_question_id ?? null,
        assigned_question_id: parsed.data.assigned_question_id ?? null,
        version_question_id: parsed.data.version_question_id ?? null,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      answer: {
        id: result.saved.id,
        attempt_id: result.saved.attempt_id,
        question_id: result.submitted_question_id,
        stored_question_id: result.saved.question_id,
        assigned_question_id: result.assigned_question_id,
        version_question_id: result.version_question_id,
        selected_option_id: result.saved.selected_option_id,
        integer_answer: result.saved.integer_answer,
        is_marked_for_review: result.saved.is_marked_for_review,
        timed_out: result.saved.timed_out,
        saved_at: result.saved.saved_at,
      },
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "ANSWER_SAVE_FAILED",
      message: error instanceof Error ? error.message : "Unable to save answer.",
    });
  }
});

router.post("/attempts/:attemptId/submit", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await submitStudentAttempt(prisma, attemptParsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_ATTEMPT_SUBMIT",
      entityType: "exam_attempts",
      entityId: String(attemptParsed.data.attemptId),
      metadata: {
        status: result.status,
        client_submitted_at: req.body?.client_submitted_at ?? null,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      result,
    });
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(400).json({
      status: "error",
      code: "ATTEMPT_SUBMIT_FAILED",
      message: error instanceof Error ? error.message : "Unable to submit attempt.",
    });
  }
});

router.get("/results", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  try {
    const payload = await listStudentResults(prisma, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_RESULTS_LIST",
      entityType: "student",
      entityId: String(req.auth!.user.id),
      metadata: {
        result_count: payload.results.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      student: payload.student,
      results: payload.results,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "RESULT_LIST_FAILED",
      message: error instanceof Error ? error.message : "Unable to load student results.",
    });
  }
});

router.get("/results/:attemptId", async (req: AuthenticatedRequest, res: Response) => {
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
    const payload = await getStudentResultDetail(prisma, parsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_RESULT_DETAIL",
      entityType: "exam_attempts",
      entityId: String(parsed.data.attemptId),
      metadata: {
        exam_id: payload.attempt.exam.id,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      student: payload.student,
      attempt: payload.attempt,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "RESULT_DETAIL_FAILED",
      message: error instanceof Error ? error.message : "Unable to load result.",
    });
  }
});

router.get("/results/:attemptId/review", async (req: AuthenticatedRequest, res: Response) => {
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
    const payload = await getStudentResultReview(prisma, parsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_RESULT_REVIEW",
      entityType: "exam_attempts",
      entityId: String(parsed.data.attemptId),
      metadata: {
        exam_id: payload.review.exam_id,
        question_paper_version_id: payload.review.question_paper_version_id,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      review: payload.review,
    });
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "REVIEW_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load review.",
    });
  }
});

router.get("/results/:attemptId/review/questions/:versionQuestionId/media/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = resultAttemptIdParamSchema.safeParse(req.params);
  const questionParsed = studentVersionQuestionIdParamSchema.safeParse(req.params);
  const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success || !questionParsed.success || !mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !attemptParsed.success
        ? attemptParsed.error.flatten()
        : !questionParsed.success
          ? questionParsed.error.flatten()
          : mediaParsed.error!.flatten(),
    });
    return;
  }

  try {
    const media = await readStudentResultReviewMediaFile(
      prisma,
      attemptParsed.data.attemptId,
      questionParsed.data.versionQuestionId,
      mediaParsed.data.mediaId,
      req.auth!.user,
      "QUESTION",
    );
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_RESULT_REVIEW_QUESTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: questionParsed.data.versionQuestionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="review-question-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "REVIEW_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load review media.",
    });
  }
});

router.get("/results/:attemptId/review/questions/:versionQuestionId/solution/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = resultAttemptIdParamSchema.safeParse(req.params);
  const questionParsed = studentVersionQuestionIdParamSchema.safeParse(req.params);
  const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success || !questionParsed.success || !mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !attemptParsed.success
        ? attemptParsed.error.flatten()
        : !questionParsed.success
          ? questionParsed.error.flatten()
          : mediaParsed.error!.flatten(),
    });
    return;
  }

  try {
    const media = await readStudentResultReviewMediaFile(
      prisma,
      attemptParsed.data.attemptId,
      questionParsed.data.versionQuestionId,
      mediaParsed.data.mediaId,
      req.auth!.user,
      "SOLUTION",
    );
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_RESULT_REVIEW_SOLUTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: questionParsed.data.versionQuestionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="review-solution-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "REVIEW_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load review media.",
    });
  }
});

router.get("/leaderboard", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const parsed = studentLeaderboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await getStudentLeaderboard(prisma, req.auth!.user, parsed.data.scope, parsed.data.examId, parsed.data.batchId);
    const viewer = payload.leaderboard.find((entry) => entry.student_id === payload.viewer_student_id) ?? null;
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_LEADERBOARD_VIEW",
      entityType: "leaderboard_entries",
      entityId: String(payload.scope.id ?? "overall"),
      metadata: {
        scope: payload.scope.type,
        generated: payload.leaderboard.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      scope: payload.scope,
      leaderboard: payload.leaderboard,
      viewer,
      generated: payload.leaderboard.length,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "LEADERBOARD_VIEW_FAILED",
      message: error instanceof Error ? error.message : "Unable to load leaderboard.",
    });
  }
});

router.get("/exams/:examId/questions/:questionId/media/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = studentExamIdParamSchema.safeParse(req.params);
  const questionParsed = studentQuestionIdParamSchema.safeParse(req.params);
  const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !questionParsed.success || !mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success
        ? examParsed.error.flatten()
        : !questionParsed.success
          ? questionParsed.error.flatten()
          : mediaParsed.error!.flatten(),
    });
    return;
  }

  try {
    const media = await loadStudentQuestionMedia(prisma, examParsed.data.examId, questionParsed.data.questionId, mediaParsed.data.mediaId, req.auth!.user);
    const absolutePath = safeMediaStoragePath(media.media.storage_url);

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_QUESTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        exam_id: examParsed.data.examId,
        question_id: questionParsed.data.questionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="question-${media.media.id}.bin"`);
    createReadStream(absolutePath).pipe(res);
  } catch (error) {
    if (isExamGateError(error)) {
      res.status(error.status).json({
        status: "error",
        code: error.code,
        message: error.message,
      });
      return;
    }
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Media not found.",
    });
  }
});

router.get("/practice/papers", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  try {
    const payload = await listStudentPracticePapers(prisma, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_PAPERS_LIST",
      entityType: "question_papers",
      entityId: String(req.auth!.user.id),
      metadata: {
        count: payload.papers.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      student: payload.student,
      papers: payload.papers,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_PAPERS_LIST_FAILED",
      message: error instanceof Error ? error.message : "Unable to load practice papers.",
    });
  }
});

router.post("/practice/papers/:paperId/start", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperId = parsePracticePaperId(req, res);
  if (!paperId) {
    return;
  }

  try {
    const payload = await startOrResumeStudentPractice(prisma, paperId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_START",
      entityType: "practice_attempts",
      entityId: String(payload.practice.attempt.id),
      metadata: {
        paper_id: paperId,
        status: payload.status,
        version_id: payload.practice.attempt.practice_question_paper_version_id,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      result: {
        status: payload.status,
        practice: payload.practice,
        paper: {
          id: payload.paper.id,
          title: payload.paper.title,
          category: payload.paper.category,
          batch_id: payload.paper.batch_id,
          batch_name: payload.paper.batch_name,
          is_self_practice_enabled: payload.paper.is_self_practice_enabled,
          duration_seconds: payload.paper.duration_seconds ?? null,
          solution_policy: payload.paper.solution_policy ?? "AFTER_SUBMIT",
          not_ranked: true,
        },
        questions: payload.practice.questions,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_START_FAILED",
      message: error instanceof Error ? error.message : "Unable to start practice.",
    });
  }
});

router.get("/practice/attempts/:attemptId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await getStudentPracticeAttempt(prisma, attemptParsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_ATTEMPT_VIEW",
      entityType: "practice_attempts",
      entityId: String(attemptParsed.data.attemptId),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      practice: payload.practice,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_ATTEMPT_FAILED",
      message: error instanceof Error ? error.message : "Unable to load practice attempt.",
    });
  }
});

router.patch("/practice/attempts/:attemptId/answers", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  const parsed = studentPracticeAnswerSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await saveStudentPracticeAnswer(prisma, attemptParsed.data.attemptId, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_ANSWER_SAVE",
      entityType: "practice_attempt_answers",
      entityId: String(result.saved.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: parsed.data.question_id,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      answer: {
        id: result.saved.id,
        practice_attempt_id: result.saved.practice_attempt_id,
        question_id: result.practice_question_id,
        stored_question_id: result.saved.version_question_id,
        selected_option_id: result.saved.selected_option_id,
        integer_answer: result.saved.integer_answer,
        is_marked_for_review: result.saved.is_marked_for_review,
        saved_at: result.saved.saved_at,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_ANSWER_SAVE_FAILED",
      message: error instanceof Error ? error.message : "Unable to save practice answer.",
    });
  }
});

router.post("/practice/attempts/:attemptId/submit", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await submitStudentPracticeAttempt(prisma, attemptParsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_SUBMIT",
      entityType: "practice_attempts",
      entityId: String(attemptParsed.data.attemptId),
      metadata: {
        status: result.status,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      result: {
        status: result.status,
        practice: result.attempt,
        summary: result.result
          ? {
              total_score: result.result.total_score.toString(),
              max_score: result.result.max_score.toString(),
              percentage: result.result.percentage.toString(),
              correct_count: result.result.correct_count,
              wrong_count: result.result.wrong_count,
              unattempted_count: result.result.unattempted_count,
              not_ranked: true,
            }
          : null,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_SUBMIT_FAILED",
      message: error instanceof Error ? error.message : "Unable to submit practice attempt.",
    });
  }
});

router.get("/practice/results", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  try {
    const payload = await listStudentPracticeResults(prisma, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_RESULTS_LIST",
      entityType: "student",
      entityId: String(req.auth!.user.id),
      metadata: {
        result_count: payload.results.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      student: payload.student,
      results: payload.results,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_RESULTS_LIST_FAILED",
      message: error instanceof Error ? error.message : "Unable to load practice results.",
    });
  }
});

router.get("/practice/results/:attemptId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await getStudentPracticeResultDetail(prisma, attemptParsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_RESULT_DETAIL",
      entityType: "practice_attempts",
      entityId: String(attemptParsed.data.attemptId),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      student: payload.student,
      attempt: payload.attempt,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_RESULT_DETAIL_FAILED",
      message: error instanceof Error ? error.message : "Unable to load practice result.",
    });
  }
});

router.get("/practice/results/:attemptId/review", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: attemptParsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await getStudentPracticeReview(prisma, attemptParsed.data.attemptId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_REVIEW",
      entityType: "practice_attempts",
      entityId: String(attemptParsed.data.attemptId),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        version_id: payload.review.practice_question_paper_version_id,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      review: payload.review,
    });
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "PRACTICE_REVIEW_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load practice review.",
    });
  }
});

router.get("/practice/results/:attemptId/review/questions/:versionQuestionId/media/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  const questionParsed = studentVersionQuestionIdParamSchema.safeParse(req.params);
  const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success || !questionParsed.success || !mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !attemptParsed.success
        ? attemptParsed.error.flatten()
        : !questionParsed.success
          ? questionParsed.error.flatten()
          : mediaParsed.error!.flatten(),
    });
    return;
  }

  try {
    const media = await readStudentPracticeReviewMediaFile(
      prisma,
      attemptParsed.data.attemptId,
      questionParsed.data.versionQuestionId,
      mediaParsed.data.mediaId,
      req.auth!.user,
      "QUESTION",
    );
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_REVIEW_QUESTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: questionParsed.data.versionQuestionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="practice-review-question-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "PRACTICE_REVIEW_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load review media.",
    });
  }
});

router.get("/practice/results/:attemptId/review/questions/:versionQuestionId/solution/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  const questionParsed = studentVersionQuestionIdParamSchema.safeParse(req.params);
  const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success || !questionParsed.success || !mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !attemptParsed.success
        ? attemptParsed.error.flatten()
        : !questionParsed.success
          ? questionParsed.error.flatten()
          : mediaParsed.error!.flatten(),
    });
    return;
  }

  try {
    const media = await readStudentPracticeReviewMediaFile(
      prisma,
      attemptParsed.data.attemptId,
      questionParsed.data.versionQuestionId,
      mediaParsed.data.mediaId,
      req.auth!.user,
      "SOLUTION",
    );
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_REVIEW_SOLUTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: questionParsed.data.versionQuestionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="practice-review-solution-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "PRACTICE_REVIEW_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load review media.",
    });
  }
});

router.get("/practice/attempts/:attemptId/questions/:versionQuestionId/media/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const attemptParsed = studentAttemptIdParamSchema.safeParse(req.params);
  const questionParsed = studentVersionQuestionIdParamSchema.safeParse(req.params);
  const mediaParsed = studentMediaIdParamSchema.safeParse(req.params);
  if (!attemptParsed.success || !questionParsed.success || !mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !attemptParsed.success
        ? attemptParsed.error.flatten()
        : !questionParsed.success
          ? questionParsed.error.flatten()
          : mediaParsed.error!.flatten(),
    });
    return;
  }

  try {
    const media = await getStudentPracticeQuestionPaperMediaFile(
      prisma,
      attemptParsed.data.attemptId,
      questionParsed.data.versionQuestionId,
      mediaParsed.data.mediaId,
      req.auth!.user,
    );
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_QUESTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        attempt_id: attemptParsed.data.attemptId,
        question_id: questionParsed.data.versionQuestionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="practice-question-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "PRACTICE_QUESTION_MEDIA_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load practice media.",
    });
  }
});

router.post("/practice/questions/:questionId/check", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const questionId = parseQuestionId(req, res);
  if (!questionId) {
    return;
  }

  const parsed = practiceQuestionCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const payload = await checkPracticeAnswer(prisma, questionId, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_ANSWER_CHECK",
      entityType: "practice_question_attempts",
      entityId: String(payload.practiceAttempt.id),
      metadata: {
        exam_id: payload.exam.id,
        question_id: questionId,
        correct: payload.correct,
        solution_unlocked: payload.solutionUnlocked,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      correct: payload.correct,
      wrong_count: payload.practiceAttempt.wrong_count,
      attempt_count: payload.practiceAttempt.attempt_count,
      solution_unlocked: payload.solutionUnlocked,
      feedback: payload.feedback,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "PRACTICE_CHECK_FAILED",
      message: error instanceof Error ? error.message : "Unable to check practice answer.",
    });
  }
});

router.get("/practice/questions/:questionId/solution", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const questionId = parseQuestionId(req, res);
  if (!questionId) {
    return;
  }

  try {
    const payload = await getStudentPracticeSolution(prisma, questionId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_SOLUTION_VIEW",
      entityType: "question_media",
      entityId: String(questionId),
      metadata: {
        exam_id: payload.exam.id,
        question_id: questionId,
        media_count: payload.media.length,
      },
      ipAddress: req.ip,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      status: "success",
      exam: {
        id: payload.exam.id,
        title: payload.exam.title,
        exam_mode: payload.exam.exam_mode,
        status: payload.exam.status,
        solution_release_policy: payload.exam.solution_release_policy,
      },
      question: payload.question,
      practice_attempt: {
        id: payload.practiceAttempt.id,
        attempt_count: payload.practiceAttempt.attempt_count,
        wrong_count: payload.practiceAttempt.wrong_count,
        correct_count: payload.practiceAttempt.correct_count,
        solution_unlocked: payload.practiceAttempt.solution_unlocked,
        solution_unlocked_at: payload.practiceAttempt.solution_unlocked_at,
      },
      media: payload.media,
    });
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "PRACTICE_SOLUTION_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load solution.",
    });
  }
});

router.get("/practice/questions/:questionId/solution/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const questionId = parseQuestionId(req, res);
  const mediaId = parseMediaId(req, res);
  if (!questionId || !mediaId) {
    return;
  }

  try {
    const media = await readStudentPracticeSolutionMediaFile(prisma, questionId, mediaId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_PRACTICE_SOLUTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        exam_id: media.exam.id,
        question_id: questionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="solution-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "PRACTICE_SOLUTION_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load solution.",
    });
  }
});

router.get("/exams/:examId/questions/:questionId/solution", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  const questionId = parseQuestionId(req, res);
  if (!examId || !questionId) {
    return;
  }

  try {
    const payload = await getStudentLiveSolution(prisma, examId, questionId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_LIVE_SOLUTION_VIEW",
      entityType: "question_media",
      entityId: String(questionId),
      metadata: {
        exam_id: examId,
        question_id: questionId,
        media_count: payload.media.length,
      },
      ipAddress: req.ip,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      status: "success",
      exam: {
        id: payload.exam.id,
        title: payload.exam.title,
        exam_mode: payload.exam.exam_mode,
        status: payload.exam.status,
        solution_release_policy: payload.exam.solution_release_policy,
      },
      question: payload.question,
      media: payload.media,
    });
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "SOLUTION_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load solution.",
    });
  }
});

router.get("/exams/:examId/questions/:questionId/solution/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examId = parseExamId(req, res);
  const questionId = parseQuestionId(req, res);
  const mediaId = parseMediaId(req, res);
  if (!examId || !questionId || !mediaId) {
    return;
  }

  try {
    const media = await readStudentSolutionMediaFile(prisma, examId, questionId, mediaId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "STUDENT_LIVE_SOLUTION_MEDIA_VIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        exam_id: examId,
        question_id: questionId,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", media.media.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="solution-${media.media.id}.bin"`);
    createReadStream(media.absolutePath).pipe(res);
  } catch (error) {
    res.status(403).json({
      status: "error",
      code: "SOLUTION_LOCKED",
      message: error instanceof Error ? error.message : "Unable to load solution.",
    });
  }
});

export { router as studentRouter };
