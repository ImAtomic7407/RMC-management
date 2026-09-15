(function () {
  const badge = document.getElementById("lead-badge");
  const toastStack = document.getElementById("toast-stack");

  function setBadge(count) {
    if (!badge) return;
    const n = Number(count) || 0;
    badge.textContent = String(n);
    if (n > 0) badge.classList.remove("hidden");
    else badge.classList.add("hidden");
  }

  async function refreshUnread() {
    try {
      const res = await fetch("/api/leads?unread=1", { headers: { "Accept": "application/json" } });
      const payload = await res.json();
      if (payload && payload.status === "success" && Array.isArray(payload.leads)) {
        setBadge(payload.leads.length);
      }
    } catch {
      // ignore
    }
  }

  function escapeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function makeToast(lead) {
    if (!toastStack) return;
    const name = escapeText(lead?.name) || "New request";
    const phone = escapeText(lead?.phone);

    const div = document.createElement("div");
    div.className = "toast glass-container";
    div.innerHTML = `
      <div class="t-title">New ID card permission request</div>
      <div class="t-body">
        <strong style="color:#fff;">${name}</strong>
        ${phone ? `<div>${phone}</div>` : ""}
      </div>
      <div class="t-row">
        <div class="t-meta">Lead #${lead?.id ?? "-"}</div>
        <a class="t-link" href="/leads">Open Notifications</a>
      </div>
    `;

    toastStack.appendChild(div);
    window.setTimeout(() => {
      div.style.opacity = "0";
      div.style.transform = "translateY(6px)";
      div.style.transition = "0.25s ease";
      window.setTimeout(() => div.remove(), 280);
    }, 8000);
  }

  function bumpBadge() {
    if (!badge) return;
    const current = Number(badge.textContent) || 0;
    setBadge(current + 1);
  }

  refreshUnread();

  try {
    const es = new EventSource("/api/leads/stream");
    es.addEventListener("lead", (evt) => {
      try {
        const payload = JSON.parse(evt.data || "{}");
        const lead = payload.lead;
        if (!lead) return;
        const source = String(lead.source || "").toLowerCase();
        if (source && source !== "id_card_permission_request") return;
        bumpBadge();
        makeToast(lead);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
})();
