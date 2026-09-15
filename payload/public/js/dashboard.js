const idGrid = document.getElementById('id-grid-container'); // Selects the master grid host for rendering student identity tiles.
const filterBatchSelect = document.getElementById('filter-batch-crm'); // Selects the batch filtering dropdown for administrative silos.
const inlinePreviewArea = document.getElementById('inline-preview-area'); // Selects the hidden 3D preview window for student record audit.
const btnDownloadImg = document.getElementById('btn-download-img'); // Selects the action button for triggering the identity PNG snapshot.
const closePreviewBtn = document.getElementById('close-preview'); // Selects the button to dismiss the 3D identity visualization.
const btnFlip = document.getElementById('btn-flip-card'); // Selects the toggle for rotating the 3D card faces.
const flippableCard = document.getElementById('flippable-card'); // Selects the 3D-transformed container for the digital identity.
const uiFront = document.getElementById('ui-card-front'); // Target for interactive front-face student data injection.
const uiBack = document.getElementById('ui-card-back'); // Target for interactive back-face student data injection.
const captureFront = document.getElementById('capture-front'); // Off-screen target for high-fidelity front-face PNG capture.
const captureBack = document.getElementById('capture-back'); // Off-screen target for high-fidelity back-face PNG capture.
let allStudents = []; // Global memory array storing the current batch of deserialized student records.
let currentPreviewUID = "RMC-PRO-XXXX"; // Tracks the UID of the student currently being visualized in the 3D viewer.

async function loadStudents() { // Orchestrates the real-time synchronization between the dashboard and the backend.
    try {
        const response = await fetch('/api/students'); // Fetches the full set of student records from the active batch silos.
        allStudents = await response.json(); // Deserializes the student record bundle.
        renderGrid(allStudents); // Triggers the visual reconstruction of the student record grid.
    } catch (e) {
        console.warn("DASHBOARD OFFLINE: Retrying...", e); // Logs network or server-side communication failures.
    }
}

let dashboardLiveStream = null;
async function canReconnectStaffStream() {
    try {
        const res = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
        return res.ok;
    } catch {
        return true;
    }
}
function connectDashboardLiveStream() {
    if (dashboardLiveStream) return;
    try {
        dashboardLiveStream = new EventSource('/api/staff/live/stream');
        dashboardLiveStream.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || '{}');
                const type = String(payload.type || '');
                if (!type || type === 'heartbeat') return;
                loadStudents();
            } catch {
                loadStudents();
            }
        };
        dashboardLiveStream.onerror = () => {
            if (dashboardLiveStream) {
                dashboardLiveStream.close();
                dashboardLiveStream = null;
            }
            void (async () => {
                if (await canReconnectStaffStream()) {
                    window.setTimeout(connectDashboardLiveStream, 2000);
                }
            })();
        };
    } catch (err) {
        console.warn('Failed to open live dashboard stream', err);
        void (async () => {
            if (await canReconnectStaffStream()) {
                window.setTimeout(connectDashboardLiveStream, 2000);
            }
        })();
    }
}
function renderGrid(students) { // Reconstructs the administrative grid based on the current student record data.
    idGrid.innerHTML = ''; // Purges the current grid tiles to prevent stale data representation.
    // Update Stats
    const totalEl = document.getElementById('stat-total'); // Selects the institutional enrollment counter.
    const lastTimeEl = document.getElementById('stat-last-time'); // Selects the most recent activity timestamp.
    if (totalEl) totalEl.innerText = students.length; // Updates the total enrollment count in the stats bar.
    if (lastTimeEl) { // Temporal activity tracking.
        if (students.length > 0 && students[0].created_at) { // Checks for the presence of a recent record.
            const d = new Date(students[0].created_at); // Parses the ISO timestamp of the newest student.
            lastTimeEl.innerText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // Formats the time for staff readability.
        } else {
            lastTimeEl.innerText = '--:--'; // Default state for empty batches.
        }
    }
    students.forEach(s => { // Iterates through each student record to generate a dynamic tile.
        const tile = document.createElement('div'); // Creates the tile container.
        tile.className = 'id-tile'; // Applies standard grid styling and hover-interactive states.
        tile.onclick = () => viewIdFull(s.student_uid); // Binds the 3D revelation event to the tile click.
        tile.innerHTML = `
            <div class="tile-actions">
                <button class="btn-tile-del" onclick="deleteStudent(event, '${s.student_uid}')">🗑️</button>
            </div>
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
        `; // Injects the mini-identity snapshot with institutional branding and student photo.
        idGrid.appendChild(tile); // Mounts the tile into the administrative grid.
    });
}
async function deleteStudent(event, uid) { // Handles the destructive removal of student records and associated physical files.
    event.stopPropagation(); // Prevents the click from triggering the parent tile's preview event.
    if (!confirm("PERMANENTLY DELETE THIS STUDENT ID?")) return; // Staff confirmation gate for data integrity.
    try {
        const res = await fetch('/api/delete_student', { // Dispatches the deletion request to the backend silo processor.
            method: 'POST', // Secure method for record removal.
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ student_uid: uid }) // Targets the specific student via their unique Trio token.
        });
        if (res.ok) loadStudents(true); // Forces a grid re-sync to reflect the record removal.
    } catch (e) { alert("DELETE FAILED."); } // Alerts staff of backend write failures.
}
function filterGrid() { // Real-time search and batch filtering algorithm for high-speed record localization.
    const query = document.getElementById('search-input').value.toLowerCase(); // Captures the current search term from the dashboard header.
    const batchFilter = filterBatchSelect ? filterBatchSelect.value : 'ALL'; // Captures the selected batch silo filter.
    const filtered = allStudents.filter(s => { // Evaluates each student record against the active filters.
        const matchesSearch = s.name.toLowerCase().includes(query) || 
                            s.phone.includes(query) || 
                            s.student_uid.toLowerCase().includes(query); // Multi-vector search: Name, Phone, or UID.
        const matchesBatch = batchFilter === 'ALL' || s.batch_name === batchFilter; // Batch-silo affinity check.
        return matchesSearch && matchesBatch; // Record must satisfy both search and batch criteria.
    });
    renderGrid(filtered); // Re-renders the grid with the subset of matching records.
}

