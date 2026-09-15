const studentsTbody = document.getElementById('students-tbody'); // Selects the table body for administrative student record injection.
const idCardModal = document.getElementById('id-card-modal'); // Selects the modal overlay for identity card verification.
const idCardPro = document.getElementById('id-card-to-download'); // Target container for the high-fidelity identity card visualization.
const closeModal = document.getElementById('close-modal'); // Selects the dismiss action for the identity card revelation.
const btnDownloadImg = document.getElementById('btn-download-img'); // Selects the master download trigger for the PNG snapshot.
let allStudents = []; // Local memory cache for institutional student record data.
// FETCH STUDENTS FROM BACKEND
async function loadStudents() { // Orchestrates the real-time record synchronization between the staff portal and the SQLite backend.
    try {
        const response = await fetch('/api/students'); // Requests the full student identity bundle from the server.
        const data = await response.json(); // Parses the institutional data stream.
        allStudents = data; // Updates the local memory cache with fresh record sets.
        renderDashboard(data); // Triggers the visual reconstruction of the administrative dashboard.
    } catch (e) {
        console.warn("ADMIN DASHBOARD OFFLINE: Could not refresh live data.", e); // Logs communication interruptions.
    }
}

let adminLiveStream = null;
function connectAdminLiveStream() {
    if (adminLiveStream) return;
    try {
        adminLiveStream = new EventSource('/api/staff/live/stream');
        adminLiveStream.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || '{}');
                const type = String(payload.type || '');
                if (!type || type === 'heartbeat') return;
                loadStudents();
            } catch {
                loadStudents();
            }
        };
        adminLiveStream.onerror = () => {
            if (adminLiveStream) {
                adminLiveStream.close();
                adminLiveStream = null;
            }
            window.setTimeout(connectAdminLiveStream, 2000);
        };
    } catch (err) {
        console.warn('Failed to open admin live stream', err);
        window.setTimeout(connectAdminLiveStream, 2000);
    }
}
function renderDashboard(students) { // Reconstructs the administrative interface based on current record data.
    // 1. Update stats
    document.getElementById('total-students').innerText = students.length; // Aggregates institutional enrollment totals.
    document.getElementById('jee-count').innerText = students.filter(s => s.aspiration === 'JEE').length; // Segregates JEE examination candidates.
    document.getElementById('neet-count').innerText = students.filter(s => s.aspiration === 'NEET').length; // Segregates NEET examination candidates.
    // 2. Render table
    studentsTbody.innerHTML = ''; // Purges the current table state to prevent identity duplication.
    students.forEach(s => { // Iterates through each record for administrative table injection.
        const tr = document.createElement('tr'); // Creates a new identity record row.
        tr.className = 'tr-hover'; // Applies interactive hover styles for staff focus.
        tr.innerHTML = `
            <td><img src="${s.photo_path}" class="std-photo" alt="Student"></td>
            <td>
                <div class="std-info">
                    <strong>${s.name.toUpperCase()}</strong>
                    <span class="std-phone">${s.phone} | ${s.aspiration}</span>
                    <span class="std-class-tag">${s.student_class.toUpperCase()}</span>
                </div>
            </td>
            <td><span class="id-status font-mono">${s.student_uid}</span></td>
            <td><span class="join-date">${formatDate(s.created_at)}</span></td>
            <td>
                <button class="btn-sm-view" onclick="viewIdCard('${s.student_uid}')">VIEW CARD</button>
            </td>
        `; // Injects student metadata, identification, and temporal registration keys.
        studentsTbody.appendChild(tr); // Mounts the row into the administrative console.
    });
}
function formatDate(dateStr) { // Utility to transform server-side ISO strings into institutional human-readable dates.
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); // Formats to standard British academic notation.
}
// SEARCH / FILTER LOGIC
function filterTable() { // Real-time multi-vector filtering algorithm for rapid student localization.
    const query = document.getElementById('search-input').value.toLowerCase(); // Captures the staff's focus query.
    const filtered = allStudents.filter(s => 
        s.name.toLowerCase().includes(query) || 
        s.phone.includes(query) || 
        s.student_uid.toLowerCase().includes(query)
    ); // Evaluates records against Name, Phone, and UID vectors.
    renderDashboard(filtered); // Re-renders the console with the filtered dataset.
}
// VIEW ID CARD FROM DASHBOARD
function viewIdCard(uid) { // Populates and reveals the high-fidelity 3D ID card for a specific student.
    const s = allStudents.find(student => student.student_uid === uid); // Locates target identity in the local cache.
    if(!s) return;
    document.getElementById('card-name').innerText = s.name.toUpperCase(); // Injects student name into the visualization.
    document.getElementById('card-phone').innerText = s.phone; // Injects contact data for verification.
    document.getElementById('card-asp').innerText = s.aspiration; // Injects examination target.
    document.getElementById('card-fname').innerText = s.father_name || "-"; // Injects guardian data.
    document.getElementById('card-class').innerText = s.student_class || "-"; // Injects academic class.
    document.getElementById('card-address').innerText = s.address || "-"; // Injects residential record.
    document.getElementById('card-uid').innerText = s.student_uid; // Injects the primary Trio identification key.
    document.getElementById('card-photo').src = s.photo_path; // Maps the student photo resource.
    document.getElementById('card-qr').src = s.qr_path; // Maps the verification QR resource.
    idCardModal.classList.remove('hidden'); // Reveals the identity revelation modal.
}
// 3D TILT EFFECT REMOVED FOR SIMPLICITY // Note: Legacy tilt code omitted for performance stability in administrative views.
closeModal.addEventListener('click', () => { // Binds the dismissal action to the identity modal.
    idCardModal.classList.add('hidden');
});
// DOWNLOAD IMAGE LOGIC
btnDownloadImg.addEventListener('click', () => { // Initiates the high-resolution PNG snapshots for physical card printing.
    const studentName = document.getElementById('card-name').innerText; // Captures name for filename generation.
    html2canvas(document.getElementById('id-card-to-download'), { // Triggers the rasterization engine on the identity DOM.
        useCORS: true, // Enables cross-origin image retrieval for student photos and QRs.
        scale: 2, // Enhances print resolution to high-DPI standards.
        backgroundColor: null // Maintains transparency in the identity card shadow layers.
    }).then(canvas => {
        const link = document.createElement('a'); // Creates a temporary file link.
        link.download = `ID_CARD_${studentName.replace(/\s+/g, '_')}.png`; // Sets the institutional naming convention.
        link.href = canvas.toDataURL("image/png"); // Converts the blueprint to a binary image stream.
        link.click(); // Initiates the file save sequence.
    });
});
// INITIAL LOAD
loadStudents(); // Bootstraps the institutional data sync engine.
connectAdminLiveStream(); // Subscribes to instant staff changes without polling.
