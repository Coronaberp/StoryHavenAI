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
});

if (typeof window !== "undefined") {
  window.AdminTrainView = AdminTrainView;
}
