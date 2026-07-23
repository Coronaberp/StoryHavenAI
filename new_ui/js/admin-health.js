"use strict";

const ADMIN_HEALTH_SERVICE_LABELS = {
  database: "Database", chat_llm: "Chat model", embed_llm: "Embed model",
  comfyui: "ComfyUI", image_classify_llm: "Image classifier", modal: "Modal",
};

function adminHealthFmtDuration(secs) {
  secs = Math.floor(secs);
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d) parts.push(d + "d");
  if (h || d) parts.push(h + "h");
  parts.push(m + "m");
  return parts.join(" ");
}

class AdminHealthView {
  async mount(main) {
    this.main = main;
    this.hours = 24;
    this.charts = {};
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    this.render();
    await this.loadHealth();
    await this.loadLogs();
  }

  async loadHealth() {
    try {
      this.healthData = await api(`/api/admin/service-health?hours=${this.hours}`);
    } catch (e) {
      this.healthError = e.message || "Couldn't load service health.";
      this.healthData = null;
      this.renderHealth();
      return;
    }
    this.healthError = null;
    this.renderHealth();
  }

  setRange(hours) {
    this.hours = hours;
    this.loadHealth();
  }

  serviceCardHtml(s) {
    const pct = s.uptime_pct_24h == null ? "-" : `${s.uptime_pct_24h}%`;
    const avg = s.avg_latency_ms == null ? "-" : `${s.avg_latency_ms} ms`;
    return `
      <div class="rounded-[13px] border p-3.5" id="health_card_${_esc(s.name)}" style="border-color:${s.ok ? "var(--color-line)" : "var(--color-warn)"}">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-2 h-2 rounded-full flex-none" id="health_dot_${_esc(s.name)}" style="background:${s.ok ? "var(--color-success)" : "var(--color-warn)"}"></span>
          <span class="font-display font-semibold text-sm text-ink">${_esc(ADMIN_HEALTH_SERVICE_LABELS[s.name] || s.name)}</span>
          <span class="text-xs text-muted ml-auto" id="health_status_text_${_esc(s.name)}">${s.ok ? t("admin_health_up") : t("admin_health_down")}</span>
        </div>
        <div class="flex gap-4 text-xs text-sec mb-2">
          <span>${t("admin_health_latency")}: <b class="text-ink" id="health_latency_${_esc(s.name)}">${s.latency_ms != null ? s.latency_ms + " ms" : "-"}</b></span>
          <span>${t("admin_health_uptime_24h")}: <b class="text-ink" id="health_uptime_pct_${_esc(s.name)}">${_esc(pct)}</b></span>
        </div>
        <div class="h-[50px]"><canvas id="health_chart_${_esc(s.name)}"></canvas></div>
        <div class="text-xs text-muted mt-1" id="health_avg_${_esc(s.name)}">${t("admin_health_avg")}: ${_esc(avg)}</div>
        <div class="text-xs mt-2" id="health_error_${_esc(s.name)}" style="color:var(--color-warn);${s.error ? "" : "display:none"}">${_esc(s.error || "")}</div>
      </div>
    `;
  }

  updateServiceCard(s) {
    const card = document.getElementById(`health_card_${s.name}`);
    if (card) card.style.borderColor = s.ok ? "var(--color-line)" : "var(--color-warn)";
    const dot = document.getElementById(`health_dot_${s.name}`);
    if (dot) dot.style.background = s.ok ? "var(--color-success)" : "var(--color-warn)";
    const statusText = document.getElementById(`health_status_text_${s.name}`);
    if (statusText) statusText.textContent = s.ok ? t("admin_health_up") : t("admin_health_down");
    const latency = document.getElementById(`health_latency_${s.name}`);
    if (latency) latency.textContent = s.latency_ms != null ? s.latency_ms + " ms" : "-";
    const pctEl = document.getElementById(`health_uptime_pct_${s.name}`);
    if (pctEl) pctEl.textContent = s.uptime_pct_24h == null ? "-" : `${s.uptime_pct_24h}%`;
    const avgEl = document.getElementById(`health_avg_${s.name}`);
    if (avgEl) avgEl.textContent = `${t("admin_health_avg")}: ${s.avg_latency_ms == null ? "-" : `${s.avg_latency_ms} ms`}`;
    const errEl = document.getElementById(`health_error_${s.name}`);
    if (errEl) {
      errEl.textContent = s.error || "";
      errEl.style.display = s.error ? "" : "none";
    }
    this.renderChart(s);
  }

