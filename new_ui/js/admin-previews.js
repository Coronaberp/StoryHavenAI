"use strict";

const _PV_ICON_SAVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
const _PV_ICON_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"/></svg>`;
const _PV_ICON_REGEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
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

const ADMIN_PREVIEW_NSFW_PREFIX = "adult woman, mature adult, curvy figure";
const ADMIN_PREVIEW_NSFW_POSITIVE = "nsfw, explicit, uncensored, seductive pose, sultry expression, bedroom eyes, "
  + "translucent clothing, see-through wet shirt, unbuttoned shirt, open shirt, revealing outfit, "
  + "small breasts, bare shoulders, collarbone, exposed midriff, thighs, "
  + "glistening skin, detailed skin texture, sensual lighting, intimate atmosphere, "
  + "face visible, detailed face, looking at viewer, detailed eyes, both eyes visible, "
  + "hands visible, detailed hands, five fingers, upper body";
const ADMIN_PREVIEW_NSFW_NEGATIVE_DROP = ["nsfw", "explicit", "nude", "nudity", "naked", "sexual", "sexy",
  "suggestive", "erotic", "cleavage", "revealing clothes", "revealing clothing", "revealing outfit",
  "lingerie", "underwear", "panties", "bra", "topless", "nipples", "see-through", "seethrough",
  "small breasts", "flat chest",
  "skimpy", "provocative", "sensual"];
const ADMIN_PREVIEW_NSFW_POSITIVE_DROP = ["teenage girl", "teenage", "teenager", "teen", "young girl",
  "little girl", "child", "kid", "loli", "shota", "schoolgirl", "school girl", "underage", "petite child"];

const ADMIN_PREVIEW_GEN_SIZE = 1024;

const ADMIN_MODEL_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "Pony", label: "Pony" },
  { value: "IL", label: "Illustrious" },
  { value: "SDXL", label: "SDXL" },
  { value: "Anima", label: "Anima" },
];

