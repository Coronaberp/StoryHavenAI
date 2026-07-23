# Auth Onboarding Rework — register → onboard → wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split account creation into three URLs — `/register` (collect credentials, no backend call), `/onboard` (bind TOTP recovery atomically with account creation), `/wait` (pending-approval screen, shows one-time backup codes) — themed as "a sealed lorebook you open," replacing the current single-screen tabbed `AuthView` register flow.

**Architecture:** Backend: one new stateless endpoint (`POST /api/auth/totp/provision`) plus a rewrite of `register()` to atomically verify-and-bind TOTP before creating the user row — no session/pending-auth hack needed, since the TOTP secret is generated before any account exists. Frontend: three new chromeless routes in the existing `new_ui/js/router.js`, each a plain render-function module (matching `login.js`'s existing style), sharing state via one plain in-memory object (`OnboardFlow`) and reusing `login.js`'s existing `loginEmbers()`/`authField()`/`totpBoxes()` helpers.

**Tech Stack:** FastAPI + Pydantic + pyotp (backend, all already in use in `backend/auth.py`), vanilla JS + Tailwind (frontend), a vendored single-file QR encoder (no CDN, no npm — matches this repo's existing Tailwind-CLI-vendoring precedent in `rebuild.sh`).

## Global Constraints

- Zero comments in any `.py` or `.js` file added or modified, ever — no exceptions.
- No single-letter variable names outside genuine loop indices; no magic numbers.
- Never nest more than 3 levels deep — extract a function instead.
- Classes only where real per-instance state exists. `OnboardFlow` (Task 6) is a plain mutable object with fields, not a class — it holds no methods, is set by one screen and read by another, same shape as this repo's existing `ME` global in `app-session.js`. Keeping it a plain object, not a class, per the OOP-for-stateful-code-only rule.
- Every new function/class with real logic gets an automated test alongside it.
- Every mutating backend flow gets `log.info`/`warning`/`error` via `backend/state.py`'s `log`.
- **Phone viewport only, full stop.** No `md:`/`lg:`/`xl:`/`2xl:` Tailwind classes anywhere in this plan. No sidebar/desktop chrome changes. Every screen in this plan is already chromeless (`CHROMELESS_ROUTES`) so this mostly matters for internal spacing/sizing decisions, not chrome — but it still applies.
- **None of these screens may scroll.** The phone frame is 392×848 (`viewBox`/devtools target already established this session). `login.js`'s current `loginScene()` wrapper (`overflow-y-auto`, full 200px animated emblem on every view) does not fit this — it was written for a single always-short screen and breaks once a view has real content (QR + secret + 6-digit boxes, or a backup-codes grid). Task 5 replaces it with two variants: a full hero scene for sign-in only, and a compact fixed-header scene for every other view, both non-scrolling.
- `new_ui/js/app-session.js`'s `api(path, opts)` helper is reused for every fetch — no second fetch wrapper.
- Backup codes returned by `POST /api/auth/register` are shown to the user exactly once (on `/wait`) and never persisted anywhere retrievable afterward — same rule this codebase already applies to `/api/auth/totp/enable`'s backup codes.

**Amendment (discovered during Task 4's execution): no JS runtime exists in this environment.** No `node`, `bun`, `deno`, or `npx` is available anywhere in this environment (confirmed by the controller directly, not just one subagent's sandbox) — a deliberate, permanent constraint per the human ("node is an unneeded extra"), not a gap to fix by installing one. This supersedes every `node --test` step in Tasks 1 and 5 below: `tests/new_ui/`'s harness cannot run here and is not a goal to pursue. From Task 5 onward, pure-logic JS functions (like `spineStitchHtml`) are verified by code inspection and live browser behavior only — manual verification via `./rebuild.sh` at ~390-400px width (already this plan's standard for DOM-heavy screens) is the acceptance bar for all `new_ui/js/*` work, not a substitute automated test. Task 4's vendored QR library is accepted on structural verification (correct MIT license header, author, and required API methods present, confirmed by direct inspection) plus a real-device QR scan during Task 9's manual verification — not a Node smoke test.

---

## Pre-flight findings (do not re-derive — already verified against the running code)

**Amendment (discovered during Task 3's review, applied after Tasks 1-3 were already implemented):** `RegisterIn.totp_secret`/`totp_code` are **required fields, not optional**, and `register()`'s implementation binds TOTP unconditionally rather than only "if provided." This plan's original text below (written before Task 3 executed) describes them as optional — that text is superseded by this amendment; the actual implementation (commit `e7c6c77`) requires TOTP. Reasoning: a more complete pre-existing implementation of `register()` was already sitting uncommitted in `backend/auth.py` before this plan started (a JWT+TOTP auth rewrite predating this session), with TOTP always mandatory, malformed-secret exception handling, and a dedicated per-`(ip, username)` `_TOTP_ATTEMPTS` throttle — none of which the original optional-TOTP design in this plan replicated. The human confirmed TOTP should always be required at registration (since `/onboard` always completes before the real `POST /register` call in this flow — "optional" was never reachable in practice) and the reconciled implementation adopts the pre-existing version's safety properties while keeping the stricter verify-before-username-check ordering this plan's Task 3 established (avoids leaking username-taken status to a caller with an unverified code). Tasks 4 onward are unaffected: `/onboard` (Task 7) already always sends `totp_secret`+`totp_code` together, matching mandatory TOTP with no code changes needed there.

- `POST /api/auth/register` (`backend/auth.py:211-231`) today only creates a `status="pending"` row and notifies admins — it issues no session/cookie. `get_current_user` (`backend/auth.py:104-111`) rejects any user whose `status != "active"`. So `/api/auth/totp/setup`/`/totp/enable` (both `Depends(get_current_user)`) are structurally unreachable for a freshly registered pending account — there is no way to bolt TOTP setup onto the existing endpoints. This plan avoids that entirely: the TOTP secret is generated by a new **stateless, public** endpoint before any account exists, then verified and bound in the same call that creates the user.
- `_generate_backup_codes()` (`backend/auth.py:441-442`), `user_repo.set_totp_secret(uid, secret, backup_codes)` (`backend/repositories/users.py:102-107`), and `user_repo.set_totp_enabled(uid, True)` (`backend/repositories/users.py:110-115`) already exist and are reused as-is — no repository changes needed.
- `TOTP_ISSUER = "StoryHaven AI"` already exists at `backend/auth.py:19`.
- `SlidingWindow` (`backend/ratelimit.py`) is the established per-IP rate-limit primitive, already imported in `backend/auth.py` and used by `_REGISTRATIONS` (`backend/auth.py:166-167`).
- This repo's backend tests are **repository/unit-level, not HTTP-level** — there is no `TestClient`/`AsyncClient` precedent anywhere in `backend/tests/` (confirmed: every file there tests repository functions directly against the `db_conn` transactional fixture in `backend/tests/conftest.py`). This plan follows that precedent: route handlers are called directly as plain async functions in tests (they're just `async def` functions under a decorator), constructing a minimal fake `Request` (`_client_ip` only ever reads `request.client.host`) rather than introducing a new HTTP-test-client dependency this codebase doesn't otherwise use.
- `new_ui/js/login.js` (329 lines) currently implements `signin`/`register`/`forgot` as three tab-switched views inside one `AuthView` class, mounted at `/login`. Its `register` tab is being removed — registration becomes its own route. `forgot` stays in `AuthView` unchanged — it's TOTP-based password recovery for an **existing active account with TOTP already enabled**, unrelated to onboarding a brand-new account.
- `new_ui/js/router.js` already has `login` and `wait` as top-level chromeless routes (`CHROMELESS_ROUTES = new Set(["login", "wait"])`); `waitEl(main)` already exists in `login.js` as a static "pending approval" message with no backup-codes handling and no animation.
- `new_ui/index.html` loads scripts in this order (all `defer`): `state-store.js`, `theme.js`, `app-session.js`, `login.js`, `router.js`, `boot.js`. New files must slot in before `router.js` (so route functions can reference their globals) and after `app-session.js` (so `api()` is defined).
- `tests/new_ui/` does not exist yet in this checkout (it's part of the separate Phase 1 plan's Task 0, not yet executed). Task 1 below stands it up if still missing, so this plan is runnable independently of Phase 1's execution order.
- The mockup's `qrPlaceholder()` (`Mobile-first app redesign/Mobile App.dc.html:350-355`) draws a fake decorative grid, not a real scannable code — not reusable. Its reveal/hide secret-key interaction (`Mobile App.dc.html:324-329`, the `showSecret` toggle) is a good UX pattern and is ported in Task 8.

## File Structure

New files:
- `new_ui/js/qrcode-generator.js` — vendored third-party QR encoder (Task 4).
- `new_ui/js/auth-scene.js` — the shared non-scrolling scene layout (full hero for sign-in, compact header for everything else) and the spine-stitch step indicator, both pure/DOM-light enough to unit test their non-DOM logic (Task 5).
- `new_ui/js/register.js` — `/register` screen (Task 6).
- `new_ui/js/onboard.js` — `/onboard` screen (Task 7).
- `new_ui/js/wait.js` — `/wait` screen, replacing `login.js`'s `waitEl` (Task 8).
- `tests/new_ui/package.json`, `tests/new_ui/auth-scene.test.js` — JS test harness + tests for Task 5's pure logic.
- `backend/tests/test_auth_onboarding.py` — backend tests for Tasks 2 and 3.

Modified files:
- `backend/schemas.py` — add `RegisterIn`, `TotpProvisionIn`.
- `backend/auth.py` — add `POST /totp/provision`, rewrite `register()`.
- `new_ui/js/login.js` — remove the `register` tab from `AuthView`; remove `waitEl` (moved to `wait.js`); change the sign-in screen's "Create account" link to real navigation.
- `new_ui/js/router.js` — add `register`/`onboard` routes, both in `CHROMELESS_ROUTES`; point `wait` at the new `wait.js`.
- `new_ui/index.html` — new script tags in dependency order.

---

### Task 1: Stand up the JS test harness (if not already present) and add `RegisterIn`/`TotpProvisionIn` schemas

**Files:**
- Create (if missing): `tests/new_ui/package.json`
- Modify: `backend/schemas.py`
- Test: `backend/tests/test_auth_onboarding.py` (created here, extended in Tasks 2-3)

**Interfaces:**
- Produces: `RegisterIn` (username, password, optional totp_secret/totp_code), `TotpProvisionIn` (username) — Pydantic models consumed by Tasks 2 and 3.

- [ ] **Step 1: Check whether the JS harness already exists**

Run: `ls tests/new_ui/package.json 2>/dev/null && echo exists || echo missing`

If `missing`, write to `tests/new_ui/package.json`:

```json
{
  "name": "new-ui-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

If `exists`, skip this step's write — do not overwrite a harness another plan (e.g. the Phase 1 plan) may already have set up.

- [ ] **Step 2: Write the failing schema test**

Write to `backend/tests/test_auth_onboarding.py`:

```python
import pytest

from backend.schemas import RegisterIn, TotpProvisionIn

pytestmark = pytest.mark.asyncio


def test_register_in_allows_optional_totp_fields():
    body = RegisterIn(username="kael", password="s3cret-pw")
    assert body.totp_secret is None
    assert body.totp_code is None

    body_with_totp = RegisterIn(
        username="kael", password="s3cret-pw",
        totp_secret="JBSWY3DPEHPK3PXP", totp_code="123456")
    assert body_with_totp.totp_code == "123456"


def test_register_in_rejects_malformed_totp_code():
    with pytest.raises(ValueError):
        RegisterIn(username="kael", password="s3cret-pw", totp_code="12a456")


def test_totp_provision_in_requires_username():
    body = TotpProvisionIn(username="kael")
    assert body.username == "kael"
```

- [ ] **Step 3: Run and confirm failure**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/test_auth_onboarding.py -v`
Expected: FAIL — `ImportError: cannot import name 'RegisterIn'`.

- [ ] **Step 4: Add the schemas**

In `backend/schemas.py`, find the existing `class LoginIn(BaseModel):` block (around line 334) and add immediately after it:

```python
class RegisterIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    totp_secret: str | None = Field(default=None)
    totp_code: str | None = Field(default=None, min_length=6, max_length=6, pattern=r"^\d{6}$")


class TotpProvisionIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
```

- [ ] **Step 5: Run and confirm pass**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/test_auth_onboarding.py -v`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add backend/schemas.py backend/tests/test_auth_onboarding.py tests/new_ui/package.json 2>/dev/null
git commit -m "feat(auth): add RegisterIn/TotpProvisionIn schemas for onboarding flow"
```

---

### Task 2: `POST /api/auth/totp/provision` — stateless TOTP secret generation

**Files:**
- Modify: `backend/auth.py`
- Test: `backend/tests/test_auth_onboarding.py`

**Interfaces:**
- Consumes: `TotpProvisionIn` (Task 1), `TOTP_ISSUER` (`backend/auth.py:19`), `SlidingWindow` (`backend/ratelimit.py`).
- Produces: `POST /api/auth/totp/provision` → `{"secret": str, "otpauth_uri": str}`. Consumed by `new_ui/js/onboard.js` (Task 7).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_auth_onboarding.py`:

```python
import types

import pyotp

from backend.auth import totp_provision, _TOTP_PROVISIONS
from backend.schemas import TotpProvisionIn


def _fake_request(ip="127.0.0.1"):
    return types.SimpleNamespace(client=types.SimpleNamespace(host=ip))


async def test_totp_provision_returns_secret_and_uri():
    _TOTP_PROVISIONS._hits.clear()
    result = await totp_provision(TotpProvisionIn(username="kael"), _fake_request())
    assert len(result["secret"]) >= 16
    assert result["otpauth_uri"].startswith("otpauth://totp/")
    assert pyotp.TOTP(result["secret"]).verify(pyotp.TOTP(result["secret"]).now())


async def test_totp_provision_is_rate_limited_per_ip():
    from fastapi import HTTPException

    _TOTP_PROVISIONS._hits.clear()
    ip = "10.0.0.5"
    for _ in range(5):
        await totp_provision(TotpProvisionIn(username="kael"), _fake_request(ip))
    with pytest.raises(HTTPException) as excinfo:
        await totp_provision(TotpProvisionIn(username="kael"), _fake_request(ip))
    assert excinfo.value.status_code == 429
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/test_auth_onboarding.py -v -k provision`
Expected: FAIL — `ImportError: cannot import name 'totp_provision'`.

- [ ] **Step 3: Implement the endpoint**

In `backend/auth.py`, add the rate limiter immediately after `_REGISTRATIONS` (around line 167):

```python
_TOTP_PROVISIONS = SlidingWindow(
    5, 3600, "Too many verification setups from your network — try again later")
```

Add the endpoint immediately before the existing `@auth_router.post("/register")` handler:

```python
@auth_router.post("/totp/provision")
async def totp_provision(body: TotpProvisionIn, request: Request):
    ip = _client_ip(request)
    _TOTP_PROVISIONS.check(ip)
    _TOTP_PROVISIONS.record(ip)
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=normalize_username(body.username), issuer_name=TOTP_ISSUER)
    log.info("totp provisioned for pending registration: username=%s", normalize_username(body.username))
    return {"secret": secret, "otpauth_uri": uri}