  renderChart(service) {
    const canvas = document.getElementById(`health_chart_${service.name}`);
    if (!canvas || typeof Chart === "undefined") return;
    const points = service.latency_history || [];
    const labels = points.map((p) => new Date(p.t * 1000).toLocaleTimeString());
    const data = points.map((p) => (p.ok ? p.ms : null));
    const existing = this.charts[service.name];
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets[0].data = data;
      existing.update();
      return;
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#E3BD6C";
    const line = getComputedStyle(document.documentElement).getPropertyValue("--color-line").trim() || "#2A2A2E";
    this.charts[service.name] = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data,
          borderColor: accent,
          backgroundColor: accent,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: { display: false },
          y: { display: false, grid: { color: line } },
        },
      },
    });
  }

  renderHealth() {
    const grid = document.getElementById("health_grid");
    const uptimeBox = document.getElementById("health_uptime");
    if (!grid) return;
    if (this.healthError) {
      grid.innerHTML = `<p class="text-sm" style="color:var(--color-warn)">${_esc(this.healthError)}</p>`;
      this.destroyCharts();
      return;
    }
    if (!this.healthData) return;
    if (uptimeBox) uptimeBox.textContent = `${t("admin_health_process_uptime")}: ${adminHealthFmtDuration(this.healthData.process_uptime_seconds)}`;

    const services = this.healthData.services;
    const existingNames = Object.keys(this.charts);
    const namesMatch = existingNames.length === services.length &&
      services.every((s) => existingNames.includes(s.name));
    const gridHasCards = !!grid.querySelector("[id^='health_card_']");

    if (!gridHasCards || !namesMatch) {
      grid.innerHTML = `<div class="grid grid-cols-1 gap-3">${services.map((s) => this.serviceCardHtml(s)).join("")}</div>`;
      this.destroyCharts();
      services.forEach((s) => this.renderChart(s));
      return;
    }

    services.forEach((s) => this.updateServiceCard(s));
  }

  destroyCharts() {
    Object.values(this.charts).forEach((chart) => chart.destroy());
    this.charts = {};
  }
}

Object.assign(AdminHealthView.prototype, {
  async loadLogs() {
    const box = document.getElementById("health_log_view");
    if (box) box.innerHTML = `<span class="text-sm text-muted">${_esc(t("common_loading"))}</span>`;
    try {
      const { logs } = await api(`/api/admin/logs?level=${this.logLevel || "INFO"}&limit=300`);
      if (!box) return;
      if (!logs.length) { box.innerHTML = `<p class="text-sm text-muted">${t("admin_health_no_log_entries")}</p>`; return; }
      box.innerHTML = logs.slice().reverse().map((l) => {
        const dt = new Date(l.ts * 1000).toLocaleString();
        const color = (l.level === "ERROR" || l.level === "CRITICAL") ? "var(--color-warn)" : (l.level === "WARNING" ? "var(--color-accent)" : "var(--color-sec)");
        return `<div class="py-0.5 text-xs whitespace-pre-wrap break-words"><span class="text-muted">${_esc(dt)}</span> <span style="color:${color};font-weight:600">${_esc(l.level)}</span> <span class="text-muted">${_esc(l.logger)}:</span> ${_esc(l.message)}</div>`;
      }).join("");
    } catch (e) {
      if (box) box.innerHTML = `<p class="text-sm" style="color:var(--color-warn)">${t("admin_health_couldnt_load_logs")}: ${_esc(e.message)}</p>`;
    }
  },

  setLogLevel(level) {
    this.logLevel = level;
    this.loadLogs();
  },
});

AdminHealthView.prototype.render = function () {
  this.main.innerHTML = `
    <div class="content-col">
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_health_title"), t("ph_admin_health_sub"))}

    <div class="flex items-center justify-between mb-2">
      <div id="health_uptime" class="text-xs text-muted"></div>
      <div class="flex gap-1.5">
        <button type="button" onclick="adminHealthView.setRange(1)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_range_1h")}</button>
        <button type="button" onclick="adminHealthView.setRange(24)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_range_24h")}</button>
        <button type="button" onclick="adminHealthView.setRange(168)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_range_7d")}</button>
      </div>
    </div>
    <div id="health_grid" class="mb-6"><span class="text-sm text-muted">${t("admin_health_loading")}</span></div>

    <div class="flex items-center justify-between mb-2">
      <div class="font-display font-semibold text-base text-ink">${t("admin_health_server_logs")}</div>
      <select onchange="adminHealthView.setLogLevel(this.value)" class="px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
        <option value="DEBUG">${t("admin_health_log_level_debug")}</option>
        <option value="INFO" selected>${t("admin_health_log_level_info")}</option>
        <option value="WARNING">${t("admin_health_log_level_warning")}</option>
        <option value="ERROR">${t("admin_health_log_level_error")}</option>
      </select>
    </div>
    <div id="health_log_view" class="rounded-[13px] border border-line bg-surface p-3 max-h-[420px] overflow-y-auto"></div>
    </div>
  `;
};

if (typeof window !== "undefined") {
  window.AdminHealthView = AdminHealthView;
}
