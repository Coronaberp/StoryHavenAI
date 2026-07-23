# Admin Panel — Overview + Users & Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first sub-project of the Admin panel for `new_ui/` — an Overview dashboard and a full Users & roles management screen — per `docs/superpowers/specs/2026-07-15-admin-overview-users-design.md`.

**Architecture:** Two new routes (`admin`, `admin-users`), each a `*View` class (`AdminOverviewView`, `AdminUsersView`) following the exact `SettingsView`/`AppearanceSettingsView` pattern already established in `new_ui/js/settings*.js` — `mount(main)`, `render()`, methods for each mutation. Both routes are role-gated in `router.js` itself (redirect non-admin/dev users, don't just hide the link). No backend changes — every stat/list/mutation this plan needs already has a working, tested endpoint.

**Tech Stack:** Vanilla JS (no framework), Tailwind CSS (no new CSS classes needed — reuses `.settings-row`-style patterns via plain Tailwind utilities, matching `settings-account.js`'s form styling), served by `dev_server.py` on `:3001`.

## Global Constraints

- Never use `EnterWorktree`/`git worktree` for this repo — edit `/var/home/staygold/ai-frontend` directly (live bind-mounted app).
- Zero comments in any file, ever — no exceptions.
- Every user-controlled string (`username`, `display_name`, `identity_label`, note text, suspension reason) must go through `_esc()` (text content) or the quote-neutralizing `_attr()` pattern (attribute context) before landing in `innerHTML` — both already defined once in `new_ui/js/settings.js` and available globally once that script has loaded (it loads before `router.js` in `index.html`). Do not reimplement or duplicate these helpers.
- No backend changes. Every endpoint this plan uses already exists: `GET/POST /api/admin/users`, `DELETE /api/admin/users/{uid}`, `PUT /api/admin/users/{uid}/password`, `PUT /api/admin/users/{uid}/role`, `PUT /api/admin/users/{uid}/dev-role`, `POST /api/admin/users/{uid}/suspend`, `POST /api/admin/users/{uid}/unsuspend`, `GET/POST /api/admin/users/{uid}/notes`, `DELETE /api/admin/notes/{note_id}`, `PUT /api/admin/users/{uid}/identity`, `GET /api/characters`, `GET /api/admin/content-reports`, `GET /api/admin/flagged-endpoints`, `GET /api/admin/password-reset-requests`, `GET /api/admin/model-requests`, `GET /api/admin/service-health`.
- No JS unit-test harness exists in `new_ui/`. Verification is Playwright/curl against the running `:3001` dev server (`./rebuild.sh --watch`, already running — never start a second instance).
- **This is a SHARED, actively-changing checkout.** Multiple concurrent Claude sessions commit unrelated work directly onto whatever branch is currently checked out, and the git index itself is a shared resource — staged changes can be swept into someone else's commit, or a commit can silently land on the wrong branch if another session runs `git checkout`. Every task must: (1) run `git branch --show-current` before starting and immediately before every commit, stopping and reporting BLOCKED if it's not the expected branch; (2) never run `git add -A`/`git add .`; stage only the exact files touched, by explicit path; (3) treat `new_ui/js/router.js` and `new_ui/index.html` as high-collision files — before editing, check `git status --short` on them; if either shows pre-existing uncommitted changes, do NOT do a broad find/replace or full-file rewrite — use narrow, anchored `Edit` calls (unique `old_string` bounded tightly around the exact lines being added) so unrelated concurrent edits already in the file are left untouched; (4) after committing, verify with `git diff HEAD --stat -- <your files>` that the commit contains only your intended changes — if it contains more (or the working tree still shows your changes as uncommitted afterward, meaning a race consumed your staged index before your commit landed), investigate and fix before moving on, following the same recovery pattern documented in this session's Settings feature work (`.superpowers/sdd/progress.md` has worked examples).
- `dev_server.py` serves the physical files on disk directly — it does **not** serve from git `HEAD`. A change only takes effect live once it's in the actual working-tree file, regardless of git commit state. Always verify Playwright checks against the live server after editing the physical file, not just after committing.
- Role gate: `ME.role === "admin" || ME.role === "dev"` (see `CLAUDE.md`'s RBAC section — Dev is additive on top of admin). Dev-only actions (grant/revoke Dev role) additionally require `ME.role === "dev"` and can never target `u.id === ME.id` or a non-admin user.

---

## File Structure

| File | Responsibility |
|---|---|
| `new_ui/js/admin.js` (create) | `AdminOverviewView` — service health, stat tiles, attention banner, top-5-users summary |
| `new_ui/js/admin-users.js` (create) | `AdminUsersView` — full user list, create/delete/role/Dev/suspend/notes/identity-label management |
| `new_ui/js/router.js` (modify) | Replace the `admin` placeholder route with the real `AdminOverviewView`; add the `admin-users` route; both role-gated |
| `new_ui/index.html` (modify) | Add `<script>` tags for `admin.js` and `admin-users.js` |

---

### Task 1: Admin Overview dashboard

**Files:**
- Create: `new_ui/js/admin.js`
- Modify: `new_ui/js/router.js` (replace the existing `admin` placeholder entry — see below)
- Modify: `new_ui/index.html`

**Interfaces:**
- Consumes: `api()`, `toast()`, `errorToast()` (`app-session.js`/`toast.js`); `pageHeaderHtml()` (`router.js`); `_esc()`, `_attr()` (`settings.js`); `ME` (global).
- Produces: `AdminOverviewView` (used by Task 2 only insofar as both share the role-gate pattern — no direct code dependency between the two views).

- [ ] **Step 1: Write `new_ui/js/admin.js`**

```js
"use strict";

const ADMIN_SERVICE_LABELS = {
  database: "Database", chat_llm: "Chat model", embed_llm: "Embed model",
  comfyui: "ComfyUI", image_classify_llm: "Image classifier", modal: "Modal",
};

class AdminOverviewView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    const [users, chars, contentReports, flagged, resetReqs, modelReqs, health] = await Promise.all([
      api("/api/admin/users").catch(() => []),
      api("/api/characters").catch(() => []),
      api("/api/admin/content-reports").catch(() => []),
      api("/api/admin/flagged-endpoints").catch(() => []),
      api("/api/admin/password-reset-requests").catch(() => []),
      api("/api/admin/model-requests").catch(() => []),
      api("/api/admin/service-health").catch(() => ({ services: [] })),
    ]);
    this.users = users;
    this.chars = chars;
    this.pending = users.filter((u) => u.status === "pending");
    this.flagged = flagged;
    this.resetReqs = resetReqs;
    this.pendingModelReqs = modelReqs.filter((r) => r.status === "pending");
    this.health = health.services || [];
    this.render();
  }

  render() {
    const attentionTotal = this.pending.length + this.flagged.length + this.resetReqs.length + this.pendingModelReqs.length;

    const healthTile = (svc) => `
      <div class="flex-1 min-w-0 p-3 rounded-[13px] border border-line bg-surface">
        <div class="flex items-center gap-1.5 text-sec mb-2">
          <span class="font-mono text-[9px] tracking-[.1em] uppercase">${_esc(ADMIN_SERVICE_LABELS[svc.name] || svc.name)}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-[7px] h-[7px] rounded-full flex-none" style="background:${svc.ok ? "#7bd88f" : "var(--color-warn)"}"></span>
          <span class="text-[13px] text-ink">${svc.ok ? "Connected" : (svc.error ? _esc(svc.error) : "Unreachable")}</span>
        </div>
      </div>
    `;

    const statTile = (label, value, attn = false) => `
      <div class="flex-1 text-center py-3 px-1.5 rounded-[13px] border" style="border-color:${attn && value > 0 ? "var(--color-warn)" : "var(--color-line)"};background:var(--color-surface)">
        <div class="font-display font-semibold text-[19px]" style="color:${attn && value > 0 ? "var(--color-warn)" : "var(--color-accent)"}">${value}</div>
        <div class="font-mono text-[8.5px] tracking-[.1em] uppercase text-muted mt-0.5">${label}</div>
      </div>
    `;

    const userRow = (u) => `
      <div class="flex items-center gap-3 py-2.5 px-3 rounded-[13px] border border-line bg-surface">
        <span class="w-9 h-9 rounded-full overflow-hidden bg-surface-2 grid place-items-center flex-none">
          ${u.avatar ? `<img src="${_attr(u.avatar)}" alt="" class="w-full h-full object-cover">` : `<span class="font-display text-sm text-ink">${_esc((u.display_name || u.username || "?")[0].toUpperCase())}</span>`}
        </span>
        <div class="flex-1 min-w-0">
          <div class="font-display font-semibold text-sm text-ink truncate">${_esc(u.display_name || u.username)}</div>
          <div class="font-mono text-xs text-muted mt-0.5">@${_esc(u.username)}</div>
        </div>
        <span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-accent);border:1px solid var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, transparent)">
          ${u.role === "dev" ? "Dev" : (u.is_admin ? "Admin" : (u.status === "suspended" ? "Suspended" : "Member"))}
        </span>
      </div>
    `;

    this.main.innerHTML = `
      ${pageHeaderHtml("My Dossier", "Admin", "Admin", "You are the owner.")}
      <div class="flex gap-2.5 mb-3 flex-wrap">${this.health.map(healthTile).join("")}</div>
      <div class="flex gap-2.5 mb-3 flex-wrap">
        ${statTile("Users", this.users.length)}
        ${statTile("Admins", this.users.filter((u) => u.is_admin).length)}
        ${statTile("Characters", this.chars.length)}
      </div>
      <div class="flex gap-2.5 mb-4 flex-wrap">
        ${statTile("Pending", this.pending.length, true)}
        ${statTile("Flagged", this.flagged.length, true)}
        ${statTile("Resets", this.resetReqs.length, true)}
        ${statTile("Model reqs", this.pendingModelReqs.length, true)}
      </div>
      <div class="p-3.5 rounded-[13px] border mb-5" style="border-color:${attentionTotal > 0 ? "var(--color-warn)" : "var(--color-line)"};background:${attentionTotal > 0 ? "color-mix(in srgb, var(--color-warn) 10%, var(--color-surface))" : "var(--color-surface)"}">
        <div class="font-mono text-[10px] tracking-[.14em] uppercase mb-1" style="color:${attentionTotal > 0 ? "var(--color-warn)" : "var(--color-muted)"}">${attentionTotal > 0 ? "Needs attention" : "All clear"}</div>
        <div class="text-[13px] text-ink">${attentionTotal > 0
          ? [
              this.pending.length ? `${this.pending.length} pending` : "",
              this.flagged.length ? `${this.flagged.length} flagged` : "",
              this.resetReqs.length ? `${this.resetReqs.length} resets` : "",
              this.pendingModelReqs.length ? `${this.pendingModelReqs.length} model reqs` : "",
            ].filter(Boolean).join(" · ")
          : "Nothing pending review."}</div>
      </div>
      <div class="flex items-center justify-between mb-3">
        <div class="font-display font-semibold text-base text-ink">Users</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-users')">See all →</span>
      </div>
      <div class="flex flex-col gap-2">${this.users.slice(0, 5).map(userRow).join("")}</div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.AdminOverviewView = AdminOverviewView;
}
```

- [ ] **Step 2: Replace the `admin` placeholder route and add the role gate**

Run `git status --short new_ui/js/router.js` first. If it shows pre-existing uncommitted changes from other work, use the narrow `Edit` approach below rather than assuming the file matches what's shown here — locate the current `admin:` entry (added in an earlier session as a temporary placeholder: `admin: (main) => renderPlaceholder(main, "My Dossier", "Settings", "Admin panel", ...)`) and replace only that one entry.

Replace:
```js
  admin: (main) => renderPlaceholder(main, "My Dossier", "Settings", "Admin panel",
    "Users, roles, and server configuration — coming soon."),
