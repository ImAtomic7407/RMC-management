const video = document.getElementById('webcam'); // Selects the live video element for webcam streaming.
const canvas = document.getElementById('photo-canvas'); // Selects the hidden canvas used for pixel manipulation during capture.
const photoPreview = document.getElementById('photo-preview'); // Selects the static image element that displays the captured student photo.
const btnSnap = document.getElementById('btn-snap'); // Selects the primary capture button (The shutter).
const btnReset = document.getElementById('btn-reset'); // Selects the 'Retake' button to clear the current capture.
const regForm = document.getElementById('reg-form'); // Selects the master enrollment form for data serialization.
const scanLine = document.getElementById('moving-line'); // Selects the animated scanning guidline overlay.
const flashEffect = document.getElementById('flash-effect'); // Selects the high-vibrancy white overlay for the capture feedback.
const submitBtn = document.getElementById('submit-all'); // Selects the final submission button for database commit.
const inlineResultArea = document.getElementById('inline-result-area'); // Selects the bottom section where the 3D result is revealed.
const btnDownloadImg = document.getElementById('btn-download-img'); // Selects the button responsible for triggering the PNG snapshot.
const btnStartNew = document.getElementById('btn-start-new'); // Selects the button to reset the session for the next student.
const btnGoPortal = document.getElementById('btn-go-portal');
const btnFlip = document.getElementById('btn-flip-card'); // Selects the button to toggle the 3D card faces.
const flippableCard = document.getElementById('flippable-card'); // Selects the 3D-transformed container for the digital ID.
const quickIdPreview = document.getElementById('quick-id-preview');
const phoneInput = document.getElementById('phone');
const phoneApprovalHint = document.getElementById('phone-approval-hint');
const editSessionInput = document.getElementById('edit-session-id');
const portalConfig = window.__RMC_PORTAL_CONFIG || {};
const isUpdateMode = String(portalConfig.mode || '').toLowerCase() === 'update';
let capturedImageBase64 = null; // Memory variable to store the JPEG-encoded student photo.
let currentUID = null; // Memory variable to store the student's unique identifier for session tracking.
let batchDropdownLoadPromise = null; // Prevents overlapping batch refreshes that can destabilize the select UI.
let primaryActionState = { approved: false, has_existing_card: false };
let phoneCheckTimer = null;
let pendingApprovalPhone = '';

if (btnFlip) {
    btnFlip.textContent = 'CARD PICTURE MODE';
    btnFlip.style.display = 'none';
}
if (btnDownloadImg) btnDownloadImg.textContent = 'DOWNLOAD FULL ID PNG';

