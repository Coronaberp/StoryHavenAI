"use strict";

class AdminTrainView {
  async mount(main) {
    if (AdminTrainView._activeWatcher) {
      AdminTrainView._activeWatcher.stop();
      AdminTrainView._activeWatcher = null;
    }
    this.main = main;
    this.screen = "jobs";
    this.checkpoints = [];
    this.checkpointPreviews = {};
    this.animaNames = new Set();
    this.jobs = [];
    this.watcher = new TrainingJobWatcher();
    AdminTrainView._activeWatcher = this.watcher;
    this.form = {
      name: "", trigger_word: "sks", checkpoint: "",
      resolution: 512, batch_size: 1, rank: 16, alpha: 16,
      learning_rate: 0.0001, steps: 1000,
      noise_offset: 0, network_dropout: 0,
      advancedOpen: false,
    };
    this.trainImages = [];
    this.trainCaptions = [];
    this.testEntry = null;
    this.testStrength = 1.0;
    this.testSampler = "";
    this.testScheduler = "";
    this.testSteps = 20;
    this.testCfg = 7.0;
    this.testAspect = "1:1";
    this.testPositive = "masterpiece, best quality, absurdres, newest, smooth colors, depth of field, blurry background, scenery, anime coloring, anime screencap, detailed lighting, framevault, movie still, light particles, dynamic pose, 1girl, (dynamic angle:1.5), slender, (skinny:1.5), perky breasts,  small breasts, asian, petite, tomboy, short hair, messy hair, yellow eyes, red hair, pixie cut, pantyhose, black miniskirt, boots, black hoodie, hood down, headphones around neck, holding phone, looking to the side, looking at object, looking down, bored, half-closed eyes, standing, smartphone, disdain, closed mouth, angry, mall, people, crowded, shopping, shopping mall, stairs, bush, bench, fountain, indoors, ceiling light, modern, neon lights, day, yellow lights, perspective, upper body, (arknights:0.6), hand on own hip,  (4 fingers:1.2)";
    this.testNegative = "worst quality, bad quality, worst detail, sketch, censor, censored, extra fingers, hair bun,  see-through clothes, symmetry, red skin, english text, lipstick, shiny clothes, kid, child, loli, aged down, blush, 3d, realistic,";
    this.testResult = null;
    this.testAbort = null;
    this.testLastGenBody = null;
    this.testUpscalePickerOpen = false;
    this.testUpscalers = [];
    this.testUpscalerPreviews = {};
    this.render();
    await this.loadCheckpoints();
    await this.loadJobs();
    this.attachRunningWatcherIfAny();
  }

  async loadCheckpoints() {
    const [checkpoints, animaUnets, previews, samplerData, samplerPreviews, schedulerPreviews] = await Promise.all([
      api("/api/imagegen/checkpoints").catch(() => []),
      api("/api/imagegen/anima-unets").catch(() => []),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
      api("/api/imagegen/sampler-previews").catch(() => ({})),
      api("/api/imagegen/scheduler-previews").catch(() => ({})),
    ]);
    this.checkpoints = [...checkpoints, ...animaUnets];
    this.animaNames = new Set(animaUnets);
    this.checkpointPreviews = previews;
    this.samplers = samplerData.samplers || [];
    this.schedulers = samplerData.schedulers || [];
    this.samplerPreviews = samplerPreviews;
    this.schedulerPreviews = schedulerPreviews;
    this.testSampler = this.samplers.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (this.samplers.includes("euler") ? "euler" : (this.samplers[0] || ""));
    this.testScheduler = this.schedulers.includes("karras") ? "karras" : (this.schedulers.includes("normal") ? "normal" : (this.schedulers[0] || ""));
    this.render();
  }

  async loadJobs() {
    this.jobs = await api("/api/admin/lora-training/jobs").catch(() => []);
    this.render();
  }

  attachRunningWatcherIfAny() {
    const active = this.jobs.find((j) => ["queued", "provisioning", "training", "saving"].includes(j.status));
    if (active) this.watchJob(active.id);
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_train_title"), t("ph_admin_train_sub"))}
      ${adminScreenSwitcherHtml("admin-train", window._adminSwitcherBadges || {})}
      ${this.screen === "jobs" ? this.jobsScreenHtml() : ""}
      ${this.screen === "wizard" ? this.wizardScreenHtml() : ""}
      ${this.screen === "detail" ? this.detailScreenHtml() : ""}
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    this.wireScreen();
  }

