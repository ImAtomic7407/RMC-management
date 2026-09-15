const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = 'a:/RMC_Local_Installer/payload/server/rmc_pro_database.db';
const db = new sqlite3.Database(dbFile);

db.all("SELECT * FROM batch_catalog", [], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log("--- BATCH CATALOG ---");
    console.table(rows);
    
    db.all("SELECT * FROM materials", [], (err2, mRows) => {
        if (err2) {
            console.error(err2);
            process.exit(1);
        }
        console.log("--- MATERIALS ---");
        console.table(mRows);
        
        db.all("SELECT student_uid, batch_name FROM master_student_index LIMIT 5", [], (err3, sRows) => {
            console.log("--- STUDENTS (Top 5) ---");
            console.table(sRows);
            db.close();
        });
    });
});
