"use strict";

const ANIMA_DEFAULT_SAMPLER = "er_sde";
const ANIMA_DEFAULT_SCHEDULER = "simple";
const ANIMA_DEFAULT_CFG = 4.0;

const FORGE_ASPECTS = {
  "1:1": [1024, 1024],
  "2:3": [832, 1216],
  "3:4": [896, 1152],
  "16:9": [1216, 704],
  "9:16": [704, 1216],
};

function forgeCrucibleHtml(message) {
  return `
    <div class="forge-crucible-wait">
      <div class="forge-crucible">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 26h24l-3 22a6 6 0 0 1-6 5h-6a6 6 0 0 1-6-5z"/>
          <path d="M16 26h32"/>
          <path d="M26 26v-7a6 6 0 0 1 12 0v7"/>
        </svg>
        <span class="forge-bubble" style="--bx:-8px;--bd:0s"></span>
        <span class="forge-bubble" style="--bx:2px;--bd:.7s"></span>
        <span class="forge-bubble" style="--bx:10px;--bd:1.3s"></span>
      </div>
      <div id="forgeQueueMsg" class="forge-crucible-msg">${_esc(message)}</div>
    </div>
  `;
}

function aspectChipHtml(ratioLabel, active, onclickExpr) {
  const [w, h] = ratioLabel.split(":").map(Number);
  const maxDim = 14;
  const scale = maxDim / Math.max(w, h);
  const boxW = Math.max(3, Math.round(w * scale));
  const boxH = Math.max(3, Math.round(h * scale));
  return `
    <button type="button" class="filter-chip${active ? " on" : ""}" onclick="${onclickExpr}" style="display:inline-flex;align-items:center;gap:6px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:${maxDim}px;height:${maxDim}px;flex:none">
        <span style="display:block;width:${boxW}px;height:${boxH}px;border:1.5px solid currentColor;border-radius:2px"></span>
      </span>
      ${ratioLabel}
    </button>
  `;
}

const SAMPLER_DESCS = {
  euler: "The simplest, fastest solver - a solid deterministic baseline that converges cleanly.",
  euler_ancestral: "Euler with added noise each step - more varied, creative results but non-deterministic and can look busier.",
  heun: "A second-order solver that refines each Euler step with a correction - more accurate than Euler, but roughly twice as slow.",
  heunpp2: "An improved higher-order Heun variant - slightly more accurate than plain Heun at a similar speed cost.",
  dpm_2: "A second-order DPM solver - higher accuracy than Euler at the cost of an extra model call per step.",
  dpm_2_ancestral: "DPM 2nd-order with added noise - more varied output, non-deterministic, at a similar speed cost to dpm_2.",
  lms: "Linear multi-step solver - reuses previous steps for efficiency, good quality but can be unstable at very low step counts.",
  dpm_fast: "A fixed-step DPM variant tuned for speed at low step counts - quick but lower quality than modern DPM++ solvers.",
  dpm_adaptive: "Adaptively chooses its own step sizes for accuracy - high quality but ignores the step count and can be slow.",
  dpmpp_2s_ancestral: "DPM++ single-step 2nd-order with added noise - high quality and varied, but slower and non-deterministic.",
  dpmpp_sde: "DPM++ using a stochastic formulation - excellent detail and quality, non-deterministic, slower than the ODE variants.",
  dpmpp_2m: "DPM++ 2M, a high-quality second-order multi-step solver - a fast, reliable default for most generations.",
  dpmpp_2m_sde: "DPM++ 2M in its stochastic form - often richer detail than plain 2M, at the cost of determinism.",
  dpmpp_3m_sde: "DPM++ third-order multi-step solver - can capture fine detail but usually needs more steps to be stable.",
  ddim: "An older deterministic solver - fast and stable, but generally lower quality than modern DPM++ solvers.",
  uni_pc: "UniPC, a unified predictor-corrector solver - high quality and fast convergence, good at low step counts.",
  uni_pc_bh2: "UniPC using the BH2 corrector variant - similar to uni_pc, often slightly higher quality.",
  lcm: "For Latent Consistency Models - produces images in very few steps (around 4-8) with a compatible LCM checkpoint or LoRA.",
};
const SCHEDULER_DESCS = {
  simple: "A plain, evenly-spaced noise schedule - a straightforward default that works well in most cases.",
  normal: "The standard model-derived schedule - a safe general-purpose choice.",
  karras: "Spaces steps to spend more time at low noise levels - often produces sharper details, especially at higher step counts.",
  exponential: "Distributes noise levels on an exponential curve - a smooth schedule that can help fine detail.",
  sgm_uniform: "The uniform schedule used by SGM-style models - recommended for SDXL and models trained with that formulation.",
  ddim_uniform: "The uniform timestep spacing used by the original DDIM sampler - pair it with DDIM for expected results.",
  beta: "Derives step spacing from the model's noise schedule - a good match for models using that training formulation.",
  linear_quadratic: "Blends linear early steps with quadratic spacing later - designed to improve results at low step counts.",
  kl_optimal: "A schedule optimized for efficient, high-quality sampling.",
};
function forgeSamplerDesc(name) {
  if (SAMPLER_DESCS[name]) return SAMPLER_DESCS[name];
  let base = name, suffix = "";
  if (name.endsWith("_cfg_pp")) { base = name.slice(0, -7); suffix = " (cfg++ variant of the same algorithm)"; }
  else if (name.endsWith("_gpu")) { base = name.slice(0, -4); suffix = " (GPU-noise variant of the same algorithm)"; }
  if (suffix && SAMPLER_DESCS[base]) return SAMPLER_DESCS[base] + suffix;
  return "";
}
function forgeSchedulerDesc(name) { return SCHEDULER_DESCS[name] || ""; }

class WorkshopMediaView {
  constructor() {
    this.mode = "image";
    this.architecture = "sdxl";
    this.positive = "";
    this.negative = "";
    this.showNegative = false;
    this.aspect = "1:1";
    this.denoise = 0.6;
    this.inpaintDims = null;
    this._referenceImages = { image: null, inpaint: null, upscale: null };
    this.checkpoints = [];
    this.checkpointPreviews = {};
    this.checkpoint = "";
    this.loraOptions = [];
    this.loraPreviews = {};
    this.loras = [];
    this.lorasOpen = false;
    this.samplers = [];
    this.schedulers = [];
    this.samplerPreviews = {};
    this.schedulerPreviews = {};
    this.sampler = "";
    this.scheduler = "";
    this.steps = 20;
    this.cfg = 7.0;
    this.advancedOpen = true;
    this.busy = false;
    this.previewImage = "";
    this.lastResult = null;
    this.recent = [];
    this.upscalers = [];
    this.upscalerPreviews = {};
    this.upscalePickerOpen = false;
    this.upscaling = false;
    this.eraseMode = false;
    this.brushSize = 40;
    this.maskUndo = [];
    this.duration = "3s";
    this.fps = 24;
    this.genStatus = "";
    this.compile = new WorkshopMediaCompilePanel(this);
  }

  get referenceImage() {
    return this._referenceImages[this.mode] ?? null;
  }

  set referenceImage(val) {
    this._referenceImages[this.mode] = val;
  }

  async mount(main) {
    this.main = main;
    this.restoreDraft();
    this.render();
    this.loadModels();
    this.autosave = new LocalAutosave("forgeDraft", () => {
      if (!document.body.contains(this.main)) { this.autosave.stop(); return this.draftFields(); }
      return this.draftFields();
    });
    this.autosave.start();
    await this.consumePendingReference();
  }

  async consumePendingReference() {
    const pending = store.get("forgePendingReference", null);
    if (!pending) return;
    store.set("forgePendingReference", null);
    this.mode = pending.mode === "inpaint" ? "inpaint" : "image";
    await this.setReferenceFromUrl(pending.url);
    toast(this.mode === "inpaint" ? t("forge_ready_to_inpaint_toast") : t("forge_set_as_reference_toast"));
  }

  startQueueTicker(genToken) {
    this.stopQueueTicker();
    this._queueTicker = setInterval(async () => {
      if (genToken !== this._genToken || !this.queueWait) { this.stopQueueTicker(); return; }
      let status;
      try {
        status = await api("/api/imagegen/queue");
      } catch {
        return;
      }
      const message = status.cooling
        ? t("forge_queue_cooling", "The forge is cooling down - your spot is held")
        : status.queued > 0
          ? t("forge_queue_waiting", "Waiting for the forge - ") + status.queued + t("forge_queue_in_line", " ahead of you")
          : t("forge_queue_next", "You're next - stoking the coals...");
      this.queueWait = { message };
      const el = this.main.querySelector("#forgeQueueMsg");
      if (el) el.textContent = message;
    }, 3000);
  }

  stopQueueTicker() {
    if (this._queueTicker) { clearInterval(this._queueTicker); this._queueTicker = null; }
    this.queueWait = null;
  }

  draftFields() {
    return {
      mode: this.mode, architecture: this.architecture, positive: this.positive,
      negative: this.negative, showNegative: this.showNegative, aspect: this.aspect,
      denoise: this.denoise, checkpoint: this.checkpoint, loras: this.loras,
      sampler: this.sampler, scheduler: this.scheduler, steps: this.steps, cfg: this.cfg,
      advancedOpen: this.advancedOpen, duration: this.duration, fps: this.fps,
    };
  }

  restoreDraft() {
    const draft = LocalAutosave.restore("forgeDraft");
    if (!draft) return;
    Object.assign(this, draft);
    if (this.mode === "video" && ME?.role !== "dev") this.mode = "image";
  }

  segChip(label, active, onclickExpr, soon, disabled) {
    const badge = soon ? ` <span style="font-size:9px;opacity:.75;text-transform:uppercase;letter-spacing:.03em">(${t("forge_soon_badge")})</span>` : "";
    if (disabled) {
      return `<button type="button" class="filter-chip" disabled title="${_attr(disabled)}" style="opacity:.4;cursor:not-allowed">${label}</button>`;
    }
    return `<button type="button" class="filter-chip${active ? " on" : ""}" onclick="${onclickExpr}">${label}${badge}</button>`;
  }

