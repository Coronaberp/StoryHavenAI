# Admin Panel — Emoji/Sticker Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fourth sub-project of the Admin panel for `new_ui/` — Emoji/sticker moderation — per `docs/superpowers/specs/2026-07-15-admin-emojis-design.md`.

**Architecture:** One new route (`admin-emojis`), one `AdminEmojisView` class following the established admin-route pattern. No backend changes.

**Tech Stack:** Vanilla JS, Tailwind CSS, served by `dev_server.py` on `:3001`.

## Global Constraints

- Never use `EnterWorktree`/`git worktree` for this repo.
- Zero comments in any file, ever.
- Every user-controlled string (`shortcode`, `uploader_username`) must go through `_esc()`/`_attr()` for its context. This branch has shipped real injection bugs from missed escaping FOUR times this session — the specific recurring shape is a single-quote-wrapped `_attr()` call around free-text embedded in an inline `onclick`; never write `onclick="fn('${_attr(x)}')"` for anything that isn't a server-generated opaque id — use `onclick="fn(${_attr(JSON.stringify(x))})"` instead for any free-text value (matches the established, twice-proven-correct pattern in `new_ui/js/admin-users.js`'s `setIdentityLabel` button and `new_ui/js/admin-previews.js`'s `openEdit` button).
- No backend changes. Endpoints used: `GET /api/admin/emojis`, `POST /api/emojis` (FormData: shortcode, kind, file), `POST /api/admin/emojis/{eid}/approve`, `PATCH /api/admin/emojis/{eid}` (JSON: shortcode, kind), `DELETE /api/emojis/{eid}`.
- Image upload uses `FormData` + `api(path, {method: "POST", body: fd})`, following the exact pattern in `new_ui/js/profile-editor.js`'s avatar upload.
- No JS unit-test harness. Verification is Playwright against the running `:3001` dev server (`./rebuild.sh --watch`, already running — never start a second instance).
- **Never create new user accounts for testing, under any circumstances.** Creating a throwaway emoji/sticker record (not a user account) via the panel's own add feature, then deleting it at the end of verification, is in-scope and fine.
- **This is a SHARED, actively-changing checkout.** Run `git branch --show-current` before starting and before every commit, stopping if unexpected. Never `git add -A`/`git add .`. Treat `new_ui/js/router.js`/`new_ui/index.html` as high-collision — check `git status --short` before editing, use narrow anchored `Edit` calls if dirty. Verify `git diff HEAD --stat -- <your files>` after committing.
- `dev_server.py` serves the physical files on disk directly, not git `HEAD`.
- Role gate: `ME.role === "admin" || ME.role === "dev"`.

---

## File Structure

| File | Responsibility |
|---|---|
| `new_ui/js/admin-emojis.js` (create) | `AdminEmojisView` — add-new form, pending-review queue, approved queue, edit modal |
| `new_ui/js/router.js` (modify) | Add the `admin-emojis` route + `TAB_FOR_ROUTE` entry |
| `new_ui/index.html` (modify) | Add the `admin-emojis.js` script tag |
| `new_ui/js/admin.js` (modify) | Add an "Emojis & stickers" row linking to `/admin-emojis` |

---

### Task 1: Emoji moderation screen (complete, single task given its small scope)

**Files:**
- Create: `new_ui/js/admin-emojis.js`
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`
- Modify: `new_ui/js/admin.js`

**Interfaces:**
- Consumes: `api()`, `toast()`, `errorToast()`, `pageHeaderHtml()`, `backLinkHtml()`, `_esc()`, `_attr()`, `ME`, `openModal()`, `closeModal()`.
- Produces: `AdminEmojisView` — complete deliverable, no follow-up task.

- [ ] **Step 1: Write `new_ui/js/admin-emojis.js`**

```js
"use strict";

function adminEmojiCardHtml(e) {
  const badge = e.is_explicit
    ? `<span class="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-md" style="background:var(--color-warn);color:var(--color-paper)">Pending review</span>`
    : "";
  const actions = e.is_explicit
    ? `<button type="button" onclick="adminEmojisView.approveEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Approve</button>
       <button type="button" onclick="adminEmojisView.deleteEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Delete</button>`
    : `<button type="button" onclick="adminEmojisView.editEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Edit</button>
       <button type="button" onclick="adminEmojisView.deleteEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Delete</button>`;
  return `
    <div class="flex items-center gap-3 p-3 rounded-[13px] border border-line bg-surface mb-2">
      <img src="${_attr(e.image)}" alt="" class="w-12 h-12 rounded-lg object-cover flex-none">
      <div class="min-w-0 flex-1">
        <div class="text-sm text-ink">:${_esc(e.shortcode)}: <span class="text-xs text-muted">${_esc(e.kind)}</span> ${badge}</div>
        <div class="text-xs text-muted mt-0.5">${_esc(e.uploader_username || e.uploader_id)}</div>
      </div>
      <div class="flex flex-wrap gap-1.5 flex-none">${actions}</div>
    </div>
  `;
}

