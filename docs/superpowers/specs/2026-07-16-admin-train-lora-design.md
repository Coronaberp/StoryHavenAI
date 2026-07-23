# Admin Train LoRA Design

## Goal

Port legacy_ui's "Train LoRA" tab (`legacy_ui/js/lora-training.js`) into `new_ui` as a new admin-only screen, functionally equivalent, restyled for new_ui's mobile-first Tailwind design system, using Chart.js for the loss chart instead of legacy's hand-rolled canvas drawing.

## Backend

No backend changes needed — `backend/routers/lora_training.py` already implements the full contract this screen needs:

- `GET /api/admin/lora-training/jobs` — list all jobs (status, progress, log, metrics, transfer_progress, billing_started, resume_from_lora, error, output_file, base_checkpoint, trigger_word, learning_rate, steps)
- `POST /api/admin/lora-training/jobs` — multipart form: `name`, `trigger_word`, `local_checkpoint`, `architecture`, `resolution`, `rank`, `alpha`, `learning_rate`, `steps`, `batch_size`, `noise_offset`, `network_dropout`, `captions` (JSON string array), `images` (files) → `{"job_id"}`
- `POST /api/admin/lora-training/jobs/{jid}/abort`
- `POST /api/admin/lora-training/jobs/{jid}/checkpoint` — request a manual mid-run checkpoint
- `DELETE /api/admin/lora-training/jobs/{jid}`
- `GET /api/admin/lora-training/jobs/{jid}/checkpoints` — manual checkpoints for a job
- `DELETE /api/admin/lora-training/checkpoints/{cid}`
- `GET /api/imagegen/checkpoints`, `GET /api/imagegen/anima-unets`, `GET /api/imagegen/checkpoint-previews` — for the base-checkpoint picker (same merge new_ui's admin-previews.js already does)
- `POST /api/imagegen/standalone/stream`, `POST /api/imagegen/upscale/stream`, `POST /api/imagegen/standalone/save` — for the Test tab, same endpoints Forge already uses

## Route & access

New route key `admin-train` in `new_ui/js/router.js`, gated the same way as every other admin route:
```js
"admin-train": (main) => {
  if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
  window.adminTrainView = new AdminTrainView();
  window.adminTrainView.mount(main);
},
```
Added to the `BACK_TARGETS` map (→ `"dossier"`, same as other admin routes) and linked as a new card from the Admin overview screen (`admin.js`).

## File

New file `new_ui/js/admin-train.js`, class `AdminTrainView`. Real per-instance state (active job id, poll interval, form field values, image files + captions, test-tab state) — a class per the OOP-for-stateful-code rule, same shape as `ForgeView`.

## Structure — 4 tabs in one scrollable screen

Tab bar at the top (`segChip`-style pills, same pattern Forge uses for its mode switcher): **Train / Progress / Test / Jobs**. Switching tabs re-renders `this.main` to show only the active tab's section; state (form values, watcher, test-tab result) persists across tab switches since it lives on `this`, not in the DOM.

Starting a job auto-switches to Progress. Picking an entry in Jobs auto-switches to Test.

### Tab 1 — Train

- **Name**, **Trigger word** — text inputs, same validation as legacy (name non-empty; trigger non-empty, no whitespace).
- **Base checkpoint** — reuses Forge's tap-to-open picker pattern (`modelThumbHtml`/`openModelPicker`-style grid with search), sourced from the merged SDXL + Anima list (same merge as the admin-previews fix). Architecture (`"anima"` vs `"sdxl"`) is derived from whether the pick is in the Anima set, not chosen separately.
- **Training parameters** (visible by default, each with a one-line plain-English description underneath, same pattern as Forge's sampler/scheduler descriptions):
  - Resolution (default 512), Batch size (default 1), Rank (default 16), Alpha (default 16), Learning rate (default 0.0001), Steps (default 1000)
- **Advanced** (collapsed accordion, same pattern as Forge's Advanced section, default closed): Noise offset (default 0), Network dropout (default 0), each with the same one-line description as legacy.
- **Training images** — tap-to-add thumbnail grid (pix.ai-style):
  - An "Add images" tile opens the file picker (multi-select, `image/png,image/jpeg,image/webp`)
  - Each added image renders as a thumbnail tile with a small caption-indicator dot if it has a caption
  - Tapping a thumbnail opens a modal: zoomed image + a caption text input (placeholder: "tags for this image (what's NOT the trigger concept)") + Remove button
  - "Import captions (.txt)" button matches uploaded `.txt` files to image filenames by stem, same as legacy
  - "Remove all" clears every image and caption
  - Image count shown below the grid
- **Cost/time estimate pill**, computed identically to legacy's `_estimateTrainingRun`: derives avg img/s from this admin's own past completed jobs of the same architecture (fallback flat guess: 0.8 img/s sdxl, 0.35 img/s anima), `+5min` fixed overhead, updates live as steps/batch/checkpoint change.
- **Start training** button:
  - Client-side validation mirrors the backend's exactly (name/trigger required, ≥5 images, resolution 256–1024 multiple of 64, batch 1–8, rank/alpha 1–128, learning rate >0 and ≤0.01) — first error shown via `errorToast`.
  - `confirm()` guard before submitting ("Start training on a rented cloud GPU? This begins incurring cost immediately…") — matches the destructive/costly-action confirm pattern already used for Abort and Delete-file elsewhere in admin screens.
  - On success, switches to Progress tab and starts the watcher.

### Tab 2 — Progress

Ported 1:1 from legacy's live panel, restyled with `--color-*` tokens:
- Idle state ("no active/recent job") vs live state
- Status label (`Status: {status}` + resumed-from note), progress bar
- Cost-so-far banner (visible while queued/provisioning/training/saving and `billing_started` is set): `elapsed_hours * $0.80/hr`
- Scrolling log panel (append-only, skips exact-repeat lines, auto-scrolls only if already at bottom — same logic as legacy's `_appendTrainLog`)
- Upload transfer table (visible during `provisioning` + upload phase) / Download transfer table (visible during `training`/`saving` + download phase) — same shared row renderer for both
- Metrics table (epoch/step/loss/LR/speed/ETA/GPU mem/status), visible while `status === "training"`
- **Loss chart — Chart.js** (not legacy's hand-rolled canvas): a `Chart` instance with `type: "line"`, one dataset (loss vs step), accent-colored line, no fill, created once per watched job and updated via `chart.data.labels`/`chart.data.datasets[0].data` + `chart.update()` on each poll tick rather than recreated from scratch — same CDN+SRI setup already vetted for `admin-health.js` (`chart.umd.min.js`, cdnjs-verified hash).
- Finalizing state (spinner + "Finalizing — saving and transferring…")
- Done tile (checkmark)
- "Request checkpoint now" button (visible only while training), same confirm-free immediate action as legacy

**`TrainingJobWatcher` class** — ported logic 1:1 from legacy: polls `GET /admin/lora-training/jobs` every 5s, finds the watched job by id, updates all the above, stops on a terminal status (`done`/`failed`), re-polls immediately on tab `visibilitychange` back to visible (background-tab `setInterval` throttling workaround), toasts on 3 consecutive poll failures. On mount, `AdminTrainView` checks for any job still `queued`/`provisioning`/`training` and auto-attaches the watcher to it (reload/tab-revisit recovery), same as legacy.

### Tab 3 — Test

- Shows which job/checkpoint is loaded (from Tab 4); if none picked yet, shows a hint pointing at the Jobs tab.
- LoRA strength slider (-8 to 8, default 1)
- Prompt is not manually editable — auto-built as `{trigger_word}, {TEST_LORA_DEFAULT_POSITIVE}` / `TEST_LORA_DEFAULT_NEGATIVE` (same fixed quality-template constants ported verbatim from legacy), swapped automatically when a different job/checkpoint is picked.
- Aspect/resolution picker, Sampler/Scheduler pickers (reusing `ForgeView`'s `simplePickerSummaryHtml`/`openSimplePicker` pattern — same picker, same descriptions/recommended badges), Steps slider, CFG slider, reference-image picker — all reused from Forge's existing controls rather than reimplemented.
- Generate/Stop, Zoom, Upscale (opens the same upscaler-picker pattern as Forge), Save, Discard — same result-actions row and `/imagegen/standalone/stream` + `/imagegen/upscale/stream` + `/imagegen/standalone/save` calls Forge already makes.
- If the loaded job's `base_checkpoint` is no longer in the current checkpoint list, Generate is disabled with an inline warning, same as legacy.

### Tab 4 — Jobs

- List of every training job: name, status, progress %, resumed-from note (if any), error (if any, red text)
- Delete button per job (no confirm — matches legacy's reasoning: deleting history can't touch a running GPU)
- Each job with an `output_file` (and each of its manual checkpoints, fetched via `GET .../{jid}/checkpoints`) renders as a tappable sub-row (`"{name} — latest ({status})"` / `"{name} — checkpoint {timestamp}"`); tapping loads that entry into Test and switches to the Test tab.

## Testing

- `backend/tests/` — no backend changes, no new backend tests needed.
- Manual live verification via Playwright against the public domain (per this session's established pattern): submit a minimal real training job is out of scope for automated verification (real GPU cost) — verify the form validation, tab switching, image-caption modal, and Jobs-tab-to-Test-tab flow live; verify Progress tab rendering against a job's already-persisted state (an existing completed/failed job) rather than starting a fresh paid run.