function escapeCardValue(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function resolvePrimaryBatch(source = {}) {
    const batches = Array.isArray(source.current_batches)
        ? source.current_batches
        : [source.current_batch];
    return (batches.find((item) => String(item || '').trim()) || 'GENERAL BATCH').trim();
}

function setPrimaryActionLabel(label) {
    if (!submitBtn) return;
    submitBtn.innerText = label;
    const isShowMode = label === 'SHOW MY ID CARD';
    const isUpdateLabel = label === 'SAVE STUDENT UPDATE';
    submitBtn.type = 'submit'; // Always keep as submit to trigger the form listener
    submitBtn.dataset.mode = isShowMode ? 'show-id' : (isUpdateLabel ? 'update' : 'submit');
    submitBtn.classList.toggle('state-view', isShowMode);
    submitBtn.classList.toggle('state-update', !isShowMode && (label === 'GENERATE SECURE ID CARD' || isUpdateLabel));
}

function updatePrimaryActionState(payload = {}) {
    if (isUpdateMode) {
        setPrimaryActionLabel('SAVE STUDENT UPDATE');
        return;
    }
    primaryActionState = {
        approved: payload?.approved === true,
        has_existing_card: payload?.has_existing_card === true
    };
    const approved = primaryActionState.approved;
    const hasExistingCard = primaryActionState.has_existing_card;
    setPrimaryActionLabel(
        hasExistingCard
            ? 'SHOW MY ID CARD'
            : (approved ? 'GENERATE SECURE ID CARD' : 'SEND ID CARD REQUEST')
    );
}

function showNotificationModal(content) { // Injects a high-priority warning modal into the DOM.
    const modal = document.createElement('div'); // Creates the modal container element.
    modal.className = 'glass-panel notification-modal'; // Applies standard RMC glass styling for design unity.
    modal.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ef4444;">
            <p style="font-weight: 900; font-size: 1.2rem;">⚠️ ABSENCE ALERT</p>
            <p>${content}</p>
            <button class="btn-primary" onclick="this.parentElement.parentElement.remove()">ACKNOWLEDGE</button>
        </div>
    `; // Defines the visual structure of the alert with a high-contrast red warning.
    modal.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 9999; border: 2px solid #ef4444;"; // Forces the alert to the top of the viewport.
    document.body.appendChild(modal); // Renders the modal into the visible document.
}

async function checkIdApprovalForPhone(input) {
    if (isUpdateMode) {
        return { approved: true, has_existing_card: true, skipped: true };
    }
    const isObject = input && typeof input === 'object';
    const phone = String(isObject ? input.phone : input || '').trim();
    const fatherName = String(isObject ? input.father_name : '').trim();
    const guardianPhone = String(isObject ? input.guardian_phone : '').trim();
    if (!phone) {
        if (phoneApprovalHint) {
            phoneApprovalHint.textContent = 'Enter the phone number to check whether this ID already exists or needs teacher approval.';
            phoneApprovalHint.style.color = 'rgba(255,255,255,0.72)';
        }
        updatePrimaryActionState();
        return { approved: false, has_existing_card: false, skipped: true };
    }

    try {
        const query = new URLSearchParams({ phone });
        if (fatherName) query.set('father_name', fatherName);
        if (guardianPhone) query.set('guardian_phone', guardianPhone);
        const res = await fetch(`/api/leads/approval-status?${query.toString()}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });
        const payload = await res.json();
        const approved = res.ok && payload.status === 'success' && payload.approved === true;
        const hasExistingCard = res.ok && payload.status === 'success' && payload.has_existing_card === true;
        if (phoneApprovalHint) {
            phoneApprovalHint.textContent = hasExistingCard
                ? 'An ID card already exists for this phone. Click "SHOW MY ID CARD".'
                : (approved
                    ? 'Teacher approval is active. Complete the form to generate the ID card.'
                    : (payload.message || 'Teacher approval is pending.'));
            phoneApprovalHint.style.color = (approved || hasExistingCard) ? '#4ade80' : '#fca5a5';
        }
        updatePrimaryActionState(payload);
        return { approved, has_existing_card: hasExistingCard, payload };
    } catch (_err) {
        if (phoneApprovalHint) {
            phoneApprovalHint.textContent = 'Could not verify this phone number right now.';
            phoneApprovalHint.style.color = '#fca5a5';
        }
        updatePrimaryActionState();
        return { approved: false, has_existing_card: false, error: true };
    }
}

async function loadExistingIdCard(phone) {
    if (isUpdateMode) {
        return null;
    }
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) return null;
    if (inlineResultArea) {
        inlineResultArea.classList.remove('hidden');
        inlineResultArea.style.display = 'flex';
    }
    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone })
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'success' || data.mode !== 'retrieval') {
        throw new Error(data.error || data.message || 'Could not load the existing ID card.');
    }
    currentUID = data.uid;
    await renderProCard(data, data);
    updatePrimaryActionState({ approved: false, has_existing_card: true });
    return data;
}

async function submitIdPermissionRequest(input, phoneFallback = '') {
    if (isUpdateMode) {
        return;
    }
    const isObject = input && typeof input === 'object';
    const cleanName = String(isObject ? input.name : input || '').trim();
    const cleanPhone = String(isObject ? input.phone : phoneFallback || '').trim();
    const cleanFatherName = String(isObject ? input.father_name : '').trim();
    const cleanGuardianPhone = String(isObject ? input.guardian_phone : '').trim();
    if (!cleanName || !cleanPhone) return;

    try {
        await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: cleanName,
                phone: cleanPhone,
                father_name: cleanFatherName,
                guardian_phone: cleanGuardianPhone,
                source: 'id_card_permission_request',
                message: 'ID card permission request from enrollment portal.'
            })
        });
        pendingApprovalPhone = cleanPhone;
    } catch (_err) {
        // Silent fail: the UI already shows pending approval.
    }
}

