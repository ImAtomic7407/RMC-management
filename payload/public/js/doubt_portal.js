const pendingList = document.getElementById('pending-list');
const noSelection = document.getElementById('no-selection');
const detailArea = document.getElementById('detail-area');
const detailName = document.getElementById('detail-name');
const detailMeta = document.getElementById('detail-meta');
const detailBadge = document.getElementById('detail-badge');
const detailQuestion = document.getElementById('detail-question');
const detailImageWrap = document.getElementById('detail-image-wrap');
const detailImage = document.getElementById('detail-image');
const detailBatch = document.getElementById('detail-batch');
const detailPhone = document.getElementById('detail-phone');
const detailCreated = document.getElementById('detail-created');
const detailStatus = document.getElementById('detail-status');
const pendingCount = document.getElementById('pending-count');
const replyCameraStatus = document.getElementById('reply-camera-status');
const openReplyCameraBtn = document.getElementById('btn-open-reply-camera');
const captureReplyPhotoBtn = document.getElementById('btn-capture-reply-photo');
const retakeReplyPhotoBtn = document.getElementById('btn-retake-reply-photo');
const replyImageInput = document.getElementById('reply-image-input');
const replyVideo = document.getElementById('reply-video');
const replyCanvas = document.getElementById('reply-canvas');
const replyPreview = document.getElementById('reply-preview');
const replyCtx = replyCanvas ? replyCanvas.getContext('2d') : null;

let activeDoubtId = null;
let pendingDoubts = [];
let replyStream = null;
let capturedReplyBlob = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setReplyStatus(message, color = '#93c5fd') {
    if (!replyCameraStatus) return;
    replyCameraStatus.textContent = message;
    replyCameraStatus.style.color = color;
}

function stopReplyCamera() {
    if (replyStream) {
        replyStream.getTracks().forEach((track) => track.stop());
        replyStream = null;
    }
    if (replyVideo) {
        replyVideo.classList.add('hidden');
        replyVideo.srcObject = null;
    }
}

function showReplyPreview(src, caption = 'Captured solution photo') {
    if (!replyPreview) return;
    replyPreview.classList.remove('hidden');
    replyPreview.innerHTML = `
        <div style="padding: 16px;">
            <img src="${escapeHtml(src)}" alt="Solution preview" class="doubt-image" style="margin-top:0;">
            <p style="margin-top: 10px; color: var(--text-secondary);">${escapeHtml(caption)}</p>
        </div>
    `;
}

async function startReplyCamera() {
    try {
        stopReplyCamera();
        replyStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
        });
        if (replyVideo) {
            replyVideo.srcObject = replyStream;
            replyVideo.classList.remove('hidden');
            await replyVideo.play().catch(() => null);
        }
        capturedReplyBlob = null;
        setReplyStatus('Camera ready. Capture the solution photo when ready.');
    } catch (error) {
        setReplyStatus('Camera unavailable. Use Upload Image instead.', '#fca5a5');
        alert(error.message || 'Camera access denied or unavailable.');
    }
}

async function captureReplyPhoto() {
    if (!replyVideo || !replyCtx) return;
    if (!replyStream) {
        await startReplyCamera();
        if (!replyStream) return;
    }

    replyCanvas.width = replyVideo.videoWidth || 1280;
    replyCanvas.height = replyVideo.videoHeight || 720;
    replyCtx.drawImage(replyVideo, 0, 0, replyCanvas.width, replyCanvas.height);

    const blob = await new Promise((resolve) => {
        replyCanvas.toBlob((value) => resolve(value), 'image/jpeg', 0.92);
    });
    if (!blob) {
        setReplyStatus('Could not capture photo.', '#fca5a5');
        return;
    }

    capturedReplyBlob = blob;
    const url = URL.createObjectURL(blob);
    showReplyPreview(url, 'Solution photo captured. Use it when marking solved.');
    setReplyStatus('Solution photo captured.');
    stopReplyCamera();
}

function retakeReplyPhoto() {
    capturedReplyBlob = null;
    if (replyPreview) {
        replyPreview.classList.add('hidden');
        replyPreview.innerHTML = '';
    }
    setReplyStatus('Ready to take a new solution photo.');
    startReplyCamera().catch(() => null);
}

function syncReplyFallback() {
    const file = replyImageInput && replyImageInput.files && replyImageInput.files[0];
    if (!file) return;
    capturedReplyBlob = null;
    const url = URL.createObjectURL(file);
    showReplyPreview(url, 'Solution image selected from your device.');
    setReplyStatus('Solution image selected from your device.');
}

