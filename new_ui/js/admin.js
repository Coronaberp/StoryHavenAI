"use strict";

const ADMIN_SERVICE_LABELS = {
  database: "Database", chat_llm: "Chat model", embed_llm: "Embed model",
  comfyui: "ComfyUI", image_classify_llm: "Image classifier", modal: "Modal",
};

class AdminOverviewView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    const [users, chars, contentReports, flagged, resetReqs, modelReqs, health, imageReports, titleReqs, emojis] = await Promise.all([
      api("/api/admin/users").catch(() => []),
      api("/api/characters").catch(() => []),
      api("/api/admin/content-reports").catch(() => []),
      api("/api/admin/flagged-endpoints").catch(() => []),
      api("/api/admin/password-reset-requests").catch(() => []),
      api("/api/admin/model-requests").catch(() => []),
      api("/api/admin/service-health").catch(() => ({ services: [] })),
      api("/api/admin/image-reports").catch(() => []),
      api("/api/admin/title-requests").catch(() => []),
      api("/api/admin/emojis").catch(() => []),
    ]);
    this.users = users;
    this.chars = chars;
    this.pending = users.filter((u) => u.status === "pending");
    this.flagged = flagged;
    this.resetReqs = resetReqs;
    this.pendingModelReqs = modelReqs.filter((r) => r.status === "pending");
    this.health = health.services || [];
    this.contentReports = contentReports;
    this.imageReports = imageReports;
    this.pendingTitleReqs = titleReqs;
    this.pendingEmojis = emojis.filter((e) => e.is_explicit);
    this.render();
  }

  render() {
    const attentionTotal = this.pending.length + this.flagged.length + this.resetReqs.length + this.pendingModelReqs.length
      + this.contentReports.length + this.imageReports.length + this.pendingTitleReqs.length + this.pendingEmojis.length;
    window._adminSwitcherBadges = { "admin-moderation": attentionTotal };

    const healthTile = (svc) => `
      <div class="flex-1 min-w-0 p-3 rounded-[13px] border border-line bg-surface">
        <div class="flex items-center gap-1.5 text-sec mb-2">
          <span class="font-mono text-[9px] tracking-[.1em] uppercase">${_esc(ADMIN_SERVICE_LABELS[svc.name] || svc.name)}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-[7px] h-[7px] rounded-full flex-none" style="background:${svc.ok ? "var(--color-success)" : "var(--color-warn)"}"></span>
          <span class="text-[13px] text-ink">${svc.ok ? t("admin_service_connected") : (svc.error ? _esc(svc.error) : t("admin_service_unreachable"))}</span>
        </div>
      </div>
    `;

    const statTile = (label, value, attn = false) => `
      <div class="flex-1 text-center py-3 px-1.5 rounded-[13px] border" style="border-color:${attn && value > 0 ? "var(--color-warn)" : "var(--color-line)"};background:var(--color-surface)">
        <div class="font-display font-semibold text-[19px]" style="color:${attn && value > 0 ? "var(--color-warn)" : "var(--color-accent)"}">${value}</div>
        <div class="font-mono text-[8.5px] tracking-[.1em] uppercase text-muted mt-0.5">${label}</div>
      </div>
    `;

    const userRow = (u) => `
      <div class="flex items-center gap-3 py-2.5 px-3 rounded-[13px] border border-line bg-surface">
        <span class="w-9 h-9 rounded-full overflow-hidden bg-surface-2 grid place-items-center flex-none">
          ${u.avatar ? `<img src="${_attr(u.avatar)}" alt="" class="w-full h-full object-cover">` : `<span class="font-display text-sm text-ink">${_esc((u.display_name || u.username || "?")[0].toUpperCase())}</span>`}
        </span>
        <div class="flex-1 min-w-0">
          <div class="font-display font-semibold text-sm text-ink truncate">${_esc(u.display_name || u.username)}</div>
          <div class="font-mono text-xs text-muted mt-0.5">@${_esc(u.username)}</div>
        </div>
        <span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-accent);border:1px solid var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, transparent)">
          ${u.role === "dev" ? t("admin_role_dev") : (u.is_admin ? t("admin_role_admin") : (u.status === "suspended" ? t("admin_role_suspended") : t("admin_role_member")))}
        </span>
      </div>
    `;

    this.main.innerHTML = `
      <div class="content-col">
      ${adminScreenSwitcherHtml("admin", window._adminSwitcherBadges || {})}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_title"), t("ph_admin_sub"))}
      <div class="flex gap-2.5 mb-3 flex-wrap">${this.health.map(healthTile).join("")}</div>
      <div class="flex gap-2.5 mb-3 flex-wrap">
        ${statTile(t("admin_stat_users"), this.users.length)}
        ${statTile(t("admin_stat_admins"), this.users.filter((u) => u.is_admin).length)}
        ${statTile(t("admin_stat_characters"), this.chars.length)}
      </div>
      <div class="flex gap-2.5 mb-4 flex-wrap">
        ${statTile(t("admin_stat_pending"), this.pending.length, true)}
        ${statTile(t("admin_stat_flagged"), this.flagged.length, true)}
        ${statTile(t("admin_stat_resets"), this.resetReqs.length, true)}
        ${statTile(t("admin_stat_model_requests"), this.pendingModelReqs.length, true)}
      </div>
      <div class="flex gap-2.5 mb-4 flex-wrap">
        ${statTile(t("admin_stat_content_reports"), this.contentReports.length, true)}
        ${statTile(t("admin_stat_image_reports"), this.imageReports.length, true)}
        ${statTile(t("admin_stat_titles"), this.pendingTitleReqs.length, true)}
        ${statTile(t("admin_stat_emojis"), this.pendingEmojis.length, true)}
      </div>
      <div class="p-3.5 rounded-[13px] border mb-5" style="border-color:${attentionTotal > 0 ? "var(--color-warn)" : "var(--color-line)"};background:${attentionTotal > 0 ? "color-mix(in srgb, var(--color-warn) 10%, var(--color-surface))" : "var(--color-surface)"}">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="font-mono text-[10px] tracking-[.14em] uppercase" style="color:${attentionTotal > 0 ? "var(--color-warn)" : "var(--color-muted)"}">${attentionTotal > 0 ? t("admin_needs_attention") : t("admin_all_clear")}</div>
          ${attentionTotal > 0 ? `<button type="button" onclick="navigate('/admin-moderation')" class="px-2.5 py-1 rounded-md text-xs text-paper" style="background:var(--color-warn)">${t("admin_jump_to_moderation")}</button>` : ""}
        </div>
        <div class="text-[13px] text-ink">${attentionTotal > 0
          ? [
              this.pending.length ? `${this.pending.length} ${t("admin_count_pending")}` : "",
              this.flagged.length ? `${this.flagged.length} ${t("admin_count_flagged")}` : "",
              this.resetReqs.length ? `${this.resetReqs.length} ${t("admin_count_resets")}` : "",
              this.pendingModelReqs.length ? `${this.pendingModelReqs.length} ${t("admin_count_model_reqs")}` : "",
              this.contentReports.length ? `${this.contentReports.length} ${t("admin_count_content_reports")}` : "",
              this.imageReports.length ? `${this.imageReports.length} ${t("admin_count_image_reports")}` : "",
              this.pendingTitleReqs.length ? `${this.pendingTitleReqs.length} ${t("admin_count_title_reqs")}` : "",
              this.pendingEmojis.length ? `${this.pendingEmojis.length} ${t("admin_count_emojis")}` : "",
            ].filter(Boolean).join(" · ")
          : t("admin_nothing_pending")}</div>
      </div>
      <div class="flex items-center justify-between mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_users")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-users')">${t("admin_see_all")}</span>
      </div>
      <div class="flex flex-col gap-2">${this.users.slice(0, 5).map(userRow).join("")}</div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_moderation")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-moderation')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_model_previews")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-previews')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_train_lora")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-train')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_emojis_stickers")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-emojis')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_server_configuration")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-config')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_health_logs")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-health')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_feature_flags", "Feature Flags")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-features')">${t("admin_open")}</span>
      </div>
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">${t("admin_section_announcements", "Announcements")}</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-announce')">${t("admin_open")}</span>
      </div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
  }
}

if (typeof window !== "undefined") {
  window.AdminOverviewView = AdminOverviewView;
}
