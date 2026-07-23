# Self-Service TOTP Management (Settings + Admin Lockout Recovery)

## Goal

Expose the existing-but-unreachable TOTP backend endpoints (`POST /totp/setup`, `POST /totp/enable`, `POST /totp/disable`, `PUT /totp/login-enforcement`) through `new_ui`'s Settings, and add one new admin endpoint to close a real lockout gap this app has today: because StoryHaven AI collects no email address, TOTP is the *only* self-service identity-proof mechanism it has — losing it with no recovery path is a genuine account-loss risk, not just an inconvenience.

## Account model

TOTP is mandatory for every account, permanently, set up once at registration (`new_ui/js/onboard.js`, unchanged — no skip option exists today and none is added). It is never fully removable by the user; there is no "no TOTP" state to fall back into. What *is* optional and user-controlled is whether TOTP is also required at login:

- **SFA** (`totp_login_required = false`, the default): login is username + password.
- **MFA** (`totp_login_required = true`): login is username + password + TOTP code.

Self-service password reset (`POST /password-reset/totp`, unchanged) is **always** TOTP-mandatory in both SFA and MFA states — it's the account's only recovery mechanism regardless of the login-requirement toggle, and this endpoint already enforces that with no bypass.

## Backend: one new endpoint

`POST /admin/users/{uid}/totp/clear` (admin-only, `Depends(get_admin)`, matching every other `/admin/users/{uid}/...` action's auth pattern in `backend/routers/admin.py`) — the lockout escape hatch for a user who has lost both their authenticator device and their backup codes. Clears `totp_secret`, `totp_backup_codes`, sets `totp_enabled = false`, `totp_login_required = false` (reusing `user_repo.set_totp_secret(uid, None)` and `user_repo.set_totp_enabled(uid, False)`, both of which already exist in `backend/repositories/users.py`). Since TOTP is mandatory for every account, a cleared account is in a temporarily-inconsistent state (`totp_enabled = false`) until the user runs the Add flow again — this is intentional and matches how a fresh, not-yet-onboarded account looks; the existing `/totp/setup` + `/totp/enable` pair (unchanged) is what brings them back to a working, TOTP-mandatory account. No new schema, no new repository functions beyond what already exists.

## Settings UI (`new_ui/js/settings-account.js`)

Placed below the existing password-change control, in the same screen (it's account/security, matching the existing content there).

- Status line reflecting `ME.totp_login_required`: "Two-factor authentication — Required at sign-in" (MFA) or "Not required at sign-in" (SFA).
- **"Require at sign-in" toggle**: switching it either direction opens a confirmation modal requiring the current password + a valid 6-digit TOTP code (reusing the `totpBoxes()` 6-digit input component already defined in `new_ui/js/login.js`), then calls `PUT /totp/login-enforcement` with the new `required` value. The backend endpoint already requires this confirmation on every call regardless of direction — the UI does not add or relax that.
- **"Reset" button**: opens a confirmation modal (password + current TOTP code) → `POST /totp/disable` → immediately, without further user action beyond scanning/entering, re-enters the same setup UI used at registration: `POST /totp/setup` returns a new secret/QR, the user scans it and enters a code (reusing `onboard.js`'s exact QR-rendering (`qrcode()` from `new_ui/js/qrcode-generator.js`) and reveal-secret pattern), `POST /totp/enable` confirms it, and the returned backup codes are shown via the same "save these now" display already built in `new_ui/js/wait.js`. If "Require at sign-in" was on before the reset, it is off afterward (the backend already drops `totp_login_required` on disable) — the user must re-enable it separately if they still want it; Reset does not silently re-apply it.
- No "disable TOTP entirely" action is exposed to end users — since TOTP is mandatory, offering a user-facing way to end up with no TOTP at all would let someone strand their own account with no recovery path. `POST /totp/disable` is only ever called internally as the first half of the Reset flow, never as a standalone user-facing action.

## Admin UI (`new_ui/js/admin-users.js`)

One new per-user action, alongside the existing suspend/unsuspend/role actions in the admin Users panel: "Clear TOTP (locked out)". Confirmation dialog states plainly that the account will need to reconfigure TOTP the next time its owner signs in, and that this is only for a user who cannot complete the self-service reset themselves (lost both device and backup codes) — not a routine action. Calls the new `POST /admin/users/{uid}/totp/clear` endpoint.

## What this spec does NOT cover

- No changes to the registration/onboarding TOTP flow (`new_ui/js/onboard.js`, `new_ui/js/register.js`, `new_ui/js/wait.js`) beyond reusing their existing UI pieces — they are not modified, only referenced/duplicated in the new Settings flow.
- No changes to `/login`'s own TOTP-code-entry behavior when `totp_login_required` is true — that already exists and works; this spec only adds the toggle that controls it.
- No changes to backup-code consumption logic (`consume_totp_backup_code` in `backend/repositories/users.py`) — unchanged.
- No email-based recovery of any kind — explicitly out of scope; the whole point of this spec is designing around its absence.
- No new nav chrome or responsive-tier-specific layout — all new UI is `openModal()`-based, which already handles all four tiers (mobile/tablet/desktop/ultrawide) correctly as an existing shared component.

## Testing

- Backend: pytest coverage for the new `POST /admin/users/{uid}/totp/clear` endpoint — non-admin gets 403, admin call clears all four fields correctly, matching this repo's existing router-test pattern (direct async function calls with a constructed `current_user` dict, `db_conn` fixture).
- Frontend: no JS test harness in this codebase (established convention) — verification is via balance-checks + live Playwright checks against the running dev server, covering: Add flow end-to-end (setup → enable → backup codes shown), Reset flow end-to-end (disable → re-setup → re-enable → new backup codes), login-requirement toggle both directions, and the admin clear action.