function renderPendingList() {
    if (!pendingList) return;
    if (!pendingDoubts.length) {
        pendingList.innerHTML = '<p class="msg">No pending doubts right now.</p>';
        if (pendingCount) pendingCount.textContent = '0 pending';
        return;
    }

    if (pendingCount) pendingCount.textContent = `${pendingDoubts.length} pending`;
    pendingList.innerHTML = pendingDoubts.map((doubt) => `
        <article class="doubt-card ${activeDoubtId === doubt.id ? 'active' : ''}" onclick="selectDoubt(${doubt.id})">
            <div class="meta">
                <span>#${escapeHtml(doubt.id)}</span>
                <span>${escapeHtml(new Date(doubt.created_at || Date.now()).toLocaleTimeString())}</span>
            </div>
            <h4>${escapeHtml(doubt.student_name || doubt.current_name || 'Student')}</h4>
            <p>${escapeHtml(doubt.question_text || 'No text provided.')}</p>
            <div style="display:flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
                <span class="doubt-badge pending">${escapeHtml(doubt.status || 'pending')}</span>
                ${doubt.question_image ? '<span class="doubt-badge solved">Image</span>' : ''}
            </div>
        </article>
    `).join('');
}

function showDetail(doubt) {
    if (!detailArea || !noSelection) return;
    activeDoubtId = doubt.id;
    noSelection.style.display = 'none';
    detailArea.style.display = 'flex';
    if (detailName) detailName.textContent = doubt.student_name || doubt.current_name || 'Student';
    if (detailMeta) detailMeta.textContent = `UID: ${doubt.student_uid || '-'} `;
    if (detailBadge) {
        const status = String(doubt.status || 'pending').toLowerCase();
        detailBadge.className = `doubt-badge ${['solved', 'flagged'].includes(status) ? status : 'pending'}`;
        detailBadge.textContent = status;
    }
    if (detailQuestion) detailQuestion.textContent = doubt.question_text || 'No text provided.';
    if (detailBatch) detailBatch.textContent = doubt.current_batch || doubt.batch_name || '-';
    if (detailPhone) detailPhone.textContent = doubt.current_phone || doubt.phone || '-';
    if (detailCreated) detailCreated.textContent = new Date(doubt.created_at || Date.now()).toLocaleString();
    if (detailStatus) detailStatus.textContent = String(doubt.status || 'pending').toUpperCase();

    if (doubt.question_image) {
        detailImageWrap.classList.remove('hidden');
        detailImageWrap.style.display = 'block';
        detailImage.src = doubt.question_image;
    } else {
        detailImageWrap.classList.add('hidden');
        detailImageWrap.style.display = 'none';
        detailImage.removeAttribute('src');
    }
    capturedReplyBlob = null;
    if (replyPreview) {
        replyPreview.classList.add('hidden');
        replyPreview.innerHTML = '';
    }
    if (replyImageInput) {
        replyImageInput.value = '';
    }
    setReplyStatus('Optional, take a solution photo before solving.');
    renderPendingList();
}

async function loadDoubts() {
    try {
        const res = await fetch('/api/doubts/pending', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok || payload.status !== 'success') {
            throw new Error(payload.error || 'Could not load doubts.');
        }
        pendingDoubts = Array.isArray(payload.doubts) ? payload.doubts : [];
        if (activeDoubtId) {
            const active = pendingDoubts.find((item) => Number(item.id) === Number(activeDoubtId));
            if (active) {
                showDetail(active);
                return;
            }
        }
        renderPendingList();
    } catch (error) {
        if (pendingList) {
            pendingList.innerHTML = `<p class="msg">${escapeHtml(error.message || 'Could not load doubts.')}</p>`;
        }
    }
}

async function refreshDoubts() {
    await loadDoubts();
}

async function updateDoubt(status) {
    if (!activeDoubtId) return;
    try {
        const shouldAttachPhoto = status === 'solved' && (capturedReplyBlob || (replyImageInput && replyImageInput.files && replyImageInput.files[0]));
        let res;
        if (shouldAttachPhoto) {
            const formData = new FormData();
            if (capturedReplyBlob) {
                formData.append('image', capturedReplyBlob, `solution_${Date.now()}.jpg`);
            } else {
                formData.append('image', replyImageInput.files[0]);
            }
            res = await fetch(`/api/doubts/reply/${encodeURIComponent(activeDoubtId)}`, {
                method: 'POST',
                body: formData
            });
        } else {
            res = await fetch(`/api/doubts/status/${encodeURIComponent(activeDoubtId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
        }
        const payload = await res.json();
        if (!res.ok || payload.status !== 'success') {
            throw new Error(payload.error || 'Could not update doubt.');
        }
        activeDoubtId = null;
        detailArea.style.display = 'none';
        noSelection.style.display = 'flex';
        stopReplyCamera();
        capturedReplyBlob = null;
        await loadDoubts();
    } catch (error) {
        alert(error.message || 'Could not update doubt.');
    }
}

function selectDoubt(id) {
    const doubt = pendingDoubts.find((item) => Number(item.id) === Number(id));
    if (!doubt) return;
    showDetail(doubt);
}

window.selectDoubt = selectDoubt;
window.refreshDoubts = refreshDoubts;
window.updateDoubt = updateDoubt;

openReplyCameraBtn?.addEventListener('click', startReplyCamera);
captureReplyPhotoBtn?.addEventListener('click', captureReplyPhoto);
retakeReplyPhotoBtn?.addEventListener('click', retakeReplyPhoto);
replyImageInput?.addEventListener('change', syncReplyFallback);

loadDoubts();
setInterval(loadDoubts, 15000);
window.addEventListener('beforeunload', stopReplyCamera);