  modeArchRowHtml(trailing = "") {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;flex-wrap:wrap">
            ${this.segChip(t("forge_image_gen_tab"), this.mode === "image", "_activeForgeView.setMode('image')")}
            ${this.segChip(t("forge_inpaint_tab"), this.mode === "inpaint", "_activeForgeView.setMode('inpaint')")}
            ${this.segChip(t("forge_video_tab"), this.mode === "video", "_activeForgeView.setMode('video')", false, ME?.role === "dev" ? null : t("forge_video_dev_only_notice"))}
            ${this.segChip(t("forge_upscale_tab"), this.mode === "upscale", "_activeForgeView.setMode('upscale')")}
            ${this.segChip(t("forge_compile_tab"), this.mode === "compile", "_activeForgeView.setMode('compile')")}
          </div>
          ${this.mode === "upscale" || this.mode === "video" || this.mode === "compile" ? "" : `
          <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px">
            ${this.segChip(t("forge_architecture_legacy_option"), this.architecture === "sdxl", "_activeForgeView.setArchitecture('sdxl')")}
            ${this.segChip(t("forge_architecture_current_option"), this.architecture === "anima", "_activeForgeView.setArchitecture('anima')")}
          </div>`}
        </div>
        ${trailing}
      </div>
    `;
  }

  aspectRowHtml() {
    if (this.mode === "upscale" || this.mode === "inpaint") return "";
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">${t("forge_aspect_ratio_label")}</label>
        <p style="margin:0 0 8px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${this.mode === "video" ? t("forge_aspect_ratio_hint_video") : t("forge_aspect_ratio_hint_image")}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${Object.keys(FORGE_ASPECTS).map((a) => aspectChipHtml(a, this.aspect === a, `_activeForgeView.setAspect('${a}')`)).join("")}
        </div>
      </div>
    `;
  }

  promptBlockHtml() {
    if (this.mode === "upscale") return "";
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">${t("forge_prompt_label")}</label>
        <p style="margin:0 0 8px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${t("forge_prompt_hint")}</p>
        <textarea id="forgePositive" class="grimoire-field-textarea" rows="3" placeholder="${t("forge_prompt_placeholder")}">${_esc(this.positive)}</textarea>
        <button type="button" onclick="_activeForgeView.toggleNegative()" style="display:flex;align-items:center;gap:6px;margin-top:9px;background:none;border:none;color:var(--color-muted);font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer">
          <span style="display:inline-block;transform:rotate(${this.showNegative ? "90deg" : "0deg"});transition:transform .2s">&rsaquo;</span> ${t("forge_negative_prompt_label")}
        </button>
        ${this.showNegative ? `<textarea id="forgeNegative" class="grimoire-field-textarea" rows="2" placeholder="${t("forge_negative_prompt_placeholder")}" style="margin-top:9px">${_esc(this.negative)}</textarea>` : ""}
      </div>
    `;
  }

  referenceImageSectionHtml() {
    if (this.mode !== "image") return "";
    return `
      <div style="margin-bottom:16px">
        <div class="grimoire-field-label" style="margin-bottom:6px">${t("forge_reference_image_label")} <span style="text-transform:none;color:var(--color-muted)">&middot; ${t("forge_optional_word")}</span></div>
        <p style="margin:0 0 12px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${t("forge_reference_image_hint")}</p>
        ${this.referenceImage ? `
          <div style="display:flex;gap:14px;align-items:center;background:var(--color-surface-2);border:1px solid var(--color-line);border-radius:12px;padding:12px">
            <div id="forgeRefThumb" style="position:relative;width:96px;height:96px;border-radius:10px;overflow:hidden;flex:none;border:1px solid var(--color-line-2)">
              <img id="forgeRefThumbImg" src="${this.referenceImage}" style="width:100%;height:100%;object-fit:cover;display:block" alt="">
              <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px;z-index:3">
                <button type="button" onclick="_activeForgeView.openUpscale()" data-tooltip="${t("forge_upscale_tab")}" aria-label="${t("forge_upscale_tab")}" style="width:22px;height:22px;border-radius:6px;background:rgba(0,0,0,.55);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
                </button>
                <button type="button" onclick="_activeForgeView.chooseReferenceSource()" data-tooltip="${t("forge_replace_word")}" aria-label="${t("forge_replace_word")}" style="width:22px;height:22px;border-radius:6px;background:rgba(0,0,0,.55);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
                </button>
              </div>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--color-muted);white-space:nowrap">${t("forge_influence_word")} ${this.denoise.toFixed(2)}</span>
                <input type="range" id="forgeDenoise" min="0.05" max="1" step="0.05" value="${this.denoise}" style="flex:1">
              </div>
            </div>
            <button type="button" onclick="_activeForgeView.clearReference()" style="background:none;border:1px solid var(--color-line-2);border-radius:8px;color:var(--color-muted);font-size:11px;padding:5px 9px;cursor:pointer;flex:none">${t("forge_remove_button")}</button>
          </div>
        ` : `
          <button type="button" onclick="_activeForgeView.chooseReferenceSource()" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:7px;padding:22px;background:var(--color-surface);border:1.5px dashed var(--color-line-2);border-radius:12px;color:var(--color-sec);cursor:pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>${t("forge_add_reference_image_label")}</span>
            <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--color-muted)">${t("forge_drop_or_browse_hint")}</span>
          </button>
        `}
      </div>
    `;
  }

  previewBoxHtml() {
    if (this.mode === "upscale") return this.upscalePreviewHtml();
    const [w, h] = this.mode === "inpaint" && this.inpaintDims ? this.inpaintDims : FORGE_ASPECTS[this.aspect];
    const ratio = `${w} / ${h}`;
    let inner;
    if (this.busy && this.mode === "video" && this.previewImage) {
      inner = `
        <img id="forgeVideoPreviewImg" src="${this.previewImage}" style="width:100%;height:100%;object-fit:cover" alt="">
        <span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">${t("forge_generating_badge")}</span>
        <div id="forgeVideoStatus" style="position:absolute;bottom:10px;left:10px;font-family:var(--font-mono);font-size:10.5px;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">${_esc(this.genStatus || "")}</div>
      `;
    } else if (this.busy && this.mode === "video") {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="font-size:13.5px;color:var(--color-sec)">${t("forge_generating_video_label")}</div>
          <div id="forgeVideoStatus" style="font-family:var(--font-mono);font-size:11.5px;margin-top:8px;color:var(--color-accent)">${_esc(this.genStatus || "")}</div>
        </div>
      `;
    } else if (this.busy && this.previewImage) {
      inner = `
        <img src="${this.previewImage}" style="width:100%;height:100%;object-fit:cover" alt="">
        <span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">${t("forge_generating_badge")}</span>
      `;
    } else if (this.busy) {
      inner = forgeCrucibleHtml(this.queueWait?.message
        || t("forge_crucible_working", "The forge is lit - conjuring your image..."));
    } else if (this.lastResult) {
      const resultTag = this.lastResult.mediaType === "video"
        ? `<video src="${_attr(this.lastResult.image)}" style="width:100%;height:100%;object-fit:cover" controls muted playsinline></video>`
        : `<img id="forgeResultImg" src="${this.lastResult.image}" style="width:100%;height:100%;object-fit:cover" alt="">`;
      const saveBtn = this.lastResult.mediaType === "video" ? "" : `<button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.save()" title="${t("forge_save_word")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg></button>`;
      const upscaleBtn = this.lastResult.mediaType === "video" ? "" : `<button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.openUpscale()" title="${t("forge_upscale_tab")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></button>`;
      const regenBtn = this.lastResult.mediaType === "video" ? "" : `<button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.regenerate()" title="${t("forge_regenerate_word")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button>`;
      inner = `
        ${resultTag}
        <div style="position:absolute;right:10px;top:10px;display:flex;gap:8px">
          ${saveBtn}
          ${upscaleBtn}
          ${regenBtn}
          ${this.lastResult.savedId ? `<button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.toggleSavedShare()" title="${this.lastResult.isPublic ? t("forge_unshare_word") : t("forge_share_word")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9"/></svg></button>` : ""}
        </div>
      `;
    } else if (this.mode === "inpaint" && !this.referenceImage) {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>
          <button type="button" class="pe-gen-btn" onclick="_activeForgeView.chooseReferenceSource()">${t("forge_add_reference_image_label")}</button>
        </div>
        <input type="file" id="forgeRefFile" accept="image/png,image/jpeg,image/webp" hidden>
      `;
    } else if (this.mode === "inpaint" && this.referenceImage) {
      inner = `
        <img src="${this.referenceImage}" style="width:100%;height:100%;object-fit:cover" alt="">
        <canvas id="forgeMaskCanvas" width="${w}" height="${h}" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair"></canvas>
        <span class="grimoire-img-clear" role="button" aria-label="${t("forge_clear_image_label")}" tabindex="0" style="cursor:pointer;top:10px;right:10px;width:24px;height:24px;font-size:14px;line-height:24px" onclick="_activeForgeView.clearReference()">&times;</span>
        <button type="button" onclick="_activeForgeView.chooseReferenceSource()" title="${t("forge_replace_word")}" style="position:absolute;right:10px;top:44px;width:24px;height:24px;border-radius:999px;border:none;background:rgba(0,0,0,.6);color:#fff;display:grid;place-items:center;cursor:pointer"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button>
        <input type="file" id="forgeRefFile" accept="image/png,image/jpeg,image/webp" hidden>
      `;
    } else if (this.mode === "video") {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </div>
          <div style="font-size:13.5px;color:var(--color-sec)">${t("forge_video_will_appear_here")}</div>
          <div style="font-size:11.5px;margin-top:4px">${t("forge_describe_motion_scene_below")}</div>
        </div>
      `;
    } else {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>
          </div>
          <div style="font-size:13.5px;color:var(--color-sec)">${t("forge_image_will_appear_here")}</div>
          <div style="font-size:11.5px;margin-top:4px">${t("forge_describe_then_tap_generate")}</div>
        </div>
        <input type="file" id="forgeRefFile" accept="image/png,image/jpeg,image/webp" hidden>
      `;
    }
    return `
      <div id="forgePreviewBox" style="position:relative;width:100%;aspect-ratio:${ratio};border-radius:16px;overflow:hidden;border:1px solid var(--color-line);background:var(--color-surface);margin-bottom:14px;display:grid;place-items:center">
        ${inner}
      </div>
    `;
  }

