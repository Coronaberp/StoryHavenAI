"use strict";

const ADMIN_BANNER_DURATIONS = [
  { key: "none", minutes: null, label: "admin_announce_banner_duration_none" },
  { key: "30m", minutes: 30, label: "admin_announce_banner_duration_30m" },
  { key: "1h", minutes: 60, label: "admin_announce_banner_duration_1h" },
  { key: "4h", minutes: 240, label: "admin_announce_banner_duration_4h" },
  { key: "24h", minutes: 1440, label: "admin_announce_banner_duration_24h" },
];

class AdminAnnouncePanel {
  async mount(main) {
    this.main = main;
    this.mode = "notification";
    this.bannerDuration = "none";
    this.bannerType = "maintenance";
    this.currentBanner = await api("/api/site-banner").catch(() => null);
    this.render();
  }

  previewHtml() {
    const title = this._title || "";
    const body = this._body || "";
    return `
      <div class="mb-1 font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_preview_label", "Preview — how this appears in a user's notification list")}</div>
      <div class="rounded-[10px] border border-line bg-surface" style="padding:4px">
        <div class="notif-item" style="cursor:default">
          <span class="notif-dot" style="background:var(--color-accent)"></span>
          <span class="notif-body">
            <span class="notif-item-title" style="font-weight:700">${title ? _esc(title) : `<span class="text-muted" style="font-weight:400">${_esc(t("admin_announce_preview_title_placeholder", "Untitled announcement"))}</span>`}</span>
            ${body ? `<span class="notif-item-text" style="-webkit-line-clamp:unset">${_esc(body)}</span>` : ""}
            <span class="notif-item-time">${_esc(t("admin_announce_preview_time", "just now"))}</span>
          </span>
        </div>
      </div>
    `;
  }