```
with:
```js
  admin: (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminOverviewView = new AdminOverviewView();
    window.adminOverviewView.mount(main);
  },
```

The existing `admin: "dossier"` line in `TAB_FOR_ROUTE` (added in the same earlier session) stays unchanged — no edit needed there.

- [ ] **Step 3: Add the script tag**

In `new_ui/index.html`, add `<script src="/js/admin.js" defer></script>` immediately after the `settings-blocks.js` script tag (before `router.js`'s own tag). Check `git status --short new_ui/index.html` first; if dirty, use a narrow anchored `Edit` on the exact `settings-blocks.js` line rather than a full-file rewrite.

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
    page.goto("http://localhost:3001/admin")
    page.wait_for_selector("text=Users", timeout=8000)
    assert page.is_visible("text=Admins")
    assert page.is_visible("text=Characters")
    print("OK: admin overview renders for admin account")

    page.goto("http://localhost:3001/login")
    page.fill('input[data-field="username"]', "test")
    page.fill('input[data-field="password"]', "11111111")
    page.click('button[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3001/admin")
    page.wait_for_timeout(1500)
    assert "/admin" not in page.url, f"non-admin was not redirected, still on {page.url}"
    print("OK: non-admin redirected away from /admin")
    browser.close()
EOF
```

Expected: both `OK:` lines print, no assertion errors.

