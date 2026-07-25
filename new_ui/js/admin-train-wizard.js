"use strict";

const LORA_WIZARD_STEPS = [
  { key: "basics", label: () => t("admin_train_wizard_basics", "Basics") },
  { key: "dataset", label: () => t("admin_train_wizard_dataset", "Dataset") },
  { key: "tuning", label: () => t("admin_train_wizard_tuning", "Tuning") },
  { key: "review", label: () => t("admin_train_wizard_review", "Review") },
];

Object.assign(AdminTrainView.prototype, {
  openNewJobWizard() {
    this.wizardStep = "basics";
    this.form = {
      name: "", trigger_word: "sks", checkpoint: "", resume_from_lora: "",
      resolution: 512, batch_size: 1, rank: 16, alpha: 16,
      learning_rate: 0.0001, steps: 1000,
      noise_offset: 0, network_dropout: 0,
      advancedOpen: false,
    };
    this.trainImages = [];
    this.trainCaptions = [];
    this.screen = "wizard";
    this.render();
  },

  wizardGoToStep(step) {
    this.wizardStep = step;
    this.render();
  },

  wizardStepIndex() {
    return LORA_WIZARD_STEPS.findIndex((s) => s.key === this.wizardStep);
  },

  wizardStepTrackerHtml() {
    const currentIndex = this.wizardStepIndex();
    return `
      <div class="lora-wizard-track">
        ${LORA_WIZARD_STEPS.map((s, i) => `
          <div class="lora-wizard-step-wrap">
            <div class="lora-wizard-dot ${i < currentIndex ? "done" : ""} ${i === currentIndex ? "active" : ""}">${i < currentIndex ? "&#10003;" : i + 1}</div>
            <div class="lora-wizard-step-label ${i === currentIndex ? "active" : ""}">${_esc(s.label())}</div>
          </div>
          ${i < LORA_WIZARD_STEPS.length - 1 ? `<div class="lora-wizard-line ${i < currentIndex ? "done" : ""}"></div>` : ""}
        `).join("")}
      </div>
    `;
  },

  wizardFooterHtml(opts) {
    return `
      <div class="lora-wizard-footer">
        ${opts.showBack ? `<button type="button" id="lt_wizard_back" class="lora-btn lora-btn-ghost">${t("admin_train_wizard_back", "Back")}</button>` : ""}
        <button type="button" id="lt_wizard_continue" class="lora-btn lora-btn-primary" ${opts.continueDisabled ? "disabled" : ""}>${opts.continueLabel}</button>
      </div>
    `;
  },

  wizardScreenHtml() {
    const body = {
      basics: () => this.basicsStepHtml(),
      dataset: () => this.datasetStepHtml(),
      tuning: () => this.tuningStepHtml(),
      review: () => this.reviewStepHtml(),
    }[this.wizardStep]();
    return `
      <div class="lora-wizard">
        ${this.wizardStepTrackerHtml()}
        <div class="lora-wizard-body">${body}</div>
      </div>
    `;
  },

  wireWizardStep() {
    const backBtn = document.getElementById("lt_wizard_back");
    if (backBtn) backBtn.onclick = () => {
      const order = LORA_WIZARD_STEPS.map((s) => s.key);
      const prev = order[order.indexOf(this.wizardStep) - 1];
      if (prev) this.wizardGoToStep(prev);
      else this.goToJobs();
    };
    if (this.wizardStep === "basics") this.wireBasicsStep();
    if (this.wizardStep === "dataset") this.wireDatasetStep();
    if (this.wizardStep === "tuning") this.wireTuningStep();
    if (this.wizardStep === "review") this.wireReviewStep();
  },

  checkpointPickerItems() {
    return this.checkpoints.map((name) => {
      const p = this.checkpointPreviews[name];
      return { name, label: p?.display_name || name, sublabel: this.animaNames.has(name) ? "Anima" : "SDXL", image: p?.image || null, category: this.animaNames.has(name) ? "anima" : "sdxl" };
    });
  },

  basicsStepHtml() {
    const f = this.form;
    const checkpointPreview = this.checkpointPreviews[f.checkpoint];
    const checkpointLabel = checkpointPreview?.display_name || f.checkpoint || t("admin_train_choose_a_checkpoint");
    return `
      <div class="lora-field-label">${t("admin_train_name")}</div>
      <input type="text" id="lt_name" value="${_attr(f.name)}" placeholder="my-character-lora" class="lora-input">
      <div class="lora-field-hint">${t("admin_train_name_hint")}</div>

      <div class="lora-field-label">${t("admin_train_trigger_word")}</div>
      <input type="text" id="lt_trigger" value="${_attr(f.trigger_word)}" class="lora-input">
      <div class="lora-field-hint">${t("admin_train_trigger_word_hint")}</div>

      <div class="lora-field-label">${t("admin_train_base_checkpoint")}</div>
      <button type="button" id="lt_checkpoint_picker_btn" class="lora-picker-btn">
        ${this.checkpointThumbHtml(f.checkpoint, 46)}
        <span style="flex:1;min-width:0">
          <span class="lora-picker-btn-name">${_esc(checkpointLabel)}</span>
          <span class="lora-picker-btn-sub">${this.checkpoints.length} ${t("admin_train_installed")}</span>
        </span>
        <span class="lora-picker-chev">&rsaquo;</span>
      </button>

      <div class="lora-field-label">${t("admin_train_resume_from_lora", "Resume from existing LoRA")} <span class="lora-field-label-optional">${t("admin_train_optional", "optional")}</span></div>
      <button type="button" id="lt_resume_picker_btn" class="lora-picker-btn">
        ${this.checkpointThumbHtml(null, 46)}
        <span style="flex:1;min-width:0">
          <span class="lora-picker-btn-name">${f.resume_from_lora ? _esc(f.resume_from_lora) : `<span style="color:var(--color-muted)">${t("admin_train_none_selected", "None selected")}</span>`}</span>
          <span class="lora-picker-btn-sub">${t("admin_train_resume_from_hint", "Pick a prior job's output")}</span>
        </span>
        <span class="lora-picker-chev">&rsaquo;</span>
      </button>

      ${this.wizardFooterHtml({ showBack: true, continueLabel: t("admin_train_wizard_continue", "Continue") })}
    `;
  },

  wireBasicsStep() {
    const nameInp = document.getElementById("lt_name");
    if (nameInp) nameInp.oninput = (e) => { this.form.name = e.target.value; };
    const triggerInp = document.getElementById("lt_trigger");
    if (triggerInp) triggerInp.oninput = (e) => { this.form.trigger_word = e.target.value; };
    const checkpointBtn = document.getElementById("lt_checkpoint_picker_btn");
    if (checkpointBtn) checkpointBtn.onclick = () => openPickerSheet({
      title: t("admin_train_choose_a_base_checkpoint"),
      items: this.checkpointPickerItems(),
      selected: this.form.checkpoint,
      categories: [{ key: "anima", label: "Anima" }, { key: "sdxl", label: "SDXL" }],
      onPick: (name) => { this.form.checkpoint = name; this.render(); },
    });
    const resumeBtn = document.getElementById("lt_resume_picker_btn");
    if (resumeBtn) resumeBtn.onclick = () => {
      const priorOutputs = this.jobs.filter((j) => j.output_file).map((j) => ({ name: j.output_file, label: j.name, sublabel: j.output_file, image: null, category: null }));
      openPickerSheet({
        title: t("admin_train_choose_resume_lora", "Choose a LoRA to resume from"),
        items: priorOutputs,
        selected: this.form.resume_from_lora,
        categories: null,
        onPick: (name) => { this.form.resume_from_lora = name; this.render(); },
      });
    };
    const continueBtn = document.getElementById("lt_wizard_continue");
    if (continueBtn) continueBtn.onclick = () => {
      if (!this.form.name.trim()) { errorToast(t("admin_train_error_name_required")); return; }
      if (!this.form.trigger_word.trim()) { errorToast(t("admin_train_error_trigger_word_required")); return; }
      if (!this.form.checkpoint) { errorToast(t("admin_train_error_pick_checkpoint")); return; }
      this.wizardGoToStep("dataset");
    };
  },

  imageRowHtml(file, index) {
    if (!this._imageUrls) this._imageUrls = new Map();
    if (!this._imageUrls.has(file)) this._imageUrls.set(file, URL.createObjectURL(file));
    const url = this._imageUrls.get(file);
    return `
      <div class="lora-img-row">
        <img src="${_attr(url)}" alt="">
        <div class="lora-img-row-cap">
          <div class="lora-img-row-idx">${String(index + 1).padStart(2, "0")} / ${this.trainImages.length}</div>
          <input type="text" data-caption-index="${index}" value="${_attr(this.trainCaptions[index] || "")}" placeholder="${t("admin_train_caption_tags_placeholder")}" class="lora-input">
        </div>
        <button type="button" data-remove-image="${index}" class="lora-img-row-remove" aria-label="${t("admin_train_remove_image")}">&times;</button>
      </div>
    `;
  },

  datasetStepHtml() {
    return `
      <div class="lora-upload-row">
        <label class="lora-upload-pill">
          ${t("admin_train_add_images")}
          <input type="file" id="lt_images_input" accept="image/png,image/jpeg,image/webp" multiple class="hidden">
        </label>
        <label class="lora-upload-pill">
          ${t("admin_train_import_captions")}
          <input type="file" id="lt_captions_input" accept=".txt" multiple class="hidden">
        </label>
      </div>
      <div id="lt_images_list">
        ${this.trainImages.map((f, i) => this.imageRowHtml(f, i)).join("")}
      </div>
      <div class="lora-field-hint" style="margin-top:8px">${t("admin_train_images_help_text")}</div>
      ${this.wizardFooterHtml({ showBack: true, continueLabel: t("admin_train_wizard_continue", "Continue") })}
    `;
  },

  wireDatasetStep() {
    const imagesInput = document.getElementById("lt_images_input");
    if (imagesInput) imagesInput.onchange = () => {
      const newFiles = [...imagesInput.files];
      this.trainImages.push(...newFiles);
      newFiles.forEach(() => this.trainCaptions.push(""));
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
    document.querySelectorAll("[data-caption-index]").forEach((inp) => inp.oninput = (e) => {
      this.trainCaptions[parseInt(inp.dataset.captionIndex, 10)] = e.target.value;
    });
    document.querySelectorAll("[data-remove-image]").forEach((b) => b.onclick = () => {
      const i = parseInt(b.dataset.removeImage, 10);
      this.trainImages.splice(i, 1);
      this.trainCaptions.splice(i, 1);
      this.render();
    });
    const continueBtn = document.getElementById("lt_wizard_continue");
    if (continueBtn) continueBtn.onclick = () => {
      if (!this.trainImages.length) { errorToast(t("admin_train_error_images_required")); return; }
      if (this.trainImages.length < 5) { errorToast(t("admin_train_error_min_5_images")); return; }
      this.wizardGoToStep("tuning");
    };
  },

  checkpointThumbHtml(name, size) {
    const p = this.checkpointPreviews[name];
    const img = p?.image;
    const label = p?.display_name || name || "?";
    const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)`;
    return img
      ? `<span style="${style}"><img src="${_attr(img)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
      : `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(label[0].toUpperCase())}</span>`;
  },

  stackedNumberFieldHtml(id, label, value) {
    return `
      <div class="lora-num-field">
        <label class="lora-num-field-label">${_esc(label)}</label>
        <input type="text" inputmode="decimal" id="${_attr(id)}" value="${_attr(value)}" class="lora-input">
      </div>
    `;
  },

  tuningStepHtml() {
    const f = this.form;
    return `
      <div class="lora-stack-grid">
        ${this.stackedNumberFieldHtml("lt_res", t("admin_train_resolution"), f.resolution)}
        ${this.stackedNumberFieldHtml("lt_batch", t("admin_train_batch_size"), f.batch_size)}
        ${this.stackedNumberFieldHtml("lt_rank", t("admin_train_rank"), f.rank)}
        ${this.stackedNumberFieldHtml("lt_alpha", t("admin_train_alpha"), f.alpha)}
        ${this.stackedNumberFieldHtml("lt_lr", t("admin_train_learning_rate"), f.learning_rate)}
        ${this.stackedNumberFieldHtml("lt_steps", t("admin_train_steps"), f.steps)}
      </div>
      <div class="lora-field-hint" style="margin:8px 0 4px">${t("admin_train_params_help_text")}</div>
      <button type="button" id="lt_advanced_toggle" class="lora-advanced-toggle">
        <span>${t("admin_train_advanced")}</span>
        <span style="transform:rotate(${f.advancedOpen ? "90deg" : "0deg"})">&rsaquo;</span>
      </button>
      ${f.advancedOpen ? `
        <div class="lora-stack-grid" style="margin-top:10px">
          ${this.stackedNumberFieldHtml("lt_noise_offset", t("admin_train_noise_offset"), f.noise_offset)}
          ${this.stackedNumberFieldHtml("lt_network_dropout", t("admin_train_network_dropout"), f.network_dropout)}
        </div>
        <div class="lora-field-hint">${t("admin_train_advanced_help_text")}</div>
      ` : ""}
      ${this.wizardFooterHtml({ showBack: true, continueLabel: t("admin_train_wizard_continue", "Continue") })}
    `;
  },

  wireTuningStep() {
    [["lt_res", "resolution"], ["lt_batch", "batch_size"], ["lt_rank", "rank"], ["lt_alpha", "alpha"],
     ["lt_lr", "learning_rate"], ["lt_steps", "steps"], ["lt_noise_offset", "noise_offset"], ["lt_network_dropout", "network_dropout"]]
      .forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.oninput = (e) => { this.form[key] = e.target.value; };
      });
    const advToggle = document.getElementById("lt_advanced_toggle");
    if (advToggle) advToggle.onclick = () => { this.form.advancedOpen = !this.form.advancedOpen; this.render(); };
    const continueBtn = document.getElementById("lt_wizard_continue");
    if (continueBtn) continueBtn.onclick = () => {
      const errors = this.validateTrainForm();
      if (errors.length) { errorToast(errors[0]); return; }
      this.wizardGoToStep("review");
    };
  },

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
  },

  reviewStepHtml() {
    const f = this.form;
    const architecture = this.animaNames.has(f.checkpoint) ? "anima" : "sdxl";
    const est = this.estimateTrainingRun(architecture, Number(f.steps) || 0, Number(f.batch_size) || 1);
    const checkpointLabel = this.checkpointPreviews[f.checkpoint]?.display_name || f.checkpoint;
    return `
      <div class="lora-cost-banner">
        <div><div class="lora-cost-lbl">${t("admin_train_estimated_cost", "Estimated cost")}</div><div class="lora-cost-amt">$${est.cost.toFixed(2)}</div></div>
        <div style="text-align:right"><div class="lora-cost-lbl">${t("admin_train_estimated_time", "Estimated time")}</div><div class="lora-cost-amt" style="color:var(--color-ink);font-size:15px">&asymp; ${this.formatDuration(est.seconds)}</div></div>
      </div>
      <div class="lora-review-card">
        <div class="lora-review-row"><span>${t("admin_train_name")}</span><span>${_esc(f.name)}</span></div>
        <div class="lora-review-row"><span>${t("admin_train_base_checkpoint")}</span><span>${_esc(checkpointLabel)}</span></div>
        <div class="lora-review-row"><span>${t("admin_train_trigger_word")}</span><span>${_esc(f.trigger_word)}</span></div>
        <div class="lora-review-row"><span>${t("admin_train_training_images")}</span><span>${this.trainImages.length}</span></div>
        <div class="lora-review-row"><span>${t("admin_train_resolution")}</span><span>${_esc(String(f.resolution))}</span></div>
        <div class="lora-review-row"><span>${t("admin_train_steps")}</span><span>${_esc(String(f.steps))}</span></div>
      </div>
      ${this.wizardFooterHtml({ showBack: true, continueLabel: t("admin_train_start_training") })}
    `;
  },

  wireReviewStep() {
    const continueBtn = document.getElementById("lt_wizard_continue");
    if (continueBtn) continueBtn.onclick = () => this.submitTraining();
  },
});

if (typeof window !== "undefined") {
  window.LORA_WIZARD_STEPS = LORA_WIZARD_STEPS;
}
