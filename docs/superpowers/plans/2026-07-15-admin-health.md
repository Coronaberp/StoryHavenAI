# Admin Panel — Service Health & Server Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sixth and final sub-project of the Admin panel for `new_ui/` — Service health & server logs — per `docs/superpowers/specs/2026-07-15-admin-health-design.md`.

**Architecture:** One new route (`admin-health`), one `AdminHealthView` class following the established admin-route pattern. Per-service latency history is rendered with Chart.js (loaded via CDN with an SRI hash, matching the existing `marked.min.js`/`purify.min.js` pattern in `index.html`), replacing legacy's hand-rolled SVG sparkline. No backend changes.

**Tech Stack:** Vanilla JS, Tailwind CSS, Chart.js 4.5.0 (CDN, no bundler), served by `dev_server.py` on `:3001`.

## Global Constraints

- Never use `EnterWorktree`/`git worktree` for this repo.
- Zero comments in any file, ever.
- Every user-controlled string (log `message`/`logger`, service `error`) must go through `_esc()` for its context.
- No backend changes. Endpoints used: `GET /api/admin/service-health?hours={h}`, `GET /api/admin/logs?level={level}&limit=300`.
- **Chart.js is loaded via a CDN `<script>` tag with a real SRI integrity hash, matching the exact pattern of `marked.min.js`/`purify.min.js` already in `new_ui/index.html`.** Use this exact tag, verified against cdnjs's own published SRI hash for version 4.5.0's UMD minified build — do not substitute a different hash or version without re-verifying against cdnjs directly:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js" integrity="sha512-Y51n9mtKTVBh3Jbx5pZSJNDDMyY+yGe77DGtBPzRlgsf/YLCh13kSZ3JmfHGzYFCmOndraf0sQgfM654b7dJ3w==" crossorigin="anonymous" defer></script>
  ```
- No JS unit-test harness. Verification is Playwright against the running `:3001` dev server (`./rebuild.sh --watch`, already running — never start a second instance).
- **Never create new user accounts for testing, under any circumstances.**
- This screen is entirely read-only (no mutations) — no risk of leaving live state changed by verification.
- **This is a SHARED, actively-changing checkout.** Run `git branch --show-current` before starting and before every commit, stopping if unexpected. Never `git add -A`/`git add .`. Treat `new_ui/js/router.js`/`new_ui/index.html`/`new_ui/js/admin.js` as high-collision — check `git status --short` before editing, use narrow anchored `Edit` calls if dirty. Verify `git diff HEAD --stat -- <your files>` after committing.
- `dev_server.py` serves the physical files on disk directly, not git `HEAD`.
- Role gate: `ME.role === "admin" || ME.role === "dev"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `new_ui/js/admin-health.js` (create) | `AdminHealthView` — health cards with Chart.js sparklines, server log viewer |
| `new_ui/js/router.js` (modify) | Add the `admin-health` route + `TAB_FOR_ROUTE` entry |
| `new_ui/index.html` (modify) | Add the Chart.js CDN script tag + the `admin-health.js` script tag |
| `new_ui/js/admin.js` (modify) | Add a "Health & logs" row linking to `/admin-health` |

---

### Task 1: Service health cards with Chart.js sparklines

