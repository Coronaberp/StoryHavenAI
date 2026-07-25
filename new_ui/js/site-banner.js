"use strict";

const SITE_BANNER_ICONS = {
  maintenance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L14.7 3.86a2 2 0 00-3.4 0z"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>`,
};

class SiteBannerWidget {
  constructor() {
    this.pollHandle = null;
    this.countdownHandle = null;
    this.data = null;
  }

  _etaText(endsAt) {
    const remainingMinutes = Math.round((endsAt - Date.now() / 1000) / 60);
    if (remainingMinutes <= 0) return t("site_banner_eta_any_moment", "expected back any moment");
    if (remainingMinutes < 60) return t("site_banner_eta_minutes", "back in ~{n}m").replace("{n}", remainingMinutes);
    return t("site_banner_eta_hours", "back in ~{n}h").replace("{n}", Math.round(remainingMinutes / 60));
  }

  render() {
    const el = document.getElementById("siteBanner");
    if (!el) return;
    clearInterval(this.countdownHandle);
    if (!this.data) {
      el.className = "hidden";
      el.innerHTML = "";
      document.documentElement.style.setProperty("--site-banner-h", "0px");
      return;
    }
    const kind = this.data.banner_type || "maintenance";
    el.className = `site-banner type-${kind}`;
    el.innerHTML = `
      <span class="site-banner-icon">${SITE_BANNER_ICONS[kind] || SITE_BANNER_ICONS.maintenance}</span>
      <span class="site-banner-text">${_esc(this.data.message)}</span>
      <span class="site-banner-eta" id="siteBannerEta"></span>
    `;
    const etaEl = document.getElementById("siteBannerEta");
    const updateEta = () => {
      if (!etaEl) return;
      etaEl.textContent = this.data.ends_at ? this._etaText(this.data.ends_at) : "";
    };
    updateEta();
    this.countdownHandle = setInterval(updateEta, 60 * 1000);
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty("--site-banner-h", `${el.offsetHeight}px`);
    });
  }

  async refresh() {
    try {
      this.data = await api("/api/site-banner");
    } catch (err) {
      this.data = null;
    }
    this.render();
  }

  start() {
    if (this.pollHandle) return;
    this.refresh();
    this.pollHandle = setInterval(() => this.refresh(), 60 * 1000);
    window.addEventListener("resize", () => this.render());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.refresh();
    });
  }
}

const siteBanner = new SiteBannerWidget();

if (typeof window !== "undefined") {
  window.siteBanner = siteBanner;
}
