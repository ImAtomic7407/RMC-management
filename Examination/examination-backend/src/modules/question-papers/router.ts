import { Router, type Response } from "express";
import multer, { MulterError } from "multer";
import { prisma } from "../../shared/prisma.js";
import { respondWithImage, parseWidthParam } from "../media/imageResponse.js";
import { broadcastExamRealtime } from "../../shared/realtime";
import { requireAuthMiddleware, requireRoleMiddleware, requireSchemaReady, type AuthenticatedRequest, writeAuthAuditLog } from "../../shared/auth.js";
import {
  archiveQuestionPaper,
  createPaperQuestion,
  createQuestionPaper,
  deletePaperQuestion,
  deletePaperQuestionMedia,
  getPaperQuestion,
  getQuestionPaper,
  listPaperQuestionMedia,
  listPaperQuestions,
  listQuestionPapers,
  readPaperQuestionMediaFile,
  reorderPaperQuestions,
  replacePaperQuestionMedia,
  scheduleExamFromQuestionPaper,
  updatePaperQuestion,
  updateQuestionPaper,
  uploadPaperQuestionMedia,
} from "./service.js";
import {
  paperMediaUploadSchema,
  paperQuestionCreateSchema,
  paperQuestionListQuerySchema,
  paperQuestionReorderSchema,
  paperQuestionUpdateSchema,
  scheduleExamSchema,
  questionPaperCreateSchema,
  questionPaperIdParamSchema,
  questionPaperListQuerySchema,
  questionPaperMediaIdParamSchema,
  questionPaperQuestionIdParamSchema,
  questionPaperUpdateSchema,
} from "./schemas.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // Allow generous headroom — the app normalizes images to ~4 MB JPEGs, but raw
    // phone photos uploaded from other clients can be larger.
    fileSize: 25 * 1024 * 1024,
  },
});
const uploadSingle = upload.single("file");

function respondMulterError(res: Response, error: unknown, fallbackCode: string) {
  if (error instanceof MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "File size exceeds the 25 MB limit.",
    });
    return true;
  }

  res.status(400).json({
    status: "error",
    code: fallbackCode,
    message: error instanceof Error ? error.message : "Request failed.",
  });
  return true;
}

async function parseMultipartUpload(req: AuthenticatedRequest, res: Response) {
  await new Promise<void>((resolve, reject) => {
    uploadSingle(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function ensureMultipartFile(req: AuthenticatedRequest, res: Response) {
  const file = req.file;
  if (!file) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "file is required.",
    });
    return null;
  }
  return file;
}

function parsePaperParams(req: AuthenticatedRequest, res: Response) {
  const parsed = questionPaperIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data;
}

function parsePaperQuestionParams(req: AuthenticatedRequest, res: Response) {
  const parsed = questionPaperQuestionIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data;
}

function parsePaperMediaParams(req: AuthenticatedRequest, res: Response) {
  const parsed = questionPaperMediaIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return null;
  }
  return parsed.data;
}

const router = Router();
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

  const parsed = questionPaperListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  const question_papers = await listQuestionPapers(prisma, req.auth!.user, parsed.data.include_archived);
  res.status(200).json({
    status: "success",
    count: question_papers.length,
    question_papers,
  });
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

  const parsed = questionPaperCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const paper = await createQuestionPaper(prisma, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_CREATE",
      entityType: "question_papers",
      entityId: String(paper?.id ?? 0),
      metadata: {
        title: paper?.title,
        batch_id: paper?.batch_id,
      },
      ipAddress: req.ip,
    });
    res.status(201).json({
      status: "success",
      paper,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_PAPER_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to create question paper.",
    });
  }
});

router.get("/:paperId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parsePaperParams(req, res);
  if (!params) {
    return;
  }

  const paper = await getQuestionPaper(prisma, params.paperId, req.auth!.user);
  if (!paper) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: "Question paper not found.",
    });
    return;
  }

  res.status(200).json({
    status: "success",
    paper,
  });
});

router.patch("/:paperId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parsePaperParams(req, res);
  if (!params) {
    return;
  }

  const parsed = questionPaperUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const paper = await updateQuestionPaper(prisma, params.paperId, req.auth!.user, parsed.data);
    if (!paper) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Question paper not found.",
      });
      return;
    }
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_UPDATE",
      entityType: "question_papers",
      entityId: String(params.paperId),
      metadata: {
        title: paper.title,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      paper,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_PAPER_UPDATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to update question paper.",
    });
  }
});