**Files:**
- Create: `new_ui/js/admin-health.js`
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`
- Modify: `new_ui/js/admin.js`

**Interfaces:**
- Consumes: `api()`, `errorToast()`, `pageHeaderHtml()`, `backLinkHtml()`, `_esc()`, `ME`, the global `Chart` constructor (from the CDN script).
- Produces: `AdminHealthView` with `mount(main)`, `loadHealth(hours)`, `renderHealth()`, `setRange(hours)` — Task 2 appends the log-viewer half of `render()`/the log-loading methods to this same file/class.

- [ ] **Step 1: Write `new_ui/js/admin-health.js` (Part 1 — health cards)**

```js
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
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    this.render();
    await this.loadHealth();
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
    const pct = s.uptime_pct_24h == null ? "—" : `${s.uptime_pct_24h}%`;
    const avg = s.avg_latency_ms == null ? "—" : `${s.avg_latency_ms} ms`;
    return `
      <div class="rounded-[13px] border p-3.5" style="border-color:${s.ok ? "var(--color-line)" : "var(--color-warn)"}">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-2 h-2 rounded-full flex-none" style="background:${s.ok ? "#7bd88f" : "var(--color-warn)"}"></span>
          <span class="font-display font-semibold text-sm text-ink">${_esc(ADMIN_HEALTH_SERVICE_LABELS[s.name] || s.name)}</span>
          <span class="text-xs text-muted ml-auto">${s.ok ? "Up" : "Down"}</span>
        </div>
        <div class="flex gap-4 text-xs text-sec mb-2">
          <span>Latency: <b class="text-ink">${s.latency_ms != null ? s.latency_ms + " ms" : "—"}</b></span>
          <span>24h uptime: <b class="text-ink">${_esc(pct)}</b></span>
        </div>
        <div class="h-[50px]"><canvas id="health_chart_${_esc(s.name)}"></canvas></div>
        <div class="text-xs text-muted mt-1">Avg: ${_esc(avg)}</div>
        ${s.error ? `<div class="text-xs mt-2" style="color:var(--color-warn)">${_esc(s.error)}</div>` : ""}
      </div>
    `;
  }

  renderChart(service) {
    const canvas = document.getElementById(`health_chart_${service.name}`);
    if (!canvas || typeof Chart === "undefined") return;
    if (this.charts[service.name]) this.charts[service.name].destroy();
    const points = service.latency_history || [];
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#E3BD6C";
    const line = getComputedStyle(document.documentElement).getPropertyValue("--color-line").trim() || "#2A2A2E";
    this.charts[service.name] = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((p) => new Date(p.t * 1000).toLocaleTimeString()),
        datasets: [{
          data: points.map((p) => (p.ok ? p.ms : null)),
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
      return;
    }
    if (!this.healthData) return;
    if (uptimeBox) uptimeBox.textContent = `Process uptime: ${adminHealthFmtDuration(this.healthData.process_uptime_seconds)}`;
    grid.innerHTML = `<div class="grid grid-cols-1 gap-3">${this.healthData.services.map((s) => this.serviceCardHtml(s)).join("")}</div>`;
    this.healthData.services.forEach((s) => this.renderChart(s));
  }

  render() {
    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Health & logs", "Service status, latency history, and recent server activity.")}

      <div class="flex items-center justify-between mb-2">
        <div id="health_uptime" class="text-xs text-muted"></div>
        <div class="flex gap-1.5">
          <button type="button" onclick="adminHealthView.setRange(1)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">1h</button>
          <button type="button" onclick="adminHealthView.setRange(24)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">24h</button>
          <button type="button" onclick="adminHealthView.setRange(168)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">7d</button>
        </div>
      </div>
      <div id="health_grid" class="mb-6"><span class="text-sm text-muted">Loading…</span></div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.AdminHealthView = AdminHealthView;
}
```

Note: this task's `render()` is temporary (health section only) — Task 2 replaces it wholesale with a version that also includes the log viewer.

- [ ] **Step 2: Add the Chart.js CDN script and register the route**

Check `git status --short new_ui/index.html new_ui/js/router.js` first; use narrow anchored edits if dirty.

In `new_ui/index.html`, add the Chart.js script tag right after the existing `purify.min.js` tag (in the `<head>`, alongside the other CDN libraries):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js" integrity="sha512-Y51n9mtKTVBh3Jbx5pZSJNDDMyY+yGe77DGtBPzRlgsf/YLCh13kSZ3JmfHGzYFCmOndraf0sQgfM654b7dJ3w==" crossorigin="anonymous" defer></script>
```

Add `<script src="/js/admin-health.js" defer></script>` after `admin-config.js`'s script tag (near the bottom, with the app's own scripts, not the CDN ones).

In `new_ui/js/router.js`, add to `routes`:

```js
  "admin-health": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminHealthView = new AdminHealthView();
    window.adminHealthView.mount(main);
  },
```

Add to `TAB_FOR_ROUTE`: `"admin-health": "dossier",`

- [ ] **Step 3: Link from the Overview dashboard**

In `new_ui/js/admin.js`, find the "Server configuration" section block, add a matching block after it:

```js
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">Health & logs</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-health')">Open →</span>
      </div>
```

- [ ] **Step 4: Verify live with Playwright**

