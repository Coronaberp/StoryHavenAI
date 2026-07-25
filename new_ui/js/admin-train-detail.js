"use strict";

Object.assign(AdminTrainView.prototype, {
  openJobDetail(jobId) {
    this.detailJobId = jobId;
    const job = this.jobs.find((j) => j.id === jobId);
    const running = job && ["queued", "provisioning", "training", "saving"].includes(job.status);
    this.detailScreen = running ? "progress" : (job?.output_file ? "test" : "progress");
    if (this.detailScreen === "test") this.selectTestEntryForJob(job);
    this.screen = "detail";
    this.render();
  },

  detailScreenHtml() {
    const job = this.jobs.find((j) => j.id === this.detailJobId);
    if (!job) return `<p class="text-sm text-muted">${t("admin_train_no_active_job")}</p>`;
    const hasOutput = !!job.output_file;
    return `
      <div class="lora-detail-header">
        <div class="lora-detail-name">${_esc(job.name)}</div>
        ${this.jobStatusPill(job.status)}
      </div>
      <div class="lora-segmented">
        <button type="button" id="lt_detail_seg_progress" class="lora-segmented-btn ${this.detailScreen === "progress" ? "on" : ""}">${t("admin_train_tab_progress")}</button>
        <button type="button" id="lt_detail_seg_test" class="lora-segmented-btn ${this.detailScreen === "test" ? "on" : ""}" ${hasOutput ? "" : "disabled"}>${t("admin_train_tab_test")}</button>
      </div>
      ${this.detailScreen === "progress" ? this.progressPanelHtml() : this.testPanelHtml()}
    `;
  },

  wireDetailScreen() {
    const progressSeg = document.getElementById("lt_detail_seg_progress");
    if (progressSeg) progressSeg.onclick = () => { this.detailScreen = "progress"; this.render(); };
    const testSeg = document.getElementById("lt_detail_seg_test");
    if (testSeg) testSeg.onclick = () => {
      if (testSeg.disabled) return;
      const job = this.jobs.find((j) => j.id === this.detailJobId);
      this.selectTestEntryForJob(job);
      this.detailScreen = "test";
      this.render();
    };
    if (this.detailScreen === "progress") this.bindWatcherRefs(this.detailJobId);
    if (this.detailScreen === "test") this.wireTestPanel();
  },

  progressPanelHtml() {
    return `
      <div id="lt_cost_banner" class="lora-cost-banner-live" style="display:none"></div>
      <div id="lt_status_hero" class="lora-status-hero"></div>
      <div id="lt_metric_cards"></div>
      <div id="lt_upload_wrap" style="display:none">
        <div class="lora-transfer-label">${t("admin_train_column_uploading")}</div>
        <div id="lt_upload_cards"></div>
      </div>
      <div id="lt_download_wrap" style="display:none">
        <div class="lora-transfer-label">${t("admin_train_column_downloading")}</div>
        <div id="lt_download_cards"></div>
      </div>
      <div style="height:180px;margin:14px 0"><canvas id="lt_loss_chart"></canvas></div>
      <div id="lt_log" class="lora-log-box"></div>
      <button type="button" id="lt_checkpoint_now" class="lora-btn lora-btn-ghost" style="flex:1;width:100%">${t("admin_train_request_checkpoint_now")}</button>
      <div class="lora-field-hint" style="text-align:center;margin-top:6px">${t("admin_train_request_checkpoint_hint")}</div>
    `;
  },

  samplerPickerItems() {
    return this.samplers.map((name) => {
      const p = this.samplerPreviews[name];
      return { name, label: p?.display_name || name, sublabel: null, image: p?.image || null, category: null };
    });
  },

  schedulerPickerItems() {
    return this.schedulers.map((name) => {
      const p = this.schedulerPreviews[name];
      return { name, label: p?.display_name || name, sublabel: null, image: p?.image || null, category: null };
    });
  },

  testPanelHtml() {
    if (!this.testEntry) return `<p class="text-sm text-muted">${t("admin_train_pick_lora_to_test")}</p>`;
    const e = this.testEntry;
    const notFound = !this.checkpoints.includes(e.job.base_checkpoint);
    return `
      <div class="mb-4 text-sm">
        <b class="text-ink">${_esc(e.label)}</b><br>
        <span class="text-xs text-muted">${t("admin_train_trigger_word_label")}: <b>${_esc(e.job.trigger_word || "-")}</b> &middot; ${t("admin_train_base_label")}: ${_esc(e.job.base_checkpoint || "-")}</span>
        ${notFound ? `<div class="text-xs mt-1" style="color:var(--color-warn)">${t("admin_train_base_checkpoint_not_found")}</div>` : ""}
      </div>
      <div class="mb-4">
        <label class="lora-field-label">${t("admin_train_strength")}</label>
        <input type="range" id="tl_strength" min="-8" max="8" step="0.05" value="${this.testStrength}" style="width:100%">
        <span id="tl_strength_val" class="text-xs font-mono text-accent">${this.testStrength.toFixed(2)}</span>
      </div>
      <div class="lora-field-label">${t("admin_train_sampler")}</div>
      <button type="button" id="lt_sampler_picker_btn" class="lora-picker-btn" style="margin-bottom:12px">
        ${this._pickerThumbFor(this.testSampler, this.samplerPreviews)}
        <span style="flex:1;min-width:0"><span class="lora-picker-btn-name">${_esc(this.samplerPreviews[this.testSampler]?.display_name || this.testSampler || t("admin_train_default"))}</span></span>
        <span class="lora-picker-chev">&rsaquo;</span>
      </button>
      <div class="lora-field-label">${t("admin_train_scheduler")}</div>
      <button type="button" id="lt_scheduler_picker_btn" class="lora-picker-btn" style="margin-bottom:12px">
        ${this._pickerThumbFor(this.testScheduler, this.schedulerPreviews)}
        <span style="flex:1;min-width:0"><span class="lora-picker-btn-name">${_esc(this.schedulerPreviews[this.testScheduler]?.display_name || this.testScheduler || t("admin_train_default"))}</span></span>
        <span class="lora-picker-chev">&rsaquo;</span>
      </button>
      <div class="mb-4">
        <label class="lora-field-label">${t("admin_train_steps")}</label>
        <input type="range" id="tl_steps" min="1" max="60" step="1" value="${this.testSteps}" style="width:100%">
        <span id="tl_steps_val" class="text-xs font-mono text-accent">${this.testSteps}</span>
      </div>
      <div class="mb-4">
        <label class="lora-field-label">${t("admin_train_guidance_cfg")}</label>
        <input type="range" id="tl_cfg" min="1" max="20" step="0.5" value="${this.testCfg}" style="width:100%">
        <span id="tl_cfg_val" class="text-xs font-mono text-accent">${this.testCfg.toFixed(1)}</span>
      </div>
      <div class="relative w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center">
        <img id="tl_preview_img" alt="" class="w-full h-full object-cover${this.testResult ? " cursor-zoom-in" : ""}" style="display:${this.testResult ? "" : "none"}" src="${this.testResult ? _attr(this.testResult) : ""}">
        <span id="tl_preview_empty" class="text-xs text-muted" style="display:${this.testResult ? "none" : ""}">${t("admin_train_preview_will_appear_here")}</span>
        ${this.testResult ? `
          <div class="absolute right-2.5 bottom-2.5 flex gap-2">
            <button type="button" id="tl_save" class="forge-img-act" title="${t("admin_train_save")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg></button>
            <button type="button" id="tl_upscale" class="forge-img-act" title="${t("admin_train_upscale")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></button>
            <button type="button" id="tl_discard" class="forge-img-act" title="${t("admin_train_discard")}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
          </div>
        ` : ""}
      </div>
      ${this.testUpscalePickerOpen ? this.testUpscalePickerHtml() : ""}
      <button type="button" id="tl_go" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark" ${notFound ? "disabled" : ""}>${t("admin_train_generate")}</button>
    `;
  },

  _pickerThumbFor(name, previewMap) {
    const p = previewMap[name];
    const style = "width:34px;height:34px;border-radius:8px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)";
    return p?.image
      ? `<span style="${style}"><img src="${_attr(p.image)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
      : `<span style="${style};font-family:var(--font-mono);font-size:13px;color:var(--color-muted)">${_esc((name || "?")[0].toUpperCase())}</span>`;
  },

  wireTestPanel() {
    if (!this.testEntry) return;
    const strengthInp = document.getElementById("tl_strength");
    if (strengthInp) strengthInp.oninput = (e) => {
      this.testStrength = parseFloat(e.target.value);
      document.getElementById("tl_strength_val").textContent = this.testStrength.toFixed(2);
    };
    const samplerBtn = document.getElementById("lt_sampler_picker_btn");
    if (samplerBtn) samplerBtn.onclick = () => openPickerSheet({
      title: t("admin_train_choose_a") + " " + t("admin_train_sampler_lowercase"),
      items: this.samplerPickerItems(),
      selected: this.testSampler,
      categories: null,
      onPick: (name) => { this.testSampler = name; this.render(); },
    });
    const schedulerBtn = document.getElementById("lt_scheduler_picker_btn");
    if (schedulerBtn) schedulerBtn.onclick = () => openPickerSheet({
      title: t("admin_train_choose_a") + " " + t("admin_train_scheduler_lowercase"),
      items: this.schedulerPickerItems(),
      selected: this.testScheduler,
      categories: null,
      onPick: (name) => { this.testScheduler = name; this.render(); },
    });
    const stepsInp = document.getElementById("tl_steps");
    if (stepsInp) stepsInp.oninput = (e) => {
      this.testSteps = parseInt(e.target.value, 10);
      document.getElementById("tl_steps_val").textContent = this.testSteps;
    };
    const cfgInp = document.getElementById("tl_cfg");
    if (cfgInp) cfgInp.oninput = (e) => {
      this.testCfg = parseFloat(e.target.value);
      document.getElementById("tl_cfg_val").textContent = this.testCfg.toFixed(1);
    };
    const goBtn = document.getElementById("tl_go");
    if (goBtn) goBtn.onclick = () => this.runTestGenerate();
    const saveBtn = document.getElementById("tl_save");
    if (saveBtn) saveBtn.onclick = () => this.saveTestResult();
    const upscaleBtn = document.getElementById("tl_upscale");
    if (upscaleBtn) upscaleBtn.onclick = () => this.openTestUpscale();
    const discardBtn = document.getElementById("tl_discard");
    if (discardBtn) discardBtn.onclick = () => this.discardTestResult();
    const zoomImg = document.getElementById("tl_preview_img");
    if (zoomImg && this.testResult) zoomImg.onclick = () => this.zoomTestResult();
    document.querySelectorAll("[data-tl-upscaler]").forEach((b) => b.onclick = () => this.runTestUpscale(b.dataset.tlUpscaler));
  },
});

if (typeof window !== "undefined") {
  window.AdminTrainView = AdminTrainView;
}