```

Add `TotpProvisionIn` to the existing schema import block at the top of `backend/auth.py`:

```python
from backend.schemas import (
    LoginIn, RegisterIn, PasswordChangeIn, PasswordResetRequestIn, TotpEnableIn, TotpDisableIn,
    TotpPasswordResetIn, TotpLoginEnforcementIn, TotpProvisionIn,
)
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/test_auth_onboarding.py -v -k provision`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add backend/auth.py backend/tests/test_auth_onboarding.py
git commit -m "feat(auth): add stateless POST /totp/provision for pre-registration TOTP setup"
```

---

### Task 3: Rewrite `register()` to atomically verify-and-bind TOTP

**Files:**
- Modify: `backend/auth.py:211-231`
- Test: `backend/tests/test_auth_onboarding.py`

**Interfaces:**
- Consumes: `RegisterIn` (Task 1), `_generate_backup_codes()` (`backend/auth.py:441`), `user_repo.create_user`/`set_totp_secret`/`set_totp_enabled`/`get_user_by_username` (`backend/repositories/users.py`).
- Produces: `POST /api/auth/register` → `{"ok": True, "pending": True, "backup_codes": list[str] | None}`. Consumed by `new_ui/js/onboard.js` (Task 7).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_auth_onboarding.py`:

```python
import pyotp