```bash
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3001/login")
    page.fill('input[data-field="username"]', "claude")
    page.fill('input[data-field="password"]', "0987654321")
    page.click('button[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3001/admin-health")
    page.wait_for_selector("text=Health & logs", timeout=8000)
    page.wait_for_timeout(1500)
    assert page.locator("canvas").count() > 0, "no Chart.js canvases rendered"
    chart_defined = page.evaluate("typeof Chart !== 'undefined'")
    assert chart_defined, "Chart.js did not load"
    print("OK: health cards render with Chart.js canvases")

    with page.expect_response(lambda r: "service-health" in r.url and "hours=1" in r.url) as ri:
        page.click("text=1h")
    print("range switch status:", ri.value.status)
    browser.close()
EOF
```

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-health.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
git diff --cached --stat
git commit -m "Add Admin Health screen: service status cards with Chart.js latency history"
git diff HEAD --stat -- new_ui/js/admin-health.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
```

---

### Task 2: Server log viewer

**Files:**
- Modify: `new_ui/js/admin-health.js`

**Interfaces:**
- Consumes: `AdminHealthView` (Task 1).
- Produces: `AdminHealthView.prototype.loadLogs()`, `.setLogLevel(level)` — appended, plus a final `render()` reassignment adding the log viewer section.

- [ ] **Step 1: Append to `new_ui/js/admin-health.js`** (before the final `if (typeof window...)` block)

```js
Object.assign(AdminHealthView.prototype, {
  async loadLogs() {
    const box = document.getElementById("health_log_view");
    if (box) box.innerHTML = `<span class="text-sm text-muted">Loading…</span>`;
    try {
      const { logs } = await api(`/api/admin/logs?level=${this.logLevel || "INFO"}&limit=300`);
      if (!box) return;
      if (!logs.length) { box.innerHTML = `<p class="text-sm text-muted">No log entries.</p>`; return; }
      box.innerHTML = logs.slice().reverse().map((l) => {
        const dt = new Date(l.ts * 1000).toLocaleString();
        const color = (l.level === "ERROR" || l.level === "CRITICAL") ? "var(--color-warn)" : (l.level === "WARNING" ? "var(--color-accent)" : "var(--color-sec)");
        return `<div class="py-0.5 text-xs whitespace-pre-wrap break-words"><span class="text-muted">${_esc(dt)}</span> <span style="color:${color};font-weight:600">${_esc(l.level)}</span> <span class="text-muted">${_esc(l.logger)}:</span> ${_esc(l.message)}</div>`;
      }).join("");
    } catch (e) {
      if (box) box.innerHTML = `<p class="text-sm" style="color:var(--color-warn)">Couldn't load logs: ${_esc(e.message)}</p>`;
    }
  },

  setLogLevel(level) {
    this.logLevel = level;
    this.loadLogs();
  },
});

AdminHealthView.prototype.render = function () {
  this.main.innerHTML = `
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", "Health & logs", "Service status, latency history, and recent server activity.")}

    <div class="flex items-center justify-between mb-2">
      <div id="health_uptime" class="text-xs text-muted"></div>
      <div class="flex gap-1.5">
        <button type="button" onclick="adminHealthView.setRange(1)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">1h</button>
        <button type="button" onclick="adminHealthView.setRange(24)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">24h</button>
        <button type="button" onclick="adminHealthView.setRange(168)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">7d</button>
      </div>
    </div>
    <div id="health_grid" class="mb-6"><span class="text-sm text-muted">Loading…</span></div>

    <div class="flex items-center justify-between mb-2">
      <div class="font-display font-semibold text-base text-ink">Server logs</div>
      <select onchange="adminHealthView.setLogLevel(this.value)" class="px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
        <option value="DEBUG">Debug</option>
        <option value="INFO" selected>Info</option>
        <option value="WARNING">Warning</option>
        <option value="ERROR">Error</option>
      </select>
    </div>
    <div id="health_log_view" class="rounded-[13px] border border-line bg-surface p-3 max-h-[420px] overflow-y-auto"></div>
  `;
};
```

This final `render()` replaces Task 1's temporary one. Ensure the file ends with exactly ONE `render()` assignment after this step, and that `mount()` calls `loadLogs()` too (add `await this.loadLogs();` to `mount()`'s body alongside the existing `await this.loadHealth();` call — edit Task 1's `mount()` method in place to add this one line, it's the only change needed to the already-committed `mount()`).

- [ ] **Step 2: Verify live with Playwright**

```bash
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3001/login")
    page.fill('input[data-field="username"]', "claude")
    page.fill('input[data-field="password"]', "0987654321")
    page.click('button[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3001/admin-health")
    page.wait_for_selector("text=Server logs", timeout=8000)
    page.wait_for_timeout(1500)
    assert page.locator("#health_log_view").is_visible()
    print("OK: log viewer section renders")

    with page.expect_response(lambda r: "admin/logs" in r.url and "level=ERROR" in r.url) as ri:
        page.select_option("select", "ERROR")
    print("level switch status:", ri.value.status)
    browser.close()
EOF
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-health.js
git diff --cached --stat
git commit -m "Add Admin Health server log viewer with level filter"
git diff HEAD --stat -- new_ui/js/admin-health.js
```

---

## Self-Review Notes

- **Spec coverage:** Health cards with Chart.js sparklines ✓ Task 1, range selector ✓, log viewer with level filter ✓ Task 2. Chart.js loaded via a real, cdnjs-verified SRI hash (fetched live from `api.cdnjs.com` during planning, not guessed) ✓.
- **Type consistency:** `this.healthData`/`this.healthError`/`this.hours`/`this.charts` set in Task 1's `mount()`/`loadHealth()` are read identically by Task 2's final `render()`. `this.logLevel` introduced in Task 2 only, read only by Task 2's own methods.
- **No placeholders:** every step has complete, runnable code.
