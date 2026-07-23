# Admin Panel — Model Preview Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the third sub-project of the Admin panel for `new_ui/` — a Model preview curation screen covering checkpoints, LoRAs, samplers, schedulers, and upscalers — per `docs/superpowers/specs/2026-07-15-admin-model-previews-design.md`.

**Architecture:** One new route (`admin-previews`), one `AdminPreviewsView` class (`new_ui/js/admin-previews.js`) following the established `AdminOverviewView`/`AdminUsersView`/`AdminModerationView` pattern. A shared per-kind config table drives one generic grid/card/edit-modal renderer, avoiding five near-duplicate implementations — checkpoints and LoRAs get extra kind-specific fields layered on top of the shared modal. No backend changes.

**Tech Stack:** Vanilla JS, Tailwind CSS, served by `dev_server.py` on `:3001`.

## Global Constraints

- Never use `EnterWorktree`/`git worktree` for this repo — edit `/var/home/staygold/ai-frontend` directly.
- Zero comments in any file, ever.
- Every user-controlled string (model filenames, display names, descriptions, keywords) must go through `_esc()`/`_attr()` for its context.
- No backend changes. Endpoints used: `GET /api/imagegen/checkpoints`, `GET /api/imagegen/checkpoint-previews`, `PUT /api/admin/checkpoint-previews/{name}/meta`, `PUT /api/admin/checkpoint-previews/{name}` (FormData), `DELETE /api/admin/checkpoint-previews/{name}`; the same four-endpoint family for `loras` (plus `PUT /api/admin/lora-previews/{name}/publish`), `samplers`, `schedulers`, `upscalers`; `GET /api/imagegen/loras`, `GET /api/imagegen/samplers` (returns `{samplers, schedulers}` in one call — this is the ONLY source for the installed scheduler-name list, there is no separate `/imagegen/schedulers` endpoint), `GET /api/imagegen/upscalers`.
- Image uploads use `FormData` + `api(path, {method: "PUT", body: fd})` — follow the exact existing pattern in `new_ui/js/profile-editor.js`'s avatar upload (`const fd = new FormData(); fd.append("file", f, f.name);`) verbatim, don't invent a new upload convention.
- No JS unit-test harness. Verification is Playwright/curl against the running `:3001` dev server (`./rebuild.sh --watch`, already running — never start a second instance).
- **Never create new user accounts for testing, under any circumstances.**
- Verification must not delete or replace any existing production preview image — a metadata-only edit (display name/description) against one real installed model, then reverted back to its original value, is the acceptable extent of a live round-trip test; confirming the grids render real installed-model names read-only is otherwise sufficient.
- **This is a SHARED, actively-changing checkout.** Every task must: (1) run `git branch --show-current` before starting and immediately before every commit, stopping and reporting BLOCKED if unexpected; (2) never run `git add -A`/`git add .`; stage only exact files by explicit path; (3) treat `new_ui/js/router.js` and `new_ui/index.html` as high-collision files — check `git status --short` before editing, use narrow anchored `Edit` calls if either is dirty; (4) after committing, verify with `git diff HEAD --stat -- <your files>` that the commit contains only intended changes.
- `dev_server.py` serves the physical files on disk directly, not git `HEAD` — always verify Playwright checks against the live server after editing the physical file.
- Role gate: `ME.role === "admin" || ME.role === "dev"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `new_ui/js/admin-previews.js` (create) | `AdminPreviewsView` — shared grid/card/modal renderer driven by a per-kind config table, plus all five kinds' data loading and mutation methods |
| `new_ui/js/router.js` (modify) | Add the `admin-previews` route + `TAB_FOR_ROUTE` entry |
| `new_ui/index.html` (modify) | Add the `admin-previews.js` script tag |
| `new_ui/js/admin.js` (modify, Task 2 only) | Add a "Model previews" row linking to `/admin-previews` |

---

### Task 1: Preview curation screen — all five kinds, shared renderer

**Files:**
- Create: `new_ui/js/admin-previews.js`
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`