from backend.auth import register
from backend.repositories import users as user_repo


async def _fake_register_request(ip="127.0.0.1"):
    return types.SimpleNamespace(client=types.SimpleNamespace(host=ip))


async def test_register_without_totp_still_works(db_conn):
    body = RegisterIn(username="onboard_test_notp", password="s3cret-password")
    result = await register(body, await _fake_register_request("10.0.1.1"))
    assert result["ok"] is True
    assert result["pending"] is True
    assert result.get("backup_codes") is None
    user = await user_repo.get_user_by_username("onboard_test_notp")
    assert user["status"] == "pending"
    assert not user["totp_enabled"]


async def test_register_with_valid_totp_binds_and_returns_backup_codes(db_conn):
    secret = pyotp.random_base32()
    code = pyotp.TOTP(secret).now()
    body = RegisterIn(username="onboard_test_totp", password="s3cret-password",
                       totp_secret=secret, totp_code=code)
    result = await register(body, await _fake_register_request("10.0.1.2"))
    assert result["ok"] is True
    assert len(result["backup_codes"]) == 8
    user = await user_repo.get_user_by_username("onboard_test_totp")
    assert user["status"] == "pending"
    assert user["totp_enabled"]


async def test_register_with_invalid_totp_code_creates_no_user(db_conn):
    secret = pyotp.random_base32()
    body = RegisterIn(username="onboard_test_bad", password="s3cret-password",
                       totp_secret=secret, totp_code="000000")
    with pytest.raises(HTTPException) as excinfo:
        await register(body, await _fake_register_request("10.0.1.3"))
    assert excinfo.value.status_code == 400
    assert await user_repo.get_user_by_username("onboard_test_bad") is None
