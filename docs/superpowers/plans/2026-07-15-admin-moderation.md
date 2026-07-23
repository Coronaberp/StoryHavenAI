# Admin Panel — Moderation Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the second sub-project of the Admin panel for `new_ui/` — a Moderation queue screen covering all seven actionable admin queues — per `docs/superpowers/specs/2026-07-15-admin-moderation-design.md`.

**Architecture:** One new route (`admin-moderation`), one `AdminModerationView` class (`new_ui/js/admin-moderation.js`) following the exact `AdminOverviewView`/`AdminUsersView` pattern already established — role-gated at the route-handler level, `mount(main)`/`render()`/per-action methods. No backend changes — every endpoint already exists.

**Tech Stack:** Vanilla JS, Tailwind CSS, served by `dev_server.py` on `:3001`.

## Global Constraints

- Never use `EnterWorktree`/`git worktree` for this repo — edit `/var/home/staygold/ai-frontend` directly.
- Zero comments in any file, ever — no exceptions.
- Every user-controlled string (usernames, flagged-endpoint URLs/reasons/detail blobs, report notes, model-request notes/names/source URLs) must go through `_esc()`/`_attr()` for its context before landing in `innerHTML` — both already defined in `new_ui/js/settings.js`, available globally.
- No backend changes. Every endpoint this plan uses already exists: `GET /api/admin/users`, `POST /api/admin/users/{uid}/approve`, `POST /api/admin/users/{uid}/deny`, `GET /api/admin/flagged-endpoints`, `POST /api/admin/flagged-endpoints/{fid}/allow`, `POST /api/admin/flagged-endpoints/{fid}/block`, `GET /api/admin/password-reset-requests`, `POST /api/admin/password-reset-requests/{rid}/approve`, `POST /api/admin/password-reset-requests/{rid}/deny`, `GET /api/admin/model-requests`, `POST /api/admin/model-requests/{rid}/approve`, `POST /api/admin/model-requests/{rid}/reject`, `POST /api/admin/model-requests/{rid}/complete`, `GET /api/admin/title-requests`, `POST /api/admin/title-requests/{uid}/approve`, `POST /api/admin/title-requests/{uid}/reject`, `GET /api/admin/image-reports`, `POST /api/admin/image-reports/{report_id}/resolve`, `GET /api/admin/content-reports`, `POST /api/admin/content-reports/{report_id}/resolve`.
- No JS unit-test harness exists. Verification is Playwright/curl against the running `:3001` dev server (`./rebuild.sh --watch`, already running — never start a second instance).
- **Never create new user accounts for testing, under any circumstances** — this was explicitly enforced during the prior Admin sub-project. Verification of queue actions that would need a live pending/flagged/reported item is limited to confirming the screen renders each queue's current (possibly empty) state correctly, and that button wiring calls the correct endpoint with the correct body shape (verify via Playwright's `page.expect_response(...)`/network interception rather than requiring a real state-changing action to complete against production data).
- **This is a SHARED, actively-changing checkout.** Multiple concurrent Claude sessions commit unrelated work directly onto whatever branch is currently checked out, and the git index itself is a shared resource. Every task must: (1) run `git branch --show-current` before starting and immediately before every commit, stopping and reporting BLOCKED if unexpected; (2) never run `git add -A`/`git add .`; stage only exact files by explicit path; (3) treat `new_ui/js/router.js` and `new_ui/index.html` as high-collision files — check `git status --short` before editing, use narrow anchored `Edit` calls if either is dirty from concurrent work; (4) after committing, verify with `git diff HEAD --stat -- <your files>` that the commit contains only intended changes.
- `dev_server.py` serves the physical files on disk directly, not git `HEAD` — always verify Playwright checks against the live server after editing the physical file.
- Role gate: `ME.role === "admin" || ME.role === "dev"`. Dev-only UI (the model-request "Copy curl" button and its embedded API keys) additionally requires `ME.role === "dev"`.
- Legacy's actual wiring (verified against `legacy_ui/js/admin-moderation.js`, the functional source of truth) uses a `confirm()`-style guard before **deny**, **block**, **reject**, and **mark-done** actions (all four are consequential/hard-to-undo), but NOT before **approve**/**allow** actions. Follow this exactly — this corrects an earlier draft of this plan's spec, which incorrectly said no queue action needs confirmation.

