// Replicate listStudentExams filter
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'prisma', 'dev.db');
const db = new DatabaseSync(DB_PATH);

const STUDENT_VISIBLE_EXAM_STATUSES = ["SCHEDULED", "LIVE", "PUBLISHED", "CLOSED", "RESULT_RELEASED"];

function examAssignmentWhere(student) {
  const batchIds = Array.from(new Set([student.batch_id, ...(student.batch_memberships ?? []).map((membership) => membership.batch_id)]));
  return {
    batchIds,
    student_uid: student.student_uid
  };
}

const students = db.prepare(`
  SELECT sp.id, sp.user_id, sp.student_uid, sp.batch_id, u.full_name, u.username
  FROM student_profiles sp
  JOIN users u ON u.id = sp.user_id
  WHERE u.full_name LIKE '%Satyam%'
`).all();

for (const student of students) {
  // Load memberships
  const memberships = db.prepare(`
    SELECT batch_id FROM student_batch_memberships WHERE student_id = ?
  `).all(student.id);
  student.batch_memberships = memberships;

  const where = examAssignmentWhere(student);
  
  // Find exams where status is in STUDENT_VISIBLE_EXAM_STATUSES AND (exam_assignments has batch_id in batchIds OR student_uid = student.student_uid)
  // Let's query this in SQL:
  const query = `
    SELECT e.id, e.title, e.status, e.batch_id
    FROM exams e
    LEFT JOIN exam_assignments ea ON ea.exam_id = e.id
    WHERE e.status IN ('SCHEDULED', 'LIVE', 'PUBLISHED', 'CLOSED', 'RESULT_RELEASED')
      AND (
        ea.batch_id IN (${where.batchIds.join(',')})
        OR ea.student_uid = ?
      )
    GROUP BY e.id
  `;
  const exams = db.prepare(query).all(where.student_uid);
  console.log(`\nUser: ${student.full_name} (${student.username})`);
  console.log(`Student UID: ${student.student_uid}, Batch: ${student.batch_id}, Memberships: ${where.batchIds.join(',')}`);
  console.log('Visible Exams:', exams);
}

db.close();
