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
    const metrics = job.metrics || [];
    const lastMetric = metrics[metrics.length - 1];
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
    this.main.querySelectorAll("[data-open-job]").forEach((b) => b.onclick = async () => await this.openJobDetail(b.dataset.openJob));
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
    if (f.resume_from_lora) fd.append("resume_from_lora", f.resume_from_lora);
    fd.append("captions", JSON.stringify(this.trainImages.map((_, i) => this.trainCaptions[i] || "")));
    this.trainImages.forEach((file) => fd.append("images", file, file.name));

    const continueBtn = document.getElementById("lt_wizard_continue");
    if (continueBtn) { continueBtn.disabled = true; continueBtn.textContent = t("admin_train_starting"); }
    try {
      const resp = await api("/api/admin/lora-training/jobs", { method: "POST", body: fd });
      this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
      await this.openJobDetail(resp.job_id);
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
    const job = this.jobs.find((j) => j.id === jobId);
    const isTerminal = job && !["queued", "provisioning", "training", "saving"].includes(job.status);
    if (this.watcher.isWatching && this.watcher.jobId === jobId) {
      this.watcher.rebind(refs);
    } else if (job && isTerminal) {
      if (refs.statusHero) this.watcher.renderStatusHero(refs.statusHero, job);
      if (job.log) this.watcher.appendLog(refs.logEl, job.log);
      if (refs.costBanner) this.watcher.updateCostBanner(refs.costBanner, job);
    } else {
      this.watcher.watch(jobId, refs, async (job) => {
        this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
        if (this.detailJobId === jobId || this.screen === "jobs") this.render();
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