---

## File Structure

| File | Responsibility |
|---|---|
| `new_ui/js/admin-moderation.js` (create) | `AdminModerationView` — all seven queues, their row templates, and their action methods |
| `new_ui/js/router.js` (modify) | Add the `admin-moderation` route + `TAB_FOR_ROUTE` entry |
| `new_ui/index.html` (modify) | Add the `admin-moderation.js` script tag |
| `new_ui/js/admin.js` (modify, Task 4 only) | Add a "Moderation" row + jump-from-attention-banner link to `/admin-moderation` |

---

### Task 1: Moderation screen skeleton + Pending signups + Flagged endpoints

**Files:**
- Create: `new_ui/js/admin-moderation.js`
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`

**Interfaces:**
- Consumes: `api()`, `toast()`, `errorToast()`, `pageHeaderHtml()`, `backLinkHtml()`, `_esc()`, `_attr()`, `ME`.
- Produces: `AdminModerationView` with `mount(main)`, `load()`, `render()`, `approveUser(uid)`, `denyUser(uid)`, `allowEndpoint(fid)`, `blockEndpoint(fid)` — extended by Tasks 2–3 with more queues/methods on the same class/file, same pattern `AdminUsersView` used across its own three tasks.

- [ ] **Step 1: Write `new_ui/js/admin-moderation.js` (Part 1 — skeleton + first two queues)**

```js
"use strict";

