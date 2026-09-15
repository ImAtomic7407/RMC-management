/**
 * server_wide_fix.js
 *
 * Server-wide idempotent repair for the student_uid / identity_bridge bug.
 *
 * Problems this fixes:
 *   1. identity_bridge rows where user_id IS NULL — backfills from student_profiles
 *      (via student_uid match) and teacher_profiles (via username match).
 *   2. Zombie duplicate student user/profile pairs created when a student's RMC
 *      student_uid changed — merges them into the correct (bridge-linked) record.
 *   3. Updates the bridge record's user_id after every merge so future logins
 *      always resolve the right user instantly.
 *
 * Safe to re-run: every operation is idempotent.
 * Run: node server_wide_fix.js
 */

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'prisma', 'dev.db');
console.log('Opening DB:', DB_PATH);
const db = new DatabaseSync(DB_PATH);

// ─── helpers ────────────────────────────────────────────────────────────────
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

let totalFixed = 0;
let totalZombiesRemoved = 0;

// ────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Backfill identity_bridge.user_id for STUDENT rows
//   Strategy: match bridge.source_uid to student_profiles.student_uid
//   (the student_uid stored in the profile IS the source_uid for RMC students)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('PHASE 1: Backfill identity_bridge.user_id (STUDENT rows)');
console.log('══════════════════════════════════════════════');

const studentBridgesMissingUserId = all(`
  SELECT ib.id, ib.source_system, ib.source_uid, ib.display_name
  FROM identity_bridge ib
  WHERE ib.role = 'STUDENT'
    AND ib.user_id IS NULL
`);

console.log(`Found ${studentBridgesMissingUserId.length} STUDENT bridge rows without user_id`);

