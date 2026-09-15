const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILE = path.join(__dirname, 'rmc_pro_database.db');
const db = new sqlite3.Database(DB_FILE);

const testUsers = [
    { username: 'host', password: 'admin123' },
    { username: 'teacher', password: 'teacher123' }
];

db.all('SELECT username, password FROM users WHERE username IN ("host", "teacher")', async (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        for (const user of testUsers) {
            const row = rows.find(r => r.username === user.username);
            if (row) {
                const matches = await bcrypt.compare(user.password, row.password);
                console.log(`User: ${user.username}, Input: ${user.password}, Marches Hash: ${matches}`);
            } else {
                console.log(`User: ${user.username} not found in DB`);
            }
        }
    }
    db.close();
});
