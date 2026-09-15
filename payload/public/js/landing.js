(function () {
  function setFallback(el, fallback) {
    if (!fallback) return;
    if (el.dataset.fallbackApplied === "1") return;
    el.dataset.fallbackApplied = "1";
    el.src = fallback;
  }

  document.querySelectorAll("img[data-fallback]").forEach((img) => {
    img.addEventListener("error", () => setFallback(img, img.getAttribute("data-fallback")));
  });

  const heroVideo = document.querySelector("[data-hero-video]");
  const heroImage = document.querySelector("[data-hero-image]");
  if (heroVideo && heroImage) {
    const showImage = () => {
      heroVideo.classList.add("hidden");
      heroImage.classList.remove("hidden");
    };
    const showVideo = () => {
      heroImage.classList.add("hidden");
      heroVideo.classList.remove("hidden");
    };

    // Default: image is visible, video is hidden.
    // If the video can play, swap in the video.
    heroVideo.addEventListener("canplay", showVideo, { once: true });
    heroVideo.addEventListener("loadeddata", showVideo, { once: true });
    heroVideo.addEventListener("error", showImage);
    heroVideo.addEventListener("stalled", showImage);

    // Extra guard: if video doesn't start quickly (404 / unsupported), keep the image.
    window.setTimeout(() => {
      if (!heroVideo.classList.contains("hidden") && heroVideo.readyState < 2) showImage();
    }, 1500);
  }

  const form = document.getElementById("request-form");
  if (form) {
    const submitBtn = document.getElementById("request-submit");
    const statusEl = document.getElementById("request-status");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (statusEl) statusEl.textContent = "";
      if (submitBtn) submitBtn.disabled = true;

      const data = Object.fromEntries(new FormData(form).entries());

      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(data.name || "").trim(),
            phone: String(data.phone || "").trim(),
            source: "id_card_permission_request"
          })
        });
        const payload = await res.json();
        if (payload && payload.status === "success") {
          form.reset();
          if (statusEl) statusEl.textContent = "Request sent. Teacher will review and approve.";
        } else {
          if (statusEl) statusEl.textContent = payload?.error || "Could not send. Try again.";
        }
      } catch {
        if (statusEl) statusEl.textContent = "Network error. Try again.";
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
})();
