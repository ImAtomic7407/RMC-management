import { Router, type Response } from "express";
import { prisma } from "../../shared/prisma.js";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, requireSchemaReady, writeAuthAuditLog } from "../../shared/auth.js";
import { createQuestionSchema, examIdParamSchema, questionIdParamSchema, questionListQuerySchema, reorderQuestionSchema, updateQuestionSchema } from "./schemas.js";
import { createQuestion, deactivateQuestion, getQuestionDetail, listQuestions, reorderQuestions, updateQuestion } from "./service.js";

const router = Router({ mergeParams: true });

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = examIdParamSchema.safeParse(req.params);
  if (!examParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: examParsed.error.flatten(),
    });
    return;
  }

  const queryParsed = questionListQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: queryParsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await listQuestions(prisma, examParsed.data.examId, req.auth!.user);
    res.status(200).json({
      status: "success",
      exam: result.exam,
      questions: queryParsed.data.include_inactive ? result.questions : result.questions.filter((item) => item.is_active),
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Exam not found.",
    });
  }
});

router.post("/reorder", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = examIdParamSchema.safeParse(req.params);
  if (!examParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: examParsed.error.flatten(),
    });
    return;
  }

  const parsed = reorderQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const questions = await reorderQuestions(prisma, examParsed.data.examId, req.auth!.user, parsed.data.section_code, parsed.data.questions);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_REORDER",
      entityType: "questions",
      entityId: String(examParsed.data.examId),
      metadata: {
        section_code: parsed.data.section_code,
        count: questions.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      questions,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_REORDER_FAILED",
      message: error instanceof Error ? error.message : "Failed to reorder questions.",
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

  const examParsed = examIdParamSchema.safeParse(req.params);
  if (!examParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: examParsed.error.flatten(),
    });
    return;
  }

  const parsed = createQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const question = await createQuestion(prisma, examParsed.data.examId, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_CREATE",
      entityType: "questions",
      entityId: String(question.id),
      metadata: {
        exam_id: question.exam_id,
        section_code: question.section_code,
        question_type: question.question_type,
      },
      ipAddress: req.ip,
    });
    res.status(201).json({
      status: "success",
      question,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to create question.",
    });
  }
});

router.get("/:questionId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = examIdParamSchema.safeParse(req.params);
  const questionParsed = questionIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !questionParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : questionParsed.error!.flatten(),
    });
    return;
  }

  const question = await getQuestionDetail(prisma, examParsed.data.examId, questionParsed.data.questionId, req.auth!.user);
  if (!question) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: "Question not found.",
    });
    return;
  }

  res.status(200).json({
    status: "success",
    question,
  });
});

router.patch("/:questionId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = examIdParamSchema.safeParse(req.params);
  const questionParsed = questionIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !questionParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : questionParsed.error!.flatten(),
    });
    return;
  }

  const parsed = updateQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const question = await updateQuestion(prisma, examParsed.data.examId, questionParsed.data.questionId, req.auth!.user, parsed.data);
    if (!question) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Question not found.",
      });
      return;
    }
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_UPDATE",
      entityType: "questions",
      entityId: String(question.id),
      metadata: {
        exam_id: question.exam_id,
        section_code: question.section_code,
        question_type: question.question_type,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      question,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_UPDATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to update question.",
    });
  }
});

router.delete("/:questionId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const examParsed = examIdParamSchema.safeParse(req.params);
  const questionParsed = questionIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !questionParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : questionParsed.error!.flatten(),
    });
    return;
  }

  try {
    const question = await deactivateQuestion(prisma, examParsed.data.examId, questionParsed.data.questionId, req.auth!.user);
    if (!question) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Question not found.",
      });
      return;
    }
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_DEACTIVATE",
      entityType: "questions",
      entityId: String(question.id),
      metadata: {
        exam_id: question.exam_id,
        section_code: question.section_code,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      question,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_DEACTIVATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to deactivate question.",
    });
  }
});

export { router as questionsRouter };
