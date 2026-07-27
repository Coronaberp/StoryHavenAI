"use strict";

const ADMIN_HEALTH_SERVICE_LABELS = {
  database: "Database", chat_llm: "Chat model", embed_llm: "Embed model",
  comfyui: "ComfyUI", image_classify_llm: "Image classifier", modal: "Modal",
};

const ADMIN_HEALTH_MODEL_COLORS = ["#e3bd6c", "#4d6bfe", "#4caf50", "#e05c5c", "#9b6bd1", "#3aa3c9"];

function adminExtractSvgDominantColor(svgMarkup) {
  if (!svgMarkup) return null;
  const matches = svgMarkup.matchAll(/fill:\s*#([0-9a-fA-F]{3,6})|fill="#([0-9a-fA-F]{3,6})"/g);
  for (const m of matches) {
    const hex = "#" + (m[1] || m[2]);
    const lower = hex.toLowerCase();
    if (lower === "#fff" || lower === "#ffffff" || lower === "#000" || lower === "#000000") continue;
    return hex;
  }
  return null;
}

function adminModelColor(provider, index) {
  const extracted = provider.icon_type === "svg" ? adminExtractSvgDominantColor(provider.icon_value) : null;
  return extracted || ADMIN_HEALTH_MODEL_COLORS[index % ADMIN_HEALTH_MODEL_COLORS.length];
}

function adminModelStatusColor(latencyMs) {
  if (latencyMs == null) return "var(--color-muted)";
  if (latencyMs >= 60000) return "var(--color-warn)";
  if (latencyMs >= 50000) return "var(--color-accent)";
  return "var(--color-success)";
}

function adminModelStatusDotHtml(latencyMs) {
  return `<span class="w-2 h-2 rounded-full flex-none" style="background:${adminModelStatusColor(latencyMs)}"></span>`;
}

function adminFmtLatency(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

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
    this.sparkCharts = {};
    this.mobileExpandCharts = {};
    this.expandedServices = new Set();
    this.modelServices = [];
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    this.render();
    await Promise.all([this.loadHealth(), this.loadModelLatency()]);
    await this.loadLogs();
  }

  async loadModelLatency() {
    try {
      const data = await api(`/api/admin/model-latency?hours=${this.hours}`);
      this.modelServices = (data.models || []).map((m) => ({
        name: m.name,
        ok: m.latest_latency_ms != null,
        latency_ms: m.latest_latency_ms,
        avg_latency_ms: m.avg_latency_ms,
        uptime_pct_24h: m.success_pct,
        error: "",
        latency_history: m.latency_history,
        icon_type: m.icon_type,
        icon_value: m.icon_value,
        base_url: m.base_url,
      }));
    } catch (e) {
      this.modelServices = [];
    }
    this.renderHealth();
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
    this.loadModelLatency();
  }

  async refreshNow() {
    const btn = this.main.querySelector("[data-admin-health-refresh]");
    if (btn) { btn.disabled = true; btn.textContent = t("admin_health_refreshing", "Checking…"); }
    try {
      await api("/api/admin/service-health/refresh", { method: "POST" });
      await this.loadHealth();
    } catch (e) {
      this.healthError = e.message || "Couldn't refresh service health.";
      this.renderHealth();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = t("admin_health_refresh_now", "Check now"); }
    }
  }

  toggleServiceExpand(name) {
    if (this.expandedServices.has(name)) this.expandedServices.delete(name);
    else this.expandedServices.add(name);
    this.renderHealth();
  }

  mobileRowHtml(s) {
    const expanded = this.expandedServices.has(s.name);
    const sparkHtml = adminSparklineHtml();
    const sparkId = sparkHtml.match(/id="([^"]+)"/)[1];
    this._pendingSparkIds = this._pendingSparkIds || {};
    this._pendingSparkIds[s.name] = sparkId;
    const icon = s.icon_type && typeof proxyIconHtml === "function" ? proxyIconHtml(s, 18) : "";
    return `
      <div class="admin-health-row border-b border-line last:border-0" data-health-row="${_esc(s.name)}">
        <button type="button" class="w-full flex items-center gap-2 py-2.5 text-left" data-health-row-toggle="${_esc(s.name)}">
          ${icon || `<span class="w-2 h-2 rounded-full flex-none" style="background:${s.ok ? "var(--color-success)" : "var(--color-warn)"}"></span>`}
          <span class="font-display font-semibold text-sm text-ink flex-1">${_esc(ADMIN_HEALTH_SERVICE_LABELS[s.name] || s.name)}</span>
          <span class="text-xs text-muted">${adminFmtLatency(s.latency_ms)}</span>
          ${sparkHtml}
        </button>
        <div class="admin-health-row-expand ${expanded ? "" : "hidden"} pb-3" data-health-row-expand="${_esc(s.name)}">
          <div class="h-[140px]"><canvas id="health_chart_mobile_${_esc(s.name)}"></canvas></div>
          ${s.error ? `<div class="text-xs mt-1" style="color:var(--color-warn)">${_esc(s.error)}</div>` : ""}
        </div>
      </div>`;
  }

  modelBlockHtml(providers) {
    const rows = providers.map((p) => {
      const icon = p.icon_type && typeof proxyIconHtml === "function" ? proxyIconHtml(p, 18) : "";
      return `
        <div class="flex items-center gap-2 py-2">
          ${adminModelStatusDotHtml(p.latency_ms)}
          ${icon}
          <span class="font-display font-semibold text-sm text-ink flex-1 truncate">${_esc(p.name)}</span>
          <span class="text-xs text-muted flex-none">${adminFmtLatency(p.latency_ms)}</span>
        </div>`;
    }).join("");
    const chartHeight = Math.max(providers.length * 40, 60);
    return `
      <div class="admin-health-row border-b border-line last:border-0" data-health-row="model_latency_block">
        <div class="flex items-center gap-3">
          <div class="flex-1 flex flex-col divide-y divide-line">${rows}</div>
          <div class="w-[90px] flex-none" style="height:${chartHeight}px"><canvas id="health_chart_mobile_model_shared"></canvas></div>
        </div>
      </div>`;
  }

  renderMobileRows(services, modelProviders) {
    const box = document.getElementById("health_grid_mobile");
    if (!box || !this.healthData) return;
    Object.values(this.sparkCharts).forEach((c) => c && c.destroy());
    this.sparkCharts = {};
    Object.values(this.mobileExpandCharts).forEach((c) => c && c.destroy());
    this.mobileExpandCharts = {};
    this._pendingSparkIds = {};
    const hasModels = modelProviders && modelProviders.length;
    box.innerHTML = services.map((s) => this.mobileRowHtml(s)).join("")
      + (hasModels ? this.modelBlockHtml(modelProviders) : "");
    services.forEach((s) => {
      const sparkId = this._pendingSparkIds[s.name];
      const points = (s.latency_history || []).slice(-20).map((p) => (p.ok ? p.ms : null));
      this.sparkCharts[s.name] = adminRenderSparkline(sparkId, points);
      const toggle = box.querySelector(`[data-health-row-toggle="${s.name}"]`);
      if (toggle) toggle.onclick = () => this.toggleServiceExpand(s.name);
      if (this.expandedServices.has(s.name)) {
        this.mobileExpandCharts[s.name] = this.renderChart(s, `health_chart_mobile_${s.name}`, this.mobileExpandCharts);
      }
    });
    if (hasModels) {
      this.sparkCharts.model_latency_block = this.renderMultiChart(modelProviders, "health_chart_mobile_model_shared", this.sparkCharts);
    }
  }

  serviceCardHtml(s) {
    const pct = s.uptime_pct_24h == null ? "-" : `${s.uptime_pct_24h}%`;
    const avg = adminFmtLatency(s.avg_latency_ms);
    const icon = s.icon_type && typeof proxyIconHtml === "function"
      ? proxyIconHtml(s, 18)
      : `<span class="w-2 h-2 rounded-full flex-none" id="health_dot_${_esc(s.name)}" style="background:${s.ok ? "var(--color-success)" : "var(--color-warn)"}"></span>`;
    return `
      <div class="rounded-[13px] border p-3.5" id="health_card_${_esc(s.name)}" style="border-color:${s.ok ? "var(--color-line)" : "var(--color-warn)"}">
        <div class="flex items-center gap-2 mb-2">
          ${icon}
          <span class="font-display font-semibold text-sm text-ink">${_esc(ADMIN_HEALTH_SERVICE_LABELS[s.name] || s.name)}</span>
          <span class="text-xs text-muted ml-auto" id="health_status_text_${_esc(s.name)}">${s.ok ? t("admin_health_up") : t("admin_health_down")}</span>
        </div>
        <div class="flex gap-4 text-xs text-sec mb-2">
          <span>${t("admin_health_latency")}: <b class="text-ink" id="health_latency_${_esc(s.name)}">${adminFmtLatency(s.latency_ms)}</b></span>
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
    if (latency) latency.textContent = adminFmtLatency(s.latency_ms);
    const pctEl = document.getElementById(`health_uptime_pct_${s.name}`);
    if (pctEl) pctEl.textContent = s.uptime_pct_24h == null ? "-" : `${s.uptime_pct_24h}%`;
    const avgEl = document.getElementById(`health_avg_${s.name}`);
    if (avgEl) avgEl.textContent = `${t("admin_health_avg")}: ${adminFmtLatency(s.avg_latency_ms)}`;
    const errEl = document.getElementById(`health_error_${s.name}`);
    if (errEl) {
      errEl.textContent = s.error || "";
      errEl.style.display = s.error ? "" : "none";
    }
    this.renderChart(s);
  }

  renderChart(service, canvasId, store) {
    canvasId = canvasId || `health_chart_${service.name}`;
    store = store || this.charts;
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    const points = service.latency_history || [];
    const labels = points.map((p) => new Date(p.t * 1000).toLocaleTimeString());
    const data = points.map((p) => (p.ok ? p.ms : null));
    const existing = store[service.name];
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets[0].data = data;
      existing.update();
      return existing;
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#E3BD6C";
    const line = getComputedStyle(document.documentElement).getPropertyValue("--color-line").trim() || "#2A2A2E";
    store[service.name] = new Chart(canvas, {
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
    return store[service.name];
  }

  modelLatencyCardHtml(providers) {
    const legendRows = providers.map((p) => `
        <div class="flex items-center gap-2 py-0.5">
          ${adminModelStatusDotHtml(p.latency_ms)}
          ${p.icon_type && typeof proxyIconHtml === "function" ? proxyIconHtml(p, 16) : ""}
          <span class="text-xs text-ink flex-1 truncate">${_esc(p.name)}</span>
          <span class="text-xs text-muted flex-none">${_esc(adminFmtLatency(p.latency_ms))}</span>
        </div>`).join("");
    return `
      <div class="rounded-[13px] border border-line p-3.5" id="health_card_model_latency">
        <div class="flex items-center gap-2 mb-2">
          <span class="font-display font-semibold text-sm text-ink">${t("admin_health_model_latency", "Model latency")}</span>
        </div>
        <div class="h-[50px] mb-2"><canvas id="health_chart_model_latency"></canvas></div>
        <div class="flex flex-col">${legendRows}</div>
      </div>
    `;
  }

  updateModelLatencyCard(providers) {
    const card = document.getElementById("health_card_model_latency");
    if (card) {
      const legendBox = card.querySelector(".flex.flex-col");
      if (legendBox) {
        legendBox.innerHTML = providers.map((p) => `
            <div class="flex items-center gap-2 py-0.5">
              ${adminModelStatusDotHtml(p.latency_ms)}
              ${p.icon_type && typeof proxyIconHtml === "function" ? proxyIconHtml(p, 16) : ""}
              <span class="text-xs text-ink flex-1 truncate">${_esc(p.name)}</span>
              <span class="text-xs text-muted flex-none">${_esc(adminFmtLatency(p.latency_ms))}</span>
            </div>`).join("");
      }
    }
    this.renderMultiChart(providers);
  }

  renderMultiChart(providers, canvasId, store) {
    canvasId = canvasId || "health_chart_model_latency";
    store = store || this.charts;
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;
    const allTimestamps = new Set();
    providers.forEach((p) => (p.latency_history || []).forEach((pt) => allTimestamps.add(pt.t)));
    const timestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    const labels = timestamps.map((ts) => new Date(ts * 1000).toLocaleTimeString());
    const datasets = providers.map((p, i) => {
      const byTime = {};
      (p.latency_history || []).forEach((pt) => { byTime[pt.t] = pt.ok ? pt.ms : null; });
      return {
        label: p.name,
        data: timestamps.map((ts) => (ts in byTime ? byTime[ts] : null)),
        borderColor: adminModelColor(p, i),
        backgroundColor: adminModelColor(p, i),
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        spanGaps: true,
      };
    });
    const existing = store.model_latency;
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets = datasets;
      existing.update();
      return existing;
    }
    store.model_latency = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
    return store.model_latency;
  }

  renderHealth() {
    const grid = document.getElementById("health_grid_desktop");
    const mobileBox = document.getElementById("health_grid_mobile");
    const uptimeBox = document.getElementById("health_uptime");
    if (!grid) return;
    if (this.healthError) {
      grid.innerHTML = `<p class="text-sm" style="color:var(--color-warn)">${_esc(this.healthError)}</p>`;
      if (mobileBox) mobileBox.innerHTML = `<p class="text-sm" style="color:var(--color-warn)">${_esc(this.healthError)}</p>`;
      this.destroyCharts();
      return;
    }
    if (!this.healthData) return;
    if (uptimeBox) uptimeBox.textContent = `${t("admin_health_process_uptime")}: ${adminHealthFmtDuration(this.healthData.process_uptime_seconds)}`;

    const desktopItems = [...this.healthData.services];
    if (this.modelServices.length) desktopItems.push({ name: "model_latency", multi: true, providers: this.modelServices });
    const desktopKeys = desktopItems.map((s) => s.name);
    const existingNames = Object.keys(this.charts);
    const namesMatch = existingNames.length === desktopKeys.length &&
      desktopKeys.every((name) => existingNames.includes(name));
    const gridHasCards = !!grid.querySelector("[id^='health_card_']");

    if (!gridHasCards || !namesMatch) {
      grid.innerHTML = `<div class="admin-health-grid">${desktopItems.map((s) => (s.multi ? this.modelLatencyCardHtml(s.providers) : this.serviceCardHtml(s))).join("")}</div>`;
      Object.values(this.charts).forEach((chart) => chart.destroy());
      this.charts = {};
      desktopItems.forEach((s) => (s.multi ? this.renderMultiChart(s.providers) : this.renderChart(s)));
    } else {
      desktopItems.forEach((s) => (s.multi ? this.updateModelLatencyCard(s.providers) : this.updateServiceCard(s)));
    }

    this.renderMobileRows(this.healthData.services, this.modelServices);
  }

  destroyCharts() {
    Object.values(this.charts).forEach((chart) => chart.destroy());
    this.charts = {};
    Object.values(this.sparkCharts || {}).forEach((chart) => chart && chart.destroy());
    this.sparkCharts = {};
    Object.values(this.mobileExpandCharts || {}).forEach((chart) => chart && chart.destroy());
    this.mobileExpandCharts = {};
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
      const state = paginateSlice("admin-logs", logs.slice().reverse(), 40);
      onPaginate("admin-logs", () => this.loadLogs());
      box.innerHTML = state.rows.map((l) => {
        const dt = new Date(l.ts * 1000).toLocaleString();
        const color = (l.level === "ERROR" || l.level === "CRITICAL") ? "var(--color-warn)" : (l.level === "WARNING" ? "var(--color-accent)" : "var(--color-sec)");
        return `<div class="py-0.5 overflow-x-auto"><div class="text-xs whitespace-pre-wrap break-words"><span class="text-muted">${_esc(dt)}</span> <span style="color:${color};font-weight:600">${_esc(l.level)}</span> <span class="text-muted">${_esc(l.logger)}:</span> ${_esc(l.message)}</div></div>`;
      }).join("") + paginationHtml("admin-logs", state);
    } catch (e) {
      if (box) box.innerHTML = `<p class="text-sm" style="color:var(--color-warn)">${t("admin_health_couldnt_load_logs")}: ${_esc(e.message)}</p>`;
    }
  },

  setLogLevel(level) {
    resetPagination("admin-logs");
    this.logLevel = level;
    this.updateLogChipState();
    this.loadLogs();
  },

  updateLogChipState() {
    const active = this.logLevel || "INFO";
    this.main.querySelectorAll("[data-health-log-chip]").forEach((chip) => {
      chip.classList.toggle("on", chip.dataset.healthLogChip === active);
    });
  },
});

AdminHealthView.prototype.render = function () {
  this.main.innerHTML = `
    <div class="content-col">
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_health_title"), t("ph_admin_health_sub"))}
    ${adminScreenSwitcherHtml("admin-health", window._adminSwitcherBadges || {})}

    <div class="flex items-center justify-between mb-2">
      <div id="health_uptime" class="text-xs text-muted"></div>
      <div class="flex gap-1.5">
        <button type="button" onclick="adminHealthView.setRange(1)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_range_1h")}</button>
        <button type="button" onclick="adminHealthView.setRange(24)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_range_24h")}</button>
        <button type="button" onclick="adminHealthView.setRange(168)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_range_7d")}</button>
        <button type="button" onclick="adminHealthView.refreshNow()" data-admin-health-refresh class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_refresh_now", "Check now")}</button>
      </div>
    </div>
    <div id="health_grid_desktop" class="mb-3 hidden lg:block"><span class="text-sm text-muted">${t("admin_health_loading")}</span></div>
    <div id="health_grid_mobile" class="mb-6 lg:hidden rounded-[13px] border border-line bg-surface px-3"><span class="text-sm text-muted">${t("admin_health_loading")}</span></div>

    <div class="flex items-center justify-between mb-2">
      <div class="font-display font-semibold text-base text-ink">${t("admin_health_server_logs")}</div>
      <select onchange="adminHealthView.setLogLevel(this.value)" class="hidden lg:block px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
        <option value="DEBUG">${t("admin_health_log_level_debug")}</option>
        <option value="INFO" selected>${t("admin_health_log_level_info")}</option>
        <option value="WARNING">${t("admin_health_log_level_warning")}</option>
        <option value="ERROR">${t("admin_health_log_level_error")}</option>
      </select>
      <div class="flex gap-1.5 lg:hidden">
        <button type="button" onclick="adminHealthView.setLogLevel('DEBUG')" data-health-log-chip="DEBUG" class="filter-chip admin-log-chip px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_log_chip_all", "All")}</button>
        <button type="button" onclick="adminHealthView.setLogLevel('INFO')" data-health-log-chip="INFO" class="filter-chip on admin-log-chip px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_log_level_info")}</button>
        <button type="button" onclick="adminHealthView.setLogLevel('WARNING')" data-health-log-chip="WARNING" class="filter-chip admin-log-chip px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_log_level_warning")}</button>
        <button type="button" onclick="adminHealthView.setLogLevel('ERROR')" data-health-log-chip="ERROR" class="filter-chip admin-log-chip px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_health_log_level_error")}</button>
      </div>
    </div>
    <div id="health_log_view" class="rounded-[13px] border border-line bg-surface p-3 max-h-[420px] overflow-y-auto"></div>
    </div>
  `;
  adminAttachScreenSwitcher(this.main);
};

if (typeof window !== "undefined") {
  window.AdminHealthView = AdminHealthView;
}
