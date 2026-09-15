const doubtConfig = window.__RMC_DOUBT_CONFIG || {};
const doubtForm = document.getElementById('doubt-form');
const questionText = document.getElementById('question-text');
const questionImage = document.getElementById('question-image');
const cameraStatus = document.getElementById('camera-status');
const openCameraBtn = document.getElementById('btn-open-camera');
const capturePhotoBtn = document.getElementById('btn-capture-photo');
const retakePhotoBtn = document.getElementById('btn-retake-photo');
const questionVideo = document.getElementById('question-video');
const questionCanvas = document.getElementById('question-canvas');
const doubtStatus = document.getElementById('doubt-status');
const doubtHistory = document.getElementById('doubt-history');
const imagePreview = document.getElementById('image-preview');
const cameraCtx = questionCanvas ? questionCanvas.getContext('2d') : null;

let questionStream = null;
let capturedQuestionBlob = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setStatus(message, color = '#93c5fd') {
    if (!doubtStatus) return;
    doubtStatus.textContent = message;
    doubtStatus.style.color = color;
}

function setCameraStatus(message, color = '#93c5fd') {
    if (!cameraStatus) return;
    cameraStatus.textContent = message;
    cameraStatus.style.color = color;
}

function stopQuestionCamera() {
    if (questionStream) {
        questionStream.getTracks().forEach((track) => track.stop());
        questionStream = null;
    }
    if (questionVideo) {
        questionVideo.classList.add('hidden');
        questionVideo.srcObject = null;
    }
}

function showQuestionPreview(src, caption = 'Captured photo') {
    if (!imagePreview) return;
    imagePreview.classList.remove('hidden');
    imagePreview.innerHTML = `
        <div style="padding: 16px;">
            <img src="${escapeHtml(src)}" alt="Question preview" class="doubt-image" style="margin-top:0;">
            <p style="margin-top: 10px; color: var(--text-secondary);">${escapeHtml(caption)}</p>
        </div>
    `;
}

async function startQuestionCamera() {
    try {
        stopQuestionCamera();
        questionStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        if (questionVideo) {
            questionVideo.srcObject = questionStream;
            questionVideo.classList.remove('hidden');
            await questionVideo.play().catch(() => null);
        }
        capturedQuestionBlob = null;
        setCameraStatus('Camera ready. Capture your question photo when ready.');
    } catch (error) {
        setCameraStatus('Camera unavailable. Use Upload Image instead.', '#fca5a5');
        alert(error.message || 'Camera access denied or unavailable.');
    }
}

async function captureQuestionPhoto() {
    if (!questionVideo || !cameraCtx) return;
    if (!questionStream) {
        await startQuestionCamera();
        if (!questionStream) return;
    }

    questionCanvas.width = questionVideo.videoWidth || 1280;
    questionCanvas.height = questionVideo.videoHeight || 720;
    cameraCtx.drawImage(questionVideo, 0, 0, questionCanvas.width, questionCanvas.height);

    const blob = await new Promise((resolve) => {
        questionCanvas.toBlob((value) => resolve(value), 'image/jpeg', 0.92);
    });
    if (!blob) {
        setCameraStatus('Could not capture photo.', '#fca5a5');
        return;
    }

    capturedQuestionBlob = blob;
    const url = URL.createObjectURL(blob);
    showQuestionPreview(url, 'Photo captured. You can retake it if needed.');
    setCameraStatus('Question photo captured.');
    stopQuestionCamera();
}

function retakeQuestionPhoto() {
    capturedQuestionBlob = null;
    if (imagePreview) {
        imagePreview.classList.add('hidden');
        imagePreview.innerHTML = '';
    }
    setCameraStatus('Ready to take a new photo.');
    startQuestionCamera().catch(() => null);
}

function syncQuestionPhotoFallback() {
    const file = questionImage && questionImage.files && questionImage.files[0];
    if (file) {
        capturedQuestionBlob = null;
        const url = URL.createObjectURL(file);
        showQuestionPreview(url, 'Image selected from your device.');
        setCameraStatus('Image selected from your device.');
    }
}