router.delete("/:paperId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parsePaperParams(req, res);
  if (!params) {
    return;
  }

  try {
    const paper = await archiveQuestionPaper(prisma, params.paperId, req.auth!.user);
    if (!paper) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Question paper not found.",
      });
      return;
    }
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_ARCHIVE",
      entityType: "question_papers",
      entityId: String(params.paperId),
      metadata: {
        status: paper.status,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      paper,
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_PAPER_ARCHIVE_FAILED",
      message: error instanceof Error ? error.message : "Failed to archive question paper.",
    });
  }
});

const questionsRouter = Router({ mergeParams: true });
questionsRouter.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

questionsRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperParams(req, res);
  if (!paperParams) {
    return;
  }

  const parsed = paperQuestionListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await listPaperQuestions(prisma, paperParams.paperId, req.auth!.user, parsed.data.include_inactive);
    res.status(200).json({
      status: "success",
      paper: result.paper,
      questions: result.questions,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Question paper not found.",
    });
  }
});

questionsRouter.post("/reorder", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperParams(req, res);
  if (!paperParams) {
    return;
  }

  const parsed = paperQuestionReorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const questions = await reorderPaperQuestions(prisma, paperParams.paperId, req.auth!.user, parsed.data.section_code, parsed.data.questions);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_REORDER",
      entityType: "paper_questions",
      entityId: String(paperParams.paperId),
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
      code: "QUESTION_PAPER_REORDER_FAILED",
      message: error instanceof Error ? error.message : "Failed to reorder paper questions.",
    });
  }
});

questionsRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperParams(req, res);
  if (!paperParams) {
    return;
  }

  const parsed = paperQuestionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const question = await createPaperQuestion(prisma, paperParams.paperId, req.auth!.user, parsed.data);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_QUESTION_CREATE",
      entityType: "paper_questions",
      entityId: String(question.id),
      metadata: {
        question_paper_id: question.question_paper_id,
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
      code: "QUESTION_PAPER_QUESTION_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to create question.",
    });
  }
});

questionsRouter.get("/:questionId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperQuestionParams(req, res);
  if (!paperParams) {
    return;
  }

  const question = await getPaperQuestion(prisma, paperParams.paperId, paperParams.questionId, req.auth!.user);
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

questionsRouter.patch("/:questionId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperQuestionParams(req, res);
  if (!paperParams) {
    return;
  }

  const parsed = paperQuestionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: parsed.error.flatten(),
    });
    return;
  }

  try {
    const question = await updatePaperQuestion(prisma, paperParams.paperId, paperParams.questionId, req.auth!.user, parsed.data);
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
      action: "QUESTION_PAPER_QUESTION_UPDATE",
      entityType: "paper_questions",
      entityId: String(question.id),
      metadata: {
        question_paper_id: question.question_paper_id,
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
      code: "QUESTION_PAPER_QUESTION_UPDATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to update question.",
    });
  }
});

questionsRouter.delete("/:questionId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperQuestionParams(req, res);
  if (!paperParams) {
    return;
  }

  try {
    const question = await deletePaperQuestion(prisma, paperParams.paperId, paperParams.questionId, req.auth!.user);
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
      action: "QUESTION_PAPER_QUESTION_DEACTIVATE",
      entityType: "paper_questions",
      entityId: String(question.id),
      metadata: {
        question_paper_id: question.question_paper_id,
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
      code: "QUESTION_PAPER_QUESTION_DEACTIVATE_FAILED",
      message: error instanceof Error ? error.message : "Failed to deactivate question.",
    });
  }
});

const mediaRouter = Router({ mergeParams: true });
mediaRouter.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

mediaRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperQuestionParams(req, res);
  if (!paperParams) {
    return;
  }

  try {
    const result = await listPaperQuestionMedia(prisma, paperParams.paperId, paperParams.questionId, req.auth!.user);
    res.status(200).json({
      status: "success",
      paper: result.paper,
      question: result.question,
      media: result.media,
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Question not found.",
    });
  }
});

mediaRouter.get("/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperMediaParams(req, res);
  if (!paperParams) {
    return;
  }

  try {
    const loaded = await readPaperQuestionMediaFile(prisma, paperParams.paperId, paperParams.questionId, paperParams.mediaId, req.auth!.user);
    if (!loaded) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Media not found.",
      });
      return;
    }

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_MEDIA_PREVIEW",
      entityType: "paper_question_media",
      entityId: String(loaded.media.id),
      metadata: {
        question_paper_id: paperParams.paperId,
        question_id: paperParams.questionId,
        purpose: loaded.media.purpose,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Content-Disposition", `inline; filename="${loaded.media.id}-${loaded.media.purpose.toLowerCase()}.bin"`);
    // Optional `?w=<px>` returns a downscaled, disk-cached thumbnail (aspect preserved).
    // No `w` → original is streamed unchanged.
    await respondWithImage(res, loaded.absolutePath, loaded.media.mime_type, parseWidthParam(req.query.w));
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Media not found.",
    });
  }
});

mediaRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperQuestionParams(req, res);
  if (!paperParams) {
    return;
  }

  try {
    await parseMultipartUpload(req, res);
    const body = paperMediaUploadSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        status: "error",
        code: "VALIDATION_ERROR",
        issues: body.error.flatten(),
      });
      return;
    }
    const file = ensureMultipartFile(req, res);
    if (!file) {
      return;
    }

    const media = await uploadPaperQuestionMedia(prisma, paperParams.paperId, paperParams.questionId, req.auth!.user, {
      purpose: body.data.purpose,
      sortOrder: body.data.sort_order,
      file,
    });

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_MEDIA_UPLOAD",
      entityType: "paper_question_media",
      entityId: String(media.id),
      metadata: {
        question_paper_id: paperParams.paperId,
        question_id: paperParams.questionId,
        purpose: media.purpose,
        storage_url: media.storage_url,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      status: "success",
      media: {
        id: media.id,
        question_id: media.paper_question_id,
        purpose: media.purpose,
        storage_url: media.storage_url,
        mime_type: media.mime_type,
        checksum: media.checksum,
        width: media.width,
        height: media.height,
        sort_order: media.sort_order,
        uploaded_by: media.uploaded_by,
        created_at: media.created_at,
      },
    });
  } catch (error) {
    respondMulterError(res, error, "QUESTION_PAPER_MEDIA_UPLOAD_FAILED");
  }
});

mediaRouter.put("/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperMediaParams(req, res);
  if (!paperParams) {
    return;
  }

  try {
    await parseMultipartUpload(req, res);
    const body = paperMediaUploadSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        status: "error",
        code: "VALIDATION_ERROR",
        issues: body.error.flatten(),
      });
      return;
    }
    const file = ensureMultipartFile(req, res);
    if (!file) {
      return;
    }

    const media = await replacePaperQuestionMedia(prisma, paperParams.paperId, paperParams.questionId, paperParams.mediaId, req.auth!.user, {
      purpose: body.data.purpose,
      sortOrder: body.data.sort_order,
      file,
    });

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_MEDIA_REPLACE",
      entityType: "paper_question_media",
      entityId: String(media.id),
      metadata: {
        question_paper_id: paperParams.paperId,
        question_id: paperParams.questionId,
        purpose: media.purpose,
        storage_url: media.storage_url,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      media: {
        id: media.id,
        question_id: media.paper_question_id,
        purpose: media.purpose,
        storage_url: media.storage_url,
        mime_type: media.mime_type,
        checksum: media.checksum,
        width: media.width,
        height: media.height,
        sort_order: media.sort_order,
        uploaded_by: media.uploaded_by,
        created_at: media.created_at,
      },
    });
  } catch (error) {
    respondMulterError(res, error, "QUESTION_PAPER_MEDIA_REPLACE_FAILED");
  }
});

mediaRouter.delete("/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const paperParams = parsePaperMediaParams(req, res);
  if (!paperParams) {
    return;
  }

  try {
    const media = await deletePaperQuestionMedia(prisma, paperParams.paperId, paperParams.questionId, paperParams.mediaId, req.auth!.user);
    if (!media) {
      res.status(404).json({
        status: "error",
        code: "NOT_FOUND",
        message: "Media not found.",
      });
      return;
    }

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_PAPER_MEDIA_DELETE",
      entityType: "paper_question_media",
      entityId: String(media.id),
      metadata: {
        question_paper_id: paperParams.paperId,
        question_id: paperParams.questionId,
        purpose: media.purpose,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      media: {
        id: media.id,
        question_id: media.paper_question_id,
        purpose: media.purpose,
        storage_url: media.storage_url,
        mime_type: media.mime_type,
        checksum: media.checksum,
        width: media.width,
        height: media.height,
        sort_order: media.sort_order,
        uploaded_by: media.uploaded_by,
        created_at: media.created_at,
      },
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_PAPER_MEDIA_DELETE_FAILED",
      message: error instanceof Error ? error.message : "Failed to delete media.",
    });
  }
});

router.use("/:paperId/questions/:questionId/media", mediaRouter);
router.use("/:paperId/questions", questionsRouter);

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

export { router as questionPapersRouter };
