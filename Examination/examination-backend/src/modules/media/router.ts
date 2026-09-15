import { Router, type Response } from "express";
import multer, { MulterError } from "multer";
import { requireAuthMiddleware, requireRoleMiddleware, type AuthenticatedRequest, writeAuthAuditLog, requireSchemaReady } from "../../shared/auth.js";
import { prisma } from "../../shared/prisma.js";
import { examIdParamSchema, questionIdParamSchema } from "../questions/schemas.js";
import { mediaResponseShape, deleteQuestionMedia, listQuestionMedia, readQuestionMediaFile, replaceQuestionMedia, uploadQuestionMedia } from "./service.js";
import { questionMediaIdParamSchema, questionMediaUploadSchema } from "./schemas.js";
import { respondWithImage, parseWidthParam } from "./imageResponse.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
const uploadSingle = upload.single("file");

const router = Router({ mergeParams: true });

router.use(requireAuthMiddleware, requireRoleMiddleware("ADMIN", "TEACHER"));

function parseCommonParams(req: AuthenticatedRequest, res: Response) {
  // Support both /api/exams/:examId/... and /api/question-papers/:paperId/... URL shapes
  const rawExamId = (req.params as Record<string, string>).examId ?? (req.params as Record<string, string>).paperId;
  const normalizedParams = { ...req.params, examId: rawExamId };

  const examParsed = examIdParamSchema.safeParse(normalizedParams);
  const questionParsed = questionIdParamSchema.safeParse(req.params);
  if (!examParsed.success || !questionParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: !examParsed.success ? examParsed.error.flatten() : questionParsed.error!.flatten(),
    });
    return null;
  }
  return {
    examId: examParsed.data.examId,
    questionId: questionParsed.data.questionId,
  };
}

function parseUploadBody(req: AuthenticatedRequest, res: Response) {
  const parsed = questionMediaUploadSchema.safeParse(req.body);
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

function respondMulterError(res: Response, error: unknown, fallbackCode: string) {
  if (error instanceof MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      message: "File size exceeds the 5 MB limit.",
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

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parseCommonParams(req, res);
  if (!params) {
    return;
  }

  try {
    const result = await listQuestionMedia(prisma, params.examId, params.questionId, req.auth!.user);
    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_MEDIA_LIST",
      entityType: "questions",
      entityId: String(params.questionId),
      metadata: {
        exam_id: params.examId,
        media_count: result.media.length,
      },
      ipAddress: req.ip,
    });
    res.status(200).json({
      status: "success",
      exam: result.exam,
      question: result.question,
      media: result.media.map(mediaResponseShape),
    });
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Question not found.",
    });
  }
});

router.get("/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parseCommonParams(req, res);
  if (!params) {
    return;
  }

  const mediaParsed = questionMediaIdParamSchema.safeParse(req.params);
  if (!mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: mediaParsed.error.flatten(),
    });
    return;
  }

  try {
    const media = await readQuestionMediaFile(prisma, params.examId, params.questionId, mediaParsed.data.mediaId, req.auth!.user);
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
      action: "QUESTION_MEDIA_PREVIEW",
      entityType: "question_media",
      entityId: String(media.media.id),
      metadata: {
        exam_id: params.examId,
        question_id: params.questionId,
        purpose: media.media.purpose,
      },
      ipAddress: req.ip,
    });

    res.setHeader("Content-Disposition", `inline; filename="${media.media.id}-${media.media.purpose.toLowerCase()}.bin"`);
    // Optional `?w=<px>` returns a downscaled, disk-cached thumbnail (aspect preserved).
    // No `w` → original is streamed unchanged.
    await respondWithImage(res, media.absolutePath, media.media.mime_type, parseWidthParam(req.query.w));
  } catch (error) {
    res.status(404).json({
      status: "error",
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Media not found.",
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

  const params = parseCommonParams(req, res);
  if (!params) {
    return;
  }

  try {
    await parseMultipartUpload(req, res);
    const body = parseUploadBody(req, res);
    if (!body) {
      return;
    }
    const file = ensureMultipartFile(req, res);
    if (!file) {
      return;
    }

    const media = await uploadQuestionMedia(prisma, params.examId, params.questionId, req.auth!.user, {
      purpose: body.purpose,
      sortOrder: body.sort_order,
      file,
    });

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_MEDIA_UPLOAD",
      entityType: "question_media",
      entityId: String(media.id),
      metadata: {
        exam_id: params.examId,
        question_id: params.questionId,
        purpose: media.purpose,
        storage_url: media.storage_url,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      status: "success",
      media: mediaResponseShape(media),
    });
  } catch (error) {
    respondMulterError(res, error, "QUESTION_MEDIA_UPLOAD_FAILED");
  }
});

router.put("/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parseCommonParams(req, res);
  if (!params) {
    return;
  }

  const mediaParsed = questionMediaIdParamSchema.safeParse(req.params);
  if (!mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: mediaParsed.error.flatten(),
    });
    return;
  }

  try {
    await parseMultipartUpload(req, res);
    const body = parseUploadBody(req, res);
    if (!body) {
      return;
    }
    const file = ensureMultipartFile(req, res);
    if (!file) {
      return;
    }

    const media = await replaceQuestionMedia(prisma, params.examId, params.questionId, mediaParsed.data.mediaId, req.auth!.user, {
      purpose: body.purpose,
      sortOrder: body.sort_order,
      file,
    });

    await writeAuthAuditLog({
      actorUserId: req.auth!.user.id,
      actorRole: req.auth!.user.role,
      action: "QUESTION_MEDIA_REPLACE",
      entityType: "question_media",
      entityId: String(media.id),
      metadata: {
        exam_id: params.examId,
        question_id: params.questionId,
        purpose: media.purpose,
        storage_url: media.storage_url,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      media: mediaResponseShape(media),
    });
  } catch (error) {
    respondMulterError(res, error, "QUESTION_MEDIA_REPLACE_FAILED");
  }
});

router.delete("/:mediaId", async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const params = parseCommonParams(req, res);
  if (!params) {
    return;
  }

  const mediaParsed = questionMediaIdParamSchema.safeParse(req.params);
  if (!mediaParsed.success) {
    res.status(400).json({
      status: "error",
      code: "VALIDATION_ERROR",
      issues: mediaParsed.error.flatten(),
    });
    return;
  }

  try {
    const media = await deleteQuestionMedia(prisma, params.examId, params.questionId, mediaParsed.data.mediaId, req.auth!.user);
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
      action: "QUESTION_MEDIA_DELETE",
      entityType: "question_media",
      entityId: String(media.id),
      metadata: {
        exam_id: params.examId,
        question_id: params.questionId,
        purpose: media.purpose,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      status: "success",
      media: mediaResponseShape(media),
    });
  } catch (error) {
    res.status(400).json({
      status: "error",
      code: "QUESTION_MEDIA_DELETE_FAILED",
      message: error instanceof Error ? error.message : "Failed to delete media.",
    });
  }
});

export { router as mediaRouter };

