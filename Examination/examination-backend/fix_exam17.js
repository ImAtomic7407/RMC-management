/**
 * fix_exam17.js — uses Node.js v22+ built-in sqlite (no npm install needed)
 * Run: node fix_exam17.js
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'prisma', 'dev.db');
console.log('Opening:', DB_PATH);

const db = new DatabaseSync(DB_PATH);

// Show current state
const exam = db.prepare('SELECT id, title, status, batch_id FROM exams WHERE id=17').get();
console.log('\nExam 17 before fix:', exam);

const existing = db.prepare('SELECT * FROM exam_assignments WHERE exam_id=17').all();
console.log('Existing assignments for exam 17:', existing);

const now = Date.now();

// 1. Add exam_assignment for batch 3 if missing
const hasBatch3 = existing.some(a => a.batch_id === 3);
if (!hasBatch3) {
  db.prepare(`
    INSERT INTO exam_assignments (exam_id, batch_id, student_uid, visible_from, visible_until, created_at, created_by)
    VALUES (17, 3, NULL, NULL, NULL, ${now}, 2)
  `).run();
  console.log('\n✓ Created exam_assignment: exam 17 → batch 3');
} else {
  console.log('\n✓ exam_assignment batch-3 already exists');
}

// 2. Set batch_id=3 on the exam row
db.prepare(`UPDATE exams SET batch_id=3, updated_at=${now} WHERE id=17`).run();

// Verify
const afterExam = db.prepare('SELECT id, title, status, batch_id FROM exams WHERE id=17').get();
const afterAssignments = db.prepare('SELECT * FROM exam_assignments WHERE exam_id=17').all();
console.log('\nExam 17 after fix:', afterExam);
console.log('Assignments after fix:', afterAssignments);

// Show what students in batch 3 look like
const batch3Students = db.prepare(`
  SELECT u.id, u.username, u.full_name, sp.batch_id
  FROM users u
  JOIN student_profiles sp ON sp.user_id = u.id
  WHERE sp.batch_id = 3
  LIMIT 5
`).all();
console.log('\nSample students in batch 3:', batch3Students);

db.close();

console.log('\n==============================');
console.log('Now restart the exam server:');
console.log('  pm2 restart exam-server');
console.log('==============================');
