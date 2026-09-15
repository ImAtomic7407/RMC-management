/**
 * Exam lifecycle scheduler.
 *
 * Runs every 30 seconds and handles two automatic transitions:
 *   SCHEDULED → LIVE   when exam_date_time has passed
 *   LIVE      → CLOSED when started_at + duration_seconds has passed
 *
 * Both transitions broadcast a WebSocket "exam.updated" event so connected
 * Android clients react in real-time without polling.
 */

import { prisma } from "./prisma";
import { broadcastExamRealtime } from "./realtime";
import { log } from "./logger";
import { recalculateAttemptResult } from "../modules/results/service";
import { syncRmcRoster } from "../modules/identity/rmc-sync";

const TICK_MS = 30_000;

// ── Auto-start: SCHEDULED → LIVE ─────────────────────────────────────────────

async function autoStartDueExams(): Promise<void> {
  const now = new Date();

  const due = await prisma.exams.findMany({
    where: {
      status: "SCHEDULED",
      exam_date_time: { lte: now },
      question_paper_version_id: { not: null },
    },
    select: { id: true, title: true },
  });

  for (const exam of due) {
    try {
      const updated = await prisma.exams.update({
        where: { id: exam.id },
        data: {
          status: "LIVE",
          started_at: now,
          updated_by: null,
        },
      });

      log.system.info("Scheduler: exam auto-started", {
        exam_id: exam.id,
        title: exam.title,
      });

      broadcastExamRealtime({
        type: "exam.updated",
        examId: exam.id,
        actorRole: "SYSTEM",
        payload: {
          action: "started",
          status: updated.status,
          started_at: updated.started_at?.toISOString() ?? null,
          auto: true,
        },
      });
    } catch (err) {
      log.system.error("Scheduler: failed to auto-start exam", {
        exam_id: exam.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Auto-close: LIVE → CLOSED when duration elapsed ──────────────────────────

async function autoCloseLapsedExams(): Promise<void> {
  const now = new Date();

  const live = await prisma.exams.findMany({
    where: { status: "LIVE", started_at: { not: null } },
    select: { id: true, title: true, started_at: true, duration_seconds: true },
  });

  const expired = live.filter((e) => {
    if (!e.started_at) return false;
    const endTime = new Date(e.started_at.getTime() + e.duration_seconds * 1000);
    return endTime <= now;
  });

  for (const exam of expired) {
    try {
      // Auto-submit any still-open attempts
      const openAttempts = await prisma.exam_attempts.findMany({
        where: {
          exam_id: exam.id,
          status: { notIn: ["SUBMITTED", "AUTO_SUBMITTED", "CANCELLED"] },
        },
        select: { id: true, status: true, attempt_result: { select: { id: true } } },
      });

      for (const attempt of openAttempts) {
        try {
          // Conditional update: only auto-submit if the attempt is STILL open.
          // A student may have legitimately submitted in the window between the
          // findMany above and this write — guarding on status prevents the
          // scheduler from clobbering a real SUBMITTED into AUTO_SUBMITTED.
          const res = await prisma.exam_attempts.updateMany({
            where: {
              id: attempt.id,
              status: { notIn: ["SUBMITTED", "AUTO_SUBMITTED", "CANCELLED"] },
            },
            data: {
              status: "AUTO_SUBMITTED",
              submitted_at: now,
              is_auto_submitted: true,
              updated_at: now,
            },
          });
          // Only (re)calculate if WE auto-submitted it here. If the student won
          // the race (res.count === 0), their own submit flow owns the result.
          if (res.count > 0 && !attempt.attempt_result) {
            await recalculateAttemptResult(prisma, attempt.id);
          }
        } catch (attemptErr) {
          // Isolate per-attempt failures so the exam still closes and other attempts are processed.
          // ensureAttemptResultsForRelease() will patch any missing results before result release.
          log.system.error("Scheduler: failed to auto-submit attempt", {
            exam_id: exam.id,
            attempt_id: attempt.id,
            error: attemptErr instanceof Error ? attemptErr.message : String(attemptErr),
          });
        }
      }

      // Transition exam to CLOSED
      await prisma.exams.update({
        where: { id: exam.id },
        data: { status: "CLOSED", closed_at: now, updated_by: null },
      });

      log.system.info("Scheduler: exam auto-closed", {
        exam_id: exam.id,
        title: exam.title,
        auto_submitted: openAttempts.length,
      });

      broadcastExamRealtime({
        type: "exam.updated",
        examId: exam.id,
        actorRole: "SYSTEM",
        payload: {
          action: "closed",
          status: "CLOSED",
          auto: true,
          auto_submitted_count: openAttempts.length,
        },
      });
    } catch (err) {
      log.system.error("Scheduler: failed to auto-close exam", {
        exam_id: exam.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

let lastSyncTime = 0;
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function tick(): Promise<void> {
  await autoStartDueExams();
  await autoCloseLapsedExams();

  const now = Date.now();
  if (now - lastSyncTime >= SYNC_INTERVAL_MS) {
    lastSyncTime = now;
    void syncRmcRoster().catch((err) => {
      log.system.error("Scheduler: background RMC roster sync failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startExamScheduler(): void {
  if (_timer) return;
  // Run once immediately so there's no 30-second gap on restart
  void tick();
  _timer = setInterval(() => void tick(), TICK_MS);
  log.system.info("Exam scheduler started (30s tick)");
}

export function stopExamScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
