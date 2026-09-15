const leadTable = document.getElementById("lead-table");
const idRequestTable = document.getElementById("id-request-table");
const noticeFeed = document.getElementById("notice-feed");
const absenteeBatchSelect = document.getElementById("absentee-batch-select");
const absenteeSessionSelect = document.getElementById("absentee-session-select");
const absenteeExportBtn = document.getElementById("absentee-export-btn");
const absenteeExportStatus = document.getElementById("absentee-export-status");
const testReportBatchSelect = document.getElementById("test-report-batch-select");
const testReportExportBtn = document.getElementById("test-report-export-btn");
const testReportStatus = document.getElementById("test-report-status");
const notificationTabs = Array.from(document.querySelectorAll(".notification-tab"));
const notificationPanels = Array.from(document.querySelectorAll(".notification-panel"));
const idPreviewModal = document.getElementById("id-preview-modal");
const idPreviewClose = document.getElementById("id-preview-close");
const idPreviewCard = document.getElementById("id-preview-card");

function setTabBadge(tabKey, count) {
  const badge = document.getElementById(`tab-badge-${tabKey}`);
  if (!badge) return;
  const safe = Math.max(0, Number(count) || 0);
  if (safe > 0) {
    badge.textContent = String(safe);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function getIdFrontTemplate(student) {
  return `
    <div class="id-card-pro custom-rmc-id">
      <div class="rmc-id-topbar">
        <div class="rmc-id-logo-area">
          <div class="rmc-logomark"><strong>RMC</strong><span>INSTITUTE</span></div>
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
      <div class="rmc-id-batch">${escapeCell(student.current_batch || "GENERAL BATCH")}</div>
      <div class="rmc-id-middle-grid">
        <div class="middle-item qr-zone"><img src="${escapeCell(student.qr_path || "")}" alt="QR"></div>
        <div class="middle-item photo-zone"><img src="${escapeCell(student.photo_path || "")}" alt="Photo"></div>
      </div>
      <div class="rmc-id-details">
        <div class="detail-name">${escapeCell(String(student.name || "Student").toUpperCase())}</div>
        <div class="detail-uid">${escapeCell(student.student_uid || "UID-N/A")}</div>
        <div class="detail-secondary-row">
          <span>FNO: ${escapeCell(student.phone || "-")}</span>
          <span>FBC: ${escapeCell(student.fbc_no || "-")}</span>
        </div>
        <div class="detail-parent">Father's Name: ${escapeCell(student.father_name || "-")}</div>
        <div class="detail-address">ADDRESS ON FILE (RMC DIGITAL VAULT)</div>
      </div>
      <div class="rmc-id-footer">RMC</div>
    </div>
  `;
}

function fmtTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function escapeCell(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function prettifySource(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized || normalized === "id_card_permission_request") {
    return "ID Card Request";
  }
  return normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

async function refreshLeads() {
  const res = await fetch("/api/leads");
  const payload = await res.json();
  if (!payload || payload.status !== "success") {
    if (leadTable) leadTable.innerHTML = "";
    if (idRequestTable) idRequestTable.innerHTML = "";
    return;
  }

  const rows = payload.leads || [];
  const leadRows = rows.filter((l) => {
    const source = String(l.source || "").toLowerCase();
    return source && source !== "id_card_permission_request";
  });
  const idRows = rows.filter((l) => {
    const source = String(l.source || "").toLowerCase();
    return !source || source === "id_card_permission_request";
  });
  setTabBadge("leads", leadRows.filter((l) => Number(l.is_read) !== 1).length);
  setTabBadge("id-requests", idRows.filter((l) => Number(l.is_read) !== 1).length);

  if (leadTable) {
    leadTable.innerHTML = leadRows.map((l) => {
      const status = Number(l.is_read) === 1 ? "read" : "new";
      const pill = status === "read"
        ? `<span class="pill read">Read</span>`
        : `<span class="pill new">New</span>`;

      return `
        <tr class="glow-on-hover">
          <td>${pill}</td>
          <td><span class="pill read">${escapeCell(prettifySource(l.source))}</span></td>
          <td><span class="name-bold">${escapeCell(l.name)}</span></td>
          <td class="mono">${escapeCell(l.phone || "-")}</td>
          <td><div class="msg">${escapeCell(l.message || "-")}</div></td>
          <td>${escapeCell(fmtTime(l.created_at))}</td>
          <td>
            ${status === "read"
              ? `<button class="btn-glass sm" disabled style="opacity:0.6; cursor:not-allowed;">Done</button>`
              : `<button class="btn-glass sm info" onclick="markRead(${l.id})">Mark Read</button>`
            }
          </td>
        </tr>
      `;
    }).join("");

    if (!leadRows.length) {
      leadTable.innerHTML = `<tr><td colspan="7" class="msg">No lead pings yet.</td></tr>`;
    }
  }

  if (idRequestTable) {
    idRequestTable.innerHTML = idRows.map((l) => {
    const status = Number(l.is_read) === 1 ? "read" : "new";
    const source = String(l.source || "").toLowerCase();
    const isIdRequest = source === "id_card_permission_request" || !source;
    const approved = Number(l.id_card_allowed) === 1;
    const pill = status === "read"
      ? `<span class="pill read">Read</span>`
      : `<span class="pill new">New</span>`;
    const idCardPill = approved
      ? `<span class="pill read">ID Allowed</span>`
      : `<span class="pill new">ID Pending</span>`;
    const message = escapeCell(l.message || "-");
    const permissionCell = isIdRequest ? (approved ? "Allowed" : "Pending") : "-";
    const actionButtons = [
      status === "read"
        ? `<button class="btn-glass sm" disabled style="opacity:0.6; cursor:not-allowed;">Done</button>`
        : `<button class="btn-glass sm info" onclick="markRead(${l.id})">Mark Read</button>`
    ];

    if (isIdRequest) {
      actionButtons.push(`
          <div style="height:6px"></div>
          ${idCardPill}
          <div style="height:6px"></div>
          <button class="btn-glass sm" onclick="previewIdByPhone('${escapeCell(l.phone || "")}')">Preview ID</button>
          <div style="height:6px"></div>
          <button class="btn-glass sm ${approved ? "danger" : "info"}"
            onclick="setIdApproval(${l.id}, ${approved ? "false" : "true"})">
            ${approved ? "Block ID Card" : "Allow ID Card"}
          </button>
      `);
    }

    return `
      <tr class="glow-on-hover">
        <td>${pill}</td>
        <td><span class="pill ${isIdRequest ? (approved ? "read" : "new") : "read"}">${escapeCell(prettifySource(l.source))}</span></td>
        <td><span class="name-bold">${escapeCell(l.name)}</span></td>
        <td class="mono">${escapeCell(l.phone || "-")}</td>
        <td><div class="msg">${message}</div></td>
        <td>${permissionCell}</td>
        <td>${escapeCell(fmtTime(l.created_at))}</td>
        <td>
          ${actionButtons.join("")}
        </td>
      </tr>
      `;
  }).join("");

    if (!idRows.length) {
      idRequestTable.innerHTML = `<tr><td colspan="8" class="msg">No ID card requests yet.</td></tr>`;
    }
  }
}

async function loadNotices() {
  if (!noticeFeed) return;
  noticeFeed.innerHTML = '<p class="msg">Loading notices...</p>';
  try {
    const res = await fetch("/api/notices", { headers: { Accept: "application/json" } });
    const payload = await res.json();
    const notices = Array.isArray(payload?.notices) ? payload.notices : [];
    setTabBadge("notices", notices.length);
    noticeFeed.innerHTML = notices.length ? notices.map((notice) => `
      <article class="glass-container notice-card">
        <div class="meta-line">${escapeCell(notice.target_batch || "ALL")} · ${escapeCell(fmtTime(notice.created_at))}</div>
        <h4 class="name-bold">${escapeCell(notice.title || "Notice")}</h4>
        <p class="msg">${escapeCell(notice.content || "")}</p>
        <div class="btn-group" style="margin-top:10px;">
          <button class="btn-glass sm danger" onclick="deleteNotice(${Number(notice.id) || 0})">Delete</button>
        </div>
      </article>
    `).join("") : '<p class="msg">No notices available yet.</p>';
  } catch {
    noticeFeed.innerHTML = '<p class="msg">Could not load notices right now.</p>';
  }
}

async function deleteNotice(id) {
  const noticeId = Number(id);
  if (!noticeId) return;
  if (!window.confirm("Delete this notice?")) return;
  const res = await fetch(`/api/notices/${noticeId}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.status !== "success") {
    alert(payload.error || "Could not delete notice.");
    return;
  }
  loadNotices().catch(() => null);
}

function setAbsenteeStatus(message) {
  if (absenteeExportStatus) {
    absenteeExportStatus.textContent = message;
  }
}

async function loadAbsenteeBatches() {
  if (!absenteeBatchSelect && !testReportBatchSelect) return;
  const res = await fetch("/api/batches");
  const payload = await res.json().catch(() => []);
  const batches = Array.isArray(payload) ? payload : [];
  const optionsMarkup = `<option value="">Select batch...</option>${batches.map((batch) => `
    <option value="${escapeCell(batch.name)}">${escapeCell(batch.name)}</option>
  `).join("")}`;
  if (absenteeBatchSelect) absenteeBatchSelect.innerHTML = optionsMarkup;
  if (testReportBatchSelect) testReportBatchSelect.innerHTML = optionsMarkup;
}

async function loadAbsenteeSessions() {
  if (!absenteeBatchSelect || !absenteeSessionSelect || !absenteeExportBtn) return;

  const batch = absenteeBatchSelect.value;
  absenteeSessionSelect.disabled = true;
  absenteeExportBtn.disabled = true;
  absenteeSessionSelect.innerHTML = '<option value="">Select closed session...</option>';

  if (!batch) {
    setAbsenteeStatus("Choose a batch to load closed sessions.");
    return;
  }

  setAbsenteeStatus("Loading closed sessions...");
  const res = await fetch(`/api/batches/${encodeURIComponent(batch)}/history`);
  const payload = await res.json().catch(() => []);
  const sessions = Array.isArray(payload) ? payload : [];

  absenteeSessionSelect.innerHTML = '<option value="">Select closed session...</option>';
  sessions.forEach((session) => {
    const option = document.createElement("option");
    option.value = String(session.session_id || "");
    option.textContent = `${session.session_name || "Session"} - ${session.date || "-"}`;
    absenteeSessionSelect.appendChild(option);
  });

  absenteeSessionSelect.disabled = sessions.length === 0;
  setAbsenteeStatus(
    sessions.length
      ? "Select a closed session, then export the absentee follow-up sheet."
      : "No closed sessions found for this batch yet."
  );
}

function updateAbsenteeExportButton() {
  if (!absenteeExportBtn || !absenteeSessionSelect) return;
  absenteeExportBtn.disabled = !absenteeSessionSelect.value;
}

function exportAbsentees() {
  if (!absenteeSessionSelect || !absenteeSessionSelect.value) {
    setAbsenteeStatus("Choose a closed session first.");
    return;
  }
  const sessionId = absenteeSessionSelect.value;
  setAbsenteeStatus("Preparing absentee export...");
  window.location.href = `/api/reports/absentees/export?session_id=${encodeURIComponent(sessionId)}`;
  window.setTimeout(() => {
    setAbsenteeStatus("Download started. Open the CSV in Excel and use the Message Link column.");
  }, 600);
}

function setTestReportStatus(message) {
  if (testReportStatus) {
    testReportStatus.textContent = message;
  }
}

function updateTestReportButton() {
  if (!testReportExportBtn || !testReportBatchSelect) return;
  testReportExportBtn.disabled = !testReportBatchSelect.value;
}

function exportTestReport() {
  if (!testReportBatchSelect || !testReportBatchSelect.value) {
    setTestReportStatus("Choose a batch first.");
    return;
  }
  setTestReportStatus("Preparing test report...");
  window.location.href = `/api/reports/tests/export?batch=${encodeURIComponent(testReportBatchSelect.value)}`;
  window.setTimeout(() => {
    setTestReportStatus("Download started. Each launched test is exported as its own column.");
  }, 600);
}

function setActiveNotificationTab(tabKey) {
  notificationTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabKey);
  });
  notificationPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabKey);
  });
}

async function markRead(id) {
  await fetch(`/api/leads/${id}/read`, { method: "POST" });
  refreshLeads();
}

async function markAllRead() {
  const res = await fetch("/api/leads?unread=1");
  const payload = await res.json();
  if (!payload || payload.status !== "success") return;
  for (const l of payload.leads || []) {
    await fetch(`/api/leads/${l.id}/read`, { method: "POST" });
  }
  refreshLeads();
}

async function setIdApproval(id, allowed) {
  const res = await fetch(`/api/leads/${id}/id-card-approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.status !== "success") {
    alert(payload.error || "Could not update ID card approval.");
    return;
  }
  refreshLeads();
}

async function previewIdByPhone(phone) {
  const safePhone = String(phone || "").trim();
  if (!safePhone) {
    alert("Phone is missing for this request.");
    return;
  }
  if (!idPreviewModal || !idPreviewCard) return;

  idPreviewCard.innerHTML = '<p class="msg">Loading ID preview...</p>';
  idPreviewModal.classList.remove("hidden");

  try {
    const res = await fetch(`/api/students/lookup-by-phone?phone=${encodeURIComponent(safePhone)}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.status !== "success" || !payload.data) {
      throw new Error(payload.error || "No student record found for this phone.");
    }
    idPreviewCard.innerHTML = getIdFrontTemplate(payload.data);
  } catch (error) {
    idPreviewCard.innerHTML = `<p class="msg">${escapeCell(error.message || "Could not load ID preview.")}</p>`;
  }
}

window.refreshLeads = refreshLeads;
window.markRead = markRead;
window.markAllRead = markAllRead;
window.setIdApproval = setIdApproval;
window.exportAbsentees = exportAbsentees;
window.previewIdByPhone = previewIdByPhone;
window.deleteNotice = deleteNotice;

refreshLeads();
loadNotices();
loadAbsenteeBatches().catch(() => setAbsenteeStatus("Could not load batches."));

let leadsLiveStream = null;
let portalLiveStream = null;
async function canReconnectPortalStream() {
  try {
    const res = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
    return res.ok;
  } catch {
    return true;
  }
}

function connectLeadsLiveStream() {
  if (leadsLiveStream) return;
  try {
    leadsLiveStream = new EventSource("/api/leads/stream");
    leadsLiveStream.addEventListener("lead", (evt) => {
      try {
        const payload = JSON.parse(evt.data || "{}");
        const lead = payload.lead;
        if (!lead) return;
        const source = String(lead.source || "").toLowerCase();
        if (source && source !== "id_card_permission_request") return;
        refreshLeads().catch(() => null);
      } catch {
        refreshLeads().catch(() => null);
      }
    });
    leadsLiveStream.onerror = () => {
      if (leadsLiveStream) {
        leadsLiveStream.close();
        leadsLiveStream = null;
      }
      void (async () => {
        if (await canReconnectPortalStream()) {
          window.setTimeout(connectLeadsLiveStream, 2000);
        }
      })();
    };
  } catch {
    void (async () => {
      if (await canReconnectPortalStream()) {
        window.setTimeout(connectLeadsLiveStream, 2000);
      }
    })();
  }
}

function connectPortalLiveStream() {
  if (portalLiveStream) return;
  try {
    portalLiveStream = new EventSource("/api/live/stream");
    portalLiveStream.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data || "{}");
        const type = String(payload.type || "");
        if (!type || type === "heartbeat") return;
        if (type === "notice_update" || type === "student_notice") {
          loadNotices().catch(() => null);
        }
      } catch {
        loadNotices().catch(() => null);
      }
    };
    portalLiveStream.onerror = () => {
      if (portalLiveStream) {
        portalLiveStream.close();
        portalLiveStream = null;
      }
      void (async () => {
        if (await canReconnectPortalStream()) {
          window.setTimeout(connectPortalLiveStream, 2000);
        }
      })();
    };
  } catch {
    void (async () => {
      if (await canReconnectPortalStream()) {
        window.setTimeout(connectPortalLiveStream, 2000);
      }
    })();
  }
}

connectLeadsLiveStream();
connectPortalLiveStream();

notificationTabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveNotificationTab(tab.dataset.tab));
});

if (absenteeBatchSelect) {
  absenteeBatchSelect.addEventListener("change", () => {
    loadAbsenteeSessions().catch(() => setAbsenteeStatus("Could not load closed sessions."));
  });
}

if (absenteeSessionSelect) {
  absenteeSessionSelect.addEventListener("change", updateAbsenteeExportButton);
}

if (absenteeExportBtn) {
  absenteeExportBtn.addEventListener("click", exportAbsentees);
}

if (testReportBatchSelect) {
  testReportBatchSelect.addEventListener("change", updateTestReportButton);
}

if (testReportExportBtn) {
  testReportExportBtn.addEventListener("click", exportTestReport);
}

if (idPreviewClose && idPreviewModal) {
  idPreviewClose.addEventListener("click", () => idPreviewModal.classList.add("hidden"));
  idPreviewModal.addEventListener("click", (event) => {
    if (event.target === idPreviewModal) {
      idPreviewModal.classList.add("hidden");
    }
  });
}
