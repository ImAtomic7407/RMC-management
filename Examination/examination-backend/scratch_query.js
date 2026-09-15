const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'prisma', 'dev.db');
const db = new DatabaseSync(DB_PATH);

console.log('\n--- Satyam Kumar Users & Profiles ---');
const matchingUsers = db.prepare(`
  SELECT u.id, u.username, u.full_name, sp.id as profile_id, sp.student_uid, sp.batch_id, sp.active as profile_active
  FROM users u
  LEFT JOIN student_profiles sp ON sp.user_id = u.id
  WHERE u.full_name LIKE '%Satyam%'
`).all();
console.log(matchingUsers);

db.close();
