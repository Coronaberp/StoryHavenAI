# Interactive App-Wide Tutorial Mode

## Goal

Replace the passive read-only chaptered tutorial (`new_ui/js/tutorial.js`) with a live, forced-action guided tutorial: launched from the Dossier → Tutorial button, it drives the user through the real app, spotlights exactly what to do, blocks everything else, and refuses to advance until they do the correct thing. Actions with real consequences (chat replies, image generation, creating data) are fully *simulated* — realistic enough to feel real, then smugly revealed as fake. The voice throughout is extremely obtuse, rude, and sarcastic, openly goading the user for needing a tutorial to operate a UI engineered to be idiot-proof.

## Architecture

Two units:

### `TutorialEngine` (reusable core, lesson-agnostic)

Drives an ordered list of steps over the real app. State: current lesson, current step index, the active target element, and the set of temporary listeners it installed (so it can always tear down cleanly).

- **Spotlight overlay** (`#tutorialOverlay`, appended to `<body>`, above app chrome but below toasts): a full-screen dim. The current step's target element is visually lifted out of the dim (raised z-index + a glowing pulsing outline) so exactly one thing is emphasized. A **coach card** (app-styled, `var(--color-surface)`/accent border, `font-display` heading + `font-sans` body) sits adjacent to the target with the step's sarcastic copy and a small pointer.
- **Click gating:** the overlay intercepts all pointer events. A click that lands on the spotlighted target passes through (or is handled per the step's `advanceOn`); a click anywhere else is swallowed and fires a sarcastic `errorToast`. The user physically cannot interact with anything but the correct control.
- **Advance conditions** (`step.advanceOn`): one of
  - `click` — the target is clicked.
  - `input-exact` — a target input/textarea's value exactly matches `step.expect` (normalized: trimmed). Until it matches, the "proceed" target stays gated and premature attempts toast sarcasm.
  - `route` — `location.pathname` reaches `step.route` (used when the correct action is a navigation the engine itself triggers or the user triggers via a spotlighted nav control).
  - `simulate` — a scripted fake sequence the engine runs (see Simulation), which advances the step on completion.
- **Navigation:** a step may declare `route`; if the app isn't already there, the engine calls `navigate(step.route)` and waits for the view to mount (polls for the step's `target` selector, with a timeout that surfaces a sarcastic "well this is embarrassing, the thing I wanted to show you isn't here" fallback and skips the step rather than hanging).
- **Costly/permanent triggers are never really fired.** For a real trigger (Send message, Generate image, Create character, Save persona, Post comment), the engine attaches a **capture-phase listener** on the target that calls `stopImmediatePropagation()`/`preventDefault()` so the app's real handler never runs; the engine then runs the step's simulation (or a fake-success beat) instead. No real API calls, no LLM/GPU spend, no data created.
- **Always-available exit:** a persistent "Skip. Give up. It's fine." button (and the ESC key) tears down the overlay, restores the app, and returns to the tutorial hub. Fully idempotent teardown — removes the overlay node, removes every installed listener, clears any simulation timers.
- **Progress:** on lesson completion, the engine sets `tutorialProgress[lessonKey] = true` in `store` (reusing the existing key) and returns to the hub, where completed lessons show a checkmark.

### Lessons (pure data)

Each lesson is `{ key, title, icon, intro, steps: [...] }`. Steps are data (`{ route?, target, copy, advanceOn, expect?, simulate? }`). Adding coverage is adding data, not engine code. Copy strings are the sarcastic voice.

## Simulation (the fake-but-convincing payoff)

Two kinds, both timed to feel real then revealed as fake:

- **Chat reply simulation** (chat lesson): the user is forced to type an *exact* scripted prompt (advance gated on `input-exact`). The intercepted Send:
  1. Renders the user's message into the real chat bubble UI immediately.
  2. Shows a realistic "thinking…" beat (short pause, the app's existing typing/streaming indicator if present).
  3. Streams a canned reply token-by-token into a real-looking assistant bubble, with per-chunk delays tuned to resemble genuine generation cadence (variable ~20–60ms/chunk).
  4. On completion, the coach card drops the act: *"Riveting exchange. Also entirely fake — no model was troubled, no GPU woke up. That was a recording of enthusiasm you'll never actually receive."*
  No `/api/sessions/.../chat` call is ever made.

- **Image generation simulation** (Forge lesson): the user types an *exact* scripted prompt; the intercepted Generate plays a **pre-recorded video of a generation in progress** in the real preview box (a `<video>` autoplaying a short clip of the ComfyUI-style progressive denoise), then reveals a static result image. Timing/progress read as real. On completion: *"Magnificent. It's also a video I recorded earlier. Your prompt did nothing. It's very pretty though, isn't it."*
  - **Asset dependency:** the tutorial references a video at a fixed path (e.g. `new_ui/assets/tutorial/imagegen.webm` served as a static file, or a `/media/tutorial-imagegen.webm`). If the asset is absent, the step falls back gracefully to a CSS/JS fake-progress simulation (blur-to-sharp on a placeholder + a progress bar) so the lesson never breaks — the video is an enhancement, not a hard requirement. The exact asset path and how it's placed/served is settled during implementation; the fallback guarantees the feature ships regardless.

- **Create-character / Save-persona / Post-comment:** intercepted trigger → a fake success beat (sarcastic "created!" coach line), no real POST, nothing persisted.

## Lesson set (hub contents)

The Dossier → Tutorial button routes to `/tutorial`, now a **hub** listing these independent lessons (each a forced-action tour, each with a completion check):

1. **Finding a character (yes, they're right there)** — Compendium → Pantheon → open a character card.
2. **Talking. With words.** — chat screen: type the exact scripted prompt, Send → simulated streaming reply; point out regenerate.
3. **Making your own (brace yourself)** — Sanctum → New Character: fill Name (and one more field), Create → fake success.
4. **Your masks** — Sanctum → Masks: open new-persona, Save → fake success.
5. **Making pictures** — Sanctum → Forge: type the exact scripted prompt, Generate → simulated video/progress.
6. **Your conversations, sorted for you** — Parlance: expand a character group.
7. **Comments, emoji, stickers** — open a comments modal, open the emoji picker, insert one emoji.
8. **Settings & the panic button** — Settings: the privacy-blur button, theme, mature-content toggle.

Each lesson ends with a smug completion line and returns to the hub. The hub intro sets the tone (e.g. *"You clicked Tutorial. On an interface engineered so a concussed raccoon could use it. Let's begin, champion."*).

## Voice

Extremely obtuse, rude, sarcastic, goading — always at the user's expense for needing help with an idiot-proof UI. Applied to: the hub intro, every step's instruction, wrong-click errors, simulation reveals, and lesson-completion lines. It never actually insults protected characteristics or turns genuinely hostile — it's theatrical condescension, not abuse. Sample strings live in the lesson data.

## What this spec does NOT cover

- No backend changes — the tutorial is pure `new_ui` (engine + lesson data + overlay CSS + optional video asset). It makes zero API calls; every consequential action is simulated client-side.
- No changes to the real screens' own behavior — the engine only overlays and gates them; it does not modify chat/forge/create logic (it intercepts at the trigger via capture-phase listeners and runs its own simulation).
- No forced completion — the user can bail at any point via the always-present exit.
- The old passive chapter content is removed; its per-lesson `store` progress concept is retained for the hub checkmarks. The old `confirm()` in its reset flow is replaced with `confirmDialog()` while the file is rewritten.

## Testing

No JS test harness (established convention) — verification via live Playwright against the running dev server: launch a lesson from the hub, confirm the overlay spotlights the correct target and blocks other clicks (a wrong click toasts, doesn't navigate), confirm `input-exact` gating (Send stays gated until the exact prompt is typed), confirm the chat simulation streams a reply with no `/api/*/chat` request firing (assert via network interception that zero chat/generate API calls occur during a lesson), confirm the Generate/Create interceptors prevent the real action, confirm the exit/ESC tears the overlay down cleanly and restores the app, and confirm completion writes the hub checkmark.