  upscaleFrameHtml(label, imgSrc, emptyText) {
    return `
      <div style="position:relative;flex:1;aspect-ratio:1;border-radius:14px;overflow:hidden;border:1px solid var(--color-line);background:var(--color-surface);display:grid;place-items:center">
        ${imgSrc
          ? `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover" alt="">`
          : `<span style="font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-muted);text-align:center;padding:0 12px">${_esc(emptyText)}</span>`}
        <span style="position:absolute;top:8px;left:8px;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.55);padding:3px 8px;border-radius:7px;backdrop-filter:blur(3px)">${label}</span>
      </div>
    `;
  }

  upscalePreviewHtml() {
    const before = this.referenceImage;
    const after = this.lastResult?.image;
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;gap:10px;margin-bottom:10px">
          ${this.upscaleFrameHtml(t("forge_before_label"), before, t("forge_no_image_yet"))}
          ${this.upscaleFrameHtml(t("forge_after_label"), after, this.busy ? t("forge_sharpening_label") : t("forge_not_yet_upscaled"))}
        </div>
        ${before ? `
          <div style="display:flex;gap:8px">
            <button type="button" class="pe-gen-btn" style="flex:1" onclick="_activeForgeView.chooseReferenceSource()">${t("forge_replace_image_button")}</button>
            <button type="button" onclick="_activeForgeView.clearReference()" style="padding:9px 16px;border-radius:999px;border:1px solid var(--color-line-2);background:none;color:var(--color-muted);cursor:pointer;font-family:var(--font-mono);font-size:12px">${t("forge_clear_button")}</button>
            ${after ? `<button type="button" class="pe-gen-btn" onclick="_activeForgeView.save()">${t("forge_save_word")}</button>` : ""}
            ${after ? `<button type="button" onclick="_activeForgeView.useUpscaledAsReference()" style="padding:9px 16px;border-radius:999px;border:1px solid var(--color-line-2);background:none;color:var(--color-sec);cursor:pointer;font-family:var(--font-mono);font-size:12px">${t("forge_use_as_reference_button")}</button>` : ""}
          </div>
        ` : `
          <button type="button" class="pe-gen-btn" style="width:100%" onclick="_activeForgeView.chooseReferenceSource()">${t("forge_add_image_to_upscale_button")}</button>
        `}
        <input type="file" id="forgeRefFile" accept="image/png,image/jpeg,image/webp" hidden>
      </div>
    `;
  }

  onReferenceFile(file) {
    const assign = (dataUrl) => { this.referenceImage = dataUrl; };
    if (this.mode === "upscale") {
      maybeCropUpload(file, "1/1", 1024, 1024, (dataUrl) => {
        assign(dataUrl);
        this.render();
      });
      return;
    }
    if (this.mode === "inpaint") {
      loadImageNative(file, 1024, (dataUrl, width, height) => {
        this.inpaintDims = [width, height];
        assign(dataUrl);
        this.render();
      });
      return;
    }
    const [w, h] = FORGE_ASPECTS[this.aspect] || [1024, 1024];
    maybeCropUpload(file, `${w}/${h}`, w, h, (dataUrl) => {
      assign(dataUrl);
      this.render();
    });
  }

  clearReference() {
    this.referenceImage = null;
    this.inpaintDims = null;
    this.render();
  }

  chooseReferenceSource() {
    const layer = openModal(`
      <h3>${t("forge_choose_reference_image_heading")}</h3>
      <div style="display:flex;flex-direction:column;gap:3px;margin-top:6px">
        <button type="button" class="grimoire-picker-row" id="forgeRefUpload">
          <span class="sanctum-specimen" style="width:44px;height:44px;border-radius:10px;background:var(--color-surface-2);display:grid;place-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>
          <span class="font-display" style="font-size:14px;color:var(--color-ink)">${t("forge_upload_from_device_label")}</span>
        </button>
        <button type="button" class="grimoire-picker-row" onclick="_activeForgeView.openGalleryPicker('mine')">
          <span class="sanctum-specimen" style="width:44px;height:44px;border-radius:10px;background:var(--color-surface-2);display:grid;place-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18l7-7"/><path d="M14.5 4.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></svg></span>
          <span class="font-display" style="font-size:14px;color:var(--color-ink)">${t("forge_from_my_creations_label")}</span>
        </button>
        <button type="button" class="grimoire-picker-row" onclick="_activeForgeView.openGalleryPicker('community')">
          <span class="sanctum-specimen" style="width:44px;height:44px;border-radius:10px;background:var(--color-surface-2);display:grid;place-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="13" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4 15.5l4.5-4.5c.6-.6 1.4-.6 2 0L17 17.5"/></svg></span>
          <span class="font-display" style="font-size:14px;color:var(--color-ink)">${t("forge_from_community_label")}</span>
        </button>
      </div>
    `);
    layer.querySelector("#forgeRefUpload").onclick = () => {
      closeModal(layer);
      this.main.querySelector("#forgeRefFile").click();
    };
  }

  async openGalleryPicker(source) {
    const layer = openModal(`
      <h3>${source === "mine" ? t("forge_from_my_creations_label") : t("forge_community_heading")}</h3>
      <div id="forgeGallerySearchBox" style="position:relative;margin-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)" hidden>
        <input type="text" id="forgeGallerySearch" placeholder="${t("forge_search_by_prompt_placeholder")}"
          style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
        <div id="forgeGallerySuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
      </div>
      <div id="forgeGalleryGrid" style="margin-top:10px"><p style="font-size:13px;color:var(--color-sec)">${t("forge_loading_label")}</p></div>
    `, { wide: true });
    const endpoint = source === "mine" ? "/api/imagegen/standalone" : "/api/imagegen/community";
    let images = [];
    try {
      images = await api(endpoint);
    } catch (err) {
      layer.querySelector("#forgeGalleryGrid").innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${_esc(err.message || t("forge_couldnt_load_images"))}</p>`;
      return;
    }
    if (!images.length) {
      layer.querySelector("#forgeGalleryGrid").innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${t("forge_nothing_here_yet")}</p>`;
      return;
    }
    const state = { q: "", creatorFilters: [] };
    const box = layer.querySelector("#forgeGallerySearchBox");
    box.hidden = false;
    const searchInput = layer.querySelector("#forgeGallerySearch");
    const renderPills = () => {
      box.querySelectorAll(".inline-pill").forEach((p) => p.remove());
      state.creatorFilters.forEach((c) => {
        const pill = document.createElement("span");
        pill.className = "inline-pill pill-creator";
        pill.innerHTML = `@${_esc(c)}<span class="x" data-remove-gallery-creator="${_attr(c)}">&times;</span>`;
        box.insertBefore(pill, searchInput);
      });
      box.querySelectorAll("[data-remove-gallery-creator]").forEach((x) => {
        x.onclick = (e) => {
          e.stopPropagation();
          state.creatorFilters = state.creatorFilters.filter((c) => c !== x.dataset.removeGalleryCreator);
          renderPills();
          this.renderGalleryGrid(layer, images, state);
        };
      });
    };
    const updateSuggest = () => {
      const suggest = layer.querySelector("#forgeGallerySuggest");
      const val = searchInput.value;
      if (source === "mine" || !val.startsWith("@")) { suggest.classList.remove("open"); suggest.innerHTML = ""; return; }
      const q = val.slice(1).toLowerCase();
      const allCreators = [...new Set(images.map((i) => i.owner_username).filter(Boolean))].sort();
      const matches = allCreators.filter((c) => !state.creatorFilters.includes(c) && c.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { suggest.classList.remove("open"); suggest.innerHTML = ""; return; }
      suggest.innerHTML = matches.map((c) => `<button type="button" class="dropdown-item" data-pick-gallery-creator="${_attr(c)}">@${_esc(c)}</button>`).join("");
      suggest.classList.add("open");
      suggest.querySelectorAll("[data-pick-gallery-creator]").forEach((btn) => btn.onclick = () => {
        state.creatorFilters = [...state.creatorFilters, btn.dataset.pickGalleryCreator];
        searchInput.value = "";
        suggest.classList.remove("open");
        renderPills();
        this.renderGalleryGrid(layer, images, state);
      });
    };
    let searchTimer;
    searchInput.oninput = () => {
      updateSuggest();
      if (searchInput.value.startsWith("@")) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q = searchInput.value.trim();
        this.renderGalleryGrid(layer, images, state);
      }, 250);
    };
    searchInput.onkeydown = (e) => {
      if (e.key === "Backspace" && searchInput.value === "" && state.creatorFilters.length) {
        e.preventDefault();
        state.creatorFilters = state.creatorFilters.slice(0, -1);
        renderPills();
        this.renderGalleryGrid(layer, images, state);
        return;
      }
      if (e.key !== "Enter" || source === "mine") return;
      const val = searchInput.value.trim();
      if (val.startsWith("@") && val.length > 1) {
        state.creatorFilters = [...state.creatorFilters, val.slice(1)];
        searchInput.value = "";
        state.q = "";
        renderPills();
        this.renderGalleryGrid(layer, images, state);
      }
    };
    this.renderGalleryGrid(layer, images, state);
  }

  renderGalleryGrid(layer, images, state) {
    const grid = layer.querySelector("#forgeGalleryGrid");
    const visible = images.filter((img) => {
      if (state.creatorFilters.length && !state.creatorFilters.includes(img.owner_username)) return false;
      if (!state.q) return true;
      return (img.positive || "").toLowerCase().includes(state.q.toLowerCase());
    });
    if (!visible.length) {
      grid.innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${t("forge_no_images_match_search")}</p>`;
      return;
    }
    grid.innerHTML = `
      <div class="card-grid">
        ${visible.map((img) => {
          const censored = img.is_explicit && !ME?.nsfw_allowed;
          return `
          <button type="button" data-img-url="${_attr(img.image)}" style="position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;border:1px solid var(--color-line);padding:0;cursor:pointer;background:var(--color-surface-2)">
            <img src="${_attr(img.image)}" ${img.is_explicit ? 'data-explicit="1"' : ""} style="width:100%;height:100%;object-fit:cover${censored ? ";filter:blur(16px) saturate(60%)" : ""}" alt="">
            ${censored ? `<span style="position:absolute;top:6px;right:6px;font-family:var(--font-mono);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.6);padding:2px 6px;border-radius:6px">${t("forge_nsfw_badge")}</span>` : ""}
          </button>
        `;
        }).join("")}
      </div>
    `;
    grid.querySelectorAll("[data-img-url]").forEach((btn) => {
      btn.onclick = () => this.setReferenceFromUrl(btn.dataset.imgUrl, layer);
    });
  }

  async setReferenceFromUrl(url, layer) {
    const assign = (dataUrl) => { this.referenceImage = dataUrl; };
    try {
      const blob = await (await fetch(url)).blob();
      if (layer) closeModal(layer);
      closeTopModal();
      if (this.mode === "upscale") {
        maybeCropUpload(blob, "1/1", 1024, 1024, (dataUrl) => {
          assign(dataUrl);
          this.render();
        });
        return;
      }
      if (this.mode === "inpaint") {
        loadImageNative(blob, 1024, (dataUrl, width, height) => {
          this.inpaintDims = [width, height];
          assign(dataUrl);
          this.render();
        });
        return;
      }
      const [w, h] = FORGE_ASPECTS[this.aspect] || [1024, 1024];
      maybeCropUpload(blob, `${w}/${h}`, w, h, (dataUrl) => {
        assign(dataUrl);
        this.render();
      });
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_load_image"));
    }
  }

  maskBarHtml() {
    if (this.mode !== "inpaint" || !this.referenceImage) return "";
    return `
      <div style="margin-bottom:16px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
          <div style="display:flex;gap:4px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:11px;padding:4px">
            <button type="button" id="forgeBrushBtn" class="filter-chip on" onclick="_activeForgeView.setMaskTool(false)">${t("forge_brush_button")}</button>
            <button type="button" id="forgeEraseBtn" class="filter-chip" onclick="_activeForgeView.setMaskTool(true)">${t("forge_eraser_button")}</button>
          </div>
          <button type="button" class="filter-chip" onclick="_activeForgeView.undoMask()">${t("forge_undo_button")}</button>
          <button type="button" class="filter-chip" onclick="_activeForgeView.clearMask()">${t("forge_clear_button")}</button>
        </div>
        <label class="grimoire-field-label">${t("forge_brush_size_label")}</label>
        <input type="range" id="forgeBrushSize" min="8" max="120" value="${this.brushSize}" style="width:100%" oninput="_activeForgeView.brushSize = +this.value">
        <p style="font-size:11.5px;color:var(--color-sec);margin-top:8px">${t("forge_paint_over_area_hint")}</p>
      </div>
    `;
  }

  setMaskTool(erase) {
    this.eraseMode = erase;
    const brushBtn = this.main.querySelector("#forgeBrushBtn");
    const eraseBtn = this.main.querySelector("#forgeEraseBtn");
    if (brushBtn) brushBtn.classList.toggle("on", !erase);
    if (eraseBtn) eraseBtn.classList.toggle("on", erase);
  }

  undoMask() {
    const ctx = this._maskCtx;
    if (!ctx || !this.maskUndo.length) return;
    ctx.putImageData(this.maskUndo.pop(), 0, 0);
  }

  clearMask() {
    const canvas = this.main.querySelector("#forgeMaskCanvas");
    if (!canvas || !this._maskCtx) return;
    this._maskCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.maskUndo = [];
  }

  setupMaskCanvas() {
    const canvas = this.main.querySelector("#forgeMaskCanvas");
    if (!canvas) { this._maskCtx = null; return; }
    const ctx = canvas.getContext("2d");
    this._maskCtx = ctx;
    const point = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    };
    const stroke = (a, b) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = this.brushSize;
      ctx.globalCompositeOperation = this.eraseMode ? "destination-out" : "source-over";
      ctx.strokeStyle = "rgba(232, 183, 90, 0.55)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };
    let painting = false;
    let last = null;
    canvas.onpointerdown = (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.maskUndo.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (this.maskUndo.length > 12) this.maskUndo.shift();
      painting = true;
      last = point(e);
      stroke(last, last);
    };
    canvas.onpointermove = (e) => {
      if (!painting) return;
      const p = point(e);
      stroke(last, p);
      last = p;
    };
    canvas.onpointerup = () => { painting = false; };
    canvas.onpointerleave = () => { painting = false; };
  }

  buildMaskDataUrl() {
    const canvas = this.main.querySelector("#forgeMaskCanvas");
    if (!canvas) return null;
    const src = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const outCtx = out.getContext("2d");
    const outData = outCtx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const painted = src.data[i + 3] > 0;
      const v = painted ? 255 : 0;
      outData.data[i] = v;
      outData.data[i + 1] = v;
      outData.data[i + 2] = v;
      outData.data[i + 3] = 255;
    }
    outCtx.putImageData(outData, 0, 0);
    return out.toDataURL("image/png");
  }

  durationFpsHtml() {
    if (this.mode !== "video") return "";
    const durations = ["2s", "3s", "4s", "6s"];
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">${t("forge_duration_label")}</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
          ${durations.map((d) => this.segChip(d, this.duration === d, `_activeForgeView.duration = '${d}'; _activeForgeView.render()`)).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span class="grimoire-field-label" style="margin:0">${t("forge_frame_rate_label")}</span>
          <span id="forgeFpsVal" style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${this.fps} fps</span>
        </div>
        <input type="range" min="8" max="30" step="1" value="${this.fps}" oninput="_activeForgeView.fps = +this.value; _activeForgeView.main.querySelector('#forgeFpsVal').textContent = this.value + ' fps'" style="width:100%">
      </div>
    `;
  }

  async loadModels() {
    const checkpointEndpoint = this.architecture === "anima" ? "/api/imagegen/anima-unets" : "/api/imagegen/checkpoints";
    const [checkpoints, previews, loraOptions, loraPreviews, samplerData, samplerPreviews, schedulerPreviews] = await Promise.all([
      api(checkpointEndpoint).catch(() => []),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/loras").catch(() => []),
      api("/api/imagegen/lora-previews").catch(() => ({})),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
      api("/api/imagegen/sampler-previews").catch(() => ({})),
      api("/api/imagegen/scheduler-previews").catch(() => ({})),
    ]);
    this.checkpoints = checkpoints;
    this.checkpointPreviews = previews;
    this.loraOptions = loraOptions;
    this.loraPreviews = loraPreviews;
    this.samplers = samplerData.samplers || [];
    this.schedulers = samplerData.schedulers || [];
    this.samplerPreviews = samplerPreviews;
    this.schedulerPreviews = schedulerPreviews;
    if (!this.checkpoint && checkpoints.length) {
      this.checkpoint = checkpoints.find((m) => m.toLowerCase().includes("realskin")) || checkpoints[0];
    }
    if (!this.sampler && this.samplers.length) {
      this.sampler = this.samplers.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu"
        : this.samplers.includes("euler") ? "euler" : this.samplers[0];
    }
    if (!this.scheduler && this.schedulers.length) {
      this.scheduler = this.schedulers.includes("karras") ? "karras"
        : this.schedulers.includes("normal") ? "normal" : this.schedulers[0];
    }
    this.render();
  }

  modelThumbHtml(name, p, size) {
    const img = p?.image;
    const label = p?.display_name || name || "?";
    const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)`;
    return img
      ? `<span style="${style}"><img src="${_attr(img)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
      : `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(label[0].toUpperCase())}</span>`;
  }

  modelPickerHtml() {
    if (this.mode === "upscale" || this.mode === "video") return "";
    if (!this.checkpoints.length) {
      return `<div style="margin-bottom:16px"><label class="grimoire-field-label">${t("forge_model_label")}</label><p style="font-size:12.5px;color:var(--color-sec)">${t("forge_couldnt_load_models")}</p></div>`;
    }
    const p = this.checkpointPreviews[this.checkpoint];
    const label = p?.display_name || this.checkpoint || "-";
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">${t("forge_model_label")}</label>
        <p style="margin:0 0 8px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${t("forge_model_hint")}</p>
        <button type="button" onclick="_activeForgeView.openModelPicker()" style="width:100%;display:flex;align-items:center;gap:12px;padding:10px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;cursor:pointer;text-align:left">
          ${this.modelThumbHtml(this.checkpoint, p, 52)}
          <span style="flex:1;min-width:0">
            <span style="display:block;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(label)}</span>
            ${p?.description ? `<span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(p.description)}</span>` : `<span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px">${this.checkpoints.length} ${t("forge_installed_word")}</span>`}
          </span>
          <span style="color:var(--color-muted);flex:none">&rsaquo;</span>
        </button>
      </div>
    `;
  }

  openModelPicker() {
    this._mpQuery = "";
    this._mpPicked = this.checkpoint;
    openModal(this.modelPickerModalHtml(), { wide: true });
    document.getElementById("mpSearch").oninput = (e) => { this._mpQuery = e.target.value; this.renderModelPickerGrid(); };
    this.renderModelPickerGrid();
    this.renderModelPickerDetail();
  }

  modelPickerModalHtml() {
    return `
      <h3>${t("forge_choose_model_heading")}</h3>
      <input type="text" id="mpSearch" placeholder="${t("forge_search_models_placeholder")}" value="${_attr(this._mpQuery)}" style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)">
      <div id="mpGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px;max-height:300px;overflow-y:auto;margin-bottom:14px;padding:2px"></div>
      <div id="mpDetail"></div>
    `;
  }

  renderModelPickerGrid() {
    const grid = document.getElementById("mpGrid");
    if (!grid) return;
    const q = (this._mpQuery || "").trim().toLowerCase();
    let list = this.checkpoints;
    if (q) list = list.filter((n) => n.toLowerCase().includes(q) || (this.checkpointPreviews[n]?.display_name || "").toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map((name) => {
      const p = this.checkpointPreviews[name];
      const label = p?.display_name || name;
      const active = name === this._mpPicked;
      return `
        <button type="button" data-mp-name="${_attr(name)}" style="display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
          ${this.modelThumbHtml(name, p, 64).replace(/border-color:var\(--color-line\)/, `border-color:${active ? "var(--color-accent)" : "var(--color-line)"};border-width:${active ? "2px" : "1px"}`)}
          <span style="font-size:10.5px;text-align:center;color:${active ? "var(--color-accent)" : "var(--color-sec)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${_esc(label)}</span>
        </button>
      `;
    }).join("") : `<p style="font-size:12.5px;color:var(--color-sec);grid-column:1/-1">${t("forge_no_models_match")}</p>`;
    grid.querySelectorAll("[data-mp-name]").forEach((b) => b.onclick = () => {
      this._mpPicked = b.dataset.mpName;
      this.renderModelPickerGrid();
      this.renderModelPickerDetail();
    });
  }

  renderModelPickerDetail() {
    const detail = document.getElementById("mpDetail");
    if (!detail) return;
    const name = this._mpPicked;
    const p = this.checkpointPreviews[name];
    const label = p?.display_name || name || "";
    detail.innerHTML = name ? `
      <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;margin-bottom:12px">
        ${this.modelThumbHtml(name, p, 56)}
        <span style="flex:1;min-width:0">
          <span style="display:block;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink)">${_esc(label)}</span>
          ${p?.description ? `<span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px">${_esc(p.description)}</span>` : ""}
        </span>
      </div>
      <button type="button" id="mpUse" style="width:100%;padding:12px;border-radius:12px;font-weight:600;font-size:14px;color:var(--color-paper);background:linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));border:none;cursor:pointer">${t("forge_use_this_model_button")}</button>
    ` : "";
    const useBtn = document.getElementById("mpUse");
    if (useBtn) useBtn.onclick = () => { this.setCheckpoint(name); closeTopModal(); };
  }

  loraThumbHtml(name, size) {
    return this.modelThumbHtml(name, this.loraPreviews[name], size);
  }

  loraTagsHtml(name) {
    const keywords = this.loraPreviews[name]?.keywords || [];
    if (!keywords.length) return "";
    return `
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
        ${keywords.map((k) => `<span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.04em;color:var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));border:1px solid var(--color-accent);border-radius:6px;padding:2px 7px">${_esc(k)}</span>`).join("")}
      </div>
    `;
  }

  loraSectionHtml() {
    if (this.mode === "upscale" || this.mode === "video" || this.mode === "inpaint") return "";
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">${t("forge_style_addons_loras_label")}</label>
        <p style="margin:0 0 8px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${t("forge_style_addons_hint")}</p>
        ${this.loraOptions.length ? `
          <button type="button" onclick="_activeForgeView.openLoraPicker()" style="width:100%;display:flex;align-items:center;gap:12px;padding:10px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;cursor:pointer;text-align:left">
            ${this.loras.length ? `
              <span style="display:flex;flex:none">
                ${this.loras.slice(0, 3).map((l, i) => `<span style="border-radius:10px;overflow:hidden;border:2px solid var(--color-surface);margin-left:${i ? "-14px" : "0"};position:relative;z-index:${3 - i}">${this.loraThumbHtml(l.name, 40)}</span>`).join("")}
              </span>
            ` : `<span style="width:40px;height:40px;border-radius:10px;background:var(--color-surface-2);display:grid;place-items:center;color:var(--color-muted);flex:none">+</span>`}
            <span style="flex:1;min-width:0">
              <span style="display:block;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink)">${this.loras.length ? `${this.loras.length} ${this.loras.length === 1 ? t("forge_addon_singular_active") : t("forge_addons_plural_active")}` : t("forge_add_style_addons_label")}</span>
              <span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px">${this.loraOptions.length} ${t("forge_installed_word")}</span>
            </span>
            <span style="color:var(--color-muted);flex:none">&rsaquo;</span>
          </button>
          ${this.loras.length ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${this.loras.map((l) => this.loraStrengthRowHtml(l)).join("")}</div>` : ""}
        ` : `<p style="font-size:12.5px;color:var(--color-sec)">${t("forge_no_loras_available")}</p>`}
      </div>
    `;
  }

  loraTileHtml(name) {
    const active = !!this.loras.find((l) => l.name === name);
    return `
      <button type="button" data-lora-tile="${_attr(name)}" style="flex:none;display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:none;cursor:pointer">
        ${this.loraThumbHtml(name, 64).replace(/border-color:var\(--color-line\)/, `border-color:${active ? "var(--color-accent)" : "var(--color-line)"};border-width:${active ? "2px" : "1px"}`)}
        <span style="font-size:9.5px;text-align:center;color:${active ? "var(--color-accent)" : "var(--color-sec)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64px">${_esc(this.loraPreviews[name]?.display_name || name)}</span>
      </button>
    `;
  }

  loraStrengthRowHtml(lora) {
    const valId = `forgeLoraStrength_${_esc(lora.name.replace(/[^a-zA-Z0-9]/g, "_"))}`;
    return `
      <div style="display:flex;align-items:center;gap:10px">
        ${this.loraThumbHtml(lora.name, 32)}
        <span style="flex:1;font-size:12.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(this.loraPreviews[lora.name]?.display_name || lora.name)}</span>
        <input type="range" min="-8" max="8" step="0.05" value="${lora.strength}" oninput="_activeForgeView.setLoraStrength(${_attr(JSON.stringify(lora.name))}, +this.value); _activeForgeView.main.querySelector('#${valId}').textContent = (+this.value).toFixed(2)" style="width:90px">
        <span id="${valId}" style="font-family:var(--font-mono);font-size:11px;color:var(--color-accent);width:32px;text-align:right">${lora.strength.toFixed(2)}</span>
        <button type="button" onclick="_activeForgeView.toggleLora(${_attr(JSON.stringify(lora.name))})" style="background:none;border:none;color:var(--color-muted);cursor:pointer;font-size:16px;line-height:1">&times;</button>
      </div>
    `;
  }

  openLoraPicker() {
    this._lpQuery = "";
    this._lpFocused = this.loras[0]?.name || this.loraOptions[0] || null;
    openModal(this.loraPickerModalHtml(), { wide: true });
    document.getElementById("lpSearch").oninput = (e) => { this._lpQuery = e.target.value; this.renderLoraPickerGrid(); };
    this.renderLoraPickerGrid();
    this.renderLoraPickerDetail();
  }

  loraPickerModalHtml() {
    return `
      <h3>${t("forge_choose_loras_heading")}</h3>
      <input type="text" id="lpSearch" placeholder="${t("forge_search_loras_placeholder")}" value="${_attr(this._lpQuery)}" style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)">
      <div id="lpGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px;max-height:300px;overflow-y:auto;margin-bottom:14px;padding:2px"></div>
      <div id="lpDetail"></div>
    `;
  }

  renderLoraPickerGrid() {
    const grid = document.getElementById("lpGrid");
    if (!grid) return;
    const q = (this._lpQuery || "").trim().toLowerCase();
    let list = this.loraOptions;
    if (q) list = list.filter((n) => n.toLowerCase().includes(q) || (this.loraPreviews[n]?.display_name || "").toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map((name) => this.loraTileHtml(name)).join("") : `<p style="font-size:12.5px;color:var(--color-sec);grid-column:1/-1">${t("forge_no_loras_match")}</p>`;
    grid.querySelectorAll("[data-lora-tile]").forEach((b) => b.onclick = () => {
      this._lpFocused = b.dataset.loraTile;
      this.toggleLora(b.dataset.loraTile);
      this.renderLoraPickerGrid();
      this.renderLoraPickerDetail();
    });
  }

  renderLoraPickerDetail() {
    const detail = document.getElementById("lpDetail");
    if (!detail) return;
    const name = this._lpFocused;
    const p = this.loraPreviews[name];
    const label = p?.display_name || name || "";
    const active = !!this.loras.find((l) => l.name === name);
    detail.innerHTML = name ? `
      <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;margin-bottom:12px">
        ${this.modelThumbHtml(name, p, 56)}
        <span style="flex:1;min-width:0">
          <span style="display:block;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink)">${_esc(label)}</span>
          ${p?.description ? `<span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px">${_esc(p.description)}</span>` : ""}
          ${this.loraTagsHtml(name)}
        </span>
      </div>
      <button type="button" id="lpToggle" style="width:100%;padding:12px;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;${active ? "color:var(--color-warn);background:var(--color-surface);border:1px solid var(--color-warn)" : "color:var(--color-paper);background:linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));border:none"}">${active ? t("forge_remove_button") : t("forge_add_this_lora_button")}</button>
    ` : "";
    const toggleBtn = document.getElementById("lpToggle");
    if (toggleBtn) toggleBtn.onclick = () => {
      this.toggleLora(name);
      this.renderLoraPickerGrid();
      this.renderLoraPickerDetail();
    };
  }

  advancedHtml() {
    if (this.mode === "upscale") return "";
    return `
      <div style="margin-bottom:16px;border:1px solid var(--color-line);border-radius:14px;overflow:hidden">
        <button type="button" onclick="_activeForgeView.advancedOpen = !_activeForgeView.advancedOpen; _activeForgeView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink);text-align:left">
          <span style="flex:1">
            <span style="display:block;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-sec)">${t("forge_advanced_label")}</span>
            <span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:3px">${t("forge_advanced_hint")}</span>
          </span>
          <span style="transform:rotate(${this.advancedOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${this.advancedOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line)">
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
                <span class="grimoire-field-label" style="margin:0">${t("forge_steps_label")}</span>
                <span id="forgeStepsVal" style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${this.steps}</span>
              </div>
              <input type="range" min="1" max="60" step="1" value="${this.steps}" oninput="_activeForgeView.steps = +this.value; _activeForgeView.main.querySelector('#forgeStepsVal').textContent = this.value" style="width:100%">
              <p style="margin:6px 0 0;color:var(--color-muted);font-size:11.5px;line-height:1.45">${t("forge_steps_hint")}</p>
            </div>
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
                <span class="grimoire-field-label" style="margin:0">${t("forge_guidance_cfg_label")}</span>
                <span id="forgeCfgVal" style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${this.cfg.toFixed(1)}</span>
              </div>
              <input type="range" min="1" max="15" step="0.5" value="${this.cfg}" oninput="_activeForgeView.cfg = +this.value; _activeForgeView.main.querySelector('#forgeCfgVal').textContent = (+this.value).toFixed(1)" style="width:100%">
              <p style="margin:6px 0 0;color:var(--color-muted);font-size:11.5px;line-height:1.45">${t("forge_cfg_hint")}</p>
            </div>
            ${this.mode === "video" ? "" : this.simplePickerSummaryHtml("sampler", "Sampler", this.samplers)}
            ${this.mode === "video" ? "" : this.simplePickerSummaryHtml("scheduler", "Scheduler", this.schedulers)}
          </div>
        ` : ""}
      </div>
    `;
  }

  simplePickerSummaryHtml(kind, title, options) {
    const value = this[kind];
    const label = value || t("forge_default_word");
    const desc = value ? (kind === "sampler" ? forgeSamplerDesc(value) : forgeSchedulerDesc(value)) : "";
    const previews = kind === "sampler" ? this.samplerPreviews : this.schedulerPreviews;
    return `
      <div style="margin-bottom:14px">
        <label class="grimoire-field-label">${title}</label>
        <button type="button" onclick="_activeForgeView.openSimplePicker('${kind}')" style="width:100%;display:flex;align-items:center;gap:12px;padding:10px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;cursor:pointer;text-align:left">
          ${this.modelThumbHtml(value, previews[value], 44)}
          <span style="flex:1;min-width:0">
            <span style="display:block;font-family:var(--font-mono);font-size:12.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(label)}</span>
            ${desc ? `<span style="display:block;font-size:11px;color:var(--color-muted);margin-top:2px;line-height:1.4">${_esc(desc)}</span>` : ""}
          </span>
          <span style="color:var(--color-muted);flex:none">&rsaquo;</span>
        </button>
      </div>
    `;
  }

  openSimplePicker(kind) {
    this._spQuery = "";
    this._spKind = kind;
    openModal(this.simplePickerModalHtml(kind), { wide: true });
    document.getElementById("spSearch").oninput = (e) => { this._spQuery = e.target.value; this.renderSimplePickerList(); };
    this.renderSimplePickerList();
  }

  simplePickerModalHtml(kind) {
    const title = kind === "sampler" ? t("forge_choose_sampler_heading") : t("forge_choose_scheduler_heading");
    const hint = kind === "sampler" ? t("forge_sampler_picker_hint") : t("forge_scheduler_picker_hint");
    return `
      <h3>${title}</h3>
      <p style="font-size:12px;color:var(--color-muted);margin:-4px 0 12px;line-height:1.4">${hint}</p>
      <input type="text" id="spSearch" placeholder="${t("forge_search_ellipsis_placeholder")}" value="${_attr(this._spQuery)}" style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)">
      <div id="spList" style="display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto;padding:2px"></div>
    `;
  }

  renderSimplePickerList() {
    const list = document.getElementById("spList");
    if (!list) return;
    const kind = this._spKind;
    const source = kind === "sampler" ? this.samplers : this.schedulers;
    const recommended = kind === "sampler"
      ? (source.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (source.includes("euler") ? "euler" : source[0]))
      : (source.includes("karras") ? "karras" : (source.includes("normal") ? "normal" : source[0]));
    const descFn = kind === "sampler" ? forgeSamplerDesc : forgeSchedulerDesc;
    const previews = kind === "sampler" ? this.samplerPreviews : this.schedulerPreviews;
    const q = (this._spQuery || "").trim().toLowerCase();
    const filtered = q ? source.filter((s) => s.toLowerCase().includes(q) || descFn(s).toLowerCase().includes(q)) : source;
    list.innerHTML = filtered.length ? filtered.map((name) => {
      const active = this[kind] === name;
      const desc = descFn(name);
      return `
        <button type="button" data-sp-name="${_attr(name)}" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid ${active ? "var(--color-accent)" : "transparent"};background:${active ? "var(--color-surface-2)" : "none"};cursor:pointer;text-align:left">
          ${this.modelThumbHtml(name, previews[name], 40)}
          <span style="flex:1;min-width:0">
            <span style="display:flex;align-items:center;gap:6px">
              <span style="font-family:var(--font-mono);font-size:13px;color:${active ? "var(--color-accent)" : "var(--color-ink)"}">${_esc(name)}</span>
              ${name === recommended ? `<span style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--color-accent);border:1px solid var(--color-accent);border-radius:5px;padding:1px 5px">${t("forge_recommended_badge")}</span>` : ""}
            </span>
            ${desc ? `<span style="display:block;font-size:11px;color:var(--color-muted);margin-top:3px;line-height:1.4">${_esc(desc)}</span>` : ""}
          </span>
          ${active ? `<span style="color:var(--color-accent);flex:none">&check;</span>` : ""}
        </button>
      `;
    }).join("") : `<p style="font-size:12.5px;color:var(--color-sec)">${t("forge_no_matches")}</p>`;
    list.querySelectorAll("[data-sp-name]").forEach((b) => b.onclick = () => {
      this[kind] = b.dataset.spName;
      closeTopModal();
      this.render();
    });
  }

  setCheckpoint(name) { this.checkpoint = name; this.render(); }

  toggleLora(name) {
    const idx = this.loras.findIndex((l) => l.name === name);
    if (idx === -1) this.loras = [...this.loras, { name, strength: 0.8 }];
    else this.loras = this.loras.filter((l) => l.name !== name);
    this.render();
  }

  setLoraStrength(name, strength) {
    this.loras = this.loras.map((l) => (l.name === name ? { ...l, strength } : l));
  }

  buildBody() {
    const [width, height] = FORGE_ASPECTS[this.aspect];
    const anima = this.architecture === "anima";
    const body = {
      positive: this.positive,
      negative: this.negative,
      checkpoint: this.checkpoint || null,
      loras: this.loras,
      width,
      height,
      sampler: anima ? ANIMA_DEFAULT_SAMPLER : (this.sampler || null),
      scheduler: anima ? ANIMA_DEFAULT_SCHEDULER : (this.scheduler || null),
      steps: this.steps,
      cfg: anima ? ANIMA_DEFAULT_CFG : this.cfg,
      architecture: this.architecture,
    };
    if (this.mode === "image" && this.referenceImage) {
      body.reference_image = this.referenceImage;
      body.denoise = this.denoise;
    }
    if (this.mode === "inpaint") {
      return {
        image: this.referenceImage,
        mask: this.buildMaskDataUrl(),
        positive: this.positive,
        negative: this.negative,
        checkpoint: this.checkpoint || null,
        denoise: this.denoise,
        sampler: anima ? ANIMA_DEFAULT_SAMPLER : (this.sampler || null),
        scheduler: anima ? ANIMA_DEFAULT_SCHEDULER : (this.scheduler || null),
        steps: this.steps,
        cfg: anima ? ANIMA_DEFAULT_CFG : this.cfg,
        architecture: this.architecture,
      };
    }
    return body;
  }

  videoDimensions() {
    const [w, h] = FORGE_ASPECTS[this.aspect];
    const targetPixels = 832 * 480;
    const scale = Math.sqrt(targetPixels / (w * h));
    const round8 = (v) => Math.max(8, Math.round((v * scale) / 8) * 8);
    return [round8(w), round8(h)];
  }

  async generate(bodyOverride) {
    if (this.busy) return;
    if (!bodyOverride && this.mode === "video") return this.generateVideo();
    const body = bodyOverride || this.buildBody();
    if (this.mode === "inpaint" && !body.image) { toast(t("forge_add_reference_image_first")); return; }
    if (!body.positive.trim()) { toast(t("forge_prompt_required")); return; }
    const genToken = (this._genToken = (this._genToken || 0) + 1);
    this.busy = true;
    this.previewImage = "";
    this.lastResult = null;
    this.render();
    const endpoint = this.mode === "inpaint" ? "/api/imagegen/inpaint" : "/api/imagegen/standalone/stream";
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (genToken !== this._genToken) return;
        if (ev.type === "status") {
          this.queueWait = { message: ev.message };
          this.startQueueTicker(genToken);
          this.render();
        } else if (ev.type === "preview") {
          this.stopQueueTicker();
          this.previewImage = ev.image;
          const img = this.main.querySelector("#forgePreviewBox img");
          if (img) img.src = ev.image;
          else this.render();
        } else if (ev.type === "done") {
          this.stopQueueTicker();
          this.busy = false;
          this.lastResult = { image: ev.image, body, isImg2img: this.mode === "inpaint" || !!body.reference_image };
          this.render();
        } else if (ev.type === "error") {
          this.stopQueueTicker();
          this.busy = false;
          errorToast(ev.message || t("forge_generation_failed"));
          this.render();
        }
      });
    } catch (err) {
      if (genToken !== this._genToken) return;
      this.busy = false;
      errorToast(err.message || t("forge_generation_failed"));
      this.render();
    }
  }

  async generateVideo() {
    if (!this.positive.trim()) { toast(t("forge_prompt_required")); return; }
    const [width, height] = this.videoDimensions();
    const numFrames = Math.min(120, Math.max(8, parseInt(this.duration) * this.fps));
    const body = {
      positive: this.positive,
      negative: this.negative,
      fps: this.fps,
      num_frames: numFrames,
      width,
      height,
      steps: this.steps,
      cfg: this.cfg,
    };
    const genToken = (this._genToken = (this._genToken || 0) + 1);
    this.busy = true;
    this.genStatus = t("forge_starting_status");
    this.previewImage = "";
    this.lastResult = null;
    this.render();
    try {
      const res = await fetch(`${API}/api/imagegen/video`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (genToken !== this._genToken) return;
        if (ev.type === "status") {
          this.genStatus = ev.message;
          const el = this.main.querySelector("#forgeVideoStatus");
          if (el) el.textContent = ev.message;
          else this.render();
        } else if (ev.type === "preview") {
          this.previewImage = ev.image;
          const img = this.main.querySelector("#forgeVideoPreviewImg");
          if (img) img.src = ev.image;
          else this.render();
        } else if (ev.type === "done") {
          this.stopQueueTicker();
          this.busy = false;
          this.lastResult = { image: ev.video.image, mediaType: "video", body, savedId: ev.video.id, isPublic: !!ev.video.is_public };
          this.render();
        } else if (ev.type === "error") {
          this.stopQueueTicker();
          this.busy = false;
          errorToast(ev.message || t("forge_video_generation_failed"));
          this.render();
        }
      });
    } catch (err) {
      if (genToken !== this._genToken) return;
      this.busy = false;
      errorToast(err.message || t("forge_video_generation_failed"));
      this.render();
    }
  }

  async cancelGenerate() {
    this._genToken = (this._genToken || 0) + 1;
    this.busy = false;
    this.render();
    try {
      await api("/api/imagegen/standalone/stream/stop", { method: "POST" });
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_stop_generation"));
    }
  }

  regenerate() {
    if (!this.lastResult) return;
    this.generate(this.lastResult.body);
  }

  generateBarHtml(variant = "sticky") {
    const wrapClass = variant === "inline" ? "forge-generate-inline" : "forge-generate-sticky";
    const wrapStyle = variant === "inline" ? "" : "position:sticky;bottom:calc(70px + 12px);z-index:5";
    if (this.mode === "upscale") {
      if (!this.referenceImage || this.lastResult) return "";
      if (this.upscaling) {
        return `
          <div class="${wrapClass}" style="${wrapStyle}">
            <button type="button" class="forge-generate-btn" onclick="_activeForgeView.cancelUpscale()">${t("forge_upscaling_tap_to_cancel")}</button>
          </div>
        `;
      }
      return `
        <div class="${wrapClass}" style="${wrapStyle}">
          <button type="button" class="forge-generate-btn" onclick="_activeForgeView.openUpscale()">${t("forge_upscale_tab")}</button>
        </div>
      `;
    }
    return `
      <div class="${wrapClass}" style="${wrapStyle}">
        <button type="button" class="forge-generate-btn" onclick="_activeForgeView.${this.busy ? "cancelGenerate" : "generate"}()">
          ${this.busy ? t("forge_generating_tap_to_cancel") : t("forge_generate_button")}
        </button>
      </div>
    `;
  }

  async save() {
    if (!this.lastResult) return;
    const b = this.lastResult.body || {};
    const saveEndpoint = this.mode === "inpaint" ? "/api/imagegen/inpaint/save" : "/api/imagegen/standalone/save";
    try {
      const rec = await api(saveEndpoint, {
        method: "POST",
        body: JSON.stringify({
          image: this.lastResult.image,
          positive: b.positive || "",
          negative: b.negative || "",
          checkpoint: b.checkpoint || "",
          loras: b.loras || [],
          sampler: b.sampler || "",
          scheduler: b.scheduler || "",
          steps: b.steps || 20,
          is_img2img: !!this.lastResult.isImg2img,
          cfg: b.cfg || 7.0,
          upscaler: this.lastResult.upscaler || "",
        }),
      });
      this.recent = [rec, ...this.recent].slice(0, 20);
      this.lastResult = { ...this.lastResult, savedId: rec.id, isPublic: !!rec.is_public };
      toast(t("forge_saved_to_gallery"));
      this.render();
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_save_image"));
    }
  }

  useUpscaledAsReference() {
    if (!this.lastResult) return;
    const image = this.lastResult.image;
    this.lastResult = null;
    this.mode = "image";
    this.referenceImage = image;
    this.render();
    toast(t("forge_upscaled_set_as_reference"));
  }

  async openUpscale() {
    const source = this.lastResult ? this.lastResult.image : this.referenceImage;
    if (!source) { toast(t("forge_add_image_first")); return; }
    if (!this.upscalers.length) {
      const [upscalers, previews] = await Promise.all([
        api("/api/imagegen/upscalers").catch(() => []),
        api("/api/imagegen/upscaler-previews").catch(() => ({})),
      ]);
      this.upscalers = upscalers;
      this.upscalerPreviews = previews;
    }
    this.upscalePickerOpen = true;
    this.render();
  }

  upscalePickerHtml() {
    if (!this.upscalePickerOpen) return "";
    if (!this.upscalers.length) {
      return `<div style="margin-bottom:16px"><p style="font-size:12.5px;color:var(--color-sec)">${t("forge_no_upscaler_models_available")}</p></div>`;
    }
    return `
      <div style="margin-bottom:16px;padding:14px;border:1px solid var(--color-line);border-radius:14px;background:var(--color-surface)">
        <label class="grimoire-field-label">${t("forge_choose_upscaler_label")}</label>
        <div style="display:flex;gap:8px;overflow-x:auto">
          ${this.upscalers.map((u) => {
            const p = this.upscalerPreviews[u];
            const art = p?.image ? `background-image:url('${_attr(p.image)}')` : "background:var(--color-surface-2)";
            const label = p?.display_name || u;
            return `
              <button type="button" onclick="_activeForgeView.runUpscale('${_attr(u.replace(/\\/g, "\\\\").replace(/'/g, "\\'"))}')" style="flex:none;width:78px;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
                <span class="sanctum-specimen" style="width:64px;height:64px;border-radius:12px;${art}">${p?.image ? "" : _esc(label[0].toUpperCase())}</span>
                <span style="font-size:10.5px;text-align:center;color:var(--color-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${_esc(label)}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  async runUpscale(upscalerName) {
    const source = this.lastResult ? this.lastResult.image : this.referenceImage;
    if (!source || this.upscaling) return;
    const wasStandalone = !this.lastResult;
    const upscaleToken = (this._upscaleGenToken = (this._upscaleGenToken || 0) + 1);
    this.upscaling = true;
    this.upscalePickerOpen = false;
    this.busy = true;
    this.previewImage = source;
    this.render();
    try {
      const res = await fetch(`${API}/api/imagegen/upscale/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: source, upscaler: upscalerName }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (upscaleToken !== this._upscaleGenToken) return;
        if (ev.type === "preview") {
          this.previewImage = ev.image;
          const img = this.main.querySelector("#forgePreviewBox img");
          if (img) img.src = ev.image;
        } else if (ev.type === "done") {
          this.stopQueueTicker();
          this.busy = false;
          this.upscaling = false;
          this.lastResult = wasStandalone
            ? { image: ev.image, body: null, isImg2img: false, upscaler: upscalerName, isUpscaleOnly: true }
            : { ...this.lastResult, image: ev.image, upscaler: upscalerName };
          this.render();
        } else if (ev.type === "error") {
          this.stopQueueTicker();
          this.busy = false;
          this.upscaling = false;
          errorToast(ev.message || t("forge_upscale_failed"));
          this.render();
        }
      });
    } catch (err) {
      if (upscaleToken !== this._upscaleGenToken) return;
      this.busy = false;
      this.upscaling = false;
      errorToast(err.message || t("forge_upscale_failed"));
      this.render();
    }
  }

  cancelUpscale() {
    this._upscaleGenToken = (this._upscaleGenToken || 0) + 1;
    this.upscaling = false;
    this.busy = false;
    this.render();
  }

  recentStripHtml() {
    if (!this.recent.length) return "";
    return `
      <div style="margin-bottom:16px">
        <div class="grimoire-field-label" style="margin-bottom:8px">${_esc(t("forge_recent"))}</div>
        <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">
          ${this.recent.map((r) => `
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="flex:none;width:84px;height:84px;border-radius:12px;border:1px solid var(--color-line);overflow:hidden;padding:0;cursor:pointer;background:var(--color-surface-2)">
              ${mediaTagHtml(r, { style: "width:100%;height:100%;object-fit:cover" })}
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  recentColumnHtml() {
    return `
      <div class="grimoire-field-label" style="margin-bottom:8px">${t("forge_recent_label")}</div>
      <p style="margin:0 0 12px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${t("forge_last_few_creations_hint")}</p>
      ${this.recent.length ? `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${this.recent.map((r) => `
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="position:relative;width:100%;aspect-ratio:3/4;border-radius:10px;overflow:hidden;border:1px solid var(--color-line);padding:0;cursor:pointer;background:var(--color-surface-2)">
              ${mediaTagHtml(r, { style: "width:100%;height:100%;object-fit:cover;display:block" })}
            </button>
          `).join("")}
        </div>
      ` : `
        <div style="text-align:center;color:var(--color-muted);padding:24px 16px;border:1px dashed var(--color-line-2);border-radius:12px">
          <div style="font-size:12.5px;line-height:1.5">${t("forge_nothing_here_yet_recent")}</div>
        </div>
      `}
    `;
  }

  viewRecent(id) {
    const rec = this.recent.find((r) => r.id === id);
    if (!rec) return;
    const fallback = this.buildBody();
    const body = {
      ...fallback,
      positive: rec.positive || fallback.positive,
      negative: rec.negative || fallback.negative,
      checkpoint: rec.checkpoint || fallback.checkpoint,
      loras: rec.loras || fallback.loras,
      sampler: rec.sampler || fallback.sampler,
      scheduler: rec.scheduler || fallback.scheduler,
      steps: rec.steps || fallback.steps,
      cfg: rec.cfg || fallback.cfg,
    };
    this.lastResult = rec.media_type === "video"
      ? { image: rec.image, mediaType: "video", body, savedId: rec.id, isPublic: !!rec.is_public }
      : { image: rec.image, body, isImg2img: !!rec.is_img2img, savedId: rec.id, isPublic: !!rec.is_public };
    this.render();
  }

  openRecentDetail(id) {
    const rec = this.recent.find((r) => r.id === id);
    if (!rec) return;
    const img = { ...rec, user_id: ME?.id };
    const pv = new ExploreMediaView();
    openModal(pv.detailHtml(img, { hideShare: true, context: "forge" }), { wide: true });
    pv.wireDetailModal(img);
  }

  async setMode(mode) {
    if (mode === this.mode) return;
    if (mode === "video" && ME?.role !== "dev") {
      errorToast(t("forge_video_dev_only_notice"));
      return;
    }
    if (this.lastResult) {
      if (!await confirmDialog(t("forge_unsaved_image_switch_confirm"), { confirmLabel: t("forge_switch_anyway_button") })) return;
    }
    this.mode = mode;
    this.lastResult = null;
    this.render();
  }
  setArchitecture(arch) {
    this.architecture = arch;
    this.checkpoint = "";
    if (this.loras.length > 0) toast(t("forge_lora_selections_cleared"));
    this.loras = [];
    this.render();
    this.loadModels();
  }
  setAspect(aspect) { this.aspect = aspect; this.render(); }
  toggleNegative() { this.showNegative = !this.showNegative; this.render(); }

  async openMyCreationsModal() {
    const layer = openModal(`
      <h3>${t("forge_from_my_creations_label")}</h3>
      <div id="forgeCreationsGrid" style="margin-top:10px"><p style="font-size:13px;color:var(--color-sec)">${t("forge_loading_label")}</p></div>
    `, { wide: true });
    let images;
    try {
      images = await api("/api/imagegen/standalone");
    } catch (err) {
      layer.querySelector("#forgeCreationsGrid").innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${_esc(err.message || t("forge_couldnt_load_creations"))}</p>`;
      return;
    }
    this._creationsImages = images;
    this.renderMyCreationsGrid(layer);
  }

  renderMyCreationsGrid(layer) {
    const grid = layer.querySelector("#forgeCreationsGrid");
    const images = this._creationsImages || [];
    if (!images.length) {
      grid.innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${t("forge_nothing_saved_yet")}</p>`;
      return;
    }
    grid.innerHTML = `
      <div class="card-grid">
        ${images.map((img) => {
          const censored = img.is_explicit && !ME?.nsfw_allowed;
          return `
          <div style="position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--color-line);background:var(--color-surface-2)">
            <div style="aspect-ratio:1;overflow:hidden;cursor:pointer" data-creation-view="${_attr(img.id)}">
              ${mediaTagHtml(img, { style: `width:100%;height:100%;object-fit:cover${censored ? ";filter:blur(16px) saturate(60%)" : ""}` })}
            </div>
            ${censored ? `<span style="position:absolute;top:6px;right:6px;font-family:var(--font-mono);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.6);padding:2px 6px;border-radius:6px">NSFW</span>` : ""}
            <div style="display:flex;gap:4px;padding:6px">
              <button type="button" class="filter-chip${img.is_public ? " on" : ""}" style="flex:1;display:flex;align-items:center;justify-content:center" data-creation-share="${_attr(img.id)}" data-tooltip="${img.is_public ? t("forge_unshare_word") : t("forge_share_word")}" aria-label="${img.is_public ? t("forge_unshare_word") : t("forge_share_word")}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9"/></svg>
              </button>
              <button type="button" class="filter-chip" style="flex:none;color:var(--color-warn);display:flex;align-items:center;justify-content:center" data-creation-delete="${_attr(img.id)}" data-tooltip="${t("forge_delete_word")}" aria-label="${t("forge_delete_word")}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          </div>
        `;
        }).join("")}
      </div>
    `;
    grid.querySelectorAll("[data-creation-view]").forEach((el) => {
      el.onclick = () => this.openCreationDetail(el.dataset.creationView);
    });
    grid.querySelectorAll("[data-creation-share]").forEach((btn) => {
      btn.onclick = () => this.toggleCreationShare(layer, btn.dataset.creationShare);
    });
    grid.querySelectorAll("[data-creation-delete]").forEach((btn) => {
      btn.onclick = () => this.deleteCreation(layer, btn.dataset.creationDelete);
    });
  }

  openCreationDetail(id) {
    const img = (this._creationsImages || []).find((i) => i.id === id);
    if (!img) return;
    const pv = new ExploreMediaView();
    openModal(pv.detailHtml(img, { hideShare: true, context: "forge" }), { wide: true });
    pv.wireDetailModal(img);
  }

  async toggleCreationShare(layer, id) {
    const img = (this._creationsImages || []).find((i) => i.id === id);
    if (!img) return;
    if (img.is_public) {
      try {
        const rec = await api(`/api/imagegen/standalone/${encodeURIComponent(id)}/unshare`, { method: "POST" });
        Object.assign(img, rec);
        this.renderMyCreationsGrid(layer);
        toast(t("forge_unshared_toast"));
      } catch (err) {
        errorToast(err.message || t("forge_couldnt_update_sharing"));
      }
      return;
    }
    this.openShareModal(layer, img);
  }

  openShareModal(layer, img) {
    const matureField = img.is_explicit
      ? `<p style="font-size:12.5px;color:var(--color-warn);margin:8px 0 14px">${t("forge_nsfw_share_notice")}</p>`
      : `<label style="display:flex;align-items:center;gap:8px;margin:8px 0 14px;font-size:13px;color:var(--color-ink);cursor:pointer"><input type="checkbox" id="shareMatureCheck"> ${t("forge_mark_as_mature_label")}</label>`;
    const shareLayer = openModal(`
      <h3>${t("forge_share_to_community_heading")}</h3>
      <p style="font-size:13px;color:var(--color-sec);margin:0">${t("forge_share_to_community_hint")}</p>
      ${matureField}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="shareCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("forge_cancel_button")}</button>
        <button type="button" class="pe-gen-btn" id="shareGo">${t("forge_share_word")}</button>
      </div>
    `);
    shareLayer.querySelector("#shareCancel").onclick = () => closeModal(shareLayer);
    shareLayer.querySelector("#shareGo").onclick = async () => {
      const matureCheck = shareLayer.querySelector("#shareMatureCheck");
      const is_explicit = matureCheck ? matureCheck.checked : false;
      try {
        const rec = await api(`/api/imagegen/standalone/${encodeURIComponent(img.id)}/share`, { method: "POST", body: JSON.stringify({ is_explicit }) });
        Object.assign(img, rec);
        closeModal(shareLayer);
        this.renderMyCreationsGrid(layer);
        toast(t("forge_shared_to_community_toast"));
      } catch (err) {
        errorToast(err.message || t("forge_couldnt_update_sharing"));
      }
    };
  }

  async deleteCreation(layer, id) {
    if (!await confirmDialog(t("forge_delete_image_confirm"))) return;
    try {
      await api(`/api/imagegen/standalone/${encodeURIComponent(id)}`, { method: "DELETE" });
      this._creationsImages = (this._creationsImages || []).filter((i) => i.id !== id);
      this.renderMyCreationsGrid(layer);
      toast(t("forge_deleted_toast"));
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_delete_image"));
    }
  }

  async toggleSavedShare() {
    if (!this.lastResult?.savedId) return;
    const id = this.lastResult.savedId;
    try {
      const rec = this.lastResult.isPublic
        ? await api(`/api/imagegen/standalone/${encodeURIComponent(id)}/unshare`, { method: "POST" })
        : await api(`/api/imagegen/standalone/${encodeURIComponent(id)}/share`, { method: "POST", body: JSON.stringify({ is_explicit: false }) });
      this.lastResult.isPublic = !!rec.is_public;
      this.render();
      toast(this.lastResult.isPublic ? t("forge_shared_to_community_toast") : t("forge_unshared_toast"));
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_update_sharing"));
    }
  }

  render() {
    window._activeForgeView = this;
    if (this.mode === "compile") {
      this.main.innerHTML = `
        <div class="content-col forge-content">
        ${pageHeaderHtml(t("forge_workshop_breadcrumb"), t("forge_generate_media_title"), t("ph_generate_title"), t("ph_generate_sub"))}
        ${this.modeArchRowHtml("")}
        ${this.compile.html()}
        </div>
      `;
      this.compile.wire();
      return;
    }
    this.main.innerHTML = `
      <div class="content-col forge-content">
      ${pageHeaderHtml(t("forge_workshop_breadcrumb"), t("forge_generate_media_title"), t("ph_generate_title"), t("ph_generate_sub"))}
      ${this.modeArchRowHtml(`<button type="button" class="filter-chip" onclick="_activeForgeView.openMyCreationsModal()">${t("forge_from_my_creations_label")}</button>`)}
      <div id="forgeCols" class="${this.mode === "upscale" ? "forge-no-options" : ""}">
        <div id="forgePreviewCol">
          ${this.previewBoxHtml()}
          ${this.maskBarHtml()}
          ${this.upscalePickerHtml()}
          ${this.generateBarHtml("inline")}
          <div id="forgeRecentInDesktop">${this.recentColumnHtml()}</div>
        </div>
        <div id="forgeOptionsCol">
          ${this.promptBlockHtml()}
          ${this.referenceImageSectionHtml()}
          ${this.durationFpsHtml()}
          ${this.aspectRowHtml()}
          ${this.modelPickerHtml()}
          ${this.loraSectionHtml()}
          ${this.advancedHtml()}
        </div>
        <div id="forgeRecentCol">${this.recentColumnHtml()}</div>
      </div>
      <div style="height:96px"></div>
      ${this.generateBarHtml("sticky")}
      </div>
    `;
    const posEl = this.main.querySelector("#forgePositive");
    if (posEl) posEl.oninput = () => { this.positive = posEl.value; };
    const negEl = this.main.querySelector("#forgeNegative");
    if (negEl) negEl.oninput = () => { this.negative = negEl.value; };
    const denoiseEl = this.main.querySelector("#forgeDenoise");
    if (denoiseEl) denoiseEl.oninput = () => { this.denoise = +denoiseEl.value; };
    const refThumbImg = this.main.querySelector("#forgeRefThumbImg");
    if (refThumbImg) _wireZoomPan(refThumbImg);
    const resultImg = this.main.querySelector("#forgeResultImg");
    if (resultImg) _wireZoomPan(resultImg);
    const refFile = this.main.querySelector("#forgeRefFile");
    if (refFile) refFile.onchange = () => {
      const file = refFile.files[0];
      refFile.value = "";
      if (file) this.onReferenceFile(file);
    };
    this.setupMaskCanvas();
  }
}