function renderDoubts(rows) {
    if (!doubtHistory) return;
    if (!Array.isArray(rows) || rows.length === 0) {
        doubtHistory.innerHTML = '<p class="msg">No doubts submitted yet.</p>';
        return;
    }

    doubtHistory.innerHTML = rows.map((doubt) => {
        const status = String(doubt.status || 'pending').toLowerCase();
        const badgeClass = ['solved', 'flagged'].includes(status) ? status : 'pending';
        return `
            <article class="doubt-card">
                <div class="doubt-meta">
                    <span>${escapeHtml(new Date(doubt.created_at || Date.now()).toLocaleString())}</span>
                    <span class="doubt-badge ${badgeClass}">${escapeHtml(status.toUpperCase())}</span>
                </div>
                <h4>${escapeHtml(doubt.student_name || doubt.current_name || 'You')}</h4>
                <p>${escapeHtml(doubt.question_text || 'No text provided.')}</p>
                ${doubt.question_image ? `<img class="doubt-image" src="${escapeHtml(doubt.question_image)}" alt="Doubt image">` : ''}
                ${status === 'solved' ? `
                    <div style="margin-top: 12px; color: #4ade80; font-weight: 700;">Teacher marked this doubt as solved.</div>
                    ${doubt.reply_image ? `<img class="doubt-image" src="${escapeHtml(doubt.reply_image)}" alt="Reply image" style="margin-top: 10px;">` : ''}
                ` : status === 'flagged' ? `
                    <div style="margin-top: 12px; color: #f87171; font-weight: 700;">Teacher wants to review this one again.</div>
                ` : `
                    <div style="margin-top: 12px; color: var(--text-secondary);">Waiting for teacher response.</div>
                `}
            </article>
        `;
    }).join('');
}

async function loadDoubts() {
    if (!doubtConfig.studentUid) return;
    try {
        const res = await fetch(`/api/doubts/student/${encodeURIComponent(doubtConfig.studentUid)}`, {
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        });
        const payload = await res.json();
        if (!res.ok || payload.status !== 'success') {
            throw new Error(payload.error || 'Could not load doubts.');
        }
        renderDoubts(payload.doubts || []);
    } catch (error) {
        if (doubtHistory) {
            doubtHistory.innerHTML = `<p class="msg">${escapeHtml(error.message || 'Could not load doubts right now.')}</p>`;
        }
    }
}

async function uploadDoubt(event) {
    event.preventDefault();
    const hasCameraPhoto = Boolean(capturedQuestionBlob);
    const hasFilePhoto = Boolean(questionImage && questionImage.files && questionImage.files[0]);
    if (!questionText || (!questionText.value.trim() && !hasCameraPhoto && !hasFilePhoto)) {
        setStatus('Write a question or attach a photo first.', '#fca5a5');
        return;
    }

    const formData = new FormData();
    formData.append('question_text', questionText.value.trim());
    if (capturedQuestionBlob) {
        formData.append('image', capturedQuestionBlob, `doubt_${Date.now()}.jpg`);
    } else if (questionImage && questionImage.files && questionImage.files[0]) {
        formData.append('image', questionImage.files[0]);
    }

    try {
        setStatus('Sending doubt...', '#93c5fd');
        const res = await fetch('/api/doubts', {
            method: 'POST',
            body: formData
        });
        const payload = await res.json();
        if (!res.ok || payload.status !== 'success') {
            throw new Error(payload.error || 'Could not send doubt.');
        }

        questionText.value = '';
        if (questionImage) questionImage.value = '';
        capturedQuestionBlob = null;
        if (imagePreview) {
            imagePreview.classList.add('hidden');
            imagePreview.innerHTML = '';
        }
        stopQuestionCamera();
        setStatus('Doubt sent successfully.', '#4ade80');
        await loadDoubts();
    } catch (error) {
        setStatus(error.message || 'Could not send doubt.', '#fca5a5');
    }
}

function setupPreview() {
    if (!questionImage || !imagePreview) return;
    questionImage.addEventListener('change', () => {
        capturedQuestionBlob = null;
        syncQuestionPhotoFallback();
    });
}

function connectDoubtNotifications() {
    if (!doubtConfig.studentUid) return;
    const evtSource = new EventSource(`/api/doubts/notifications/${encodeURIComponent(doubtConfig.studentUid)}`);
    evtSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'STATUS_UPDATE' || data.type === 'REPLY') {
                loadDoubts();
            }
        } catch {
            // Ignore malformed heartbeats.
        }
    };
}

doubtForm?.addEventListener('submit', uploadDoubt);
openCameraBtn?.addEventListener('click', startQuestionCamera);
capturePhotoBtn?.addEventListener('click', captureQuestionPhoto);
retakePhotoBtn?.addEventListener('click', retakeQuestionPhoto);
setupPreview();
loadDoubts();
connectDoubtNotifications();
window.addEventListener('beforeunload', stopQuestionCamera);
