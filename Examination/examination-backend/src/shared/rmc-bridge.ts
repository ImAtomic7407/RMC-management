/**
 * rmc-bridge.ts
 * Server-to-server HTTP client for calling the RMC internal exam API.
 * All calls attach the shared secret header.
 * These functions throw on unexpected errors; callers handle 404/401 as logic branches.
 *
 * NOTE: Uses http.request() with agent:false instead of fetch() to avoid the
 * undici half-open deadlock bug where POST bodies are held back on loopback
 * connections (headers sent, body never flushed → BODY TIMEOUT on the server).
 */

import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { env } from "../config/env";
import { log } from "./logger";

export type RmcStaffUser = {
  source_uid: string;
  username: string;
  full_name: string;
  phone: string | null;
  rmc_role: "teacher" | "staff" | "host";
  active: boolean;
};

export type RmcStudentUser = {
  source_uid: string;
  student_uid: string;
  full_name: string;
  phone: string | null;
  rmc_role: "student";
  batches: string[];
  primary_batch: string | null;
  active: boolean;
  photo_url: string | null;  // web-relative path, e.g. /uploads/photo.jpg — served by RMC
};

export type RmcVerifyResult =
  | { ok: true; user: RmcStaffUser | RmcStudentUser }
  | { ok: false; status: number; error: string };

function rmcHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-exam-secret": env.RMC_INTERNAL_SECRET,
  };
}

function rmcUrl(path: string): string {
  const base = env.RMC_API_URL.replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * Low-level HTTP helper. Uses http/https .request() with agent:false so every
 * call gets a fresh TCP connection — no undici connection-reuse / pipelining
 * that causes the half-open body-hold deadlock on loopback targets.
 */
function rmcRequest(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
  },
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib: typeof http | typeof https = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: {
        ...options.headers,
        // Declare body length explicitly so the server never has to guess
        ...(options.body !== undefined
          ? { "Content-Length": Buffer.byteLength(options.body).toString() }
          : {}),
      },
      agent: false, // force a fresh connection — no keep-alive / pipelining
    };

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy(new Error(`RMC request timed out after ${options.timeoutMs}ms`));
      }
    }, options.timeoutMs);

    const req = lib.request(reqOptions, (res) => {
      clearTimeout(timer);
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        if (settled) return;
        settled = true;
        const raw = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => {
            try {
              return Promise.resolve(JSON.parse(raw) as unknown);
            } catch (e) {
              return Promise.reject(e);
            }
          },
        });
      });
      res.on("error", (err) => {
        if (!settled) { settled = true; reject(err); }
      });
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });

    // Write body synchronously, then end — this is the critical fix.
    // fetch()/undici may buffer and defer the body write; http.request() does not.
    if (options.body !== undefined) {
      req.write(options.body, "utf8");
    }
    req.end();
  });
}

/** Ping RMC — returns true if alive */
export async function pingRmc(): Promise<boolean> {
  if (!env.RMC_API_URL || !env.RMC_INTERNAL_SECRET) return false;
  try {
    const res = await rmcRequest(rmcUrl("/api/internal/exam/healthz"), {
      method: "GET",
      headers: rmcHeaders(),
      timeoutMs: 5000,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Verify a staff/teacher user credential against RMC */
export async function verifyRmcStaff(
  username: string,
  password: string,
): Promise<RmcVerifyResult> {
  if (!env.RMC_API_URL || !env.RMC_INTERNAL_SECRET) {
    return { ok: false, status: 503, error: "RMC bridge not configured." };
  }
  try {
    const res = await rmcRequest(rmcUrl("/api/internal/exam/verify-staff"), {
      method: "POST",
      headers: rmcHeaders(),
      body: JSON.stringify({ username, password }),
      timeoutMs: 8000,
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(body.error ?? "RMC verification failed."),
      };
    }
    return { ok: true, user: body.user as RmcStaffUser };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.system.error("RMC bridge verifyRmcStaff failed", { error: msg });
    return { ok: false, status: 502, error: "RMC server unreachable." };
  }
}

/** Verify a student by UID — no password needed (RMC student login uses uid+trio-lock) */
export async function verifyRmcStudent(
  uid: string,
): Promise<RmcVerifyResult> {
  if (!env.RMC_API_URL || !env.RMC_INTERNAL_SECRET) {
    return { ok: false, status: 503, error: "RMC bridge not configured." };
  }
  try {
    const res = await rmcRequest(rmcUrl("/api/internal/exam/verify-student"), {
      method: "POST",
      headers: rmcHeaders(),
      body: JSON.stringify({ uid }),
      timeoutMs: 4000,
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(body.error ?? "Student not found in RMC."),
      };
    }
    return { ok: true, user: body.user as RmcStudentUser };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.system.error("RMC bridge verifyRmcStudent failed", { error: msg });
    return { ok: false, status: 502, error: "RMC server unreachable." };
  }
}

/** Fetch full student roster from RMC for bulk sync */
export async function fetchRmcStudentRoster(): Promise<RmcStudentUser[]> {
  const res = await rmcRequest(rmcUrl("/api/internal/exam/roster"), {
    method: "GET",
    headers: rmcHeaders(),
    timeoutMs: 30000,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(`RMC roster fetch failed: ${res.status} ${String(body.error ?? "")}`);
  }
  const body = (await res.json()) as { students: RmcStudentUser[] };
  return body.students ?? [];
}

/** Fetch full staff/teacher roster from RMC for bulk sync */
export async function fetchRmcStaffRoster(): Promise<RmcStaffUser[]> {
  const res = await rmcRequest(rmcUrl("/api/internal/exam/staff-roster"), {
    method: "GET",
    headers: rmcHeaders(),
    timeoutMs: 30000,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(`RMC staff roster fetch failed: ${res.status} ${String(body.error ?? "")}`);
  }
  const body = (await res.json()) as { staff: RmcStaffUser[] };
  return body.staff ?? [];
}
