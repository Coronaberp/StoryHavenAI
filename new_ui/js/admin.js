"use strict";

const ADMIN_SERVICE_LABELS = {
  database: "Database", chat_llm: "Chat model", embed_llm: "Embed model",
  comfyui: "ComfyUI", image_classify_llm: "Image classifier", modal: "Modal",
};

class AdminOverviewView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    const [users, contentReports, flagged, resetReqs, modelReqs, health, imageReports, titleReqs, emojis] = await Promise.all([
      api("/api/admin/users").catch(() => []),
      api("/api/admin/content-reports").catch(() => []),
      api("/api/admin/flagged-endpoints").catch(() => []),
      api("/api/admin/password-reset-requests").catch(() => []),
      api("/api/admin/model-requests").catch(() => []),
      api("/api/admin/service-health").catch(() => ({ services: [] })),
      api("/api/admin/image-reports").catch(() => []),
      api("/api/admin/title-requests").catch(() => []),
      api("/api/admin/emojis").catch(() => []),
    ]);
    this.queues = [
      { label: t("admin_overview_q_signups", "New signups"), count: users.filter((u) => u.status === "pending").length },
      { label: t("admin_overview_q_flagged", "Flagged endpoints"), count: flagged.length },
      { label: t("admin_overview_q_resets", "Password resets"), count: resetReqs.length },
      { label: t("admin_overview_q_model_requests", "Model requests"), count: modelReqs.filter((r) => r.status === "pending").length },
      { label: t("admin_overview_q_content_reports", "Content reports"), count: contentReports.length },
      { label: t("admin_overview_q_image_reports", "Image reports"), count: imageReports.length },
      { label: t("admin_overview_q_titles", "Title requests"), count: titleReqs.length },
      { label: t("admin_overview_q_emojis", "Explicit emojis"), count: emojis.filter((e) => e.is_explicit).length },
    ];
    this.services = health.services || [];
    this.render();
  }

  render() {
    const attentionTotal = this.queues.reduce((sum, q) => sum + q.count, 0);
    window._adminSwitcherBadges = { "admin-moderation": attentionTotal };

    const queueLine = (q) => `
      <button type="button" onclick="navigate('/admin-moderation')" class="w-full flex items-center justify-between py-1.5 text-[13px] text-ink" style="border-top:1px solid color-mix(in srgb, var(--color-warn) 15%, transparent)">
        <span>${_esc(q.label)}</span>
        <span class="font-mono" style="color:var(--color-warn)">${q.count}</span>
      </button>
    `;

    const attentionHtml = attentionTotal > 0 ? `
      <div class="p-3.5 rounded-[13px] border" style="border-color:var(--color-warn);background:color-mix(in srgb, var(--color-warn) 8%, var(--color-surface))">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="font-mono text-[10px] tracking-[.14em] uppercase" style="color:var(--color-warn)">${t("admin_needs_attention")}</span>
          <button type="button" onclick="navigate('/admin-moderation')" class="px-2.5 py-1 rounded-md text-xs text-paper" style="background:var(--color-warn)">${t("admin_overview_review", "Review")} →</button>
        </div>
        ${this.queues.filter((q) => q.count > 0).map(queueLine).join("")}
      </div>
    ` : `
      <div class="p-3.5 rounded-[13px] border border-line bg-surface">
        <div class="font-mono text-[10px] tracking-[.14em] uppercase text-muted mb-1">${t("admin_all_clear")}</div>
        <div class="text-[13px] text-ink">${t("admin_nothing_pending")}</div>
      </div>
    `;

    const downServices = this.services.filter((svc) => !svc.ok);
    const okCount = this.services.length - downServices.length;
    const downTile = (svc) => `
      <div class="p-3 rounded-[13px] border" style="border-color:var(--color-warn);background:color-mix(in srgb, var(--color-warn) 7%, var(--color-surface))">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-[7px] h-[7px] rounded-full flex-none" style="background:var(--color-warn)"></span>
          <span class="text-[13px] text-ink">${_esc(ADMIN_SERVICE_LABELS[svc.name] || svc.name)}</span>
        </div>
        <div class="font-mono text-[10px]" style="color:var(--color-warn)">${_esc(svc.error || t("admin_service_unreachable"))}</div>
      </div>
    `;
    const okLabel = downServices.length === 0
      ? `${t("admin_overview_all_services", "All services connected")}`
      : `${okCount} ${t("admin_overview_others_ok", "other services connected")}`;
    const servicesHtml = `
      ${downServices.map(downTile).join("")}
      <button type="button" onclick="navigate('/admin-health')" class="w-full flex items-center gap-2 p-3 rounded-[13px] border border-line bg-surface">
        <span class="w-[7px] h-[7px] rounded-full flex-none" style="background:var(--color-success)"></span>
        <span class="text-[13px] text-ink flex-1 text-left">${okLabel}</span>
        <span class="font-mono text-xs" style="color:var(--color-accent)">${t("admin_open")}</span>
      </button>
    `;

    this.main.innerHTML = `
      <div class="content-col">
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_title"), t("ph_admin_sub"))}
      ${adminScreenSwitcherHtml("admin", window._adminSwitcherBadges || {})}
      <div class="flex flex-col gap-2.5 max-w-xl">
        ${attentionHtml}
        ${servicesHtml}
      </div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
  }
}

if (typeof window !== "undefined") {
  window.AdminOverviewView = AdminOverviewView;
}
