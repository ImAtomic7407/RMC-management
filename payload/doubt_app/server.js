const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { createDb } = require('./db_adapter');
require('dotenv').config();

const app = express();
const PORT = 4000;

// Shared DB path
const DB_FILE = path.join(__dirname, '../server/rmc_pro_database.db');
const UPLOADS_DIR = path.join(__dirname, 'public/uploads');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// DB initialization
let db;
async function startServer() {
    db = await createDb({ sqliteFile: DB_FILE });
    await initDoubtSchema();
    
    app.listen(PORT, () => {
        console.log(`Doubt App running at http://localhost:${PORT}`);
    });
}

async function initDoubtSchema() {
    await db.run(`
        CREATE TABLE IF NOT EXISTS doubts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_uid TEXT NOT NULL,
            question_text TEXT,
            question_image TEXT,
            reply_image TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            replied_at DATETIME
        )
    `);
}


// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.path.includes('reply') ? 'replies' : 'doubts';
        cb(null, path.join(UPLOADS_DIR, type));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// Notifications (SSE)
const clients = new Map(); // student_uid -> [res]

app.get('/api/notifications/:student_uid', (req, res) => {
    const { student_uid } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!clients.has(student_uid)) clients.set(student_uid, []);
    clients.get(student_uid).push(res);

    req.on('close', () => {
        const list = clients.get(student_uid) || [];
        clients.set(student_uid, list.filter(c => c !== res));
    });
});

function notifyStudent(student_uid, data) {
    const list = clients.get(student_uid) || [];
    list.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

// Auth Student
app.post('/api/auth/student', async (req, res) => {
    const { student_uid, secure_token } = req.body;
    try {
        // Find student by UID
        const student = await db.get('SELECT * FROM master_student_index WHERE student_uid = ?', [student_uid]);
        
        if (student) {
            // Allow login if input token matches secure_token, login_token, OR phone
            if (secure_token === student.secure_token || 
                secure_token === student.login_token || 
                secure_token === student.phone) {
                res.json({ status: 'success', student });
            } else {
                res.status(401).json({ status: 'error', error: 'Invalid UID or Token/Phone' });
            }
        } else {
            res.status(401).json({ status: 'error', error: 'Student not found.' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Auth Teacher
app.post('/api/auth/teacher', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.get('SELECT * FROM users WHERE username = ? AND (role = "teacher" OR role = "host")', [username]);
        if (user) {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                res.json({ status: 'success', user: { id: user.id, username: user.username, full_name: user.full_name } });
            } else {
                res.status(401).json({ status: 'error', error: 'Invalid password' });
            }
        } else {
            res.status(401).json({ status: 'error', error: 'User not found or not a teacher' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Submit Doubt
app.post('/api/doubts', upload.single('image'), async (req, res) => {
    const { student_uid, question_text } = req.body;
    const question_image = req.file ? `/uploads/doubts/${req.file.filename}` : null;
    
    try {
        const result = await db.run(
            'INSERT INTO doubts (student_uid, question_text, question_image) VALUES (?, ?, ?)',
            [student_uid, question_text, question_image]
        );
        res.json({ status: 'success', id: result.lastID });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Get Doubt History (Student)
app.get('/api/doubts/student/:student_uid', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM doubts WHERE student_uid = ? ORDER BY created_at DESC', [req.params.student_uid]);
        res.json({ status: 'success', doubts: rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Get Pending Doubts (Teacher)
app.get('/api/doubts/pending', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM doubts WHERE status = "pending" ORDER BY created_at ASC');
        res.json({ status: 'success', doubts: rows });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Update Doubt Status (TICK/CROSS)
app.post('/api/doubts/status/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'solved' or 'flagged'
    
    try {
        const doubt = await db.get('SELECT student_uid FROM doubts WHERE id = ?', [id]);
        if (!doubt) return res.status(404).json({ status: 'error', error: 'Doubt not found' });

        await db.run(
            'UPDATE doubts SET status = ?, replied_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, id]
        );
        
        notifyStudent(doubt.student_uid, { type: 'STATUS_UPDATE', doubt_id: id, status });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Legacy/Reply endpoint (Updated to be status-compatible)
app.post('/api/doubts/reply/:id', upload.single('reply_image'), async (req, res) => {
    const { id } = req.params;
    const reply_image = req.file ? `/uploads/replies/${req.file.filename}` : null;
    
    try {
        const doubt = await db.get('SELECT student_uid FROM doubts WHERE id = ?', [id]);
        if (!doubt) return res.status(404).json({ status: 'error', error: 'Doubt not found' });

        await db.run(
            'UPDATE doubts SET reply_image = ?, status = "solved", replied_at = CURRENT_TIMESTAMP WHERE id = ?',
            [reply_image, id]
        );
        
        notifyStudent(doubt.student_uid, { type: 'REPLY', doubt_id: id, status: 'solved' });
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

startServer();