const ADMIN_MODEL_CATEGORIES =["flux_v2", "anima", "sdxl", "il", "pony"];
const ADMIN_MODEL_CATEGORY_LABELS = { flux_v2: "Flux V2", anima: "Newer (DiT · Anima)", sdxl: "SDXL", il: "Illustrious", pony: "Pony" };

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
    const settingsPromise = api("/api/settings").catch(() => ({}));
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
    const [settings, checkpoints, animaUnets, ...kindResults] = await Promise.all([settingsPromise, checkpointsPromise, animaUnetsPromise, ...kindPromises]);
    this.defaultPositive = settings.preview_gen_default_positive || "";
    this.defaultNegative = settings.preview_gen_default_negative || "";
    this.nsfwPositive = settings.preview_gen_nsfw_positive || "";
    this.nsfwNegative = settings.preview_gen_nsfw_negative || "";
    this.imageGenDefaults = {
      sdxl: {
        checkpoint: settings.image_gen_default_checkpoint_sdxl || "",
        sampler: settings.image_gen_default_sampler_sdxl || "",
        scheduler: settings.image_gen_default_scheduler_sdxl || "",
        steps: settings.image_gen_default_steps_sdxl || 20,
        cfg: settings.image_gen_default_cfg_sdxl || 7.0,
      },
      anima: {
        checkpoint: settings.image_gen_default_checkpoint_anima || "",
        sampler: settings.image_gen_default_sampler_anima || "",
        scheduler: settings.image_gen_default_scheduler_anima || "",
        steps: settings.image_gen_default_steps_anima || 20,
        cfg: settings.image_gen_default_cfg_anima || 4.0,
      },
    };
    this._imageGenDefaultsArch = this._imageGenDefaultsArch || "sdxl";
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

  wireKeywordPills(initial) {
    this._pvKeywords = [...initial];
    const wrap = document.getElementById("pv_keywords");
    const input = document.getElementById("pv_keyword_input");
    if (!wrap || !input) return;
    const paint = () => {
      document.getElementById("pv_keyword_pills").innerHTML = this._pvKeywords.map((kw) => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style="background:var(--color-surface-2);color:var(--color-accent);border:1px solid var(--color-line-2)">
          ${_esc(kw)}
          <button type="button" data-keyword-remove="${_attr(kw)}" class="text-muted" style="line-height:1">&times;</button>
        </span>
      `).join("");
      document.querySelectorAll("[data-keyword-remove]").forEach((btn) => {
        btn.onclick = () => {
          this._pvKeywords = this._pvKeywords.filter((kw) => kw !== btn.dataset.keywordRemove);
          paint();
        };
      });
    };
    const commit = () => {
      const value = input.value.trim().replace(/,$/, "").trim();
      input.value = "";
      if (!value || this._pvKeywords.includes(value)) return;
      this._pvKeywords.push(value);
      paint();
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); return; }
      if (e.key === "Backspace" && !input.value && this._pvKeywords.length) {
        this._pvKeywords.pop();
        paint();
      }
    };
    input.onblur = commit;
    wrap.onclick = () => input.focus();
    paint();
  }

  optionPickerItem(kindKey, name) {
    const meta = this.data[kindKey]?.previews?.[name] || {};
    return { name, label: meta.display_name || name, sublabel: meta.description || null, image: meta.image || null };
  }

  cardHtml(kind, name) {
    const meta = this.data[kind.key].previews[name] || {};
    const cats = meta.model_category || [];
    const typeTag = meta.model_type || ADMIN_MODEL_CATEGORY_LABELS[cats[0]] || "";
    const unpublished = kind.key === "lora" && meta.is_published === false;
    const isVideoPreview = kind.key === "vidgen" && _pvIsVideoUrl(meta.image);
    const mediaHtml = isVideoPreview
      ? `<video src="${_attr(meta.image)}" class="w-full h-full object-cover" autoplay loop muted playsinline></video>`
      : `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover" loading="lazy">`;
    const frame = meta.image
      ? `<span class="pv-frame">${mediaHtml}${meta.image_nsfw ? `<span class="pv-frame-mark">+nsfw</span>` : ""}</span>`
      : `<span class="pv-frame pv-frame-empty">${t("admin_previews_frame_unset", "unset")}</span>`;
    return `
      <button type="button" class="pv-sheet-cell${meta.image ? "" : " is-unset"}" onclick="adminPreviewsView.openEdit(${_attr(JSON.stringify(kind.key))}, ${_attr(JSON.stringify(name))})">
        ${frame}
        <span class="pv-cell-name">${_esc(meta.display_name || name)}</span>
        <span class="pv-cell-meta">
          ${typeTag ? `<span class="pv-cell-type">${_esc(typeTag)}</span>` : ""}
          ${unpublished ? `<span class="pv-cell-hidden">${t("admin_previews_unpublished")}</span>` : ""}
        </span>
      </button>
    `;
  }

  coverageHtml(kind) {
    const { names, previews } = this.data[kind.key];
    const curated = names.filter((n) => previews[n]?.image).length;
    const pct = names.length ? Math.round((curated / names.length) * 100) : 0;
    return `
      <span class="pv-coverage" title="${_attr(t("admin_previews_coverage_title", "Models with a preview image"))}">
        <span class="pv-coverage-rule"><span style="width:${pct}%"></span></span>
        <span class="pv-coverage-count">${curated}/${names.length} ${t("admin_previews_coverage_word", "curated")}</span>
      </span>
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
            ${_esc(kind.label)}
          </button>
          ${this.coverageHtml(kind)}
          ${kind.addLabel ? `<button type="button" onclick="event.stopPropagation();adminPreviewsView.openAddRequest(${_attr(JSON.stringify(kind.key))})" class="text-xs font-semibold px-2.5 py-1.5 rounded-md text-paper bg-gradient-to-br from-primary to-primary-dark">${_esc(kind.addLabel)}</button>` : ""}
        </div>
        ${isCollapsed ? "" : `
          <input type="text" id="pv_search_${_attr(kind.key)}" placeholder="${t("admin_previews_search_placeholder")} ${_attr(kind.label.toLowerCase())}…" value="${_attr(this.search[kind.key] || "")}" oninput="adminPreviewsView.setSearch(${_attr(JSON.stringify(kind.key))}, this.value)"
            class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          <div class="pv-card-grid">${cards || `<p class="text-sm text-muted">${t("admin_previews_no_models_found")}</p>`}</div>
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
          ${this.coverageHtml(kind)}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        </button>
        <div class="relative mb-3">
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" style="width:14px;height:14px">${_PV_ICON_SEARCH}</span>
          <input type="text" id="pv_mobile_search" placeholder="${t("admin_previews_search_placeholder")} ${_attr(kind.label.toLowerCase())}…" value="${_attr(this.search[kind.key] || "")}"
            class="w-full pl-8 pr-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        ${kind.addLabel ? `<button type="button" onclick="adminPreviewsView.openAddRequest(${_attr(JSON.stringify(kind.key))})" class="w-full mb-3 py-2 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${_esc(kind.addLabel)}</button>` : ""}
        <div class="pv-card-grid">${cards || `<p class="text-sm text-muted">${t("admin_previews_no_models_found")}</p>`}</div>
      </div>
    `;
  }

  defaultPromptsCardHtml() {
    const field = (id, label, value) => `
      <div>
        <label class="block text-xs text-sec mb-1">${label}</label>
        <textarea id="${id}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(value)}</textarea>
      </div>
    `;
    return `
      <div class="admin-card mb-4">
        <div class="font-display font-semibold text-base text-ink mb-1">${t("admin_previews_default_prompts_title", "Default preview prompt")}</div>
        <p class="text-xs text-muted mb-3">${t("admin_previews_default_prompts_desc", "Used to seed the prompt fields whenever a new preview image is generated below.")}</p>
        <div class="pv-prompt-tabs mb-3">
          <button type="button" data-pv-prompt-tab="sfw" class="pv-prompt-tab is-on">${t("admin_previews_variant_sfw", "Safe")}</button>
          <button type="button" data-pv-prompt-tab="nsfw" class="pv-prompt-tab">${t("admin_previews_variant_nsfw", "NSFW")}</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3" data-pv-prompt-pane="sfw">
          ${field("pv_global_positive", t("admin_previews_default_positive_global", "Positive prompt"), this.defaultPositive)}
          ${field("pv_global_negative", t("admin_previews_default_negative_global", "Negative prompt"), this.defaultNegative)}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3" data-pv-prompt-pane="nsfw" hidden>
          ${field("pv_nsfw_positive", t("admin_previews_nsfw_positive", "NSFW positive prompt"), this.nsfwPositive)}
          ${field("pv_nsfw_negative", t("admin_previews_nsfw_negative", "NSFW negative prompt"), this.nsfwNegative)}
        </div>
        <button type="button" id="pv_default_prompts_save" class="px-4 py-2 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("common_save", "Save")}</button>
      </div>
    `;
  }

  wirePromptTabs() {
    document.querySelectorAll("[data-pv-prompt-tab]").forEach((btn) => {
      btn.onclick = () => {
        const tab = btn.dataset.pvPromptTab;
        document.querySelectorAll("[data-pv-prompt-tab]").forEach((b) => b.classList.toggle("is-on", b === btn));
        document.querySelectorAll("[data-pv-prompt-pane]").forEach((pane) => {
          pane.hidden = pane.dataset.pvPromptPane !== tab;
        });
      };
    });
  }

  async saveDefaultPrompts() {
    const btn = document.getElementById("pv_default_prompts_save");
    const positive = document.getElementById("pv_global_positive").value.trim();
    const negative = document.getElementById("pv_global_negative").value.trim();
    const nsfwPositive = document.getElementById("pv_nsfw_positive").value.trim();
    const nsfwNegative = document.getElementById("pv_nsfw_negative").value.trim();
    btn.disabled = true;
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          preview_gen_default_positive: positive, preview_gen_default_negative: negative,
          preview_gen_nsfw_positive: nsfwPositive, preview_gen_nsfw_negative: nsfwNegative,
        }),
      });
      this.defaultPositive = positive;
      this.defaultNegative = negative;
      this.nsfwPositive = nsfwPositive;
      this.nsfwNegative = nsfwNegative;
      toast(t("admin_previews_default_prompts_saved", "Default preview prompt saved"));
    } catch (err) {
      errorToast(err.message || t("common_save_failed", "Couldn't save"));
    } finally {
      btn.disabled = false;
    }
  }

  imageGenDefaultsCardHtml() {
    const arch = this._imageGenDefaultsArch;
    const values = this.imageGenDefaults[arch];
    const checkpointNames = arch === "anima"
      ? this.data.checkpoint.names.filter((n) => this.animaNames.has(n))
      : this.data.checkpoint.names.filter((n) => !this.animaNames.has(n));
    const samplerNames = this.data.sampler.names;
    const schedulerNames = this.data.scheduler.names;
    return `
      <div class="admin-card mb-4">
        <div class="font-display font-semibold text-base text-ink mb-1">${t("admin_previews_image_gen_defaults_title", "Default generation settings")}</div>
        <p class="text-xs text-muted mb-3">${t("admin_previews_image_gen_defaults_desc", "Used as the fallback default whenever an image is generated anywhere in the app, unless the user picks something else, or a model has its own saved override.")}</p>
        <div class="flex mb-3 rounded-lg border border-line overflow-hidden">
          <button type="button" id="igd_arch_sdxl" class="flex-1 py-2 text-xs font-semibold${arch === "sdxl" ? " text-ink" : " text-muted"}" style="background:${arch === "sdxl" ? "color-mix(in srgb, var(--color-accent) 22%, var(--color-surface-2))" : "var(--color-surface-2)"}">${t("admin_previews_arch_sdxl", "SDXL / Illustrious / Pony")}</button>
          <button type="button" id="igd_arch_anima" class="flex-1 py-2 text-xs font-semibold border-l border-line${arch === "anima" ? " text-ink" : " text-muted"}" style="background:${arch === "anima" ? "color-mix(in srgb, var(--color-accent) 22%, var(--color-surface-2))" : "var(--color-surface-2)"}">${t("admin_previews_arch_anima", "Anima (newer · DiT)")}</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs text-sec mb-1">${t("admin_previews_image_gen_model", "Model")}</label>
            <div id="igd_checkpoint_wrap">${checkpointPickerHtml("igd_checkpoint", checkpointNames, this.data.checkpoint.previews, values.checkpoint)}</div>
          </div>
          <div></div>
          <div>
            <label class="block text-xs text-sec mb-1">${t("admin_previews_image_gen_sampler", "Sampler")}</label>
            <div id="igd_sampler_wrap">${checkpointPickerHtml("igd_sampler", samplerNames, this.data.sampler.previews, values.sampler)}</div>
          </div>
          <div>
            <label class="block text-xs text-sec mb-1">${t("admin_previews_image_gen_scheduler", "Scheduler")}</label>
            <div id="igd_scheduler_wrap">${checkpointPickerHtml("igd_scheduler", schedulerNames, this.data.scheduler.previews, values.scheduler)}</div>
          </div>
          <div>
            <label class="block text-xs text-sec mb-1">${t("admin_previews_image_gen_steps", "Steps")}</label>
            <input type="number" id="igd_steps" value="${_attr(values.steps)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          </div>
          <div>
            <label class="block text-xs text-sec mb-1">${t("admin_previews_image_gen_cfg", "CFG")}</label>
            <input type="number" step="0.5" id="igd_cfg" value="${_attr(values.cfg)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          </div>
        </div>
        <button type="button" id="igd_save" class="px-4 py-2 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("common_save", "Save")}</button>
      </div>
    `;
  }

  switchImageGenArch(arch) {
    this._imageGenDefaultsArch = arch;
    this.render();
  }

  wireImageGenDefaultsCard() {
    const archSdxlBtn = document.getElementById("igd_arch_sdxl");
    const archAnimaBtn = document.getElementById("igd_arch_anima");
    if (archSdxlBtn) archSdxlBtn.onclick = () => this.switchImageGenArch("sdxl");
    if (archAnimaBtn) archAnimaBtn.onclick = () => this.switchImageGenArch("anima");

    const arch = this._imageGenDefaultsArch;
    const values = this.imageGenDefaults[arch];
    wireCheckpointPicker("igd_checkpoint", (name) => { values.checkpoint = name; });
    wireCheckpointPicker("igd_sampler", (name) => { values.sampler = name; });
    wireCheckpointPicker("igd_scheduler", (name) => { values.scheduler = name; });

    const stepsInput = document.getElementById("igd_steps");
    const cfgInput = document.getElementById("igd_cfg");
    if (stepsInput) stepsInput.oninput = () => { values.steps = Number(stepsInput.value) || values.steps; };
    if (cfgInput) cfgInput.oninput = () => { values.cfg = Number(cfgInput.value) || values.cfg; };

    const saveBtn = document.getElementById("igd_save");
    if (saveBtn) saveBtn.onclick = () => this.saveImageGenDefaults();
  }

  async saveImageGenDefaults() {
    const btn = document.getElementById("igd_save");
    btn.disabled = true;
    const sdxl = this.imageGenDefaults.sdxl;
    const anima = this.imageGenDefaults.anima;
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          image_gen_default_checkpoint_sdxl: sdxl.checkpoint,
          image_gen_default_sampler_sdxl: sdxl.sampler,
          image_gen_default_scheduler_sdxl: sdxl.scheduler,
          image_gen_default_steps_sdxl: sdxl.steps,
          image_gen_default_cfg_sdxl: sdxl.cfg,
          image_gen_default_checkpoint_anima: anima.checkpoint,
          image_gen_default_sampler_anima: anima.sampler,
          image_gen_default_scheduler_anima: anima.scheduler,
          image_gen_default_steps_anima: anima.steps,
          image_gen_default_cfg_anima: anima.cfg,
        }),
      });
      toast(t("admin_previews_image_gen_defaults_saved", "Default generation settings saved"));
    } catch (err) {
      errorToast(err.message || t("common_save_failed", "Couldn't save"));
    } finally {
      btn.disabled = false;
    }
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_previews_title"), t("ph_admin_previews_sub"))}
      ${adminScreenSwitcherHtml("admin-previews", window._adminSwitcherBadges || {})}
      ${this.defaultPromptsCardHtml()}
      ${this.imageGenDefaultsCardHtml()}
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
    const savePromptsBtn = document.getElementById("pv_default_prompts_save");
    if (savePromptsBtn) savePromptsBtn.onclick = () => this.saveDefaultPrompts();
    this.wirePromptTabs();
    this.wireImageGenDefaultsCard();
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
              <span class="font-mono text-[9px] opacity-70">${this.data[k.key].names.filter((n) => this.data[k.key].previews[n]?.image).length}/${this.data[k.key].names.length}</span>
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
          ${customSelectHtml("pv_model_type", ADMIN_MODEL_TYPE_OPTIONS, meta.model_type || "")}
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_steps")}</label>
          <input type="number" id="pv_default_steps" value="${_attr(meta.default_steps ?? "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_sampler")}</label>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border:1px solid var(--color-line);background:var(--color-surface)">
            <span id="pv_default_sampler_label" style="flex:1;min-width:0;font-size:13.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(meta.default_sampler || t("admin_previews_default_option"))}</span>
            <button type="button" id="pv_default_sampler_btn" class="pe-gen-btn" style="padding:5px 12px;font-size:11.5px">${t("masks_link_character_change", "Change")}</button>
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_scheduler")}</label>
          <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;border:1px solid var(--color-line);background:var(--color-surface)">
            <span id="pv_default_scheduler_label" style="flex:1;min-width:0;font-size:13.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(meta.default_scheduler || t("admin_previews_default_option"))}</span>
            <button type="button" id="pv_default_scheduler_btn" class="pe-gen-btn" style="padding:5px 12px;font-size:11.5px">${t("masks_link_character_change", "Change")}</button>
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_cfg")}</label>
          <input type="number" step="0.1" id="pv_default_cfg" value="${_attr(meta.default_cfg ?? "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_positive")}</label>
          <p class="text-[11px] text-muted mb-1.5">${t("admin_previews_default_positive_hint", "Added on top of the global preview prompt. Model-specific tags only, like a trigger word.")}</p>
          <textarea id="pv_default_positive" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:52px">${_esc(meta.default_positive || "")}</textarea>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_negative")}</label>
          <p class="text-[11px] text-muted mb-1.5">${t("admin_previews_default_negative_hint", "Added on top of the global negative prompt.")}</p>
          <textarea id="pv_default_negative" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:52px">${_esc(meta.default_negative || "")}</textarea>
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
          <div id="pv_keywords" class="flex flex-wrap items-center gap-1.5 w-full px-2.5 py-2 rounded-md border border-line bg-surface">
            <span id="pv_keyword_pills" class="contents"></span>
            <input type="text" id="pv_keyword_input" placeholder="${_attr(t("admin_previews_keywords_add_placeholder", "Type a keyword, press Enter"))}" class="flex-1 min-w-[140px] bg-transparent text-ink text-sm outline-none">
          </div>
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

  supportsNsfwPreview(kind) {
    return kind.key === "checkpoint" || kind.key === "lora";
  }

  previewEndpoint(kind, name) {
    const base = `${kind.adminBase}/${encodeURIComponent(name)}`;
    return this._pvVariant === "nsfw" ? `${base}/nsfw` : base;
  }

  variantSwitchHtml(kind) {
    if (!this.supportsNsfwPreview(kind)) return "";
    const tab = (variant, label) => {
      const on = this._pvVariant === variant;
      return `<button type="button" data-pv-variant="${variant}" class="px-3 py-1 rounded-md font-mono text-[10px] uppercase tracking-[.08em]" style="border:1px solid ${on ? "var(--color-accent)" : "var(--color-line)"};color:${on ? "var(--color-accent)" : "var(--color-muted)"};background:${on ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent"}">${label}</button>`;
    };
    return `
      <div class="flex items-center gap-1.5 mb-2">
        ${tab("sfw", t("admin_previews_variant_sfw", "Safe"))}
        ${tab("nsfw", t("admin_previews_variant_nsfw", "NSFW"))}
      </div>
    `;
  }

  previewBoxHtml(kind, meta) {
    const image = this._pvVariant === "nsfw" ? meta.image_nsfw : meta.image;
    const isVideoPreview = kind.key === "vidgen" && _pvIsVideoUrl(image);
    const aspectClass = kind.key === "vidgen" ? "aspect-video" : "aspect-square";
    if (!image) {
      return `
        <div class="relative w-full ${aspectClass} rounded-lg overflow-hidden bg-surface-2 mb-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-muted border border-dashed border-line" id="pv_preview_box">
          <span style="width:22px;height:22px">${_PV_ICON_REGEN}</span>
          <span class="font-mono text-[11px] uppercase tracking-[.05em]">${t("admin_previews_tap_to_generate", "Tap to generate")}</span>
        </div>
      `;
    }
    const mediaHtml = isVideoPreview
      ? `<video src="${_attr(image)}" autoplay loop muted playsinline class="w-full h-full object-cover" id="pv_preview_media"></video>`
      : `<img src="${_attr(image)}" alt="" class="w-full h-full object-cover" id="pv_preview_media">`;
    return `
      <div class="relative w-full ${aspectClass} rounded-lg overflow-hidden bg-surface-2 mb-3 border border-line" id="pv_preview_box">
        ${mediaHtml}
        ${!isVideoPreview ? `<span class="absolute left-2 bottom-2 font-mono text-[9px] uppercase tracking-[.04em] text-muted px-1.5 py-1 rounded-md" style="background:color-mix(in srgb, var(--color-paper) 55%, transparent)">${t("admin_previews_tap_to_zoom", "tap to zoom")}</span>` : ""}
        <div class="absolute top-2 right-2 flex gap-1.5" id="pv_preview_actions">
          <button type="button" id="pv_regenerate" title="${_attr(t("admin_previews_regenerate", "Regenerate"))}" class="w-7 h-7 rounded-full flex items-center justify-center border border-line text-ink" style="background:color-mix(in srgb, var(--color-paper) 70%, transparent);backdrop-filter:blur(3px)"><span style="width:14px;height:14px">${_PV_ICON_REGEN}</span></button>
          <button type="button" id="pv_clear_image" title="${_attr(t("admin_previews_delete_preview", "Delete preview"))}" class="w-7 h-7 rounded-full flex items-center justify-center border" style="border-color:color-mix(in srgb, var(--color-warn) 50%, var(--color-line));color:var(--color-warn);background:color-mix(in srgb, var(--color-paper) 70%, transparent);backdrop-filter:blur(3px)"><span style="width:14px;height:14px">${_PV_ICON_DELETE}</span></button>
        </div>
      </div>
    `;
  }

  async refreshPreviewInPlace(kind, name) {
    await this.load();
    const meta = this.data[kind.key].previews[name] || {};
    const wrap = document.getElementById("pv_preview_wrap");
    if (!wrap) return;
    wrap.innerHTML = this.variantSwitchHtml(kind) + this.previewBoxHtml(kind, meta);
    this.wirePreviewBox(kind, name, meta);
  }

  wirePreviewBox(kind, name, meta) {
    const image = this._pvVariant === "nsfw" ? meta.image_nsfw : meta.image;
    const isVideoPreview = kind.key === "vidgen" && _pvIsVideoUrl(image);
    const previewMedia = document.getElementById("pv_preview_media");
    if (previewMedia && !isVideoPreview && typeof _wireZoomPan === "function") {
      _wireZoomPan(previewMedia);
    }

    document.querySelectorAll("[data-pv-variant]").forEach((btn) => {
      btn.onclick = () => {
        this._pvVariant = btn.dataset.pvVariant;
        document.getElementById("pv_preview_wrap").innerHTML = this.variantSwitchHtml(kind) + this.previewBoxHtml(kind, meta);
        this.wirePreviewBox(kind, name, meta);
      };
    });

    const previewBox = document.getElementById("pv_preview_box");
    if (!image && previewBox) previewBox.onclick = () => this.openGeneratePreview(kind, name, meta);

    const clearBtn = document.getElementById("pv_clear_image");
    if (clearBtn) clearBtn.onclick = async () => {
      if (!(await confirmDialog(t("admin_previews_confirm_clear_preview")))) return;
      try {
        await api(this.previewEndpoint(kind, name), { method: "DELETE" });
        toast(t("admin_previews_preview_image_cleared"));
        await this.refreshPreviewInPlace(kind, name);
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_clear_preview"));
      }
    };

    const regenBtn = document.getElementById("pv_regenerate");
    if (regenBtn) regenBtn.onclick = (e) => { e.stopPropagation(); this.openGeneratePreview(kind, name, meta); };
  }

  async openEdit(kindKey, name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === kindKey);
    const meta = this.data[kindKey].previews[name] || {};
    this._pvVariant = "sfw";
    openModal(`
      <div class="flex items-start justify-between gap-3 mb-1" style="padding-right:44px">
        <div class="min-w-0 flex-1">
          <h3 class="mb-0 truncate" title="${_attr(meta.display_name || name)}">${_esc(meta.display_name || name)}</h3>
          <p class="font-mono text-xs text-muted mt-0.5 truncate" title="${_attr(name)}">${_esc(name)}</p>
        </div>
        <div class="flex gap-1.5 flex-none">
          <button type="button" id="pv_save" title="${_attr(t("admin_previews_save"))}" class="w-8 h-8 rounded-md flex items-center justify-center text-paper bg-gradient-to-br from-primary to-primary-dark"><span style="width:15px;height:15px">${_PV_ICON_SAVE}</span></button>
          ${kind.deleteKind ? `<button type="button" id="pv_delete_file" title="${_attr(t("admin_previews_delete_file"))}" class="w-8 h-8 rounded-md flex items-center justify-center border" style="border-color:var(--color-warn);color:var(--color-warn)"><span style="width:15px;height:15px">${_PV_ICON_DELETE}</span></button>` : ""}
        </div>
      </div>
      <div class="mt-3" id="pv_preview_wrap">${this.variantSwitchHtml(kind)}${this.previewBoxHtml(kind, meta)}</div>
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

    if (kind.extraFields === "checkpoint") {
      this._pvDefaultSampler = meta.default_sampler || "";
      this._pvDefaultScheduler = meta.default_scheduler || "";
      this._pvModelType = meta.model_type || "";
      wireCustomSelect("pv_model_type", (value) => { this._pvModelType = value; });
      const samplerData = await api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] }));
      const samplerBtn = document.getElementById("pv_default_sampler_btn");
      const schedulerBtn = document.getElementById("pv_default_scheduler_btn");
      if (samplerBtn) {
        samplerBtn.onclick = () => openPickerSheet({
          title: t("admin_previews_default_sampler"),
          items: [{ name: "", label: t("admin_previews_default_option") },
            ...(samplerData.samplers || []).map((m) => this.optionPickerItem("sampler", m))],
          selected: this._pvDefaultSampler,
          onPick: (name) => {
            this._pvDefaultSampler = name;
            document.getElementById("pv_default_sampler_label").textContent = name || t("admin_previews_default_option");
          },
        });
      }
      if (schedulerBtn) {
        schedulerBtn.onclick = () => openPickerSheet({
          title: t("admin_previews_default_scheduler"),
          items: [{ name: "", label: t("admin_previews_default_option") },
            ...(samplerData.schedulers || []).map((m) => this.optionPickerItem("scheduler", m))],
          selected: this._pvDefaultScheduler,
          onPick: (name) => {
            this._pvDefaultScheduler = name;
            document.getElementById("pv_default_scheduler_label").textContent = name || t("admin_previews_default_option");
          },
        });
      }
    }

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

    if (kind.extraFields === "lora") this.wireKeywordPills(meta.keywords || []);

    document.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.onclick = () => {
        btn.classList.toggle("on");
        const isOn = btn.classList.contains("on");
        btn.style.background = isOn ? "var(--color-accent)" : "var(--color-surface)";
        btn.style.color = isOn ? "var(--color-paper)" : "var(--color-ink)";
      };
    });

    this.wirePreviewBox(kind, name, meta);

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
        body.model_type = this._pvModelType || null;
        const steps = document.getElementById("pv_default_steps").value.trim();
        body.default_steps = steps ? parseInt(steps, 10) : null;
        const clipSel = document.getElementById("pv_anima_clip");
        const vaeSel = document.getElementById("pv_anima_vae");
        body.anima_clip_name = clipSel ? (clipSel.value || null) : null;
        body.anima_vae_name = vaeSel ? (vaeSel.value || null) : null;
        body.default_sampler = this._pvDefaultSampler || null;
        body.default_scheduler = this._pvDefaultScheduler || null;
        const cfg = document.getElementById("pv_default_cfg").value.trim();
        body.default_cfg = cfg ? parseFloat(cfg) : null;
        body.default_positive = this._modelExtraPrompt("pv_default_positive", this.defaultPositive);
        body.default_negative = this._modelExtraPrompt("pv_default_negative", this.defaultNegative);
      }
      if (kind.extraFields === "lora") {
        body.model_category = [...document.querySelectorAll("[data-cat]")]
          .filter((b) => b.classList.contains("on"))
          .map((b) => b.dataset.cat);
        body.keywords = [...(this._pvKeywords || [])];
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
    const key = architecture === "anima" ? "anima" : "sdxl";
    const configured = this.imageGenDefaults[key].checkpoint;
    if (configured && names.includes(configured)) return configured;
    if (architecture === "anima") return names.find((n) => this.animaNames.has(n)) || "";
    return names.find((n) => !this.animaNames.has(n)) || "";
  }

  _defaultSampler(architecture) {
    const key = architecture === "anima" ? "anima" : "sdxl";
    const configured = this.imageGenDefaults[key].sampler;
    const s = this.data.sampler.names;
    if (configured && s.includes(configured)) return configured;
    return s.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (s.includes("euler") ? "euler" : (s[0] || "euler"));
  }

  _defaultScheduler(architecture) {
    const key = architecture === "anima" ? "anima" : "sdxl";
    const configured = this.imageGenDefaults[key].scheduler;
    const s = this.data.scheduler.names;
    if (configured && s.includes(configured)) return configured;
    return s.includes("karras") ? "karras" : (s.includes("normal") ? "normal" : (s[0] || "normal"));
  }

  _nsfwPositive(positive) {
    const base = this._dropPromptTerms(positive, ADMIN_PREVIEW_NSFW_POSITIVE_DROP);
    const parts = [ADMIN_PREVIEW_NSFW_PREFIX, base, ADMIN_PREVIEW_NSFW_POSITIVE].filter(Boolean);
    return parts.join(", ");
  }

  _dropPromptTerms(prompt, dropList) {
    return (prompt || "")
      .split(",")
      .filter((term) => {
        const cleaned = term.toLowerCase().replace(/[()\[\]]|:[\d.]+/g, "").trim();
        return cleaned && !dropList.includes(cleaned);
      })
      .map((term) => term.trim())
      .join(", ");
  }

  _nsfwNegative(negative) {
    return this._dropPromptTerms(negative, ADMIN_PREVIEW_NSFW_NEGATIVE_DROP);
  }

  _modelExtraPrompt(fieldId, globalPrompt) {
    const value = (document.getElementById(fieldId)?.value || "").trim();
    if (!value) return null;
    const global = (globalPrompt || "").trim();
    if (!global) return value;
    if (value === global) return null;
    const extra = value.startsWith(global) ? value.slice(global.length).replace(/^\s*,\s*/, "").trim() : value;
    return extra || null;
  }

  _liveFieldValue(id) {
    const el = document.getElementById(id);
    const value = el ? el.value.trim() : "";
    return value || null;
  }

  _genDefaults(kind, name, meta, architecture) {
    const anima = architecture === "anima";
    const baseCheckpoint = kind.key === "checkpoint" ? name : this._defaultCheckpointFor(architecture);
    const baseMeta = kind.key === "checkpoint" ? meta : (this.data.checkpoint.previews[baseCheckpoint] || {});
    const edited = kind.key === "checkpoint";
    const nsfw = this._pvVariant === "nsfw";
    const globalPositive = nsfw
      ? (this._liveFieldValue("pv_nsfw_positive") || this.nsfwPositive
        || this._nsfwPositive(this._liveFieldValue("pv_global_positive") || this.defaultPositive))
      : (this._liveFieldValue("pv_global_positive") || this.defaultPositive);
    const globalNegative = nsfw
      ? (this._liveFieldValue("pv_nsfw_negative") || this.nsfwNegative
        || this._nsfwNegative(this._liveFieldValue("pv_global_negative") || this.defaultNegative))
      : (this._liveFieldValue("pv_global_negative") || this.defaultNegative);
    const modelPositive = (edited ? this._liveFieldValue("pv_default_positive") : null) || baseMeta.default_positive;
    const modelNegative = (edited ? this._liveFieldValue("pv_default_negative") : null) || baseMeta.default_negative;
    const basePositive = [globalPositive, modelPositive].filter(Boolean).join(", ");
    const baseNegative = [globalNegative, modelNegative].filter(Boolean).join(", ");
    const editedSteps = edited ? Number(this._liveFieldValue("pv_default_steps")) : 0;
    const editedCfg = edited ? Number(this._liveFieldValue("pv_default_cfg")) : 0;
    return {
      checkpoint: baseCheckpoint,
      positive: basePositive,
      negative: baseNegative,
      steps: editedSteps || baseMeta.default_steps || this.imageGenDefaults[anima ? "anima" : "sdxl"].steps,
      cfg: editedCfg || baseMeta.default_cfg || this.imageGenDefaults[anima ? "anima" : "sdxl"].cfg,
      sampler: (edited ? this._pvDefaultSampler : "") || baseMeta.default_sampler
        || this._defaultSampler(architecture),
      scheduler: (edited ? this._pvDefaultScheduler : "") || baseMeta.default_scheduler
        || this._defaultScheduler(architecture),
    };
  }

  _setGenRunButton(runBtn, running) {
    runBtn.disabled = false;
    runBtn.dataset.running = running ? "1" : "";
    runBtn.innerHTML = running
      ? `<span style="width:15px;height:15px">${_PV_ICON_STOP}</span>${_esc(t("admin_previews_stop", "Stop"))}`
      : `<span style="width:15px;height:15px">${_PV_ICON_REGEN}</span>${_esc(t("admin_previews_generate"))}`;
  }

  async stopGeneration(controller) {
    try {
      await api("/api/imagegen/standalone/stream/stop", { method: "POST" });
    } catch (err) {
      errorToast(err.message || t("admin_previews_couldnt_stop", "Couldn't stop the generation"));
    } finally {
      controller.abort();
    }
  }

  _genWaitingHtml(message) {
    return this._genGeneratingBadgeHtml() + forgeCrucibleHtml(message || t("admin_previews_starting"));
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
        <textarea id="pvv_prompt" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(this.defaultPositive)}</textarea>
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_negative_prompt", "Negative prompt")}</label>
        <textarea id="pvv_negative" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:44px">${_esc(this.defaultNegative)}</textarea>
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
      if (controller) { await this.stopGeneration(controller); controller = null; return; }
      controller = new AbortController();
      this._setGenRunButton(runBtn, true);
      useBtn.classList.add("hidden");
      videoUrl = null;
      previewBox.innerHTML = this._genWaitingHtml();
      const body = {
        positive: layer.querySelector("#pvv_prompt").value.trim(),
        negative: layer.querySelector("#pvv_negative").value.trim(),
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
            previewBox.innerHTML = this._genWaitingHtml(ev.message);
          } else if (ev.type === "preview") {
            let img = previewBox.querySelector("#pvv_live_preview");
            if (!img) previewBox.innerHTML = this._genGeneratingBadgeHtml() + `<img id="pvv_live_preview" src="${_attr(ev.image)}" style="width:100%;height:100%;object-fit:cover">`;
            else img.src = ev.image;
          } else if (ev.type === "done") {
            videoUrl = ev.video.image;
            previewBox.innerHTML = `<video src="${_attr(videoUrl)}" style="width:100%;height:100%;object-fit:cover" controls autoplay muted loop playsinline></video>`;
            useBtn.classList.remove("hidden");
          } else if (ev.type === "cancelled") {
            previewBox.innerHTML = `<span class="text-xs text-muted">${t("admin_previews_preview_will_appear_here")}</span>`;
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
    const defaults = this._genDefaults(kind, name, meta, architecture);
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_generate_description_prefix")} ${_esc(kind.key)}${t("admin_previews_generate_description_suffix")}</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_prompt")}</label>
        <textarea id="pvg_prompt" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(defaults.positive)}</textarea>
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_negative_prompt", "Negative prompt")}</label>
        <textarea id="pvg_negative" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:44px">${_esc(defaults.negative)}</textarea>
      </div>
      <div class="pv-gen-slug">${[defaults.sampler, defaults.scheduler, `${defaults.steps} ${t("admin_previews_steps_word", "steps")}`, `cfg ${defaults.cfg}`].map((part) => `<span>${_esc(String(part))}</span>`).join("")}</div>
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
      if (controller) { await this.stopGeneration(controller); controller = null; return; }
      controller = new AbortController();
      this._setGenRunButton(runBtn, true);
      useBtn.classList.add("hidden");
      resultDataUrl = null;
      previewBox.innerHTML = this._genWaitingHtml();
      const body = {
        positive: layer.querySelector("#pvg_prompt").value.trim(),
        negative: layer.querySelector("#pvg_negative").value.trim(),
        checkpoint: defaults.checkpoint,
        loras: kind.key === "lora" ? [{ name, strength: 0.8 }] : [],
        width: ADMIN_PREVIEW_GEN_SIZE, height: ADMIN_PREVIEW_GEN_SIZE,
        sampler: kind.key === "sampler" ? name : defaults.sampler,
        scheduler: kind.key === "scheduler" ? name : defaults.scheduler,
        steps: defaults.steps,
        cfg: defaults.cfg,
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
          if (ev.type === "status" || ev.type === "queue") {
            if (!previewBox.querySelector("img")) previewBox.innerHTML = this._genWaitingHtml(ev.message);
          } else if (ev.type === "preview") {
            previewBox.innerHTML = this._genGeneratingBadgeHtml() + `<img src="${_attr(ev.image)}" alt="" class="w-full h-full object-cover">`;
          } else if (ev.type === "done") {
            resultDataUrl = ev.image;
            previewBox.innerHTML = `<img src="${_attr(ev.image)}" alt="" class="w-full h-full object-cover">`;
            useBtn.classList.remove("hidden");
          } else if (ev.type === "cancelled") {
            previewBox.innerHTML = `<span class="text-xs text-muted">${t("admin_previews_preview_will_appear_here")}</span>`;
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
        await api(this.previewEndpoint(kind, name), { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeModal(layer);
        await this.refreshPreviewInPlace(kind, name);
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
        await api(this.previewEndpoint(kind, name), { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeModal(layer);
        await this.refreshPreviewInPlace(kind, name);
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