function adminQueueSectionHtml(title, count, bodyHtml) {
  return `
    <div class="mb-5">
      <div class="flex items-center gap-2 mb-2.5">
        <div class="font-display font-semibold text-base text-ink">${title}</div>
        ${count > 0 ? `<span class="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style="background:var(--color-warn);color:var(--color-paper)">${count}</span>` : ""}
      </div>
      ${bodyHtml || `<p class="text-sm text-muted py-1">Nothing pending.</p>`}
    </div>
  `;
}

function adminQueueRowHtml(bodyHtml, actionsHtml) {
  return `
    <div class="flex items-start justify-between gap-3 p-3 rounded-[13px] border border-line bg-surface mb-2">
      <div class="min-w-0 flex-1">${bodyHtml}</div>
      <div class="flex flex-wrap gap-1.5 flex-none">${actionsHtml}</div>
    </div>
  `;
}

class AdminModerationView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">Loading…</div>`;
    await this.load();
  }

  async load() {
    const [users, flagged, resetReqs, modelReqs, titleReqs, imageReports, contentReports] = await Promise.all([
      api("/api/admin/users").catch(() => []),
      api("/api/admin/flagged-endpoints").catch(() => []),
      api("/api/admin/password-reset-requests").catch(() => []),
      api("/api/admin/model-requests").catch(() => []),
      api("/api/admin/title-requests").catch(() => []),
      api("/api/admin/image-reports").catch(() => []),
      api("/api/admin/content-reports").catch(() => []),
    ]);
    this.pending = users.filter((u) => u.status === "pending");
    this.flagged = flagged;
    this.resetReqs = resetReqs;
    this.modelReqs = modelReqs.filter((r) => r.status === "pending" || r.status === "approved");
    this.titleReqs = titleReqs;
    this.imageReports = imageReports;
    this.contentReports = contentReports;
    this.render();
  }

  attentionTotal() {
    return this.pending.length + this.flagged.length + this.resetReqs.length +
      this.modelReqs.filter((r) => r.status === "pending").length + this.titleReqs.length +
      this.imageReports.length + this.contentReports.length;
  }

  pendingSignupsHtml() {
    const rows = this.pending.map((u) => adminQueueRowHtml(
      `<div class="font-display font-semibold text-sm text-ink">${_esc(u.username)}</div><div class="text-xs text-muted mt-0.5">Awaiting approval</div>`,
      `<button type="button" onclick="adminModerationView.approveUser('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Approve</button>
       <button type="button" onclick="adminModerationView.denyUser('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Deny</button>`
    )).join("");
    return adminQueueSectionHtml("Pending signups", this.pending.length, rows);
  }

  flaggedEndpointsHtml() {
    const rows = this.flagged.map((fl) => adminQueueRowHtml(
      `<div class="font-mono text-xs text-ink break-all">${_esc(fl.url)}</div>
       <div class="text-xs text-muted mt-1">${_esc(fl.username || fl.user_id)} · ${_esc(fl.reason)}</div>
       ${fl.detail ? `<pre class="font-mono text-[11px] whitespace-pre-wrap break-words mt-2 p-2 rounded-md max-h-[220px] overflow-auto" style="background:var(--color-surface-2)">${_esc(fl.detail)}</pre>` : ""}`,
      `<button type="button" onclick="adminModerationView.allowEndpoint('${_attr(fl.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Allow</button>
       <button type="button" onclick="adminModerationView.blockEndpoint('${_attr(fl.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Block</button>`
    )).join("");
    return adminQueueSectionHtml("Flagged endpoints", this.flagged.length, rows);
  }

  render() {
    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Moderation", `${this.attentionTotal()} items need attention`)}
      ${this.pendingSignupsHtml()}
      ${this.flaggedEndpointsHtml()}
    `;
  }

  async approveUser(uid) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/approve`, { method: "POST" });
      toast("User approved.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't approve user.");
    }
  }

  async denyUser(uid) {
    if (!confirm("Deny and delete this signup?")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/deny`, { method: "POST" });
      toast("User denied.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't deny user.");
    }
  }

  async allowEndpoint(fid) {
    try {
      await api(`/api/admin/flagged-endpoints/${encodeURIComponent(fid)}/allow`, { method: "POST" });
      toast("Endpoint allowed.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't allow endpoint.");
    }
  }

  async blockEndpoint(fid) {
    if (!confirm("Block this endpoint?")) return;
    try {
      await api(`/api/admin/flagged-endpoints/${encodeURIComponent(fid)}/block`, { method: "POST" });
      toast("Endpoint blocked.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't block endpoint.");
    }
  }
}

if (typeof window !== "undefined") {
  window.AdminModerationView = AdminModerationView;
}
```

Note: `render()` currently shows only the first two queues — Tasks 2–3 extend `render()` (a full reassignment, same pattern `settings-appearance.js` used across its two tasks) to add the remaining five. This is expected, not incomplete for this task's own scope.

- [ ] **Step 2: Register the route**

Check `git status --short new_ui/js/router.js new_ui/index.html` first; use narrow anchored edits if either is dirty. Add to `routes` in `router.js` (near the existing `"admin-users"` entry):

```js
  "admin-moderation": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
    window.adminModerationView = new AdminModerationView();
    window.adminModerationView.mount(main);
  },
```

Add to `TAB_FOR_ROUTE`: `"admin-moderation": "dossier",`

Add to `index.html`, after `admin-users.js`'s script tag: `<script src="/js/admin-moderation.js" defer></script>`

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
    page.goto("http://localhost:3001/admin-moderation")
    page.wait_for_selector("text=Moderation", timeout=8000)
    assert page.is_visible("text=Pending signups")
    assert page.is_visible("text=Flagged endpoints")
    print("OK: moderation screen renders with both queues")
    browser.close()
EOF
```

Expected: `OK:` line prints, no assertion errors.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-moderation.js new_ui/js/router.js new_ui/index.html
git diff --cached --stat
git commit -m "Add Admin Moderation screen: pending signups and flagged endpoints queues"
git diff HEAD --stat -- new_ui/js/admin-moderation.js new_ui/js/router.js new_ui/index.html
```

---

### Task 2: Password resets + Model requests queues (with Dev-only curl copy)

**Files:**
- Modify: `new_ui/js/admin-moderation.js`

**Interfaces:**
- Consumes: `AdminModerationView` (Task 1), `openModal()`/`closeModal()` (`new_ui/js/modal.js`).
- Produces: `AdminModerationView.prototype.passwordResetsHtml()`, `.modelRequestsHtml()`, `.approveResetRequest(rid)`, `.denyResetRequest(rid)`, `.approveModelRequest(rid)`, `.rejectModelRequest(rid)`, `.completeModelRequest(rid)`, `.copyModelRequestCurl(rid)` — appended, plus a final `render()` reassignment adding these two sections.

- [ ] **Step 1: Append to `new_ui/js/admin-moderation.js`** (before the final `if (typeof window...)` block)

```js
const ADMIN_MR_TYPE_LABELS = { lora: "LoRA", upscaler: "Upscaler", anima: "Anima" };
const ADMIN_MR_SUBDIRS = { checkpoint: "checkpoints", lora: "loras", upscaler: "upscale_models", anima: "diffusion_models" };
const ADMIN_MR_BASE_DIR = "/var/mnt/storage/podman/volumes/sillytavern_comfyui_models/_data";
const ADMIN_MR_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function adminMrExtFor(url, reqType) {
  const knownExts = [".safetensors", ".ckpt", ".pt", ".pth"];
  let urlPath;
  try { urlPath = new URL(url).pathname.toLowerCase(); } catch (e) { urlPath = url.toLowerCase(); }
  return knownExts.find((ext) => urlPath.endsWith(ext)) || (reqType === "upscaler" ? ".pth" : ".safetensors");
}

function adminMrDownloadBlock(dir, url, fname, apiKey) {
  const tmp = fname + ".dl";
  const extractDir = fname + "_extract";
  const authPart = apiKey ? ` -H "Authorization: Bearer ${apiKey}"` : "";
  return `cd "${ADMIN_MR_BASE_DIR}/${dir}" && sudo curl -L -A "${ADMIN_MR_UA}"${authPart} "${url}" -o "${tmp}" && ` +
    `if [ "$(head -c2 "${tmp}" 2>/dev/null)" = "PK" ] && ! unzip -l "${tmp}" 2>/dev/null | grep -q '/data\\.pkl$'; then ` +
      `sudo mkdir -p "${extractDir}" && sudo unzip -o "${tmp}" -d "${extractDir}" && ` +
      `sudo find "${extractDir}" -type f \\( -iname "*.safetensors" -o -iname "*.ckpt" -o -iname "*.pt" -o -iname "*.pth" \\) -exec mv {} . \\; && ` +
      `sudo chown 525287:525287 *.safetensors *.ckpt *.pt *.pth 2>/dev/null; ` +
      `sudo rm -rf "${tmp}" "${extractDir}"; ` +
    `else ` +
      `sudo mv "${tmp}" "${fname}" && sudo chown 525287:525287 "${fname}"; ` +
    `fi`;
}

Object.assign(AdminModerationView.prototype, {
  passwordResetsHtml() {
    const rows = this.resetReqs.map((r) => adminQueueRowHtml(
      `<div class="font-display font-semibold text-sm text-ink">${_esc(r.username)}</div>
       <div class="font-mono text-xs text-muted mt-0.5">Requested ${_esc(new Date(r.created * 1000).toLocaleString())}</div>`,
      `<button type="button" onclick="adminModerationView.approveResetRequest('${_attr(r.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Approve</button>
       <button type="button" onclick="adminModerationView.denyResetRequest('${_attr(r.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Deny</button>`
    )).join("");
    return adminQueueSectionHtml("Password reset requests", this.resetReqs.length, rows);
  },

  modelRequestsHtml() {
    const rows = this.modelReqs.map((mr) => {
      const typeLabel = ADMIN_MR_TYPE_LABELS[mr.request_type] || "Model";
      const actions = [];
      if (mr.status === "pending") {
        actions.push(`<button type="button" onclick="adminModerationView.approveModelRequest('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Approve</button>`);
        actions.push(`<button type="button" onclick="adminModerationView.rejectModelRequest('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Reject</button>`);
      }
      if (ME.role === "dev" && mr.status === "approved") {
        actions.push(`<button type="button" onclick="adminModerationView.copyModelRequestCurl('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Copy curl</button>`);
      }
      if (mr.status === "approved") {
        actions.push(`<button type="button" onclick="adminModerationView.completeModelRequest('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Done</button>`);
      }
      return adminQueueRowHtml(
        `<div class="font-display font-semibold text-sm text-ink">
           <span class="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-md mr-1" style="background:var(--color-surface-2);color:var(--color-muted)">${_esc(typeLabel)}</span>
           ${_esc(mr.model_name)}
         </div>
         <div class="text-xs text-muted mt-1">${_esc(mr.username || mr.user_id)} · <a href="${_attr(mr.source_url)}" target="_blank" rel="noopener noreferrer" class="font-mono underline">${_esc(mr.source_url)}</a>${mr.note ? ` · ${_esc(mr.note)}` : ""}</div>`,
        actions.join("")
      );
    }).join("");
    return adminQueueSectionHtml("Model requests", this.modelReqs.filter((r) => r.status === "pending").length, rows);
  },
});