  modeChipsHtml() {
    const modes = [
      ["notification", t("admin_announce_mode_notification", "One-time notification")],
      ["banner", t("admin_announce_mode_banner", "Persistent banner")],
    ];
    return `
      <div class="inline-flex mb-4 rounded-full border border-line overflow-hidden">
        ${modes.map(([key, label]) => {
          const active = this.mode === key;
          return `
            <button type="button" onclick="adminAnnouncePanel.mode='${key}';adminAnnouncePanel.render()"
              class="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold${active ? " text-paper bg-gradient-to-br from-primary to-primary-dark" : " text-ink bg-surface"}">
              ${label}
              ${active ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ""}
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  notificationModeHtml() {
    return `
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_title", "Title")}</span>
          <input type="text" id="announceTitle" maxlength="120" value="${_attr(this._title)}" class="w-full px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="${_attr(t("admin_announce_title_placeholder", "Service degraded"))}">
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_message", "Message")}</span>
          <textarea id="announceBody" rows="4" maxlength="1000" class="w-full px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="${_attr(t("admin_announce_body_placeholder", "What happened, what still works, and when you expect it fixed."))}">${_esc(this._body)}</textarea>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_link", "Link (optional)")}</span>
          <input type="text" id="announceLink" maxlength="300" value="${_attr(this._link)}" class="w-full px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="/forum">
        </label>
        <div id="announcePreview">${this.previewHtml()}</div>
        <div class="flex justify-end sticky bottom-0 md:static bg-paper md:bg-transparent pt-2 pb-2 md:pt-0 md:pb-0">
          <button type="button" id="announceSend" class="pe-gen-btn w-full md:w-auto">${t("admin_announce_send", "Send to all users")}</button>
        </div>
      </div>
    `;
  }

  bannerModeHtml() {
    const current = this.currentBanner;
    return `
      <div class="flex flex-col gap-3">
        ${current ? `
          <div class="rounded-[10px] border p-3" style="border-color:var(--color-warn)">
            <div class="font-mono text-[10px] tracking-[.1em] uppercase text-muted mb-1">${t("admin_announce_banner_currently_live", "Currently live")}</div>
            <div class="text-sm text-ink">${_esc(current.message)}</div>
            <div class="text-xs text-muted mt-1">${_esc(current.created_by || "")}${current.ends_at ? ` · ${t("admin_announce_banner_ends_at", "ends")} ${new Date(current.ends_at * 1000).toLocaleString()}` : ""}</div>
            <button type="button" id="bannerClear" class="pe-gen-btn mt-2" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_announce_banner_clear", "Take down banner")}</button>
          </div>
        ` : ""}
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_message", "Message")}</span>
          <textarea id="bannerMessage" rows="3" maxlength="300" class="w-full px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="${_attr(t("admin_announce_banner_placeholder", "Scheduled maintenance from 2am-3am UTC. Chat may be briefly unavailable."))}">${_esc(this._bannerMessage || "")}</textarea>
        </label>
        <div class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_type", "Type")}</span>
          <div class="flex items-center gap-1.5 flex-wrap">
            ${["maintenance", "info", "warning"].map((k) => `
              <button type="button" class="filter-chip${this.bannerType === k ? " on" : ""}" onclick="adminAnnouncePanel.bannerType='${k}';adminAnnouncePanel.render()">${t(`admin_announce_banner_type_${k}`, k)}</button>
            `).join("")}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_duration", "Stays up for")}</span>
          <div class="flex items-center gap-1.5 flex-wrap">
            ${ADMIN_BANNER_DURATIONS.map((d) => `
              <button type="button" class="filter-chip${this.bannerDuration === d.key ? " on" : ""}" onclick="adminAnnouncePanel.bannerDuration='${d.key}';adminAnnouncePanel.render()">${t(d.label, d.key === "none" ? "Until cleared" : d.key)}</button>
            `).join("")}
          </div>
        </div>
        <div id="bannerPreview">${this.bannerPreviewHtml()}</div>
        <div class="flex justify-end sticky bottom-0 md:static bg-paper md:bg-transparent pt-2 pb-2 md:pt-0 md:pb-0">
          <button type="button" id="bannerPost" class="pe-gen-btn w-full md:w-auto">${t("admin_announce_banner_post", "Post banner")}</button>
        </div>
      </div>
    `;
  }

  bannerPreviewHtml() {
    const message = this._bannerMessage || "";
    return `
      <div class="mb-1 font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_banner_preview_label", "Preview — appears at the top of every page")}</div>
      <div class="site-banner type-${this.bannerType}" style="border-radius:10px">
        <span class="site-banner-icon">${SITE_BANNER_ICONS[this.bannerType] || SITE_BANNER_ICONS.maintenance}</span>
        <span class="site-banner-text">${message ? _esc(message) : `<span class="text-muted">${_esc(t("admin_announce_banner_preview_placeholder", "Your banner message"))}</span>`}</span>
      </div>
    `;
  }

  render() {
    this._title = this._title || "";
    this._body = this._body || "";
    this._link = this._link || "";
    this._bannerMessage = this._bannerMessage || "";
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_announce_title", "Announcements"), t("ph_admin_announce_sub", "Send a notification to every active user."))}
      ${adminScreenSwitcherHtml("admin-announce", window._adminSwitcherBadges || {})}
      ${this.modeChipsHtml()}
      ${this.mode === "banner" ? this.bannerModeHtml() : this.notificationModeHtml()}
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    if (this.mode === "banner") {
      const msgEl = this.main.querySelector("#bannerMessage");
      msgEl.oninput = () => {
        this._bannerMessage = msgEl.value;
        document.getElementById("bannerPreview").innerHTML = this.bannerPreviewHtml();
      };
      this.main.querySelector("#bannerPost").onclick = () => this.postBanner();
      const clearBtn = this.main.querySelector("#bannerClear");
      if (clearBtn) clearBtn.onclick = () => this.clearBanner();
      return;
    }
    this.main.querySelector("#announceSend").onclick = () => this.confirmAndSend();
    const titleEl = this.main.querySelector("#announceTitle");
    const bodyEl = this.main.querySelector("#announceBody");
    const linkEl = this.main.querySelector("#announceLink");
    const updatePreview = () => {
      this._title = titleEl.value;
      this._body = bodyEl.value;
      this._link = linkEl.value;
      document.getElementById("announcePreview").innerHTML = this.previewHtml();
    };
    titleEl.oninput = updatePreview;
    bodyEl.oninput = updatePreview;
    linkEl.oninput = updatePreview;
  }

  async postBanner() {
    const message = this.main.querySelector("#bannerMessage").value.trim();
    if (!message) {
      errorToast(t("admin_announce_banner_message_required", "A message is required."));
      return;
    }
    const duration = ADMIN_BANNER_DURATIONS.find((d) => d.key === this.bannerDuration);
    const ends_at = duration && duration.minutes ? (Date.now() / 1000) + duration.minutes * 60 : null;
    if (!(await confirmDialog(t("admin_announce_banner_confirm", "Post this banner to every page, for every user, right now?")))) return;
    try {
      this.currentBanner = await api("/api/admin/site-banner", { method: "PUT", body: JSON.stringify({ message, banner_type: this.bannerType, ends_at }) });
      toast(t("admin_announce_banner_posted", "Banner posted."));
      this._bannerMessage = "";
      if (typeof siteBanner !== "undefined") siteBanner.refresh();
      this.render();
    } catch (err) {
      errorToast(err.message || t("admin_announce_banner_post_failed", "The banner could not be posted."));
    }
  }

  async clearBanner() {
    if (!(await confirmDialog(t("admin_announce_banner_confirm_clear", "Take down the banner for everyone?")))) return;
    try {
      await api("/api/admin/site-banner", { method: "DELETE" });
      toast(t("admin_announce_banner_cleared", "Banner taken down."));
      this.currentBanner = null;
      if (typeof siteBanner !== "undefined") siteBanner.refresh();
      this.render();
    } catch (err) {
      errorToast(err.message || t("admin_announce_banner_clear_failed", "The banner could not be cleared."));
    }
  }

  async confirmAndSend() {
    const title = this.main.querySelector("#announceTitle").value.trim();
    const body = this.main.querySelector("#announceBody").value.trim();
    const link = this.main.querySelector("#announceLink").value.trim();
    if (!title) {
      errorToast(t("admin_announce_title_required", "A title is required."));
      return;
    }
    const count = await api("/api/admin/feature-flags/active-user-count").catch(() => null);
    const countText = count ? `${count.count} ` : "";
    const confirmed = await new Promise((resolve) => {
      const layer = openModal(`
        <div style="padding:4px 2px">
          <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_announce_confirm_title", "Send this announcement?")}</h3>
          <div style="font-size:13px;color:var(--color-sec);margin:0 0 6px">${t("admin_announce_confirm_body", "It will notify")} ${countText}${t("admin_announce_confirm_body_tail", "active users and cannot be unsent.")}</div>
          <div style="font-size:13px;color:var(--color-ink);border:1px solid var(--color-line);border-radius:10px;padding:10px;margin:0 0 16px">
            <div style="font-weight:600">${_esc(title)}</div>
            ${body ? `<div style="margin-top:4px;color:var(--color-sec)">${_esc(body)}</div>` : ""}
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" id="announceConfirmCancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
            <button type="button" id="announceConfirmSend" class="pe-gen-btn">${t("admin_announce_send", "Send to all users")}</button>
          </div>
        </div>
      `, { dismissible: false });
      layer.querySelector("#announceConfirmCancel").onclick = () => { closeModal(layer); resolve(false); };
      layer.querySelector("#announceConfirmSend").onclick = () => { closeModal(layer); resolve(true); };
    });
    if (!confirmed) return;
    try {
      const result = await api("/api/admin/announce", { method: "POST", body: JSON.stringify({ title, body, link }) });
      toast(`${t("admin_announce_sent", "Announcement sent to")} ${result.sent} ${t("admin_announce_sent_tail", "users.")}`);
      this._title = "";
      this._body = "";
      this._link = "";
      this.render();
    } catch (err) {
      errorToast(err.message || t("admin_announce_failed", "The announcement could not be sent."));
    }
  }
}

if (typeof window !== "undefined") {
  window.AdminAnnouncePanel = AdminAnnouncePanel;
}