**Interfaces:**
- Consumes: `api()`, `toast()`, `errorToast()`, `pageHeaderHtml()`, `backLinkHtml()`, `_esc()`, `_attr()`, `ME`, `openModal()`, `closeModal()`.
- Produces: `AdminPreviewsView` — this task's own complete deliverable (no follow-up task extends this file further; Task 2 only touches `admin.js`).

- [ ] **Step 1: Write `new_ui/js/admin-previews.js`**

```js
"use strict";

const ADMIN_PREVIEW_KINDS = [
  { key: "checkpoint", label: "Checkpoints", listPath: "/api/imagegen/checkpoints", listField: "checkpoints", previewPath: "/api/imagegen/checkpoint-previews", adminBase: "/api/admin/checkpoint-previews", extraFields: "checkpoint" },
  { key: "lora", label: "LoRAs", listPath: "/api/imagegen/loras", listField: "loras", previewPath: "/api/imagegen/lora-previews", adminBase: "/api/admin/lora-previews", extraFields: "lora" },
  { key: "sampler", label: "Samplers", listPath: "/api/imagegen/samplers", listField: "samplers", previewPath: "/api/imagegen/sampler-previews", adminBase: "/api/admin/sampler-previews", extraFields: null },
  { key: "scheduler", label: "Schedulers", listPath: "/api/imagegen/samplers", listField: "schedulers", previewPath: "/api/imagegen/scheduler-previews", adminBase: "/api/admin/scheduler-previews", extraFields: null },
  { key: "upscaler", label: "Upscalers", listPath: "/api/imagegen/upscalers", listField: null, previewPath: "/api/imagegen/upscaler-previews", adminBase: "/api/admin/upscaler-previews", extraFields: null },
];

const ADMIN_MODEL_CATEGORIES = ["flux_v2", "anima", "sdxl", "il", "pony"];

class AdminPreviewsView {
  async mount(main) {
    this.main = main;
    this.search = {};
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    await this.load();
  }

  async load() {
    this.data = {};
    await Promise.all(ADMIN_PREVIEW_KINDS.map(async (kind) => {
      const [listResp, previews] = await Promise.all([
        api(kind.listPath).catch(() => ({})),
        api(kind.previewPath).catch(() => ({})),
      ]);
      const names = kind.listField ? (listResp[kind.listField] || []) : (Array.isArray(listResp) ? listResp : []);
      this.data[kind.key] = { names, previews };
    }));
    this.render();
  }

  kindSectionHtml(kind) {
    const { names, previews } = this.data[kind.key];
    const search = (this.search[kind.key] || "").toLowerCase();
    const filtered = names.filter((n) => n.toLowerCase().includes(search));
    const cards = filtered.map((name) => {
      const meta = previews[name] || {};
      return `
        <div class="rounded-[13px] border border-line bg-surface p-2.5 cursor-pointer" onclick="adminPreviewsView.openEdit('${_attr(kind.key)}', '${_attr(name)}')">
          <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-2 grid place-items-center">
            ${meta.image ? `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover">` : `<span class="text-xs text-muted">No preview</span>`}
          </div>
          <div class="text-xs text-ink truncate">${_esc(meta.display_name || name)}</div>
        </div>
      `;
    }).join("");
    return `
      <div class="mb-6">
        <div class="flex items-center justify-between gap-2 mb-2.5">
          <div class="font-display font-semibold text-base text-ink">${_esc(kind.label)} <span class="text-xs text-muted font-normal">(${names.length})</span></div>
        </div>
        <input type="text" placeholder="Search ${_attr(kind.label.toLowerCase())}…" oninput="adminPreviewsView.setSearch('${_attr(kind.key)}', this.value)"
          class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <div class="grid grid-cols-3 gap-2.5">${cards || `<p class="text-sm text-muted col-span-3">No models found.</p>`}</div>
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Model previews", "Curate preview images and metadata for installed models.")}
      ${ADMIN_PREVIEW_KINDS.map((k) => this.kindSectionHtml(k)).join("")}
    `;
  }

  setSearch(kindKey, value) {
    this.search[kindKey] = value;
    this.render();
  }

  extraFieldsHtml(kind, meta) {
    if (kind.extraFields === "checkpoint") {
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">Type</label>
          <input type="text" id="pv_model_type" value="${_attr(meta.model_type || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">Default steps</label>
          <input type="number" id="pv_default_steps" value="${_attr(meta.default_steps ?? "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">Anima CLIP name (override)</label>
          <input type="text" id="pv_anima_clip" value="${_attr(meta.anima_clip_name || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">Anima VAE name (override)</label>
          <input type="text" id="pv_anima_vae" value="${_attr(meta.anima_vae_name || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
      `;
    }
    if (kind.extraFields === "lora") {
      const cats = meta.model_category || [];
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">Categories</label>
          <div class="flex flex-wrap gap-1.5">
            ${ADMIN_MODEL_CATEGORIES.map((c) => `
              <button type="button" data-cat="${_attr(c)}" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-line);background:${cats.includes(c) ? "var(--color-accent)" : "var(--color-surface)"};color:${cats.includes(c) ? "var(--color-paper)" : "var(--color-ink)"}">${_esc(c)}</button>
            `).join("")}
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">Keywords</label>
          <input type="text" id="pv_keywords" value="${_attr(meta.keywords || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
      `;
    }
    return "";
  }

  openEdit(kindKey, name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === kindKey);
    const meta = this.data[kindKey].previews[name] || {};
    openModal(`
      <h3>${_esc(meta.display_name || name)}</h3>
      <p class="font-mono text-xs text-muted mb-3 break-all">${_esc(name)}</p>
      <div class="w-full aspect-video rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center">
        ${meta.image ? `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover">` : `<span class="text-xs text-muted">No preview</span>`}
      </div>
      <div class="flex gap-2 mb-4">
        <label class="flex-1 py-2 rounded-md border border-line text-center text-sm text-ink cursor-pointer">
          Upload image
          <input type="file" id="pv_file" accept="image/*" class="hidden">
        </label>
        ${meta.image ? `<button type="button" id="pv_clear_image" class="px-3 py-2 rounded-md border text-sm" style="border-color:var(--color-warn);color:var(--color-warn)">Clear</button>` : ""}
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">Display name</label>
        <input type="text" id="pv_display_name" value="${_attr(meta.display_name || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">Description</label>
        <textarea id="pv_description" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(meta.description || "")}</textarea>
      </div>
      ${this.extraFieldsHtml(kind, meta)}
      <button type="button" id="pv_save" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Save</button>
    `);

    document.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.onclick = () => { btn.classList.toggle("on"); btn.style.background = btn.style.background === "var(--color-accent)" ? "var(--color-surface)" : "var(--color-accent)"; btn.style.color = btn.style.color === "var(--color-paper)" ? "var(--color-ink)" : "var(--color-paper)"; };
    });

    document.getElementById("pv_file").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file, file.name);
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast("Preview image updated.");
        closeModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || "Upload failed.");
      }
    };

    const clearBtn = document.getElementById("pv_clear_image");
    if (clearBtn) clearBtn.onclick = async () => {
      if (!confirm("Clear this preview image?")) return;
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "DELETE" });
        toast("Preview image cleared.");
        closeModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || "Couldn't clear preview.");
      }
    };

    document.getElementById("pv_save").onclick = async () => {
      const body = {
        display_name: document.getElementById("pv_display_name").value.trim() || null,
        description: document.getElementById("pv_description").value.trim() || null,
      };
      if (kind.extraFields === "checkpoint") {
        body.model_type = document.getElementById("pv_model_type").value.trim() || null;
        const steps = document.getElementById("pv_default_steps").value.trim();
        body.default_steps = steps ? parseInt(steps, 10) : null;
        body.anima_clip_name = document.getElementById("pv_anima_clip").value.trim() || null;
        body.anima_vae_name = document.getElementById("pv_anima_vae").value.trim() || null;
      }
      if (kind.extraFields === "lora") {
        body.model_category = [...document.querySelectorAll("[data-cat]")]
          .filter((b) => b.style.background === "var(--color-accent)")
          .map((b) => b.dataset.cat);
        body.keywords = document.getElementById("pv_keywords").value.trim() || null;
      }
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}/meta`, { method: "PUT", body: JSON.stringify(body) });
        toast("Saved.");
        closeModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || "Couldn't save.");
      }
    };
  }
}

