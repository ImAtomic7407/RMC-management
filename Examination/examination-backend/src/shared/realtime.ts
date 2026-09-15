import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, type RawData } from "ws";
import { resolveAuthenticatedUser, type AuthenticatedUser } from "./auth";
import { readAppUpdateManifest } from "../modules/app-update/service";
import { log } from "./logger";

export type RealtimeEvent = {
  type: string;
  timestamp: string;
  exam_id?: number | null;
  student_id?: number | null;
  attempt_id?: number | null;
  actor_role?: AuthenticatedUser["role"] | "SYSTEM" | null;
  payload?: Record<string, unknown> | null;
};

type RealtimeConnection = {
  id: string;
  user: AuthenticatedUser;
  ws: WebSocket;
  clientAppVersionCode?: number | null;
  clientAppVersionName?: string | null;
};

const connections = new Map<string, RealtimeConnection>();

function safeSend(ws: WebSocket, message: string): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    ws.send(message);
  } catch {
    // Ignore transient socket failures.
  }
}

export async function acceptRealtimeConnection(request: IncomingMessage, ws: WebSocket): Promise<boolean> {
  const requestUrl = request.url ?? "/";
  const url = new URL(requestUrl, "http://localhost");
  const token = url.searchParams.get("token");
  const clientAppVersionCode = Number(url.searchParams.get("client_version_code") ?? "");
  const clientAppVersionName = url.searchParams.get("client_version_name");
  if (!token) {
    safeSend(ws, JSON.stringify({
      type: "realtime.error",
      timestamp: new Date().toISOString(),
      payload: {
        code: "UNAUTHORIZED",
        message: "Missing websocket token.",
      },
    }));
    ws.close(4401, "Missing token");
    return false;
  }

  let context;
  try {
    context = await resolveAuthenticatedUser(token);
  } catch {
    // JWT verification threw (e.g. invalid signature) — treat as unauthorized
    context = null;
  }
  if (!context) {
    safeSend(ws, JSON.stringify({
      type: "realtime.error",
      timestamp: new Date().toISOString(),
      payload: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired websocket token.",
      },
    }));
    ws.close(4401, "Unauthorized");
    return false;
  }

  const connectionId = crypto.randomUUID();
  const connection: RealtimeConnection = {
    id: connectionId,
    user: context.user,
    ws,
    clientAppVersionCode: Number.isFinite(clientAppVersionCode) ? clientAppVersionCode : null,
    clientAppVersionName: clientAppVersionName && clientAppVersionName.length > 0 ? clientAppVersionName : null,
  };

  connections.set(connectionId, connection);

  log.ws.info("Realtime connection accepted", {
    conn_id: connectionId.slice(0, 8),
    user_id: context.user.id,
    username: context.user.username,
    role:     context.user.role,
    app_ver:  connection.clientAppVersionName ?? "unknown",
    total:    connections.size,
  });

  safeSend(ws, JSON.stringify({
    type: "realtime.connected",
    timestamp: new Date().toISOString(),
    actor_role: context.user.role,
    payload: {
      user_id: context.user.id,
      username: context.user.username,
      role: context.user.role,
    },
  }));

  if (Number.isFinite(connection.clientAppVersionCode ?? Number.NaN)) {
    const manifest = await readAppUpdateManifest();
    const clientVersionCode = connection.clientAppVersionCode ?? null;
    if (clientVersionCode != null) {
      const updateAvailable = manifest.status !== "not_available" && manifest.latest_version_code > clientVersionCode;
      if (updateAvailable) {
        const minimumSupported = manifest.minimum_supported_version_code ?? null;
        const mandatory = Boolean(
          manifest.mandatory || (minimumSupported != null && clientVersionCode < minimumSupported),
        );
        safeSend(ws, JSON.stringify({
          type: "app.update.available",
          timestamp: new Date().toISOString(),
          actor_role: "SYSTEM",
          payload: {
            current_version_code: clientVersionCode,
            current_version_name: connection.clientAppVersionName,
            ...manifest,
            mandatory,
          },
        }));
      }
    }
  }

  ws.on("close", (code) => {
    connections.delete(connectionId);
    log.ws.info("Realtime connection closed", {
      conn_id:  connectionId.slice(0, 8),
      user_id:  context.user.id,
      username: context.user.username,
      code,
      remaining: connections.size,
    });
  });

  ws.on("error", (err) => {
    connections.delete(connectionId);
    log.ws.error("Realtime connection error", {
      conn_id:  connectionId.slice(0, 8),
      user_id:  context.user.id,
      error:    err.message,
    });
  });

  return true;
}

export function broadcastRealtimeEvent(event: Omit<RealtimeEvent, "timestamp"> & { timestamp?: string }): void {
  const envelope: RealtimeEvent = {
    type: event.type,
    timestamp: event.timestamp ?? new Date().toISOString(),
    exam_id: event.exam_id ?? null,
    student_id: event.student_id ?? null,
    attempt_id: event.attempt_id ?? null,
    actor_role: event.actor_role ?? null,
    payload: event.payload ?? null,
  };

  const serialized = JSON.stringify(envelope);
  let sent = 0;
  for (const connection of connections.values()) {
    safeSend(connection.ws, serialized);
    sent++;
  }
  log.ws.info(`Broadcast -> ${envelope.type}`, {
    exam_id:    envelope.exam_id ?? undefined,
    student_id: envelope.student_id ?? undefined,
    attempt_id: envelope.attempt_id ?? undefined,
    recipients: sent,
  });
}

export function broadcastDemoDataCleared(reason: string): void {
  broadcastRealtimeEvent({
    type: "demo.data.cleared",
    actor_role: "SYSTEM",
    payload: {
      reason,
    },
  });
}

export function broadcastAppUpdateAvailable(payload: Record<string, unknown>): void {
  broadcastRealtimeEvent({
    type: "app.update.available",
    actor_role: "SYSTEM",
    payload,
  });
}

export function broadcastExamRealtime(event: {
  type: string;
  examId: number;
  studentId?: number | null;
  attemptId?: number | null;
  actorRole?: AuthenticatedUser["role"] | "SYSTEM" | null;
  payload?: Record<string, unknown> | null;
}): void {
  broadcastRealtimeEvent({
    type: event.type,
    exam_id: event.examId,
    student_id: event.studentId ?? null,
    attempt_id: event.attemptId ?? null,
    actor_role: event.actorRole ?? null,
    payload: event.payload ?? null,
  });
}

export function broadcastExamRealtimeToUser(userId: number, event: {
  type: string;
  examId: number;
  studentId?: number | null;
  attemptId?: number | null;
  actorRole?: AuthenticatedUser["role"] | "SYSTEM" | null;
  payload?: Record<string, unknown> | null;
}): void {
  const envelope: RealtimeEvent = {
    type: event.type,
    timestamp: new Date().toISOString(),
    exam_id: event.examId,
    student_id: event.studentId ?? null,
    attempt_id: event.attemptId ?? null,
    actor_role: event.actorRole ?? null,
    payload: event.payload ?? null,
  };

  const serialized = JSON.stringify(envelope);
  for (const connection of connections.values()) {
    if (connection.user.id !== userId) {
      continue;
    }
    safeSend(connection.ws, serialized);
  }
}

export function getRealtimeConnectionCount(): number {
  return connections.size;
}

export function readRealtimeMessage(rawData: RawData): string | null {
  if (typeof rawData === "string") {
    return rawData;
  }
  if (rawData instanceof Buffer) {
    return rawData.toString("utf8");
  }
  if (Array.isArray(rawData)) {
    return Buffer.concat(rawData).toString("utf8");
  }
  return null;
}