Object.assign(AdminModerationView.prototype, {
  async approveResetRequest(rid) {
    try {
      const r = await api(`/api/admin/password-reset-requests/${encodeURIComponent(rid)}/approve`, { method: "POST" });
      openModal(`
        <h3>New password</h3>
        <p class="text-sm text-sec mb-3">Give this to ${_esc(r.username)}:</p>
        <input type="text" readonly value="${_attr(r.password)}" class="w-full font-mono text-sm px-2.5 py-2 rounded-md border border-line bg-surface text-ink mb-3">
        <button type="button" onclick="navigator.clipboard?.writeText('${_attr(r.password)}');toast('Copied.')" class="w-full py-2.5 rounded-xl border border-line text-sm text-ink">Copy</button>
      `);
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't approve reset request.");
    }
  },

  async denyResetRequest(rid) {
    if (!confirm("Deny this password reset request?")) return;
    try {
      await api(`/api/admin/password-reset-requests/${encodeURIComponent(rid)}/deny`, { method: "POST" });
      toast("Request denied.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't deny request.");
    }
  },

  async approveModelRequest(rid) {
    try {
      await api(`/api/admin/model-requests/${encodeURIComponent(rid)}/approve`, { method: "POST" });
      toast("Model request approved.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't approve model request.");
    }
  },

  async rejectModelRequest(rid) {
    if (!confirm("Reject this model request?")) return;
    try {
      await api(`/api/admin/model-requests/${encodeURIComponent(rid)}/reject`, { method: "POST" });
      toast("Model request rejected.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't reject model request.");
    }
  },

  async completeModelRequest(rid) {
    if (!confirm("Mark this model request as installed and remove it from the queue?")) return;
    try {
      await api(`/api/admin/model-requests/${encodeURIComponent(rid)}/complete`, { method: "POST" });
      toast("Marked installed.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't mark request done.");
    }
  },

  copyModelRequestCurl(rid) {
    const mr = this.modelReqs.find((r) => r.id === rid);
    if (!mr) return;
    const type = mr.request_type || "checkpoint";
    const base = (mr.model_name || "model").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "model";
    const subdir = ADMIN_MR_SUBDIRS[type] || "checkpoints";
    const slug = base + adminMrExtFor(mr.source_url, type);
    const cmds = [adminMrDownloadBlock(subdir, mr.source_url, slug, mr.resolved_api_key)];
    if (type === "anima" && mr.vae_url) cmds.push(adminMrDownloadBlock("vae", mr.vae_url, base + "_vae" + adminMrExtFor(mr.vae_url, type), mr.resolved_vae_api_key));
    if (type === "anima" && mr.text_encoder_url) cmds.push(adminMrDownloadBlock("text_encoders", mr.text_encoder_url, base + "_text_encoder" + adminMrExtFor(mr.text_encoder_url, type), mr.resolved_text_encoder_api_key));
    navigator.clipboard?.writeText(cmds.join(" && "));
    toast("Command copied.");
  },
});

