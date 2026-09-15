/**
 * rmc-sync.ts
 * Bulk sync of student and staff roster from RMC into the examination identity bridge.
 * Called on-demand via POST /api/identity/rmc-sync (ADMIN only).
 * Safe to re-run — all operations are upserts.
 */

import { fetchRmcStudentRoster, fetchRmcStaffRoster } from "../../shared/rmc-bridge";
import { importStudentRecord, importTeacherRecord } from "./service";
import { log } from "../../shared/logger";

export type SyncResult = {
  students: { synced: number; errors: number };
  staff: { synced: number; errors: number };
  durationMs: number;
};

export async function syncRmcRoster(): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    students: { synced: 0, errors: 0 },
    staff: { synced: 0, errors: 0 },
    durationMs: 0,
  };

  // ── Students ──────────────────────────────────────────────────────────────
  log.system.info("RMC roster sync: fetching students...");
  const students = await fetchRmcStudentRoster();
  log.system.info(`RMC roster sync: ${students.length} students received`);

  for (const s of students) {
    try {
      await importStudentRecord({
        source_system: "rmc",
        source_uid: s.source_uid,
        student_uid: s.student_uid,
        username: s.full_name,
        full_name: s.full_name,
        phone: s.phone ?? undefined,
        batch_name: s.primary_batch ?? "unknown",
        batch_names: s.batches,
        active: s.active,
        photo_url: s.photo_url ?? null,
      });
      result.students.synced++;
    } catch (err) {
      result.students.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      log.system.warn("RMC roster sync: student import error", { uid: s.student_uid, error: msg });
    }
  }

  // ── Staff ─────────────────────────────────────────────────────────────────
  log.system.info("RMC roster sync: fetching staff...");
  const staff = await fetchRmcStaffRoster();
  log.system.info(`RMC roster sync: ${staff.length} staff received`);

  for (const t of staff) {
    try {
      const examRole: "ADMIN" | "TEACHER" = t.rmc_role === "host" ? "ADMIN" : "TEACHER";
      await importTeacherRecord({
        source_system: "rmc",
        source_uid: t.source_uid,
        username: t.username,
        full_name: t.full_name,
        phone: t.phone ?? undefined,
        role: examRole,
        active: t.active,
      });
      result.staff.synced++;
    } catch (err) {
      result.staff.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      log.system.warn("RMC roster sync: staff import error", { username: t.username, error: msg });
    }
  }

  result.durationMs = Date.now() - start;
  log.system.info("RMC roster sync complete", result);
  return result;
}