```

Add the missing import at the top of the test file:

```python
from fastapi import HTTPException
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/test_auth_onboarding.py -v -k register`
Expected: FAIL — `test_register_with_valid_totp_binds_and_returns_backup_codes` and the invalid-code test fail because `register()` still takes `LoginIn` (no `totp_secret` field) and never checks it.

- [ ] **Step 3: Rewrite `register()`**

In `backend/auth.py`, replace the existing handler (currently at lines ~211-231):

```python
@auth_router.post("/register")
async def register(body: LoginIn, request: Request):
    ip = _client_ip(request)
    _REGISTRATIONS.check(ip)
    _REGISTRATIONS.record(ip)
    username = normalize_username(body.username)
    _login_rate_check(ip, username)
    if len(username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    existing = await user_repo.get_user_by_username(username)
    if existing:
        _login_record_failure(_client_ip(request), username)
        raise HTTPException(400, "Username already taken")
    await user_repo.create_user(username, body.password, status="pending")
    await notification_repo.notify_admins(
        "admin_signup", f"New signup: {username}",
        f"{username} registered and is awaiting approval.", "/admin")
    log.info("registration: username=%s status=pending", username)
    return {"ok": True, "pending": True}
```

with:

```python
@auth_router.post("/register")
async def register(body: RegisterIn, request: Request):
    ip = _client_ip(request)
    _REGISTRATIONS.check(ip)
    _REGISTRATIONS.record(ip)
    username = normalize_username(body.username)
    _login_rate_check(ip, username)
    if len(username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if bool(body.totp_secret) != bool(body.totp_code):
        raise HTTPException(400, "totp_secret and totp_code must be provided together")
    if body.totp_secret and not pyotp.TOTP(body.totp_secret).verify(body.totp_code, valid_window=1):
        log.warning("registration rejected: username=%s reason=invalid_totp_code", username)
        raise HTTPException(400, "Invalid verification code")
    existing = await user_repo.get_user_by_username(username)
    if existing:
        _login_record_failure(_client_ip(request), username)
        raise HTTPException(400, "Username already taken")
    user = await user_repo.create_user(username, body.password, status="pending")
    backup_codes = None
    if body.totp_secret:
        backup_codes = _generate_backup_codes()
        await user_repo.set_totp_secret(user["id"], body.totp_secret, backup_codes)
        await user_repo.set_totp_enabled(user["id"], True)
        log.info("registration bound totp: username=%s user_id=%s", username, user["id"])
    await notification_repo.notify_admins(
        "admin_signup", f"New signup: {username}",
        f"{username} registered and is awaiting approval.", "/admin")
    log.info("registration: username=%s status=pending totp_enabled=%s", username, bool(body.totp_secret))
    return {"ok": True, "pending": True, "backup_codes": backup_codes}
```

Note the reordering: the TOTP code is verified **before** the username-taken check and **before** `create_user` — a wrong code must fail without ever touching the database for that username, per the design requirement that a bad code doesn't burn/reserve it.

- [ ] **Step 4: Run and confirm pass**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/test_auth_onboarding.py -v`
Expected: PASS, all 9 tests (3 from Task 1, 2 from Task 2, 4 from this task — wait, `test_register_without_totp_still_works`, `test_register_with_valid_totp_binds_and_returns_backup_codes`, `test_register_with_invalid_totp_code_creates_no_user` = 3 tests. Total 3+2+3 = 8).

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add backend/auth.py backend/tests/test_auth_onboarding.py
git commit -m "feat(auth): bind TOTP atomically at registration, verify code before creating user"
```

---

### Task 4: Vendor a QR code encoder

**Files:**
- Create: `new_ui/js/qrcode-generator.js`

**Interfaces:**
- Produces: `window.qrcode(typeNumber, errorCorrectionLevel)` → an object with `.addData(text)`, `.make()`, `.createSvgTag(cellSize, margin)` (the standard API surface of the `kazuhikoarase/qrcode-generator` library). Consumed by `new_ui/js/onboard.js` (Task 7).

- [ ] **Step 1: Vendor the library**

This is a well-known, widely-used, permissively-licensed ("no copyright restriction") single-file QR encoder — the same one this pattern is modeled on (`rebuild.sh` already vendors the Tailwind CLI binary via a pinned `curl` download rather than reimplementing a CSS engine; QR encoding's Reed-Solomon math has the same "don't hand-roll it, vendor a known-correct implementation" property).

Run:

```bash
cd /var/home/staygold/ai-frontend
curl -sLo new_ui/js/qrcode-generator.js "https://raw.githubusercontent.com/kazuhikoarase/qrcode-generator/master/js/qrcode.js"
head -5 new_ui/js/qrcode-generator.js
wc -l new_ui/js/qrcode-generator.js
```

Expected: the file's header comment block identifies it as the qrcode-generator library, and it's on the order of several hundred to ~1000 lines. If the `curl` fails (network-restricted environment) or the URL has moved, stop this step and flag it — do not hand-write a replacement QR encoder from scratch; find the current canonical source for this library instead.

- [ ] **Step 2: Verify it loads and encodes without a browser**

Run:

```bash
cd /var/home/staygold/ai-frontend/new_ui/js
node -e "
global.window = global;
require('./qrcode-generator.js');
const qr = qrcode(0, 'M');
qr.addData('otpauth://totp/StoryHaven%20AI:kael?secret=JBSWY3DPEHPK3PXP&issuer=StoryHaven%20AI');
qr.make();
console.log('module count:', qr.getModuleCount());
console.log(qr.createSvgTag(4, 0).slice(0, 80));
"
```

Expected: prints a module count (a positive integer, typically 21+ for this input length) and the start of an `<svg` tag — confirms the vendored file actually encodes without throwing, which is the real acceptance bar for a vendored dependency (a full QR-decode round-trip test would require a second vendored decoder, out of scope — visual scan verification happens in Task 7's manual browser check instead).

- [ ] **Step 3: Add the vendored license header note and commit**

The downloaded file already carries its own copyright/license header (this library is commonly distributed under an MIT-equivalent "no restriction, but keep this header" notice) — leave that header exactly as downloaded, do not strip it (this is vendored third-party code, not code this plan's zero-comments rule applies to).

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/qrcode-generator.js
git commit -m "chore(new_ui): vendor qrcode-generator for TOTP onboarding QR codes"
```

---

### Task 5: Shared non-scrolling auth scene layout + spine-stitch step indicator

**Files:**
- Create: `new_ui/js/auth-scene.js`
- Test: `tests/new_ui/auth-scene.test.js`

**Interfaces:**
- Produces: `heroScene(innerHtml)` (full 200px animated emblem — used by `/login`, `/register`, `/forgot`, `/wait`), `compactScene(innerHtml)` (a small centered top-of-screen logo lockup, no animation — used by `/onboard` only, the sole screen without the big emblem per this design), `spineStitchHtml(currentStep, totalSteps)` — all pure string-returning functions, no DOM dependency, importable in Node for the step-indicator test. Consumed by Tasks 6, 7, 8.
- The small logo lockup in `compactScene` is a fresh, self-contained implementation for `new_ui` — loosely modeled on the small `.brand .logo` row on the current `static/index.html` maintenance page (40px logo + name, centered, no animation) as a *concept* only, not a literal shared dependency: `static/` is itself being redesigned separately and this file must not assume its current markup/classes stay stable.

- [ ] **Step 1: Write the failing test for the pure logic piece**

`spineStitchHtml`'s segment-fill logic is the one piece of real branching logic in this file worth a unit test (the two scene wrappers are pure template assembly with no branching to verify beyond "does it contain the input" — not worth a test per this repo's "trivial passthrough" carve-out).

Write to `tests/new_ui/auth-scene.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spineStitchHtml } from "../../new_ui/js/auth-scene.js";

test("spineStitchHtml marks steps up to and including the current one as filled", () => {
  const html = spineStitchHtml(1, 2);
  const filledCount = (html.match(/data-stitch-filled/g) || []).length;
  assert.equal(filledCount, 1);
});

test("spineStitchHtml marks all steps filled on the final step", () => {
  const html = spineStitchHtml(2, 2);
  const filledCount = (html.match(/data-stitch-filled/g) || []).length;
  assert.equal(filledCount, 2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd /var/home/staygold/ai-frontend/tests/new_ui && node --test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `auth-scene.js`**

```js
"use strict";

function spineStitchHtml(currentStep, totalSteps) {
  const labels = ["Volume", "Seal"];
  const segments = [];
  for (let step = 1; step <= totalSteps; step++) {
    const filled = step <= currentStep;
    segments.push(`
      <div class="flex-1 flex flex-col items-center gap-1.5">
        <div ${filled ? "data-stitch-filled" : ""} class="w-full h-[3px] rounded-full ${filled ? "bg-primary" : "bg-line-2"}"></div>
        <span class="font-mono text-[9px] tracking-[.14em] uppercase ${filled ? "text-primary" : "text-muted"}">${labels[step - 1] || step}</span>
      </div>
    `);
  }
  return `<div class="flex gap-2 mb-5">${segments.join("")}</div>`;
}

function heroScene(innerHtml) {
  return `
    <div class="fixed inset-0 overflow-hidden flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, #1a1509 0%, #0b0a0c 46%, #08080a 78%)">
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">${loginEmbers()}</div>
      <div class="relative z-[1] flex-none">${loginEmblem()}</div>
      <div class="relative z-[2] flex-1 min-h-0 flex items-center px-6 pb-6">
        <div class="login-in w-full max-w-[320px] mx-auto">${innerHtml}</div>
      </div>
    </div>
  `;
}

function compactLogoRow() {
  return `
    <div class="flex items-center justify-center gap-2.5">
      <div class="w-10 h-10 flex-none text-primary">
        <svg viewBox="0 0 500 500" width="100%" height="100%"><g>${SH_LOGO_PATHS}</g></svg>
      </div>
      <div class="flex flex-col leading-tight text-left">
        <span class="font-display text-[15px] font-semibold text-ink tracking-wide">StoryHaven AI</span>
        <span class="text-[10px] italic text-muted">Forge worlds. Remember everything.</span>
      </div>
    </div>
  `;
}

function compactScene(innerHtml) {
  return `
    <div class="fixed inset-0 overflow-hidden flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, #1a1509 0%, #0b0a0c 46%, #08080a 78%)">
      <div class="relative z-[1] flex-none pt-8 px-6">${compactLogoRow()}</div>
      <div class="relative z-[2] flex-1 min-h-0 flex items-center px-6 py-4">
        <div class="login-in w-full max-w-[320px] mx-auto">${innerHtml}</div>
      </div>
    </div>
  `;
}

if (typeof window !== "undefined") {
  window.heroScene = heroScene;
  window.compactScene = compactScene;
  window.spineStitchHtml = spineStitchHtml;
}

export { heroScene, compactScene, spineStitchHtml };
```

`heroScene` calls `loginEmbers()`/`loginEmblem()`, and `compactScene`'s `compactLogoRow()` reuses `SH_LOGO_PATHS` — all existing bare top-level consts/functions in `login.js` (confirmed in Pre-flight findings) — so this file must load **after** `login.js` in `index.html` (wired in Task 9). Both scenes use `fixed inset-0 overflow-hidden` (no `overflow-y-auto`) per the no-scroll constraint — content that doesn't fit needs the calling screen to reduce its own content, not scroll, which is why `compactScene` (used only by `/onboard`, the screen with the most content: QR + secret + 6-digit boxes) drops the animated emblem/embers entirely rather than trying to fit both.

- [ ] **Step 4: Run and confirm pass**

Run: `cd /var/home/staygold/ai-frontend/tests/new_ui && node --test`
Expected: PASS.

- [ ] **Step 5: Manual verification**

This step has no automated coverage for the two scene functions themselves (pure template assembly, per Step 1's reasoning) — visually verified when Task 6 actually renders through them.

- [ ] **Step 6: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/auth-scene.js tests/new_ui/auth-scene.test.js
git commit -m "feat(new_ui): add non-scrolling auth scene layout and spine-stitch step indicator"
```

---

### Task 6: `/register` screen

**Files:**
- Create: `new_ui/js/register.js`

**Interfaces:**
- Consumes: `heroScene`, `spineStitchHtml` (Task 5), `authField` (existing, `login.js`), `navigate` (`router.js`).
- Produces: `RegisterView.mount(main)`; `window.OnboardFlow = { username: null, password: null, backupCodes: null }` — the shared in-memory state object, defined in this file since `/register` is the first screen to populate it, read by Tasks 7 and 8.

- [ ] **Step 1: Confirm `authField`'s exact signature before reuse**

Run: `grep -n "^function authField" -A 12 /var/home/staygold/ai-frontend/new_ui/js/login.js`

Confirms it takes `(label, key, opts)` and renders an input keyed by `data-field="${key}"`, matching the usage below.

- [ ] **Step 2: Write `register.js`**

```js
"use strict";

const OnboardFlow = { username: null, password: null, backupCodes: null };

const RegisterView = {
  error: "",
  mount(main) {
    this.main = main;
    this.error = "";
    this.render();
  },
  render() {
    const body = `
      <h2 class="font-display font-semibold text-[21px] text-ink mb-1">Bind a new volume</h2>
      <p class="text-[13px] leading-relaxed text-sec mb-4 font-display italic">Every account here is a volume bound into the archive.</p>
      ${spineStitchHtml(1, 2)}
      ${this.error ? `<div class="mb-4 rounded-lg border border-warn text-warn text-[13px] px-3 py-2.5" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${this.error}</div>` : ""}
      ${authField("Username", "username", { ph: "kael" })}
      ${authField("Password", "password", { type: "password", ph: "At least 8 characters" })}
      ${authField("Confirm password", "password2", { type: "password", ph: "Type it again" })}
      <button type="button" data-register-submit class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark mt-1">
        Bind this volume →
      </button>
      <div class="text-center mt-4">
        <button type="button" data-register-signin class="text-primary text-[13px] font-medium">Already have an account? Sign in</button>
      </div>
    `;
    this.main.innerHTML = heroScene(body);
    this.wire();
  },
  wire() {
    this.main.querySelector("[data-register-submit]").addEventListener("click", () => this.submit());
    this.main.querySelector("[data-register-signin]").addEventListener("click", () => navigate("/login"));
  },
  fieldValue(key) {
    return this.main.querySelector(`[data-field="${key}"]`)?.value?.trim() || "";
  },
  submit() {
    const username = this.fieldValue("username");
    const password = this.fieldValue("password");
    const password2 = this.fieldValue("password2");
    if (username.length < 2) { this.error = "Username must be at least 2 characters."; this.render(); return; }
    if (password.length < 8) { this.error = "Password must be at least 8 characters."; this.render(); return; }
    if (password !== password2) { this.error = "Passwords don't match."; this.render(); return; }
    OnboardFlow.username = username;
    OnboardFlow.password = password;
    OnboardFlow.backupCodes = null;
    navigate("/onboard");
  },
};

if (typeof window !== "undefined") {
  window.OnboardFlow = OnboardFlow;
  window.RegisterView = RegisterView;
}
```

- [ ] **Step 3: Manual verification**

Deferred to Task 9's step (after routing is wired) — this file alone can't be reached via a URL yet.

- [ ] **Step 4: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/register.js
git commit -m "feat(new_ui): add /register screen with client-side-only credential collection"
```

---

### Task 7: `/onboard` screen

**Files:**
- Create: `new_ui/js/onboard.js`

**Interfaces:**
- Consumes: `compactScene`, `spineStitchHtml` (Task 5), `totpBoxes` (existing, `login.js`), `api` (`app-session.js`), `qrcode` (Task 4), `OnboardFlow` (Task 6), `navigate` (`router.js`).
- Produces: `OnboardView.mount(main)`.

- [ ] **Step 1: Confirm `totpBoxes`'s exact signature before reuse**

Run: `grep -n "^function totpBoxes" -A 14 /var/home/staygold/ai-frontend/new_ui/js/login.js`

Confirms it takes `(err)` and renders 6 inputs with `data-totp="${i}"`, matching `login.js`'s own `handleTotpInput`/`handleTotpKey`/`totpValue` wiring pattern, reused verbatim below rather than reimplemented.

- [ ] **Step 2: Write `onboard.js`**

```js
"use strict";

const OnboardView = {
  loading: false,
  error: "",
  totpErr: false,
  secret: "",
  otpauthUri: "",
  showSecret: false,
  async mount(main) {
    this.main = main;
    if (!OnboardFlow.username || !OnboardFlow.password) {
      navigate("/register");
      return;
    }
    this.error = "";
    this.totpErr = false;
    this.showSecret = false;
    this.renderLoading();
    try {
      const result = await api("/api/auth/totp/provision", {
        method: "POST",
        body: JSON.stringify({ username: OnboardFlow.username }),
      });
      this.secret = result.secret;
      this.otpauthUri = result.otpauth_uri;
      this.render();
    } catch (err) {
      this.error = err.message || "Could not start verification setup.";
      this.render();
    }
  },
  renderLoading() {
    this.main.innerHTML = compactScene(`
      <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">The archive verifies your hand</h2>
      ${spineStitchHtml(2, 2)}
      <div class="text-center text-muted text-sm py-10">Sealing the volume…</div>
    `);
  },
  qrSvg() {
    const qr = qrcode(0, "M");
    qr.addData(this.otpauthUri);
    qr.make();
    return qr.createSvgTag(4, 0);
  },
  render() {
    const body = `
      <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">The archive verifies your hand</h2>
      ${spineStitchHtml(2, 2)}
      ${this.error ? `<div class="mb-4 rounded-lg border border-warn text-warn text-[13px] px-3 py-2.5" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${this.error}</div>` : ""}
      <div class="flex items-center gap-3 mb-3">
        <div class="w-[84px] h-[84px] flex-none rounded-lg bg-white p-1.5">${this.otpauthUri ? this.qrSvg() : ""}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] leading-relaxed text-sec mb-1.5">Scan with an authenticator app, or</p>
          <button type="button" data-toggle-secret class="text-primary font-mono text-[11px]">${this.showSecret ? "Hide" : "Reveal"} the key</button>
          ${this.showSecret ? `<div class="mt-1.5 font-mono text-[11px] text-ink break-all">${this.secret}</div>` : ""}
        </div>
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">6-digit code from your app</div>
      ${totpBoxes(this.totpErr)}
      <button type="button" data-onboard-submit ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60 mt-3">
        ${this.loading ? "Sealing…" : "Seal this volume"}
      </button>
    `;
    this.main.innerHTML = compactScene(body);
    this.wire();
  },
  wire() {
    this.main.querySelector("[data-toggle-secret]").addEventListener("click", () => {
      this.showSecret = !this.showSecret;
      this.render();
    });
    this.main.querySelectorAll("[data-totp]").forEach((input) => {
      input.addEventListener("input", () => this.handleTotpInput(input));
      input.addEventListener("keydown", (e) => this.handleTotpKey(input, e));
    });
    this.main.querySelector("[data-onboard-submit]").addEventListener("click", () => this.submit());
  },
  handleTotpInput(input) {
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    if (input.value) {
      const next = this.main.querySelector(`[data-totp="${Number(input.dataset.totp) + 1}"]`);
      if (next) next.focus();
    }
  },
  handleTotpKey(input, e) {
    if (e.key === "Backspace" && !input.value) {
      const prev = this.main.querySelector(`[data-totp="${Number(input.dataset.totp) - 1}"]`);
      if (prev) { prev.focus(); prev.value = ""; }
    }
  },
  totpValue() {
    return Array.from(this.main.querySelectorAll("[data-totp]")).map((el) => el.value || "").join("");
  },
  async submit() {
    const code = this.totpValue();
    if (code.length < 6) { this.totpErr = true; this.render(); return; }
    this.loading = true;
    this.error = "";
    this.totpErr = false;
    this.render();
    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: OnboardFlow.username,
          password: OnboardFlow.password,
          totp_secret: this.secret,
          totp_code: code,
        }),
      });
      OnboardFlow.backupCodes = result.backup_codes;
      OnboardFlow.password = null;
      navigate("/wait");
    } catch (err) {
      this.loading = false;
      this.totpErr = true;
      this.error = err.message || "Verification failed.";
      this.render();
    }
  },
};