function validateGenerationPayload(payload) {
    if (!payload.name) {
        alert('Please enter the student name first.');
        return false;
    }
    if (!payload.father_name) {
        alert("Please enter the father's name before generating the ID card.");
        return false;
    }
    if (!payload.current_batches[0]) {
        alert('Please select the batch before generating the ID card.');
        return false;
    }
    if (!payload.student_class) {
        alert('Please select the class or course before generating the ID card.');
        return false;
    }
    if (!payload.aspiration) {
        alert('Please select the aspiration goal before generating the ID card.');
        return false;
    }
    if (!capturedImageBase64) {
        alert('Please capture a student photo before generating the ID card.');
        return false;
    }
    return true;
}

function validateUpdatePayload(payload) {
    if (!payload.name) {
        alert('Please enter the student name before saving the update.');
        return false;
    }
    if (!payload.phone) {
        alert('Please enter the phone number before saving the update.');
        return false;
    }
    if (!payload.father_name) {
        alert("Please enter the father's name before saving the update.");
        return false;
    }
    if (!payload.current_batches[0]) {
        alert('Please select the batch before saving the update.');
        return false;
    }
    if (!payload.student_class) {
        alert('Please select the class or course before saving the update.');
        return false;
    }
    if (!payload.aspiration) {
        alert('Please select the aspiration goal before saving the update.');
        return false;
    }
    return true;
}

function applyUpdatePortalState(student = {}) {
    if (!isUpdateMode) {
        return;
    }

    if (portalConfig.message && phoneApprovalHint) {
        phoneApprovalHint.textContent = portalConfig.message;
        phoneApprovalHint.style.color = '#93c5fd';
    }

    if (student && typeof student === 'object') {
        const fields = {
            name: student.name || '',
            phone: student.phone || '',
            father_name: student.father_name || '',
            guardian_phone: student.guardian_phone || '',
            address: student.address || '',
            student_class: student.student_class || ''
        };

        Object.entries(fields).forEach(([key, value]) => {
            const field = document.getElementById(key);
            if (field) field.value = value;
        });

        const batches = Array.isArray(student.current_batches) && student.current_batches.length
            ? student.current_batches
            : [student.current_batch || resolvePrimaryBatch(student)];
        const batchValue = batches.find((item) => String(item || '').trim()) || '';
        if (batchValue) {
            const batchSelect = document.getElementById('current_batch');
            if (batchSelect) batchSelect.value = batchValue;
        }

        document.querySelectorAll('input[name="aspiration"]').forEach((input) => {
            input.checked = String(input.value || '') === String(student.aspiration || '');
        });

        currentUID = student.student_uid || student.uid || currentUID;
        renderProCard({
            ...student,
            uid: student.uid || student.student_uid || currentUID,
            student_uid: student.student_uid || currentUID,
            mode: 'update'
        }, {
            ...student,
            current_batch: batchValue || student.current_batch || '',
            current_batches: batches,
            photo_url: student.photo_path || student.photo_url || '',
            qr_url: student.qr_path || student.qr_url || ''
        });
    }

    if (btnStartNew) {
        btnStartNew.textContent = 'CLOSE UPDATE PORTAL';
    }
    if (btnGoPortal) {
        btnGoPortal.textContent = 'RETURN TO HOST';
        btnGoPortal.onclick = () => {
            window.location.href = '/host_dashboard';
        };
    }
    if (submitBtn) {
        submitBtn.innerText = 'SAVE STUDENT UPDATE';
    }
}

