"use strict";

class FeatureFlagStatus {
  constructor() {
    this.disabled = new Map();
    this.pollHandle = null;
  }

  apply() {
    Array.from(document.documentElement.classList)
      .filter((c) => c.startsWith("feature-disabled-"))
      .forEach((c) => document.documentElement.classList.remove(c));
    for (const key of this.disabled.keys()) {
      document.documentElement.classList.add(`feature-disabled-${key}`);
    }
  }

  async refresh() {
    try {
      const status = await api("/api/feature-status");
      this.disabled = new Map(Object.entries(status));
    } catch (err) {
      this.disabled = new Map();
      console.warn("feature-status check failed", err);
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
      const trigger = e.target.closest("[data-feature]");
      if (!trigger) return;
      const key = trigger.dataset.feature;
      if (!this.disabled.has(key)) return;
      e.preventDefault();
      e.stopPropagation();
      this.showDisabledModal(key, this.disabled.get(key));
    }, true);
  }

  showDisabledModal(key, flagData) {
    const roleLabel = flagData.updated_by_role === "dev" ? "Dev" : "Admin";
    const attribution = flagData.updated_by_name
      ? `${roleLabel} ${flagData.updated_by_name}`
      : t("feature_disabled_unknown_admin", "An admin");
    const message = flagData.message || t("feature_disabled_generic_message", "This feature is temporarily disabled");
    let countdownTimer = null;
    const layer = openModal(`
      <div style="display:flex;flex-direction:column;gap:14px;text-align:center;padding:6px 4px">
        <div style="width:52px;height:52px;margin:0 auto;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb, var(--color-cmd-yellow) 16%, transparent);color:var(--color-cmd-yellow)">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>
        </div>
        <div class="font-display" style="font-size:17px;font-weight:600;color:var(--color-ink)">${_esc(flagData.label || key)}</div>
        <div style="font-size:13px;color:var(--color-sec)">${_esc(message)}</div>
        <div style="font-size:12px;color:var(--color-muted)">${_esc(attribution)}</div>
        <div id="featureFlagCountdown-${_esc(key)}" style="font-size:13px;color:var(--color-sec)"></div>
        <button type="button" id="featureFlagModalClose" class="pe-gen-btn" style="width:100%;justify-content:center">${t("feature_disabled_close", "Close")}</button>
      </div>
    `, { onClose: () => clearInterval(countdownTimer) });
    const countdownEl = layer.querySelector(`#featureFlagCountdown-${_esc(key)}`);
    const updateCountdown = () => {
      if (!flagData.eta_minutes || !flagData.disabled_at) {
        countdownEl.textContent = t("feature_disabled_no_estimated_return", "No estimated return time");
        return;
      }
      const targetSeconds = flagData.disabled_at + flagData.eta_minutes * 60;
      const remainingMinutes = Math.round((targetSeconds - Date.now() / 1000) / 60);
      countdownEl.textContent = remainingMinutes > 0
        ? t("feature_disabled_estimated_return", "Back in ~{n} minutes").replace("{n}", remainingMinutes)
        : t("feature_disabled_estimated_return_overdue", "Expected back any moment");
    };
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 60 * 1000);
    layer.querySelector("#featureFlagModalClose").onclick = () => closeTopModal();
  }
}

const featureFlags = new FeatureFlagStatus();

if (typeof window !== "undefined") {
  window.featureFlags = featureFlags;
}