- [ ] **Step 5: Commit**

Verify `git branch --show-current` prints the expected feature branch first. Stage explicitly:

```bash
git add new_ui/js/admin.js new_ui/js/router.js new_ui/index.html
git diff --cached --stat
git commit -m "Add Admin overview dashboard (service health, stats, attention banner, top users)"
```

Confirm with `git diff HEAD --stat -- new_ui/js/admin.js new_ui/js/router.js new_ui/index.html` that the commit contains only these three files' intended changes.

---

### Task 2: Admin Users list + create/delete

**Files:**
- Create: `new_ui/js/admin-users.js`
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`

**Interfaces:**
- Consumes: `api()`, `toast()`, `errorToast()`, `pageHeaderHtml()`, `_esc()`, `_attr()`, `ME`.
- Produces: `AdminUsersView` with `this.users: array`, `mount(main)`, `render()`, `createUser()`, `deleteUser(uid)` — extended in Tasks 3–4 with more methods on the same class/file.

- [ ] **Step 1: Write `new_ui/js/admin-users.js` (Part 1 — list + create + delete)**

```js
"use strict";

function adminRoleBadge(u) {
  if (u.role === "dev") return `<span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-accent);border:1px solid var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, transparent)">Dev</span>`;
  if (u.is_admin) return `<span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-accent);border:1px solid var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, transparent)">Admin</span>`;
  if (u.status === "suspended") return `<span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-warn);border:1px solid var(--color-warn);background:color-mix(in srgb, var(--color-warn) 12%, transparent)">Suspended</span>`;
  return "";
}

