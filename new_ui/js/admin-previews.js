"use strict";

const _PV_ICON_SAVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
const _PV_ICON_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"/></svg>`;
const _PV_ICON_REGEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const _PV_ICON_UPLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg>`;
const _PV_ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
const _PV_ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;

const ADMIN_PREVIEW_KINDS = [
  { key: "checkpoint", label: "Checkpoints", listPath: "/api/imagegen/checkpoints", listField: null, previewPath: "/api/imagegen/checkpoint-previews", adminBase: "/api/admin/checkpoint-previews", extraFields: "checkpoint", deleteKind: "ckpt", addLabel: "+ Add model",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>` },
  { key: "lora", label: "LoRAs", listPath: "/api/imagegen/loras", listField: null, previewPath: "/api/imagegen/lora-previews", adminBase: "/api/admin/lora-previews", extraFields: "lora", deleteKind: "lora", addLabel: "+ Add LoRA",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6z"/></svg>` },
  { key: "sampler", label: "Samplers", listPath: "/api/imagegen/samplers", listField: "samplers", previewPath: "/api/imagegen/sampler-previews", adminBase: "/api/admin/sampler-previews", extraFields: null, deleteKind: null, addLabel: null,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16M4 4l6 4-6 4M14 6h6M14 12h6M14 18h6"/></svg>` },
  { key: "scheduler", label: "Schedulers", listPath: "/api/imagegen/samplers", listField: "schedulers", previewPath: "/api/imagegen/scheduler-previews", adminBase: "/api/admin/scheduler-previews", extraFields: null, deleteKind: null, addLabel: null,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>` },
  { key: "upscaler", label: "Upscalers", listPath: "/api/imagegen/upscalers", listField: null, previewPath: "/api/imagegen/upscaler-previews", adminBase: "/api/admin/upscaler-previews", extraFields: null, deleteKind: "upsc", addLabel: "+ Request upscaler",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>` },
  { key: "vidgen", label: "Vidgen", listPath: "/api/imagegen/wan-unets", listField: null, previewPath: "/api/imagegen/checkpoint-previews", adminBase: "/api/admin/checkpoint-previews", extraFields: null, deleteKind: "ckpt", addLabel: "+ Request video model",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/></svg>` },
];

const ADMIN_MODEL_CATEGORIES = ["flux_v2", "anima", "sdxl", "il", "pony"];
const ADMIN_MODEL_CATEGORY_LABELS = { flux_v2: "Flux V2", anima: "Newer (DiT · Anima)", sdxl: "SDXL", il: "Illustrious", pony: "Pony" };

const ADMIN_PREVIEW_GEN_DEFAULT_PROMPT = "masterpiece, best quality, 1girl, standing, detailed background";

function _pvDataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)[1];
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function _pvIsVideoUrl(url) {
  return /\.(mp4|webm)(\?|$)/i.test(url || "");
}

class AdminPreviewsView {
  async mount(main) {
    this.main = main;
    this.search = {};
    this.collapsed = {};
    this.activeKind = ADMIN_PREVIEW_KINDS[0].key;
    try { this.collapsed = JSON.parse(store.get("admin_previews_collapsed", "{}")) || {}; } catch (e) { this.collapsed = {}; }
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    await this.load();
  }

  toggleSection(kindKey) {
    this.collapsed[kindKey] = !this.collapsed[kindKey];
    store.set("admin_previews_collapsed", JSON.stringify(this.collapsed));
    this.render();
  }

  async load() {
    this.data = {};
    const checkpointsPromise = api("/api/imagegen/checkpoints").catch(() => []);
    const animaUnetsPromise = api("/api/imagegen/anima-unets").catch(() => []);
    const kindPromises = ADMIN_PREVIEW_KINDS.map((kind) => {
      if (kind.key === "checkpoint") {
        return api(kind.previewPath).catch(() => ({})).then((previews) => ({ kind, previews }));
      }
      return Promise.all([
        api(kind.listPath).catch(() => ({})),
        api(kind.previewPath).catch(() => ({})),
      ]).then(([listResp, previews]) => ({ kind, listResp, previews }));
    });
    const [checkpoints, animaUnets, ...kindResults] = await Promise.all([checkpointsPromise, animaUnetsPromise, ...kindPromises]);
    this.animaNames = new Set(animaUnets);
    kindResults.forEach(({ kind, listResp, previews }) => {
      if (kind.key === "checkpoint") {
        this.data[kind.key] = { names: [...checkpoints, ...animaUnets], previews };
        return;
      }
      const names = kind.listField ? (listResp[kind.listField] || []) : (Array.isArray(listResp) ? listResp : []);
      this.data[kind.key] = { names, previews };
    });
    this.render();
  }

  filteredNames(kind) {
    const { names, previews } = this.data[kind.key];
    const search = (this.search[kind.key] || "").toLowerCase();
    return names.filter((n) => {
      if (!search) return true;
      const meta = previews[n] || {};
      const haystack = [n, meta.display_name, meta.description, ...(meta.keywords || [])].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }

  cardHtml(kind, name) {
    const meta = this.data[kind.key].previews[name] || {};
    const cats = meta.model_category || [];
    const archBadge = kind.key === "checkpoint"
      ? `<span class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-line text-muted">${this.animaNames.has(name) ? t("admin_previews_arch_dit", "Newer (DiT · Anima)") : t("admin_previews_arch_unet", "Classic (UNet)")}</span>`
      : "";
    const catBadges = cats.map((c) => `<span class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-line text-muted">${_esc(ADMIN_MODEL_CATEGORY_LABELS[c] || c)}</span>`).join("");
    const badges = (archBadge || catBadges) ? `<div class="flex flex-wrap gap-1 mt-1">${archBadge}${catBadges}</div>` : "";
    const unpublished = kind.key === "lora" && meta.is_published === false;
    const isVideoPreview = kind.key === "vidgen" && _pvIsVideoUrl(meta.image);
    const mediaHtml = isVideoPreview
      ? `<video src="${_attr(meta.image)}" class="w-full h-full object-cover" autoplay loop muted playsinline></video>`
      : (meta.image ? `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover">` : `<span class="text-xs text-muted">${_esc(t("admin_previews_no_preview"))}</span>`);
    return `
      <div class="rounded-[13px] border border-line bg-surface p-2.5 cursor-pointer" onclick="adminPreviewsView.openEdit(${_attr(JSON.stringify(kind.key))}, ${_attr(JSON.stringify(name))})">
        <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-2 grid place-items-center">
          ${mediaHtml}
        </div>
        <div class="text-xs text-ink truncate">${_esc(meta.display_name || name)}</div>
        ${unpublished ? `<div class="text-[10px] text-warn mt-0.5">${t("admin_previews_unpublished")}</div>` : ""}
        ${badges}
      </div>
    `;
  }

  kindSectionHtml(kind) {
    const filtered = this.filteredNames(kind);
    const cards = filtered.map((name) => this.cardHtml(kind, name)).join("");
    const isCollapsed = !!this.collapsed[kind.key];
    return `
      <div class="admin-card admin-previews-card">
        <div class="flex items-center justify-between gap-2 mb-2.5">
          <button type="button" onclick="adminPreviewsView.toggleSection(${_attr(JSON.stringify(kind.key))})" class="flex items-center gap-1.5 font-display font-semibold text-base text-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${isCollapsed ? "-90deg" : "0deg"});transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg>
            ${_esc(kind.label)} <span class="text-xs text-muted font-normal">(${this.data[kind.key].names.length})</span>
          </button>
          ${kind.addLabel ? `<button type="button" onclick="event.stopPropagation();adminPreviewsView.openAddRequest(${_attr(JSON.stringify(kind.key))})" class="text-xs font-semibold px-2.5 py-1.5 rounded-md text-paper bg-gradient-to-br from-primary to-primary-dark">${_esc(kind.addLabel)}</button>` : ""}
        </div>
        ${isCollapsed ? "" : `
          <input type="text" id="pv_search_${_attr(kind.key)}" placeholder="${t("admin_previews_search_placeholder")} ${_attr(kind.label.toLowerCase())}…" value="${_attr(this.search[kind.key] || "")}" oninput="adminPreviewsView.setSearch(${_attr(JSON.stringify(kind.key))}, this.value)"
            class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          <div class="grid grid-cols-3 gap-2.5">${cards || `<p class="text-sm text-muted col-span-3">${t("admin_previews_no_models_found")}</p>`}</div>
        `}
      </div>
    `;
  }

  mobileViewHtml() {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === this.activeKind) || ADMIN_PREVIEW_KINDS[0];
    const filtered = this.filteredNames(kind);
    const cards = filtered.map((name) => this.cardHtml(kind, name)).join("");
    return `
      <div class="lg:hidden">
        <button type="button" id="pv_kind_trigger" class="w-full flex items-center gap-2.5 px-3.5 py-2.5 mb-3 rounded-xl border border-line bg-surface text-left">
          <span style="width:16px;height:16px" class="flex-none text-ink">${kind.icon}</span>
          <span class="flex-1 font-display font-semibold text-sm text-ink">${_esc(kind.label)}</span>
          <span class="font-mono text-[10px] text-muted">(${this.data[kind.key].names.length})</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        </button>
        <div class="relative mb-3">
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" style="width:14px;height:14px">${_PV_ICON_SEARCH}</span>
          <input type="text" id="pv_mobile_search" placeholder="${t("admin_previews_search_placeholder")} ${_attr(kind.label.toLowerCase())}…" value="${_attr(this.search[kind.key] || "")}"
            class="w-full pl-8 pr-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        ${kind.addLabel ? `<button type="button" onclick="adminPreviewsView.openAddRequest(${_attr(JSON.stringify(kind.key))})" class="w-full mb-3 py-2 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${_esc(kind.addLabel)}</button>` : ""}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">${cards || `<p class="text-sm text-muted col-span-2 sm:col-span-4">${t("admin_previews_no_models_found")}</p>`}</div>
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_previews_title"), t("ph_admin_previews_sub"))}
      ${adminScreenSwitcherHtml("admin-previews", window._adminSwitcherBadges || {})}
      ${this.mobileViewHtml()}
      <div class="hidden lg:block admin-previews-grid">
        ${ADMIN_PREVIEW_KINDS.map((k) => this.kindSectionHtml(k)).join("")}
      </div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    const mobileSearch = document.getElementById("pv_mobile_search");
    if (mobileSearch) {
      mobileSearch.oninput = () => this.setSearch(this.activeKind, mobileSearch.value);
      mobileSearch.focus();
      mobileSearch.setSelectionRange(mobileSearch.value.length, mobileSearch.value.length);
    }
    const kindTrigger = document.getElementById("pv_kind_trigger");
    if (kindTrigger) kindTrigger.onclick = () => this.openKindSheet();
  }

  openKindSheet() {
    const node = document.createElement("div");
    node.className = "admin-sheet-layer";
    node.innerHTML = `
      <div class="admin-sheet-backdrop" data-kind-sheet-close></div>
      <div class="admin-sheet">
        <div class="admin-sheet-title">${t("admin_previews_pick_a_kind", "Pick a kind")}</div>
        <div class="grid grid-cols-3 gap-2.5">
          ${ADMIN_PREVIEW_KINDS.map((k) => `
            <button type="button" data-kind-pick="${_attr(k.key)}" class="flex flex-col items-center gap-1.5 py-3.5 rounded-xl border${k.key === this.activeKind ? " border-2" : ""}" style="border-color:${k.key === this.activeKind ? "var(--color-accent)" : "var(--color-line-2)"};background:${k.key === this.activeKind ? "color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-2))" : "var(--color-surface-2)"};color:${k.key === this.activeKind ? "var(--color-accent)" : "var(--color-ink)"}">
              <span style="width:20px;height:20px">${k.icon}</span>
              <span class="font-display font-semibold text-xs">${_esc(k.label)}</span>
              <span class="font-mono text-[9px] opacity-70">${this.data[k.key].names.length}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    node.querySelector("[data-kind-sheet-close]").onclick = () => node.remove();
    node.querySelectorAll("[data-kind-pick]").forEach((btn) => {
      btn.onclick = () => {
        this.activeKind = btn.dataset.kindPick;
        node.remove();
        this.render();
      };
    });
    document.body.appendChild(node);
  }

  setSearch(kindKey, value) {
    this.search[kindKey] = value;
    this.render();
    const input = document.getElementById(`pv_search_${kindKey}`) || document.getElementById("pv_mobile_search");
    if (input) {
      input.focus();
      input.setSelectionRange(value.length, value.length);
    }
  }

  extraFieldsHtml(kind, name, meta) {
    if (kind.extraFields === "checkpoint") {
      const isAnima = this.animaNames.has(name);
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_type")}</label>
          <input type="text" id="pv_model_type" value="${_attr(meta.model_type || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_steps")}</label>
          <input type="number" id="pv_default_steps" value="${_attr(meta.default_steps ?? "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        ${isAnima ? `
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_anima_clip_override")}</label>
            <select id="pv_anima_clip" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm"><option value="">${t("admin_previews_loading")}</option></select>
          </div>
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_anima_vae_override")}</label>
            <select id="pv_anima_vae" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm"><option value="">${t("admin_previews_loading")}</option></select>
          </div>
        ` : ""}
      `;
    }
    if (kind.extraFields === "lora") {
      const cats = meta.model_category || [];
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_categories")}</label>
          <div class="flex flex-wrap gap-1.5">
            ${ADMIN_MODEL_CATEGORIES.map((c) => `
              <button type="button" data-cat="${_attr(c)}" class="px-2.5 py-1 rounded-md border text-xs ${cats.includes(c) ? "on" : ""}" style="border-color:var(--color-line);background:${cats.includes(c) ? "var(--color-accent)" : "var(--color-surface)"};color:${cats.includes(c) ? "var(--color-paper)" : "var(--color-ink)"}">${_esc(ADMIN_MODEL_CATEGORY_LABELS[c] || c)}</button>
            `).join("")}
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_keywords")} <span class="text-muted">${t("admin_previews_keywords_hint")}</span></label>
          <input type="text" id="pv_keywords" value="${_attr((meta.keywords || []).join(", "))}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        ${meta.is_published === false ? `
          <div class="mb-3 p-2.5 rounded-md border border-line flex items-center justify-between gap-2">
            <span class="text-xs text-warn">${t("admin_previews_unpublished_hidden")}</span>
            <button type="button" id="pv_publish" class="px-2.5 py-1 rounded-md text-xs font-semibold text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_publish")}</button>
          </div>
        ` : ""}
      `;
    }
    return "";
  }

  previewBoxHtml(kind, meta) {
    const isVideoPreview = kind.key === "vidgen" && _pvIsVideoUrl(meta.image);
    if (!meta.image) {
      return `
        <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-surface-2 mb-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-muted border border-dashed border-line" id="pv_preview_box">
          <span style="width:22px;height:22px">${_PV_ICON_UPLOAD}</span>
          <span class="font-mono text-[11px] uppercase tracking-[.05em]">${t("admin_previews_tap_to_upload", "Tap to upload")}</span>
          <div class="absolute top-2 right-2 flex gap-1.5" id="pv_preview_actions">
            <button type="button" id="pv_regenerate" title="${_attr(t("admin_previews_regenerate", "Regenerate"))}" class="w-7 h-7 rounded-full flex items-center justify-center border border-line text-ink" style="background:color-mix(in srgb, var(--color-paper) 70%, transparent);backdrop-filter:blur(3px)"><span style="width:14px;height:14px">${_PV_ICON_REGEN}</span></button>
          </div>
        </div>
      `;
    }
    const mediaHtml = isVideoPreview
      ? `<video src="${_attr(meta.image)}" autoplay loop muted playsinline class="w-full h-full object-cover" id="pv_preview_media"></video>`
      : `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover" id="pv_preview_media">`;
    return `
      <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-surface-2 mb-3 border border-line" id="pv_preview_box">
        ${mediaHtml}
        ${!isVideoPreview ? `<span class="absolute left-2 bottom-2 font-mono text-[9px] uppercase tracking-[.04em] text-muted px-1.5 py-1 rounded-md" style="background:color-mix(in srgb, var(--color-paper) 55%, transparent)">${t("admin_previews_tap_to_zoom", "tap to zoom")}</span>` : ""}
        <div class="absolute top-2 right-2 flex gap-1.5" id="pv_preview_actions">
          <button type="button" id="pv_regenerate" title="${_attr(t("admin_previews_regenerate", "Regenerate"))}" class="w-7 h-7 rounded-full flex items-center justify-center border border-line text-ink" style="background:color-mix(in srgb, var(--color-paper) 70%, transparent);backdrop-filter:blur(3px)"><span style="width:14px;height:14px">${_PV_ICON_REGEN}</span></button>
          <button type="button" id="pv_clear_image" title="${_attr(t("admin_previews_delete_preview", "Delete preview"))}" class="w-7 h-7 rounded-full flex items-center justify-center border" style="border-color:color-mix(in srgb, var(--color-warn) 50%, var(--color-line));color:var(--color-warn);background:color-mix(in srgb, var(--color-paper) 70%, transparent);backdrop-filter:blur(3px)"><span style="width:14px;height:14px">${_PV_ICON_DELETE}</span></button>
          <button type="button" id="pv_upload_trigger" title="${_attr(t("admin_previews_upload", "Upload"))}" class="w-7 h-7 rounded-full flex items-center justify-center border border-line text-ink" style="background:color-mix(in srgb, var(--color-paper) 70%, transparent);backdrop-filter:blur(3px)"><span style="width:14px;height:14px">${_PV_ICON_UPLOAD}</span></button>
        </div>
      </div>
    `;
  }

  async openEdit(kindKey, name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === kindKey);
    const meta = this.data[kindKey].previews[name] || {};
    openModal(`
      <div class="flex items-start justify-between gap-2 mb-1" style="padding-right:42px">
        <div class="min-w-0">
          <h3 class="mb-0">${_esc(meta.display_name || name)}</h3>
          <p class="font-mono text-xs text-muted mt-0.5 break-all">${_esc(name)}</p>
        </div>
        <div class="flex gap-1.5 flex-none">
          <button type="button" id="pv_save" title="${_attr(t("admin_previews_save"))}" class="w-8 h-8 rounded-md flex items-center justify-center text-paper bg-gradient-to-br from-primary to-primary-dark"><span style="width:15px;height:15px">${_PV_ICON_SAVE}</span></button>
          ${kind.deleteKind ? `<button type="button" id="pv_delete_file" title="${_attr(t("admin_previews_delete_file"))}" class="w-8 h-8 rounded-md flex items-center justify-center border" style="border-color:var(--color-warn);color:var(--color-warn)"><span style="width:15px;height:15px">${_PV_ICON_DELETE}</span></button>` : ""}
        </div>
      </div>
      <div class="mt-3">${this.previewBoxHtml(kind, meta)}</div>
      <input type="file" id="pv_file" accept="image/*" class="hidden">
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_display_name")}</label>
        <input type="text" id="pv_display_name" value="${_attr(meta.display_name || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_description")}</label>
        <textarea id="pv_description" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(meta.description || "")}</textarea>
      </div>
      ${this.extraFieldsHtml(kind, name, meta)}
    `);

    if (kind.extraFields === "checkpoint" && this.animaNames.has(name)) {
      const [clipModels, vaeModels] = await Promise.all([
        api("/api/imagegen/clip-models").catch(() => []),
        api("/api/imagegen/vaes").catch(() => []),
      ]);
      const clipSel = document.getElementById("pv_anima_clip");
      const vaeSel = document.getElementById("pv_anima_vae");
      if (clipSel) {
        clipSel.innerHTML = `<option value="">${t("admin_previews_default_option")}</option>${clipModels.map((m) => `<option value="${_attr(m)}"${m === meta.anima_clip_name ? " selected" : ""}>${_esc(m)}</option>`).join("")}`;
      }
      if (vaeSel) {
        vaeSel.innerHTML = `<option value="">${t("admin_previews_default_option")}</option>${vaeModels.map((m) => `<option value="${_attr(m)}"${m === meta.anima_vae_name ? " selected" : ""}>${_esc(m)}</option>`).join("")}`;
      }
    }

    document.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.onclick = () => {
        btn.classList.toggle("on");
        const isOn = btn.classList.contains("on");
        btn.style.background = isOn ? "var(--color-accent)" : "var(--color-surface)";
        btn.style.color = isOn ? "var(--color-paper)" : "var(--color-ink)";
      };
    });

    const isVideoPreview = kind.key === "vidgen" && _pvIsVideoUrl(meta.image);
    const previewMedia = document.getElementById("pv_preview_media");
    if (previewMedia && !isVideoPreview && typeof _wireZoomPan === "function") {
      _wireZoomPan(previewMedia);
    }

    const fileInput = document.getElementById("pv_file");
    const previewBox = document.getElementById("pv_preview_box");
    if (!meta.image && previewBox) previewBox.onclick = (e) => { if (e.target.closest("#pv_preview_actions")) return; fileInput.click(); };

    const uploadTrigger = document.getElementById("pv_upload_trigger");
    if (uploadTrigger) uploadTrigger.onclick = () => fileInput.click();

    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { errorToast(t("admin_previews_file_too_large")); return; }
      const fd = new FormData();
      fd.append("file", file, file.name);
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      }
    };

    const clearBtn = document.getElementById("pv_clear_image");
    if (clearBtn) clearBtn.onclick = async () => {
      if (!(await confirmDialog(t("admin_previews_confirm_clear_preview")))) return;
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "DELETE" });
        toast(t("admin_previews_preview_image_cleared"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_clear_preview"));
      }
    };

    const regenBtn = document.getElementById("pv_regenerate");
    if (regenBtn) regenBtn.onclick = (e) => { e.stopPropagation(); this.openGeneratePreview(kind, name, meta); };

    const publishBtn = document.getElementById("pv_publish");
    if (publishBtn) publishBtn.onclick = async () => {
      try {
        await api(`/api/admin/lora-previews/${encodeURIComponent(name)}/publish`, { method: "PUT", body: JSON.stringify({ published: true }) });
        toast(t("admin_previews_published_visible_to_all"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_publish_failed"));
      }
    };

    const deleteFileBtn = document.getElementById("pv_delete_file");
    if (deleteFileBtn) deleteFileBtn.onclick = async () => {
      if (!(await confirmDialog(t("admin_previews_confirm_delete_file")))) return;
      try {
        await api(`/api/admin/models/${kind.deleteKind}/${encodeURIComponent(name)}`, { method: "DELETE" });
        toast(t("admin_previews_deleted"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_delete_failed"));
      }
    };

    document.getElementById("pv_save").onclick = async () => {
      const body = {
        display_name: document.getElementById("pv_display_name").value.trim() || null,
        description: document.getElementById("pv_description").value.trim() || null,
      };
      if (kind.extraFields === "checkpoint") {
        body.model_type = document.getElementById("pv_model_type").value.trim() || null;
        const steps = document.getElementById("pv_default_steps").value.trim();
        body.default_steps = steps ? parseInt(steps, 10) : null;
        const clipSel = document.getElementById("pv_anima_clip");
        const vaeSel = document.getElementById("pv_anima_vae");
        body.anima_clip_name = clipSel ? (clipSel.value || null) : null;
        body.anima_vae_name = vaeSel ? (vaeSel.value || null) : null;
      }
      if (kind.extraFields === "lora") {
        body.model_category = [...document.querySelectorAll("[data-cat]")]
          .filter((b) => b.classList.contains("on"))
          .map((b) => b.dataset.cat);
        body.keywords = document.getElementById("pv_keywords").value.split(",").map((s) => s.trim()).filter(Boolean);
      }
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}/meta`, { method: "PUT", body: JSON.stringify(body) });
        toast(t("admin_previews_saved"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_save"));
      }
    };
  }

  _defaultCheckpointFor(architecture) {
    const names = this.data.checkpoint.names;
    if (architecture === "anima") return names.find((n) => this.animaNames.has(n)) || "";
    return names.find((n) => !this.animaNames.has(n)) || "";
  }

  _defaultSampler() {
    const s = this.data.sampler.names;
    return s.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (s.includes("euler") ? "euler" : (s[0] || "euler"));
  }

  _defaultScheduler() {
    const s = this.data.scheduler.names;
    return s.includes("karras") ? "karras" : (s.includes("normal") ? "normal" : (s[0] || "normal"));
  }

  _setGenRunButton(runBtn, running) {
    runBtn.disabled = running;
    runBtn.innerHTML = running
      ? `<span style="width:15px;height:15px">${_PV_ICON_STOP}</span>${_esc(t("admin_previews_stop", "Stop"))}`
      : `<span style="width:15px;height:15px">${_PV_ICON_REGEN}</span>${_esc(t("admin_previews_generate"))}`;
  }

  _genGeneratingBadgeHtml() {
    return `<span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">${t("forge_generating_badge")}</span>`;
  }

  async openGenerateVidgenPreview(name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === "vidgen");
    const st = await api("/api/settings").catch(() => ({}));
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_wan_generate_description")}</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_prompt")}</label>
        <textarea id="pvv_prompt" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(ADMIN_PREVIEW_GEN_DEFAULT_PROMPT)}</textarea>
      </div>
      <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center" id="pvv_preview">
        <span class="text-xs text-muted">${t("admin_previews_preview_will_appear_here")}</span>
      </div>
      <button type="button" id="pvv_run" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center gap-2"><span style="width:15px;height:15px">${_PV_ICON_REGEN}</span>${_esc(t("admin_previews_generate"))}</button>
      <button type="button" id="pvv_use" class="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border border-line text-ink hidden">${t("admin_previews_use_as_preview")}</button>
    `, { wide: true });

    const runBtn = layer.querySelector("#pvv_run");
    const useBtn = layer.querySelector("#pvv_use");
    const previewBox = layer.querySelector("#pvv_preview");
    let videoUrl = null;
    let controller = null;

    runBtn.onclick = async () => {
      if (controller) { controller.abort(); return; }
      controller = new AbortController();
      this._setGenRunButton(runBtn, true);
      useBtn.classList.add("hidden");
      videoUrl = null;
      previewBox.innerHTML = this._genGeneratingBadgeHtml() + `<span class="text-xs text-muted">${t("admin_previews_starting")}</span>`;
      const body = {
        positive: layer.querySelector("#pvv_prompt").value.trim(),
        negative: "",
        unet_name: name,
        clip_name: st.wan_clip_name || null,
        vae_name: st.wan_vae_name || null,
        fps: 16, num_frames: 33, width: 832, height: 480, steps: 20, cfg: 6.0,
      };
      try {
        const res = await fetch(`${API}/api/imagegen/video`, {
          method: "POST", credentials: "include", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail || detail; } catch (e) {  }
          throw new Error(detail);
        }
        await sseEvents(res, (ev) => {
          if (ev.type === "status") {
            previewBox.innerHTML = this._genGeneratingBadgeHtml() + `<span class="text-xs text-muted">${_esc(ev.message)}</span>`;
          } else if (ev.type === "preview") {
            let img = previewBox.querySelector("#pvv_live_preview");
            if (!img) previewBox.innerHTML = this._genGeneratingBadgeHtml() + `<img id="pvv_live_preview" src="${_attr(ev.image)}" style="width:100%;height:100%;object-fit:cover">`;
            else img.src = ev.image;
          } else if (ev.type === "done") {
            videoUrl = ev.video.image;
            previewBox.innerHTML = `<video src="${_attr(videoUrl)}" style="width:100%;height:100%;object-fit:cover" controls autoplay muted loop playsinline></video>`;
            useBtn.classList.remove("hidden");
          } else if (ev.type === "error") {
            errorToast(ev.message || t("admin_previews_generation_failed"));
          }
        });
      } catch (err) {
        if (err.name !== "AbortError") errorToast(err.message || t("admin_previews_generation_failed"));
      } finally {
        controller = null;
        this._setGenRunButton(runBtn, false);
      }
    };

    useBtn.onclick = async () => {
      if (!videoUrl) return;
      useBtn.disabled = true;
      try {
        const blob = await (await fetch(videoUrl, { credentials: "include" })).blob();
        const fd = new FormData();
        fd.append("file", blob, "preview.mp4");
        await api(`${kind.adminBase}/${encodeURIComponent(name)}/video`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_video_updated"));
        closeModal(layer);
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      } finally {
        useBtn.disabled = false;
      }
    };
  }

  openGeneratePreview(kind, name, meta) {
    if (kind.key === "upscaler") { this.openGenerateUpscalerPreview(name); return; }
    if (kind.key === "vidgen") { this.openGenerateVidgenPreview(name); return; }

    const isAnimaCkpt = kind.key === "checkpoint" && this.animaNames.has(name);
    const architecture = isAnimaCkpt ? "anima" : "sdxl";
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_generate_description_prefix")} ${_esc(kind.key)}${t("admin_previews_generate_description_suffix")}</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_prompt")}</label>
        <textarea id="pvg_prompt" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(ADMIN_PREVIEW_GEN_DEFAULT_PROMPT)}</textarea>
      </div>
      <div class="relative w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center" id="pvg_preview">
        <span class="text-xs text-muted">${t("admin_previews_preview_will_appear_here")}</span>
      </div>
      <button type="button" id="pvg_run" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center gap-2"><span style="width:15px;height:15px">${_PV_ICON_REGEN}</span>${_esc(t("admin_previews_generate"))}</button>
      <button type="button" id="pvg_use" class="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border border-line text-ink hidden">${t("admin_previews_use_as_preview")}</button>
    `, { wide: true });

    let resultDataUrl = null;
    let controller = null;
    const runBtn = layer.querySelector("#pvg_run");
    const useBtn = layer.querySelector("#pvg_use");
    const previewBox = layer.querySelector("#pvg_preview");

    runBtn.onclick = async () => {
      if (controller) { controller.abort(); return; }
      controller = new AbortController();
      this._setGenRunButton(runBtn, true);
      useBtn.classList.add("hidden");
      resultDataUrl = null;
      previewBox.innerHTML = this._genGeneratingBadgeHtml();
      const anima = architecture === "anima";
      const body = {
        positive: layer.querySelector("#pvg_prompt").value.trim(),
        negative: "",
        checkpoint: kind.key === "checkpoint" ? name : this._defaultCheckpointFor(architecture),
        loras: kind.key === "lora" ? [{ name, strength: 0.8 }] : [],
        width: 1024, height: 1024,
        sampler: kind.key === "sampler" ? name : (anima ? ANIMA_DEFAULT_SAMPLER : this._defaultSampler()),
        scheduler: kind.key === "scheduler" ? name : (anima ? ANIMA_DEFAULT_SCHEDULER : this._defaultScheduler()),
        steps: 20, cfg: anima ? ANIMA_DEFAULT_CFG : 7.0,
        architecture,
      };
      try {
        const res = await fetch(`${API}/api/imagegen/standalone/stream`, {
          method: "POST", credentials: "include", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        await sseEvents(res, (ev) => {
          if (ev.type === "preview") {
            previewBox.innerHTML = this._genGeneratingBadgeHtml() + `<img src="${_attr(ev.image)}" alt="" class="w-full h-full object-cover">`;
          } else if (ev.type === "done") {
            resultDataUrl = ev.image;
            previewBox.innerHTML = `<img src="${_attr(ev.image)}" alt="" class="w-full h-full object-cover">`;
            useBtn.classList.remove("hidden");
          } else if (ev.type === "error") {
            errorToast(ev.message || t("admin_previews_generation_failed"));
          }
        });
      } catch (err) {
        if (err.name !== "AbortError") errorToast(err.message || t("admin_previews_generation_failed"));
      } finally {
        controller = null;
        this._setGenRunButton(runBtn, false);
      }
    };

    useBtn.onclick = async () => {
      if (!resultDataUrl) return;
      const fd = new FormData();
      fd.append("file", _pvDataUrlToBlob(resultDataUrl), "preview.png");
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeModal(layer);
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      }
    };
  }

  openGenerateUpscalerPreview(name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === "upscaler");
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_upscaler_description")}</p>
      <label class="w-full py-2 mb-3 rounded-md border border-line text-center text-sm text-ink cursor-pointer block">
        ${t("admin_previews_choose_source_image")}
        <input type="file" id="pvu_file" accept="image/*" class="hidden">
      </label>
      <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center" id="pvu_preview">
        <span class="text-xs text-muted">${t("admin_previews_source_image_will_appear_here")}</span>
      </div>
      <button type="button" id="pvu_run" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark" disabled>${t("admin_previews_upscale")}</button>
      <button type="button" id="pvu_use" class="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border border-line text-ink hidden">${t("admin_previews_use_as_preview")}</button>
    `, { wide: true });

    let srcDataUrl = null, resultDataUrl = null;
    const fileInput = layer.querySelector("#pvu_file");
    const previewBox = layer.querySelector("#pvu_preview");
    const runBtn = layer.querySelector("#pvu_run");
    const useBtn = layer.querySelector("#pvu_use");

    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        srcDataUrl = reader.result;
        previewBox.innerHTML = `<img src="${_attr(srcDataUrl)}" alt="" class="w-full h-full object-cover">`;
        runBtn.disabled = false;
        useBtn.classList.add("hidden");
        resultDataUrl = null;
      };
      reader.readAsDataURL(file);
    };

    runBtn.onclick = async () => {
      if (!srcDataUrl) return;
      runBtn.disabled = true;
      runBtn.textContent = t("admin_previews_upscaling");
      try {
        const res = await api("/api/imagegen/upscale", { method: "POST", body: JSON.stringify({ image: srcDataUrl, upscaler: name }) });
        resultDataUrl = res.image;
        previewBox.innerHTML = `<img src="${_attr(resultDataUrl)}" alt="" class="w-full h-full object-cover">`;
        useBtn.classList.remove("hidden");
      } catch (err) {
        errorToast(err.message || t("admin_previews_upscale_failed"));
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = t("admin_previews_upscale_again");
      }
    };

    useBtn.onclick = async () => {
      if (!resultDataUrl) return;
      const fd = new FormData();
      fd.append("file", _pvDataUrlToBlob(resultDataUrl), "preview.png");
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeModal(layer);
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      }
    };
  }

  openAddRequest(kindKey) {
    const requestTypeFor = { checkpoint: "checkpoint", lora: "lora", upscaler: "upscaler", vidgen: "wan" };
    const baseType = requestTypeFor[kindKey];
    const needsAux = baseType === "checkpoint" || baseType === "wan";
    const layer = openModal(`
      <h3>${t("admin_previews_request_a_model")}</h3>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_model_name")}</label>
        <input type="text" id="pvr_name" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_source_url")}</label>
        <input type="text" id="pvr_url" placeholder="https://…" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      ${baseType === "checkpoint" ? `
        <label class="flex items-center gap-2 mb-3 text-sm text-ink">
          <input type="checkbox" id="pvr_anima">
          ${t("admin_previews_this_is_anima_model")}
        </label>
      ` : ""}
      ${needsAux ? `
        <div id="pvr_aux_fields" class="${baseType === "wan" ? "" : "hidden"}">
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_vae_url_optional")}</label>
            <input type="text" id="pvr_vae_url" placeholder="https://…" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          </div>
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_text_encoder_url_optional")}</label>
            <input type="text" id="pvr_te_url" placeholder="https://…" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          </div>
        </div>
      ` : ""}
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_note")}</label>
        <textarea id="pvr_note" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:50px"></textarea>
      </div>
      <button type="button" id="pvr_submit" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_submit_request")}</button>
    `);

    const animaCheck = layer.querySelector("#pvr_anima");
    const auxFields = layer.querySelector("#pvr_aux_fields");
    if (animaCheck) animaCheck.onchange = () => auxFields.classList.toggle("hidden", !animaCheck.checked);

    layer.querySelector("#pvr_submit").onclick = async () => {
      const model_name = layer.querySelector("#pvr_name").value.trim();
      const source_url = layer.querySelector("#pvr_url").value.trim();
      if (!model_name || !source_url) { errorToast(t("admin_previews_name_and_url_required")); return; }
      const request_type = (baseType === "checkpoint" && animaCheck?.checked) ? "anima" : baseType;
      const body = {
        model_name, source_url, request_type,
        note: layer.querySelector("#pvr_note").value.trim(),
      };
      if (request_type === "anima" || request_type === "wan") {
        body.vae_url = layer.querySelector("#pvr_vae_url").value.trim() || null;
        body.text_encoder_url = layer.querySelector("#pvr_te_url").value.trim() || null;
      }
      try {
        await api("/api/imagegen/model-requests", { method: "POST", body: JSON.stringify(body) });
        toast(t("admin_previews_request_submitted"));
        closeModal(layer);
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_submit_request"));
      }
    };
  }
}

if (typeof window !== "undefined") {
  window.AdminPreviewsView = AdminPreviewsView;
}
