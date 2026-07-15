# Settings — new_ui design spec

## Context

`new_ui/` is the in-progress Tailwind rebuild of StoryHaven's frontend (mobile-first, served on :3001 via `dev_server.py`, proxying to the real backend on :3000). It has no Settings screen yet — the nav menu's "Settings" row currently just navigates to `/dossier` as a placeholder (`new_ui/js/nav-menus.js:66`).

Two reference sources exist:
- `legacy_ui/js/user-settings.js` — the current live functionality: a single tabbed modal (General/Model/Advanced) covering password change, interface language, NSFW toggle, deep appearance/theme customization (per-message-type font/color/style, light/dark preset editing with custom hex), LLM endpoint override, sampling params, stop sequences, and prompt injection fields.
- `Mobile-first app redesign/Mobile App.dc.html` (`settingsCard()`, ~line 605) — a mobile-first mockup showing Settings as a grouped list of rows (Appearance, Model & memory, Notifications, Content filter, mature content, ComfyUI backend, Default model, LoRAs, Generation credits, Personas, Output gallery, Admin panel, Account, Sign out) that link into sub-screens, rather than one dense modal.

This spec ports legacy's full functional scope into the mockup's grouped-list UX, adapted to new_ui's existing routed-page architecture and theme system, and drops mockup rows with no real backend behind them (Notifications preferences, Generation credits/billing, Creator themes toggle — none of these exist in this self-hosted app).

## Scope

Five new routes/views, one file per view (matching the existing `backend/routers/*` / new_ui `*View` class-per-screen convention):

| Route | View class / file | Covers |
|---|---|---|
| `settings` | `SettingsView` — `new_ui/js/settings.js` | Grouped list entry point |
| `settings/appearance` | `AppearanceSettingsView` — `new_ui/js/settings-appearance.js` | Theme (dark/light × preset), custom hex override, message-type font/color/style editor |
| `settings/model` | `ModelSettingsView` — `new_ui/js/settings-model.js` | LLM endpoint override, sampling params, prompt injection |
| `settings/account` | `AccountSettingsView` — `new_ui/js/settings-account.js` | Password change, interface language |
| `settings/content` | `ContentSettingsView` — `new_ui/js/settings-content.js` | NSFW toggle (with the existing 4-step confirmation), privacy blur toggle |

"Personas" and "Admin panel" rows on the entry list link to the existing `masks` route and a future `admin` route (out of scope here — just a link, admin-gated by `ME.role`). "Output gallery"/"LoRAs & checkpoints" rows are similarly out of scope — link to existing routes if present, otherwise omitted (no placeholder rows for unbuilt destinations, per the "drop fantasy rows" decision below).

**Explicitly out of scope / dropped** (mockup rows with no real backend):
- Notifications preferences (the notification *feed* itself is real — `backend/routers/notifications.py` — but there is no per-type preference backend, so no settings row for it)
- Generation credits / "Top up" (this is self-hosted, no billing)
- Creator themes toggle (not implemented anywhere in the codebase)
- ComfyUI backend connection status row (belongs to admin/server config, not a per-user setting — `CFG`-level, not `USER_CFG_KEYS`)

## Architecture

Each view follows the existing `ArtisanProfileView`/`PantheonView` pattern: a class with a `mount(main)` method, using `pageHeaderHtml()` for the standard nav/back chrome, registered in `routes` (`new_ui/js/router.js`) alongside `NAV_LABEL_ROUTES`/`TAB_FOR_ROUTE` entries so back-navigation and tab highlighting behave like every other screen.

`SettingsView.mount()` fetches `GET /api/me/settings` once and computes each row's summary sublabel from the response + local theme state (e.g. "Dark · Aurum", "Balanced" vs a custom endpoint host) — no per-row fetch.

`theme.js` is extended from a pure preset-index cycler into a small persisted state object:

```js
{ base: "dark"|"light", accentId: "aurum"|...|"custom",
  overrides: { dark: {accent, text, appBg}, light: {accent, text, appBg} } }
```

`applyTheme()` sets `data-theme`/`data-accent` as today, then layers any non-empty `overrides[base]` values as inline custom properties on `<html>` (`--color-accent`, `--color-ink`, `--color-paper`), mirroring `themes.css`'s existing token names so no other file needs to know overrides exist. Selecting `accentId: "custom"` is what the picker's "Custom" option sets when the user opens a color picker rather than picking a named swatch. Persisted via `store` under a new `themeState` key (replaces the current single `themeIndex` key — a one-time migration reads the legacy `themeIndex` if `themeState` is absent, then writes `themeState` going forward).