function stripUpdateQueryFromUrl() {
    if (!isUpdateMode) {
        return;
    }
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('token');
    currentUrl.searchParams.delete('mode');
    window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
}
// INIT WEBCAM & BATCHES
async function startApp() { // Orchestrates the initial camera permission and stream setup.
    await initBatchDropdown(); // Fetches live batches for the assignment selector before the user interacts.
    updatePrimaryActionState();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ // Requests a high-definition 1:1 aspect ratio video stream.
            video: { width: 640, height: 640, facingMode: "user" }, // Configures the stream for front-facing enrollment logic.
            audio: false // Disables microphone access as it is not required for identity capture.
        });
        video.srcObject = stream; // Binds the raw media stream to the HTML video element.
    } catch (err) {
        console.error("CAMERA ERROR:", err); // Logs failures (e.g., Blocked access) to the console for debugging.
    }
}
// CAPTURE EVENT
btnSnap.addEventListener('click', () => { // Triggered when the staff/student clicks the capture button.
    flashEffect.classList.add('flash-active'); // Activates the vibrant 400ms flash overlay for visual feedback.
    setTimeout(() => flashEffect.classList.remove('flash-active'), 400); // Disables the flash effect after the shutter interval.
    scanLine.classList.add('scan-stopped'); // Freezes the animated scanning line to indicate a captured state.
    const context = canvas.getContext('2d'); // Obtains the 2D pixel-manipulation context for the hidden canvas.
    canvas.width = video.videoWidth; // Sets the canvas width to match the raw camera input.
    canvas.height = video.videoHeight; // Sets the canvas height to match the raw camera input.
    context.save(); // Pushes the current canvas state onto the stack.
    context.scale(-1, 1); // Mirrors the image horizontally to match the natural 'selfie' perspective.
    context.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); // Draws the current video frame onto the mirrored canvas.
    context.restore(); // Restores the canvas state for future operations.
    capturedImageBase64 = canvas.toDataURL('image/jpeg', 0.95); // Compresses the canvas into a high-quality JPEG string.
    photoPreview.src = capturedImageBase64; // Updates the static preview image with the new capture.
    photoPreview.classList.remove('hidden'); // Reveals the captured photo to the user.
    video.classList.add('hidden'); // Hides the live video feed during review.
    btnSnap.classList.add('hidden'); // Hides the shutter button.
    btnReset.classList.remove('hidden'); // Reveals the 'Retake' option.
});
btnReset.addEventListener('click', () => { // Triggered when the user wants to discard the current photo.
    capturedImageBase64 = null; // Purges the current JPEG string from memory.
    photoPreview.classList.add('hidden'); // Hides the static preview.
    video.classList.remove('hidden'); // Restarts the live webcam viewport.
    btnSnap.classList.remove('hidden'); // Restores the shutter button.
    btnReset.classList.add('hidden'); // Hides the retake button.
    scanLine.classList.remove('scan-stopped'); // Resumes the scanning guideline animation.
});

