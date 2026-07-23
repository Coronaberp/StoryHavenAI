# Admin panel — Global server configuration — new_ui design spec

## Context

Fifth sub-project of the Admin panel (see `docs/superpowers/specs/2026-07-15-admin-overview-users-design.md` for the six-way split; sub-projects 1-4 already shipped). Covers `legacy_ui/js/admin-config.js`'s scope: the instance-wide configuration that seeds `CFG` — chat/embed LLM endpoints, ComfyUI connection, sampling defaults, prompt injection, and host allowlists (model-request downloads, embed-link previews).

## Scope

One new route, `admin-config` (`AdminConfigView` — `new_ui/js/admin-config.js`), role-gated identically to the other admin routes, linked from `/admin`. Single `GET /api/settings` fetch on mount, single `PUT /api/settings` on save (unlike legacy's two separate save buttons — model-request hosts get their own save in legacy for historical reasons, but there's no functional reason to keep that split now that both live on the same screen; one Save button submits the whole form).

- **Language & endpoints**: default interface language (free text), chat endpoint (base URL, API key — write-only, `has_api_key` shows "keep current" placeholder, model name + "Fetch" button hitting `GET /api/models`), embed endpoint (base URL, API key, dimension, model name + "Test" button hitting `POST /api/settings/test-embed` after saving the embed fields), ComfyUI (base URL, default checkpoint name).
- **Host allowlists**: model-request hosts (a dynamic add/remove list of `{host, api_key}` rows — the API key here is per-host, for gated model-download sources; matches `CLAUDE.md`'s documented SSRF-avoidance design, this list is never fetched server-side, only used to validate a user-submitted `source_url`'s hostname), embed-link hosts (a plain textarea, one host per line, matches `st.embed_link_hosts`).
- **Memory & generation defaults**: history turns, max tokens, enable-thinking-by-default toggle.
- **Sampling defaults**: the full slider grid — temperature, top-p, top-k, min-p, top-a, typical-p, TFS, repetition penalty (+range), frequency/presence penalty, smoothing factor, DynaTemp low/high, Mirostat mode/tau/eta, DRY multiplier/base/allowed-length, XTC threshold/probability, seed, stop sequences, extra params (raw JSON textarea) — reuses the exact slider-pair pattern already built for `new_ui/js/settings-model.js`'s per-user sampling fields, just with different default/fallback values and always-required (not optional-inherits-default) since this IS the default.
- **Prompt injection**: system suffix, post-history instructions (global versions of the per-user fields already in `settings-model.js`).
- **Backend URL**: the `API`/`store.get("apiBase")` override this app itself talks to — editing this changes where the SPA sends its own requests, effective immediately on save (matches legacy's `API = sa.value...; store.set("api", API)` — but note `new_ui/`'s equivalent is `store.get("apiBase", "")` per `new_ui/js/app-session.js`, so the save handler must update that exact key, not a differently-named one).

**No backend changes.** Every field and endpoint above already exists (`GET/PUT /api/settings`, `GET /api/models`, `POST /api/settings/test-embed`) and is already tested.

## Data flow & error handling

Fetch on mount, one save button submits the whole form as a single `PUT /api/settings` (all fields sent together, including host-allowlist rows freshly read from the DOM at save time — matches legacy's `syncMrHostsFromDom()` pattern). API keys are write-only: blank on load, only sent in the PUT body if the admin actually typed something (never round-tripped). `extra_params`'s JSON textarea is parsed client-side before sending; invalid JSON shows a toast and is dropped from the payload rather than blocking the whole save (matches legacy). Success toast distinguishes a vector-reindex event (`r.reindexed`) from a plain save, since changing `embed_dim` triggers a real, slow backend operation the admin should know happened. Every user-controlled string goes through `_esc()`/`_attr()` for its context.

## Testing

No backend changes. No JS unit-test harness; Playwright verification against the running `:3001` server logging in as `claude`. Verification should NOT actually change the live chat/embed/ComfyUI endpoint URLs, sampling defaults, or the app's own backend URL in a way that would disrupt other testing on the shared instance — confirming the form renders with real current values and that a genuinely safe, reversible field (e.g. adding then removing a throwaway model-request host entry, or toggling enable-thinking and toggling it back) round-trips correctly is the extent of live mutation testing; do not leave any field changed from its original value after verification.
