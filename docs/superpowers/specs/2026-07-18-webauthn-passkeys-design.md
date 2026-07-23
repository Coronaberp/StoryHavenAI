# WebAuthn passkeys + biometric login - design

**Date:** 2026-07-18
**Approved:** both passwordless and user-configurable strict mode.

## Roles

- **Passwordless:** a registered passkey signs the user in directly (biometric/PIN prompt) and yields the same JWT + `persona_session` cookie as password login. Password remains as fallback.
- **Strict mode (per account, opt-in):** password login on a `passkey_required` account returns 401 `{"code": "passkey_required"}` (mirroring `totp_required`); the client then completes an ordinary passkey login. No pre_token: the passkey assertion alone is a strictly stronger credential than password+binding, so binding the two steps adds state without adding security.

## Data model

- `webauthn_credentials` table: id, user_id, credential_id (b64url, unique), public_key, sign_count, transports, aaguid, nickname, created, last_used.
- `users.passkey_required` int default 0, added via the `ALTER TABLE ... IF NOT EXISTS` migration pattern.
- Challenges: in-memory TTL store (5 min, single-use), keyed by a random id returned to the client.

## Endpoints (`backend/routers/webauthn.py`, `py_webauthn` for verification)

Authed:
- `POST /api/auth/webauthn/register/options` - residentKey=required (discoverable), userVerification=required, excludeCredentials from the user's existing credentials.
- `POST /api/auth/webauthn/register/verify` - verifies attestation, stores the credential (+ optional nickname).
- `GET /api/me/passkeys`, `DELETE /api/me/passkeys/{id}`, `PUT /api/me/passkey-required`.
  - Enabling strict mode requires at least one passkey; deleting the last passkey while strict mode is on is refused.

Public (login-throttled with the existing limiter):
- `POST /api/auth/webauthn/login/options` - discoverable flow, takes no username (no enumeration surface).
- `POST /api/auth/webauthn/login/verify` - looks up the credential by id from the assertion, verifies, updates sign_count/last_used, issues the standard session.

Sign-count regression logs a warning (cloned-authenticator signal) but does not block - passkey sync legitimately resets counters.

## Config

`webauthn_rp_id` and `webauthn_origin` in CFG (admin settings). RP ID = the public domain; ceremonies fail on any other origin (HTTPS only, no IP/localhost).

## Frontend

- Settings -> Account: Passkeys card - list (nickname, last used), add (nickname prompt), delete, strict-mode toggle. Hidden when `window.PublicKeyCredential` is absent.
- Login screen: "Sign in with passkey" button + conditional-mediation autofill; strict-mode second step after password when the server asks for it.
- Shared b64url <-> ArrayBuffer helpers.

## Dependency

`webauthn` (py_webauthn) installed into the container venv; added to the dependency install path run.sh relies on.

## Testing

- Repo tests: credential CRUD, unique credential_id, last-passkey-under-strict-mode refusal.
- Router tests: options shape, verify path with the webauthn library's verify functions monkeypatched, strict-mode flow (password -> pre_token -> assertion), throttling applied.
- Manual: register + login on the live domain with a real device.
