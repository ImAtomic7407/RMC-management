const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'prisma', 'dev.db');
const db = new DatabaseSync(DB_PATH);

const log = db.prepare(`SELECT * FROM exam_audit_logs WHERE id = 2408`).get();
console.log('Log 2408:', log);

db.close();
