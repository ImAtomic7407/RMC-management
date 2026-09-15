/**
 * delete_all_exams_except_testing_final.js
 *
 * Permanently removes all exams EXCEPT id=36 ("Testing Final") and every
 * child record linked to them (cascade: exam_assignments, exam_attempts,
 * attempt_answers, attempt_results, leaderboard_entries, exam_gate_sessions,
 * student_exam_paper_instances, questions, exam_sections, etc.)
 *
 * Safe to re-run (idempotent).
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'prisma', 'dev.db');
console.log('Opening DB:', DB_PATH);
const db = new DatabaseSync(DB_PATH);

// Enable FK enforcement so ON DELETE CASCADE fires
db.exec('PRAGMA foreign_keys = ON;');

// Verify FK enforcement is active
const fkCheck = db.prepare('PRAGMA foreign_keys').get();
console.log('FK enforcement:', fkCheck.foreign_keys === 1 ? 'ON ✓' : 'OFF ✗');

// ── 1. Show what we're about to delete ──────────────────────────────────────
const toDelete = db.prepare(`
  SELECT id, title, status FROM exams WHERE id != 36 ORDER BY id
`).all();

console.log(`\nExams to be DELETED (${toDelete.length}):`);
toDelete.forEach(e => console.log(`  [${e.id}] "${e.title}" (${e.status})`));

const keeper = db.prepare(`SELECT id, title, status FROM exams WHERE id = 36`).get();
console.log(`\nExam to KEEP:`);
console.log(`  [${keeper.id}] "${keeper.title}" (${keeper.status})`);

if (toDelete.length === 0) {
  console.log('\nNothing to delete. Exiting.');
  db.close();
  process.exit(0);
}

// ── 2. Count child rows before deletion ─────────────────────────────────────
const examIds = toDelete.map(e => e.id);
const placeholders = examIds.map(() => '?').join(',');

function count(table, col = 'exam_id') {
  return db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${col} IN (${placeholders})`).get(...examIds).c;
}

console.log('\nChild rows that will cascade-delete:');
console.log(`  exam_assignments:            ${count('exam_assignments')}`);
console.log(`  exam_sections:               ${count('exam_sections')}`);
console.log(`  exam_section_delivery_rules: ${count('exam_section_delivery_rules')}`);
console.log(`  questions:                   ${count('questions')}`);
console.log(`  exam_attempts:               ${count('exam_attempts')}`);
console.log(`  practice_question_attempts:  ${count('practice_question_attempts')}`);
console.log(`  exam_gate_sessions:          ${count('exam_gate_sessions')}`);
console.log(`  student_exam_paper_instances:${count('student_exam_paper_instances')}`);
console.log(`  student_exam_review_unlocks: ${count('student_exam_review_unlocks')}`);
console.log(`  exam_audit_logs (entity):    ${
  db.prepare(`SELECT COUNT(*) as c FROM exam_audit_logs WHERE entity_type = 'exam' AND entity_id IN (${placeholders})`).get(...examIds.map(String)).c
}`);

// ── 3. Delete (cascade handles children) ────────────────────────────────────
console.log('\nDeleting...');

const result = db.prepare(
  `DELETE FROM exams WHERE id IN (${placeholders})`
).run(...examIds);

console.log(`✓ Deleted ${result.changes} exam(s) + all cascaded child rows`);

// ── 4. Verify only Testing Final remains ────────────────────────────────────
console.log('\nRemaining exams:');
const remaining = db.prepare(`SELECT id, title, status FROM exams ORDER BY id`).all();
remaining.forEach(e => console.log(`  [${e.id}] "${e.title}" (${e.status})`));

if (remaining.length === 1 && remaining[0].id === 36) {
  console.log('\n✅ Only "Testing Final" remains — all others deleted successfully.');
} else {
  console.log('\n⚠️  Unexpected state — check remaining exams above.');
}

db.close();