// FLIP LOGIC
btnFlip?.addEventListener('click', () => {
    flippableCard?.classList.toggle('is-flipped');
});
// FORM SUBMISSION
regForm.addEventListener('submit', async (e) => { // High-speed submission handler for the enrollment database.
    e.preventDefault(); // Intercepts the default browser redirect to handle the API response via AJAX.
    submitBtn.innerText = isUpdateMode ? 'SAVING UPDATE...' : "CHECKING PHONE...";
    submitBtn.disabled = true;
    const aspChecked = document.querySelector('input[name="aspiration"]:checked'); // Locates the selected academic path.

    const payload = { // Aggregates the full institutional enrollment dataset.
        name: document.getElementById('name').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        father_name: document.getElementById('father_name').value.trim(),
        guardian_phone: document.getElementById('guardian_phone').value.trim(),
        current_batches: [document.getElementById('current_batch').value.trim()], // Mapped to the server's expected array format.
        address: document.getElementById('address').value.trim(),
        student_class: document.getElementById('student_class').value,
        aspiration: aspChecked ? aspChecked.value : '',
        photo: capturedImageBase64
    };

    if (isUpdateMode) {
        if (!validateUpdatePayload(payload)) {
            submitBtn.disabled = false;
            updatePrimaryActionState(primaryActionState);
            return;
        }

        try {
            const response = await fetch('/api/students/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    edit_session_id: editSessionInput?.value || portalConfig.editSessionId || ''
                })
            });
            const res = await response.json();
            if (response.ok && res.status === 'success') {
                currentUID = res.student?.student_uid || res.student?.uid || currentUID;
                const mergedStudent = res.student || {};
                const mergedInput = {
                    ...payload,
                    ...mergedStudent,
                    current_batch: resolvePrimaryBatch({ ...mergedStudent, ...payload }),
                    current_batches: Array.isArray(payload.current_batches) && payload.current_batches.length
                        ? payload.current_batches
                        : (Array.isArray(mergedStudent.current_batches) ? mergedStudent.current_batches : [mergedStudent.current_batch].filter(Boolean))
                };
                await renderProCard({
                    ...mergedStudent,
                    uid: currentUID,
                    student_uid: currentUID,
                    mode: 'update'
                }, mergedInput);
                if (phoneApprovalHint) {
                    phoneApprovalHint.textContent = 'Student record updated successfully.';
                    phoneApprovalHint.style.color = '#4ade80';
                }
                if (submitBtn) {
                    submitBtn.innerText = 'SAVE STUDENT UPDATE';
                }
            } else {
                alert("ERROR: " + (res.message || res.error || "Unknown Response"));
            }
        } catch (err) {
            alert(err.message || "PRO-API CONNECTION FAILED.");
        } finally {
            submitBtn.disabled = false;
            updatePrimaryActionState(primaryActionState);
        }
        return;
    }

    if (!payload.phone) {
        alert('Please enter the phone number first.');
        submitBtn.disabled = false;
        updatePrimaryActionState(primaryActionState);
        return;
    }

    const approval = await checkIdApprovalForPhone(payload);

    try {
        if (approval.has_existing_card) {
            submitBtn.innerText = 'LOADING EXISTING ID...';
            pendingApprovalPhone = '';
            await loadExistingIdCard(payload.phone);
            return;
        } else if (approval.approved) {
            if (!validateGenerationPayload(payload)) {
                submitBtn.disabled = false;
                updatePrimaryActionState(primaryActionState);
                return;
            }
            submitBtn.innerText = 'GENERATING ID CARD...';
        } else {
            if (!payload.name) {
                alert('Please enter the student name before sending the request.');
                submitBtn.disabled = false;
                updatePrimaryActionState(primaryActionState);
                return;
            }
            if (pendingApprovalPhone === payload.phone) {
                submitBtn.innerText = 'RECHECKING APPROVAL...';
                await new Promise((resolve) => window.setTimeout(resolve, 700));
                const retryApproval = await checkIdApprovalForPhone(payload);
                if (retryApproval.has_existing_card) {
                    pendingApprovalPhone = '';
                    submitBtn.innerText = 'LOADING EXISTING ID...';
                    await loadExistingIdCard(payload.phone);
                    return;
                }
                if (!retryApproval.approved) {
                    alert('ID request is still pending teacher approval. Once approved, click Generate again.');
                    return;
                }
                if (!validateGenerationPayload(payload)) {
                    submitBtn.disabled = false;
                    updatePrimaryActionState(primaryActionState);
                    return;
                }
                submitBtn.innerText = 'GENERATING ID CARD...';
            } else {
                submitBtn.innerText = 'SENDING REQUEST...';
                await submitIdPermissionRequest(payload);
                const followUpApproval = await checkIdApprovalForPhone(payload);
                if (followUpApproval.has_existing_card) {
                    pendingApprovalPhone = '';
                    submitBtn.innerText = 'LOADING EXISTING ID...';
                    await loadExistingIdCard(payload.phone);
                    return;
                }
                if (!followUpApproval.approved) {
                    alert('ID request sent to the teacher. Once approved, click Generate again for this phone.');
                    return;
                }
                if (!validateGenerationPayload(payload)) {
                    submitBtn.disabled = false;
                    updatePrimaryActionState(primaryActionState);
                    return;
                }
                submitBtn.innerText = 'GENERATING ID CARD...';
            }
        }

        const response = await fetch('/api/register', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(approval.has_existing_card ? { phone: payload.phone } : payload)
        });
        const res = await response.json(); 
        if(response.ok) { 
            pendingApprovalPhone = '';
            currentUID = res.uid || res.student_uid || currentUID;
            const mergedInput = {
                ...payload,
                ...res,
                current_batch: resolvePrimaryBatch({ ...res, ...payload }),
                current_batches: Array.isArray(payload.current_batches) && payload.current_batches.length
                    ? payload.current_batches
                    : (Array.isArray(res.current_batches) ? res.current_batches : [res.current_batch].filter(Boolean))
            };
            await renderProCard({
                ...res,
                uid: currentUID,
                student_uid: res.student_uid || currentUID,
                mode: res.mode || 'generation'
            }, mergedInput);
            updatePrimaryActionState({ approved: false, has_existing_card: true });
        } else {
            alert("ERROR: " + (res.message || res.error || "Unknown Response")); 
        }
    } catch (err) { 
        alert(err.message || "PRO-API CONNECTION FAILED."); 
    } finally {
        updatePrimaryActionState(primaryActionState);
        submitBtn.disabled = false; // Unlocks the form for subsequent interactions.
    }
});
function getCardTemplate(isFront, data, input) { // Generates the high-fidelity HTML blueprint for either face of the ID card.
    const source = { ...(data || {}), ...(input || {}) };
    const batchLabel = escapeCardValue(resolvePrimaryBatch(source)).toUpperCase();
    const studentName = escapeCardValue(String(source.name || source.student_name || 'Student').toUpperCase());
    const uid = escapeCardValue(source.uid || source.student_uid || 'UID-N/A');
    const phone = escapeCardValue(source.phone || '-');
    const fbcNo = escapeCardValue(source.fbc_no || '-');
    const fatherName = escapeCardValue(source.father_name || '-');
    const fatherNameUpper = escapeCardValue(String(source.father_name || '-').toUpperCase());
    const guardianPhone = escapeCardValue(source.guardian_phone || '-');
    const studentClass = escapeCardValue(source.student_class || '-');
    const address = escapeCardValue(source.address || '-');
    const qrUrl = escapeCardValue(source.qr_url || source.qr_path || '/img/placeholder-qr.png');
    const photoUrl = escapeCardValue(source.photo_url || source.photo_path || source.photo || '/img/placeholder-profile.png');

    if (isFront) { // Branch for the public-facing identity face.
        return `
            <div class="id-card-pro custom-rmc-id">
                <div class="id-watermark">RMC</div>
                <div class="rmc-id-topbar">
                    <div class="rmc-id-logo-area">
                        <div class="rmc-logomark">
                            <strong>RMC</strong>
                            <span>INSTITUTE</span>
                        </div>
                    </div>
                    <div class="rmc-id-type">
                        <div class="type-main">IDENTITY<br>CARD</div>
                        <div class="type-year">2025-26</div>
                    </div>
                </div>
                <div class="rmc-id-concept">
                    <div class="concept-main">RMC</div>
                    <div class="concept-sub">Concept Se Selection tak</div>
                </div>
                <div class="rmc-id-batch">${batchLabel}</div>
                <div class="rmc-id-middle-grid">
                    <div class="middle-item qr-zone"><img src="${qrUrl}" alt="QR"></div>
                    <div class="middle-item photo-zone"><img src="${photoUrl}" alt="Photo"></div>
                </div>
                <div class="rmc-id-details">
                    <div class="detail-name">${studentName}</div>
                    <div class="detail-uid">${uid}</div>
                    <div class="detail-secondary-row">
                        <span>FNO: ${phone}</span>
                        <span>FBC: ${fbcNo}</span>
                    </div>
                    <div class="detail-parent">Father's Name: ${fatherName}</div>
                    <div class="detail-address">Address on file (RMC digital vault)</div>
                </div>
                <div class="rmc-id-footer rmc-id-footer-link">Show Details -></div>
            </div>
        `; // Returns the front-face HTML with student photo and unique verification QR.
    } else { // Branch for the private administrative data face.
        return `
            <div class="id-card-pro">
                <div class="id-watermark">RMC</div>
                <div class="id-brand-banner">
                    <div class="id-brand-title">Official Records</div>
                    <div class="id-brand-tagline">RMC Internal Sheet</div>
                </div>
                <div class="id-field-list id-back-fields">
                    <div class="id-field id-field-full">
                        <label>Father's Name</label>
                        <span class="id-value-strong">${fatherNameUpper}</span>
                    </div>
                    <div class="id-field id-field-inline">
                        <label>Guardian Phone</label>
                        <span>${guardianPhone}</span>
                    </div>
                    <div class="id-field id-field-inline">
                        <label>Class</label>
                        <span>${studentClass}</span>
                    </div>
                    <div class="id-field id-field-full">
                        <label>Current Batch</label>
                        <span class="id-value-strong">${batchLabel}</span>
                    </div>
                    <div class="id-field id-field-full">
                        <label>Security Note</label>
                        <span class="id-value-compact">This card is property of RMC. Return to institute if found. Unauthorized use is prohibited. Residential address verified in digital vault.</span>
                    </div>
                </div>
                <div class="id-footer-strip">
                    <span>riteshmathematics.in</span>
                    <div class="id-footer-tag">Verified Access</div>
                </div>
            </div>
        `; // Returns the back-face HTML with sensitive guardian contacts and address data.
    }
}

