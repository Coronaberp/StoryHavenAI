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

  checkpointThumbHtml(name, size) {
    const p = this.checkpointPreviews[name];
    const img = p?.image;
    const label = p?.display_name || name || "?";
    const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)`;
    return img
      ? `<span style="${style}"><img src="${_attr(img)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
      : `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(label[0].toUpperCase())}</span>`;
  },
});

if (typeof window !== "undefined") {
  window.LORA_WIZARD_STEPS = LORA_WIZARD_STEPS;
}
