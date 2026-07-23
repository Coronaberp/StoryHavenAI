# OAuth SSO login (Integrated Identity Providers)

## Context

StoryHaven AI's current auth is JWT-based (`backend/auth.py`): username+password, optional TOTP two-factor, optional WebAuthn passkey, 6h access / 3d refresh tokens with a whitelist/revoke repository layer (`jwt_access_tokens`/`jwt_refresh_tokens`). New self-registration creates a `status="pending"` account an admin must approve, unless an invite code is used (instant-active) or the visitor chooses the guest tier (`tier="guest"`: random unchangeable username via `_free_guest_username()`, no profile customization, no character/lore creation, capped trial token/image/video allowance, upgradeable to `tier="full"` by an admin — see `8b82db6`/`8753685`/`304a2b2`).

This adds a third entry path: signing in with an external identity provider (Google, Facebook, GitHub, Discord, Twitter/X, Reddit, Steam, Apple, Microsoft), admin-configured with no hardcoded credentials, added as a new "Integrated Identity Providers" category in the admin Server Configuration screen.

## Goal

Let a visitor sign in via any admin-enabled OAuth provider. A first-time sign-in creates a guest-tier account (skipping the pending queue, same as an invite code would). An already-logged-in full account can link a provider from Settings as an alternate sign-in method, the same UI pattern as the existing passkey list. **No email address from any provider is ever stored** — the only persisted identity link is `(provider, provider's own opaque user id)`.

## Non-goals

- No provider-specific special-casing beyond registry config (no "Google-only" feature) — every provider goes through the same generic flow.
- No automatic account merging by matching emails across providers or against existing accounts — a provider identity only ever maps to the one account it was created under or explicitly linked to.
- No change to the existing password/TOTP/passkey login paths — OAuth is purely additive.
- RTL/i18n wiring for new UI strings is in scope for correctness (every new string goes through `t()`) but a full translation resync is a follow-up action, not part of this plan.

## Data model

### `oauth_providers` (admin-configured, one row per provider)
| column | type | notes |
|---|---|---|
| `provider` | text, PK | registry key, e.g. `"google"` |
| `client_id` | text | plaintext (not secret) |
| `client_secret` | text, nullable | Fernet-encrypted via `_encrypt_secret`, same pattern as `modal_shared_secret` |
| `enabled` | integer (bool) | must be enabled *and* have both `client_id` and a decryptable `client_secret` to appear as a login option |
| `updated` | float | last-modified timestamp, for the admin UI's own reference |

No row = provider not configured = not offered, regardless of the registry knowing about it.

### `oauth_identities` (one row per linked provider account)
| column | type | notes |
|---|---|---|
| `id` | text, PK | `nid("oi")` |
| `provider` | text | matches `oauth_providers.provider` |
| `provider_user_id` | text | the provider's own stable subject identifier (Google's `sub`, GitHub's numeric `id`, Discord's `id` snowflake, etc.) — **never an email** |
| `user_id` | text, FK → `users.id` | the StoryHaven account this identity resolves to |
| `display_name` | text, nullable | optional, provider-supplied display name at link time, purely cosmetic, user can edit/clear later — no email, no other PII persisted |
| `created` | float | link timestamp |

`UNIQUE(provider, provider_user_id)` — a given provider identity maps to exactly one account, checked before creating a new guest account or linking.

## Provider registry

A single Python dict in a new `backend/oauth_providers.py`, e.g.:

```python
PROVIDER_REGISTRY = {
    "google": {
        "label": "Google",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid profile",
        "user_id_field": "sub",
        "display_name_field": "name",
        "pkce": True,
    },
    "github": {...},
    "discord": {...},
    "twitter": {...},   # OAuth 2.0 with PKCE (required by X's API)
    "reddit": {...},
    "facebook": {...},
    "steam": {...},     # OpenID 2.0, not OAuth2 — handled via a small adapter, see below
    "apple": {...},     # Sign in with Apple, JWT-based client secret (see below)
    "microsoft": {...},
}
```

Each entry supplies everything the generic flow needs: where to send the user, where to exchange the code, where to fetch the identity, which JSON field is the stable user id, and whether PKCE applies. `scope` deliberately never requests `email`.

**Two providers don't fit the plain OAuth2-authorization-code shape and need a small adapter, not a rewrite of the generic flow:**
- **Steam** uses OpenID 2.0, not OAuth2 — same overall shape (redirect out, redirect back with a signed assertion), but the registry entry marks `protocol: "openid2"` and the callback handler branches to a Steam-specific verification call instead of a token exchange. The stable ID is the returned SteamID64.
- **Apple** issues short-lived client secrets that are themselves JWTs signed with a private key (not a static string) — the registry entry marks `protocol: "oauth2_apple"` so the client-secret field in `oauth_providers` stores the *private key*, and the token-exchange step mints a fresh signed JWT client secret per request instead of sending the stored value directly.

Both are flagged in the admin UI with a short note about their different credential shape, but use the same enable/disable/credential-entry UI pattern as every other provider.

## Backend flow

All `oauth/*` routes below live under `auth_router` (the existing public `/api/auth/*` prefix), not the authenticated `api` router — `mode=login` must be reachable by a signed-out visitor, and `mode=link` does its own `get_current_user` check internally rather than relying on router-level auth, since the same route serves both cases.

