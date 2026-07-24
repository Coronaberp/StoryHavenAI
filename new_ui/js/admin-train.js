"use strict";

const ADMIN_TRAIN_TABS = [
  { key: "train", label: () => t("admin_train_tab_train") },
  { key: "progress", label: () => t("admin_train_tab_progress") },
  { key: "test", label: () => t("admin_train_tab_test") },
  { key: "jobs", label: () => t("admin_train_tab_jobs") },
];

class AdminTrainView {
  async mount(main) {
    if (AdminTrainView._activeWatcher) {
      AdminTrainView._activeWatcher.stop();
      AdminTrainView._activeWatcher = null;
    }
    this.main = main;
    this.tab = "train";
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
    const [checkpoints, animaUnets, previews, samplerData] = await Promise.all([
      api("/api/imagegen/checkpoints").catch(() => []),
      api("/api/imagegen/anima-unets").catch(() => []),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
    ]);
    this.checkpoints = [...checkpoints, ...animaUnets];
    this.animaNames = new Set(animaUnets);
    this.checkpointPreviews = previews;
    this.samplers = samplerData.samplers || [];
    this.schedulers = samplerData.schedulers || [];
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

  switchTab(tab) {
    this.tab = tab;
    this.render();
  }

  tabBarHtml() {
    return `
      <div class="flex gap-2 mb-4 overflow-x-auto">
        ${ADMIN_TRAIN_TABS.map((t) => `
          <button type="button" onclick="adminTrainView.switchTab('${t.key}')"
            class="px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap ${this.tab === t.key ? "text-paper bg-gradient-to-br from-primary to-primary-dark" : "text-ink border border-line"}">
            ${_esc(t.label())}
          </button>
        `).join("")}
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_train_title"), t("ph_admin_train_sub"))}
      ${adminScreenSwitcherHtml("admin-train", window._adminSwitcherBadges || {})}
      ${this.tabBarHtml()}
      ${this.tab === "train" ? this.trainTabHtml() : ""}
      ${this.tab === "progress" ? this.progressTabHtml() : ""}
      ${this.tab === "test" ? this.testTabHtml() : ""}
      ${this.tab === "jobs" ? this.jobsTabHtml() : ""}
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    this.wireTab();
  }

  wireTab() {
    if (this.tab === "train") this.wireTrainTab();
    if (this.tab === "progress" && this.watcher.isWatching) this.bindWatcherRefs(this.watcher.jobId);
    if (this.tab === "jobs") this.renderJobsList();
    if (this.tab === "test") this.wireTestTab();
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

  checkpointThumbHtml(name, size) {
    const p = this.checkpointPreviews[name];
    const img = p?.image;
    const label = p?.display_name || name || "?";
    const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)`;
    return img
      ? `<span style="${style}"><img src="${_attr(img)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
      : `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(label[0].toUpperCase())}</span>`;
  }

  checkpointPickerHtml() {
    const p = this.checkpointPreviews[this.form.checkpoint];
    const label = p?.display_name || this.form.checkpoint || t("admin_train_choose_a_checkpoint");
    return `
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_base_checkpoint")}</label>
        <button type="button" onclick="adminTrainView.openCheckpointPicker()" style="width:100%;display:flex;align-items:center;gap:12px;padding:10px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;cursor:pointer;text-align:left">
          ${this.checkpointThumbHtml(this.form.checkpoint, 52)}
          <span style="flex:1;min-width:0">
            <span style="display:block;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(label)}</span>
            <span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px">${this.checkpoints.length} ${t("admin_train_installed")}</span>
          </span>
          <span style="color:var(--color-muted);flex:none">&rsaquo;</span>
        </button>
        <div class="hint text-xs text-muted mt-1">${t("admin_train_base_checkpoint_hint")}</div>
      </div>
    `;
  }

  openCheckpointPicker() {
    this._cpQuery = "";
    this._cpPicked = this.form.checkpoint;
    openModal(`
      <h3>${t("admin_train_choose_a_base_checkpoint")}</h3>
      <input type="text" id="cpSearch" placeholder="${t("admin_train_search_checkpoints_placeholder")}" value="" style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)">
      <div id="cpGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px;max-height:360px;overflow-y:auto;padding:2px"></div>
    `, { wide: true });
    document.getElementById("cpSearch").oninput = (e) => { this._cpQuery = e.target.value; this.renderCheckpointPickerGrid(); };
    this.renderCheckpointPickerGrid();
  }

  renderCheckpointPickerGrid() {
    const grid = document.getElementById("cpGrid");
    if (!grid) return;
    const q = (this._cpQuery || "").trim().toLowerCase();
    let list = this.checkpoints;
    if (q) list = list.filter((n) => n.toLowerCase().includes(q) || (this.checkpointPreviews[n]?.display_name || "").toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map((name) => {
      const p = this.checkpointPreviews[name];
      const label = p?.display_name || name;
      return `
        <button type="button" data-cp-name="${_attr(name)}" style="display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
          ${this.checkpointThumbHtml(name, 64)}
          <span style="font-size:10.5px;text-align:center;color:var(--color-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${_esc(label)}</span>
        </button>
      `;
    }).join("") : `<p style="font-size:12.5px;color:var(--color-sec);grid-column:1/-1">${t("admin_train_no_checkpoints_match")}</p>`;
    grid.querySelectorAll("[data-cp-name]").forEach((b) => b.onclick = () => {
      this.form.checkpoint = b.dataset.cpName;
      closeTopModal();
      this.render();
      this.updateTimeEstimate();
    });
  }

  trainParamsHtml() {
    const f = this.form;
    return `
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_name")}</label>
        <input type="text" id="lt_name" value="${_attr(f.name)}" placeholder="my-character-lora" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <div class="text-xs text-muted mt-1">${t("admin_train_name_hint")}</div>
      </div>
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_trigger_word")}</label>
        <input type="text" id="lt_trigger" value="${_attr(f.trigger_word)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <div class="text-xs text-muted mt-1">${t("admin_train_trigger_word_hint")}</div>
      </div>
      ${this.checkpointPickerHtml()}
      <div class="grid grid-cols-2 gap-3 mb-2">
        ${this.numberFieldHtml("lt_res", t("admin_train_resolution"), f.resolution)}
        ${this.numberFieldHtml("lt_batch", t("admin_train_batch_size"), f.batch_size)}
        ${this.numberFieldHtml("lt_rank", t("admin_train_rank"), f.rank)}
        ${this.numberFieldHtml("lt_alpha", t("admin_train_alpha"), f.alpha)}
        ${this.numberFieldHtml("lt_lr", t("admin_train_learning_rate"), f.learning_rate)}
        ${this.numberFieldHtml("lt_steps", t("admin_train_steps"), f.steps)}
      </div>
      <div class="text-xs text-muted mb-4 leading-relaxed">
        ${t("admin_train_params_help_text")}
      </div>
      <div style="border:1px solid var(--color-line);border-radius:14px;overflow:hidden;margin-bottom:16px">
        <button type="button" onclick="adminTrainView.form.advancedOpen = !adminTrainView.form.advancedOpen; adminTrainView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink)">
          <span style="flex:1;text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted)">${t("admin_train_advanced")}</span>
          <span style="transform:rotate(${f.advancedOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${f.advancedOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line)">
            <div class="grid grid-cols-2 gap-3 mb-2">
              ${this.numberFieldHtml("lt_noise_offset", t("admin_train_noise_offset"), f.noise_offset)}
              ${this.numberFieldHtml("lt_network_dropout", t("admin_train_network_dropout"), f.network_dropout)}
            </div>
            <div class="text-xs text-muted leading-relaxed">
              ${t("admin_train_advanced_help_text")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  numberFieldHtml(id, label, value) {
    return `
      <div>
        <label class="text-xs text-sec block mb-1">${_esc(label)}</label>
        <input type="text" inputmode="decimal" id="${_attr(id)}" value="${_attr(value)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
    `;
  }

  validateTrainForm() {
    const f = this.form;
    const errors = [];
    if (!f.name.trim()) errors.push(t("admin_train_error_name_required"));
    if (!f.trigger_word.trim()) errors.push(t("admin_train_error_trigger_word_required"));
    else if (/\s/.test(f.trigger_word.trim())) errors.push(t("admin_train_error_trigger_word_single_word"));
    if (!f.checkpoint) errors.push(t("admin_train_error_pick_checkpoint"));
    const imageCount = (this.trainImages || []).length;
    if (!imageCount) errors.push(t("admin_train_error_images_required"));
    else if (imageCount < 5) errors.push(t("admin_train_error_min_5_images"));
    const res = Number(f.resolution);
    if (!Number.isInteger(res) || res < 256 || res > 1024) errors.push(t("admin_train_error_resolution_range"));
    else if (res % 64 !== 0) errors.push(t("admin_train_error_resolution_multiple_of_64"));
    const batch = Number(f.batch_size);
    if (!Number.isInteger(batch) || batch < 1 || batch > 8) errors.push(t("admin_train_error_batch_size_range"));
    const rank = Number(f.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > 128) errors.push(t("admin_train_error_rank_range"));
    const alpha = Number(f.alpha);
    if (!Number.isInteger(alpha) || alpha < 1 || alpha > 128) errors.push(t("admin_train_error_alpha_range"));
    const steps = Number(f.steps);
    if (!Number.isInteger(steps) || steps < 50 || steps > 20000) errors.push(t("admin_train_error_steps_range"));
    const lr = Number(f.learning_rate);
    if (!(lr > 0) || lr > 0.01) errors.push(t("admin_train_error_learning_rate_range"));
    return errors;
  }

  trainTabHtml() {
    return `
      <div class="mb-6">
        ${this.trainParamsHtml()}
        <div id="lt_images_section"></div>
        <div class="flex items-center gap-3 mt-4">
          <button type="button" id="lt_start" data-feature="lora_training" class="flex-1 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_train_start_training")}</button>
          <span id="lt_time_est" class="text-xs text-muted font-mono"></span>
        </div>
        <div class="text-xs text-muted mt-2">${t("admin_train_start_training_hint")}</div>
      </div>
    `;
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
  testTabHtml() {
    if (!this.testEntry) {
      return `<p class="text-sm text-muted">${t("admin_train_pick_lora_to_test")}</p>`;
    }
    const e = this.testEntry;
    const notFound = !this.checkpoints.includes(e.job.base_checkpoint);
    return `
      <div class="mb-4 text-sm">
        <b class="text-ink">${_esc(e.label)}</b><br>
        <span class="text-xs text-muted">${t("admin_train_trigger_word_label")}: <b>${_esc(e.job.trigger_word || "-")}</b> · ${t("admin_train_base_label")}: ${_esc(e.job.base_checkpoint || "-")}</span>
        ${notFound ? `<div class="text-xs mt-1" style="color:var(--color-warn)">${t("admin_train_base_checkpoint_not_found")}</div>` : ""}
      </div>
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_strength")}</label>
        <input type="range" id="tl_strength" min="-8" max="8" step="0.05" value="${this.testStrength}" style="width:100%">
        <span id="tl_strength_val" class="text-xs font-mono text-accent">${this.testStrength.toFixed(2)}</span>
      </div>
      ${this.simplePickerSummaryHtml("testSampler", t("admin_train_sampler"), this.samplers)}
      ${this.simplePickerSummaryHtml("testScheduler", t("admin_train_scheduler"), this.schedulers)}
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_steps")}</label>
        <input type="range" id="tl_steps" min="1" max="60" step="1" value="${this.testSteps}" style="width:100%">
        <span id="tl_steps_val" class="text-xs font-mono text-accent">${this.testSteps}</span>
      </div>
      <div class="mb-4">
        <label class="grimoire-field-label">${t("admin_train_guidance_cfg")}</label>
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

  simplePickerSummaryHtml(field, title, options) {
    const value = this[field];
    const label = value || t("admin_train_default");
    return `
      <div class="mb-3">
        <label class="grimoire-field-label">${_esc(title)}</label>
        <button type="button" onclick="adminTrainView.openSimplePicker('${field}')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;cursor:pointer;text-align:left">
          <span style="flex:1;font-family:var(--font-mono);font-size:12.5px;color:var(--color-ink)">${_esc(label)}</span>
          <span style="color:var(--color-muted)">&rsaquo;</span>
        </button>
      </div>
    `;
  }

  openSimplePicker(field) {
    const source = field === "testSampler" ? this.samplers : this.schedulers;
    openModal(`
      <h3>${t("admin_train_choose_a")} ${field === "testSampler" ? t("admin_train_sampler_lowercase") : t("admin_train_scheduler_lowercase")}</h3>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto">
        ${source.map((name) => `
          <button type="button" data-sp-name="${_attr(name)}" style="display:flex;align-items:center;padding:10px 12px;border-radius:10px;border:1px solid ${this[field] === name ? "var(--color-accent)" : "transparent"};background:none;cursor:pointer;text-align:left;font-family:var(--font-mono);font-size:13px;color:var(--color-ink)">${_esc(name)}</button>
        `).join("")}
      </div>
    `, { wide: true });
    document.querySelectorAll("[data-sp-name]").forEach((b) => b.onclick = () => {
      this[field] = b.dataset.spName;
      closeTopModal();
      this.render();
    });
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

  wireTestTab() {
    if (!this.testEntry) return;
    const strengthInp = document.getElementById("tl_strength");
    if (strengthInp) strengthInp.oninput = (e) => {
      this.testStrength = parseFloat(e.target.value);
      document.getElementById("tl_strength_val").textContent = this.testStrength.toFixed(2);
    };
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

  jobsTabHtml() {
    if (!this.jobs.length) return `<p class="text-sm text-muted">${t("admin_train_no_jobs_yet")}</p>`;
    return `<div id="lt_jobs_list"></div>`;
  }

  async renderJobsList() {
    const list = document.getElementById("lt_jobs_list");
    if (!list) return;
    const entries = await this.loadJobEntries();
    list.innerHTML = this.jobs.map((j) => {
      const jobEntries = entries.filter((e) => e.job.id === j.id);
      return `
        <div class="flex items-start gap-2.5 py-2.5 border-b border-line">
          <div class="flex-1 min-w-0">
            <b class="text-ink">${_esc(j.name)}</b> <span class="text-xs text-muted">${_esc(j.status)} · ${Math.round((j.progress || 0) * 100)}%</span>
            ${j.resume_from_lora ? `<div class="text-xs" style="color:var(--color-accent)">${t("admin_train_resumed_from")} ${_esc(j.resume_from_lora)}</div>` : ""}
            ${j.error ? `<div class="text-xs" style="color:var(--color-warn)">${_esc(j.error)}</div>` : ""}
          </div>
          <button type="button" data-del-job="${_attr(j.id)}" class="px-2 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_train_delete")}</button>
        </div>
        ${jobEntries.map((e, idx) => `
          <button type="button" data-select-entry="${idx}" data-select-job="${_attr(j.id)}" class="block w-full text-left text-xs text-ink px-3 py-1.5 ml-4 rounded-md border border-line mt-1">${_esc(e.label)}</button>
        `).join("")}
      `;
    }).join("");
    list.querySelectorAll("[data-del-job]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/api/admin/lora-training/jobs/${encodeURIComponent(b.dataset.delJob)}`, { method: "DELETE" });
        this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
        this.renderJobsList();
      } catch (err) {
        errorToast(err.message || t("admin_train_delete_failed"));
        b.disabled = false;
      }
    });
    list.querySelectorAll("[data-select-entry]").forEach((b) => b.onclick = () => {
      const jobEntries = entries.filter((e) => e.job.id === b.dataset.selectJob);
      const picked = jobEntries[parseInt(b.dataset.selectEntry, 10)];
      if (!picked) return;
      this.testEntry = picked;
      this.tab = "test";
      this.render();
    });
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

    const startBtn = document.getElementById("lt_start");
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = t("admin_train_starting"); }
    try {
      const resp = await api("/api/admin/lora-training/jobs", { method: "POST", body: fd });
      this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
      this.tab = "progress";
      this.render();
      this.watchJob(resp.job_id);
    } catch (err) {
      errorToast(err.message || t("admin_train_training_request_failed"));
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = t("admin_train_start_training"); }
    }
  }

  watchJob(jobId) {
    this.tab = "progress";
    this.render();
    this.bindWatcherRefs(jobId);
  }

  bindWatcherRefs(jobId) {
    const refs = {
      statusLabel: document.getElementById("lt_status_label"), bar: document.getElementById("lt_progress_bar"),
      logEl: document.getElementById("lt_log"), costBanner: document.getElementById("lt_cost_banner"),
      metricsTable: document.getElementById("lt_metrics_table"), chart: document.getElementById("lt_loss_chart"),
      metricsWrap: document.getElementById("lt_metrics_wrap"), finalizing: document.getElementById("lt_finalizing"),
      doneTile: document.getElementById("lt_done_tile"), uploadWrap: document.getElementById("lt_upload_wrap"),
      uploadTable: document.getElementById("lt_upload_table"), downloadWrap: document.getElementById("lt_download_wrap"),
      downloadTable: document.getElementById("lt_download_table"),
    };
    document.getElementById("lt_idle").style.display = "none";
    document.getElementById("lt_live").style.display = "";
    if (this.watcher.isWatching && this.watcher.jobId === jobId) {
      this.watcher.rebind(refs);
    } else {
      this.watcher.watch(jobId, refs, async (job) => {
        if (job.status === "done") this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
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

  renderMetricsTable(tbody, metrics, job) {
    if (!tbody) return;
    const arr = metrics || [];
    const m = arr[arr.length - 1];
    if (!m) { tbody.innerHTML = ""; return; }
    const eta = m.eta_text || "-";
    const speed = m.speed_img_s != null ? `${m.speed_img_s.toFixed(1)} img/s` : "-";
    const gpu = m.gpu_mem_gb != null ? `${m.gpu_mem_gb.toFixed(1)} GB` : "-";
    const loss = m.loss != null ? m.loss.toFixed(4) : "-";
    const lr = job.learning_rate != null ? job.learning_rate.toExponential(2) : "-";
    tbody.innerHTML = `
      <tr class="border-t border-line">
        <td class="py-1 pr-2">${m.epoch ?? 0}/${m.total_epochs || "?"}</td>
        <td class="py-1 px-2">${m.step || 0}/${job.steps || "?"}</td>
        <td class="py-1 px-2">${loss}</td>
        <td class="py-1 px-2">${lr}</td>
        <td class="py-1 px-2">${speed}</td>
        <td class="py-1 px-2">${eta}</td>
        <td class="py-1 pl-2">${gpu}</td>
      </tr>
    `;
  }

  renderTransferTable(tbody, tp) {
    if (!tbody) return;
    const recv = (tp.bytes || 0) / (1024 * 1024);
    const total = tp.total_bytes ? tp.total_bytes / (1024 * 1024) : null;
    const pct = total ? `${Math.min(100, Math.round((recv / total) * 100))}%` : "-";
    const speed = tp.speed_mb_s != null ? `${tp.speed_mb_s.toFixed(1)} MB/s` : "-";
    tbody.innerHTML = `
      <tr class="border-t border-line">
        <td class="py-1 pr-2 truncate max-w-[160px]">${_esc(tp.name || "")}</td>
        <td class="py-1 px-2">${recv.toFixed(0)}${total ? `/${total.toFixed(0)}` : ""} MB</td>
        <td class="py-1 px-2">${pct}</td>
        <td class="py-1 pl-2">${speed}</td>
      </tr>
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
      const { statusLabel, bar, logEl, costBanner, metricsTable, chart, metricsWrap, finalizing, doneTile,
              uploadWrap, uploadTable, downloadWrap, downloadTable } = this.refs;
      const refsAttached = statusLabel && statusLabel.isConnected;
      if (refsAttached) {
        statusLabel.textContent = `${t("admin_train_status_label_prefix")}: ${job.status}` + (job.resume_from_lora ? ` · ${t("admin_train_resumed_from")} ${job.resume_from_lora}` : "");
        bar.style.width = `${Math.round((job.progress || 0) * 100)}%`;
        if (job.log) this.appendLog(logEl, job.log);
        this.updateCostBanner(costBanner, job);
        const tp = job.transfer_progress || {};
        const uploadNow = tp.phase === "upload" && job.status === "provisioning";
        const downloadNow = tp.phase === "download" && ["training", "saving"].includes(job.status);
        const trainingNow = job.status === "training";
        const finalizingNow = job.status === "saving" && !downloadNow;
        const doneNow = job.status === "done";
        uploadWrap.style.display = uploadNow ? "" : "none";
        downloadWrap.style.display = downloadNow ? "" : "none";
        metricsWrap.style.display = trainingNow ? "" : "none";
        finalizing.style.display = finalizingNow ? "" : "none";
        doneTile.style.display = doneNow ? "" : "none";
        if (uploadNow) this.renderTransferTable(uploadTable, tp);
        if (downloadNow) this.renderTransferTable(downloadTable, tp);
        if (trainingNow) {
          this.renderMetricsTable(metricsTable, job.metrics, job);
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
