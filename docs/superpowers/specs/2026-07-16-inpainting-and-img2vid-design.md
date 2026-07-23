# Inpainting + Video Generation (img2vid) — Backend Design

## Summary

Two new backend generation features on top of the existing standalone-image-gen infrastructure (`backend/imagegen.py`, `backend/imagegen_workflows.py`, `backend/imagegen_options.py`, `backend/repositories/standalone_images.py`, `backend/routers/imagegen.py`):

1. **Inpainting** — repaint a masked region of an existing standalone image using any already-supported SDXL/Illustrious checkpoint.
2. **Video generation (img2vid)** — generate a short video from an existing standalone image (image-to-video) or from a text prompt alone (text-to-video), targeting the Wan2.1 model family in ComfyUI (chosen for RTX 5060 Ti 16GB VRAM fit and because it supports both img2vid and t2v in one architecture, unlike SVD which is img2vid-only).

Frontend (mask editor UI, video preview/player) is explicitly out of scope — this spec covers backend endpoints, workflow builders, persistence, and logging only.

## Schema changes (`backend/db.py`)

Extend the existing `standalone_images` table (no new table — both features reuse the existing gallery/community-feed/sharing/report code paths):

- `media_type` (Text, `server_default='image'`) — `'image'` | `'video'`
- `source_image_id` (Text, nullable) — the originating `standalone_images.id` for an inpaint result or an image-conditioned video; `NULL` for txt2img and text-only video generation
- `fps` (Integer, `server_default=0`) — video-only, `0` for images
- `frame_count` (Integer, `server_default=0`) — video-only, `0` for images
- `duration_s` (Float, `server_default=0`) — video-only, `0` for images

## Inpainting

**Endpoint**: `POST /api/imagegen/inpaint`

Request body:
```
{ image_id: str, mask: "data:image/png;base64,...", positive: str, negative: str, denoise: float }
```

Flow:
1. Load the source `standalone_images` row by `image_id`; 404 if missing, 403 if not owned by the caller (same ownership check pattern as `standalone_images.delete`).
2. Validate and decode the `mask` data URL — reuses the existing `_decode_reference_image` size/format validation in `backend/routers/imagegen.py`, extended to accept the mask field under the same `MAX_UPLOAD_BYTES` bound.
3. New pure builder in `backend/imagegen_workflows.py`: `_build_inpaint_workflow(positive, negative, checkpoint, image_name, mask_name, denoise, ...)` — graph: `CheckpointLoaderSimple` → `VAEEncodeForInpaint` (image + mask) → `KSampler` (denoise from request) → `VAEDecode` → `SaveImage`. Follows the existing `_build_workflow`/`_splice_reference_image` conventions: pure, no I/O, dict-shaped node graph.
4. New function in `backend/imagegen.py`: `generate_inpaint_image(...)` — uploads image + mask to ComfyUI, submits the workflow, streams progress via the existing SSE/websocket plumbing (`generate_image_stream`'s pattern).
5. On success: `standalone_images.create(..., media_type="image", source_image_id=image_id, is_img2img=True)` — a new row; the source row is never modified. Goes through the normal `classify_image_background` NSFW flow (unchanged for stills).
6. Any checkpoint already listed via `imagegen_options.list_checkpoints` may be used — no new checkpoint category, per the RTX-hardware-agnostic decision that ordinary checkpoints support inpainting via `VAEEncodeForInpaint`.
7. Rate limiting: shares the existing `_IMAGEGEN_INFLIGHT` one-job-per-user constraint.

## Video generation (img2vid, Wan2.1)

**Endpoint**: `POST /api/imagegen/video` (SSE, `text/event-stream`)

Request body:
```
{ image_id: str | null, positive: str, negative: str, fps: int, num_frames: int }
```

Flow:
1. If `image_id` is present: load and ownership-check that `standalone_images` row, feed it into Wan2.1's image-conditioning path. If absent: text-only conditioning (t2v path).
2. New pure builder in `backend/imagegen_workflows.py`: `_build_wan_video_workflow(positive, negative, image_name: str | None, fps, num_frames, ...)` — branches internally on whether `image_name` is present (same dual-mode pattern `_build_workflow` already uses for custom vs. default graphs). Graph: Wan UNet/CLIP/VAE loaders → optional image conditioning → `KSampler` → `VAEDecode` → video-combine/save node. The exact save/combine node type (e.g. `SaveVideo` vs `VHS_VideoCombine`) is confirmed against the real ComfyUI `/object_info` listing at implementation time, not assumed here.
3. New function in `backend/imagegen.py`: `generate_video_stream(...)` — same shape as `generate_image_stream`: submits the workflow, streams `status`/`progress` SSE events via ComfyUI's websocket (including sampling step / total steps, since video generation runs much longer than a still and the connection must never go silent per the project's no-silent-phases logging rule), `done` carries the saved video's URL, `error` on failure.
4. On success: `standalone_images.create(..., media_type="video", source_image_id=image_id or None, is_explicit=True, classified=True, fps=fps, frame_count=num_frames, duration_s=num_frames/fps)`. Videos are always pre-flagged NSFW immediately at creation — no frame extraction, no `classify_image_background` task runs for video at all, but the row can still be made public right away (same `set_public` path as images), always behind the explicit-content gate.
5. New listing functions in `backend/imagegen_options.py` for Wan2.1 UNet/CLIP/VAE files, following the existing `list_anima_unets`/`list_clip_models`/`list_vaes` pattern rather than inventing a new one.
6. Rate limiting: shares the existing `_IMAGEGEN_INFLIGHT` one-job-per-user constraint.

## Testing

- `imagegen_workflows.py`: unit tests for `_build_inpaint_workflow` and `_build_wan_video_workflow` assert node-graph shape (checkpoint/mask/image node wiring, denoise value threaded through, image-conditioning branch present/absent) without touching ComfyUI — pure function tests, same style as any existing workflow-builder coverage.
- Router-level tests (`backend/tests/`):
  - Inpaint on a non-owned `image_id` → 403; on a missing `image_id` → 404.
  - Malformed/oversized mask data URL → 400.
  - Video request with an invalid `image_id` → 404.
  - SSE error path on a ComfyUI failure → `error` event emitted, no partial `standalone_images` row left behind.

## Logging

Every phase logs per the project's standing logging rule (no silent stretches, especially given video's longer runtime): submit, each phase transition (uploading, sampling, encoding/saving, done/failed), and any caught exception via `log.warning`/`log.error` with enough detail to diagnose later — no chat/character content or API keys logged, per the existing privacy rule.

## Out of scope

- Frontend mask-editor UI and video player/preview UI — assumed to exist or be built separately; this spec is backend-only.
- Dedicated inpainting-checkpoint curation/listing — reuses the existing checkpoint list.
- Admin curation/preview UI for Wan2.1 models — can follow the existing `model_previews.py` pattern in a later spec if needed.