if (typeof window !== "undefined") window.OnboardView = OnboardView;
```

`OnboardFlow.password = null` immediately after the successful `register()` call — it's no longer needed once the account exists, and per the Global Constraints this in-memory state should hold sensitive data no longer than necessary.

- [ ] **Step 3: Manual verification**

Deferred to Task 9.

- [ ] **Step 4: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/onboard.js
git commit -m "feat(new_ui): add /onboard screen with real QR provisioning and atomic registration"
```

---

### Task 8: `/wait` screen — wax-seal redesign + one-time backup codes

**Files:**
- Create: `new_ui/js/wait.js`
- Modify: `new_ui/js/login.js` — remove the existing `waitEl` function (moved here).

**Interfaces:**
- Consumes: `heroScene` (Task 5), `OnboardFlow` (Task 6), `navigate` (`router.js`).
- Produces: `waitEl(main)` — kept as the same function name `router.js` already calls, so Task 9's router change is a one-line source swap, not a rename.

- [ ] **Step 1: Confirm the existing `waitEl` before removing it**

Run: `grep -n "function waitEl" -A 12 /var/home/staygold/ai-frontend/new_ui/js/login.js`

This is the block to delete from `login.js` in Step 3.

- [ ] **Step 2: Write `wait.js`**

```js
"use strict";

function waxSealHtml() {
  return `
    <div class="relative w-16 h-16 mx-auto mb-5">
      <div class="wax-seal-idle absolute inset-0 rounded-full" style="background:radial-gradient(circle at 35% 30%, var(--color-primary-light), var(--color-primary-dark))"></div>
      <div class="absolute inset-0 grid place-items-center font-display font-semibold text-lg text-paper">S</div>
    </div>
  `;
}

function backupCodesHtml(codes) {
  const items = codes.map((code) => `<span class="font-mono text-[13px] text-ink">${code}</span>`).join("");
  return `
    <div class="mb-5">
      <div class="rounded-lg border border-warn text-warn text-[12px] leading-relaxed px-3 py-2.5 mb-3" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">
        Save these recovery codes now — they will not be shown again. Each one lets you back into your account if you lose your authenticator.
      </div>
      <div class="grid grid-cols-2 gap-2 rounded-xl border border-line-2 p-3" style="background:color-mix(in srgb, var(--color-paper) 55%, transparent)">${items}</div>
    </div>
  `;
}

function waitEl(main) {
  const codes = OnboardFlow.backupCodes;
  const body = `
    ${waxSealHtml()}
    ${codes ? backupCodesHtml(codes) : ""}
    <h2 class="font-display font-semibold text-[20px] text-ink text-center mb-2">Your volume awaits the archivist's seal</h2>
    <p class="text-[13px] leading-relaxed text-sec text-center mb-6">A server admin reviews new accounts before they can be opened. This page doesn't need to stay open — come back and sign in once you're approved.</p>
    <button type="button" data-wait-exit class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark">
      Back to sign in
    </button>
  `;
  main.innerHTML = heroScene(body);
  main.querySelector("[data-wait-exit]").addEventListener("click", () => {
    OnboardFlow.backupCodes = null;
    OnboardFlow.username = null;
    navigate("/login");
  });
}

if (typeof window !== "undefined") window.waitEl = waitEl;
```

