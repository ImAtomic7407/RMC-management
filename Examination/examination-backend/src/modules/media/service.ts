import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma";
import type { AuthenticatedUser } from "../../shared/auth";

type MediaDb = Pick<typeof prisma, "exams" | "questions" | "question_media">;
type QuestionMediaRecord = Prisma.question_mediaGetPayload<{}>;
type QuestionMediaWithQuestion = Prisma.question_mediaGetPayload<{
  include: {
    question: {
      include: {
        exam: {
          include: {
            exam_sections: true;
          };
        };
      };
    };
  };
}>;

type ImageInput = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const STORAGE_ROOT = path.resolve(process.cwd(), "uploads/question-media");

function examAccessWhere(actor: AuthenticatedUser, examId: number) {
  return { id: examId };
}

async function loadEditableQuestion(db: MediaDb, examId: number, questionId: number, actor: AuthenticatedUser) {
  return db.questions.findFirst({
    where: {
      id: questionId,
      exam_id: examId,
    },
    include: {
      exam: {
        include: {
          exam_sections: true,
        },
      },
    },
  });
}

async function assertDraftQuestion(db: MediaDb, examId: number, questionId: number, actor: AuthenticatedUser) {
  const question = await loadEditableQuestion(db, examId, questionId, actor);
  if (!question || !question.exam) {
    throw new Error("Question not found.");
  }

  const exam = await db.exams.findFirst({
    where: examAccessWhere(actor, examId),
    include: {
      exam_sections: true,
    },
  });

  if (!exam) {
    throw new Error("Exam not found.");
  }

  if (exam.status !== "DRAFT") {
    throw new Error("Media can only be modified while the exam is in DRAFT status.");
  }

  return { exam, question };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function detectMimeType(buffer: Buffer) {
  if (buffer.length < 12) {
    return null;
  }

  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (isPng) {
    return "image/png";
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) {
    return "image/jpeg";
  }

  const isWebp = buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (isWebp) {
    return "image/webp";
  }

  return null;
}

function validateImageUpload(file: ImageInput) {
  const detected = detectMimeType(file.buffer);
  if (!detected) {
    throw new Error("Only JPEG, PNG, and WEBP images are allowed.");
  }

  const allowedMimes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
  if (!allowedMimes.has(file.mimetype) && file.mimetype !== detected) {
    throw new Error("Invalid image mime type.");
  }

  const extension = extensionForMimeType(detected);
  if (!extension) {
    throw new Error("Unsupported image type.");
  }

  return {
    mimeType: detected,
    extension,
  };
}

function resolveStorageUrl(purpose: "QUESTION" | "SOLUTION", filename: string) {
  return `/uploads/question-media/${purpose.toLowerCase()}/${filename}`;
}

function resolveAbsoluteStoragePath(storageUrl: string) {
  const resolved = path.resolve(process.cwd(), storageUrl.replace(/^\//, ""));
  // Defense-in-depth: never allow a stored URL to escape the uploads root, even
  // if a malformed/tampered storage_url contains `..` traversal sequences.
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) {
    throw new Error("Invalid media storage path.");
  }
  return resolved;
}

async function ensureStorageDirectory(purpose: "QUESTION" | "SOLUTION") {
  const directory = path.resolve(STORAGE_ROOT, purpose.toLowerCase());
  await mkdir(directory, { recursive: true });
  return directory;
}

function fileNameFrom(questionId: number, purpose: "QUESTION" | "SOLUTION", extension: string) {
  return `${questionId}-${purpose.toLowerCase()}-${crypto.randomUUID()}.${extension}`;
}

function sanitizeFilename(storageUrl: string) {
  return path.basename(storageUrl).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function listQuestionMedia(db: MediaDb, examId: number, questionId: number, actor: AuthenticatedUser) {
  const { question, exam } = await assertDraftQuestion(db, examId, questionId, actor);
  const media = await db.question_media.findMany({
    where: {
      question_id: question.id,
    },
    orderBy: [{ purpose: "asc" }, { sort_order: "asc" }, { created_at: "asc" }],
  });

  return { exam, question, media };
}

export async function loadQuestionMediaById(db: MediaDb, examId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const { question, exam } = await assertDraftQuestion(db, examId, questionId, actor);
  const media = await db.question_media.findFirst({
    where: {
      id: mediaId,
      question_id: question.id,
    },
    include: {
      question: {
        include: {
          exam: {
            include: {
              exam_sections: true,
            },
          },
        },
      },
    },
  });

  if (!media) {
    return null;
  }

  return { exam, question, media: media as QuestionMediaWithQuestion };
}

export async function uploadQuestionMedia(
  db: MediaDb,
  examId: number,
  questionId: number,
  actor: AuthenticatedUser,
  input: {
    purpose: "QUESTION" | "SOLUTION";
    sortOrder: number;
    file: ImageInput;
  },
) {
  const { question } = await assertDraftQuestion(db, examId, questionId, actor);
  const { mimeType, extension } = validateImageUpload(input.file);
  const directory = await ensureStorageDirectory(input.purpose);
  const filename = fileNameFrom(question.id, input.purpose, extension);
  const relativeUrl = resolveStorageUrl(input.purpose, filename);
  const absolutePath = path.resolve(directory, filename);
  const checksum = crypto.createHash("sha256").update(input.file.buffer).digest("hex");

  await writeFile(absolutePath, input.file.buffer);

  try {
    const media = await db.question_media.create({
      data: {
        question_id: question.id,
        purpose: input.purpose,
        storage_url: relativeUrl,
        mime_type: mimeType,
        checksum,
        width: null,
        height: null,
        sort_order: input.sortOrder,
        uploaded_by: actor.id,
      },
    });

    return media;
  } catch (error) {
    await rm(absolutePath, { force: true });
    throw error;
  }
}

export async function replaceQuestionMedia(
  db: MediaDb,
  examId: number,
  questionId: number,
  mediaId: number,
  actor: AuthenticatedUser,
  input: {
    purpose: "QUESTION" | "SOLUTION";
    sortOrder: number;
    file: ImageInput;
  },
) {
  const { media } = await loadQuestionMediaById(db, examId, questionId, mediaId, actor).then((result) => {
    if (!result) {
      throw new Error("Media not found.");
    }
    return result;
  });

  const { mimeType, extension } = validateImageUpload(input.file);
  const directory = await ensureStorageDirectory(input.purpose);
  const filename = fileNameFrom(questionId, input.purpose, extension);
  const relativeUrl = resolveStorageUrl(input.purpose, filename);
  const absolutePath = path.resolve(directory, filename);
  const checksum = crypto.createHash("sha256").update(input.file.buffer).digest("hex");

  await writeFile(absolutePath, input.file.buffer);

  try {
    const updated = await db.question_media.update({
      where: { id: media.id },
      data: {
        purpose: input.purpose,
        storage_url: relativeUrl,
        mime_type: mimeType,
        checksum,
        width: null,
        height: null,
        sort_order: input.sortOrder,
        uploaded_by: actor.id,
      },
    });

    const oldPath = resolveAbsoluteStoragePath(media.storage_url);
    if (oldPath !== absolutePath) {
      await rm(oldPath, { force: true });
    }

    return updated;
  } catch (error) {
    await rm(absolutePath, { force: true });
    throw error;
  }
}

export async function deleteQuestionMedia(db: MediaDb, examId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionMediaById(db, examId, questionId, mediaId, actor);
  if (!loaded) {
    return null;
  }

  const removed = await db.question_media.delete({
    where: { id: mediaId },
  });

  await rm(resolveAbsoluteStoragePath(removed.storage_url), { force: true });

  return removed;
}

export async function readQuestionMediaFile(db: MediaDb, examId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionMediaById(db, examId, questionId, mediaId, actor);
  if (!loaded) {
    return null;
  }

  const absolutePath = resolveAbsoluteStoragePath(loaded.media.storage_url);
  await stat(absolutePath);

  return {
    media: loaded.media,
    absolutePath,
  };
}

export async function readQuestionMediaBuffer(db: MediaDb, examId: number, questionId: number, mediaId: number, actor: AuthenticatedUser) {
  const loaded = await loadQuestionMediaById(db, examId, questionId, mediaId, actor);
  if (!loaded) {
    return null;
  }

  const absolutePath = resolveAbsoluteStoragePath(loaded.media.storage_url);
  const buffer = await readFile(absolutePath);

  return {
    media: loaded.media,
    buffer,
  };
}

export function mediaResponseShape(media: QuestionMediaRecord) {
  return {
    id: media.id,
    question_id: media.question_id,
    purpose: media.purpose,
    storage_url: media.storage_url,
    mime_type: media.mime_type,
    checksum: media.checksum,
    width: media.width,
    height: media.height,
    sort_order: media.sort_order,
    uploaded_by: media.uploaded_by,
    created_at: media.created_at,
  };
}
