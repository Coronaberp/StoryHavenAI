# Forge "Compile" tab — GIF / vertical strip compositor

## Purpose

Let a user combine several images (their own generations from Pinacotheca, or local uploads) into either an animated GIF or a single long vertical strip image, entirely client-side. Nothing is uploaded to or saved on the server — the result is downloaded directly from the browser.

## Scope

- New 5th mode in Forge's existing `segChip` mode switcher: **Compile**, alongside Image Gen / Inpaint / Video / Upscale.
- Two source paths for building an ordered image list: local file upload (multi-select) and a picker into the user's own `/api/imagegen/standalone` gallery ("My Creations").
- Shared reorder/remove list UI used by both output types.
- Two output types behind a toggle: **GIF** and **Vertical Strip**.
- Client-side only: canvas compositing for the strip, a vendored JS GIF encoder for the GIF. No new backend endpoints, no DB writes, no persistence of the compiled result.

Out of scope: saving the compiled output to the user's gallery, editing/cropping individual source images, any server-side image processing, undo/redo history for the list.

## UI flow

### 1. Mode entry

`forge.js`'s mode bar (`this.segChip(...)`, around line 171) gets a 5th chip:

```
Image Gen | Inpaint | Video | Upscale | Compile
```

`this.mode = "compile"` hides the existing generation settings panel (checkpoint/sampler/prompt/etc — same pattern already used to hide those for `upscale`/`video`) and renders the compile UI in its place. The preview box area is reused to show the compiled result once ready.

### 2. Building the image list

Two entry controls above the list strip:

- **Upload** — a drop/browse control visually consistent with `refImagePickerHtml` (`dropdown.js`), extended to accept `multiple` files. Each selected file is read via `FileReader` to a data URL and appended to the in-memory list.
- **My Creations** — button reuses `openMyCreationsModal()`'s existing grid-fetch (`api("/api/imagegen/standalone")`), but rendered in a selectable variant: each thumbnail gets a checkbox overlay (no detail-view click-through in this context), plus a footer "Add N selected" button that appends the chosen images' `image` URLs to the list, preserving click order.

Both paths append to one shared ordered array, e.g. `this.compileItems = [{ src, kind: "upload" | "creation", id }]`.

### 3. Shared list strip

Renders below the source controls: a horizontal row of thumbnails, one per `compileItems` entry, in order. Each thumbnail has:
- Up/down arrow buttons to reorder (simplest cross-device approach — no drag library dependency)
- An × button to remove

This strip persists across GIF/Strip toggle changes — it's the single source of truth for "what's in the compile."

### 4. Output-type toggle

Two `filter-chip`-styled buttons: **GIF** / **Vertical Strip**. Switches which settings panel renders beneath the list strip. Default: GIF.

### 5. GIF settings & compile

- Frame delay slider, ms, range e.g. 50–3000, default 500, shared across all frames (not per-frame).
- Loop toggle: infinite (default) vs play-once.
- Boomerang toggle: off (default) vs on — when on, the encoder is fed the frame list forward then reversed (excluding the duplicated end frames) before encoding.
- "Compile GIF" button, disabled until `compileItems.length >= 2`. On click:
  1. Normalize all frames to the same canvas size (scale to match the first/widest frame, matching the strip's uniform-width approach, letterboxed centered if aspect ratios differ) via an offscreen `<canvas>`.
  2. Feed frames + delay + loop count into the vendored encoder (`new_ui/js/vendor/gif-encoder.js`).
  3. Show a busy state (reuses `setGenPreviewBox`'s busy pattern) while encoding runs synchronously on the main thread.
  4. On completion, render the resulting GIF (as an `<img>` from a `Blob`/object URL) in the preview box with a **Download** button (`<a download>` on the blob URL — never POSTed anywhere).

### 6. Vertical Strip settings & compile

- Gap slider, px, range 0–40, default 0.
- Width mode: fixed to uniform-width (scale every image to match the widest image's width, preserving aspect ratio) — no toggle needed since this was the only mode requested.
- "Compile Strip" button, disabled until `compileItems.length >= 1`. On click:
  1. Load all images, compute target width = max natural width among them.
  2. Scale each proportionally to that width; total canvas height = sum of scaled heights + gaps.
  3. Draw each onto one offscreen `<canvas>` stacked top-to-bottom in list order.
  4. Export via `canvas.toBlob("image/png")`, show in preview box, offer Download.

### 7. Download

Both outputs use the same download affordance: an anchor with `download="compiled.gif"` / `download="compiled.png"` pointing at `URL.createObjectURL(blob)`, revoked after a short delay (same pattern as `downloadCard` in `character.js`).

## Technical approach

**GIF encoding**: vendor a small, synchronous, single-file pure-JS GIF encoder (LZW-based, no Web Worker) into `new_ui/js/vendor/gif-encoder.js`. Chosen over a worker-based encoder (e.g. gif.js) because:
- Compile lists here are small (a handful of already-generated/uploaded images), so a brief main-thread block during encoding is acceptable.
- Avoids wiring up and vendoring a second worker script/blob-worker bootstrapping, keeping the feature to one dependency-free file — consistent with this app's no-build-step, self-contained-JS style.

**Vertical strip**: plain `<canvas>` 2D compositing, no new dependency.

**State**: lives on `ForgeView` instance (`this.compileItems`, `this.compileOutputType`, `this.gifDelay`, `this.gifLoop`, `this.gifBoomerang`, `this.stripGap`) — this is real per-instance state (a list being built up interactively), so it belongs on the existing `ForgeView` class rather than as free functions, per this repo's OOP-for-stateful-code rule.

**File size**: compile UI/logic added directly to `forge.js` initially. If it pushes `forge.js` past a reasonable size or tangles with the existing generation logic, split into `new_ui/js/forge-compile.js` (mirroring how `imagegen.js`/`imagegen-picker.js`/`imagegen-detail.js`/`imagegen-feed.js` are already split by concern) — decide during implementation based on actual line count.

## Testing

No backend changes, so no new pytest coverage needed. This app's JS has no existing test framework (`legacy_ui`/`new_ui` are untested vanilla JS) — verification is manual/browser-driven per this repo's existing pattern (per CLAUDE.md's "verify against the live app directly" guidance), using the two accounts already available (`claude`/admin, `test`/user).

## Logging

Per CLAUDE.md's logging rule, this feature is 100% client-side with no server interaction beyond the existing read-only `GET /api/imagegen/standalone` (already logged/handled by existing code) — there's no new server-side mutating action to log. No `log.*` calls needed for this feature.