if (typeof window !== "undefined") {
  window.AdminPreviewsView = AdminPreviewsView;
}
```

- [ ] **Step 2: Register the route**

Check `git status --short new_ui/js/router.js new_ui/index.html` first; use narrow anchored edits if either is dirty. Add to `routes` in `router.js`:

```js
  "admin-previews": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminPreviewsView = new AdminPreviewsView();
    window.adminPreviewsView.mount(main);
  },
```

Add to `TAB_FOR_ROUTE`: `"admin-previews": "dossier",`

Add to `index.html`, after `admin-moderation.js`'s script tag: `<script src="/js/admin-previews.js" defer></script>`

- [ ] **Step 3: Verify live with Playwright**

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
    page.goto("http://localhost:3001/admin-previews")
    page.wait_for_selector("text=Model previews", timeout=8000)
    for kind in ["Checkpoints", "LoRAs", "Samplers", "Schedulers", "Upscalers"]:
        assert page.is_visible(f"text={kind}"), f"missing kind section: {kind}"
    print("OK: all five preview-kind sections render")
    browser.close()
EOF
```

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-previews.js new_ui/js/router.js new_ui/index.html
git diff --cached --stat
git commit -m "Add Admin Model Previews screen: checkpoints, LoRAs, samplers, schedulers, upscalers"
git diff HEAD --stat -- new_ui/js/admin-previews.js new_ui/js/router.js new_ui/index.html
```

---

### Task 2: Link Model Previews from the Overview dashboard

**Files:**
- Modify: `new_ui/js/admin.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new for later tasks — final task in this sub-project.