for (const bridge of studentBridgesMissingUserId) {
  // Try matching by student_uid = source_uid (RMC convention)
  const profile = get(`
    SELECT sp.id, sp.user_id, sp.student_uid
    FROM student_profiles sp
    WHERE sp.student_uid = ?
    LIMIT 1
  `, bridge.source_uid);

  if (profile) {
    run(`UPDATE identity_bridge SET user_id = ? WHERE id = ?`, profile.user_id, bridge.id);
    console.log(`  ✓ bridge[${bridge.id}] source_uid="${bridge.source_uid}" -> user_id=${profile.user_id}`);
    totalFixed++;
  } else {
    // Try matching by display_name similarity (fallback for manual_roster rows)
    const profileByName = get(`
      SELECT sp.id, sp.user_id, u.username, u.full_name
      FROM student_profiles sp
      JOIN users u ON u.id = sp.user_id
      WHERE u.full_name = ?
      LIMIT 1
    `, bridge.display_name);

    if (profileByName) {
      run(`UPDATE identity_bridge SET user_id = ? WHERE id = ?`, profileByName.user_id, bridge.id);
      console.log(`  ✓ bridge[${bridge.id}] source_uid="${bridge.source_uid}" (name match) -> user_id=${profileByName.user_id}`);
      totalFixed++;
    } else {
      console.log(`  ✗ bridge[${bridge.id}] source_uid="${bridge.source_uid}" — no matching profile found (OK if not yet synced)`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Backfill identity_bridge.user_id for TEACHER/ADMIN rows
// ────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('PHASE 2: Backfill identity_bridge.user_id (TEACHER/ADMIN rows)');
console.log('══════════════════════════════════════════════');

const teacherBridgesMissing = all(`
  SELECT ib.id, ib.source_uid, ib.display_name, ib.role
  FROM identity_bridge ib
  WHERE ib.role IN ('TEACHER', 'ADMIN')
    AND ib.user_id IS NULL
`);

console.log(`Found ${teacherBridgesMissing.length} TEACHER/ADMIN bridge rows without user_id`);

for (const bridge of teacherBridgesMissing) {
  // Teachers: source_uid = employee_code OR username
  const profile = get(`
    SELECT tp.user_id
    FROM teacher_profiles tp
    WHERE tp.employee_code = ?
    LIMIT 1
  `, bridge.source_uid);

  if (profile) {
    run(`UPDATE identity_bridge SET user_id = ? WHERE id = ?`, profile.user_id, bridge.id);
    console.log(`  ✓ bridge[${bridge.id}] source_uid="${bridge.source_uid}" -> user_id=${profile.user_id}`);
    totalFixed++;
  } else {
    // Try by display_name = full_name
    const userByName = get(`
      SELECT u.id FROM users u WHERE u.full_name = ? AND u.role IN ('TEACHER','ADMIN') LIMIT 1
    `, bridge.display_name);
    if (userByName) {
      run(`UPDATE identity_bridge SET user_id = ? WHERE id = ?`, userByName.id, bridge.id);
      console.log(`  ✓ bridge[${bridge.id}] source_uid="${bridge.source_uid}" (name match) -> user_id=${userByName.id}`);
      totalFixed++;
    } else {
      console.log(`  ✗ bridge[${bridge.id}] source_uid="${bridge.source_uid}" — no matching teacher profile`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Detect & merge zombie duplicate student profiles
//
// A zombie is: a student_profile that was created because the student_uid
// changed in RMC. There will be TWO profiles for the same real person:
//   - The "real" one: linked via identity_bridge (user_id is now populated)
//   - The "zombie": a second profile with the NEW student_uid but NO bridge link
//
// Detection: for each RMC identity_bridge row that now has a user_id, check
// whether there is ALSO another student_profiles row with the same
// source_uid as student_uid (i.e. the new zombie profile).
// ────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('PHASE 3: Detect & merge zombie duplicate student profiles');
console.log('══════════════════════════════════════════════');

// Find all RMC student bridges where the bridge now has a user_id
// AND there's also a student_profile whose student_uid = bridge.source_uid
// but whose user_id DIFFERS from the bridge's user_id (= zombie).
const zombieCandidates = all(`
  SELECT 
    ib.id         AS bridge_id,
    ib.source_uid AS rmc_source_uid,
    ib.user_id    AS bridge_user_id,
    ib.display_name,
    sp_real.id    AS real_profile_id,
    sp_real.student_uid AS real_student_uid,
    sp_zombie.id  AS zombie_profile_id,
    sp_zombie.user_id AS zombie_user_id,
    sp_zombie.student_uid AS zombie_student_uid
  FROM identity_bridge ib
  JOIN student_profiles sp_real  ON sp_real.user_id  = ib.user_id
  JOIN student_profiles sp_zombie ON sp_zombie.student_uid = ib.source_uid
  WHERE ib.role = 'STUDENT'
    AND ib.user_id IS NOT NULL
    AND sp_zombie.user_id != ib.user_id
`);

console.log(`Found ${zombieCandidates.length} zombie duplicate profile(s)`);

for (const z of zombieCandidates) {
  console.log(`\n  Zombie detected for "${z.display_name}":`);
  console.log(`    Real   profile_id=${z.real_profile_id}  student_uid="${z.real_student_uid}"  user_id=${z.bridge_user_id}`);
  console.log(`    Zombie profile_id=${z.zombie_profile_id} student_uid="${z.zombie_student_uid}" user_id=${z.zombie_user_id}`);

  // Step A: Update real profile's student_uid to the NEW one (source_uid = current RMC uid)
  if (z.real_student_uid !== z.rmc_source_uid) {
    run(`UPDATE student_profiles SET student_uid = ? WHERE id = ?`, z.rmc_source_uid, z.real_profile_id);
    console.log(`    ✓ Updated real profile[${z.real_profile_id}].student_uid to "${z.rmc_source_uid}"`);
  }

  // Step B: Migrate zombie's batch memberships to real profile (that don't already exist)
  const zombieMemberships = all(`
    SELECT batch_id FROM student_batch_memberships WHERE student_id = ?
  `, z.zombie_profile_id);

  for (const m of zombieMemberships) {
    const exists = get(`
      SELECT id FROM student_batch_memberships WHERE student_id = ? AND batch_id = ?
    `, z.real_profile_id, m.batch_id);
    if (!exists) {
      run(`INSERT INTO student_batch_memberships (student_id, batch_id, created_at, updated_at)
           VALUES (?, ?, datetime('now'), datetime('now'))`, z.real_profile_id, m.batch_id);
      console.log(`    ✓ Migrated batch_id=${m.batch_id} membership to real profile`);
    }
  }

  // Step C: Reassign exam_attempts, exam_gate_sessions from zombie to real profile
  const attemptCount = run(`
    UPDATE exam_attempts SET student_id = ? WHERE student_id = ?
  `, z.real_profile_id, z.zombie_profile_id).changes;
  if (attemptCount) console.log(`    ✓ Moved ${attemptCount} exam_attempt(s) to real profile`);

  const gateCount = run(`
    UPDATE exam_gate_sessions SET student_id = ? WHERE student_id = ?
  `, z.real_profile_id, z.zombie_profile_id).changes;
  if (gateCount) console.log(`    ✓ Moved ${gateCount} exam_gate_session(s) to real profile`);

  const paperCount = run(`
    UPDATE student_exam_paper_instances SET student_id = ? WHERE student_id = ?
  `, z.real_profile_id, z.zombie_profile_id).changes;
  if (paperCount) console.log(`    ✓ Moved ${paperCount} paper_instance(s) to real profile`);

  // Step D: Delete zombie's memberships then zombie profile then zombie user
  run(`DELETE FROM student_batch_memberships WHERE student_id = ?`, z.zombie_profile_id);
  run(`DELETE FROM student_profiles WHERE id = ?`, z.zombie_profile_id);
  run(`DELETE FROM users WHERE id = ?`, z.zombie_user_id);
  console.log(`    ✓ Deleted zombie profile[${z.zombie_profile_id}] and zombie user[${z.zombie_user_id}]`);

  totalZombiesRemoved++;
}

// ────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Final verification snapshot
// ────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('PHASE 4: Final verification');
console.log('══════════════════════════════════════════════');

const stillMissing = all(`
  SELECT id, source_system, source_uid, role, display_name
  FROM identity_bridge
  WHERE user_id IS NULL
`);
console.log(`\nBridge rows still without user_id: ${stillMissing.length}`);
if (stillMissing.length > 0) {
  console.log('  (These may be entries for users not yet synced — acceptable)');
  stillMissing.forEach(r =>
    console.log(`  bridge[${r.id}] ${r.source_system}/${r.source_uid} (${r.role}) "${r.display_name}"`)
  );
}

// Verify Satyam Kumar specifically
console.log('\n--- Satyam Kumar final state ---');
const satyamUsers = all(`
  SELECT u.id, u.username, u.full_name, sp.id as profile_id, sp.student_uid, sp.batch_id
  FROM users u
  LEFT JOIN student_profiles sp ON sp.user_id = u.id
  WHERE u.full_name LIKE '%Satyam Kumar%'
  ORDER BY u.id
`);
console.log(JSON.stringify(satyamUsers, null, 2));

const satyamBridges = all(`
  SELECT id, source_uid, display_name, user_id, active
  FROM identity_bridge
  WHERE display_name LIKE '%Satyam Kumar%'
`);
console.log('\n--- Satyam Kumar identity_bridge ---');
console.log(JSON.stringify(satyamBridges, null, 2));

db.close();

console.log('\n══════════════════════════════════════════════');
console.log('REPAIR COMPLETE');
console.log(`  Bridge user_id backfilled:  ${totalFixed}`);
console.log(`  Zombie profiles removed:    ${totalZombiesRemoved}`);
console.log('══════════════════════════════════════════════\n');
