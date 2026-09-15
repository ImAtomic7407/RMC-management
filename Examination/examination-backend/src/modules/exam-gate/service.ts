import crypto from "node:crypto";
import { Prisma, ExamGateStatus, DeviceBindStatus } from "@prisma/client";
import type { AuthenticatedUser } from "../../shared/auth";
import { prisma } from "../../shared/prisma";
import { broadcastExamRealtime, broadcastExamRealtimeToUser } from "../../shared/realtime";
import { generateStudentAssignedPaperInstance, loadStudentAssignedPaperPayload, issueStudentAssignedPaperReviewUnlock } from "./assigned-paper.js";
import { log } from "../../shared/logger";

type GateDb = typeof prisma;

type StudentProfileRow = {
  id: number;
  student_uid: string;
  batch_id: number;
  class_name: string | null;
  roll_no: string | null;
  active: boolean;
  batch_memberships: Array<{
    batch_id: number;
    batch: {
      id: number;
      name: string;
      active: boolean;
    };
  }>;
  user: {
    id: number;
    full_name: string | null;
    phone: string | null;
  };
  batch: {
    id: number;
    name: string;
    active: boolean;
  };
};

type GateExamRow = {
  id: number;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "LIVE" | "PUBLISHED" | "CLOSED" | "RESULT_RELEASED" | "ARCHIVED";
  exam_mode: "LIVE" | "PRACTICE";
  duration_seconds: number;
  exam_date_time: Date | null;
  instructions: string | null;
  question_paper_id: number | null;
  question_paper_version_id: number | null;
  started_at: Date | null;
  manually_started_by: number | null;
  created_by: number;
  batch: {
    id: number;
    name: string;
  } | null;
  question_paper_version: {
    id: number;
    version_number: number;
    title_snapshot: string;
    instructions_snapshot: string | null;
    sections: Array<{
      id: number;
      section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
      section_order: number;
      question_count_target: number;
      default_marks: Prisma.Decimal;
      default_negative_marks: Prisma.Decimal;
    }>;
    questions: Array<{
      id: number;
      section_code: "PHYSICS" | "CHEMISTRY" | "MATHS";
      question_order: number;
    }>;
  } | null;
};

type GateSessionRow = {
  id: number;
  exam_id: number;
  student_id: number;
  uid_snapshot: string;
  device_id: string;
  qr_token_hash: string;
  qr_expires_at: Date;
  gate_status: "WAITING_FOR_SCAN" | "VERIFIED" | "DENIED" | "CANCELLED" | "EXPIRED";
  device_bind_status: "UNBOUND" | "BOUND" | "REPLACED" | "BLOCKED";
  paper_download_status: "NOT_STARTED" | "DOWNLOADING" | "READY" | "FAILED";
  has_overlay_permission: boolean;
  bypass_restrictions: boolean;
  verified_by_teacher_id: number | null;
  verified_at: Date | null;
  attempt_id: number | null;
  created_at: Date;
  updated_at: Date;
};

export class ExamGateError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ExamGateError";
    this.code = code;
    this.status = status;
  }
}

function gateError(code: string, status: number, message: string): never {
  throw new ExamGateError(code, status, message);
}

export function isExamGateError(error: unknown): error is ExamGateError {
  return error instanceof ExamGateError;
}

function hashQrToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function randomQrToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}

function examAssignmentWhere(student: { batch_id: number; student_uid: string; batch_memberships?: Array<{ batch_id: number }> }) {
  const batchIds = Array.from(new Set([student.batch_id, ...(student.batch_memberships ?? []).map((membership) => membership.batch_id)]));
  return {
    OR: [
      {
        exam_assignments: {
          some: {
            batch_id: {
              in: batchIds,
            },
          },
        },
      },
      {
        exam_assignments: {
          some: {
            student_uid: student.student_uid,
          },
        },
      },
    ],
  };
}

