const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'prisma', 'dev.db');
console.log('Connecting to database:', DB_PATH);
const db = new DatabaseSync(DB_PATH);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

const targetTables = [
  'exams',
  'exam_sections',
  'exam_section_delivery_rules',
  'questions',
  'question_options',
  'question_media',
  'exam_assignments',
  'exam_attempts',
  'exam_gate_sessions',
  'student_exam_paper_instances',
  'student_exam_paper_questions',
  'student_exam_review_unlocks',
  'exam_attempt_violations',
  'attempt_answers',
  'attempt_section_results',
  'attempt_results',
  'leaderboard_entries',
  'exam_audit_logs'
];

const preservedTables = [
  'question_papers',
  'question_paper_sections',
  'paper_questions',
  'paper_question_options',
  'paper_question_media',
  'question_paper_versions',
  'question_paper_version_sections',
  'question_paper_version_questions',
  'question_paper_version_options',
  'question_paper_version_media',
  'users',
  'student_profiles',
  'teacher_profiles',
  'batches'
];

function getCounts(list) {
  const counts = {};
  for (const table of list) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM [${table}]`).get();
      counts[table] = row.count;
    } catch (err) {
      counts[table] = `ERROR (${err.message})`;
    }
  }
  return counts;
}

console.log('\n--- Checking Initial Row Counts ---');
const beforeTargets = getCounts(targetTables);
const beforePreserved = getCounts(preservedTables);

for (const table of targetTables) {
  console.log(`Target:    ${table.padEnd(35)}: ${beforeTargets[table]}`);
}
for (const table of preservedTables) {
  console.log(`Preserved: ${table.padEnd(35)}: ${beforePreserved[table]}`);
}

console.log('\n--- Purging Test Exam Data ---');
// Deleting all rows in exams will cascade to all other targetTables except exam_audit_logs
const examsDelete = db.prepare('DELETE FROM exams').run();
console.log(`Deleted from 'exams'. Rows changed: ${examsDelete.changes}`);

const logsDelete = db.prepare('DELETE FROM exam_audit_logs').run();
console.log(`Deleted from 'exam_audit_logs'. Rows changed: ${logsDelete.changes}`);

// Run vacuum to optimize database size
console.log('Running VACUUM to reclaim space...');
db.exec('VACUUM;');

console.log('\n--- Checking Final Row Counts ---');
const afterTargets = getCounts(targetTables);
const afterPreserved = getCounts(preservedTables);

let targetPurgedSuccessfully = true;
for (const table of targetTables) {
  const count = afterTargets[table];
  console.log(`Target:    ${table.padEnd(35)}: ${count}`);
  if (typeof count === 'number' && count > 0) {
    targetPurgedSuccessfully = false;
  }
}

let preservedIntact = true;
for (const table of preservedTables) {
  const before = beforePreserved[table];
  const after = afterPreserved[table];
  console.log(`Preserved: ${table.padEnd(35)}: ${after} (Before: ${before})`);
  if (before !== after) {
    preservedIntact = false;
  }
}

console.log('\n--- Purge Status ---');
if (targetPurgedSuccessfully && preservedIntact) {
  console.log('SUCCESS: All test data has been purged, and reusable assets remained completely unchanged!');
} else {
  console.error('WARNING: Verification check did not pass exactly. Please inspect row counts.');
}

db.close();
