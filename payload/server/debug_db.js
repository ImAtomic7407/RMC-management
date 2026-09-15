const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('rmc_pro_database.db');

db.serialize(() => {
    db.all("SELECT count(*) as count FROM notices", (err, rows) => {
        if (err) console.error("Notices Err:", err);
        else console.log("Notices Count:", rows[0].count);
    });
    db.all("SELECT count(*) as count FROM materials", (err, rows) => {
        if (err) console.error("Materials Err:", err);
        else console.log("Materials Count:", rows[0].count);
    });
    db.all("SELECT * FROM notices LIMIT 3", (err, rows) => {
        if (!err) console.log("Sample Notices:", rows);
    });
});
db.close();