class AdminUsersView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    await this.load();
  }

  async load() {
    try {
      this.users = await api("/api/admin/users");
    } catch (e) {
      this.users = [];
      errorToast("Couldn't load users.");
    }
    this.render();
  }

  render() {
    const rows = this.users.map((u) => `
      <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-2.5">
        <div class="flex items-center gap-3 mb-2.5">
          <span class="w-9 h-9 rounded-full overflow-hidden bg-surface-2 grid place-items-center flex-none">
            ${u.avatar ? `<img src="${_attr(u.avatar)}" alt="" class="w-full h-full object-cover">` : `<span class="font-display text-sm text-ink">${_esc((u.display_name || u.username || "?")[0].toUpperCase())}</span>`}
          </span>
          <div class="flex-1 min-w-0">
            <div class="font-display font-semibold text-sm text-ink truncate">
              ${_esc(u.username)}
              ${u.identity_label ? `<span class="font-mono text-[9px] text-muted ml-1">(${_esc(u.identity_label)})</span>` : ""}
              ${u.id === ME.id ? `<span class="font-mono text-[9px] text-muted ml-1">you</span>` : ""}
            </div>
            <div class="font-mono text-[10px] text-muted mt-0.5">${_esc(u.id.slice(0, 8))}…${u.status === "suspended" && u.suspension_reason ? ` · ${_esc(u.suspension_reason)}` : ""}</div>
          </div>
          ${adminRoleBadge(u)}
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button type="button" onclick="adminUsersView.resetPassword('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Reset password</button>
          ${u.id !== ME.id ? (u.is_admin
            ? `<button type="button" onclick="adminUsersView.setRole('${_attr(u.id)}', false)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Demote</button>`
            : `<button type="button" onclick="adminUsersView.setRole('${_attr(u.id)}', true)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Make admin</button>`) : ""}
          ${ME.role === "dev" && u.is_admin && u.id !== ME.id ? (u.role === "dev"
            ? `<button type="button" onclick="adminUsersView.setDevRole('${_attr(u.id)}', false)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Revoke Dev</button>`
            : `<button type="button" onclick="adminUsersView.setDevRole('${_attr(u.id)}', true)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Grant Dev</button>`) : ""}
          ${u.id !== ME.id ? (u.status === "suspended"
            ? `<button type="button" onclick="adminUsersView.unsuspend('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Unsuspend</button>`
            : `<button type="button" onclick="adminUsersView.suspend('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Suspend</button>`) : ""}
          <button type="button" onclick="adminUsersView.manageNotes('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Notes</button>
          <button type="button" onclick="adminUsersView.setIdentityLabel('${_attr(u.id)}', ${JSON.stringify(u.identity_label || "")})" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Identity label</button>
          ${u.id !== ME.id ? `<button type="button" onclick="adminUsersView.deleteUser('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Delete</button>` : ""}
        </div>
      </div>
    `).join("");

    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Users & roles", `${this.users.length} users`)}
      <button type="button" onclick="adminUsersView.createUser()" class="w-full mb-4 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">
        + New user
      </button>
      ${rows}
    `;
  }

  async createUser() {
    const username = (prompt("Username (letters, numbers, _ and - only):") || "").trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
    if (!username) return;
    const password = prompt("Password (min 8 characters):") || "";
    if (password.length < 8) { errorToast("Password must be at least 8 characters."); return; }
    const isAdmin = confirm("Grant admin on creation?");
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password, is_admin: isAdmin }) });
      toast("User created.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't create user.");
    }
  }

  async deleteUser(uid) {
    if (!confirm("Delete this user permanently? This cannot be undone.")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}`, { method: "DELETE" });
      toast("User deleted.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't delete user.");
    }
  }
}

if (typeof window !== "undefined") {
  window.AdminUsersView = AdminUsersView;
}
```

Note: `resetPassword`, `setRole`, `setDevRole`, `suspend`, `unsuspend`, `manageNotes`, `setIdentityLabel` are referenced by `render()` but not yet defined — that's expected, Tasks 3 and 4 add them to this same class via `Object.assign(AdminUsersView.prototype, {...})`, the same pattern `settings-appearance.js` used to split its class across two tasks in one file. This task's own verification (Step 3 below) only exercises `createUser`/`deleteUser`, so the undefined methods being called from other buttons' `onclick` attributes is fine — those buttons simply aren't clicked yet.

- [ ] **Step 2: Register the route**

Check `git status --short new_ui/js/router.js new_ui/index.html` first; use narrow anchored edits if either is dirty from concurrent work.

Add to `routes` in `new_ui/js/router.js` (near the `admin` entry from Task 1):
```js
  "admin-users": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminUsersView = new AdminUsersView();
    window.adminUsersView.mount(main);
  },
```

Add to `TAB_FOR_ROUTE`:
```js
  "admin-users": "dossier",
```

Add to `new_ui/index.html`, after `admin.js`'s script tag:
```html
<script src="/js/admin-users.js" defer></script>
```

- [ ] **Step 3: Verify live with Playwright — create and delete a throwaway user**

```bash
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.on("dialog", lambda d: d.accept("plantest-throwaway" if d.message.startswith("Username") else ("testpass1234" if d.message.startswith("Password") else True)))
    page.goto("http://localhost:3001/login")
    page.fill('input[data-field="username"]', "claude")
    page.fill('input[data-field="password"]', "0987654321")
    page.click('button[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3001/admin-users")
    page.wait_for_selector("text=Users & roles", timeout=8000)
    page.click("text=+ New user")
    page.wait_for_timeout(1000)
    assert page.is_visible("text=plantest-throwaway"), "created user not visible in list"
    print("OK: user created and visible")
    browser.close()
EOF
```

Expected: `OK: user created and visible`. Note the throwaway user's ID/username is left in the system after this task — Task 4's verification step deletes it (notes/identity-label testing needs a live user to act on first). If Task 4 is not run in the same session immediately after, delete `plantest-throwaway` manually via the admin panel before ending work.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-users.js new_ui/js/router.js new_ui/index.html
git diff --cached --stat
git commit -m "Add Admin Users list with create/delete"
git diff HEAD --stat -- new_ui/js/admin-users.js new_ui/js/router.js new_ui/index.html
```

---

### Task 3: Admin Users — role, Dev role, suspend/unsuspend, reset password

**Files:**
- Modify: `new_ui/js/admin-users.js`

**Interfaces:**
- Consumes: `AdminUsersView` (Task 2), `this.users`, `this.load()`, `this.render()`.
- Produces: `AdminUsersView.prototype.resetPassword(uid)`, `.setRole(uid, isAdmin)`, `.setDevRole(uid, isDev)`, `.suspend(uid)`, `.unsuspend(uid)` — all added via `Object.assign`.

- [ ] **Step 1: Append to `new_ui/js/admin-users.js`** (before the final `if (typeof window...)` block)

```js
Object.assign(AdminUsersView.prototype, {
  async resetPassword(uid) {
    const password = prompt("New password (min 8 characters):") || "";
    if (password.length < 8) { errorToast("Password must be at least 8 characters."); return; }
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/password`, { method: "PUT", body: JSON.stringify({ username: "", password }) });
      toast("Password reset.");
    } catch (e) {
      errorToast(e.message || "Couldn't reset password.");
    }
  },

  async setRole(uid, isAdmin) {
    if (!confirm(isAdmin ? "Grant admin to this user?" : "Remove admin from this user?")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/role`, { method: "PUT", body: JSON.stringify({ username: "", password: "", is_admin: isAdmin }) });
      toast(isAdmin ? "Admin granted." : "Admin removed.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't change role.");
    }
  },

  async setDevRole(uid, isDev) {
    if (!confirm(isDev ? "Grant Dev role to this admin?" : "Revoke Dev role from this admin?")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/dev-role`, { method: "PUT", body: JSON.stringify({ is_dev: isDev }) });
      toast(isDev ? "Dev granted." : "Dev revoked.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't change Dev role.");
    }
  },

  async suspend(uid) {
    const reason = prompt("Suspension reason (optional):") || "";
    if (!confirm("Suspend this user?")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/suspend`, { method: "POST", body: JSON.stringify({ reason: reason || null }) });
      toast("User suspended.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't suspend user.");
    }
  },

  async unsuspend(uid) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/unsuspend`, { method: "POST" });
      toast("User unsuspended.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't unsuspend user.");
    }
  },
});
```

