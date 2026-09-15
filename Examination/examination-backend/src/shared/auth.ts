import crypto from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { getDatabaseReadiness } from "./db-readiness";
import { jwtKeyStore } from "./jwt-keystore";

export type AuthenticatedUser = {
  id: number;
  username: string;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  status: "ACTIVE" | "BLOCKED" | "PENDING";
  full_name: string | null;
  phone: string | null;
  last_login_at: Date | null;
};

export type AuthContext = {
  user: AuthenticatedUser;
  token: AuthTokenPayload;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
};

export type TokenAuthenticatedRequest = Request & {
  token?: AuthTokenPayload;
};

export type AuthTokenPayload = JwtPayload & {
  sub: string;
  username: string;
  role: AuthenticatedUser["role"];
  status: AuthenticatedUser["status"];
  jti: string;
};

type RevocationEntry = {
  expiresAtMs: number;
};

const revokedTokenJtis = new Map<string, RevocationEntry>();

function pruneRevokedTokens(nowMs = Date.now()): void {
  for (const [jti, entry] of revokedTokenJtis.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      revokedTokenJtis.delete(jti);
    }
  }
}

export function issueAccessToken(user: AuthenticatedUser): string {
  const payload = {
    username: user.username,
    role: user.role,
    status: user.status,
    kid: jwtKeyStore.currentKeyId,
  };

  const options: jwt.SignOptions = {
    subject: String(user.id),
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    jwtid: crypto.randomUUID(),
    issuer: "examination-backend",
  };

  return jwt.sign(payload, jwtKeyStore.currentSecret, options);
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  // Decode without verifying first to read the kid claim (fast path).
  const decoded = jwt.decode(token, { complete: true });
  const kidClaim = (decoded?.payload as Record<string, unknown>)?.kid;

  const secrets = jwtKeyStore.allSecrets;

  // If the token carries a kid, try that key first; otherwise try all.
  const ordered =
    typeof kidClaim === "string"
      ? [
          ...secrets.filter((k) => k.id === kidClaim),
          ...secrets.filter((k) => k.id !== kidClaim),
        ]
      : secrets;

  let lastError: unknown;
  for (const { secret } of ordered) {
    try {
      return jwt.verify(token, secret, {
        issuer: "examination-backend",
      }) as AuthTokenPayload;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function requireSchemaReady(): Promise<boolean> {
  const readiness = await getDatabaseReadiness();
  return readiness.connected && readiness.schemaReady;
}

export async function resolveAuthenticatedUser(token: string): Promise<AuthContext | null> {
  const payload = verifyAccessToken(token);
  pruneRevokedTokens();
  if (!payload.jti || revokedTokenJtis.has(payload.jti)) {
    return null;
  }

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId)) {
    return null;
  }

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      full_name: true,
      phone: true,
      last_login_at: true,
    },
  });

  if (!user) {
    return null;
  }

  if (user.status !== "ACTIVE") {
    return null;
  }

  return {
    user: user as AuthenticatedUser,
    token: payload,
  };
}

export async function revokeAccessToken(token: string): Promise<boolean> {
  try {
    const payload = verifyAccessToken(token);
    if (!payload.jti || !payload.exp) {
      return false;
    }
    revokedTokenJtis.set(payload.jti, {
      expiresAtMs: payload.exp * 1000,
    });
    pruneRevokedTokens();
    return true;
  } catch {
    return false;
  }
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, value] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !value) {
    return null;
  }
  return value;
}

export function requireSignedTokenMiddleware(req: TokenAuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({
      status: "error",
      code: "UNAUTHORIZED",
      message: "Missing bearer token.",
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    pruneRevokedTokens();
    if (!payload.jti || revokedTokenJtis.has(payload.jti)) {
      res.status(401).json({
        status: "error",
        code: "UNAUTHORIZED",
        message: "Invalid or expired token.",
      });
      return;
    }

    req.token = payload;
    next();
  } catch {
    res.status(401).json({
      status: "error",
      code: "UNAUTHORIZED",
      message: "Invalid or expired token.",
    });
  }
}

export async function requireAuthMiddleware(req: AuthenticatedRequest, res: any, next: any): Promise<void> {
  const schemaReady = await requireSchemaReady();
  if (!schemaReady) {
    res.status(503).json({
      status: "error",
      code: "SCHEMA_NOT_READY",
      message: "Examination database schema is not ready yet.",
    });
    return;
  }

  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({
      status: "error",
      code: "UNAUTHORIZED",
      message: "Missing bearer token.",
    });
    return;
  }

  try {
    const context = await resolveAuthenticatedUser(token);
    if (!context) {
      res.status(401).json({
        status: "error",
        code: "UNAUTHORIZED",
        message: "Invalid or expired token.",
      });
      return;
    }

    req.auth = context;
    next();
  } catch {
    res.status(401).json({
      status: "error",
      code: "UNAUTHORIZED",
      message: "Invalid or expired token.",
    });
  }
}

export function requireRoleMiddleware(...allowedRoles: AuthenticatedUser["role"][]) {
  return (req: AuthenticatedRequest, res: any, next: any): void => {
    if (!req.auth) {
      res.status(401).json({
        status: "error",
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
      return;
    }

    if (!allowedRoles.includes(req.auth.user.role)) {
      res.status(403).json({
        status: "error",
        code: "FORBIDDEN",
        message: "Insufficient role permissions.",
      });
      return;
    }

    next();
  };
}

export async function writeAuthAuditLog(args: {
  actorUserId: number | null;
  actorRole: AuthenticatedUser["role"] | "SYSTEM";
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  deviceId?: string | null;
}): Promise<void> {
  const schemaReady = await requireSchemaReady();
  if (!schemaReady) {
    return;
  }

  await prisma.exam_audit_logs.create({
    data: {
      actor_user_id: args.actorUserId,
      actor_role: args.actorRole,
      action: args.action,
      entity_type: args.entityType,
      entity_id: args.entityId,
      metadata_json: args.metadata ? JSON.stringify(args.metadata) : null,
      ip_address: args.ipAddress ?? null,
      device_id: args.deviceId ?? null,
    },
  });
}