if (isUpdateMode) {
    applyUpdatePortalState(portalConfig.student || {});
    stripUpdateQueryFromUrl();
}

async function renderProCard(data, input) { // Orchestrates the multi-layered process of visualizing and capturing the student ID.
    if (flippableCard) {
        flippableCard.classList.remove('is-flipped');
    }
    // Render only the front face into the hidden buffer and use that same image everywhere.
    document.getElementById('capture-front').innerHTML = getCardTemplate(true, data, input); // Binds the front face to an off-screen buffer for clean rendering.
    // 2. Update Result Header based on mode
    const statusLabel = inlineResultArea.querySelector('.status-badge'); // Selects the dynamic success indicator.
    if (data.mode === 'retrieval') { // Branch for an existing card matched directly by phone number.
        statusLabel.innerText = "PHONE MATCH: ID RECORD FOUND"; // Updates label for retrieval success.
        statusLabel.style.background = "rgba(34, 211, 238, 0.2)"; // Applies a cyan cyan-tinted glass alert.
    } else if (data.mode === 'update') {
        statusLabel.innerText = "ID CARD UPDATED";
        statusLabel.style.background = "rgba(59, 130, 246, 0.2)";
    } else { // Branch for new enrollment database entries.
        statusLabel.innerText = "ID CARD GENERATED"; // Updates label for creation success.
        statusLabel.style.background = "rgba(34, 197, 94, 0.2)"; // Applies a green-tinted glass alert.
    }
    // 3. Show preview area
    inlineResultArea.classList.remove('hidden'); // Reveals the 3D ID visualization to the user.
    inlineResultArea.style.display = 'flex';
    inlineResultArea.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Automatically centers the new ID card in the viewport.
    // 4. Pre-generate the downloadable picture (front face only for official export)
    const captureHost = document.getElementById('capture-front');
    const captureFace = captureHost?.querySelector('.id-card-pro');
    const previewContainer = document.getElementById('full-id-render-preview');
    
    if (!captureFace || !previewContainer) {
        return;
    }

    await Promise.all(Array.from(captureFace.querySelectorAll('img')).map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));

    let renderedCanvas;
    try {
        renderedCanvas = await html2canvas(captureFace, {
            useCORS: true,
            scale: 3,
            backgroundColor: '#f8fafc',
            logging: false
        });
    } catch (captureError) {
        previewContainer.innerHTML = '<div class="empty-state warning">Could not render PNG preview.</div>';
        return;
    }

    renderedCanvas.classList.add('flat-id-image');
    const compactCanvas = renderedCanvas.cloneNode(true);
    compactCanvas.classList.add('flat-id-image', 'compact-id-image');
    if (quickIdPreview) {
        quickIdPreview.innerHTML = '';
        quickIdPreview.appendChild(compactCanvas);
    }
    
    // Inject the high-fidelity render into the full view area
    previewContainer.innerHTML = '';
    previewContainer.appendChild(renderedCanvas);

    btnDownloadImg.onclick = () => { // Registers the final download action.
        const link = document.createElement('a'); // Creates a temporary browser download link.
        link.download = `ID_CARD_${data.uid || data.student_uid || 'RMC'}.png`; // Sets the institutional filename pattern.
        link.href = renderedCanvas.toDataURL('image/png'); // Converts the canvas to a downloadable binary stream.
        link.click(); // Triggers the browser's download manager.
    };
}
// BATCH LOADING
async function initBatchDropdown(forceRefresh = false) { // Fetches live batches from the public batch catalog.
    const dropdown = document.getElementById('current_batch');

    if (!dropdown) {
        return;
    }

    if (batchDropdownLoadPromise && !forceRefresh) {
        return batchDropdownLoadPromise;
    }

    const previousValue = dropdown.value;
    const existingOptions = Array.from(dropdown.options).map((option) => ({
        value: option.value,
        text: option.textContent,
        disabled: option.disabled,
        selected: option.selected
    }));
    const existingBatchValues = existingOptions
        .filter((option) => option.value)
        .map((option) => option.value);

    // The register page already renders the active catalog server-side.
    // Avoid repainting the select unless it is genuinely empty or an explicit refresh was requested.
    if (existingBatchValues.length > 0 && !forceRefresh) {
        return;
    }

    batchDropdownLoadPromise = (async () => {
        try {
            const res = await fetch('/api/public/batches', { cache: 'no-store' });
            if (!res.ok) {
                throw new Error(`Batch fetch failed with status ${res.status}`);
            }
            const batches = await res.json();
            const safeBatches = Array.isArray(batches) ? batches : [];
            const nextBatchValues = safeBatches
                .map((batch) => String(batch.name || '').trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

            const isSameList = existingBatchValues.length === nextBatchValues.length
                && existingBatchValues.every((value, index) => value === nextBatchValues[index]);

            if (isSameList && !forceRefresh) {
                return;
            }

            const fragment = document.createDocumentFragment();

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = !previousValue;
            placeholder.textContent = safeBatches.length ? 'Select Target Batch...' : 'No batches available';
            fragment.appendChild(placeholder);

            nextBatchValues.forEach((batchName) => {
                    const opt = document.createElement('option');
                    opt.value = batchName;
                    opt.textContent = batchName;
                    fragment.appendChild(opt);
                });

            dropdown.innerHTML = '';
            dropdown.appendChild(fragment);

            if (previousValue && Array.from(dropdown.options).some((option) => option.value === previousValue)) {
                dropdown.value = previousValue;
            }
        } catch (e) {
            console.error("Batch load failed:", e);
            if (!dropdown.options.length && existingOptions.length) {
                dropdown.innerHTML = '';
                existingOptions.forEach((item) => {
                    const opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.text;
                    opt.disabled = item.disabled;
                    opt.selected = item.selected;
                    dropdown.appendChild(opt);
                });
            }
        } finally {
            batchDropdownLoadPromise = null;
        }
    })();

    return batchDropdownLoadPromise;
}

btnStartNew?.addEventListener('click', () => {
    if (isUpdateMode) {
        window.location.href = '/host_dashboard';
        return;
    }
    window.location.reload();
});
btnGoPortal?.addEventListener('click', () => {
    if (isUpdateMode) {
        window.location.href = '/host_dashboard';
        return;
    }
    const detailUid = document.querySelector('.detail-uid')?.innerText?.replace('UID: ', '')?.trim();
    const uid = (currentUID || detailUid || '').trim();
    if (uid) {
        window.location.href = `/student/portal?uid=${encodeURIComponent(uid)}&success=1`;
    } else {
        alert('Could not determine Student UID for redirect.');
    }
});
// Redundant click listener removed to prevent double-processing. 
// Handled by regForm.submit listener.
if (!isUpdateMode) {
    phoneInput?.addEventListener('input', (event) => {
        if (phoneCheckTimer) window.clearTimeout(phoneCheckTimer);
        phoneCheckTimer = window.setTimeout(() => checkIdApprovalForPhone(event.target.value), 250);
    });
    phoneInput?.addEventListener('blur', (event) => checkIdApprovalForPhone(event.target.value));
}
startApp(); // Bootstraps the application by requesting camera access.
