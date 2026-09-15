document.addEventListener('DOMContentLoaded', () => {
    let activeBatch = null;
    let activeColumn = null;
    let activeSessionId = null;
    let activeSessionSignature = '';
    let presentUIDs = new Set();
    let roster = [];

    const selectedLabel = document.getElementById('selected-batch-label');
    const selectedSessionLabel = document.getElementById('selected-session-label');
    const statusBadge = document.getElementById('session-status');
    const closeSessionBtn = document.getElementById('btn-close-live-session');
    const rosterTable = document.getElementById('student-list');
    const searchInput = document.getElementById('db-search');

    const qrVideo = document.getElementById('qr-video');
    const qrCanvas = document.getElementById('qr-canvas');
    const ctx = qrCanvas.getContext('2d');
    const hud = document.getElementById('scanner-hud');
    const authResultCard = document.getElementById('auth-result-card');
    const offlineMsg = document.querySelector('.scanner-offline-msg');

    let streamActive = false;
    let scanningLock = false;
    let lastScanFrameAt = 0;
        let staffEventSource = null;
    async function canReconnectStaffStream() {
        try {
            const res = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
            return res.ok;
        } catch {
            return true;
        }
    }

    function setStatusBadge(text, tone = 'idle') {
        statusBadge.textContent = text;
        if (tone === 'active') {
            statusBadge.style.color = '#10b981';
            statusBadge.style.background = 'rgba(16, 185, 129, 0.1)';
            statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            statusBadge.style.animation = 'pulse 2s infinite';
            return;
        }
        statusBadge.style.color = '';
        statusBadge.style.background = '';
        statusBadge.style.borderColor = '';
        statusBadge.style.animation = 'none';
    }

    function setWaitingState(message = 'Waiting for a live class', detail = 'Start a class from Teacher Console to activate this terminal.') {
        activeBatch = null;
        activeColumn = null;
        activeSessionId = null;
        activeSessionSignature = '';
        presentUIDs = new Set();
        roster = [];
        selectedLabel.textContent = 'Waiting';
        if (closeSessionBtn) {
            closeSessionBtn.classList.add('hidden');
            closeSessionBtn.disabled = true;
        }
        if (selectedSessionLabel) {
            selectedSessionLabel.textContent = 'Not started';
        }
        setStatusBadge(message, 'idle');
        authResultCard.classList.add('hidden');
        if (offlineMsg) {
            const detailLines = offlineMsg.querySelectorAll('div');
            if (detailLines[1]) detailLines[1].textContent = 'Scanner is waiting';
            if (detailLines[2]) detailLines[2].textContent = detail;
            offlineMsg.classList.remove('hidden');
        }
        renderRoster([], 'No live session yet. Once the teacher starts attendance, the roster will appear here.');
    }

    function stopScanner() {
        streamActive = false;
        scanningLock = false;
        lastScanFrameAt = 0;
        const currentStream = qrVideo.srcObject;
        if (currentStream && typeof currentStream.getTracks === 'function') {
            currentStream.getTracks().forEach((track) => track.stop());
        }
        qrVideo.srcObject = null;
        qrVideo.classList.add('hidden');
        hud.classList.add('hidden');
        authResultCard.classList.add('hidden');
    }

    async function startScanner() {
        if (streamActive || !activeSessionId) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            qrVideo.srcObject = stream;
            qrVideo.classList.remove('hidden');
            hud.classList.remove('hidden');
            if (offlineMsg) offlineMsg.classList.add('hidden');
            streamActive = true;
            await qrVideo.play();
            requestAnimationFrame(tick);
        } catch (error) {
            setStatusBadge('Camera unavailable', 'idle');
            alert('Camera access is blocked or unavailable.');
        }
    }

    async function loadRoster() {
        if (!activeSessionId) {
            renderRoster([], 'No live session yet. Once the teacher starts attendance, the roster will appear here.');
            return;
        }
        const response = await fetch(`/api/sessions/${activeSessionId}/roster`, { cache: 'no-store' });
        const payload = await response.json();
        roster = Array.isArray(payload.roster) ? payload.roster : [];
        presentUIDs = new Set(
            roster
                .filter((student) => Number(student.attendance_status || 0) > 0)
                .map((student) => student.student_uid)
        );
        renderRoster(filterRoster(searchInput.value.trim()));
    }

    function filterRoster(query) {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return roster;
        return roster.filter((student) =>
            String(student.name || '').toLowerCase().includes(normalized)
            || String(student.student_uid || '').toLowerCase().includes(normalized)
        );
    }

    function renderRoster(list, emptyMessage = 'No students are loaded for the current session yet.') {
        if (!Array.isArray(list) || list.length === 0) {
            rosterTable.innerHTML = `
                <tr>
                    <td colspan="4" style="padding: 18px 14px; color: var(--text-secondary); text-align: center;">
                        ${emptyMessage}
                    </td>
                </tr>
            `;
            return;
        }

        rosterTable.innerHTML = list.map((student) => {
            const attendanceStatus = Number(student.attendance_status || 0);
            const isPresent = presentUIDs.has(student.student_uid);
            const statusLabel = attendanceStatus === 2
                ? 'Late'
                : isPresent
                    ? 'Present'
                    : 'Not marked';
            const statusClass = attendanceStatus === 2
                ? 'warning'
                : isPresent
                    ? 'present'
                    : 'idle';
            return `
                <tr>
                    <td style="font-family: monospace; color: #3b82f6; font-weight: 700;">${student.student_uid}</td>
                    <td style="font-weight: 600;">${student.name}</td>
                    <td>
                        <span id="status-${student.student_uid}" class="status-pill ${statusClass}">
                            ${statusLabel}
                        </span>
                    </td>
                    <td class="host-only-col">
                        <button class="btn-glass sm" style="padding: 4px 10px; font-size: 0.76rem;" onclick="viewRecord('${student.secure_token}')">Open</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function applySession(session) {
        if (!session || !session.session_id || !session.batch_id) {
            stopScanner();
            setWaitingState('Session unavailable', 'No valid batch is attached to the live session. Start the class again from Teacher Console.');
            return;
        }

        const nextSignature = `${session.session_id}:${session.batch_id}:${session.is_late}`;
        const sessionChanged = activeSessionSignature !== nextSignature;

        activeSessionId = session.session_id;
        activeBatch = session.batch_id;
        activeColumn = session.column_name;
        activeSessionSignature = nextSignature;
        if (closeSessionBtn) {
            closeSessionBtn.classList.remove('hidden');
            closeSessionBtn.disabled = false;
        }

        selectedLabel.textContent = String(activeBatch || 'Waiting').toUpperCase();
        if (selectedSessionLabel) {
            selectedSessionLabel.textContent = session.session_name || activeColumn || 'Live';
        }
        setStatusBadge(
            session.is_late ? `Late entry active: ${session.session_name || activeColumn}` : `Active session: ${session.session_name || activeColumn}`,
            'active'
        );

        if (sessionChanged) {
            presentUIDs = new Set();
            await loadRoster();
        }
        await startScanner();
    }

    async function syncActiveSession() {
        try {
            const response = await fetch('/api/sessions/current', { cache: 'no-store' });
            const payload = await response.json();
            if (payload.status === 'success' && payload.data && payload.data.batch_id) {
                await applySession(payload.data);
                if (activeSessionId) {
                    await loadRoster();
                }
            } else if (activeSessionId) {
                stopScanner();
                setWaitingState('Session closed', 'Teacher Console closed the active session. Start a new class there to reactivate scanning.');
            } else {
                setWaitingState();
            }
        } catch (error) {
            console.error('Scanner session sync failed:', error);
            if (!activeSessionId) {
                setWaitingState('Scanner offline', 'The live session feed could not be loaded. Refresh after the server reconnects.');
            }
        }
    }

    function startStaffLiveSync() {
        if (staffEventSource) return;
        try {
            staffEventSource = new EventSource('/api/staff/live/stream');
            staffEventSource.onmessage = async (event) => {
                let data = null;
                try {
                    data = JSON.parse(event.data || '{}');
                } catch (_error) {
                    return;
                }

                if (!data || !data.type) return;

                if (data.type === 'attendance_marked' && activeSessionId && Number(data.session_id) === Number(activeSessionId)) {
                    await loadRoster();
                    return;
                }

                if (data.type === 'session_started' || data.type === 'session_closed' || data.type === 'session_late_mode' || data.type === 'system_reset' || data.type === 'student_records_updated' || data.type === 'batch_updated') {
                    await syncActiveSession();
                }
            };

            staffEventSource.onerror = () => {
                if (staffEventSource) {
                    staffEventSource.close();
                    staffEventSource = null;
                }
                void (async () => {
                    if (await canReconnectStaffStream()) {
                        window.setTimeout(startStaffLiveSync, 2000);
                    }
                })();
            };
        } catch (_error) {
            void (async () => {
                if (await canReconnectStaffStream()) {
                    window.setTimeout(startStaffLiveSync, 2000);
                }
            })();
        }
    }

    function startLiveSessionWatch() {
        syncActiveSession();
        startStaffLiveSync();
    }

    function tick() {
        const now = Date.now();
        if (now - lastScanFrameAt < 180) {
            if (streamActive) requestAnimationFrame(tick);
            return;
        }
        lastScanFrameAt = now;

        if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
            qrCanvas.width = Math.min(720, qrVideo.videoWidth || 720);
            qrCanvas.height = Math.min(720, qrVideo.videoHeight || 720);
            ctx.drawImage(qrVideo, 0, 0, qrCanvas.width, qrCanvas.height);
            const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

            if (code && !scanningLock && activeSessionId) {
                const targetBox = hud.querySelector('.target-box');
                if (targetBox) targetBox.style.borderColor = '#10b981';
                scanningLock = true;
                onScanSuccess(code.data);
            }
        }

        if (streamActive) requestAnimationFrame(tick);
    }

    async function onScanSuccess(decodedText) {
        const token = String(decodedText || '').split('/').pop();

        try {
            const response = await fetch('/api/verify_qr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    session_id: activeSessionId,
                    batch_id: activeBatch
                })
            });
            const result = await response.json();

            if (result.status === 'success') {
                const student = result.data;
                presentUIDs.add(student.student_uid);
                authResultCard.classList.remove('hidden');
                document.getElementById('verified-name').textContent = student.name;
                document.getElementById('verified-uid').textContent = student.student_uid;
                document.getElementById('verified-photo').src = student.photo_path;
                if (result.already_marked) {
                    setStatusBadge(`${student.name} was already marked for this session`, 'active');
                } else {
                    setStatusBadge(`${student.name} marked ${Number(result.attendance_status) === 2 ? 'late' : 'present'}`, 'active');
                }
                renderRoster(filterRoster(searchInput.value.trim()));
            } else {
                alert(`Scan failed: ${result.error || result.message || 'Unknown error'}`);
                const targetBox = hud.querySelector('.target-box');
                if (targetBox) targetBox.style.borderColor = '#ef4444';
            }
        } catch (error) {
            console.error('Verification backend failed', error);
            alert('Scan failed: network or server error.');
        }

        window.setTimeout(() => {
            scanningLock = false;
            const targetBox = hud.querySelector('.target-box');
            if (targetBox) targetBox.style.borderColor = 'rgba(59, 130, 246, 0.5)';
            authResultCard.classList.add('hidden');
        }, 2500);
    }

    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            renderRoster(filterRoster(event.target.value));
        });
    }

    if (closeSessionBtn) {
        closeSessionBtn.addEventListener('click', async () => {
            if (!activeSessionId) return;
            if (!confirm('Close the active session now?')) return;

            closeSessionBtn.disabled = true;
            try {
                const response = await fetch(`/api/sessions/${activeSessionId}/close`, { method: 'POST' });
                const payload = await response.json();
                if (!response.ok || payload.status !== 'success') {
                    throw new Error(payload.error || payload.message || 'Could not close the current session.');
                }
                stopScanner();
                setWaitingState('Session closed', 'The live session has been closed. Start a new class from Teacher Console to reactivate scanning.');
            } catch (error) {
                alert(error.message || 'Could not close the current session.');
                closeSessionBtn.disabled = false;
            }
        });
    }

    const staffCardForm = document.getElementById('staff-card-form');
    if (staffCardForm) {
        const status = document.getElementById('staff-card-status');
        const preview = document.getElementById('staff-card-preview');
        const qrImg = document.getElementById('staff-card-qr');
        const nameEl = document.getElementById('staff-card-name');
        const userEl = document.getElementById('staff-card-user');
        const roleEl = document.getElementById('staff-card-role');
        const scanEl = document.getElementById('staff-card-scan');
        const openQr = document.getElementById('staff-card-open-qr');
        const openScan = document.getElementById('staff-card-open-scan');

        staffCardForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!status || !preview || !qrImg || !nameEl || !userEl || !roleEl || !scanEl) {
                alert('Staff card preview UI is incomplete on this page.');
                return;
            }

            status.textContent = 'Creating...';

            const payload = Object.fromEntries(new FormData(staffCardForm));
            const response = await fetch('/api/staff/cards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.status !== 'success') {
                status.textContent = result.error || 'Could not create staff card.';
                return;
            }

            const staff = result.staff;
            status.textContent = 'Staff card created.';
            preview.classList.remove('hidden');
            qrImg.src = staff.qr_path;
            nameEl.textContent = staff.full_name || staff.username;
            userEl.textContent = `Username: ${staff.username}`;
            roleEl.textContent = `Role: ${staff.role}`;
            scanEl.textContent = staff.scan_url;
            if (openQr) openQr.href = staff.qr_path || '#';
            if (openScan) openScan.href = staff.scan_url || '#';
            staffCardForm.reset();
        });
    }

    setWaitingState();
    startLiveSessionWatch();
    window.addEventListener('beforeunload', () => {
        if (staffEventSource) {
            staffEventSource.close();
            staffEventSource = null;
        }
        stopScanner();
    });
});

// Helper for 'VIEW' button in Roster (Populates 3D Pro Card Preview)
window.viewRecord = async function(token) {
    const res = await fetch('/api/students/preview', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ token })
    });
    const result = await res.json();
    if(result.status === 'success') {
        const modal = document.getElementById('pro-card-modal');
        const data = result.data;
        document.getElementById('ui-card-front').innerHTML = `
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
                <div class="rmc-id-batch">${data.current_batch || "GENERAL BATCH"}</div>
                <div class="rmc-id-middle-grid">
                    <div class="middle-item qr-zone"><img src="${data.qr_path}" alt="QR"></div>
                    <div class="middle-item photo-zone"><img src="${data.photo_path}" alt="Photo"></div>
                </div>
                <div class="rmc-id-details">
                    <div class="detail-name">${String(data.name || "Student").toUpperCase()}</div>
                    <div class="detail-uid">${data.student_uid || "UID-N/A"}</div>
                    <div class="detail-secondary-row">
                        <span>FNO: ${data.phone || "-"}</span>
                        <span>FBC: ${data.fbc_no || "-"}</span>
                    </div>
                    <div class="detail-parent">Father's Name: ${data.father_name || "-"}</div>
                    <div class="detail-address">ADDRESS ON FILE (RMC DIGITAL VAULT)</div>
                </div>
                <div class="rmc-id-footer">RMC</div>
            </div>
        `;
        document.getElementById('ui-card-back').innerHTML = `
            <div class="id-card-pro">
                <div class="id-watermark">RMC</div>
                <div class="id-brand-banner id-brand-banner-back">
                    <div class="id-brand-title id-brand-title-sm">OFFICIAL RECORDS</div>
                    <div class="id-brand-tagline">RMC Internal Sheet</div>
                </div>
                <div class="id-field-list id-back-fields">
                    <div class="id-field id-field-full"><label>Father's Name</label><span class="id-value-strong">${data.father_name || "-"}</span></div>
                    <div class="id-field id-field-inline"><label>Guardian Phone</label><span>${data.guardian_phone || "-"}</span></div>
                    <div class="id-field id-field-inline"><label>Class</label><span>${data.student_class || "-"}</span></div>
                    <div class="id-field id-field-full"><label>Current Batch</label><span class="id-value-strong">${data.current_batch || "N/A"}</span></div>
                    <div class="id-field id-field-full"><label>Residential Address</label><span class="id-value-compact">${data.address || "-"}</span></div>
                </div>
                <div class="id-footer-strip"><span>riteshmathematics.in</span><div class="id-footer-tag">Verified</div></div>
            </div>
        `;
        
        const deleteBtn = document.getElementById('btn-purge-record');
        deleteBtn.onclick = async () => {
            if(confirm("This will permanently delete the student and related files. Continue?")) {
                await fetch('/api/delete_student', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({student_uid: data.student_uid}) });
                window.location.reload();
            }
        };

        modal.classList.remove('hidden');
    }
};

