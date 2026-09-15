/**
 * Express middleware that logs every HTTP request and its response.
 *
 * Output example:
 *   12:34:56.789 INFO  [http] POST    /api/student/exams/3/gate/qr  200  142ms  student_id=7
 */

import type { Request, Response, NextFunction } from "express";
import { log, colorMethod, colorStatus } from "./logger";

// Paths to skip entirely (e.g. noisy health checks from uptime monitors).
const SKIP_PATHS = new Set(["/health"]);

// Headers that may carry the authenticated user ID.
const AUTH_HEADERS = ["x-user-id", "x-student-id", "x-teacher-id"];

// Body fields that must never be written to logs (credentials / secrets / tokens).
const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "current_password",
  "new_password",
  "old_password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "secret",
  "otp",
  "pin",
]);

/** Shallow-redact sensitive keys from a request/response body before logging. */
function redactBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  if (Array.isArray(body)) return `[array(${body.length})]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = SENSITIVE_BODY_KEYS.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  return out;
}

function extractUserId(req: Request): string | undefined {
  for (const h of AUTH_HEADERS) {
    const v = req.headers[h];
    if (v) return String(v);
  }
  return undefined;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_PATHS.has(req.path)) {
    next();
    return;
  }

  const startMs = Date.now();
  // Log immediately on receipt so canceled requests are always visible
  const method = colorMethod(req.method);
  const path   = req.originalUrl || req.url;
  log.http.info(`${method} ${path}  -->`, { body: redactBody(req.body) });

  let logged = false;
  const logResult = (label: string) => {
    if (logged) return;
    logged = true;
    const duration = Date.now() - startMs;
    const status   = colorStatus(res.statusCode);
    const userId   = extractUserId(req);
    const fields: Record<string, unknown> = { ms: duration };
    if (userId) fields["uid"] = userId;
    const body = (res as unknown as Record<string, unknown>)["__logBody"];
    if (body) fields["body"] = redactBody(body);
    log.http.info(`${method} ${path}  ${status}  [${label}]`, fields);
  };

  res.on("finish", () => logResult("ok"));
  res.on("close",  () => logResult("client-canceled"));

  next();
}

/**
 * Error-logging middleware -- mount AFTER all routes.
 * Logs the error and attaches a sanitised message to the response.
 */
export function errorLogger(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack   = err instanceof Error ? err.stack   : undefined;

  log.http.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
    error:  message,
    stack:  stack?.split("\n").slice(0, 4).join(" | "),
  });

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(500).json({ status: "error", message: "Internal server error." });
}
