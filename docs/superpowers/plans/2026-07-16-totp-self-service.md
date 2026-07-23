# Self-Service TOTP Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing-but-unreachable TOTP backend endpoints through `new_ui`'s Settings (login-requirement toggle + reset flow), and add one new admin endpoint that closes a real account-lockout gap (no email exists in this app — TOTP is the only self-service identity proof there is).

**Architecture:** Three additive changes, no schema changes: (1) one new admin router endpoint composing two already-tested repository functions; (2) new UI in `new_ui/js/settings-account.js` reusing the exact QR/6-digit-code/backup-codes UI pieces already built for registration (`new_ui/js/login.js`'s `totpBoxes()`, `new_ui/js/qrcode-generator.js`'s `qrcode()`, `new_ui/js/wait.js`'s `backupCodesHtml()`); (3) one new admin-panel button in `new_ui/js/admin-users.js` following the existing suspend/unsuspend button pattern exactly.

**Tech Stack:** FastAPI + SQLAlchemy Core (backend, unchanged patterns), vanilla JS + Tailwind (`new_ui`, unchanged patterns), pytest with the existing `db_conn` fixture (backend tests), Playwright live-server checks (frontend verification — this codebase has no JS test harness).

## Global Constraints

- TOTP is mandatory for every account, permanently, set at registration — never fully removable by the user. No "disable TOTP entirely" action is exposed anywhere in this plan.
- SFA (`totp_login_required = false`, default) vs MFA (`totp_login_required = true`) controls login only. Self-service password reset (`POST /password-reset/totp`) is always TOTP-mandatory regardless of this flag — unchanged, not touched by this plan.
- The admin clear endpoint drops a user to a temporarily-inconsistent `totp_enabled = false` state (matches a fresh, not-yet-onboarded account) — the user must run the Settings Add/Reset-style flow again on next login. This is intentional, not a bug.
- No new database columns, no new repository functions — `POST /admin/users/{uid}/totp/clear` composes `user_repo.set_totp_secret(uid, None)` + `user_repo.set_totp_enabled(uid, False)`, both of which already exist and are already tested; `set_totp_enabled(uid, False)` already drops `totp_login_required` to `0` as an existing side effect (`backend/repositories/users.py:121-125`) — do not duplicate that logic.
- Every mutating endpoint gets a `log.info` on success, per this repo's standing logging rule (`backend/state.py`'s shared `log` object).
- Every new function with real logic gets a test alongside it, per this repo's standing testing rule. No JS test harness exists for `new_ui` — frontend verification is via balance-checks + live Playwright checks against the running dev server (this repo's established convention, not a gap to fill).

---

### Task 1: Backend — admin TOTP-clear endpoint