A new `ToggleSwitch` render helper (small function, not a class — stateless markup + onclick wiring, consistent with `dropdown.js`'s pattern) is added to `new_ui/js/settings.js` and reused by all four sub-screens: pill track (`--color-line-2` off / `--color-accent` on), matching the mockup's `toggleSwitch()` proportions.

## Screens

### `settings` — entry list

Grouped list, `sEyebrow`-style mono section labels ("Preferences", "Safety & content", "Model & memory", "Workspace", "Account" — trimmed from the mockup's full set to match actual scope above). Each row: 44px icon tile + label + sublabel + chevron (or inline toggle for the two content-safety switches, which stay on the entry list rather than needing their own screen — see Content below). Sign out button at the bottom, same red/warn treatment as mockup and legacy.

### `settings/appearance`

- Theme mode switch (Dark/Light) + accent preset grid (6 named swatches + "Custom").
- When "Custom" (or a preset with active overrides) is selected: three color fields (Accent, Text, App background) with hex input + swatch-triggered color picker, applying live via the `overrides` mechanism above. A "Reset to preset" action clears overrides for the active base only (mirrors legacy's per-base reset — never touches the other base's saved state).
- Message-type editor: five rows (Narration, Dialogue, Thoughts, Voice, Bold) each with a font-family text input (autocomplete against installed fonts, reusing legacy's font-autocomplete list if ported, otherwise plain text input for v1), a color swatch, and italic/bold/underline/strikethrough toggle buttons — same shape as legacy's `styleRow`/`styleToggles`.
- **Type specimen card** (signature element): live-updating proof card rendering one sample line per message type in its current font/color/style, with a thin left rule and a small mono tag per line (`Narration`, `Dialogue`, …) styled like an annotated manuscript margin note. Updates on every field change, matching legacy's `liveAppearance()` live-preview behavior but with new visual treatment.
- Chat background color field + global font field, same as legacy's `ap_chatbg`/`ap_font`.
- "Reset appearance" / "Reset message formatting" — two separate reset actions, matching legacy's `ap_reset` vs `ap_md_reset` split.

All of this is 100% client-side (`store`), never calls `/api/me/settings` — matches legacy exactly.

### `settings/model`

- "Use my own endpoint" toggle; when on, reveals base URL, API key (password field, `placeholder` shows "keep current" if one's already set — never round-trips the real key), chat model field + "Fetch models" button (`GET /api/models`) producing selectable pill buttons, same as legacy.
- History turns / max tokens fields.
- Enable-thinking / scene-style toggles.
- Sampling params: temperature, top-p, top-k, min-p, top-a, typical-p, repetition/frequency/presence penalty, seed — each a slider+number pair like legacy's `sf()`, laid out in a responsive grid (2 columns mobile, more on wider viewports).
- Stop sequences (multiline textarea, one per line).
- Prompt injection: system suffix, post-history textareas.
- Save → `PUT /api/me/settings` with the same body shape as legacy's `u_save` handler. Reset → `DELETE /api/me/settings`.

### `settings/account`

- Password change (current/new/confirm) → `PUT /api/auth/password`, same validation (non-empty, confirm match) and error handling as legacy.
- Interface language field (autocomplete against `worldLanguages()`) → included in the same `PUT /api/me/settings` body as the model screen's `interface_language` field. On language change, same hard-reload-after-save behavior as legacy (`location.reload()`) so all chrome re-renders in the new language.

### `settings/content`

- NSFW toggle: same 4-step confirmation flow as legacy (`confirmAction` chain) before enabling; disabling is immediate. Calls `PUT /api/me/nsfw`.
- Privacy blur toggle: client-side only (`togglePrivacyMode` equivalent), persisted via `store`.

Given how small this screen is (two toggles), it may fold directly into the `settings` entry list as inline toggles rather than a separate route — final call left to implementation if it reads better that way; either is acceptable and doesn't change the API surface.

## Data flow & error handling

- Entry list: one `GET /api/me/settings` on mount; sub-screens re-fetch on their own mount (simplicity over micro-optimization — settings screens are not hot paths).
- Every save button disables itself and shows a loading state while its request is in flight; on failure, re-enables, shows a toast with the error message, and leaves the form populated (no data loss) — matching legacy's `errorToast(e.message)` pattern, never a silent failure.
- Appearance/message-style/privacy-blur changes apply live (no separate "preview" vs "save" step) and persist to `store` immediately on each field change, matching legacy's `liveAppearance()` — there's nothing to "save" or lose on that screen.
- Password change clears its three fields on success; never pre-fills or logs the old/new password.

## Testing

- No backend changes — all consumed endpoints (`/api/me/settings`, `/api/me/nsfw`, `/api/auth/password`, `/api/models`) already exist and are already covered by existing backend tests.
- `new_ui/` has no existing JS test harness; verification is manual against the running `:3001` dev server (per CLAUDE.md's explicit guidance to use the human's already-running `./rebuild.sh --watch` instance, not a throwaway one), driven with Playwright for the golden paths:
  - Settings entry list renders correct summaries and navigates to each sub-screen.
  - Appearance: switch accent preset, set a custom hex override, verify it persists across a reload and doesn't affect the other light/dark base.
  - Model: toggle "use my own endpoint", fill fields, save, verify the `PUT /api/me/settings` request body matches expectations; verify a failed save shows a toast and preserves form state.
  - Account: password change happy path and mismatch/error path.
  - Content: NSFW enable requires all 4 confirmations; disable is immediate.