// 🃏 DUAL KEY TEMPLATE (Keep in sync with register.js)
function getCardTemplate(isFront, s) { // Generates the high-fidelity HTML for either face of the student ID.
    if (isFront) { // Public-facing identity face.
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
                <div class="rmc-id-batch">${s.current_batch || "GENERAL BATCH"}</div>
                <div class="rmc-id-middle-grid">
                    <div class="middle-item qr-zone"><img src="${s.qr_path || ''}" alt="QR"></div>
                    <div class="middle-item photo-zone"><img src="${s.photo_path || '/images/default_avatar.png'}" alt="Photo"></div>
                </div>
                <div class="rmc-id-details">
                    <div class="detail-name">${String(s.name || "Student").toUpperCase()}</div>
                    <div class="detail-uid">${s.student_uid || "UID-N/A"}</div>
                    <div class="detail-secondary-row">
                        <span>FNO: ${s.phone || "N/A"}</span>
                        <span>FBC: ${s.fbc_no || "N/A"}</span>
                    </div>
                    <div class="detail-parent">Father's Name: ${s.father_name || "N/A"}</div>
                    <div class="detail-address">Address on file (RMC digital vault)</div>
                </div>
                <div class="rmc-id-footer rmc-id-footer-link">Show Details -></div>
            </div>`; // Returns the front-face HTML with student photo and verification QR.
    } else { // Private administrative face.
        return `
            <div class="id-card-pro">
                <div class="id-watermark">RMC</div>
                <div class="id-brand-banner">
                    <div class="id-brand-title">Official Records</div>
                    <div class="id-brand-tagline">RMC Internal Sheet</div>
                </div>
                <div class="id-field-list id-back-fields">
                    <div class="id-field id-field-full"><label>Father's Name</label><span class="id-value-strong">${s.father_name || "-"}</span></div>
                    <div class="id-field id-field-inline"><label>Guardian Phone</label><span>${s.guardian_phone || "-"}</span></div>
                    <div class="id-field id-field-inline"><label>FBC Number</label><span>${s.fbc_no || "-"}</span></div>
                    <div class="id-field id-field-full"><label>Current Batch</label><span class="id-value-strong">${s.current_batch || "N/A"}</span></div>
                    <div class="id-field id-field-full"><label>Security Note</label><span class="id-value-compact">This card is property of RMC. Return to institute if found. Unauthorized use is prohibited. Residential address verified in digital vault.</span></div>
                </div>
                <div class="id-footer-strip"><span>riteshmathematics.in</span><div class="id-footer-tag">Verified Access</div></div>
            </div>`; // Returns the back-face HTML with guardian contact and address data.
    }
}
async function viewIdFull(uid) { // Triggers the full 3D identity revelation for a specific student record.
    const s = allStudents.find(student => student.student_uid === uid); // Locates the student record in the local cache.
    if(!s) return; // Guard clause for invalid UIDs.
    currentPreviewUID = uid; // Tracks the current identity for PNG download naming.
    // Populate Interactive Card
    uiFront.innerHTML = getCardTemplate(true, s); // Injects data into the visible 3D viewer.
    uiBack.innerHTML = getCardTemplate(false, s); // Injects data into the visible 3D viewer.
    // Populate Hidden Buffer
    captureFront.innerHTML = getCardTemplate(true, s); // Injects data into the off-screen capture buffer.
    captureBack.innerHTML = getCardTemplate(false, s); // Injects data into the off-screen capture buffer.
    // Show Preview
    inlinePreviewArea.classList.remove('hidden'); // Reveals the 3D preview window.
    inlinePreviewArea.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Centers the identity card in the staff's view.
    // Pre-generate Snapshot
    const buffer = document.getElementById('id-card-render-buffer'); // Selects the off-screen blueprint.
    await Promise.all(Array.from(buffer.querySelectorAll('img')).map(img => { // Ensures all student media is rasterized before capture.
        if (img.complete) return Promise.resolve();
        return new Promise(res => { img.onload = res; img.onerror = res; });
    }));
    html2canvas(buffer, { useCORS: true, scale: 3, backgroundColor: null }).then(canvas => { // Triggers the high-resolution rasterization engine.
        btnDownloadImg.onclick = () => { // Registers the final download action.
            const link = document.createElement('a'); // Creates a temporary resource link.
            link.download = `ID_CARD_${currentPreviewUID}.png`; // Sets the institutional filename.
            link.href = canvas.toDataURL("image/png"); // Converts the canvas to a binary PNG stream.
            link.click(); // Initiates the file save.
        };
    });
}
btnFlip.onclick = () => flippableCard.classList.toggle('is-flipped'); // Action to rotate the 3D identity card.
closePreviewBtn.onclick = () => inlinePreviewArea.classList.add('hidden'); // Action to dismiss the identity viewer.
loadStudents(); // Bootstraps the initial render.
connectDashboardLiveStream(); // Subscribes to instant staff updates without polling.
