# My Forge — Generate screen (`/sanctum/forge`) — new_ui design spec

## Context

`new_ui/` is the in-progress Tailwind rebuild of StoryHaven's frontend. My Forge is the largest remaining Sanctum sub-area — standalone (not chat-tied) image generation. Legacy's equivalent spans four files (`legacy_ui/js/imagegen.js`, `imagegen-feed.js`, `imagegen-detail.js`, `imagegen-picker.js`, ~2,545 lines combined) and the "Mobile-first app redesign" mockup (`Mobile App.dc.html`'s `genEl`/`galleryEl` methods, ~line 722-909) has a fully worked-out "generation studio" concept — but both assume capabilities the real backend doesn't have (video generation, inpaint mask painting, a seed lock/shuffle system) and a fictional per-generation credit cost (this app is self-hosted, no billing). This spec is grounded in what `backend/routers/imagegen.py`/`backend/imagegen_workflows.py` actually do, not the mockup's fiction.

This spec covers **only the Generate screen** — the actual generation UI at `/sanctum/forge` (replacing its current placeholder). A personal Gallery of saved outputs (`GET /api/imagegen/standalone`) is an explicitly separate, later spec — this screen's own "Recent" strip and Save action are all it needs for now.

### Real backend capabilities (confirmed by reading the code, not assumed)

- **Modes:** txt2img, img2img (via `reference_image` + `denoise` on the same endpoint) — no video, no inpaint/mask.
- **Architectures:** `sdxl` (default) and `anima`, both real, both selectable via `ImageGenStandaloneIn.architecture`. Anima reuses the same `checkpoint` field for a UNet filename from a *different* list (`GET /api/imagegen/anima-unets` vs `GET /api/imagegen/checkpoints`) — no separate CLIP/VAE fields are exposed to the client at all (`ImageGenStandaloneIn` has none; the server falls back to `ANIMA_CLIP_NAME`/`ANIMA_VAE_NAME` when unset), so Anima support is just "pick from the other checkpoint list when architecture=anima," not a second set of model pickers.
- **No seed control** — `ImageGenStandaloneIn` has no seed field. Legacy/mockup's seed lock/shuffle UI is fiction; not built here.
- **Live SSE preview, not a percentage:** `POST /imagegen/standalone/stream` returns `text/event-stream`, yielding `{"type": "preview", "image": "data:image/jpeg;base64,..."}` repeatedly during denoising, then one `{"type": "done", "image": "data:image/png;base64,..."}`, or `{"type": "error", "message": "..."}`. There is no numeric progress percentage anywhere in this stream — the evolving preview image *is* the progress indicator.
- **Cancellation:** `POST /imagegen/standalone/stream/stop` calls ComfyUI's `/interrupt` — the client aborting its own fetch doesn't stop GPU work server-side, so this is a real, separate call, not just an `AbortController`.
- **Save is always explicit:** the stream endpoint persists nothing (writes no file, no DB row) — only `POST /imagegen/standalone/save` (a separate call, with the full generation params plus the final image data URL) actually saves.
- **Upscale is its own stream:** `POST /imagegen/upscale/stream` (same SSE shape) takes an existing image (data URL) + an upscaler name (`body.upscaler` defaults server-side to the first available if omitted) and returns a re-encoded WebP `done` event.
- **Model picker data:** `GET /api/imagegen/checkpoints` (SDXL, plain name list), `GET /api/imagegen/anima-unets` (Anima, plain name list), `GET /api/imagegen/checkpoint-previews` (`{checkpoint_name: {image, display_name, description}}`, admin-curated, covers whichever names have been curated — not guaranteed to cover every checkpoint).
- **Upscaler picker data:** `GET /api/imagegen/upscalers` (plain name list), `GET /api/imagegen/upscaler-previews` (same `{name: {image, display_name, description}}` shape as checkpoint previews) — the Upscale action's own model choice, not shown until a result exists to upscale.
- **LoRA data:** `GET /api/imagegen/loras` — plain name list (already filtered server-side: unpublished self-trained LoRAs hidden from non-admins). `LoraSpec` is `{name: str, strength: float = 0.8}`.
- **Sampler data:** `GET /api/imagegen/samplers` → `{"samplers": [...], "schedulers": [...]}`.
- **Dimension/step limits (server-enforced, client should respect them so a submission never silently gets clamped to something surprising):** width/height clamped to 256-2048, rounded down to a multiple of 8 (`_clamp_dim`); steps clamped to 1-60 (`_clamp_steps`).

## Scope

### Route

`/sanctum/forge` → new `class ForgeView` (`new_ui/js/forge.js`), replacing the current `renderPlaceholder` entry in `routes["sanctum-forge"]`.

### Layout, top to bottom

1. **Header:** `pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")` (subtitle trimmed from the current placeholder's copy — "and video" removed since video isn't real).
2. **Mode + architecture row:** two independent 2-way segmented controls side by side — Mode (txt2img / img2img) and Architecture (SDXL / Anima) — using the existing `.filter-chip`-style segmented pattern already established in `pantheon.js`'s `filterDrawerHtml` (`single()`/chip helpers), not a new component.
3. **Preview box:** aspect-ratio div (ratio driven by the selected aspect chip below), states:
   - Empty (txt2img, no result yet): centered sparkle icon + "Your image will appear here" / "Describe it below, then tap Generate" — matching the empty-state copy tone already used elsewhere (Grimoire/Sanctum empty states).
   - Reference-needed (img2img, no reference uploaded yet): centered image icon + "Add a reference image" button opening a file picker (plain upload, no crop — same posture as Grimoire's image field, consistent across Sanctum).
   - Reference-present (img2img): the uploaded image with a small "Replace" button (top-right overlay, semi-transparent backdrop-blurred pill — matches the mockup's overlay-button treatment, which is a good pattern to keep since it doesn't fight the image for attention).
   - Generating: the live preview frame currently in flight is shown directly (each `type: "preview"` SSE event replaces the `<img>` `src`), with a small "Generating…" mono-uppercase label overlaid top-left — no percentage, per the backend's real capability above.
   - Result: the final `done` image, with three overlay action buttons bottom-right (Save, Upscale, Regenerate) matching the mockup's `imgAct` circular-icon-button treatment.
4. **Prompt block:** positive `<textarea>` (`.grimoire-field-textarea`, reused verbatim — establishes this as Sanctum's one shared text-field style, not a per-screen reinvention), collapsible negative prompt below it (chevron-toggle row, matching Grimoire's own field-reveal conventions where they exist, or the settings screens' `backLinkHtml`-style chevron rotation otherwise).
5. **Controls, in order:**
   - Aspect ratio: segmented chips — `1:1` (1024×1024), `2:3` (832×1216), `3:4` (896×1152), `16:9` (1216×704), `9:16` (704×1216) — real width/height pairs, each a multiple of 8, each ≈1 megapixel (standard SDXL-friendly sizing, not arbitrary). Selecting a chip sets `this.width`/`this.height` directly; there is no live custom-dimension input in this pass (YAGNI — five presets cover the real use case, matching what the mockup itself offered).
   - Denoise strength slider — only rendered when mode is img2img (0.05-1.0 step 0.05, matching legacy's own range).
   - Model picker: horizontally-scrolling row of thumbnail tiles (checkpoint-previews' `image`/`display_name` where curated, initial-on-gradient fallback otherwise — reusing the specimen-thumbnail visual language from Sanctum/Grimoire, not a new tile style), sourced from `/api/imagegen/checkpoints` or `/api/imagegen/anima-unets` depending on the architecture toggle, refetched on toggle switch.
   - LoRAs: collapsible section (mono-uppercase "LoRAs" header, matching Grimoire's field-label treatment), each available LoRA a toggle+conditional-strength-slider row (mockup's `loraSection` pattern is sound here — kept, restyled to this app's tokens).
   - Advanced (collapsible, closed by default): Steps slider (1-60), CFG slider (1-15, step 0.5), Sampler chips, Scheduler chips (both from `/api/imagegen/samplers`).
6. **Generate bar:** sticky bottom bar (`position: sticky; bottom: 0`, clearing the mobile bottom-nav the same way the scroll-to-top button does), accent-gradient full-width button — "Generate" / "Generating… Cancel" (label and click-target both switch based on `this.busy`; clicking while busy calls the stop endpoint, not a client-only abort). No credit/cost display.

### Generation flow

- Tapping Generate: builds the `ImageGenStandaloneIn`-shaped body from current state, `fetch("/api/imagegen/standalone/stream", { method: "POST", body: JSON.stringify(body) })`, reads the SSE stream via the shared `sseEvents(response, onEvent)` helper (see Architecture below), updates the preview `<img>` on every `preview` event, stores the final image + the exact body used to produce it on `done`, shows an `errorToast` on `error` without leaving the UI in a stuck "generating" state.
- Tapping Cancel while busy: `POST /imagegen/standalone/stream/stop`, then resets `this.busy = false` locally (the stream's own `finally`/error path also ends it server-side, but the client doesn't wait for that round-trip to un-stick its own UI).
- Result actions:
  - **Save:** `POST /imagegen/standalone/save` with the result image + the generation params that produced it (`is_img2img` set from the mode used). On success, `toast("Saved to your gallery.")`, and the saved record is prepended to the "Recent" strip (see below).
  - **Upscale:** opens a small inline picker of upscaler options (`GET /api/imagegen/upscalers`/`upscaler-previews`, same thumbnail-tile treatment as the model picker — first option pre-selected), then on confirm switches the preview into a second live-stream flow against `POST /imagegen/upscale/stream` using the current result image as input — same preview-swap/`done` handling, distinct from the main generate flow's state so upscaling doesn't clobber the original generation's params if the user wants to go back.
  - **Regenerate:** re-submits the exact same body that produced the current result (kept from the `done` event), a fresh generation.
- **Recent strip:** below the controls, a horizontally-scrolling row of the current session's saved outputs (client-side array, prepended on each successful Save — not a fetch from the server, since that's the future Gallery screen's job) — tapping a thumbnail just re-shows it in the preview box, matching the mockup's `recentTray` concept but scoped to "what you saved this session," not a full gallery fetch.

## Architecture

- New file `new_ui/js/forge.js` — `class ForgeView` (constructor + `mount(main)` + `render()`, following the same shape as every other Sanctum view). All the modal-free inline controls live in this one file/class (unlike Grimoire, nothing here needs a separate modal — the whole screen is the "form").
- `sseEvents(response, onEvent)` — ported verbatim from `legacy_ui/js/card-sandbox.js` (a plain async function reading `response.body`'s reader, splitting on `\n\n`, parsing each `data: ` line as JSON) into `new_ui/js/app-session.js`, next to `api()` — the natural shared home for network helpers, and the first thing in `new_ui/` that needs SSE-over-POST (`EventSource` can't do POST with a body, hence the manual reader loop).
- New CSS in `cards.css`: `.forge-*` classes for the mode/architecture segmented rows (or reuse `.filter-chip` outright where it fits exactly), preview box states, the sticky generate bar, and the horizontally-scrolling model/LoRA/recent rows — all theme-token-driven, no hardcoded colors, consistent with every prior Sanctum screen.

## Error handling

- Every fetch (`stream`, `stream/stop`, `save`, `upscale/stream`) wrapped so a failure produces `errorToast(err.message || <specific fallback>)`, never a silently stuck spinner — matches the pattern established in Grimoire/Parlance.
- An `error` SSE event resets `this.busy = false` and shows the message from the event payload directly (the backend already puts a specific, useful message there — e.g. ComfyUI unreachable, no model selected).
- If `GET /api/imagegen/checkpoints`/`anima-unets`/`loras`/`samplers`/`checkpoint-previews` fail on mount, the affected picker shows a short inline "Couldn't load models." message rather than blocking the rest of the screen — a broken model list shouldn't prevent editing the prompt.

## Testing

- No backend changes — every endpoint this spec uses already exists and is covered by whatever existing backend tests apply to it (out of scope to audit here since nothing server-side changes).
- Frontend: manual verification against `:3001` (no JS test runner in `new_ui/`, consistent with every screen so far) — covering: txt2img generate end-to-end (prompt → live preview frames visibly updating → done → Save persists a real row, confirmed via `GET /api/imagegen/standalone`), img2img with an uploaded reference image, the architecture toggle actually switching the model list fetched, LoRA toggle+strength affecting a real generation (verify via the saved record's `loras` field), Cancel actually stopping generation (confirm via server logs / no further preview frames arriving), Upscale on a saved result, and error handling when ComfyUI is unreachable (if reproducible in this environment) or when no model is selected.

## Out of scope

- The personal Gallery screen (full `GET /api/imagegen/standalone` browsing, delete, share) — separate future spec; this screen's "Recent" strip is session-local only, not a gallery.
- Video generation, inpaint/mask painting, seed control — none of these exist in the real backend; not built, and not stubbed with inert UI (unlike Grimoire's deliberately-inert "Generate" button, there's no forward-reference here worth preserving space for, since these aren't planned/flagged anywhere as coming later).
- Custom width/height input beyond the five aspect presets.
- Community sharing/reporting of a freshly generated image from this screen — that already exists on saved images via Pinacotheca/the standalone image detail modal; this screen only needs to get an image saved, not manage its community visibility inline.
