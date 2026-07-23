# Admin Panel — Global Server Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fifth sub-project of the Admin panel for `new_ui/` — Global server configuration — per `docs/superpowers/specs/2026-07-15-admin-config-design.md`.

**Architecture:** One new route (`admin-config`), one `AdminConfigView` class following the established admin-route pattern. Sampling-default fields reuse the exact slider-pair pattern already built in `new_ui/js/settings-model.js`. No backend changes.

**Tech Stack:** Vanilla JS, Tailwind CSS, served by `dev_server.py` on `:3001`.

## Global Constraints

- Never use `EnterWorktree`/`git worktree` for this repo.
- Zero comments in any file, ever.
- Every user-controlled string must go through `_esc()`/`_attr()` for its context. Every `onclick` interpolating a non-server-generated-id value must use the `_attr(JSON.stringify(...))` pattern (no bare single-quote-wrapped `_attr()` calls) — this exact bug shape has shipped FOUR times on this branch already this session.
- No backend changes. Endpoints used: `GET /api/settings`, `PUT /api/settings`, `GET /api/models`, `POST /api/settings/test-embed`.
- The app's own backend-URL override is stored under `store` key `apiBase` (see `new_ui/js/app-session.js`: `const API = store.get("apiBase", "")`), not `"api"` — the save handler must write to `apiBase`, and update the in-memory `API` constant is NOT possible since it's a `const` set at script-load time; instead, after saving a changed backend URL, tell the admin a page reload is needed for it to take effect (a cleaner behavior than legacy's `API = sa.value...` live-reassignment, which would need `API` to not be `const` — no such reassignment exists in `new_ui/`'s `app-session.js`, don't introduce one just for this feature).
- No JS unit-test harness. Verification is Playwright against the running `:3001` dev server (`./rebuild.sh --watch`, already running — never start a second instance).
- **Never create new user accounts for testing, under any circumstances.**
- Verification must NOT leave any live chat/embed/ComfyUI endpoint, sampling default, or the app's own backend URL changed from its original value — a safe, reversible round-trip (e.g. add-then-remove a throwaway model-request host row, or toggle-and-untoggle enable-thinking) is the extent of live mutation testing.
- **This is a SHARED, actively-changing checkout.** Run `git branch --show-current` before starting and before every commit, stopping if unexpected. Never `git add -A`/`git add .`. Treat `new_ui/js/router.js`/`new_ui/index.html`/`new_ui/js/admin.js` as high-collision — check `git status --short` before editing, use narrow anchored `Edit` calls if dirty. Verify `git diff HEAD --stat -- <your files>` after committing.
- `dev_server.py` serves the physical files on disk directly, not git `HEAD`.
- Role gate: `ME.role === "admin" || ME.role === "dev"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `new_ui/js/admin-config.js` (create) | `AdminConfigView` — language/endpoints/host-allowlists (Task 1), sampling defaults/prompt-injection/backend-URL + final save wiring (Task 2) |
| `new_ui/js/router.js` (modify) | Add the `admin-config` route + `TAB_FOR_ROUTE` entry |
| `new_ui/index.html` (modify) | Add the `admin-config.js` script tag |
| `new_ui/js/admin.js` (modify, Task 1) | Add a "Server configuration" row linking to `/admin-config` |

---

### Task 1: Language, endpoints, host allowlists, memory/thinking

**Files:**
- Create: `new_ui/js/admin-config.js`
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`
- Modify: `new_ui/js/admin.js`

**Interfaces:**
- Consumes: `api()`, `toast()`, `errorToast()`, `pageHeaderHtml()`, `backLinkHtml()`, `_esc()`, `_attr()`, `ME`.
- Produces: `AdminConfigView` with `mount(main)`, `load()`, `render()` (temporary — Task 2 replaces it), `fetchModels()`, host-allowlist row management (`addMrHostRow()`, `removeMrHostRow(i)`), `testEmbed()`. Task 2 appends the sampling/prompt-injection/backend-URL sections and the final `save()` method.

- [ ] **Step 1: Write `new_ui/js/admin-config.js` (Part 1)**

```js
"use strict";

class AdminConfigView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    try {
      this.st = await api("/api/settings");
    } catch (e) {
      this.st = {};
      errorToast("Couldn't load settings.");
    }
    this.mrHosts = (this.st.model_request_hosts || []).map((h) => ({ host: h.host || "", api_key: "", has_api_key: !!h.has_api_key }));
    this.render();
  }

  mrHostRowHtml(row, i) {
    return `
      <div class="flex gap-2 items-center mb-1.5" data-mr-row="${i}">
        <input type="text" data-mr-host value="${_attr(row.host)}" placeholder="e.g. huggingface.co" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <input type="password" data-mr-key placeholder="${row.has_api_key ? "Key set — leave blank to keep" : "API key (optional)"}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <button type="button" onclick="adminConfigView.removeMrHostRow(${i})" class="px-2 py-2 rounded-md border text-xs flex-none" style="border-color:var(--color-warn);color:var(--color-warn)">×</button>
      </div>
    `;
  }

  syncMrHostsFromDom() {
    document.querySelectorAll("[data-mr-row]").forEach((row) => {
      const i = parseInt(row.dataset.mrRow, 10);
      if (!this.mrHosts[i]) return;
      this.mrHosts[i].host = row.querySelector("[data-mr-host]").value.trim();
      const key = row.querySelector("[data-mr-key]").value;
      if (key) this.mrHosts[i].api_key = key;
    });
  }

  addMrHostRow() {
    this.syncMrHostsFromDom();
    this.mrHosts.push({ host: "", api_key: "", has_api_key: false });
    this.render();
  }

  removeMrHostRow(i) {
    this.syncMrHostsFromDom();
    this.mrHosts.splice(i, 1);
    this.render();
  }

  async fetchModels() {
    const base = document.getElementById("cfg_base").value.trim();
    const key = document.getElementById("cfg_key").value.trim();
    const params = new URLSearchParams();
    if (base) params.set("base_url", base);
    if (key) params.set("api_key", key);
    try {
      const { models } = await api("/api/models" + (params.toString() ? "?" + params : ""));
      if (!models?.length) { toast("No models returned"); return; }
      const list = document.getElementById("cfg_model_list");
      list.innerHTML = models.map((m) => `<button type="button" class="px-2 py-1 rounded-md border border-line bg-surface-2 text-xs" onclick="document.getElementById('cfg_chat_model').value=this.dataset.m" data-m="${_attr(m)}">${_esc(m)}</button>`).join("");
    } catch (e) {
      errorToast("Fetch failed: " + e.message);
    }
  }

  async testEmbed() {
    try {
      const body = { embed_base_url: document.getElementById("cfg_embed_base").value.trim(), embed_model: document.getElementById("cfg_embed_model").value.trim() };
      const ekey = document.getElementById("cfg_embed_key").value.trim();
      if (ekey) body.embed_api_key = ekey;
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      const r = await api("/api/settings/test-embed", { method: "POST" });
      if (r.ok) toast(`Embeddings OK (${r.dim} dims) at ${r.url}`);
      else errorToast(r.error || "Embed test failed.");
    } catch (e) {
      errorToast("Test failed: " + e.message);
    }
  }

  render() {
    const st = this.st;
    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Server configuration", "Instance-wide defaults every user inherits.")}

      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">Default interface language</label>
        <input type="text" id="cfg_deflang" value="${_attr(st.default_language || "English")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>

      <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
        <div class="font-display font-semibold text-sm text-ink mb-3">Chat endpoint</div>
        <input type="text" id="cfg_base" value="${_attr(st.base_url || "")}" placeholder="http://koboldcpp:5001/v1" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <input type="password" id="cfg_key" placeholder="${st.has_api_key ? "Key set — leave blank to keep" : "API key (optional)"}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <div class="flex gap-2 mb-2">
          <input type="text" id="cfg_chat_model" value="${_attr(st.chat_model || "")}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <button type="button" onclick="adminConfigView.fetchModels()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">Fetch</button>
        </div>
        <div id="cfg_model_list" class="flex flex-wrap gap-1.5"></div>
      </div>

      <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
        <div class="font-display font-semibold text-sm text-ink mb-3">Embed endpoint <span class="text-xs text-muted font-normal">(blank = reuse chat endpoint)</span></div>
        <input type="text" id="cfg_embed_base" value="${_attr(st.embed_base_url || "")}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <input type="password" id="cfg_embed_key" placeholder="${st.has_embed_api_key ? "Key set — leave blank to keep" : "API key (optional)"}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <div class="grid grid-cols-2 gap-2 mb-2">
          <input type="text" id="cfg_embed_model" value="${_attr(st.embed_model || "")}" placeholder="nomic-embed-text" class="px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <input type="text" id="cfg_dim" value="${_attr(st.embed_dim ?? 768)}" class="px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        </div>
        <button type="button" onclick="adminConfigView.testEmbed()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">Test</button>
      </div>

      <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
        <div class="font-display font-semibold text-sm text-ink mb-3">ComfyUI</div>
        <input type="text" id="cfg_comfy_url" value="${_attr(st.comfyui_url || "")}" placeholder="http://comfyui:8188" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <input type="text" id="cfg_comfy_ckpt" value="${_attr(st.comfyui_checkpoint || "")}" placeholder="Default checkpoint" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      </div>

      <div class="mb-4">
        <div class="font-display font-semibold text-sm text-ink mb-2">Model request hosts</div>
        <p class="text-xs text-muted mb-2">Hosts allowed for user-submitted model download requests.</p>
        <div id="cfg_mr_hosts">${this.mrHosts.map((h, i) => this.mrHostRowHtml(h, i)).join("")}</div>
        <button type="button" onclick="adminConfigView.addMrHostRow()" class="text-xs mt-1" style="color:var(--color-accent)">+ Add host</button>
      </div>

      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">Embed-link preview hosts <span class="text-muted">(one per line)</span></label>
        <textarea id="cfg_embed_hosts" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm font-mono" style="min-height:60px">${_esc((st.embed_link_hosts || []).join("\n"))}</textarea>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs text-sec mb-1">Past messages remembered</label>
          <input type="text" id="cfg_hist" value="${_attr(st.history_turns ?? 16)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div>
          <label class="block text-xs text-sec mb-1">Max reply tokens</label>
          <input type="text" id="cfg_max" value="${_attr(st.max_tokens ?? 4096)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
      </div>
      <label class="flex items-center gap-2.5 mb-5 text-sm text-ink">
        <input type="checkbox" id="cfg_think" ${st.enable_thinking ? "checked" : ""}>
        Enable thinking by default
      </label>

      <div id="cfg_extra_sections"></div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.AdminConfigView = AdminConfigView;
}
```

- [ ] **Step 2: Register the route**

Check `git status --short new_ui/js/router.js new_ui/index.html` first. Add to `routes`:

```js
  "admin-config": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminConfigView = new AdminConfigView();
    window.adminConfigView.mount(main);
  },
```

Add to `TAB_FOR_ROUTE`: `"admin-config": "dossier",`

Add to `index.html`, after `admin-emojis.js`'s script tag: `<script src="/js/admin-config.js" defer></script>`

- [ ] **Step 3: Link from the Overview dashboard**

In `new_ui/js/admin.js`, read the current file to find the "Emojis & stickers" section block, add a matching block immediately after it:

```js
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">Server configuration</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-config')">Open →</span>
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
    page.goto("http://localhost:3001/admin-config")
    page.wait_for_selector("text=Server configuration", timeout=8000)
    assert page.is_visible("text=Chat endpoint")
    assert page.is_visible("text=Embed endpoint")
    assert page.is_visible("text=Model request hosts")
    print("OK: config screen Part 1 renders")
    browser.close()
EOF
```

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-config.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
git diff --cached --stat
git commit -m "Add Admin Server Config screen: endpoints, host allowlists, memory defaults"
git diff HEAD --stat -- new_ui/js/admin-config.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
```

---

### Task 2: Sampling defaults, prompt injection, backend URL, save

**Files:**
- Modify: `new_ui/js/admin-config.js`

**Interfaces:**
- Consumes: `AdminConfigView` (Task 1), `this.st`, `this.mrHosts`, `this.syncMrHostsFromDom()`.
- Produces: `AdminConfigView.prototype.save()` — the complete deliverable; final `render()` reassignment appending the remaining sections.

- [ ] **Step 1: Append to `new_ui/js/admin-config.js`** (before the final `if (typeof window...)` block)

```js
const ADMIN_CFG_SAMPLING_FIELDS = [
  { id: "temperature", label: "Temperature", min: 0, max: 2, step: 0.01, fallback: 0.85 },
  { id: "top_p", label: "Top-p", min: 0, max: 1, step: 0.01, fallback: 0.9 },
  { id: "top_k", label: "Top-k", min: 0, max: 100, step: 1, fallback: 0 },
  { id: "min_p", label: "Min-p", min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: "top_a", label: "Top-a", min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: "typical_p", label: "Typical-p", min: 0, max: 1, step: 0.01, fallback: 1 },
  { id: "tfs", label: "TFS", min: 0, max: 1, step: 0.01, fallback: 1 },
  { id: "repetition_penalty", label: "Repetition penalty", min: 0.5, max: 2, step: 0.01, fallback: 1 },
  { id: "repetition_penalty_range", label: "Rep. penalty range", min: 0, max: 2048, step: 16, fallback: 0 },
  { id: "frequency_penalty", label: "Frequency penalty", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "presence_penalty", label: "Presence penalty", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "smoothing_factor", label: "Smoothing", min: 0, max: 5, step: 0.01, fallback: 0 },
  { id: "dynatemp_low", label: "DynaTemp low", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "dynatemp_high", label: "DynaTemp high", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "mirostat_tau", label: "Mirostat τ", min: 0, max: 10, step: 0.1, fallback: 5 },
  { id: "mirostat_eta", label: "Mirostat η", min: 0, max: 1, step: 0.01, fallback: 0.1 },
  { id: "dry_multiplier", label: "DRY multiplier", min: 0, max: 5, step: 0.01, fallback: 0 },
  { id: "dry_base", label: "DRY base", min: 0, max: 3, step: 0.01, fallback: 1.75 },
  { id: "dry_allowed_length", label: "DRY allowed length", min: 0, max: 50, step: 1, fallback: 2 },
  { id: "xtc_threshold", label: "XTC threshold", min: 0, max: 1, step: 0.01, fallback: 0.1 },
  { id: "xtc_probability", label: "XTC probability", min: 0, max: 1, step: 0.01, fallback: 0 },
];

Object.assign(AdminConfigView.prototype, {
  extraSectionsHtml() {
    const st = this.st;
    const sliderRows = ADMIN_CFG_SAMPLING_FIELDS.map((f) => `
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${f.label}</label>
        <div class="flex items-center gap-2">
          <input type="range" id="cfg_${f.id}_range" min="${f.min}" max="${f.max}" step="${f.step}" value="${st[f.id] ?? f.fallback}"
            oninput="document.getElementById('cfg_${f.id}').value = this.value" class="flex-1">
          <input type="number" id="cfg_${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${st[f.id] ?? f.fallback}"
            oninput="document.getElementById('cfg_${f.id}_range').value = this.value" class="w-20 px-2 py-1 rounded-md border border-line bg-surface text-ink text-xs font-mono">
        </div>
      </div>
    `).join("");

    return `
      <div class="mb-2 font-display font-semibold text-base text-ink">Sampling defaults</div>
      <p class="text-xs text-muted mb-3">Applies to every user who hasn't overridden a field in their own settings.</p>
      <div class="grid grid-cols-2 gap-x-4 mb-3">${sliderRows}</div>
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label class="block text-xs text-sec mb-1">Mirostat mode</label>
          <input type="text" id="cfg_mirostat_mode" value="${_attr(st.mirostat_mode ?? 0)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div>
          <label class="block text-xs text-sec mb-1">Seed <span class="text-muted">(-1 = random)</span></label>
          <input type="text" id="cfg_seed" value="${_attr(st.seed ?? -1)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
      </div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">Stop sequences <span class="text-muted">(one per line)</span></label>
        <textarea id="cfg_stop" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-xs font-mono" style="min-height:52px">${_esc((st.stop || []).join("\n"))}</textarea>
      </div>
      <div class="mb-5">
        <label class="block text-xs text-sec mb-1">Extra params <span class="text-muted">(JSON)</span></label>
        <textarea id="cfg_extra" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-xs font-mono" style="min-height:52px">${Object.keys(st.extra_params || {}).length ? _esc(JSON.stringify(st.extra_params, null, 2)) : ""}</textarea>
      </div>

      <div class="mb-2 font-display font-semibold text-base text-ink">Prompt injection</div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">System suffix</label>
        <textarea id="cfg_suffix" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(st.system_suffix || "")}</textarea>
      </div>
      <div class="mb-5">
        <label class="block text-xs text-sec mb-1">Post-history instructions</label>
        <textarea id="cfg_posthist" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(st.post_history || "")}</textarea>
      </div>

      <div class="mb-2 font-display font-semibold text-base text-ink">Backend</div>
      <p class="text-xs text-muted mb-2">Where this app itself sends API requests. Changing this requires a page reload to take effect.</p>
      <div class="mb-5">
        <input type="text" id="cfg_api" value="${_attr(store.get("apiBase", ""))}" placeholder="(same origin)" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>

      <button type="button" onclick="adminConfigView.save()" class="w-full py-3 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">
        Save configuration
      </button>
    `;
  },

  numOrFallback(id, fallback) {
    const v = parseFloat(document.getElementById(id)?.value ?? "");
    return isNaN(v) ? fallback : v;
  },

  intOrFallback(id, fallback) {
    const v = parseInt(document.getElementById(id)?.value ?? "", 10);
    return isNaN(v) ? fallback : v;
  },

  async save() {
    this.syncMrHostsFromDom();
    let extra = {};
    const extraText = document.getElementById("cfg_extra").value.trim();
    if (extraText) {
      try { extra = JSON.parse(extraText); } catch (e) { toast("Extra params JSON invalid — ignored."); }
    }
    const strOrNull = (id) => document.getElementById(id).value.trim() || null;
    const body = {
      default_language: strOrNull("cfg_deflang") || "English",
      base_url: strOrNull("cfg_base"),
      chat_model: strOrNull("cfg_chat_model"),
      embed_base_url: strOrNull("cfg_embed_base"),
      embed_model: strOrNull("cfg_embed_model"),
      embed_dim: this.intOrFallback("cfg_dim", 768),
      comfyui_url: strOrNull("cfg_comfy_url"),
      comfyui_checkpoint: strOrNull("cfg_comfy_ckpt"),
      model_request_hosts: this.mrHosts.filter((h) => h.host).map((h) => ({ host: h.host, api_key: h.api_key || "" })),
      embed_link_hosts: (document.getElementById("cfg_embed_hosts").value || "").split("\n").map((s) => s.trim()).filter(Boolean),
      history_turns: this.intOrFallback("cfg_hist", 16),
      max_tokens: this.intOrFallback("cfg_max", 4096),
      enable_thinking: !!document.getElementById("cfg_think").checked,
      temperature: this.numOrFallback("cfg_temperature", 0.85),
      top_p: this.numOrFallback("cfg_top_p", 0.9),
      top_k: this.intOrFallback("cfg_top_k", 0),
      min_p: this.numOrFallback("cfg_min_p", 0),
      top_a: this.numOrFallback("cfg_top_a", 0),
      typical_p: this.numOrFallback("cfg_typical_p", 1),
      tfs: this.numOrFallback("cfg_tfs", 1),
      repetition_penalty: this.numOrFallback("cfg_repetition_penalty", 1),
      repetition_penalty_range: this.intOrFallback("cfg_repetition_penalty_range", 0),
      frequency_penalty: this.numOrFallback("cfg_frequency_penalty", 0),
      presence_penalty: this.numOrFallback("cfg_presence_penalty", 0),
      smoothing_factor: this.numOrFallback("cfg_smoothing_factor", 0),
      dynatemp_low: this.numOrFallback("cfg_dynatemp_low", 0),
      dynatemp_high: this.numOrFallback("cfg_dynatemp_high", 0),
      mirostat_mode: this.intOrFallback("cfg_mirostat_mode", 0),
      mirostat_tau: this.numOrFallback("cfg_mirostat_tau", 5),
      mirostat_eta: this.numOrFallback("cfg_mirostat_eta", 0.1),
      dry_multiplier: this.numOrFallback("cfg_dry_multiplier", 0),
      dry_base: this.numOrFallback("cfg_dry_base", 1.75),
      dry_allowed_length: this.intOrFallback("cfg_dry_allowed_length", 2),
      xtc_threshold: this.numOrFallback("cfg_xtc_threshold", 0.1),
      xtc_probability: this.numOrFallback("cfg_xtc_probability", 0),
      seed: this.intOrFallback("cfg_seed", -1),
      stop: (document.getElementById("cfg_stop").value || "").split("\n").map((s) => s.trim()).filter(Boolean),
      extra_params: extra,
      system_suffix: document.getElementById("cfg_suffix").value || null,
      post_history: document.getElementById("cfg_posthist").value || null,
    };
    const key = document.getElementById("cfg_key").value.trim();
    if (key) body.api_key = key;
    const ekey = document.getElementById("cfg_embed_key").value.trim();
    if (ekey) body.embed_api_key = ekey;

    const newApiBase = document.getElementById("cfg_api").value.trim();
    const apiBaseChanged = newApiBase !== store.get("apiBase", "");

    try {
      const r = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      if (apiBaseChanged) store.set("apiBase", newApiBase);
      this.st = r;
      this.mrHosts = (r.model_request_hosts || []).map((h) => ({ host: h.host || "", api_key: "", has_api_key: !!h.has_api_key }));
      toast(r.reindexed ? "Saved — vector index rebuilt." : (apiBaseChanged ? "Saved. Reload the page for the new backend URL to take effect." : "Configuration saved."));
      this.render();
    } catch (e) {
      errorToast("Save failed: " + e.message);
    }
  },
});

AdminConfigView.prototype.render = function () {
  const st = this.st;
  this.main.innerHTML = `
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", "Server configuration", "Instance-wide defaults every user inherits.")}

    <div class="mb-3">
      <label class="block text-xs text-sec mb-1">Default interface language</label>
      <input type="text" id="cfg_deflang" value="${_attr(st.default_language || "English")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">Chat endpoint</div>
      <input type="text" id="cfg_base" value="${_attr(st.base_url || "")}" placeholder="http://koboldcpp:5001/v1" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <input type="password" id="cfg_key" placeholder="${st.has_api_key ? "Key set — leave blank to keep" : "API key (optional)"}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <div class="flex gap-2 mb-2">
        <input type="text" id="cfg_chat_model" value="${_attr(st.chat_model || "")}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <button type="button" onclick="adminConfigView.fetchModels()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">Fetch</button>
      </div>
      <div id="cfg_model_list" class="flex flex-wrap gap-1.5"></div>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">Embed endpoint <span class="text-xs text-muted font-normal">(blank = reuse chat endpoint)</span></div>
      <input type="text" id="cfg_embed_base" value="${_attr(st.embed_base_url || "")}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <input type="password" id="cfg_embed_key" placeholder="${st.has_embed_api_key ? "Key set — leave blank to keep" : "API key (optional)"}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input type="text" id="cfg_embed_model" value="${_attr(st.embed_model || "")}" placeholder="nomic-embed-text" class="px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <input type="text" id="cfg_dim" value="${_attr(st.embed_dim ?? 768)}" class="px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      </div>
      <button type="button" onclick="adminConfigView.testEmbed()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">Test</button>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">ComfyUI</div>
      <input type="text" id="cfg_comfy_url" value="${_attr(st.comfyui_url || "")}" placeholder="http://comfyui:8188" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <input type="text" id="cfg_comfy_ckpt" value="${_attr(st.comfyui_checkpoint || "")}" placeholder="Default checkpoint" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
    </div>

    <div class="mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-2">Model request hosts</div>
      <p class="text-xs text-muted mb-2">Hosts allowed for user-submitted model download requests.</p>
      <div id="cfg_mr_hosts">${this.mrHosts.map((h, i) => this.mrHostRowHtml(h, i)).join("")}</div>
      <button type="button" onclick="adminConfigView.addMrHostRow()" class="text-xs mt-1" style="color:var(--color-accent)">+ Add host</button>
    </div>

    <div class="mb-4">
      <label class="block text-xs text-sec mb-1">Embed-link preview hosts <span class="text-muted">(one per line)</span></label>
      <textarea id="cfg_embed_hosts" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm font-mono" style="min-height:60px">${_esc((st.embed_link_hosts || []).join("\n"))}</textarea>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs text-sec mb-1">Past messages remembered</label>
        <input type="text" id="cfg_hist" value="${_attr(st.history_turns ?? 16)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div>
        <label class="block text-xs text-sec mb-1">Max reply tokens</label>
        <input type="text" id="cfg_max" value="${_attr(st.max_tokens ?? 4096)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
    </div>
    <label class="flex items-center gap-2.5 mb-5 text-sm text-ink">
      <input type="checkbox" id="cfg_think" ${st.enable_thinking ? "checked" : ""}>
      Enable thinking by default
    </label>

    ${this.extraSectionsHtml()}
  `;
};
```

This final `render()` replaces Task 1's version (same `Object.assign` + full-reassignment split pattern already used by `settings-appearance.js`/`admin-moderation.js` across their own multi-task builds). Ensure the file ends with exactly ONE `render()` assignment after this step.

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
    page.goto("http://localhost:3001/admin-config")
    page.wait_for_selector("text=Sampling defaults", timeout=8000)
    assert page.is_visible("text=Prompt injection")
    assert page.is_visible("text=Save configuration")

    with page.expect_response(lambda r: "/api/settings" in r.url and r.request.method == "PUT") as ri:
        page.check("#cfg_think")
        page.click("text=Save configuration")
    print("save status:", ri.value.status)

    with page.expect_response(lambda r: "/api/settings" in r.url and r.request.method == "PUT") as ri2:
        page.uncheck("#cfg_think")
        page.click("text=Save configuration")
    print("revert status:", ri2.value.status)
    browser.close()
EOF
```

Expected: both statuses `200`. This test toggles `enable_thinking` and immediately reverts it, leaving the live config unchanged — do not skip the revert step.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-config.js
git diff --cached --stat
git commit -m "Add Admin Server Config sampling defaults, prompt injection, backend URL, and save"
git diff HEAD --stat -- new_ui/js/admin-config.js
```

---

## Self-Review Notes

- **Spec coverage:** Language/endpoints/host-allowlists/memory-thinking ✓ Task 1. Full sampling grid/prompt-injection/backend-URL/save ✓ Task 2. Single unified save button (deliberate simplification from legacy's two-button split, documented in the spec) ✓. `apiBase` store-key correction (not `"api"`) ✓, with a reload-required note instead of attempting to reassign a `const` ✓.
- **Type consistency:** `this.mrHosts`/`this.st` set in `mount()` (Task 1) are read identically by `save()` (Task 2) and the final `render()`. `mrHostRowHtml`/`syncMrHostsFromDom`/`addMrHostRow`/`removeMrHostRow` (Task 1) are called unchanged from the final `render()`/`save()` (Task 2).
- **No placeholders:** every step has complete, runnable code.
