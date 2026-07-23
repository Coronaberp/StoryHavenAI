# Frontend wiring for Inpainting + Video (Forge) — Design

## Summary

Wires real generation calls into `new_ui/js/forge.js`'s already-scaffolded "Inpaint" and "Video" modes (mask canvas, brush/eraser/undo, duration/fps sliders all exist; only the actual API calls are stubbed with "coming soon" toasts), and adds video-aware rendering (`<video>` instead of `<img>`) everywhere a standalone image can appear: Forge's preview box/Recent column/My Creations grid, and Pinacotheca's community feed grid + shared detail modal.

Backend simplification alongside this: `image_id`-based lookup is dropped entirely from the inpaint/video endpoints (the previous backend-only plan's design) in favor of raw image bytes only, since the frontend never tracks server-side ids for a reference image — matching how every other Forge mode (img2img, upscale) already works.

## Backend changes

- `ImageGenInpaintIn` (`backend/schemas.py`): `image: str` (required, raw `data:image/...`), `mask: str`, `positive`, `negative`, `checkpoint`, `denoise`, `sampler`, `scheduler`, `steps`, `cfg`. `image_id` field removed.
- `ImageGenVideoIn`: `image: str | None = None` (raw, optional — presence = image-to-video, absence = text-to-video), plus existing fields. `image_id` field removed.
- `stream_inpaint_image` (`backend/routers/imagegen.py`): decodes `body.image` via `_decode_reference_image` directly — no `standalone_image_repo.get`/ownership check, no DB lookup at all.
- `stream_video`: decodes `body.image` if present (same helper), otherwise proceeds text-only. No `standalone_image_repo.get`/ownership check.
- `save_inpaint_image`: the `source_image_id` requirement (400 if missing) is dropped — the field stays on `ImageGenSaveIn` as optional metadata, never required or ownership-validated, since Forge has no id to give it.
- Removed test coverage (now moot): the 404/403 image_id-ownership test cases in `test_imagegen_inpaint_router.py`, `test_imagegen_inpaint_save_router.py`, `test_imagegen_video_router.py` — replaced with tests for the new required/optional `image` field validation instead.

## Frontend changes — Forge (`new_ui/js/forge.js`)

### Inpaint mode
- New method `buildMaskDataUrl()`: reads the visible `forgeMaskCanvas` (translucent amber overlay used for user feedback) and produces a real black/white PNG mask on an offscreen canvas — black background, white wherever the overlay has any alpha (`getImageData`, threshold on the alpha channel, `ImageData` write to a fresh canvas, `toDataURL("image/png")`).
- `generate()` gains an inpaint branch: builds `{ image: this.referenceImage, mask: this.buildMaskDataUrl(), positive, negative, checkpoint, denoise, sampler, scheduler, steps, cfg }`, POSTs to `/api/imagegen/inpaint`, handles the same `preview`/`done`/`error` SSE shape already used for image mode (reuses the existing `sseEvents` handling, no new plumbing).
- `save()` gains an inpaint branch: POSTs to `/api/imagegen/inpaint/save` with the same body shape as the existing standalone save, omitting `source_image_id`.

### Video mode
- `FORGE_ASPECTS`-derived `[w, h]` rescaled to Wan2.1's pixel budget for video requests only: `scale = sqrt(399360 / (w*h))`, then round each dimension to the nearest multiple of 8. Image-mode requests are unaffected — this rescale only applies inside the video request-body builder.
- `num_frames = parseInt(this.duration) * this.fps`, clamped to `[8, 120]` as a sanity bound.
- `generate()` gains a video branch: builds `{ positive, negative, image: this.referenceImage || undefined, fps: this.fps, num_frames, width, height, steps, cfg }`, POSTs to `/api/imagegen/video`. SSE events are `status` (text progress, no binary preview frames — shown as status text overlay in the preview box while generating) and `done` (the persisted `standalone_images` record, since video saves server-side inline) and `error`.
- No separate save step for video — on `done`, `lastResult` is marked already-saved (`savedId` set immediately from the response), share/unshare available right away, no "Save" button shown.
- `generateBarHtml()` and `buildBody()`/the per-mode body builders lose their "coming soon" branches for inpaint/video, replaced with real Generate/Cancel wiring (reusing the existing generic `cancelGenerate()` → `/imagegen/standalone/stream/stop`, which is already mode-agnostic since it just tells ComfyUI to interrupt whatever's running).

### Video-aware rendering (media_type-conditional `<img>`/`<video>`)
Applies uniformly everywhere a standalone image/video record can be displayed:
- Forge preview box (`previewBoxHtml` or equivalent), "Recent" column (`recentColumnHtml`), "My Creations" grid (`renderMyCreationsGrid`).
- Pinacotheca community feed grid (`frameHtml`) and the shared `detailHtml`/`wireDetailModal` (used by both Community and My Creations detail views).
- Rule: `media_type === "video"` renders `<video controls muted playsinline preload="metadata">` with a `#t=0.1` src suffix for a first-frame poster in thumbnail contexts (no `controls` in grid thumbnails, just the play-icon overlay + poster frame; `controls` shown in the full detail/preview views). `_wireZoomPan` (pinch-zoom for static images) is skipped for video elements.
- `detailHtml`'s metadata placard gains Duration (`frame_count / fps` seconds) and FPS rows for videos, replacing the image-only Sampler/Scheduler/Steps/CFG rows where they don't apply (checkpoint/model row still shown if present).

## Testing

- Backend: update/replace the three router test files per the schema change (image required for inpaint, optional for video; no more ownership-check tests since there's no lookup to test).
- Frontend: no existing JS test harness in this project (`new_ui/js/*.js` has no test framework) — verified via live Playwright/browser check against the running `:3001` dev server per project convention (CLAUDE.md), not automated tests. This is called out explicitly as the verification method, not a gap.

## Out of scope

- Wan2.1 node-name/output-ordering correctness — already verified against the live ComfyUI instance in the prior backend-only plan.
- Any change to the upscale or plain image-gen modes' existing behavior.