**Files:**
- Modify: `backend/routers/admin.py` (new route, placed near the existing `admin_suspend_user`/`admin_unsuspend_user` routes at line ~300-320, same file/section)
- Test: `backend/tests/test_users_repo.py` (same file already holding `test_totp_secret_roundtrip_and_stripped_from_user_row`/`test_totp_enabled_flag` — add the new router-level test here, matching this session's established pattern of testing router functions directly via `db_conn` + a constructed `current_user` dict, as already done in `backend/tests/test_lore_repo.py`/`test_settings_router.py`/`test_forum_router.py`)

**Interfaces:**
- Consumes: `user_repo.set_totp_secret(uid, None)`, `user_repo.set_totp_enabled(uid, False)`, `user_repo.get_user_by_id(uid)` — all already exist in `backend/repositories/users.py`, unchanged.
- Produces: `POST /admin/users/{uid}/totp/clear` → `{"id": ..., "totp_enabled": false, "totp_login_required": false, ...}` (the fetched-and-returned user row, matching `admin_suspend_user`'s/`admin_unsuspend_user`'s existing convention of returning `await user_repo.get_user_by_id(uid)`). Task 4 (frontend admin button) consumes this endpoint by URL/method only, no response-shape dependency beyond a 200 on success.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_users_repo.py` (after `test_totp_enabled_flag`, before `test_totp_backup_codes_roundtrip_and_consume`):

```python
async def test_admin_clear_totp_route_resets_account_to_sfa(db_conn):
    from backend.routers.admin import admin_clear_user_totp

    user = await user_repo.create_user("repo_test_totp_clear", "s3cret-password")
    await user_repo.set_totp_secret(user["id"], "JBSWY3DPEHPK3PXP", ["aaaa1111", "bbbb2222"])
    await user_repo.set_totp_enabled(user["id"], True)
    await user_repo.set_totp_login_required(user["id"], True)

    admin = {"id": "admin-totp-clear-1", "username": "admin", "is_admin": True}
    result = await admin_clear_user_totp(user["id"], current_user=admin)

    assert result["totp_enabled"] is False
    assert result["totp_login_required"] is False
    assert await user_repo.get_totp_secret(user["id"]) is None

    fetched = await user_repo.get_user_by_id(user["id"])
    assert fetched["totp_enabled"] is False
    assert fetched["totp_login_required"] is False


async def test_admin_clear_totp_route_404_for_missing_user(db_conn):
    from fastapi import HTTPException
    from backend.routers.admin import admin_clear_user_totp

    admin = {"id": "admin-totp-clear-2", "username": "admin", "is_admin": True}
    with pytest.raises(HTTPException) as exc_info:
        await admin_clear_user_totp("nonexistent-uid", current_user=admin)

    assert exc_info.value.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_users_repo.py -k test_admin_clear_totp -v"`
Expected: FAIL with `ImportError: cannot import name 'admin_clear_user_totp'` (the function doesn't exist yet).

- [ ] **Step 3: Add the route to `backend/routers/admin.py`**

Insert immediately after `admin_unsuspend_user` (after the line `return await user_repo.get_user_by_id(uid)` that ends that function, before the `@api.get("/admin/users/{uid}/notes")` route):

```python
@api.post("/admin/users/{uid}/totp/clear")
async def admin_clear_user_totp(uid: str, current_user: dict = Depends(get_admin)):
    """Lockout recovery: this app collects no email, so a user's TOTP secret
    plus backup codes are their only self-service identity proof. If both are
    lost, there is no other recovery path — this clears TOTP entirely,
    dropping the account back to a fresh, not-yet-onboarded-TOTP state (the
    user must run the Settings TOTP setup flow again on next login)."""
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await user_repo.set_totp_secret(uid, None)
    await user_repo.set_totp_enabled(uid, False)
    log.info("admin: totp cleared by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_users_repo.py -k test_admin_clear_totp -v"`
Expected: `2 passed`.

- [ ] **Step 5: Run the full test_users_repo.py file to confirm no regression**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_users_repo.py -v"`
Expected: all tests pass (no regression from the new route/tests).

- [ ] **Step 6: Commit**

```bash
git add backend/routers/admin.py backend/tests/test_users_repo.py
git commit -m "Add admin TOTP-clear endpoint for account-lockout recovery"
```

---

### Task 2: Settings — TOTP status display + login-requirement toggle

**Files:**
- Modify: `new_ui/js/settings-account.js` (add TOTP section below the existing password-change block, add toggle logic)

**Interfaces:**
- Consumes: `ME.totp_login_required` (boolean, already present on the global `ME` object fetched at boot via `GET /api/auth/me` — confirmed the backend's `_user_row` helper in `backend/db.py` already includes and correctly types this field, no backend change needed to read it), `PUT /api/auth/totp/login-enforcement` (existing endpoint, body `{required: bool, code: string}`), `totpBoxes(err)` (existing function in `new_ui/js/login.js`, renders 6 individual digit `<input>`s with `data-totp="N"` attributes).
- Produces: a `toggleTotpRequirement()` method on `AccountSettingsView` that Task 3 does not depend on, but both tasks share the same modal-wiring convention (`openModal`/`closeModal` returning/taking a `layer` element) established elsewhere in this codebase.

- [ ] **Step 1: Add the TOTP status section to `render()`**

In `new_ui/js/settings-account.js`, change the end of `render()` (currently ending with the "Save language" button) to add a new section before the closing template literal backtick. Current end of the template (inside `render()`):

```js
      ${sEyebrowHtml("Language")}
      <div class="mb-2">
        <label class="block text-xs text-sec mb-1">Interface language</label>
        <input type="text" id="acct_lang" value="${_attr(lang)}" placeholder="English" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <button type="button" onclick="accountView.saveLanguage()" class="w-full py-2.5 rounded-xl border text-sm" style="border-color:var(--color-line);color:var(--color-ink)">
        Save language
      </button>
    `;
  }
```

New version (adds a TOTP section between the password button and the Language eyebrow):

```js
      ${sEyebrowHtml("Language")}
      <div class="mb-2">
        <label class="block text-xs text-sec mb-1">Interface language</label>
        <input type="text" id="acct_lang" value="${_attr(lang)}" placeholder="English" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <button type="button" onclick="accountView.saveLanguage()" class="w-full py-2.5 rounded-xl border text-sm" style="border-color:var(--color-line);color:var(--color-ink)">
        Save language
      </button>

      ${sEyebrowHtml("Two-factor authentication")}
      <div class="mb-3 rounded-[13px] border border-line bg-surface p-3.5">
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="min-w-0">
            <div class="text-sm text-ink font-medium">${ME?.totp_login_required ? "Required at sign-in" : "Not required at sign-in"}</div>
            <div class="text-xs text-muted mt-0.5">Always required for password reset, since this app has no email to fall back on.</div>
          </div>
          <button type="button" onclick="accountView.openTotpRequirementModal()" class="settings-toggle${ME?.totp_login_required ? " on" : ""}" style="flex:none"><span class="settings-toggle-knob"></span></button>
        </div>
        <button type="button" onclick="accountView.openTotpResetModal()" class="w-full py-2.5 rounded-xl border text-sm" style="border-color:var(--color-line);color:var(--color-ink)">
          Reset two-factor codes
        </button>
      </div>
    `;
  }
```

- [ ] **Step 2: Add the login-requirement toggle modal methods**

Add these methods to the `AccountSettingsView` class in `new_ui/js/settings-account.js`, right after `saveLanguage()` and before the closing `}` of the class:

```js
  openTotpRequirementModal() {
    const nextValue = !ME?.totp_login_required;
    const layer = openModal(`
      <h3>${nextValue ? "Require code at sign-in" : "Stop requiring code at sign-in"}</h3>
      <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">Confirm with your password and a current 6-digit code.</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">Password</label>
        <input type="password" id="totpReqPw" autocomplete="current-password" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">6-digit code from your authenticator</div>
      <div id="totpReqBoxes">${totpBoxes(false)}</div>
      <button type="button" id="totpReqSubmit" class="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Confirm</button>
    `);
    wireTotpBoxAutoAdvance(layer);
    layer.querySelector("#totpReqSubmit").onclick = async () => {
      const password = layer.querySelector("#totpReqPw").value;
      const code = totpBoxValue(layer);
      if (!password || code.length < 6) { errorToast("Enter your password and all 6 digits."); return; }
      try {
        await api("/api/auth/totp/login-enforcement", { method: "PUT", body: JSON.stringify({ required: nextValue, code }) });
        ME.totp_login_required = nextValue;
        closeModal(layer);
        toast(nextValue ? "Now required at sign-in." : "No longer required at sign-in.");
        this.render();
      } catch (err) {
        errorToast(err.message || "Couldn't verify — check your password and code.");
      }
    };
  }
```

- [ ] **Step 3: Add the shared TOTP-box helper functions to `new_ui/js/login.js`**

`totpBoxes(err)` already exists in `new_ui/js/login.js` and is reused as-is above. Add two small new helper functions to the same file (`new_ui/js/login.js`), right after the existing `totpBoxes` function definition, so both `AuthView` and the new Settings modals can share the same auto-advance/read-value logic instead of duplicating it:

```js
function wireTotpBoxAutoAdvance(scope) {
  scope.querySelectorAll("[data-totp]").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value) {
        const next = scope.querySelector(`[data-totp="${Number(input.dataset.totp) + 1}"]`);
        if (next) next.focus();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value) {
        const prev = scope.querySelector(`[data-totp="${Number(input.dataset.totp) - 1}"]`);
        if (prev) { prev.focus(); prev.value = ""; e.preventDefault(); }
      }
    });
  });
}

function totpBoxValue(scope) {
  return Array.from(scope.querySelectorAll("[data-totp]")).map((el) => el.value || "").join("");
}
```

Register both on `window` at the bottom of `new_ui/js/login.js` (find the existing `if (typeof window !== "undefined")` block at the end of the file and add two lines to it):

```js
  window.wireTotpBoxAutoAdvance = wireTotpBoxAutoAdvance;
  window.totpBoxValue = totpBoxValue;
```

(Read the actual end of `new_ui/js/login.js` first to see the exact existing `window.X = X` block and add these two lines inside it, not as a separate new block.)

- [ ] **Step 4: Verify balance and served content**

Run:
```bash
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/js/settings-account.js').read()
print('settings-account.js braces:', s.count('{') - s.count('}'))
"
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/js/login.js').read()
print('login.js braces:', s.count('{') - s.count('}'))
"
curl -s http://localhost:3003/js/settings-account.js | grep -c 'openTotpRequirementModal'
curl -s http://localhost:3003/js/login.js | grep -c 'function wireTotpBoxAutoAdvance'
```
Expected: both brace counts `0`; both grep counts `1` or more.

- [ ] **Step 5: Playwright-verify the toggle end-to-end**

Write `/tmp/verify_totp_task2.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    page.goto("http://localhost:3003/settings-account", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(500)

    status_text = page.inner_text("body")
    print("Contains TOTP status line:", "sign-in" in status_text)
    assert "sign-in" in status_text

    print("PASS (status section renders; full toggle submit requires a real TOTP-enabled test account and is not exercised here — see manual test note in the task report)")
    browser.close()
```
Run: `python3 /tmp/verify_totp_task2.py`
Expected: `PASS` printed. (Note: the `test` account may not have TOTP configured/enabled in this dev environment — if `openTotpRequirementModal` can't be fully exercised end-to-end because there's no known current TOTP secret to compute a valid code from, that's expected; the script above only needs to confirm the section renders correctly and the modal opens without a JS error. If you want a deeper check, `pyotp.TOTP(secret).now()` in a Python one-liner can compute a valid live code for any secret you control via a direct DB/API call, but that is optional verification, not required for this task's completion.)

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/settings-account.js new_ui/js/login.js
git commit -m "Add TOTP login-requirement toggle to Settings, extract shared totp-box helpers"
```

---

### Task 3: Settings — TOTP reset flow (disable → re-setup → re-enable → backup codes)

**Files:**
- Modify: `new_ui/js/settings-account.js` (add `openTotpResetModal()` and the chained setup/enable flow)

**Interfaces:**
- Consumes: `POST /api/auth/totp/disable` (body `{password, code}`), `POST /api/auth/totp/setup` (no body, returns `{secret, otpauth_uri}`), `POST /api/auth/totp/enable` (body `{code}`, returns `{ok, backup_codes}`), `qrcode(0, "M")` + `.addData()`/`.make()`/`.createSvgTag(4,0)` (existing global from `new_ui/js/qrcode-generator.js`, used exactly as in `new_ui/js/onboard.js:41-45`), `backupCodesHtml(codes)` (existing function in `new_ui/js/wait.js`), `wireTotpBoxAutoAdvance`/`totpBoxValue`/`totpBoxes` from Task 2.
- Produces: nothing consumed by later tasks — this is the last piece of the Settings-side work.

- [ ] **Step 1: Add the reset-flow methods**

Add to `AccountSettingsView` in `new_ui/js/settings-account.js`, after `openTotpRequirementModal()`:

```js
  openTotpResetModal() {
    const layer = openModal(`
      <h3>Reset two-factor codes</h3>
      <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">Confirm with your password and a current 6-digit code, then set up a new authenticator.</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">Password</label>
        <input type="password" id="totpResetPw" autocomplete="current-password" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">6-digit code from your current authenticator</div>
      <div id="totpResetBoxes">${totpBoxes(false)}</div>
      <button type="button" id="totpResetSubmit" class="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Continue</button>
    `);
    wireTotpBoxAutoAdvance(layer);
    layer.querySelector("#totpResetSubmit").onclick = async () => {
      const password = layer.querySelector("#totpResetPw").value;
      const code = totpBoxValue(layer);
      if (!password || code.length < 6) { errorToast("Enter your password and all 6 digits."); return; }
      try {
        await api("/api/auth/totp/disable", { method: "POST", body: JSON.stringify({ password, code }) });
        closeModal(layer);
        ME.totp_login_required = false;
        await this.openTotpSetupModal();
      } catch (err) {
        errorToast(err.message || "Couldn't verify — check your password and code.");
      }
    };
  }

  async openTotpSetupModal() {
    let secret = "", otpauthUri = "";
    try {
      const result = await api("/api/auth/totp/setup", { method: "POST" });
      secret = result.secret;
      otpauthUri = result.otpauth_uri;
    } catch (err) {
      errorToast(err.message || "Couldn't start setup.");
      return;
    }
    const qr = qrcode(0, "M");
    qr.addData(otpauthUri);
    qr.make();
    const layer = openModal(`
      <h3>Set up your new authenticator</h3>
      <div class="flex items-center gap-3 mb-3 mt-2">
        <div class="w-[84px] h-[84px] flex-none rounded-lg bg-white p-1.5 overflow-hidden [&>svg]:w-full [&>svg]:h-full">${qr.createSvgTag(4, 0)}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] leading-relaxed text-sec mb-1.5">Scan with an authenticator app, or</p>
          <button type="button" id="totpSetupToggleSecret" class="text-primary font-mono text-[11px]">Reveal the key</button>
          <div id="totpSetupSecretValue" class="mt-1.5 font-mono text-[11px] text-ink break-all hidden">${_esc(secret)}</div>
        </div>
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">6-digit code from your app</div>
      <div id="totpSetupBoxes">${totpBoxes(false)}</div>
      <button type="button" id="totpSetupSubmit" class="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Confirm</button>
    `);
    wireTotpBoxAutoAdvance(layer);
    layer.querySelector("#totpSetupToggleSecret").onclick = () => {
      layer.querySelector("#totpSetupSecretValue").classList.toggle("hidden");
    };
    layer.querySelector("#totpSetupSubmit").onclick = async () => {
      const code = totpBoxValue(layer);
      if (code.length < 6) { errorToast("Enter all 6 digits."); return; }
      try {
        const result = await api("/api/auth/totp/enable", { method: "POST", body: JSON.stringify({ code }) });
        ME.totp_enabled = true;
        closeModal(layer);
        this.openTotpBackupCodesModal(result.backup_codes);
      } catch (err) {
        errorToast(err.message || "Invalid code — try again.");
      }
    };
  }

  openTotpBackupCodesModal(codes) {
    const layer = openModal(`
      <h3>Save your new recovery codes</h3>
      ${backupCodesHtml(codes)}
      <button type="button" id="totpBackupDone" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Done</button>
    `);
    layer.querySelector("#totpBackupDone").onclick = () => {
      closeModal(layer);
      toast("Two-factor codes reset.");
      this.render();
    };
  }
```

- [ ] **Step 2: Verify balance and served content**

Run:
```bash
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/js/settings-account.js').read()
print('braces:', s.count('{') - s.count('}'))
"
curl -s http://localhost:3003/js/settings-account.js | grep -c 'openTotpSetupModal\|openTotpBackupCodesModal\|openTotpResetModal'
```
Expected: `braces: 0`; grep count `3` or more.

- [ ] **Step 3: Playwright-verify the reset entry point renders without error**

Write `/tmp/verify_totp_task3.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    page.goto("http://localhost:3003/settings-account", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(500)
    page.click("text=Reset two-factor codes")
    page.wait_for_timeout(500)
    modal_visible = page.is_visible(".modal-layer")
    print("reset modal opened:", modal_visible)
    assert modal_visible is True
    print("page errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_totp_task3.py`
Expected: `PASS`, empty `errors` list. (This verifies the modal opens and renders with no JS exception — it does not exercise the full disable→setup→enable chain, since that requires knowing the `test` account's actual current TOTP secret to compute a valid live code, which isn't available to a black-box Playwright script. If the `test` account's TOTP state is known/controllable in this dev environment, extend this script to complete the full chain using `pyotp.TOTP(secret).now()` for each step's code; otherwise this render-level check plus the backend test coverage in Task 1's pattern is the achievable verification here.)

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/settings-account.js
git commit -m "Add TOTP reset flow to Settings (disable, re-setup, re-enable, new backup codes)"
```

---

### Task 4: Admin — TOTP-clear button

**Files:**
- Modify: `new_ui/js/admin-users.js` (add button to the per-user action row, add the handler method)

**Interfaces:**
- Consumes: `POST /api/admin/users/{uid}/totp/clear` (Task 1).
- Produces: nothing consumed elsewhere — final task in this plan.

- [ ] **Step 1: Add the button to the per-user action row**

In `new_ui/js/admin-users.js`, inside `render()`'s per-user action-button row (the `<div class="flex flex-wrap gap-1.5">...</div>` block), add a new button. Find this existing line:

```js
          <button type="button" onclick="adminUsersView.manageNotes('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Notes</button>
```

and add the new button immediately after it:

```js
          <button type="button" onclick="adminUsersView.manageNotes('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">Notes</button>
          ${u.totp_enabled ? `<button type="button" onclick="adminUsersView.clearTotp('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Clear TOTP (locked out)</button>` : ""}
```

(Only shown when `u.totp_enabled` is true — an SFA-not-yet-configured or already-cleared account has nothing to clear.)

- [ ] **Step 2: Add the handler method**

Add to the `AdminUsersView` class in `new_ui/js/admin-users.js`, following the exact `suspend()`/`unsuspend()` pattern already in the file (confirm/api-call/toast/reload):

```js
  async clearTotp(uid) {
    if (!confirm("Clear this user's two-factor codes? They will need to set up a new authenticator the next time they sign in. Only do this if they've confirmed they've lost both their device and backup codes.")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/totp/clear`, { method: "POST" });
      toast("TOTP cleared.");
      await this.load();
    } catch (e) {
      errorToast(e.message || "Couldn't clear TOTP.");
    }
  }
```

- [ ] **Step 3: Verify balance and served content**

Run:
```bash
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/js/admin-users.js').read()
print('braces:', s.count('{') - s.count('}'))
"
curl -s http://localhost:3003/js/admin-users.js | grep -c 'clearTotp'
```
Expected: `braces: 0`; grep count `2` or more (button onclick + method definition).

- [ ] **Step 4: Playwright-verify as the admin account**

Write `/tmp/verify_totp_task4.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "claude")
    page.fill('[data-field="password"]', "0987654321")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    page.goto("http://localhost:3003/admin-users", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(1000)

    body = page.inner_text("body")
    print("Admin Users page loaded:", "Users" in body or "users" in body.lower())
    print("PASS (no user in this dev DB may currently have totp_enabled=true, so the button may not be visible on any row — that's expected and correct per the conditional rendering in Step 1, not a bug; the button's presence is confirmed structurally via the served-JS grep check in Step 3 instead)")
    browser.close()
```
Run: `python3 /tmp/verify_totp_task4.py`
Expected: page loads without error, `PASS` printed.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/admin-users.js
git commit -m "Add admin TOTP-clear button for locked-out users"
```

---

## Final verification (after all tasks)

- [ ] Run the full backend test suite once to confirm no cross-task regression: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/ -v"` — expect all tests passing, including the two new ones from Task 1.
- [ ] Re-run all four `/tmp/verify_totp_task*.py` scripts in sequence to confirm no task's change regressed an earlier one.
- [ ] Manually walk through the full user-facing flow at least once in a real browser (not just Playwright): as the `claude` admin account (or any account with a known, controllable TOTP secret), open Settings → Account, toggle "Require at sign-in" on and off, then run "Reset two-factor codes" all the way through to seeing new backup codes — this is the one part of this plan that automated verification could only partially cover (per Task 2 Step 5 and Task 3 Step 3's notes), since it requires a real, live TOTP code computed from a secret the tester actually controls.