Add the idle wax-seal animation to `new_ui/css/input.css`'s `@layer base` block (from the earlier scrollbar-hiding change), respecting `prefers-reduced-motion`:

```css
@layer base {
  html, body {
    height: 100%;
  }
  body {
    background: var(--color-paper);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }
  * {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  *::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .wax-seal-idle {
      animation: wax-seal-pulse 3.2s ease-in-out infinite;
    }
  }
  @keyframes wax-seal-pulse {
    0%, 100% { transform: scale(1); opacity: 0.9; }
    50% { transform: scale(1.06); opacity: 1; }
  }
}
```

Confirm this is the correct file to edit (the real Tailwind source, not the generated `app.css`) by checking: `grep -n "scrollbar-width" /var/home/staygold/ai-frontend/new_ui/css/input.css` — should already show the existing rule from the earlier session change; add the new block adjacent to it, inside the same `@layer base { ... }`.

- [ ] **Step 3: Remove `waitEl` from `login.js`**

Delete the `function waitEl(main) { ... }` block (confirmed in Step 1) from `new_ui/js/login.js` entirely — it now lives in `wait.js`.

- [ ] **Step 4: Rebuild CSS and verify**

Run: `cd /var/home/staygold/ai-frontend && ./rebuild.sh --once`
Expected: `Built .../new_ui/css/app.css` with no errors.