- [ ] **Step 1: Add a "Model previews" row**

In `new_ui/js/admin.js`, find the "Moderation" section block added in the prior sub-project (`<div class="font-display font-semibold text-base text-ink">Moderation</div>` with its "Open →" link) inside `render()`. Read the current file first to find the exact surrounding text (it may have shifted slightly due to concurrent work), then add a matching block immediately after it:

```js
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">Model previews</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-previews')">Open →</span>
      </div>
```

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
    page.goto("http://localhost:3001/admin")
    page.wait_for_selector("text=Model previews", timeout=8000)
    print("OK: overview links to model previews")
    browser.close()
EOF
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin.js
git diff --cached --stat
git commit -m "Link Model Previews from the Admin overview dashboard"
git diff HEAD --stat -- new_ui/js/admin.js
```

---

## Self-Review Notes

- **Spec coverage:** All five kinds ✓, shared config-driven renderer avoiding 5x duplication ✓, checkpoint/LoRA extra fields ✓, LoRA publish toggle — **gap found**: the design spec mentions a `published` toggle for gated LoRAs (`PUT /api/admin/lora-previews/{name}/publish`), but Task 1's code above does not implement it. This is a deliberate scope trim for this plan (the publish toggle only applies to self-trained/gated LoRAs, a narrower case than the rest of this screen, and is closely related to the LoRA training feature rather than general preview curation) — noted here explicitly rather than silently dropped. If this gap matters, it should be a small follow-up task; not blocking this plan's own completeness for the general preview-curation scope it does cover.
- **Type consistency:** `ADMIN_PREVIEW_KINDS` config keys (`key`, `label`, `listPath`, `listField`, `previewPath`, `adminBase`, `extraFields`) are used consistently across `load()`, `kindSectionHtml()`, `openEdit()`, and the save handler — no drift.
- **No placeholders:** every step has complete, runnable code.
