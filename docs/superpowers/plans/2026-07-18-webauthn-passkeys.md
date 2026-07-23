# WebAuthn passkeys - implementation plan

Spec: docs/superpowers/specs/2026-07-18-webauthn-passkeys-design.md

1. **db.py**: `webauthn_credentials` table; `users.passkey_required` ALTER; `webauthn` added to requirements.txt (venv already has py_webauthn 3.0.0).
2. **state.py**: CFG keys `webauthn_rp_id`, `webauthn_origin` (seeded empty; derived from request origin when blank).
3. **repositories/webauthn_credentials.py**: create/list_for_user/get_by_credential_id/update_sign_count/delete/count - tests in backend/tests/test_webauthn_repo.py.
4. **routers/webauthn.py**: register options/verify (authed, api router), login options/verify (auth_router, login-throttled), /me/passkeys list/delete, /me/passkey-required toggle; in-memory TTL challenge store; py_webauthn verify calls. Strict-mode pre_token = `_encode_token(..., "passkey_step", 300)`, not whitelisted.
5. **auth.py login**: after TOTP, if `passkey_required` and user has credentials -> 401 `{"code": "passkey_required", "pre_token"}` (mirrors totp_required).
6. **server.py**: include the router.
7. **Frontend**: settings-account.js Passkeys card; login.js passkey button + conditional mediation + strict second step; b64url helpers.
8. **Tests + live verification**: router tests with webauthn verify monkeypatched; manual ceremony on the live domain.