AdminModerationView.prototype.render = function () {
  this.main.innerHTML = `
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", "Moderation", `${this.attentionTotal()} items need attention`)}
    ${this.pendingSignupsHtml()}
    ${this.flaggedEndpointsHtml()}
    ${this.passwordResetsHtml()}
    ${this.modelRequestsHtml()}
  `;
};
```

This `render()` replaces Task 1's temporary one — same "last full reassignment wins" pattern as `settings-appearance.js`. Ensure the file ends with exactly ONE `render()` assignment after this step.

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
    page.goto("http://localhost:3001/admin-moderation")
    page.wait_for_selector("text=Password reset requests", timeout=8000)
    assert page.is_visible("text=Model requests")
    print("OK: password-reset and model-request queues render")
    browser.close()
EOF
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-moderation.js
git diff --cached --stat
git commit -m "Add Admin Moderation password-reset and model-request queues"
git diff HEAD --stat -- new_ui/js/admin-moderation.js
```

---

### Task 3: Title requests + Image reports + Content reports queues

**Files:**
- Modify: `new_ui/js/admin-moderation.js`

**Interfaces:**
- Consumes: `AdminModerationView` (Tasks 1–2), `openModal()`.
- Produces: `AdminModerationView.prototype.titleRequestsHtml()`, `.imageReportsHtml()`, `.contentReportsHtml()`, `.approveTitleRequest(uid)`, `.rejectTitleRequest(uid)`, `.reviewImageReport(rid)`, `.reviewContentReport(rid)` — appended, plus a final `render()` reassignment adding all three sections (the complete, final screen).