  wireScreen() {
    if (this.screen === "jobs") this.wireJobsScreen();
    if (this.screen === "wizard") this.wireWizardStep();
    if (this.screen === "detail") this.wireDetailScreen();
  }

  goToJobs() {
    this.screen = "jobs";
    this.render();
  }

  wireTrainTab() {
    [["lt_name", "name"], ["lt_trigger", "trigger_word"], ["lt_res", "resolution"], ["lt_batch", "batch_size"],
     ["lt_rank", "rank"], ["lt_alpha", "alpha"], ["lt_lr", "learning_rate"], ["lt_steps", "steps"],
     ["lt_noise_offset", "noise_offset"], ["lt_network_dropout", "network_dropout"]]
      .forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.oninput = (e) => { this.form[key] = e.target.value; this.updateTimeEstimate(); };
      });
    const startBtn = document.getElementById("lt_start");
    if (startBtn) startBtn.onclick = () => this.submitTraining();
    const imagesSection = document.getElementById("lt_images_section");
    if (imagesSection) imagesSection.innerHTML = this.imagesGridHtml();
    document.querySelectorAll("[data-img-tile]").forEach((b) => b.onclick = () => this.openImageCaptionModal(parseInt(b.dataset.imgTile, 10)));
    const imagesInput = document.getElementById("lt_images_input");
    if (imagesInput) imagesInput.onchange = () => {
      const newFiles = [...imagesInput.files];
      this.trainImages.push(...newFiles);
      newFiles.forEach(() => this.trainCaptions.push(""));
      this.render();
    };
    const clearBtn = document.getElementById("lt_images_clear");
    if (clearBtn) clearBtn.onclick = () => {
      this.trainImages = [];
      this.trainCaptions = [];
      this.render();
    };
    const captionsInput = document.getElementById("lt_captions_input");
    if (captionsInput) captionsInput.onchange = async () => {
      const txtFiles = [...captionsInput.files];
      if (!txtFiles.length) return;
      const stem = (n) => n.replace(/\.[^.]+$/, "");
      const byStem = new Map(txtFiles.map((f) => [stem(f.name), f]));
      let matched = 0;
      for (let i = 0; i < this.trainImages.length; i++) {
        const match = byStem.get(stem(this.trainImages[i].name));
        if (!match) continue;
        this.trainCaptions[i] = (await match.text()).trim();
        matched++;
      }
      captionsInput.value = "";
      this.render();
      toast(matched ? `${t("admin_train_imported_captions_prefix")} ${matched} ${t("admin_train_imported_captions_suffix")}` : t("admin_train_no_txt_filenames_matched"));
    };
    this.updateTimeEstimate();
  }

  imagesGridHtml() {
    const files = this.trainImages;
    return `
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_training_images")}</label>
        <div class="flex items-center gap-2 mb-2">
          <label class="px-3 py-1.5 rounded-md border border-line text-xs text-ink cursor-pointer">
            ${t("admin_train_add_images")}
            <input type="file" id="lt_images_input" accept="image/png,image/jpeg,image/webp" multiple class="hidden">
          </label>
          <label class="px-3 py-1.5 rounded-md border border-line text-xs text-ink cursor-pointer">
            ${t("admin_train_import_captions")}
            <input type="file" id="lt_captions_input" accept=".txt" multiple class="hidden">
          </label>
          <button type="button" id="lt_images_clear" class="px-3 py-1.5 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_train_remove_all")}</button>
        </div>
        <span class="text-xs text-muted">${files.length ? `${files.length} ${files.length === 1 ? t("admin_train_image_selected_singular") : t("admin_train_images_selected_plural")}` : ""}</span>
        <div class="grid gap-2 mt-2" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">
          ${files.map((f, i) => this.imageTileHtml(f, i)).join("")}
        </div>
        <div class="text-xs text-muted mt-2 leading-relaxed">
          ${t("admin_train_images_help_text")}
        </div>
      </div>
    `;
  }

  imageTileHtml(file, i) {
    if (!this._imageUrls) this._imageUrls = new Map();
    if (!this._imageUrls.has(file)) this._imageUrls.set(file, URL.createObjectURL(file));
    const url = this._imageUrls.get(file);
    const hasCaption = !!(this.trainCaptions[i] || "").trim();
    return `
      <button type="button" data-img-tile="${i}" style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;border:1px solid var(--color-line);cursor:pointer;padding:0">
        <img src="${_attr(url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
        ${hasCaption ? `<span style="position:absolute;top:3px;left:3px;width:8px;height:8px;border-radius:50%;background:var(--color-accent)"></span>` : ""}
      </button>
    `;
  }

  openImageCaptionModal(i) {
    const url = this._imageUrls.get(this.trainImages[i]);
    openModal(`
      <img src="${_attr(url)}" alt="" class="w-full rounded-lg mb-3">
      <div class="mb-3">
        <label class="text-xs text-sec block mb-1">${t("admin_train_caption_tags_for_image")}</label>
        <input type="text" id="ic_caption" value="${_attr(this.trainCaptions[i] || "")}" placeholder="${t("admin_train_caption_tags_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <button type="button" id="ic_remove" class="w-full py-2 rounded-md border text-sm" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_train_remove_image")}</button>
    `, { onClose: () => this.render() });
    document.getElementById("ic_caption").oninput = (e) => { this.trainCaptions[i] = e.target.value; };
    document.getElementById("ic_remove").onclick = () => {
      this.trainImages.splice(i, 1);
      this.trainCaptions.splice(i, 1);
      closeTopModal();
    };
  }

  progressTabHtml() {
    return `
      <div id="lt_idle" class="text-sm text-muted" style="${this.watcher.isWatching ? "display:none" : ""}">${t("admin_train_no_active_job")}</div>
      <div id="lt_live" style="${this.watcher.isWatching ? "" : "display:none"}">
        <div id="lt_cost_banner" class="mb-3 px-3 py-2 rounded-md border border-line font-mono text-sm" style="display:none"></div>
        <div id="lt_status_label" class="text-sm text-muted mb-2">${t("admin_train_status_label_prefix")}: -</div>
        <div class="h-2 rounded-full bg-surface-2 overflow-hidden mb-4">
          <div id="lt_progress_bar" class="h-full bg-accent" style="width:0%"></div>
        </div>
        <div id="lt_log" class="font-mono text-xs whitespace-pre-wrap border border-line rounded-md p-2 bg-surface-2 mb-4" style="max-height:260px;overflow-y:auto"></div>
        <div id="lt_upload_wrap" class="mb-4 overflow-x-auto" style="display:none">
          <table class="w-full text-xs font-mono"><thead><tr class="text-muted text-left"><th class="pr-2">${t("admin_train_column_uploading")}</th><th class="px-2">${t("admin_train_column_received")}</th><th class="px-2">${t("admin_train_column_progress")}</th><th class="pl-2">${t("admin_train_column_speed")}</th></tr></thead><tbody id="lt_upload_table"></tbody></table>
        </div>
        <div id="lt_download_wrap" class="mb-4 overflow-x-auto" style="display:none">
          <table class="w-full text-xs font-mono"><thead><tr class="text-muted text-left"><th class="pr-2">${t("admin_train_column_downloading")}</th><th class="px-2">${t("admin_train_column_received")}</th><th class="px-2">${t("admin_train_column_progress")}</th><th class="pl-2">${t("admin_train_column_speed")}</th></tr></thead><tbody id="lt_download_table"></tbody></table>
        </div>
        <div id="lt_metrics_wrap">
          <div class="mb-4 overflow-x-auto">
            <table class="w-full text-xs font-mono"><thead><tr class="text-muted text-left"><th class="pr-2">${t("admin_train_column_epoch")}</th><th class="px-2">${t("admin_train_column_step")}</th><th class="px-2">${t("admin_train_column_loss")}</th><th class="px-2">${t("admin_train_column_lr")}</th><th class="px-2">${t("admin_train_column_speed")}</th><th class="px-2">${t("admin_train_column_eta")}</th><th class="pl-2">${t("admin_train_column_gpu")}</th></tr></thead><tbody id="lt_metrics_table"></tbody></table>
          </div>
          <div style="height:180px"><canvas id="lt_loss_chart"></canvas></div>
        </div>
        <div id="lt_finalizing" class="text-sm text-ink mb-4" style="display:none">${t("admin_train_finalizing")}</div>
        <div id="lt_done_tile" class="text-center py-6 rounded-md border border-line mb-4" style="display:none">
          <div class="text-2xl mb-1">✓</div><div class="font-semibold text-ink">${t("admin_train_done")}</div>
        </div>
        <button type="button" id="lt_checkpoint_now" class="w-full py-2 rounded-md border border-line text-sm text-ink">${t("admin_train_request_checkpoint_now")}</button>
        <div class="text-xs text-muted mt-1">${t("admin_train_request_checkpoint_hint")}</div>
      </div>
    `;
  }
  testUpscalePickerHtml() {
    if (!this.testUpscalers.length) {
      return `<div class="mb-4"><p class="text-xs text-sec">${t("admin_train_no_upscalers_available")}</p></div>`;
    }
    return `
      <div class="mb-4 p-3.5 rounded-xl border border-line bg-surface">
        <label class="grimoire-field-label">${t("admin_train_choose_upscaler")}</label>
        <div class="flex gap-2 overflow-x-auto">
          ${this.testUpscalers.map((u) => {
            const p = this.testUpscalerPreviews[u];
            const art = p?.image ? `background-image:url('${_attr(p.image)}')` : "background:var(--color-surface-2)";
            const label = p?.display_name || u;
            return `
              <button type="button" data-tl-upscaler="${_attr(u)}" style="flex:none;width:78px;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
                <span class="sanctum-specimen" style="width:64px;height:64px;border-radius:12px;${art}">${p?.image ? "" : _esc(label[0].toUpperCase())}</span>
                <span style="font-size:10.5px;text-align:center;color:var(--color-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${_esc(label)}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  async runTestGenerate() {
    const e = this.testEntry;
    if (!e || !this.checkpoints.includes(e.job.base_checkpoint)) return;
    const goBtn = document.getElementById("tl_go");
    this.testAbort = new AbortController();
    goBtn.textContent = t("admin_train_stop");
    goBtn.onclick = () => this.stopTestGenerate();
    const anima = this.animaNames.has(e.job.base_checkpoint);
    const [width, height] = FORGE_ASPECTS[this.testAspect] || [1024, 1024];
    const body = {
      positive: `${e.job.trigger_word || ""}, masterpiece, best quality, absurdres`,
      negative: "worst quality, bad quality, worst detail",
      checkpoint: e.job.base_checkpoint, architecture: anima ? "anima" : "sdxl",
      loras: [{ name: e.filename, strength: this.testStrength }],
      width, height,
      sampler: anima ? ANIMA_DEFAULT_SAMPLER : this.testSampler,
      scheduler: anima ? ANIMA_DEFAULT_SCHEDULER : this.testScheduler,
      steps: this.testSteps, cfg: anima ? ANIMA_DEFAULT_CFG : this.testCfg,
    };
    let renderedFinal = false;
    try {
      const res = await fetch(`${API}/api/imagegen/standalone/stream`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: this.testAbort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (ev.type === "preview") {
          this.testResult = ev.image;
          const img = document.getElementById("tl_preview_img");
          const empty = document.getElementById("tl_preview_empty");
          if (img) { img.src = ev.image; img.style.display = ""; }
          if (empty) empty.style.display = "none";
        }
        if (ev.type === "done") {
          this.testResult = ev.image;
          this.testLastGenBody = body;
          this.testUpscalePickerOpen = false;
          renderedFinal = true;
          this.render();
        }
        if (ev.type === "error") errorToast(ev.message || t("admin_train_test_generation_failed"));
      });
    } catch (err) {
      if (err.name !== "AbortError") errorToast(err.message || t("admin_train_test_generation_failed"));
    }
    this.testAbort = null;
    if (!renderedFinal) {
      const staleGoBtn = document.getElementById("tl_go");
      if (staleGoBtn) { staleGoBtn.textContent = t("admin_train_generate"); staleGoBtn.onclick = () => this.runTestGenerate(); }
    } else {
      const freshGoBtn = document.getElementById("tl_go");
      if (freshGoBtn) freshGoBtn.onclick = () => this.runTestGenerate();
    }
  }

  stopTestGenerate() {
    if (this.testAbort) { try { this.testAbort.abort(); } catch (err) {} this.testAbort = null; }
    fetch(`${API}/api/imagegen/standalone/stream/stop`, { method: "POST", credentials: "include" }).catch(() => {});
    const goBtn = document.getElementById("tl_go");
    if (goBtn) { goBtn.textContent = t("admin_train_generate"); goBtn.onclick = () => this.runTestGenerate(); }
  }

  async saveTestResult() {
    if (!this.testResult || !this.testLastGenBody) return;
    const b = this.testLastGenBody;
    try {
      await api("/api/imagegen/standalone/save", {
        method: "POST",
        body: JSON.stringify({
          image: this.testResult,
          positive: b.positive || "", negative: b.negative || "",
          checkpoint: b.checkpoint || "", loras: b.loras || [],
          sampler: b.sampler || "", scheduler: b.scheduler || "",
          steps: b.steps || 20, is_img2img: false, cfg: b.cfg || 7.0,
          upscaler: "",
        }),
      });
      toast(t("admin_train_saved_to_gallery"));
    } catch (err) {
      errorToast(err.message || t("admin_train_couldnt_save_image"));
    }
  }

  async openTestUpscale() {
    if (!this.testResult) return;
    if (!this.testUpscalers.length) {
      const [upscalers, previews] = await Promise.all([
        api("/api/imagegen/upscalers").catch(() => []),
        api("/api/imagegen/upscaler-previews").catch(() => ({})),
      ]);
      this.testUpscalers = upscalers;
      this.testUpscalerPreviews = previews;
    }
    this.testUpscalePickerOpen = true;
    this.render();
  }

  async runTestUpscale(upscalerName) {
    if (!this.testResult) return;
    this.testUpscalePickerOpen = false;
    try {
      const res = await api("/api/imagegen/upscale", {
        method: "POST",
        body: JSON.stringify({ image: this.testResult, upscaler: upscalerName }),
      });
      this.testResult = res.image;
      toast(t("admin_train_upscaled"));
    } catch (err) {
      errorToast(err.message || t("admin_train_upscale_failed"));
    }
    this.render();
  }

  discardTestResult() {
    this.testResult = null;
    this.testLastGenBody = null;
    this.testUpscalePickerOpen = false;
    this.render();
  }

  zoomTestResult() {
    if (!this.testResult) return;
    openModal(`<img src="${_attr(this.testResult)}" alt="" class="w-full rounded-lg">`, { wide: true });
  }

  async loadJobEntries() {
    const testableJobs = this.jobs.filter((j) => j.output_file);
    const ckptLists = await Promise.all(testableJobs.map((j) =>
      api(`/api/admin/lora-training/jobs/${encodeURIComponent(j.id)}/checkpoints`).catch(() => [])));
    const entries = [];
    testableJobs.forEach((j, i) => {
      entries.push({ job: j, filename: j.output_file, label: `${j.name} - latest (${j.status})` });
      ckptLists[i].forEach((c) => {
        const m = /_(\d{8}T\d{6}Z)\.safetensors$/.exec(c.filename);
        entries.push({ job: j, filename: c.filename, label: `${j.name} - checkpoint ${m ? m[1] : c.filename}` });
      });
    });
    return entries;
  }

  async selectTestEntryForJob(job) {
    if (!job) return;
    const entries = await this.loadJobEntries();
    this.testEntry = entries.find((e) => e.job.id === job.id) || null;
  }

  jobStatusPill(status) {
    const map = {
      queued: { key: "pill-queued", text: t("admin_train_status_queued", "Queued") },
      provisioning: { key: "pill-running", text: t("admin_train_status_provisioning", "Provisioning") },
      training: { key: "pill-running", text: t("admin_train_status_training", "Training") },
      saving: { key: "pill-running", text: t("admin_train_status_saving", "Saving") },
      done: { key: "pill-done", text: t("admin_train_status_done", "Done") },
      failed: { key: "pill-error", text: t("admin_train_status_failed", "Failed") },
    };
    const entry = map[status] || { key: "pill-queued", text: _esc(status) };
    return `<span class="lora-job-pill lora-${entry.key}">${entry.text}</span>`;
  }

  jobCardHtml(job) {
    const running = ["queued", "provisioning", "training", "saving"].includes(job.status);
    const lastMetric = (job.metrics || [])[job.metrics.length - 1];
    const stepLine = running && lastMetric
      ? `${t("admin_train_column_epoch")} ${lastMetric.epoch ?? 0}/${lastMetric.total_epochs || "?"} · ${t("admin_train_column_step")} ${lastMetric.step || 0}/${job.steps || "?"}`
      : (job.error ? _esc(job.error) : "");
    return `
      <button type="button" data-open-job="${_attr(job.id)}" class="lora-job-card">
        <div class="lora-job-card-top">
          <div style="min-width:0">
            <div class="lora-job-name">${_esc(job.name)}</div>
            <div class="lora-job-sub">${job.resume_from_lora ? `${t("admin_train_resumed_from")} ${_esc(job.resume_from_lora)}` : (job.architecture || "")}</div>
          </div>
          ${this.jobStatusPill(job.status)}
        </div>
        ${running ? `
          <div class="lora-bar-track"><div class="lora-bar-fill" style="width:${Math.round((job.progress || 0) * 100)}%"></div></div>
        ` : ""}
        ${stepLine ? `<div class="lora-job-meta-row"><span>${stepLine}</span></div>` : ""}
      </button>
    `;
  }

  jobsScreenHtml() {
    return `
      <div class="lora-jobs-grid">
        ${this.jobs.length ? this.jobs.map((j) => this.jobCardHtml(j)).join("") : `<p class="text-sm text-muted">${t("admin_train_no_jobs_yet")}</p>`}
      </div>
      <button type="button" id="lt_new_job_fab" class="lora-fab" aria-label="${t("admin_train_new_job", "New training job")}">+</button>
    `;
  }

  wireJobsScreen() {
    this.main.querySelectorAll("[data-open-job]").forEach((b) => b.onclick = () => this.openJobDetail(b.dataset.openJob));
    const fab = document.getElementById("lt_new_job_fab");
    if (fab) fab.onclick = () => this.openNewJobWizard();
  }

  estimateTrainingRun(architecture, steps, batchSize) {
    const speeds = [];
    (this.jobs || []).forEach((j) => {
      if (j.architecture !== architecture) return;
      (j.metrics || []).forEach((m) => { if (m.speed_img_s > 0) speeds.push(m.speed_img_s); });
    });
    const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : (architecture === "anima" ? 0.35 : 0.8);
    const trainSeconds = (steps * batchSize) / avgSpeed;
    const totalSeconds = trainSeconds + 5 * 60;
    const totalHours = totalSeconds / 3600;
    return { seconds: totalSeconds, cost: totalHours * 0.80, fromHistory: speeds.length > 0 };
  }

  formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  updateTimeEstimate() {
    const pill = document.getElementById("lt_time_est");
    if (!pill) return;
    const f = this.form;
    const steps = Number(f.steps), batch = Number(f.batch_size);
    if (!f.checkpoint || !steps || !batch || steps <= 0 || batch <= 0) { pill.textContent = ""; return; }
    const architecture = this.animaNames.has(f.checkpoint) ? "anima" : "sdxl";
    const est = this.estimateTrainingRun(architecture, steps, batch);
    const imageCount = this.trainImages.length;
    const seenTxt = imageCount ? ` · sees each image ~${Math.round((steps * batch) / imageCount)}×` : "";
    pill.textContent = `~${this.formatDuration(est.seconds)} · ~$${est.cost.toFixed(2)} est.${est.fromHistory ? "" : " (rough)"}${seenTxt}`;
  }

  async submitTraining() {
    const errors = this.validateTrainForm();
    if (errors.length) { errorToast(errors[0]); return; }
    if (!(await confirmDialog(t("admin_train_confirm_start_training"), { confirmLabel: t("admin_train_confirm_label_start_training") }))) return;
    const f = this.form;
    const fd = new FormData();
    fd.append("name", f.name.trim());
    fd.append("trigger_word", f.trigger_word.trim());
    fd.append("local_checkpoint", f.checkpoint);
    fd.append("architecture", this.animaNames.has(f.checkpoint) ? "anima" : "sdxl");
    fd.append("resolution", String(f.resolution));
    fd.append("rank", String(f.rank));
    fd.append("alpha", String(f.alpha));
    fd.append("learning_rate", String(f.learning_rate));
    fd.append("steps", String(f.steps));
    fd.append("batch_size", String(f.batch_size));
    fd.append("noise_offset", String(f.noise_offset || 0));
    fd.append("network_dropout", String(f.network_dropout || 0));
    fd.append("captions", JSON.stringify(this.trainImages.map((_, i) => this.trainCaptions[i] || "")));
    this.trainImages.forEach((file) => fd.append("images", file, file.name));

    const continueBtn = document.getElementById("lt_wizard_continue");
    if (continueBtn) { continueBtn.disabled = true; continueBtn.textContent = t("admin_train_starting"); }
    try {
      const resp = await api("/api/admin/lora-training/jobs", { method: "POST", body: fd });
      this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
      this.openJobDetail(resp.job_id);
      this.watchJob(resp.job_id);
    } catch (err) {
      errorToast(err.message || t("admin_train_training_request_failed"));
      if (continueBtn) { continueBtn.disabled = false; continueBtn.textContent = t("admin_train_start_training"); }
    }
  }

  watchJob(jobId) {
    this.bindWatcherRefs(jobId);
  }

  bindWatcherRefs(jobId) {
    const refs = {
      statusHero: document.getElementById("lt_status_hero"), logEl: document.getElementById("lt_log"),
      costBanner: document.getElementById("lt_cost_banner"), metricCards: document.getElementById("lt_metric_cards"),
      chart: document.getElementById("lt_loss_chart"), uploadWrap: document.getElementById("lt_upload_wrap"),
      uploadCards: document.getElementById("lt_upload_cards"), downloadWrap: document.getElementById("lt_download_wrap"),
      downloadCards: document.getElementById("lt_download_cards"),
    };
    if (this.watcher.isWatching && this.watcher.jobId === jobId) {
      this.watcher.rebind(refs);
    } else {
      this.watcher.watch(jobId, refs, async (job) => {
        this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
        if (this.detailJobId === jobId) this.render();
      });
    }
    const checkpointBtn = document.getElementById("lt_checkpoint_now");
    if (checkpointBtn) checkpointBtn.onclick = async () => {
      checkpointBtn.disabled = true;
      checkpointBtn.textContent = t("admin_train_requesting");
      try {
        await api(`/api/admin/lora-training/jobs/${encodeURIComponent(jobId)}/checkpoint`, { method: "POST" });
        toast(t("admin_train_checkpoint_requested"));
      } catch (err) {
        errorToast(err.message || t("admin_train_could_not_request_checkpoint"));
      }
      checkpointBtn.disabled = false;
      checkpointBtn.textContent = t("admin_train_request_checkpoint_now");
    };
  }
}