class AdminEmojisView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    await this.load();
  }

  async load() {
    try {
      this.emojis = await api("/api/admin/emojis");
    } catch (e) {
      this.emojis = [];
      errorToast("Couldn't load emojis.");
    }
    this.render();
  }

  render() {
    const pending = this.emojis.filter((e) => e.is_explicit);
    const approved = this.emojis.filter((e) => !e.is_explicit);
    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Emojis & stickers", `${this.emojis.length} total`)}
      <div class="mb-5 p-3.5 rounded-[13px] border border-line bg-surface">
        <div class="font-display font-semibold text-sm text-ink mb-3">Add new</div>
        <input type="text" id="ae_shortcode" placeholder="shortcode (e.g. pepega)" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <select id="ae_kind" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <option value="emoji">Emoji</option>
          <option value="sticker">Sticker</option>
        </select>
        <input type="file" id="ae_file" accept="image/*" class="w-full mb-3 text-sm text-ink">
        <button type="button" onclick="adminEmojisView.addEmoji()" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Add</button>
      </div>
      <div class="mb-2 font-display font-semibold text-base text-ink">Pending review <span class="text-xs text-muted font-normal">(${pending.length})</span></div>
      ${pending.length ? pending.map(adminEmojiCardHtml).join("") : `<p class="text-sm text-muted mb-4">Nothing pending.</p>`}
      <div class="mt-5 mb-2 font-display font-semibold text-base text-ink">Approved <span class="text-xs text-muted font-normal">(${approved.length})</span></div>
      ${approved.length ? approved.map(adminEmojiCardHtml).join("") : `<p class="text-sm text-muted">None yet.</p>`}
    `;
  }

  async addEmoji() {
    const shortcode = document.getElementById("ae_shortcode").value.trim().toLowerCase();
    const kind = document.getElementById("ae_kind").value;
    const file = document.getElementById("ae_file").files[0];
    if (!shortcode || !file) { toast("Pick a file and a shortcode."); return; }
    const fd = new FormData();
    fd.append("shortcode", shortcode);
    fd.append("kind", kind);
    fd.append("file", file, file.name);
    try {
      await api("/api/emojis", { method: "POST", body: fd });
      toast("Added.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't add emoji.");
    }
  }

  async approveEmoji(eid) {
    try {
      await api(`/api/admin/emojis/${encodeURIComponent(eid)}/approve`, { method: "POST" });
      toast("Approved.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't approve.");
    }
  }

  async deleteEmoji(eid) {
    if (!confirm("Delete this emoji/sticker? This can't be undone.")) return;
    try {
      await api(`/api/emojis/${encodeURIComponent(eid)}`, { method: "DELETE" });
      toast("Deleted.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't delete.");
    }
  }

  editEmoji(eid) {
    const item = this.emojis.find((e) => e.id === eid);
    if (!item) return;
    openModal(`
      <h3>Edit emoji/sticker</h3>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">Shortcode</label>
        <input type="text" id="ae_edit_shortcode" value="${_attr(item.shortcode)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">Kind</label>
        <select id="ae_edit_kind" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          <option value="emoji" ${item.kind === "emoji" ? "selected" : ""}>Emoji</option>
          <option value="sticker" ${item.kind === "sticker" ? "selected" : ""}>Sticker</option>
        </select>
      </div>
      <button type="button" id="ae_edit_save" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Save</button>
    `);
    document.getElementById("ae_edit_save").onclick = async () => {
      const shortcode = document.getElementById("ae_edit_shortcode").value.trim().toLowerCase();
      const kind = document.getElementById("ae_edit_kind").value;
      try {
        await api(`/api/admin/emojis/${encodeURIComponent(eid)}`, { method: "PATCH", body: JSON.stringify({ shortcode, kind }) });
        toast("Saved.");
        closeModal();
        await this.load();
      } catch (e) {
        errorToast(e.message || "Couldn't save.");
      }
    };
  }
}

if (typeof window !== "undefined") {
  window.AdminEmojisView = AdminEmojisView;
}
```

- [ ] **Step 2: Register the route**

Check `git status --short new_ui/js/router.js new_ui/index.html` first; use narrow anchored edits if dirty. Add to `routes` in `router.js`:

```js
  "admin-emojis": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminEmojisView = new AdminEmojisView();
    window.adminEmojisView.mount(main);
  },
```

Add to `TAB_FOR_ROUTE`: `"admin-emojis": "dossier",`

Add to `index.html`, after `admin-previews.js`'s script tag: `<script src="/js/admin-emojis.js" defer></script>`

- [ ] **Step 3: Link from the Overview dashboard**

In `new_ui/js/admin.js`, read the current file to find the "Model previews" section block added in the prior sub-project, and add a matching block immediately after it:

```js
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">Emojis & stickers</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-emojis')">Open →</span>
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
    page.goto("http://localhost:3001/admin-emojis")
    page.wait_for_selector("text=Emojis & stickers", timeout=8000)
    assert page.is_visible("text=Add new")
    assert page.is_visible("text=Pending review")
    assert page.is_visible("text=Approved")
    print("OK: emoji admin screen renders")
    page.goto("http://localhost:3001/admin")
    page.wait_for_selector("text=Emojis & stickers", timeout=8000)
    print("OK: overview links to emoji admin")
    browser.close()
EOF
```

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-emojis.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
git diff --cached --stat
git commit -m "Add Admin Emoji/sticker moderation screen"
git diff HEAD --stat -- new_ui/js/admin-emojis.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
```

---

## Self-Review Notes

- **Spec coverage:** Add-new (upload, no AI-generate) ✓, pending-review queue with approve/delete ✓, approved queue with edit/delete ✓, dropped scope (AI-generate button, zoom-preview tool) explicitly noted as intentional, not silently missing.
- **Escaping:** every `onclick` interpolating a free-text-adjacent or id value uses the `_attr(JSON.stringify(...))` pattern established after four prior incidents on this branch — `e.id` values are server-generated opaque ids so a bare `_attr()` would technically be safe here too, but using the stronger pattern uniformly removes any need to reason about which values are "safe enough" case by case.
- **No placeholders:** every step has complete, runnable code.
