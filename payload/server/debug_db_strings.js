const { createDb, detectDialect } = require('./db_adapter');

async function run() {
    const db = await createDb({ sqliteFile: require('path').join(__dirname, 'rmc_pro_database.db') });
    const dialect = detectDialect();

    console.log(`Dialect: ${dialect}`);

    const studentUid = 'RMC-JEE-3507-PRIYANSH';
    const student = await db.get('SELECT * FROM master_student_index WHERE student_uid = ?', [studentUid]);

    if (!student) {
        console.log('Student not found');
        return;
    }

    console.log('--- Student Data ---');
    console.log(`UID: [${student.student_uid}]`);
    console.log(`Batch Name (from Index): [${student.batch_name}]`);
    console.log(`Hex Batch Name: ${Buffer.from(student.batch_name || '').toString('hex')}`);

    const batches = await db.all('SELECT * FROM batches');
    console.log('--- Batches Table ---');
    batches.forEach(b => {
        console.log(`ID: ${b.id}, Name: [${b.name}], Hex: ${Buffer.from(b.name || '').toString('hex')}`);
    });

    const notices = await db.all('SELECT * FROM notices WHERE target_batch != "ALL"');
    console.log('--- Notices Table (Non-ALL) ---');
    notices.forEach(n => {
        console.log(`ID: ${n.id}, Target: [${n.target_batch}], Hex: ${Buffer.from(n.target_batch || '').toString('hex')}`);
    });

    const materials = await db.all('SELECT m.id, m.title, m.batch_id, b.name as batch_name FROM materials m LEFT JOIN batches b ON m.batch_id = b.id');
    console.log('--- Materials Table ---');
    materials.forEach(m => {
        console.log(`ID: ${m.id}, Title: [${m.title}], Batch ID: ${m.batch_id}, Batch Name (Joined): [${m.batch_name}]`);
    });

    await db.close();
}

run().catch(console.error);
