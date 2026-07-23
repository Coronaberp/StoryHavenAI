"use strict";

class MediaGenAvailability {
  constructor() {
    this.available = true;
    this.pollHandle = null;
  }

  apply() {
    document.documentElement.classList.toggle("media-gen-down", !this.available);
  }

  async refresh() {
    try {
      const res = await api("/api/media-gen-status");
      this.available = res.available !== false;
    } catch (err) {
      this.available = true;
      console.warn("media-gen-status check failed", err);
    }
    this.apply();
  }

  start() {
    if (this.pollHandle) return;
    this.refresh();
    this.pollHandle = setInterval(() => this.refresh(), 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.refresh();
    });
    document.addEventListener("click", (e) => {
      if (this.available) return;
      const trigger = e.target.closest("[data-media-gen]");
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      this.showUnavailable();
    }, true);
  }

  guard() {
    if (this.available) return true;
    this.showUnavailable();
    return false;
  }

  showUnavailable() {
    openModal(`
      <div style="display:flex;flex-direction:column;gap:14px;text-align:center;padding:6px 4px">
        <div style="width:52px;height:52px;margin:0 auto;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb, var(--color-warn) 16%, transparent);color:var(--color-warn)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 15l4.5-4.5c.6-.6 1.4-.6 2 0L15 16"/><circle cx="8.5" cy="8.5" r="1.3"/><line x1="4" y1="20" x2="20" y2="4"/></svg>
        </div>
        <div class="font-display" style="font-size:17px;font-weight:600;color:var(--color-ink)">${t("mediagen_unavailable_title", "Media gen is unavailable currently")}</div>
        <div style="font-size:13px;color:var(--color-sec)">${t("mediagen_unavailable_downtime_label", "Estimated downtime")}: <span style="font-family:var(--font-mono);font-size:18px;color:var(--color-ink)">∞</span></div>
        <button type="button" id="mediaGenUnavailClose" class="pe-gen-btn" style="width:100%;justify-content:center">${t("mediagen_unavailable_close", "Back to Explore")}</button>
      </div>
    `, { onClose: () => navigate("/explore") });
    const layer = document.querySelector(".modal-layer:last-child");
    layer?.querySelector("#mediaGenUnavailClose")?.addEventListener("click", () => closeTopModal());
  }
}

const mediaGen = new MediaGenAvailability();