async function loadStudentProfile(db: GateDb, userId: number): Promise<StudentProfileRow> {
  const student = await db.student_profiles.findFirst({
    where: {
      user_id: userId,
      active: true,
    },
    select: {
      id: true,
      student_uid: true,
      batch_id: true,
      class_name: true,
      roll_no: true,
      active: true,
      batch_memberships: {
        select: {
          batch_id: true,
          batch: {
            select: {
              id: true,
              name: true,
              active: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          full_name: true,
          phone: true,
        },
      },
      batch: {
        select: {
          id: true,
          name: true,
          active: true,
        },
      },
    },
  });

  if (!student || !student.batch.active) {
    gateError("STUDENT_NOT_FOUND", 404, "Student profile not found.");
  }

  return student as StudentProfileRow;
}

async function loadStudentById(db: GateDb, studentId: number): Promise<StudentProfileRow> {
  const student = await db.student_profiles.findFirst({
    where: {
      id: studentId,
      active: true,
    },
    select: {
      id: true,
      student_uid: true,
      batch_id: true,
      class_name: true,
      roll_no: true,
      active: true,
      batch_memberships: {
        select: {
          batch_id: true,
          batch: {
            select: {
              id: true,
              name: true,
              active: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          full_name: true,
          phone: true,
        },
      },
      batch: {
        select: {
          id: true,
          name: true,
          active: true,
        },
      },
    },
  });

  if (!student || !student.batch.active) {
    gateError("STUDENT_NOT_FOUND", 404, "Student profile not found.");
  }

  return student as StudentProfileRow;
}

async function loadGateExamForStudent(
  db: GateDb,
  examId: number,
  student: StudentProfileRow,
  options: {
    allowScheduled?: boolean;
    requireVersioned?: boolean;
  } = {},
): Promise<GateExamRow> {
  const allowedStatuses = options.allowScheduled === false ? ["LIVE"] : ["SCHEDULED", "LIVE"];

  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      status: {
        in: allowedStatuses as Array<"SCHEDULED" | "LIVE">,
      },
      ...examAssignmentWhere(student),
      ...(options.requireVersioned !== false
        ? {
            question_paper_version_id: {
              not: null,
            },
          }
        : {}),
    },
    include: {
      batch: {
        select: {
          id: true,
          name: true,
        },
      },
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
            orderBy: [
              {
                section_code: "asc",
              },
              {
                question_order: "asc",
              },
            ],
            select: {
              id: true,
              section_code: true,
              question_order: true,
            },
          },
        },
      },
    },
  });

  if (!exam) {
    gateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }

  return exam as GateExamRow;
}

async function loadGateSession(db: GateDb, examId: number, studentId: number) {
  return db.exam_gate_sessions.findUnique({
    where: {
      exam_id_student_id: {
        exam_id: examId,
        student_id: studentId,
      },
    },
    include: {
      verified_by_teacher: {
        select: {
          id: true,
          full_name: true,
          username: true,
        },
      },
      attempt: {
        select: {
          id: true,
          status: true,
          started_at: true,
          submitted_at: true,
          device_id: true,
        },
      },
    },
  });
}

