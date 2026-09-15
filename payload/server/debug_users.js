const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILE = path.join(__dirname, 'rmc_pro_database.db');
const db = new sqlite3.Database(DB_FILE);

db.all('SELECT id, username, role, password FROM users', (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Users in database:');
        rows.forEach(row => {
            console.log(`ID: ${row.id}, Username: ${row.username}, Role: ${row.role}, PasswordHash: ${row.password}`);
        });
    }
    db.close();
});
