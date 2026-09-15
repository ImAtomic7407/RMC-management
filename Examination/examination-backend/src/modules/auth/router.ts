import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../shared/prisma";
import { log } from "../../shared/logger";
import {
  extractBearerToken,
  issueAccessToken,
  requireAuthMiddleware,
  requireRoleMiddleware,
  revokeAccessToken,
  writeAuthAuditLog,
  type AuthenticatedRequest,
} from "../../shared/auth";
import { requireSchemaReady } from "../../shared/auth";
import { verifyRmcStaff, verifyRmcStudent, type RmcStaffUser, type RmcStudentUser } from "../../shared/rmc-bridge";
import { importStudentRecord, importTeacherRecord } from "../identity/service";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
});

const router = Router();

router.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }

  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Examination database schema is not ready yet." });
    return;
  }

  const { username, password } = parsed.data;
  const user = await prisma.users.findUnique({
    where: { username },
    select: {
      id: true, username: true, role: true, status: true,
      full_name: true, phone: true, password_hash: true, last_login_at: true,
    },
  });

  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({ status: "error", code: "INVALID_CREDENTIALS", message: "Invalid username or password." });
    return;
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    log.auth.warn("Login failed -- wrong password", { username, ip: req.ip });
    await writeAuthAuditLog({
      actorUserId: user.id, actorRole: user.role,
      action: "AUTH_LOGIN_FAILED", entityType: "user", entityId: String(user.id),
      metadata: { username }, ipAddress: req.ip,
    });
    res.status(401).json({ status: "error", code: "INVALID_CREDENTIALS", message: "Invalid username or password." });
    return;
  }

  const updatedUser = await prisma.users.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
    select: { id: true, username: true, role: true, status: true, full_name: true, phone: true, last_login_at: true },
  });

  const accessToken = issueAccessToken(updatedUser);
  log.auth.info("Login successful", { user_id: updatedUser.id, username: updatedUser.username, role: updatedUser.role, ip: req.ip });

  await writeAuthAuditLog({
    actorUserId: updatedUser.id, actorRole: updatedUser.role,
    action: "AUTH_LOGIN_SUCCESS", entityType: "user", entityId: String(updatedUser.id),
    metadata: { username: updatedUser.username }, ipAddress: req.ip,
  });

  res.status(200).json({
    status: "success", token_type: "Bearer",
    access_token: accessToken, expires_in: env.JWT_EXPIRES_IN, user: updatedUser,
  });
});

router.get("/me", requireAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.auth) {
    res.status(401).json({ status: "error", code: "UNAUTHORIZED", message: "Authentication required." });
    return;
  }

  const user = await prisma.users.findUnique({
    where: { id: req.auth.user.id },
    select: {
      id: true, username: true, role: true, status: true,
      full_name: true, phone: true, last_login_at: true,
      student_profile: { select: { student_uid: true, batch_id: true, class_name: true, roll_no: true, active: true } },
      teacher_profile: { select: { employee_code: true, active: true } },
    },
  });

  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({ status: "error", code: "UNAUTHORIZED", message: "User is no longer active." });
    return;
  }

  res.status(200).json({ status: "success", user });
});

router.post("/logout", requireAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ status: "error", code: "UNAUTHORIZED", message: "Missing bearer token." });
    return;
  }

  const revoked = await revokeAccessToken(token);

  if (req.auth) {
    await writeAuthAuditLog({
      actorUserId: req.auth.user.id, actorRole: req.auth.user.role,
      action: "AUTH_LOGOUT", entityType: "user", entityId: String(req.auth.user.id),
      metadata: { revoked }, ipAddress: req.ip,
    });
  }

  res.status(200).json({ status: "success", message: "Logged out successfully.", token_revoked: revoked });
});

// ── RMC-delegated login ──────────────────────────────────────────────────────
// Exam app sends RMC credentials here; we verify against RMC, upsert the user
// locally via the identity bridge, and issue an examination JWT.

const rmcStaffLoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const rmcStudentLoginSchema = z.object({
  uid: z.string().min(1).max(100),
});

