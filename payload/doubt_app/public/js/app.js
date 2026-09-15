let studentData = JSON.parse(localStorage.getItem('doubt_student') || 'null');

document.addEventListener('DOMContentLoaded', () => {
    if (studentData) showPortal();
});

function login() {
    const student_uid = document.getElementById('student_uid').value;
    const secure_token = document.getElementById('secure_token').value;

    fetch('/api/auth/student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_uid, secure_token })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            studentData = data.student;
            localStorage.setItem('doubt_student', JSON.stringify(studentData));
            showPortal();
        } else {
            document.getElementById('auth-error').style.display = 'block';
        }
    })
    .catch(err => alert('Login failed: ' + err.message));
}

function logout() {
    localStorage.removeItem('doubt_student');
    location.reload();
}

function showPortal() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('main-portal').style.display = 'block';
    document.getElementById('student-name').innerText = `Welcome, ${studentData.name || 'Student'}`;
    loadHistory();
    initNotifications();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    document.getElementById('file-name').innerText = file ? file.name : 'No file chosen';
}

function submitDoubt() {
    const text = document.getElementById('question-text').value;
    const file = document.getElementById('question-file').files[0];

    if (!text && !file) return alert('Please provide some text or an image.');

    const formData = new FormData();
    formData.append('student_uid', studentData.student_uid);
    formData.append('question_text', text);
    if (file) formData.append('image', file);

    fetch('/api/doubts', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            document.getElementById('question-text').value = '';
            document.getElementById('question-file').value = '';
            document.getElementById('file-name').innerText = 'No file chosen';
            loadHistory();
        }
    })
    .catch(err => alert('Upload failed: ' + err.message));
}

function loadHistory() {
    fetch(`/api/doubts/student/${studentData.student_uid}`)
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById('doubt-list');
        if (data.doubts.length === 0) {
            list.innerHTML = '<div class="glass-card" style="text-align: center; color: var(--text-secondary);">No doubts submitted yet.</div>';
            return;
        }

        list.innerHTML = data.doubts.map(doubt => `
            <div class="glass-card">
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 0.85rem; color: var(--text-secondary);">
                    <span>${new Date(doubt.created_at).toLocaleString()}</span>
                    <span style="color: ${doubt.status === 'replied' ? 'var(--accent-green)' : 'var(--primary)'}">
                        ${doubt.status.toUpperCase()}
                    </span>
                </div>
                <p style="margin-bottom: 16px;">${doubt.question_text || '<i>No text provided</i>'}</p>
                ${doubt.question_image ? `<img src="${doubt.question_image}" style="max-width: 100%; border-radius: 12px; margin-bottom: 16px; border: 1px solid var(--glass-border);">` : ''}
                
                ${doubt.status === 'solved' ? `
                    <div style="border-top: 1px solid var(--glass-border); padding-top: 20px; margin-top: 10px; text-align: center;">
                        <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: rgba(0, 230, 118, 0.1); color: var(--accent-green); font-size: 2rem; margin-bottom: 12px;">
                            <i class="fas fa-check"></i>
                        </div>
                        <h3 style="color: var(--accent-green); margin-bottom: 4px;">Solved</h3>
                        <p style="font-size: 0.8rem; color: var(--text-secondary);">Your doubt has been reviewed and resolved.</p>
                        ${doubt.reply_image ? `<img src="${doubt.reply_image}" style="max-width: 100%; border-radius: 12px; margin-top: 16px; border: 1px solid var(--accent-green);">` : ''}
                    </div>
                ` : doubt.status === 'flagged' ? `
                    <div style="border-top: 1px solid var(--glass-border); padding-top: 20px; margin-top: 10px; text-align: center;">
                        <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; background: rgba(255, 77, 77, 0.1); color: var(--accent-red); font-size: 2rem; margin-bottom: 12px;">
                            <i class="fas fa-times"></i>
                        </div>
                        <h3 style="color: var(--accent-red); margin-bottom: 4px;">Needs Review</h3>
                        <p style="font-size: 0.8rem; color: var(--text-secondary);">Teacher wants to see this doubt again or needs more clarity.</p>
                    </div>
                ` : `
                    <div style="background: rgba(0, 106, 255, 0.05); padding: 12px; border-radius: 12px; border: 1px dashed var(--primary); text-align: center; font-size: 0.9rem; color: var(--text-secondary);">
                        Waiting for teacher...
                    </div>
                `}
            </div>
        `).join('');
    });
}

function initNotifications() {
    const evtSource = new EventSource(`/api/notifications/${studentData.student_uid}`);
    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'REPLY' || data.type === 'STATUS_UPDATE') {
            loadHistory();
            // Show simple alert or custom toast
            if (Notification.permission === "granted") {
                const msg = data.status === 'solved' ? "Your doubt is solved! ✅" : "Teacher marked your doubt for review. ❌";
                new Notification("RMC Doubt Portal", { body: msg });
            }
        }
    };
}

if (Notification.permission !== "granted") {
    Notification.requestPermission();
}