class TrainingJobWatcher {
  constructor() {
    this.jobId = null;
    this.interval = null;
    this.consecutiveFailures = 0;
    this.onVisible = null;
    this.chart = null;
    this.refs = null;
    this.onSettled = null;
    this._poll = null;
  }

  get isWatching() { return this.interval != null; }

  rebind(refs) {
    this.refs = refs;
    if (this._poll) this._poll();
  }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
    this.consecutiveFailures = 0;
    if (this.onVisible) { document.removeEventListener("visibilitychange", this.onVisible); this.onVisible = null; }
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  appendLog(logEl, line) {
    if (!logEl || !line) return;
    const lines = logEl.dataset.lines ? JSON.parse(logEl.dataset.lines) : [];
    if (lines[lines.length - 1] === line) return;
    const wasAtBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 20;
    lines.push(line);
    if (lines.length > 200) lines.shift();
    logEl.dataset.lines = JSON.stringify(lines);
    logEl.textContent = lines.join("\n");
    if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  renderMetricCards(wrap, metrics, job) {
    if (!wrap) return;
    const arr = metrics || [];
    const m = arr[arr.length - 1];
    if (!m) { wrap.innerHTML = ""; return; }
    const eta = m.eta_text || "-";
    const speed = m.speed_img_s != null ? `${m.speed_img_s.toFixed(1)} img/s` : "-";
    const gpu = m.gpu_mem_gb != null ? `${m.gpu_mem_gb.toFixed(1)} GB` : "-";
    const loss = m.loss != null ? m.loss.toFixed(4) : "-";
    const lr = job.learning_rate != null ? job.learning_rate.toExponential(2) : "-";
    const cards = [
      [t("admin_train_column_epoch"), `${m.epoch ?? 0}/${m.total_epochs || "?"}`],
      [t("admin_train_column_step"), `${m.step || 0}/${job.steps || "?"}`],
      [t("admin_train_column_loss"), loss, true],
      [t("admin_train_column_lr"), lr],
      [t("admin_train_column_speed"), speed],
      [t("admin_train_column_eta"), eta],
      [t("admin_train_column_gpu"), gpu],
    ];
    wrap.innerHTML = cards.map(([label, value, accent]) => `
      <div class="lora-metric-card">
        <span class="lora-metric-label">${_esc(label)}</span>
        <span class="lora-metric-value${accent ? " accent" : ""}">${_esc(value)}</span>
      </div>
    `).join("");
  }

  renderTransferCards(wrap, tp) {
    if (!wrap) return;
    const recv = (tp.bytes || 0) / (1024 * 1024);
    const total = tp.total_bytes ? tp.total_bytes / (1024 * 1024) : null;
    const pct = total ? `${Math.min(100, Math.round((recv / total) * 100))}%` : "-";
    const speed = tp.speed_mb_s != null ? `${tp.speed_mb_s.toFixed(1)} MB/s` : "-";
    const cards = [
      [t("admin_train_column_received"), `${recv.toFixed(0)}${total ? `/${total.toFixed(0)}` : ""} MB`],
      [t("admin_train_column_progress"), pct],
      [t("admin_train_column_speed"), speed],
    ];
    wrap.innerHTML = `
      <div class="lora-metric-card"><span class="lora-metric-label">${_esc(tp.name || "")}</span><span></span></div>
      ${cards.map(([label, value]) => `
        <div class="lora-metric-card">
          <span class="lora-metric-label">${_esc(label)}</span>
          <span class="lora-metric-value">${_esc(value)}</span>
        </div>
      `).join("")}
    `;
  }

  renderStatusHero(el, job) {
    if (!el) return;
    const pct = Math.round((job.progress || 0) * 100);
    const m = (job.metrics || [])[(job.metrics || []).length - 1];
    const eta = m?.eta_text ? ` &middot; ${t("admin_train_column_eta")} ${_esc(m.eta_text)}` : "";
    const stepLine = m ? `${t("admin_train_column_epoch")} ${m.epoch ?? 0}/${m.total_epochs || "?"} &middot; ${t("admin_train_column_step")} ${m.step || 0}/${job.steps || "?"}${eta}` : "";
    el.innerHTML = `
      ${this.jobStatusPill(job.status)}
      <div class="lora-status-pct">${pct}%</div>
      <div class="lora-status-eta">${stepLine}</div>
    `;
  }

  renderLossChart(canvas, metrics) {
    if (!canvas || typeof Chart === "undefined") return;
    const points = (metrics || []).filter((p) => p.loss != null);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#E3BD6C";
    const line = getComputedStyle(document.documentElement).getPropertyValue("--color-line").trim() || "#2A2A2E";
    if (!this.chart) {
      this.chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: points.map((p) => p.step),
          datasets: [{ data: points.map((p) => p.loss), borderColor: accent, backgroundColor: accent, borderWidth: 1.5, pointRadius: 0, tension: 0.2 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false } },
          scales: { x: { title: { display: true, text: "Step" }, grid: { color: line } }, y: { title: { display: true, text: "Loss" }, grid: { color: line } } },
        },
      });
      return;
    }
    this.chart.data.labels = points.map((p) => p.step);
    this.chart.data.datasets[0].data = points.map((p) => p.loss);
    this.chart.update();
  }

  updateCostBanner(banner, job) {
    if (!banner) return;
    if (!["queued", "provisioning", "training", "saving"].includes(job.status) || !job.billing_started) {
      banner.style.display = "none";
      return;
    }
    const elapsedHours = Math.max(0, (Date.now() / 1000 - job.billing_started)) / 3600;
    const cost = elapsedHours * 0.80;
    banner.style.display = "flex";
    banner.textContent = `${t("admin_train_cost_so_far")}: $${cost.toFixed(3)} (L4 @ $0.80/hr, ${t("admin_train_running")} ${Math.round(elapsedHours * 60)}m)`;
  }

  watch(jobId, refs, onSettled) {
    this.stop();
    this.jobId = jobId;
    this.refs = refs;
    this.onSettled = onSettled;
    this._poll = async () => {
      let job;
      try {
        job = (await api("/api/admin/lora-training/jobs")).find((j) => j.id === jobId);
        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures === 3) errorToast(t("admin_train_lost_touch_with_job"));
        return;
      }
      if (!job) return;
      const { statusHero, logEl, costBanner, metricCards, chart,
              uploadWrap, uploadCards, downloadWrap, downloadCards } = this.refs;
      const refsAttached = statusHero && statusHero.isConnected;
      if (refsAttached) {
        this.renderStatusHero(statusHero, job);
        this.updateCostBanner(costBanner, job);
        const tp = job.transfer_progress || {};
        const uploadNow = tp.phase === "upload" && job.status === "provisioning";
        const downloadNow = tp.phase === "download" && ["training", "saving"].includes(job.status);
        const trainingNow = job.status === "training";
        uploadWrap.style.display = uploadNow ? "" : "none";
        downloadWrap.style.display = downloadNow ? "" : "none";
        if (job.log) this.appendLog(logEl, job.log);
        if (uploadNow) this.renderTransferCards(uploadCards, tp);
        if (downloadNow) this.renderTransferCards(downloadCards, tp);
        if (trainingNow) {
          this.renderMetricCards(metricCards, job.metrics, job);
          this.renderLossChart(chart, job.metrics);
        }
      }
      if (["queued", "provisioning", "training", "saving"].includes(job.status)) return;
      this.stop();
      this.jobId = null;
      if (job.status === "failed") errorToast(`${t("admin_train_training_failed")}: ${job.error || t("admin_train_unknown_error")}`);
      else if (job.status === "done") toast(`${t("admin_train_lora_training_complete")}: ${job.output_file || ""}`);
      this.onSettled && this.onSettled(job);
    };
    this.interval = setInterval(this._poll, 5000);
    this.onVisible = () => { if (document.visibilityState === "visible") this._poll(); };
    document.addEventListener("visibilitychange", this.onVisible);
    this._poll();
  }
}

if (typeof window !== "undefined") {
  window.AdminTrainView = AdminTrainView;
}