Run: `grep -o "wax-seal-pulse[^}]*" new_ui/css/app.css | head -2`
Expected: the keyframe name appears in the compiled output.

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/wait.js new_ui/js/login.js new_ui/css/input.css new_ui/css/app.css
git commit -m "feat(new_ui): redesign /wait as wax-seal screen, show one-time backup codes"
```

---

### Task 9: Wire routing, script load order, and remove the old in-place register tab

**Files:**
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/index.html`
- Modify: `new_ui/js/login.js` — remove the `register` tab from `AuthView`.

**Interfaces:**
- Consumes: `RegisterView` (Task 6), `OnboardView` (Task 7), `waitEl` (Task 8).
- Produces: working `/register`, `/onboard`, `/wait` routes; `AuthView` reduced to `signin`/`forgot` only.

- [ ] **Step 1: Update `router.js`**

In `new_ui/js/router.js`, find the `routes` object (currently `login`, `wait`, and the not-yet-built placeholders) and change:

```js
  login: (main) => AUTH.mount(main),
  wait: (main) => waitEl(main),
```

to:

```js
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
```

Update `CHROMELESS_ROUTES`:

```js
const CHROMELESS_ROUTES = new Set(["login", "register", "onboard", "wait"]);
```

- [ ] **Step 2: Update `index.html` script order**

In `new_ui/index.html`, find the existing script block:

```html
  <script src="/js/state-store.js" defer></script>
  <script src="/js/theme.js" defer></script>
  <script src="/js/app-session.js" defer></script>
  <script src="/js/login.js" defer></script>
  <script src="/js/router.js" defer></script>
  <script src="/js/boot.js" defer></script>
```

Replace with:

