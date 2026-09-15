const idGrid = document.getElementById('id-grid-container'); // Selects the master grid host for rendering student identity tiles.
const inlinePreviewArea = document.getElementById('inline-preview-area'); // Selects the hidden 3D preview window for student record audit.
const btnDownloadImg = document.getElementById('btn-download-img'); // Selects the action button for triggering the identity PNG snapshot.
const closePreviewBtn = document.getElementById('close-preview'); // Selects the button to dismiss the 3D identity visualization.
const btnFlip = document.getElementById('btn-flip-card'); // Selects the toggle for rotating the 3D card faces.
const flippableCard = document.getElementById('flippable-card'); // Selects the 3D-transformed container for the digital identity.
const uiFront = document.getElementById('ui-card-front'); // Target for interactive front-face student data injection.
const uiBack = document.getElementById('ui-card-back'); // Target for interactive back-face student data injection.
const captureFront = document.getElementById('capture-front'); // Off-screen target for high-fidelity front-face PNG capture.
const captureBack = document.getElementById('capture-back'); // Off-screen target for high-fidelity back-face PNG capture.
let allStudents = []; // Global memory array storing student records fetched from the institution database.
let currentPreviewUID = "RMC-PRO-XXXX"; // Tracks the UID of the student currently active in the 3D previewer.
let activeSessionId = null; // Memory variable storing the ID of the current academic class session.
const btnStart = document.getElementById('btn-start-session'); // Selects the button to initiate a new attendance-tracking session.
const btnClose = document.getElementById('btn-close-session'); // Selects the button to terminate the active academic session.
const sessionStatus = document.getElementById('session-status'); // Selects the visual label indicating the session's active/closed state.
const batchSelector = document.getElementById('batch-session-select'); // Selects the dropdown for targeting specific student batches.
let teacherGridStream = null;
// Session Resumption
async function checkActiveSession() { // Verifies if a teacher session was interrupted or is already in progress on page load.
    try {
        const res = await fetch('/api/sessions/current'); // Requests the current session state from the backend.
        const d = await res.json(); // Parses the session status payload.
        if (d.status === 'success' && d.data) { // If an active session is found...
            activeSessionId = d.data.session_id; // Resumes tracking with the existing session ID.
            sessionStatus.textContent = `${d.data.session_name} (${d.data.batch_id}) - ACTIVE`; // Updates the status label with session metadata.
            btnStart.classList.add('hidden'); // Hides the 'Start' button.
            if(batchSelector) batchSelector.classList.add('hidden'); // Hides the batch selector to prevent mid-session changes.
            btnClose.classList.remove('hidden'); // Reveals the 'Close' button for the active session.
        }
    } catch(e) { console.error("Session check failed", e); } // Logs failures in session state retrieval.
}
async function loadStudents() { // Synchronizes the student grid with the latest institutional data.
    try {
        // Load Batches if selector exists
        if(batchSelector && batchSelector.options.length <= 1) { // Lazily populates the batch dropdown if the list is empty.
            const bRes = await fetch('/api/batches'); // Fetches all active batch silos from the server.
            const batches = await bRes.json();
            batches.forEach(b => { // Iterates through each batch to create a selector option.
                const opt = document.createElement('option');
                opt.value = b.name;
                opt.textContent = b.name;
                batchSelector.appendChild(opt); // Binds the batch to the teacher's session controls.
            });
        }
        const response = await fetch('/api/students'); // Retrieves student identities for the entire institution.
        allStudents = await response.json();
        renderGrid(allStudents); // Re-renders the grid with the fresh student data.
    } catch (e) {
        console.warn("DASHBOARD OFFLINE: Retrying...", e);
    }
}