- [ ] **Step 1: Append to `new_ui/js/admin-moderation.js`** (before the final `if (typeof window...)` block)

```js
Object.assign(AdminModerationView.prototype, {
  titleRequestsHtml() {
    const rows = this.titleReqs.map((tr) => adminQueueRowHtml(
      `<div class="font-display font-semibold text-sm text-ink">"${_esc(tr.title || "")}" — ${_esc(tr.display_name || tr.username)}</div>
       <div class="text-xs text-muted mt-0.5">Requested by @${_esc(tr.username)}</div>`,
      `<button type="button" onclick="adminModerationView.approveTitleRequest('${_attr(tr.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Approve</button>
       <button type="button" onclick="adminModerationView.rejectTitleRequest('${_attr(tr.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Reject</button>`
    )).join("");
    return adminQueueSectionHtml("Title requests", this.titleReqs.length, rows);
  },

  imageReportsHtml() {
    const rows = this.imageReports.map((ir) => adminQueueRowHtml(
      `<div class="flex gap-3 items-center">
         ${ir.image ? `<img src="${_attr(ir.image)}" alt="" class="w-14 h-14 rounded-lg object-cover flex-none">` : ""}
         <div class="min-w-0">
           <div class="text-sm text-ink">Claimed: ${ir.claimed_explicit ? "NSFW" : "SFW"} <span class="text-muted text-xs">(current: ${ir.current_explicit ? "NSFW" : "SFW"})</span></div>
           <div class="text-xs text-muted mt-0.5">${_esc(ir.reporter_username || ir.reporter_id)}${ir.note ? ` · ${_esc(ir.note)}` : ""}</div>
         </div>
       </div>`,
      `<button type="button" onclick="adminModerationView.reviewImageReport('${_attr(ir.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Review</button>`
    )).join("");
    return adminQueueSectionHtml("Image reports", this.imageReports.length, rows);
  },

  contentReportsHtml() {
    const rows = this.contentReports.map((cr) => adminQueueRowHtml(
      `<div class="flex gap-3 items-center">
         ${cr.image ? `<img src="${_attr(cr.image)}" alt="" class="w-14 h-14 rounded-lg object-cover flex-none">` : ""}
         <div class="min-w-0">
           <div class="text-sm text-ink">${_esc(cr.label || cr.kind)}</div>
           <div class="text-xs text-muted mt-0.5">${_esc(cr.reporter_username || cr.reporter_id)}${cr.note ? ` · ${_esc(cr.note)}` : ""}</div>
         </div>
       </div>`,
      `<button type="button" onclick="adminModerationView.reviewContentReport('${_attr(cr.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">Review</button>`
    )).join("");
    return adminQueueSectionHtml("Content reports", this.contentReports.length, rows);
  },
});

