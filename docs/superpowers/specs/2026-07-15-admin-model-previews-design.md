# Admin panel — Model preview curation — new_ui design spec

## Context

Third sub-project of the Admin panel (see `docs/superpowers/specs/2026-07-15-admin-overview-users-design.md` for the six-way split; sub-projects 1-2 already shipped). Covers `legacy_ui/js/admin-previews.js`'s scope: curating preview images and metadata for the five installed-model kinds ComfyUI exposes — checkpoints, LoRAs, samplers, schedulers, upscalers.

## Scope

One new route, `admin-previews` (`AdminPreviewsView` — `new_ui/js/admin-previews.js`), role-gated identically to the three existing admin routes. Linked from `/admin`'s dashboard.

All five kinds share the same core operations against per-kind endpoint families (`GET /api/imagegen/{kind}-previews` for the list — checkpoints/loras use `/imagegen/checkpoint-previews`/`/imagegen/lora-previews`, samplers/schedulers/upscalers use their own `/imagegen/{kind}-previews`; `PUT /api/admin/{kind}-previews/{name}` with `FormData` to upload/replace a preview image; `DELETE /api/admin/{kind}-previews/{name}` to clear one; `PUT /api/admin/{kind}-previews/{name}/meta` to set display name/description and kind-specific extra fields):

- **Checkpoints & LoRAs** (richer metadata — matches `ModelMetaIn`'s full field set): display name, description, image upload/clear, plus checkpoint-only `model_type` (free text) + `default_steps` (int) + Anima-specific `anima_clip_name`/`anima_vae_name` overrides, and LoRA-only `model_category` (multi-select from `MODEL_CATEGORIES = ("flux_v2", "anima", "sdxl", "il", "pony")`) + `keywords` + a `published` toggle (`PUT /api/admin/lora-previews/{name}/publish`, gated to only LoRAs that are actually "gated" per the backend — self-trained ones).
- **Samplers, schedulers, upscalers** (simpler — display name, description, image upload/clear only, no extra fields).

Each kind's section is a searchable grid (search filters by name client-side, matching legacy's `_previewSearchBox`), each installed model shown as a card: current preview image (or a placeholder), name, and an edit action that opens a modal with the image upload + metadata fields relevant to that kind.

The list of *installed* model names per kind (as opposed to which ones already have curated previews) comes from ComfyUI's own option-listing endpoints — reuse whatever `new_ui`/`getImagegenOptions()`-equivalent already exists for checkpoints/LoRAs (check `new_ui/js/*.js` for an existing helper before writing a new fetch), and `GET /api/imagegen/samplers`/`GET /api/imagegen/upscalers`/scheduler equivalent for the other three, matching legacy's own data-fetching pattern in `_admWirePreviews`.

**No backend changes.** Every endpoint above already exists and is already tested.

## Data flow & error handling

On mount, fetch the installed-name lists (5 calls) and the previews-with-metadata lists (5 calls) in parallel, each `.catch()`-guarded individually. Image upload uses `FormData` + `PUT` (not JSON) — matches the existing `/api/me/avatar`-style upload pattern already used elsewhere in `new_ui/js/*.js` for consistency (check `profile-editor.js` or similar for the established `FormData` construction/upload convention rather than inventing a new one). Every mutation (`meta` PUT, image PUT, image DELETE, `publish` PUT) follows the same toast/errorToast/reload pattern as every other admin screen this session. Every user-controlled string (model names — which are filenames uploaded by users/admins, potentially containing special characters — display names, descriptions, keywords) goes through `_esc()`/`_attr()` for its context.

## Testing

No backend changes. No JS unit-test harness; Playwright verification against the running `:3001` server logging in as `claude`. Verification does not require actually uploading a real image or mutating real installed-model metadata if that risks disrupting a live ComfyUI configuration other testing depends on — confirming the screen renders each kind's grid correctly (with real installed-model names from the live ComfyUI instance, read-only) is sufficient; a metadata-only edit (display name/description, no image) against one real model is acceptable and reversible if verification needs to exercise a real round-trip, but never delete/replace an existing production preview image.
