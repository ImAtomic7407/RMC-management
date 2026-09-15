const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('a:/RMC_Local_Installer/payload/server/rmc_pro_database.db');

db.serialize(() => {
    console.log('--- STUDENT INFO ---');
    db.each("SELECT student_uid, name, batch_name FROM master_student_index WHERE student_uid = 'RMC-JEE-3507-PRIYANSH'", (err, row) => {
        if (err) console.error(err);
        console.log(row);
    });

    console.log('--- BATCHES ---');
    db.each("SELECT * FROM batches", (err, row) => {
        if (err) console.error(err);
        console.log(row);
    });

    console.log('--- NOTICES ---');
    db.each("SELECT * FROM notices", (err, row) => {
        if (err) console.error(err);
        console.log(row);
    });

    console.log('--- MATERIALS ---');
    db.each("SELECT * FROM materials", (err, row) => {
        if (err) console.error(err);
        console.log(row);
    });
});
