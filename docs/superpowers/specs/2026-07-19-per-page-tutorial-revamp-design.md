# Per-Page Interactive Tutorial Revamp

## Goal

Replace the current topic-based tutorial hub (8 lessons, each a thin 1-3 step slice of one theme, e.g. "browse" only opens a character card) with a lesson catalog split at **feature** granularity — every distinct workflow in the app, not just every page, gets its own forced-action lesson (~60 total). A page with several independent features (Forge's txt2img, img2img, upscaling, model/LoRA selection) becomes several lessons, each force-walking the user through *every* meaningful control that feature actually has. Keeps the existing rude, sarcastic, "an idiot-proof UI still needs a tutorial" voice and the existing forced-action, click-gated, zero-real-API-calls engine. Extends the engine with a few new step types the current lesson set never needed.

## What's changing vs. what isn't

**Not changing:** `TutorialEngine`'s spotlight overlay, capture-phase click gating, route navigation, exit/ESC teardown, `store`-backed per-lesson progress, the "no real API calls for consequential actions" rule, the voice.

**Changing:** the lesson catalog (`TUTORIAL_LESSONS` in `tutorial.js`) is rewritten from 8 flat topics to one lesson per distinct feature (~60 lessons), each covering that feature exhaustively. The hub UI groups lessons under their parent page/section (not a flat list of 60, and not by page-only either — see Hub restructure). The engine gains three new `advanceOn` kinds. Admin lessons are added, gated to admin/dev.

## Lesson catalog (feature-level, nested under page/section)

Draft breakdown below, verified against the real `new_ui/js/*.js` module names and internal tab/mode names (not the plan-doc filenames used loosely earlier) — final per-feature step list confirmed against each file's actual rendered controls during implementation:

**Explore (7):** hub/tab-switching (`explore.js`) · Characters browse + search/filter pills (`explore-characters.js`) · Creators (`explore-creators.js`) · Media browse + image detail modal (`explore-media.js`) · Forum categories/list (`explore-forum.js`) · Forum thread — reply, upvote, post (`explore-forum.js`) · Character detail page — view, follow/unfollow, start chat, comments (`character.js`)

**Chats (6):** Parlance list/grouping (`chats.js`) · sending & receiving a reply (`chat.js`) · regenerate · dice roll · continue · visual-novel mood tags for stage/sprite characters

**Workshop (18):**
- hub (`workshop.js`)
- Characters list — search mine (`explore-characters.js` in `scope: "mine"` mode)
- Character form: identity fields — name, description, mode (`workshop-characters-form.js`)
- Character form: avatar/media upload (`workshop-characters-form.js` + `cropper.js`)
- Character form: greetings & scenario (`workshop-characters-form.js`)
- Personas (Masks) list (`workshop-personas.js`)
- Persona create/edit (`workshop-personas.js`)
- Lore list (`workshop-lore.js`)
- Lore entry create/edit — keyword triggers, always-on (`workshop-lore.js`)
- Lore web/graph view (`workshop-lore-web.js`, class `WorkshopLoreWebView`)
- Forge `image` mode: txt2img basics — prompt, Generate (`workshop-media.js`)
- Forge `image` mode: reference image / img2img (`workshop-media.js`)
- Forge `upscale` mode (`workshop-media.js`)
- Forge model/LoRA/sampler/scheduler selection (`workshop-media.js`)
- Forge `inpaint` mode (`workshop-media.js`)
- Forge `video` mode — first/last frame (`workshop-media.js`)
- Forge `compile` mode (`workshop-media-compile.js`)
- Forge generation feed/history & batch queue (`workshop-media.js`)

**Dossier / social (5):** own profile overview (`profile.js`) · posting & editing comments (`comments.js`) · emoji/sticker reactions incl. custom emoji (`comments.js`) · follow system — follow/unfollow, followers modal (`profile.js`, `profile-editor.js`) · notifications inbox (`notifications.js`)

**Settings (6):** hub (`settings.js`) · Appearance — theme/accent (`settings-appearance.js`) · Model — endpoint config (`settings-model.js`) · Account — password/sessions (`settings-account.js`, class `AccountSettingsView`) · Account: passkeys (`webauthn.js`) · Blocks (`settings-blocks.js`)

**Admin-only (13), gated to `ME.role === "admin" || "dev"`:** Overview (`admin.js`) · Users — roles/Dev-role/suspend (`admin-users.js`) · Moderation: signups (`admin-moderation.js`) · Moderation: flagged endpoints & model requests (`admin-moderation.js`) · Moderation: content/image reports (`admin-moderation.js`) · Model Previews curation (`admin-previews.js`) · LoRA Training: Train tab (`admin-train.js`) · LoRA Training: Progress tab (`admin-train.js`) · LoRA Training: Test tab (`admin-train.js`) · LoRA Training: job queue/abort/resume (`admin-train.js`) · Emojis (`admin-emojis.js`) · Config (`admin-config.js`) · Health (`admin-health.js`)

That totals 55 — implementation may find one or two more genuinely independent sub-features once the actual controls are read (e.g. Settings hub itself may not need steps if it's pure navigation, or Moderation may split further), landing in the ~55-62 range the user asked for. This is a floor, not a cap: if a page's source reveals a feature not listed above, add its lesson rather than folding it into a neighboring one. Note: an earlier informal pass through this scope referenced a "TOTP self-service" account lesson and a "forge-compile-tab" name — the account settings module in this repo (`settings-account.js`) has no separate TOTP file distinct from `webauthn.js`/password reset, and the real Forge tab is named `compile` inside `workshop-media-compile.js`, not a standalone route — both are reflected correctly above and should not be re-added as extra lessons.

Each lesson's steps are derived from that feature's actual rendered controls (read from the live `new_ui/js/*.js` view source during implementation, not guessed) — every button, input, select, toggle, and file picker that does something gets its own gated step.

## Engine additions (`tutorial-engine.js`)

Current `advanceOn` kinds: `click`, `input-exact`, `intercept`, `simulate-chat`, `simulate-imagegen`. Three new kinds, following the existing `_watchInput`-style pattern (install a listener on the target, remove it on advance/teardown):

- **`select`** — target is a `<select>`; advances when `.value === step.expect`.
- **`toggle`** — target is a checkbox/switch; advances when `.checked === step.expect` (boolean).
- **`upload-simulate`** — target is a `type="file"` input; a capture-phase listener intercepts the native file picker, injects a canned fake filename/thumbnail into the surrounding UI (same "looks real, isn't" pattern as `simulate-imagegen`), and advances. No real file is read or uploaded.

All three follow the existing rule: no real backend mutation, ever, for a step whose real action would create/upload/persist something.

## Data-dependent pages: synthetic demo entries

Pages whose primary content is a list of the user's real data (Explore>Characters grid, Chats list, Workshop>Characters list, Workshop>Lore list) get a client-side-only synthetic demo entry injected into the list for the lesson's duration — same pattern the existing chat lesson already uses with its `__tutorial__` session id. This guarantees a spotlightable target exists even on a brand-new, empty account, and the injected entry is removed on lesson teardown (same idempotent cleanup path as the overlay itself). No real character/session/lore row is created server-side.

## Hub restructure (`tutorial.js`)

The flat button list becomes grouped sections mirroring the app's own nav IA: **Explore**, **Chats**, **Workshop**, **Dossier**, **Settings**, and (only rendered for admin/dev) **Admin**. Each section is a labeled group of lesson rows, same row styling as today. Progress tracking (`store.get("tutorialProgress")`, per-lesson checkmark, reset-progress button) is unchanged, just now covering ~19-27 keys instead of 8.

## Voice

Unchanged from the existing spec: extremely obtuse, rude, sarcastic, always aimed at the user needing help with a UI "engineered to be idiot-proof" — never targeting protected characteristics, theatrical condescension only. Every new lesson's copy strings follow the same voice as the 8 existing ones.

## What this does not cover

- No backend changes.
- No changes to real page behavior — steps intercept at the trigger, same as today.
- Admin lesson content is written but the spec doesn't re-litigate admin IA; each admin lesson maps to that admin sub-page's existing controls.

## Testing

Same convention as the existing tutorial: no JS test harness, verification via live Playwright against the running app — for a representative sample across user and admin lessons: confirm the overlay spotlights the correct target and blocks other clicks, confirm each new `advanceOn` kind (`select`, `toggle`, `upload-simulate`) gates and advances correctly, confirm data-dependent lessons render their synthetic demo entry on an account with no real data and remove it on exit, confirm zero real API calls fire during any simulated/consequential step (network interception), confirm admin lessons are absent from the hub for a non-admin account, confirm exit/ESC tears down cleanly including any injected demo entries.