function serializeGateSession(session: GateSessionRow | null) {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    exam_id: session.exam_id,
    student_id: session.student_id,
    uid: session.uid_snapshot,
    device_id: session.device_id,
    gate_status: session.gate_status,
    device_bind_status: session.device_bind_status,
    paper_download_status: session.paper_download_status,
    has_overlay_permission: session.has_overlay_permission,
    qr_expires_at: session.qr_expires_at,
    verified_by_teacher_id: session.verified_by_teacher_id,
    verified_at: session.verified_at,
    attempt_id: session.attempt_id,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function buildQrPayload(exam: GateExamRow, student: StudentProfileRow, deviceId: string, qrToken: string, expiresAt: Date) {
  return {
    exam_id: exam.id,
    student_id: student.id,
    uid: student.student_uid,
    device_id: deviceId,
    qr_token: qrToken,
    expires_at: expiresAt.toISOString(),
  };
}

function buildGateStatus(session: GateSessionRow | null, exam: GateExamRow | null, attemptStatus?: string | null) {
  const verified = session?.gate_status === "VERIFIED" && session?.device_bind_status === "BOUND";
  const canEnterWaitingRoom = verified;
  const hasAccess = Boolean(session?.has_overlay_permission || session?.bypass_restrictions);
  const canStartAttempt = Boolean(
      verified &&
      hasAccess &&
      exam &&
      exam.status === "LIVE" &&
      (attemptStatus == null || attemptStatus === "IN_PROGRESS"),
  );

  return {
    gate_status: session?.gate_status ?? "WAITING_FOR_SCAN",
    device_bind_status: session?.device_bind_status ?? "UNBOUND",
    paper_download_status: session?.paper_download_status ?? "NOT_STARTED",
    has_overlay_permission: session?.has_overlay_permission ?? false,
    bypass_restrictions: session?.bypass_restrictions ?? false,
    can_enter_waiting_room: canEnterWaitingRoom,
    can_start_attempt: canStartAttempt,
    uid: session?.uid_snapshot ?? null,
    device_id: session?.device_id ?? null,
    qr_expires_at: session?.qr_expires_at?.toISOString() ?? null,
    verified_at: session?.verified_at?.toISOString() ?? null,
    attempt_id: session?.attempt_id ?? null,
    attempt_status: attemptStatus ?? null,
  };
}

export async function startManualExam(db: GateDb, examId: number, actor: AuthenticatedUser) {
  const where = { id: examId };

  const exam = await db.exams.findFirst({
    where,
    include: {
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!exam) {
    gateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }

  if (!exam.question_paper_version_id) {
    gateError("EXAM_VERSION_REQUIRED", 400, "Exam does not have a frozen paper version.");
  }

  const now = new Date();
  if (exam.status === "LIVE" && exam.started_at) {
    return exam;
  }

  if (exam.status !== "PUBLISHED" && exam.status !== "SCHEDULED") {
    gateError("EXAM_CANNOT_START", 400, "Only a published or scheduled exam can be started.");
  }

  const updated = await db.exams.update({
    where: { id: exam.id },
    data: {
      status: "LIVE",
      started_at: now,
      manually_started_by: actor.id,
      updated_by: actor.id,
    },
    include: {
      batch: true,
      question_paper_version: {
        include: {
          sections: {
            orderBy: {
              section_order: "asc",
            },
          },
          questions: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  log.exam.info("Exam started manually", {
    exam_id:    updated.id,
    title:      updated.title,
    started_by: actor.id,
    role:       actor.role,
  });

  broadcastExamRealtime({
    type: "exam.updated",
    examId: updated.id,
    actorRole: actor.role,
    payload: {
      action: "started",
      status: updated.status,
      started_at: updated.started_at?.toISOString() ?? null,
    },
  });

  return updated;
}

export async function createStudentGateQr(db: GateDb, examId: number, actor: AuthenticatedUser, deviceId: string, hasOverlayPermission?: boolean) {
  const student = await loadStudentProfile(db, actor.id);
  const exam = await loadGateExamForStudent(db, examId, student, {
    allowScheduled: true,
    requireVersioned: true,
  });

  const existing = await loadGateSession(db, exam.id, student.id);
  const now = new Date();
  const expiresAt = addSeconds(now, 600); // 10-minute window so teacher can scan a full class
  const qrToken = randomQrToken();
  const qrTokenHash = hashQrToken(qrToken);

  // A session's VERIFIED status is only preserved when the exam is already LIVE.
  // For SCHEDULED / PUBLISHED exams the student must always be re-scanned, which:
  //   (a) prevents stale test-run sessions from bypassing the QR step in real exams, and
  //   (b) ensures the QR screen always appears on the student's device.
  const examIsLive = ["LIVE", "SCHEDULED", "PUBLISHED"].includes(exam.status);
  const keepVerified =
    examIsLive &&
    existing?.gate_status === "VERIFIED" &&
    existing.device_id === deviceId;

  // Build the update payload once -- reused in both the upsert and the race-condition retry.
  const upsertUpdate = {
    uid_snapshot: student.student_uid,
    device_id: deviceId,
    qr_token_hash: qrTokenHash,
    qr_expires_at: expiresAt,
    gate_status:          (keepVerified ? "VERIFIED"     : "WAITING_FOR_SCAN") as ExamGateStatus,
    device_bind_status:   (keepVerified ? "BOUND"
      : existing?.gate_status === "VERIFIED" && existing.device_id !== deviceId ? "REPLACED"
      : "UNBOUND") as DeviceBindStatus,
    paper_download_status: keepVerified ? existing.paper_download_status : "NOT_STARTED",
    has_overlay_permission: hasOverlayPermission ?? false,
    verified_by_teacher_id: keepVerified ? existing.verified_by_teacher_id : null,
    verified_at:            keepVerified ? existing.verified_at            : null,
    attempt_id:             keepVerified ? existing.attempt_id             : null,
  };

  // Prisma upsert is not atomic (SELECT + INSERT/UPDATE). Under concurrent requests from
  // the same student the CREATE path can race and violate a unique constraint. Catch P2002
  // and recover: if the session was just created by another concurrent request, update it;
  // if a different student already holds this device for this exam, return a clear error.
  let session;
  try {
    session = await db.exam_gate_sessions.upsert({
      where: {
        exam_id_student_id: {
          exam_id: exam.id,
          student_id: student.id,
        },
      },
      create: {
        exam_id: exam.id,
        student_id: student.id,
        uid_snapshot: student.student_uid,
        device_id: deviceId,
        qr_token_hash: qrTokenHash,
        qr_expires_at: expiresAt,
        gate_status: "WAITING_FOR_SCAN",
        device_bind_status: "UNBOUND",
        paper_download_status: "NOT_STARTED",
        has_overlay_permission: hasOverlayPermission ?? false,
      },
      update: upsertUpdate,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Race condition or device conflict. Re-fetch the current session by student to decide.
      const raceSession = await db.exam_gate_sessions.findUnique({
        where: { exam_id_student_id: { exam_id: exam.id, student_id: student.id } },
      });
      if (raceSession) {
        // A session already exists for this student (race condition or re-entry).
        // Try the full update first; if device_id still conflicts, fall back to
        // refreshing only the QR token and preserving the existing device binding.
        try {
          session = await db.exam_gate_sessions.update({
            where: { id: raceSession.id },
            data: upsertUpdate,
          });
        } catch (updateErr) {
          if (updateErr instanceof Prisma.PrismaClientKnownRequestError && updateErr.code === "P2002") {
            // device_id in upsertUpdate conflicts with another session -- keep the
            // existing device binding and just rotate the QR token.
            session = await db.exam_gate_sessions.update({
              where: { id: raceSession.id },
              data: {
                uid_snapshot: student.student_uid,
                qr_token_hash: qrTokenHash,
                qr_expires_at: expiresAt,
              },
            });
          } else {
            throw updateErr;
          }
        }
      } else {
        // No session for this student at all -- this is a genuine device conflict
        // (another student already occupies this device for this exam).
        gateError("DEVICE_CONFLICT", 409, "This device is already registered for another student in this exam. Please contact your teacher.");
      }
    } else {
      throw err;
    }
  }

  // Pre-generate the assigned paper as soon as the student opens the QR screen.
  // That keeps teacher verification fast and leaves only payload download as the slow step.
  try {
    await generateStudentAssignedPaperInstance(db, exam.id, student.id, session.id);
  } catch (err) {
    // Convert generic errors from paper generation into a proper gate error so the
    // router returns a clean response instead of leaking internal details.
    if (err instanceof ExamGateError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.toLowerCase().includes("exam not found") || msg.toLowerCase().includes("no question paper")) {
      gateError("EXAM_PAPER_NOT_READY", 422, "This exam does not have a question paper ready yet. Please ask your teacher.");
    }
    // For other unexpected failures (DB timeouts, etc.) rethrow -- router will convert to 500.
    throw err;
  }

  broadcastExamRealtime({
    type: "gate.session.updated",
    examId: exam.id,
    studentId: student.id,
    actorRole: actor.role,
    payload: {
      action: "qr_created",
      gate_status: session.gate_status,
      device_bind_status: session.device_bind_status,
      paper_download_status: session.paper_download_status,
      qr_expires_at: expiresAt.toISOString(),
    },
  });

  return {
    student,
    exam,
    gate_session: serializeGateSession(session as unknown as GateSessionRow),
    qr_payload: buildQrPayload(exam, student, deviceId, qrToken, expiresAt),
  };
}

export async function verifyStudentGateQr(
  db: GateDb,
  examId: number,
  actor: AuthenticatedUser,
  input: {
    student_id: number;
    uid: string;
    device_id: string;
    qr_token: string;
  },
) {
  const teacher = actor;
  const exam = await db.exams.findFirst({
    where:
      { id: examId },
    include: {
      question_paper_version: {
        select: {
          id: true,
          version_number: true,
        },
      },
    },
  });

  if (!exam) {
    gateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }
  if (!["SCHEDULED", "PUBLISHED", "LIVE"].includes(exam.status)) {
    gateError("EXAM_NOT_READY", 403, "Exam must be scheduled or started before QR verification.");
  }
  if (!exam.question_paper_version_id) {
    gateError("EXAM_VERSION_REQUIRED", 400, "Exam does not have a frozen paper version.");
  }

  const student = await loadStudentById(db, input.student_id);
  if (student.student_uid !== input.uid) {
    gateError("UID_MISMATCH", 403, "Student UID does not match the supplied QR payload.");
  }

  const assigned = await db.exams.findFirst({
    where: {
      id: exam.id,
      ...examAssignmentWhere(student),
    },
    select: {
      id: true,
    },
  });
  if (!assigned) {
    gateError("STUDENT_NOT_ASSIGNED", 403, "Student is not assigned to this exam.");
  }

  const session = await loadGateSession(db, exam.id, student.id);
  if (!session) {
    gateError("QR_SESSION_NOT_FOUND", 404, "Student QR session not found.");
  }

  const tokenHash = hashQrToken(input.qr_token);
  if (session.qr_token_hash !== tokenHash) {
    gateError("QR_TOKEN_INVALID", 403, "QR token is invalid.");
  }

  if (session.qr_expires_at <= new Date()) {
    gateError("QR_TOKEN_EXPIRED", 403, "QR token has expired.");
  }

  if (session.device_id !== input.device_id) {
    gateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the QR payload.");
  }

  const updated = await db.exam_gate_sessions.update({
    where: {
      exam_id_student_id: {
        exam_id: exam.id,
        student_id: student.id,
      },
    },
    data: {
      gate_status: "VERIFIED",
      device_bind_status: "BOUND",
      paper_download_status: session.paper_download_status === "READY" ? "READY" : "NOT_STARTED",
      verified_by_teacher_id: teacher.id,
      verified_at: new Date(),
    },
  });

  log.gate.info("Student QR verified -- entering waiting room", {
    exam_id:    exam.id,
    student_id: student.id,
    student_uid: student.student_uid,
    device_id:  input.device_id,
    teacher_id: teacher.id,
  });

  const assignedPaper = await generateStudentAssignedPaperInstance(db, exam.id, student.id, updated.id);

  broadcastExamRealtime({
    type: "gate.session.updated",
    examId: exam.id,
    studentId: student.id,
    actorRole: teacher.role,
    payload: {
      gate_status: updated.gate_status,
      device_bind_status: updated.device_bind_status,
      paper_download_status: updated.paper_download_status,
      verified_at: updated.verified_at?.toISOString() ?? null,
      attempt_id: updated.attempt_id,
      student_uid: student.student_uid,
    },
  });

  broadcastExamRealtime({
    type: "exam.updated",
    examId: exam.id,
    studentId: student.id,
    actorRole: teacher.role,
    payload: {
      action: "gate_verified",
      gate_status: updated.gate_status,
      device_bind_status: updated.device_bind_status,
      assigned_paper_instance_id: assignedPaper?.livePackage.instance_id ?? null,
    },
  });

  broadcastExamRealtimeToUser(student.user.id, {
    type: "gate.session.waiting_room_ready",
    examId: exam.id,
    studentId: student.id,
    actorRole: teacher.role,
    payload: {
      action: "waiting_room_ready",
      gate_status: updated.gate_status,
      device_bind_status: updated.device_bind_status,
      paper_download_status: updated.paper_download_status,
      can_enter_waiting_room: true,
      can_start_attempt: false,
    },
  });

  return {
    student,
    exam,
    gate_session: serializeGateSession({
      ...updated,
      verified_by_teacher_id: updated.verified_by_teacher_id,
    } as GateSessionRow),
    assigned_paper: assignedPaper,
  };
}

export async function listExamGateSessions(db: GateDb, examId: number, actor: AuthenticatedUser) {
  const exam = await db.exams.findFirst({
    where:
      { id: examId },
    select: {
      id: true,
      title: true,
      status: true,
      exam_mode: true,
      question_paper_version_id: true,
    },
  });

  if (!exam) {
    gateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }

  const sessions = await db.exam_gate_sessions.findMany({
    where: {
      exam_id: exam.id,
    },
    orderBy: {
      created_at: "asc",
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              full_name: true,
              username: true,
            },
          },
          batch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      verified_by_teacher: {
        select: {
          id: true,
          full_name: true,
          username: true,
        },
      },
      attempt: {
        select: {
          id: true,
          status: true,
          started_at: true,
          submitted_at: true,
          device_id: true,
          _count: { select: { exam_attempt_violations: true } },
        },
      },
    },
  });

  return {
    exam,
    gate_sessions: sessions.map((session) => ({
      id: session.id,
      exam_id: session.exam_id,
      student_id: session.student_id,
      uid: session.uid_snapshot,
      device_id: session.device_id,
      gate_status: session.gate_status,
      device_bind_status: session.device_bind_status,
      paper_download_status: session.paper_download_status,
      has_overlay_permission: session.has_overlay_permission,
      bypass_restrictions: (session as any).bypass_restrictions ?? false,
      qr_expires_at: session.qr_expires_at,
      verified_by_teacher_id: session.verified_by_teacher_id,
      verified_by_teacher: session.verified_by_teacher
        ? {
            id: session.verified_by_teacher.id,
            full_name: session.verified_by_teacher.full_name,
            username: session.verified_by_teacher.username,
          }
        : null,
      verified_at: session.verified_at,
      attempt_id: session.attempt_id,
      attempt: session.attempt,
      student: {
        id: session.student.id,
        student_uid: session.student.student_uid,
        roll_no: session.student.roll_no,
        class_name: session.student.class_name,
        user: {
          id: session.student.user.id,
          full_name: session.student.user.full_name,
          username: session.student.user.username,
        },
        batch: {
          id: session.student.batch.id,
          name: session.student.batch.name,
        },
      },
      created_at: session.created_at,
      updated_at: session.updated_at,
    })),
  };
}

export async function setStudentBypassRestrictions(db: GateDb, examId: number, sessionId: number, bypass: boolean) {
  const session = await db.exam_gate_sessions.findFirst({
    where: { id: sessionId, exam_id: examId },
  });
  if (!session) {
    gateError("SESSION_NOT_FOUND", 404, "Gate session not found.");
  }
  const updated = await db.exam_gate_sessions.update({
    where: { id: sessionId },
    data: { bypass_restrictions: bypass } as any,
  });
  return { gate_session: updated };
}

export async function getStudentGateStatus(db: GateDb, examId: number, actor: AuthenticatedUser, hasOverlayPermission?: boolean) {
  const student = await loadStudentProfile(db, actor.id);
  const exam = await db.exams.findFirst({
    where: {
      id: examId,
      ...examAssignmentWhere(student),
      question_paper_version_id: {
        not: null,
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      exam_mode: true,
      question_paper_version_id: true,
    },
  });

  if (!exam) {
    gateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  }

  const session = await loadGateSession(db, exam.id, student.id);

  if (session && hasOverlayPermission !== undefined && session.has_overlay_permission !== hasOverlayPermission) {
    const updatedSession = await db.exam_gate_sessions.update({
      where: {
        id: session.id,
      },
      data: {
        has_overlay_permission: hasOverlayPermission,
      },
    });
    session.has_overlay_permission = updatedSession.has_overlay_permission;
    broadcastExamRealtime({
      type: "gate.session.updated",
      examId: exam.id,
      studentId: student.id,
      actorRole: actor.role,
      payload: {
        action: "overlay_status_updated",
        gate_status: updatedSession.gate_status,
        device_bind_status: updatedSession.device_bind_status,
        paper_download_status: updatedSession.paper_download_status,
        has_overlay_permission: updatedSession.has_overlay_permission,
      },
    });
  }

  const attempt = await db.exam_attempts.findFirst({
    where: {
      exam_id: exam.id,
      student_id: student.id,
    },
    select: {
      id: true,
      status: true,
    },
    orderBy: {
      created_at: "desc",
    },
  });

  return {
    student: {
      id: student.id,
      uid: student.student_uid,
      name: student.user.full_name ?? student.user.phone ?? student.student_uid,
      roll_no: student.roll_no,
      class_name: student.class_name,
      batch: {
        id: student.batch.id,
        name: student.batch.name,
      },
    },
    exam,
    gate: buildGateStatus(session as GateSessionRow | null, exam as GateExamRow, attempt?.status ?? null),
  };
}

export async function updateStudentPaperDownloadStatus(
  db: GateDb,
  examId: number,
  actor: AuthenticatedUser,
  input: {
    device_id: string;
    paper_download_status: "DOWNLOADING" | "READY" | "FAILED";
  },
) {
  const student = await loadStudentProfile(db, actor.id);
  const exam = await loadGateExamForStudent(db, examId, student, {
    allowScheduled: true,
    requireVersioned: true,
  });
  const session = await loadGateSession(db, exam.id, student.id);
  if (!session || session.gate_status !== "VERIFIED" || session.device_bind_status !== "BOUND") {
    gateError("QR_VERIFICATION_REQUIRED", 403, "QR verification is required before updating download status.");
  }
  if (session.device_id !== input.device_id) {
    gateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the verified gate session.");
  }

  const updated = await db.exam_gate_sessions.update({
    where: {
      exam_id_student_id: {
        exam_id: exam.id,
        student_id: student.id,
      },
    },
    data: {
      paper_download_status: input.paper_download_status,
    },
  });

  const statusEmoji: Record<string, string> = {
    DOWNLOADING: "⬇",
    READY:       "✓",
    FAILED:      "✗",
  };
  const emoji = statusEmoji[input.paper_download_status] ?? "?";
  const level = input.paper_download_status === "FAILED" ? "error" : "info";
  log.gate[level](`${emoji} Paper download status -> ${input.paper_download_status}`, {
    exam_id:    exam.id,
    student_id: student.id,
    device_id:  input.device_id,
    status:     input.paper_download_status,
  });

  return {
    student,
    exam,
    gate: buildGateStatus(updated as GateSessionRow, exam, null),
  };
}

export async function recordExamViolation(
  db: GateDb,
  examId: number,
  actor: AuthenticatedUser,
  input: {
    device_id?: string | null;
    attempt_id?: number | null;
    gate_session_id?: number | null;
    violation_type: "BACK_ATTEMPT" | "APP_BACKGROUND" | "APP_SWITCH" | "SCREEN_OFF" | "MULTI_WINDOW" | "OVERLAY_OR_ASSISTANT_TRIGGERED" | "SCREENSHOT_ATTEMPT" | "NETWORK_LOST" | "TIMER_TAMPER_ATTEMPT" | "LOW_VOLUME_WARNING";
    severity: "INFO" | "WARNING" | "CRITICAL";
    message?: string | null;
    metadata: Record<string, unknown>;
  },
) {
  const student = await loadStudentProfile(db, actor.id);

  if (input.attempt_id) {
    const attempt = await db.exam_attempts.findFirst({
      where: {
        id: input.attempt_id,
        student_id: student.id,
        exam_id: examId,
      },
      select: {
        id: true,
      },
    });
    if (!attempt) {
      gateError("ATTEMPT_NOT_FOUND", 404, "Attempt not found.");
    }
  }

  if (input.gate_session_id) {
    const gateSession = await db.exam_gate_sessions.findFirst({
      where: {
        id: input.gate_session_id,
        exam_id: examId,
        student_id: student.id,
      },
      select: {
        id: true,
      },
    });
    if (!gateSession) {
      gateError("GATE_SESSION_NOT_FOUND", 404, "Gate session not found.");
    }
  }

  const violation = await db.exam_attempt_violations.create({
    data: {
      exam_id: examId,
      attempt_id: input.attempt_id ?? null,
      gate_session_id: input.gate_session_id ?? null,
      student_id: student.id,
      device_id: input.device_id ?? null,
      violation_type: input.violation_type,
      severity: input.severity,
      message: input.message ?? null,
      metadata_json: JSON.stringify(input.metadata ?? {}),
    },
  });

  broadcastExamRealtime({
    type: "exam.updated",
    examId,
    studentId: student.id,
    attemptId: input.attempt_id ?? null,
    actorRole: actor.role,
    payload: {
      action: "violation_logged",
      violation_type: input.violation_type,
      severity: input.severity,
      gate_session_id: input.gate_session_id ?? null,
      device_id: input.device_id ?? null,
    },
  });

  return {
    student,
    violation,
  };
}

export async function ensureStudentGateAccess(
  db: GateDb,
  examId: number,
  actor: AuthenticatedUser,
  options: {
    deviceId?: string | null;
    requireLive?: boolean;
  } = {},
) {
  const student = await loadStudentProfile(db, actor.id);
  const exam = await loadGateExamForStudent(db, examId, student, {
    allowScheduled: true,
    requireVersioned: true,
  });
  const session = await loadGateSession(db, exam.id, student.id);

  if (!session || session.gate_status !== "VERIFIED" || session.device_bind_status !== "BOUND") {
    gateError("QR_VERIFICATION_REQUIRED", 403, "QR verification is required before entering the exam.");
  }

  if (options.deviceId && session.device_id !== options.deviceId) {
    gateError("DEVICE_BIND_MISMATCH", 403, "Device does not match the verified gate session.");
  }

  if (options.requireLive && exam.status !== "LIVE") {
    gateError("EXAM_NOT_LIVE", 403, "The exam is not live yet.");
  }

  return {
    student,
    exam,
    gateSession: session as GateSessionRow,
  };
}

export async function linkGateAttempt(
  db: GateDb,
  examId: number,
  studentId: number,
  attemptId: number,
): Promise<void> {
  const session = await loadGateSession(db, examId, studentId);
  if (!session) {
    return;
  }

  await db.exam_gate_sessions.update({
    where: {
      exam_id_student_id: {
        exam_id: examId,
        student_id: studentId,
      },
    },
    data: {
      attempt_id: attemptId,
    },
  });
}

/**
 * Teacher-only: hard-reset all gate sessions for an exam so every student must
 * show their QR code again.
 *
 * What gets cleared:
 *  - All gate sessions → WAITING_FOR_SCAN / UNBOUND, QR token invalidated
 *  - All generated paper instances (re-generated fresh on next QR scan)
 *
 * What is preserved:
 *  - Submitted / auto-submitted exam attempts and their answers (audit trail)
 *  - The exam itself and its question paper version
 */
export async function resetExamGateSessions(
  db: GateDb,
  examId: number,
  actor: AuthenticatedUser,
) {
  const exam = await db.exams.findFirst({
    where: { id: examId },
    select: { id: true, title: true, status: true },
  });

  if (!exam) gateError("EXAM_NOT_FOUND", 404, "Exam not found.");
  if (exam.status === "RESULT_RELEASED" || exam.status === "ARCHIVED") {
    gateError("EXAM_LOCKED", 400, "Cannot reset sessions for a released or archived exam.");
  }

  // Reset all gate sessions for this exam.
  const sessionReset = await db.exam_gate_sessions.updateMany({
    where: { exam_id: examId },
    data: {
      gate_status: "WAITING_FOR_SCAN",
      device_bind_status: "UNBOUND",
      paper_download_status: "NOT_STARTED",
      qr_token_hash: "",           // invalidate any cached QR tokens
      qr_expires_at: new Date(0),  // expired immediately
      verified_by_teacher_id: null,
      verified_at: null,
      attempt_id: null,
    },
  });

  // Delete paper instances so new (freshly shuffled) papers are generated on next scan.
  // Only delete instances where the student has NOT submitted/auto-submitted an attempt,
  // so we preserve the paper reference for completed attempts.
  const submittedAttemptInstanceIds = await db.exam_attempts.findMany({
    where: {
      exam_id: examId,
      status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      assigned_paper_instance_id: { not: null },
    },
    select: { assigned_paper_instance_id: true },
  });
  const preservedInstanceIds = submittedAttemptInstanceIds
    .map((a: { assigned_paper_instance_id: number | null }) => a.assigned_paper_instance_id)
    .filter((id: number | null): id is number => id !== null);

  const paperReset = await db.student_exam_paper_instances.deleteMany({
    where: {
      exam_id: examId,
      ...(preservedInstanceIds.length > 0 ? { id: { notIn: preservedInstanceIds } } : {}),
    },
  });

  log.gate.info("Gate sessions reset by teacher", {
    exam_id: examId,
    actor_id: actor.id,
    sessions_reset: sessionReset.count,
    paper_instances_deleted: paperReset.count,
  });

  broadcastExamRealtime({
    type: "exam.updated",
    examId,
    actorRole: actor.role,
    payload: {
      action: "gate_sessions_reset",
      sessions_reset: sessionReset.count,
      paper_instances_deleted: paperReset.count,
    },
  });

  return {
    sessions_reset: sessionReset.count,
    paper_instances_deleted: paperReset.count,
    exam,
  };
}

export async function loadAssignedStudentPaperPayload(db: GateDb, examId: number, studentId: number) {
  return loadStudentAssignedPaperPayload(db, examId, studentId);
}

export async function unlockStudentAssignedPaperReview(db: GateDb, examId: number, studentId: number, deviceId?: string | null) {
  return issueStudentAssignedPaperReviewUnlock(db, examId, studentId, deviceId);
}

export const mapGateStatus = buildGateStatus;

// ─── Paper distribution monitoring ────────────────────────────────────────────

type QPos = { version_question_id: number; student_question_order: number };

function collisionRate(a: QPos[], b: QPos[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bMap = new Map<number, number>();
  for (const q of b) bMap.set(q.version_question_id, q.student_question_order);
  let hits = 0;
  for (const q of a) {
    if (bMap.get(q.version_question_id) === q.student_question_order) hits++;
  }
  return hits / Math.max(a.length, b.length);
}

/**
 * Computes cross-student position-collision statistics for a teacher.
 *
 * Default mode  : adjacent pairs only (n, n+1) — O(N) comparisons, always fast.
 * ?full=true    : all pairs — O(N²/2), capped at 500 students.
 */
export async function getPaperDistributionStats(
  db: GateDb,
  examId: number,
  actor: AuthenticatedUser,
  options: { full?: boolean } = {},
) {
  const exam = await db.exams.findFirst({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      status: true,
      question_paper_version: {
        select: {
          sections: {
            select: { section_code: true, question_count_target: true },
            orderBy: { section_order: "asc" },
          },
        },
      },
      section_delivery_rules: {
        select: { section_code: true, questions_to_deliver: true },
      },
    },
  });

  if (!exam) gateError("EXAM_NOT_FOUND", 404, "Exam not found.");

  const instances = await db.student_exam_paper_instances.findMany({
    where: { exam_id: examId },
    orderBy: { assigned_student_number: "asc" },
    select: {
      id: true,
      assigned_student_number: true,
      perturbation_count: true,
      max_neighbor_collision: true,
      questions: {
        select: { version_question_id: true, student_question_order: true },
      },
    },
  });

  const total = instances.length;
  if (total === 0) {
    return {
      exam,
      total_assigned: 0,
      adjacency_report: [],
      summary: null,
      histogram: null,
      danger_pairs: [],
      generation_health: { students_needing_retry: 0, max_perturbation_used: 0 },
    };
  }

  type Instance = {
    assigned_student_number: number;
    perturbation_count: number;
    max_neighbor_collision: number | null;
    questions: QPos[];
  };
  const list = instances as Instance[];

  // ── Pair computation ───────────────────────────────────────────────────────
  type Pair = { a: number; b: number; rate: number };
  const pairs: Pair[] = [];

  if (options.full && total <= 500) {
    // All N*(N-1)/2 pairs
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        pairs.push({
          a: list[i].assigned_student_number,
          b: list[j].assigned_student_number,
          rate: collisionRate(list[i].questions, list[j].questions),
        });
      }
    }
  } else {
    // Adjacent pairs only (n, n+1) — always included even in full mode for large classes
    for (let i = 0; i < list.length - 1; i++) {
      pairs.push({
        a: list[i].assigned_student_number,
        b: list[i + 1].assigned_student_number,
        rate: collisionRate(list[i].questions, list[i + 1].questions),
      });
    }
  }

  // ── Statistics ─────────────────────────────────────────────────────────────
  const THRESHOLD = 0.12;
  const DANGER    = 0.15;

  const rates = pairs.map((p) => p.rate);
  const summary = rates.length === 0 ? null : {
    min_rate: Math.min(...rates),
    max_rate: Math.max(...rates),
    avg_rate: rates.reduce((s, r) => s + r, 0) / rates.length,
    pairs_above_threshold: rates.filter((r) => r > THRESHOLD).length,
  };

  const bucketDefs = [
    { label: "0–5%",   lo: 0,    hi: 0.05 },
    { label: "5–10%",  lo: 0.05, hi: 0.10 },
    { label: "10–15%", lo: 0.10, hi: 0.15, warning: true },
    { label: "15%+",   lo: 0.15, hi: Infinity, danger: true },
  ];
  const histogram = bucketDefs.map((b) => ({
    bucket: b.label,
    count: rates.filter((r) => r >= b.lo && r < b.hi).length,
    ...(b.warning ? { warning: true } : {}),
    ...(b.danger  ? { danger: true  } : {}),
  }));

  const adjacency_report = pairs.map((p) => ({
    n: p.a,
    m: p.b,
    collision_rate: Number(p.rate.toFixed(4)),
    flag: p.rate > DANGER    ? "DANGER"
        : p.rate > THRESHOLD ? "WARNING"
        : "SAFE",
  }));

  const danger_pairs = pairs
    .filter((p) => p.rate > DANGER)
    .sort((a, b) => b.rate - a.rate)
    .map((p) => ({
      student_a_number: p.a,
      student_b_number: p.b,
      collision_rate: Number(p.rate.toFixed(4)),
    }));

  const generation_health = {
    students_needing_retry: list.filter((i) => i.perturbation_count > 0).length,
    max_perturbation_used:  Math.max(0, ...list.map((i) => i.perturbation_count)),
    avg_neighbor_collision: (() => {
      const known = list.map((i) => i.max_neighbor_collision).filter((v): v is number => v !== null);
      return known.length > 0 ? Number((known.reduce((s, v) => s + v, 0) / known.length).toFixed(4)) : null;
    })(),
  };

  return {
    exam: { id: exam.id, title: exam.title, status: exam.status },
    total_assigned: total,
    mode: options.full && total <= 500 ? "full_pairs" : "adjacent_pairs",
    adjacency_report,
    summary,
    histogram,
    danger_pairs,
    generation_health,
  };
}