Object.assign(AdminModerationView.prototype, {
  async approveTitleRequest(uid) {
    try {
      await api(`/api/admin/title-requests/${encodeURIComponent(uid)}/approve`, { method: "POST" });
      toast("Title approved.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't approve title.");
    }
  },

  async rejectTitleRequest(uid) {
    if (!confirm("Reject this title request?")) return;
    try {
      await api(`/api/admin/title-requests/${encodeURIComponent(uid)}/reject`, { method: "POST" });
      toast("Title rejected.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't reject title.");
    }
  },

  reviewImageReport(rid) {
    const report = this.imageReports.find((r) => r.id === rid);
    if (!report) return;
    openModal(`
      <h3>Review image report</h3>
      <p class="text-sm text-sec mb-3">Claimed: ${report.claimed_explicit ? "NSFW" : "SFW"} · Current: ${report.current_explicit ? "NSFW" : "SFW"}</p>
      <label class="flex items-center gap-2.5 mb-3 text-sm text-ink">
        <input type="checkbox" id="ir_explicit" ${report.current_explicit ? "checked" : ""}>
        Mark as explicit (NSFW)
      </label>
      <textarea id="ir_note" placeholder="Admin note (optional)" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm mb-3" style="min-height:60px"></textarea>
      <button type="button" id="ir_submit" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Save</button>
    `);
    document.getElementById("ir_submit").onclick = async () => {
      const isExplicit = document.getElementById("ir_explicit").checked;
      const adminNote = document.getElementById("ir_note").value.trim() || null;
      try {
        await api(`/api/admin/image-reports/${encodeURIComponent(rid)}/resolve`, { method: "POST", body: JSON.stringify({ is_explicit: isExplicit, admin_note: adminNote }) });
        toast("Report resolved.");
        closeModal();
        await this.load();
      } catch (e) {
        errorToast(e.message || "Couldn't resolve report.");
      }
    };
  },

  reviewContentReport(rid) {
    const report = this.contentReports.find((r) => r.id === rid);
    if (!report) return;
    openModal(`
      <h3>Review content report</h3>
      <p class="text-sm text-sec mb-3">${_esc(report.label || report.kind)}</p>
      <label class="flex items-center gap-2.5 mb-4 text-sm text-ink">
        <input type="checkbox" id="cr_explicit">
        Mark as explicit (NSFW)
      </label>
      <button type="button" id="cr_submit" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Save</button>
    `);
    document.getElementById("cr_submit").onclick = async () => {
      const isExplicit = document.getElementById("cr_explicit").checked;
      try {
        await api(`/api/admin/content-reports/${encodeURIComponent(rid)}/resolve`, { method: "POST", body: JSON.stringify({ is_explicit: isExplicit }) });
        toast("Report resolved.");
        closeModal();
        await this.load();
      } catch (e) {
        errorToast(e.message || "Couldn't resolve report.");
      }
    };
  },
});

AdminModerationView.prototype.render = function () {
  this.main.innerHTML = `
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", "Moderation", `${this.attentionTotal()} items need attention`)}
    ${this.pendingSignupsHtml()}
    ${this.flaggedEndpointsHtml()}
    ${this.passwordResetsHtml()}
    ${this.modelRequestsHtml()}
    ${this.titleRequestsHtml()}
    ${this.imageReportsHtml()}
    ${this.contentReportsHtml()}
  `;
};
```

This is the final, complete `render()` for this screen — it replaces Task 2's version. Ensure exactly ONE `render()` assignment remains in the file after this step (delete Task 2's version's body when applying this one).

- [ ] **Step 2: Verify live with Playwright — full screen**

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
    page.goto("http://localhost:3001/admin-moderation")
    page.wait_for_selector("text=Content reports", timeout=8000)
    for section in ["Pending signups", "Flagged endpoints", "Password reset requests", "Model requests", "Title requests", "Image reports", "Content reports"]:
        assert page.is_visible(f"text={section}"), f"missing section: {section}"
    print("OK: all seven moderation queues render")
    browser.close()
EOF
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin-moderation.js
git diff --cached --stat
git commit -m "Add Admin Moderation title-request, image-report, and content-report queues"
git diff HEAD --stat -- new_ui/js/admin-moderation.js
```

---

### Task 4: Link Moderation from the Overview dashboard

**Files:**
- Modify: `new_ui/js/admin.js`

