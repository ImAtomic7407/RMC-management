let teacherData = JSON.parse(localStorage.getItem('doubt_teacher') || 'null');
let activeDoubtId = null;

document.addEventListener('DOMContentLoaded', () => {
    if (teacherData) showDashboard();
});

function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    fetch('/api/auth/teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            teacherData = data.user;
            localStorage.setItem('doubt_teacher', JSON.stringify(teacherData));
            showDashboard();
        } else {
            document.getElementById('auth-error').style.display = 'block';
        }
    })
    .catch(err => alert('Login failed: ' + err.message));
}

function showDashboard() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('dashboard').style.display = 'grid';
    loadPendingDoubts();
}

function loadPendingDoubts() {
    fetch('/api/doubts/pending')
    .then(res => res.json())
    .then(data => {
        const list = document.getElementById('pending-list');
        if (data.doubts.length === 0) {
            list.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 40px 0;">No pending doubts!</div>';
            return;
        }

        list.innerHTML = data.doubts.map(doubt => `
            <div class="glass-card pending-card ${activeDoubtId == doubt.id ? 'active' : ''}" onclick='selectDoubt(${JSON.stringify(doubt).replace(/'/g, "&apos;")})'>
                <div style="font-size: 0.8rem; color: var(--primary); margin-bottom: 8px;">ID: #${doubt.id} • ${new Date(doubt.created_at).toLocaleTimeString()}</div>
                <div style="font-size: 0.9rem; font-weight: 500; margin-bottom: 8px;">${doubt.student_uid}</div>
                <p style="font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${doubt.question_text || 'No text'}
                </p>
                ${doubt.question_image ? '<div style="margin-top: 10px; font-size: 0.75rem; color: var(--primary);"><i class="fas fa-image"></i> Photo Attached</div>' : ''}
            </div>
        `).join('');
    });
}

function selectDoubt(doubt) {
    activeDoubtId = doubt.id;
    
    // UI Transitions
    document.getElementById('no-selection').style.display = 'none';
    document.getElementById('detail-area').style.display = 'flex';
    
    // Set Content
    document.getElementById('view-student-id').innerText = doubt.student_uid;
    document.getElementById('view-timestamp').innerText = new Date(doubt.created_at).toLocaleString();
    document.getElementById('view-id-badge').innerText = `Doubt #${doubt.id}`;
    document.getElementById('view-question-text').innerText = doubt.question_text || "No description provided.";
    
    if (doubt.question_image) {
        document.getElementById('view-image-container').style.display = 'block';
        document.getElementById('view-question-image').src = doubt.question_image;
    } else {
        document.getElementById('view-image-container').style.display = 'none';
    }

    loadPendingDoubts();
}

function updateStatus(status) {
    if (!activeDoubtId) return;
    
    fetch(`/api/doubts/status/${activeDoubtId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            // Show brief animation or toast?
            activeDoubtId = null;
            document.getElementById('detail-area').style.display = 'none';
            document.getElementById('no-selection').style.display = 'flex';
            loadPendingDoubts();
        } else {
            alert('Failed to update status: ' + data.error);
        }
    })
    .catch(err => alert('Error: ' + err.message));
}

// Refresh list every 30 seconds
setInterval(loadPendingDoubts, 30000);