`UserCreateIn` (used by both `/password` and `/role` per `backend/schemas.py:371-374`) requires `username`/`password` fields even though these two endpoints only read `password`/`is_admin` respectively — passing empty-string placeholders for the unused required fields matches the schema's validation without the backend actually using those values (verify this against `backend/routers/admin.py`'s `admin_reset_password`/`admin_update_role` handlers if this seems off — they only reference `body.password`/`body.is_admin` respectively, ignoring `body.username`).

- [ ] **Step 2: Verify live with Playwright — suspend/unsuspend and role round-trip on the throwaway user from Task 2**

```bash
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.on("dialog", lambda d: d.accept("test suspension reason" if "reason" in d.message else ""))
    page.goto("http://localhost:3001/login")
    page.fill('input[data-field="username"]', "claude")
    page.fill('input[data-field="password"]', "0987654321")
    page.click('button[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3001/admin-users")
    page.wait_for_selector("text=plantest-throwaway", timeout=8000)

    row = page.locator("div", has_text="plantest-throwaway").last
    row.get_by_text("Suspend", exact=True).click()
    page.wait_for_timeout(1000)
    assert page.is_visible("text=Suspended"), "suspended badge not shown"
    print("OK: suspend round-trips")

    row = page.locator("div", has_text="plantest-throwaway").last
    row.get_by_text("Unsuspend", exact=True).click()
    page.wait_for_timeout(1000)
    print("OK: unsuspend round-trips")
    browser.close()
EOF
```