**Interfaces:**
- Consumes: nothing new — `AdminOverviewView` already exists from the prior sub-project.
- Produces: nothing new for later tasks — this is the final task in this sub-project.

- [ ] **Step 1: Add a jump link from the attention banner and a Moderation row**

In `new_ui/js/admin.js`, find the attention banner block inside `render()` (the `<div class="p-3.5 rounded-[13px] border ...">` containing "Needs attention"/"All clear"). Add a jump button when there's something pending:

Find:
```js
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
```

Replace with:
```js
      <div class="p-3.5 rounded-[13px] border mb-5" style="border-color:${attentionTotal > 0 ? "var(--color-warn)" : "var(--color-line)"};background:${attentionTotal > 0 ? "color-mix(in srgb, var(--color-warn) 10%, var(--color-surface))" : "var(--color-surface)"}">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="font-mono text-[10px] tracking-[.14em] uppercase" style="color:${attentionTotal > 0 ? "var(--color-warn)" : "var(--color-muted)"}">${attentionTotal > 0 ? "Needs attention" : "All clear"}</div>
          ${attentionTotal > 0 ? `<button type="button" onclick="navigate('/admin-moderation')" class="px-2.5 py-1 rounded-md text-xs text-paper" style="background:var(--color-warn)">Jump to moderation</button>` : ""}
        </div>
        <div class="text-[13px] text-ink">${attentionTotal > 0
          ? [
              this.pending.length ? `${this.pending.length} pending` : "",
              this.flagged.length ? `${this.flagged.length} flagged` : "",
              this.resetReqs.length ? `${this.resetReqs.length} resets` : "",
              this.pendingModelReqs.length ? `${this.pendingModelReqs.length} model reqs` : "",
            ].filter(Boolean).join(" · ")
          : "Nothing pending review."}</div>
      </div>
```

Also find the "Users" section header (`<div class="flex items-center justify-between mb-3">` containing "See all →") and add a matching Moderation entry point right after the whole users block, at the end of `render()`'s template, just before the closing backtick:

Find the end of the template string (the final `${this.users.slice(0, 5).map(userRow).join("")}</div>` line followed by the closing `` ` `` and `;`), and insert a new section before that closing div wraps up — specifically, add this block immediately after `<div class="flex flex-col gap-2">${this.users.slice(0, 5).map(userRow).join("")}</div>`:

```js
      <div class="flex items-center justify-between mt-5 mb-3">
        <div class="font-display font-semibold text-base text-ink">Moderation</div>
        <span class="font-mono text-xs cursor-pointer" style="color:var(--color-accent)" onclick="navigate('/admin-moderation')">Open →</span>
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
    page.wait_for_selector("text=Moderation", timeout=8000)
    page.click("text=Open →")
    page.wait_for_selector("text=Content reports", timeout=8000)
    print("OK: overview links through to moderation")
    browser.close()
EOF
```

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add new_ui/js/admin.js
git diff --cached --stat
git commit -m "Link Moderation queue from the Admin overview dashboard"
git diff HEAD --stat -- new_ui/js/admin.js
```

---

## Self-Review Notes

- **Spec coverage:** All seven queues ✓ (Tasks 1–3). No backend changes ✓. Dev-only curl-copy gating ✓ (Task 2). Escaping discipline (`_esc`/`_attr` on every user-controlled string) ✓ applied throughout. Overview→Moderation link ✓ (Task 4). Confirm-guard corrected to match legacy's actual behavior (deny/block/reject/mark-done get a confirm, approve/allow don't) — global constraints section documents this correction explicitly.
- **Type consistency:** `AdminModerationView`'s per-queue HTML-builder methods (`pendingSignupsHtml`, `flaggedEndpointsHtml`, `passwordResetsHtml`, `modelRequestsHtml`, `titleRequestsHtml`, `imageReportsHtml`, `contentReportsHtml`) and action methods referenced in each `render()` reassignment match exactly across Tasks 1–3. `window.adminModerationView` singleton name matches what `router.js`'s route handler assigns and what every rendered `onclick` attribute references.
- **No placeholders:** every step has complete, runnable code.
