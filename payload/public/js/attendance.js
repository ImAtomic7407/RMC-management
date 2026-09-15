// RMC ATTENDANCE SYSTEM ENGINE
let html5QrCode; // Global instance for the high-performance QR decoding engine.
const attendanceResult = document.getElementById('attendance-result'); // Selects the hidden 3D preview area for scan results.
const btnResetScan = document.getElementById('btn-reset-scan'); // Selects the 'Next Scan' button to clear the current result.
const scanTimeLabel = document.getElementById('scan-time'); // Selects the temporal label for the scan event.
const btnFlip = document.getElementById('btn-flip-card'); // Selects the toggle for the 3D result card.
const flippableCard = document.getElementById('flippable-card'); // Selects the structural container for the 3D-rotated ID.
const uiFront = document.getElementById('ui-card-front'); // Target for the front-face identity injection.
const uiBack = document.getElementById('ui-card-back'); // Target for the back-face administrative data injection.
// CONFIG
const qrConfig = { // Optimizes the scanning engine for high-resolution industrial performance.
    fps: 20, // Sets the frames-per-second to 20 for fluid real-time detection.
    qrbox: { width: 250, height: 250 }, // Defines the active scanning viewport for QR localization.
    aspectRatio: 1.0 // Forces a 1:1 square aspect ratio for consistent decoding.
};
const btnManualStart = document.getElementById('btn-manual-start'); // Selects the fallback button for manual camera engagement.
function startScanner() { // Orchestrates the automated camera detection and scanner bootstrap.
    html5QrCode = new Html5Qrcode("qr-reader"); // Binds the scanning logic to the visual 'qr-reader' div.
    btnManualStart.classList.add('hidden'); // Hides the manual trigger once the engine attempts activation.
    // First try to find any camera
    Html5Qrcode.getCameras().then(devices => { // Enumerates all available imaging hardware on the device.
        if (devices && devices.length > 0) { // If cameras are detected...
            // Prefer back camera if available
            let cameraId = devices[0].id; // Defaults to the first discovered camera.
            const backCamera = devices.find(device => // Searches for specialized environmental (back) cameras.
                device.label.toLowerCase().includes('back') || // Matches the 'back' label common on mobile.
                device.label.toLowerCase().includes('rear') || // Matches the 'rear' label common on tablets.
                device.label.toLowerCase().includes('environment') // Matches the standard W3C 'environment' descriptor.
            );
            if (backCamera) cameraId = backCamera.id; // Prioritizes the rear camera for ergonomic scanning.
            html5QrCode.start( // Engages the imaging device and begins the decoding loop.
                cameraId, 
                qrConfig,
                onScanSuccess
            ).catch(err => { // Handles hardware-level engagement failures.
                console.error("Camera start failed", err);
                btnManualStart.classList.remove('hidden'); // Restores the manual button for user retry.
            });
        } else {
            console.error("No cameras found."); // Logs absence of imaging hardware.
            btnManualStart.classList.remove('hidden'); // Restores the manual button.
        }
    }).catch(err => {
        console.error("getCameras failed", err); // Handles low-level enumeration failures.
        // Last resort fallback
        html5QrCode.start({ facingMode: "user" }, qrConfig, onScanSuccess) // Attempts a generic 'user' (front) camera fallback.
            .catch(e => btnManualStart.classList.remove('hidden'));
    });
}
btnManualStart.onclick = () => startScanner(); // Manually re-triggers the scanning engine.
// 🃏 DUAL KEY TEMPLATE (Keep in sync with dashboard.js)
function getCardTemplate(isFront, s) { // Generates the high-fidelity HTML for the scanned student's identity.
    if (isFront) { // Public identity face.
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
            </div>`; // Returns the visual 3D identity face.
    } else { // Administrative face.
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
            </div>`; // Returns the back-face administrative data.
    }
}
async function onScanSuccess(decodedText) { // Triggered when a valid QR token is localized and decoded.
    if (navigator.vibrate) navigator.vibrate(100); // Provides haptic feedback (100ms rumble) to confirm capture.
    await html5QrCode.pause(true); // Temporarily suspends the scanning loop to process the current token.
    try {
        const response = await fetch('/api/verify_qr', { // Dispatches the token to the backend for institutional verification.
            method: 'POST', // Uses POST to protect the token data.
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ token: decodedText }) // Wraps the raw token in a structured JSON payload.
        });
        const result = await response.json(); // Parses the verification result.
        if (result.status === 'success') { // If the token corresponds to a valid, active student...
            uiFront.innerHTML = getCardTemplate(true, result.data); // Injects the student's front-face data into the 3D preview.
            uiBack.innerHTML = getCardTemplate(false, result.data); // Injects the student's back-face data into the 3D preview.
            attendanceResult.classList.remove('hidden'); // Reveals the 3D result window.
            scanTimeLabel.innerText = new Date().toLocaleTimeString(); // Logs the exact moment of institutional check-in.
            setTimeout(() => {
                attendanceResult.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Centers the result card for staff verification.
            }, 100);
        } else {
            alert("INVALID OR EXPIRED QR CODE"); // Alerts the staff of specialized verification failures.
            html5QrCode.resume(); // Restarts the scanning loop for the next attempt.
        }
    } catch (err) {
        alert("SERVER CONNECTION ERROR"); // Handles network or session timeout errors.
        html5QrCode.resume(); // Restarts the scanning loop.
    }
}
btnResetScan.onclick = () => { // Clears the current result and restarts the gatekeeper process.
    attendanceResult.classList.add('hidden'); // Hides the previous result card.
    html5QrCode.resume(); // Resumes active QR localization.
    document.querySelector('.scanner-section').scrollIntoView({ behavior: 'smooth' }); // Returns focus to the live camera viewport.
};
btnFlip.onclick = () => flippableCard.classList.toggle('is-flipped'); // Toggles the 3D rotation of the result card.
window.addEventListener('DOMContentLoaded', startScanner); // Automatically engages the engine when the DOM is fully rasterized.