function connectTeacherGridStream() {
    if (teacherGridStream) return;
    try {
        teacherGridStream = new EventSource('/api/staff/live/stream');
        teacherGridStream.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || '{}');
                const type = String(payload.type || '');
                if (!type || type === 'heartbeat') return;
                loadStudents();
            } catch {
                loadStudents();
            }
        };
        teacherGridStream.onerror = () => {
            if (teacherGridStream) {
                teacherGridStream.close();
                teacherGridStream = null;
            }
            window.setTimeout(connectTeacherGridStream, 2000);
        };
    } catch (err) {
        console.warn('Teacher grid live stream unavailable', err);
        window.setTimeout(connectTeacherGridStream, 2000);
    }
}
function renderGrid(students) { // Constructs the visual student grid on the teacher's console.
    idGrid.innerHTML = '';
    students.forEach(s => {
        const tile = document.createElement('div');
        tile.className = 'id-tile';
        tile.onclick = () => viewIdFull(s.student_uid); // Binds the 3D identity preview to the tile click.
        tile.innerHTML = `
            <div class="id-card-mini">
                <div class="mini-top">
                    <img src="${s.photo_path}" class="mini-photo">
                    <img src="${s.qr_path}" class="mini-qr">
                </div>
                <div class="mini-info">
                    <h2 class="mini-name">${s.name.toUpperCase()}</h2>
                    <p class="mini-meta">${s.aspiration} | ${s.student_class.toUpperCase()}</p>
                    <p class="mini-uid">${s.student_uid}</p>
                </div>
            </div>
        `; // Mounts a simplified student identity card for teacher overview.
        idGrid.appendChild(tile);
    });
}
// Session Logic
btnStart.onclick = async () => { // Initiates a new academic tracking session for a specific batch.
    const batch = batchSelector ? batchSelector.value : null; // Captures the target student batch.
    if (!batch) { alert("Please select a Batch first."); return; } // Validation: ensures a batch silo is targeted.
    const name = prompt("Enter Session Name (e.g. Morning Lecture):", "Class Session"); // Requests a descriptive name for the session logs.
    if (!name) return; // User cancellation check.
    const res = await fetch('/api/sessions/start', { // Dispatches the session creation request to the server.
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ session_name: name, batch_id: batch }) // Associates the session with a name and batch silo.
    });
    const data = await res.json();
    if (data.status === 'success') { // If the session is successfully initialized...
        activeSessionId = data.session_id; // Stores the new unique session identifier.
        sessionStatus.textContent = `${name} (${batch}) - ACTIVE`; // Updates UI to show the 'ACTIVE' state.
        btnStart.classList.add('hidden'); // Transitions controls to session-active state.
        if(batchSelector) batchSelector.classList.add('hidden');
        btnClose.classList.remove('hidden');
    }
};
btnClose.onclick = async () => { // Terminates the current session and triggers absentee notifications.
    if (!activeSessionId) return; // Guard: prevents closing if no session is active.
    const res = await fetch('/api/sessions/close', { // Finalizes the session records in the database.
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ session_id: activeSessionId }) // Targets the specific session being closed.
    });
    const data = await res.json();
    if (data.status === 'success') { // If closure is verified...
        alert(`Session closed. ${data.absentees_count} absentees notified.`); // Informs the teacher and triggers real-time alerts.
        sessionStatus.textContent = `CLOSED`; // Resets status to baseline.
        btnStart.classList.remove('hidden'); // Restores controls for the next session.
        if(batchSelector) batchSelector.classList.remove('hidden');
        btnClose.classList.add('hidden');
        activeSessionId = null; // Purges the current session ID from memory.
    }
};
function filterGrid() { // Filters the teacher's student grid based on real-time search input.
    const query = document.getElementById('search-input').value.toLowerCase();
    const filtered = allStudents.filter(s => 
        s.name.toLowerCase().includes(query) || 
        s.phone.includes(query) || 
        s.student_uid.toLowerCase().includes(query)
    ); // Standard multi-vector student search logic.
    renderGrid(filtered);
}
// 🃏 DUAL KEY TEMPLATE (Keep in sync with register.js)
function getCardTemplate(isFront, s) { // Generates the 3D identity card faces (Front for public, Back for records).
    if (isFront) {
        return `
            <div class="id-card-pro custom-rmc-id">
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
                <div class="rmc-id-batch">${s.current_batch || "GENERAL BATCH"}</div>
                <div class="rmc-id-middle-grid">
                    <div class="middle-item qr-zone"><img src="${s.qr_path}" alt="QR"></div>
                    <div class="middle-item photo-zone"><img src="${s.photo_path}" alt="Photo"></div>
                </div>
                <div class="rmc-id-details">
                    <div class="detail-name">${String(s.name || "Student").toUpperCase()}</div>
                    <div class="detail-uid">${s.student_uid || "UID-N/A"}</div>
                    <div class="detail-secondary-row">
                        <span>FNO: ${s.phone || "-"}</span>
                        <span>FBC: ${s.fbc_no || "-"}</span>
                    </div>
                    <div class="detail-parent">Father's Name: ${s.father_name || "-"}</div>
                    <div class="detail-address">ADDRESS ON FILE (RMC DIGITAL VAULT)</div>
                </div>
                <div class="rmc-id-footer">RMC</div>
            </div>`; // Returns the identity face blueprint.
    } else {
        return `
            <div class="id-card-pro">
                <div class="id-watermark">RMC</div>
                <div class="id-brand-banner id-brand-banner-back">
                    <div class="id-brand-title id-brand-title-sm">OFFICIAL RECORDS</div>
                    <div class="id-brand-tagline">RMC Internal Sheet</div>
                </div>
                <div class="id-field-list id-back-fields">
                    <div class="id-field id-field-full"><label>Father's Name</label><span class="id-value-strong">${s.father_name || "-"}</span></div>
                    <div class="id-field id-field-inline"><label>Guardian Phone</label><span>${s.guardian_phone || "-"}</span></div>
                    <div class="id-field id-field-inline"><label>Class</label><span>${s.student_class || "-"}</span></div>
                    <div class="id-field id-field-full"><label>Current Batch</label><span class="id-value-strong">${s.current_batch || "N/A"}</span></div>
                    <div class="id-field id-field-full"><label>Residential Address</label><span class="id-value-compact">${s.address || "-"}</span></div>
                </div>
                <div class="id-footer-strip"><span>riteshmathematics.in</span><div class="id-footer-tag">Verified</div></div>
            </div>`; // Returns the administrative record blueprint.
    }
}
async function viewIdFull(uid) { // Launches the high-fidelity 3D ID preview for a specific student.
    const s = allStudents.find(student => student.student_uid === uid);
    if(!s) return;
    currentPreviewUID = uid;
    // Populate Interactive Card
    uiFront.innerHTML = getCardTemplate(true, s);
    uiBack.innerHTML = getCardTemplate(false, s);
    // Populate Hidden Buffer
    captureFront.innerHTML = getCardTemplate(true, s);
    captureBack.innerHTML = getCardTemplate(false, s);
    // Show Preview
    inlinePreviewArea.classList.remove('hidden');
    inlinePreviewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Pre-generate Snapshot
    const buffer = document.getElementById('id-card-render-buffer');
    await Promise.all(Array.from(buffer.querySelectorAll('img')).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(res => { img.onload = res; img.onerror = res; });
    }));
    html2canvas(buffer, { useCORS: true, scale: 3, backgroundColor: null }).then(canvas => { // Triggers the rasterization for high-quality export.
        btnDownloadImg.onclick = () => {
            const link = document.createElement('a');
            link.download = `ID_CARD_${currentPreviewUID}.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
        };
    });
}
btnFlip.onclick = () => flippableCard.classList.toggle('is-flipped'); // Action to toggle ID faces.
closePreviewBtn.onclick = () => inlinePreviewArea.classList.add('hidden'); // Action to close the identity viewer.
checkActiveSession(); // Initial system check for existing sessions.
loadStudents(); // Forced bootstrap for the data sync engine.
connectTeacherGridStream(); // Subscribes to instant staff updates without polling.
