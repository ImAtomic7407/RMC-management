import http from "node:http";
import os from "node:os";
import { createApp } from "./app";
import "./config/env";
import { prisma } from "./shared/prisma";
import { WebSocketServer } from "ws";
import { acceptRealtimeConnection } from "./shared/realtime";
import { log } from "./shared/logger";
import { startExamScheduler, stopExamScheduler } from "./shared/exam-scheduler";
import { jwtKeyStore } from "./shared/jwt-keystore";

// Initialize the persistent JWT keystore before anything else touches auth.
// This must run synchronously before the first HTTP request can arrive.
jwtKeyStore.init(process.env.JWT_KEYSTORE_PATH);

const port = Number(process.env.PORT ?? 4200);
const host = process.env.HOST ?? "0.0.0.0";
const app = createApp();
const server = http.createServer(app);

// ── Receiving-side hardening (the missing half of the body-timeout fix) ──────
// The bridge (rmc-bridge.ts) and the RMC /exam proxy both already disable Nagle
// and force fresh connections on the *sending* side. This is the same fix for
// the *receiving* side of examination-backend, where it was missing.
//
// Two failure modes this addresses:
//   1. Keep-alive reuse race. Pooled HTTP clients (Android OkHttp keeps sockets
//      for ~5 min; cloudflared; the loopback proxy) reuse a connection that Node
//      silently closed at its default keepAliveTimeout of 5s. The client writes
//      request headers onto a half-closed socket and the POST body is dropped —
//      the server sees headers (Content-Length set) but no body bytes ever
//      arrive → "[RECV] BODY TIMEOUT". Raising keepAliveTimeout well past the
//      client's idle window, with headersTimeout strictly greater, closes the race.
//   2. Nagle + delayed-ACK deadlock on the Windows loopback interface, the exact
//      bug the proxy/bridge comments call out. setNoDelay(true) on every inbound
//      socket flushes small segments immediately instead of holding them for an
//      ACK that never comes until the body is seen.
//
// Node requires headersTimeout > keepAliveTimeout; otherwise a connection idling
// near the boundary can be torn down mid-request.
server.keepAliveTimeout = 75_000; // ms — longer than typical pooled-client idle reuse
server.headersTimeout = 80_000; // ms — MUST exceed keepAliveTimeout
server.requestTimeout = 0; // don't abort slow bodies arriving over the tunnel
server.on("connection", (socket) => {
  socket.setNoDelay(true); // disable Nagle on inbound sockets (loopback + LAN)
});

// Return a clean 400 for half-open / malformed requests instead of letting the
// socket hang, so a botched keep-alive reuse fails fast rather than stalling.
server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
  log.system.warn("HTTP clientError", { code: err.code, message: err.message });
  if (socket.writable && !socket.destroyed) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  } else {
    socket.destroy();
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request, socket, head) => {
  try {
    const requestUrl = request.url ?? "/";
    const url = new URL(requestUrl, "http://localhost");
    if (url.pathname !== "/ws") {
      log.ws.warn("Rejected upgrade for unknown path", { path: url.pathname });
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, async (ws) => {
      const ip = request.socket.remoteAddress ?? "unknown";
      const accepted = await acceptRealtimeConnection(request, ws);
      if (!accepted) {
        log.ws.warn("WebSocket connection rejected (auth failed)", { ip });
        try {
          ws.close(4401, "Unauthorized");
        } catch {
          // ignore
        }
        return;
      }
      log.ws.info("WebSocket client connected", { ip });
      ws.on("close", (code, reason) => {
        log.ws.info("WebSocket client disconnected", {
          ip,
          code,
          reason: reason.toString() || "none",
        });
      });
      ws.on("error", (err) => {
        log.ws.error("WebSocket error", { ip, error: err.message });
      });
      wss.emit("connection", ws, request);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.ws.error("Upgrade handler threw", { error: msg });
    socket.destroy();
  }
});

server.listen(port, host, () => {
  const lanAddresses = getLanAddresses();
  const networkUrls = lanAddresses.length > 0
    ? lanAddresses.map((ip) => "http://" + ip + ":" + port).join(", ")
    : "n/a";
  const wsUrl = "ws://localhost:" + port + "/ws";
  log.system.info("examination-backend started");
  log.system.info("Local            -> http://localhost:" + port);
  log.system.info("Network          -> " + networkUrls);
  log.system.info("Android emulator -> http://10.0.2.2:" + port);
  log.system.info("WebSocket        -> " + wsUrl);

  startExamScheduler();
});

async function shutdown(signal: string): Promise<void> {
  log.system.info("Received " + signal + " -- graceful shutdown initiated...");
  stopExamScheduler();
  // Stop accepting new connections; let in-flight requests finish (max 15s).
  server.close(async () => {
    log.system.info("HTTP server closed — no more new connections.");
    await prisma.$disconnect();
    log.system.info("Shutdown complete.");
    process.exit(0);
  });
  // Force-exit if graceful drain takes too long (PM2 kill_timeout covers this,
  // but we add our own safety net so the process never hangs indefinitely).
  setTimeout(() => {
    log.system.warn("Graceful shutdown timeout — forcing exit.");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses];
}