### `GET /api/auth/oauth/{provider}/start?mode=login|link`
- 404 if `provider` isn't in the registry or has no enabled `oauth_providers` row.
- `mode=link` requires an authenticated session (`get_current_user`); `mode=login` does not.
- Generates a random `state` (32 bytes, `secrets.token_urlsafe`) and, for PKCE providers, a `code_verifier`/`code_challenge` pair. Stores `{state, provider, mode, user_id (if linking), created}` in a new short-lived `oauth_pending` table (5-minute expiry, purged by the existing session-cleanup loop).
- Redirects the browser to the provider's `authorize_url` with `client_id`, `redirect_uri` (a fixed backend URL, `/api/auth/oauth/{provider}/callback` — never client-supplied), `state`, `scope`, and PKCE params if applicable.

### `GET /api/auth/oauth/{provider}/callback?code=...&state=...`
1. Look up `state` in `oauth_pending`; 400 if missing/expired — this is the CSRF check, not the `state` value's presence alone but a real round-trip proving this callback answers a request this server actually issued.
2. Exchange `code` for a token at the provider's `token_url` (server-side only; `client_secret` never reaches the browser), using the stored `code_verifier` if PKCE applies.
3. Fetch the identity from `userinfo_url` using the access token; extract `provider_user_id` via the registry's `user_id_field`. Discard everything else except an optional display name — the response is never persisted wholesale.
4. Delete the `oauth_pending` row (one-time use).
5. **If `mode=link`**: check no *other* account already has this `(provider, provider_user_id)`; if clear, insert into `oauth_identities` against the pending row's `user_id`; redirect to Settings with a success toast.
6. **If `mode=login`**:
   - Existing `(provider, provider_user_id)` → look up its `user_id`, issue JWT access+refresh tokens exactly like password login, redirect into the app.
   - No existing identity → create a new guest-tier account (`tier="guest"`, `status="active"`, random `_free_guest_username()`, server-generated random password never exposed to the user), insert the `oauth_identities` row, issue tokens, redirect into the app — same guest experience as the existing guest-signup path, just entered differently.

### Settings — Connected accounts
`GET /api/me/oauth-identities` (provider + display name + linked date, no provider_user_id exposed) and `DELETE /api/me/oauth-identities/{id}` (unlink — blocked if it's the account's *only* sign-in method and the account has no password set, to avoid a lockout, mirroring the existing passkey-removal guard).

### Admin — Integrated Identity Providers
`GET /api/settings` already returns the global config blob; extend it with a per-provider `{client_id, has_client_secret, enabled}` (write-only secret, same convention as every other admin secret field). `PUT /api/settings` accepts a `oauth_providers: {provider: {client_id, client_secret, enabled}}` patch, encrypting `client_secret` before storage, matching the existing `SettingsIn`/`_encrypt_secret` pattern.

## Frontend

- `new_ui/js/login.js` / `register.js`: a row of provider buttons (icon + `t("oauth_continue_with")` + provider label) below the existing password form, only rendered for providers the backend reports as `enabled` (fetched once via a lightweight `GET /api/auth/oauth/providers` public endpoint returning just `[{provider, label}]` for enabled+configured providers — no secrets, no client IDs even). Clicking a button navigates the browser to `/api/auth/oauth/{provider}/start?mode=login` directly (a real navigation, not a fetch — OAuth redirects require a top-level browser navigation).
- `new_ui/js/settings-account.js`: new "Connected accounts" section styled like the existing passkey list — provider icon, label, linked date, unlink button; an "Add" row per not-yet-linked enabled provider that navigates to `.../start?mode=link`.
- `new_ui/js/admin-config.js`: new "Integrated Identity Providers" section, one row per registry provider (not just configured ones, so an admin can see what's available to configure) — client ID text input, client secret password-style input (placeholder shows "Key set" if already configured, matching the existing endpoint-key-field convention), enabled toggle, and the Steam/Apple credential-shape note where applicable.

## Error handling

- Provider returns an OAuth error (`error=access_denied` etc.) at the callback → redirect to login with a toast, not a raw error page.
- Token exchange or userinfo fetch fails (network, malformed response, provider outage) → same, logged via `log.error` per the project's logging rule (id/provider only, never tokens/secrets in the log line).
- `state` missing/expired/reused → 400, generic "that sign-in link expired, try again" toast — never leaks whether the state existed vs. was tampered with.
- Attempting to link a provider identity already linked to a *different* account → 409 with a clear "already connected to another account" message, no silent merge.

## Testing

- Unit tests for the provider registry shape (every entry has the required keys) and for `_free_guest_username()`'s existing collision-retry behavior reused correctly.
- Unit tests for the `oauth_identities` repository: create, lookup by `(provider, provider_user_id)`, unlink, unlink-blocked-when-sole-auth-method.
- Integration-style tests mocking the provider's token/userinfo endpoints (httpx mock) for both the `mode=login` (new guest account) and `mode=login` (existing identity, repeat sign-in) and `mode=link` paths, plus the CSRF-state-mismatch rejection path.
- No live test against any real provider (requires real registered OAuth apps) — that's a manual verification step once an admin actually configures a provider's real credentials.