router.post("/login/rmc/staff", async (req: Request, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Schema not ready." });
    return;
  }
  if (!env.RMC_AUTH_ENABLED) {
    res.status(404).json({ status: "error", code: "NOT_ENABLED", message: "RMC auth is not enabled." });
    return;
  }

  const parsed = rmcStaffLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }

  const { username, password } = parsed.data;
  const result = await verifyRmcStaff(username, password);

  if (!result.ok) {
    log.auth.warn("RMC staff login failed", { username, status: result.status, error: result.error, ip: req.ip });
    res.status(result.status === 404 ? 401 : result.status).json({
      status: "error", code: "INVALID_CREDENTIALS", message: result.error,
    });
    return;
  }

  const rmcUser = result.user as RmcStaffUser;
  const examRole: "ADMIN" | "TEACHER" = rmcUser.rmc_role === "host" ? "ADMIN" : "TEACHER";

  const imported = await importTeacherRecord({
    source_system: "rmc",
    source_uid: rmcUser.source_uid,
    username: rmcUser.username,
    full_name: rmcUser.full_name,
    phone: rmcUser.phone ?? undefined,
    role: examRole,
    active: rmcUser.active,
  });

  const examUser = await prisma.users.findUnique({ where: { id: imported.user_id } });
  if (!examUser || examUser.status !== "ACTIVE") {
    res.status(403).json({ status: "error", code: "ACCOUNT_INACTIVE", message: "Account is not active." });
    return;
  }

  const token = issueAccessToken({
    id: examUser.id, username: examUser.username,
    role: examUser.role as "ADMIN" | "TEACHER",
    status: examUser.status as "ACTIVE",
    full_name: examUser.full_name, phone: examUser.phone, last_login_at: examUser.last_login_at,
  });

  await prisma.users.update({ where: { id: examUser.id }, data: { last_login_at: new Date() } });
  await writeAuthAuditLog({
    actorUserId: examUser.id, actorRole: examUser.role as "ADMIN" | "TEACHER",
    action: "AUTH_RMC_LOGIN_SUCCESS", entityType: "user", entityId: String(examUser.id),
    metadata: { source: "rmc", rmc_role: rmcUser.rmc_role }, ipAddress: req.ip,
  });

  log.auth.info("RMC staff login successful", { user_id: examUser.id, username: examUser.username, role: examUser.role, ip: req.ip });

  res.status(200).json({
    status: "success", token_type: "Bearer",
    access_token: token, expires_in: env.JWT_EXPIRES_IN,
    user: { id: examUser.id, username: examUser.username, role: examUser.role, full_name: examUser.full_name },
  });
});

router.post("/login/rmc/student", async (req: Request, res: Response) => {
  if (!(await requireSchemaReady())) {
    res.status(503).json({ status: "error", code: "SCHEMA_NOT_READY", message: "Schema not ready." });
    return;
  }
  if (!env.RMC_AUTH_ENABLED) {
    res.status(404).json({ status: "error", code: "NOT_ENABLED", message: "RMC auth is not enabled." });
    return;
  }

  const parsed = rmcStudentLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", code: "VALIDATION_ERROR", issues: parsed.error.flatten() });
    return;
  }

  const { uid } = parsed.data;

  // Always verify against RMC first — never issue a token for a UID without
  // confirming the credential is still valid. The local profile is used only
  // after the bridge confirms the student is active.
  const result = await verifyRmcStudent(uid);

  if (!result.ok) {
    log.auth.warn("RMC student login failed", { uid, status: result.status, error: result.error, ip: req.ip });
    res.status(result.status === 404 ? 401 : result.status).json({
      status: "error", code: "INVALID_CREDENTIALS", message: result.error,
    });
    return;
  }

  const rmcStudent = result.user as RmcStudentUser;

  const imported = await importStudentRecord({
    source_system: "rmc",
    source_uid: rmcStudent.source_uid,
    student_uid: rmcStudent.student_uid,
    username: rmcStudent.full_name,
    full_name: rmcStudent.full_name,
    phone: rmcStudent.phone ?? undefined,
    batch_name: rmcStudent.primary_batch ?? "unknown",
    batch_names: rmcStudent.batches,
    active: rmcStudent.active,
    photo_url: rmcStudent.photo_url ?? null,
  });

  const examUser = await prisma.users.findUnique({ where: { id: imported.user_id } });
  if (!examUser || examUser.status !== "ACTIVE") {
    res.status(403).json({ status: "error", code: "ACCOUNT_INACTIVE", message: "Account is not active." });
    return;
  }

  const token = issueAccessToken({
    id: examUser.id, username: examUser.username,
    role: "STUDENT", status: "ACTIVE",
    full_name: examUser.full_name, phone: examUser.phone, last_login_at: examUser.last_login_at,
  });

  await prisma.users.update({ where: { id: examUser.id }, data: { last_login_at: new Date() } });
  await writeAuthAuditLog({
    actorUserId: examUser.id, actorRole: "STUDENT",
    action: "AUTH_RMC_LOGIN_SUCCESS", entityType: "user", entityId: String(examUser.id),
    metadata: { source: "rmc", student_uid: rmcStudent.student_uid, batches: rmcStudent.batches },
    ipAddress: req.ip,
  });

  log.auth.info("RMC student login successful", { user_id: examUser.id, username: examUser.username, ip: req.ip });

  res.status(200).json({
    status: "success", token_type: "Bearer",
    access_token: token, expires_in: env.JWT_EXPIRES_IN,
    user: {
      id: examUser.id, username: examUser.username, role: "STUDENT",
      full_name: examUser.full_name,
      student_uid: rmcStudent.student_uid,
      batches: rmcStudent.batches,
      photo_url: rmcStudent.photo_url ?? null,
    },
  });
});

export { router as authRouter };