```html
  <script src="/js/state-store.js" defer></script>
  <script src="/js/theme.js" defer></script>
  <script src="/js/app-session.js" defer></script>
  <script src="/js/login.js" defer></script>
  <script src="/js/auth-scene.js" defer></script>
  <script src="/js/qrcode-generator.js" defer></script>
  <script src="/js/register.js" defer></script>
  <script src="/js/onboard.js" defer></script>
  <script src="/js/wait.js" defer></script>
  <script src="/js/router.js" defer></script>
  <script src="/js/boot.js" defer></script>
```

Order rationale: `login.js` first among these (defines `loginEmbers`/`loginEmblem`/`SH_LOGO_PATHS`/`authField`/`totpBoxes` that `auth-scene.js`/`register.js`/`onboard.js` all consume), `auth-scene.js` before `register.js`/`onboard.js`/`wait.js` (they call `heroScene`/`compactScene`), `qrcode-generator.js` before `onboard.js` (calls `qrcode(...)`), `register.js` before `onboard.js`/`wait.js` (defines the shared `OnboardFlow` object they both read), and all of them before `router.js` (which references every one of these globals inside its `routes` map).

- [ ] **Step 3: Remove the register tab from `AuthView`**

In `new_ui/js/login.js`:

Remove the `renderRegister()` method entirely (confirm its exact current bounds with `grep -n "renderRegister" new_ui/js/login.js` before deleting).

Remove `submitRegister()` entirely.

In `render()`, change:

```js
  render() {
    let body;
    if (this.view === "signin") body = this.renderSignin();
    else if (this.view === "register") body = this.renderRegister();
    else body = this.renderForgot();
    this.main.innerHTML = loginScene(body);
    this.wire();
  }
```

to:

```js
  render() {
    const body = this.view === "signin" ? this.renderSignin() : this.renderForgot();
    this.main.innerHTML = heroScene(body);
    this.wire();
  }
```

(`loginScene` is replaced by the new `heroScene` from Task 5 — `AuthView`'s sign-in and forgot-password views both keep the full animated emblem treatment, alongside `/register` and `/wait`; only `/onboard` uses the compact logo, per the design brief's "sign in = the book's cover" carried through registration and recovery, with the TOTP-setup step as the sole quieter exception.)

In `authTabs()`, since there is no longer a `register` tab to switch to in place, change its only caller. Find where `authTabs("signin")` is used inside `renderSignin()` and the "Create account" tab button — replace the whole tab-switcher with a direct link, since there's only one tab left (`signin`) with `forgot` reached via the existing "Can't sign in?" link, not a tab. In `renderSignin()`, remove the `${authTabs("signin")}` call and add a new line before the existing "Can't sign in?" row:

```js
  renderSignin() {
    return `
      ${authError(this.error)}
      ${authField("Username", "username", { ph: "kael" })}
      ${authField("Password", "password", { type: "password", ph: "········" })}
      ${this.needsTotp ? `
        <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mt-2 mb-2.5">6-digit code from your authenticator</div>
        ${totpBoxes(this.totpErr)}
      ` : ""}
      <div class="flex justify-between -mt-1 mb-5">
        <button type="button" data-register-link class="text-primary text-[13px] font-medium">Create account</button>
        <button type="button" data-auth-link="forgot" class="text-primary text-[13px] font-medium">Can't sign in?</button>
      </div>
      <button type="button" data-auth-submit="signin" ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60">
        ${this.loading ? "Signing in…" : "Enter StoryHaven"}
      </button>
    `;
  }
```

In `wire()`, add the new link's handler alongside the existing `data-auth-link`/`data-auth-tab` wiring:

```js
    const registerLink = this.main.querySelector("[data-register-link]");
    if (registerLink) registerLink.addEventListener("click", () => navigate("/register"));
```

`renderForgot()` is unchanged — still reachable, still `AuthView`'s recovery flow for an existing account.

- [ ] **Step 4: Manual verification — full flow**

Run: `./rebuild.sh` from repo root, then in a browser at ~392×848 (devtools responsive mode, matching this session's established phone target):

1. Go to `http://localhost:3001/login` — confirm the full animated emblem still renders, "Create account" navigates to `/register`.
2. On `/register`, fill in a new username/password, confirm no network request fires until submit, confirm it navigates to `/onboard`.
3. On `/onboard`, confirm a real QR renders (scan it with an actual authenticator app if available — this is the genuine acceptance test for Task 4's vendored encoder, not just the Node smoke check), confirm "Reveal the key" shows the base32 secret, enter the code from the app, submit.
4. Confirm `/wait` shows 8 backup codes with the warning banner, the wax seal has a subtle pulse (or none, if `prefers-reduced-motion` is on in your OS/browser settings — verify both ways), and none of the four screens (`/login`, `/register`, `/onboard`, `/wait`) show a scrollbar or require scrolling to reach their primary action button at 392×848.
5. Confirm the account was actually created: check the admin panel (or query the DB directly) for the new pending user with `totp_enabled = true`.

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/router.js new_ui/index.html new_ui/js/login.js
git commit -m "feat(new_ui): wire register/onboard/wait routing, retire in-place register tab"
```

---

## Self-Review

**Spec coverage:** Every element of the finalized design — book-cover sign-in, spine-stitch register, QR-based onboard binding TOTP atomically, wax-seal wait screen with one-time backup codes, no-scroll phone-only layout, vendored QR encoder — has a task. The backend gap (register issuing no session, `get_current_user` blocking pending accounts) is resolved architecturally in Task 3 rather than worked around.

**Placeholder scan:** No "add appropriate X" phrasing. Task 4's QR vendoring is the one step that depends on an external fetch succeeding rather than code written inline — flagged explicitly with a fallback instruction (stop and find the current canonical source, don't hand-roll a Reed-Solomon encoder) rather than silently assuming success, which is the honest way to handle a real external dependency in a plan, not a placeholder.

**Type/name consistency:** `OnboardFlow` (defined in Task 6) has exactly the fields (`username`, `password`, `backupCodes`) read by Task 7 (`OnboardFlow.username`/`.password`, sets `.backupCodes`) and Task 8 (`OnboardFlow.backupCodes`, clears `.username`). `heroScene(innerHtml)`'s single-argument signature (Task 5) matches its call sites in Tasks 6 (register), 8 (wait), and the `AuthView` rewrite in Task 9 (signin/forgot); `compactScene(innerHtml)`'s single-argument signature matches its two call sites in Task 7 (onboard). `waitEl(main)`'s name and single-argument signature is preserved exactly from the pre-existing code so Task 9's router change is a no-op besides the file it comes from.

Plan complete and saved to `docs/superpowers/plans/2026-07-15-auth-onboarding-rework.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