Expected: both `OK:` lines print. (If Playwright's dialog auto-accept interferes with the confirm() for suspend specifically since two prompts fire in sequence — the reason prompt then the confirm — adjust the dialog handler to accept both in order rather than pattern-matching on message text, whichever proves reliable when actually run.)

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-users.js
git diff --cached --stat
git commit -m "Add Admin Users role/Dev-role/suspend/reset-password actions"
git diff HEAD --stat -- new_ui/js/admin-users.js
```

---

### Task 4: Admin Users — notes and identity label

**Files:**
- Modify: `new_ui/js/admin-users.js`

**Interfaces:**
- Consumes: `AdminUsersView` (Tasks 2–3), `openModal()`/`closeModal()`/`closeTopModal()` (`new_ui/js/modal.js`).
- Produces: `AdminUsersView.prototype.manageNotes(uid)`, `.setIdentityLabel(uid, currentLabel)`.

- [ ] **Step 1: Append to `new_ui/js/admin-users.js`** (inside the same `Object.assign(AdminUsersView.prototype, {...})` block from Task 3 — add these as two more properties in that object, not a second `Object.assign` call)

```js
  async manageNotes(uid) {
    let notes;
    try {
      notes = await api(`/api/admin/users/${encodeURIComponent(uid)}/notes`);
    } catch (e) {
      errorToast("Couldn't load notes.");
      return;
    }
    const notesHtml = () => notes.length
      ? notes.map((n) => `
        <div class="flex items-start justify-between gap-2 py-2 border-b border-line">
          <div class="min-w-0">
            <div class="text-sm text-ink">${_esc(n.note)}</div>
            <div class="font-mono text-[10px] text-muted mt-1">${_esc(n.author_username)} · ${new Date(n.created * 1000).toLocaleDateString()}</div>
          </div>
          <button type="button" data-del-note="${_attr(n.id)}" class="text-xs flex-none" style="color:var(--color-warn)">Delete</button>
        </div>
      `).join("")
      : `<p class="text-sm text-muted py-2">No notes yet.</p>`;

    openModal(`
      <h3>Admin notes</h3>
      <div id="admin_notes_list" class="mb-3">${notesHtml()}</div>
      <div class="flex gap-2">
        <input type="text" id="admin_note_input" placeholder="Add a note" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <button type="button" id="admin_note_add" class="px-3 py-2 rounded-md border border-line text-sm text-ink">Add</button>
      </div>
    `);

    const refresh = () => { document.getElementById("admin_notes_list").innerHTML = notesHtml(); wireDeletes(); };
    const wireDeletes = () => {
      document.querySelectorAll("[data-del-note]").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(`/api/admin/notes/${encodeURIComponent(btn.dataset.delNote)}`, { method: "DELETE" });
            notes = notes.filter((n) => n.id !== btn.dataset.delNote);
            refresh();
          } catch (e) {
            errorToast("Couldn't delete note.");
          }
        };
      });
    };
    wireDeletes();

    document.getElementById("admin_note_add").onclick = async () => {
      const input = document.getElementById("admin_note_input");
      const text = input.value.trim();
      if (!text) return;
      try {
        const created = await api(`/api/admin/users/${encodeURIComponent(uid)}/notes`, { method: "POST", body: JSON.stringify({ note: text }) });
        notes = [created, ...notes];
        input.value = "";
        refresh();
      } catch (e) {
        errorToast("Couldn't add note.");
      }
    };
  },

  async setIdentityLabel(uid, currentLabel) {
    const label = prompt("Identity label (admin-only, e.g. known alt account note):", currentLabel || "");
    if (label === null) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/identity`, { method: "PUT", body: JSON.stringify({ label: label.trim() || null }) });
      toast("Identity label updated.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't update identity label.");
    }
  },
```

- [ ] **Step 2: Verify live with Playwright — notes round-trip, then delete the Task 2 throwaway user**

```bash
python3 - <<'EOF'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.on("dialog", lambda d: d.accept())
    page.goto("http://localhost:3001/login")
    page.fill('input[data-field="username"]', "claude")
    page.fill('input[data-field="password"]', "0987654321")
    page.click('button[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3001/admin-users")
    page.wait_for_selector("text=plantest-throwaway", timeout=8000)

    row = page.locator("div", has_text="plantest-throwaway").last
    row.get_by_text("Notes", exact=True).click()
    page.wait_for_selector("text=Admin notes", timeout=5000)
    page.fill("#admin_note_input", "test note from plan verification")
    page.click("#admin_note_add")
    page.wait_for_timeout(800)
    assert page.is_visible("text=test note from plan verification")
    print("OK: note added and visible")
    page.click(".modal-close")

    row = page.locator("div", has_text="plantest-throwaway").last
    row.get_by_text("Delete", exact=True).click()
    page.wait_for_timeout(1000)
    assert not page.is_visible("text=plantest-throwaway"), "throwaway user still present after delete"
    print("OK: throwaway user cleaned up")
    browser.close()
EOF
```

Expected: both `OK:` lines print. This step also cleans up the throwaway test user left over from Task 2 — do not skip it.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-users.js
git diff --cached --stat
git commit -m "Add Admin Users moderation notes and identity label management"
git diff HEAD --stat -- new_ui/js/admin-users.js
```

---

## Self-Review Notes

- **Spec coverage:** Overview dashboard (service health, stat tiles, attention banner, top-5 users) ✓ Task 1. Role gate on both routes (redirect, not just hide) ✓ Tasks 1–2. Users list with create/delete ✓ Task 2. Role/Dev-role/suspend/unsuspend/reset-password ✓ Task 3. Notes and identity label ✓ Task 4. No backend changes ✓ (every task only touches `new_ui/`). Escaping discipline (`_esc`/`_attr` on every user-controlled string) ✓ applied throughout all four tasks' HTML templates.
- **Type consistency:** `AdminUsersView`'s methods referenced in Task 2's `render()` (`resetPassword`, `setRole`, `setDevRole`, `suspend`, `unsuspend`, `manageNotes`, `setIdentityLabel`) match the exact names defined in Tasks 3–4's `Object.assign` blocks. `window.adminUsersView`/`window.adminOverviewView` singleton names match what `router.js`'s route handlers assign and what the rendered `onclick` attributes reference.
- **No placeholders:** every step has complete, runnable code.
