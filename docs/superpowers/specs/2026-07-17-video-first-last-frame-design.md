# First/last-frame video generation (Wan2.1 FLF2V)

## Purpose

Forge's Video mode currently supports text-to-video and single-start-frame image-to-video (Wan2.1's `WanImageToVideo`). Add support for an optional end/last frame, using ComfyUI's native `WanFirstLastFrameToVideo` node, so a user can interpolate a video between two frames instead of only animating outward from one.

## Ground truth (verified live against this deployment's ComfyUI, not assumed)

Queried `GET /object_info/WanImageToVideo` and `GET /object_info/WanFirstLastFrameToVideo` against the real `comfyui:8188` instance this app talks to:

- `WanFirstLastFrameToVideo` exists (`comfy_extras.nodes_wan`, same module as the already-wired `WanImageToVideo`).
- Required inputs identical to `WanImageToVideo`: `positive`, `negative`, `vae`, `width`, `height`, `length`, `batch_size`.
- Optional inputs: `clip_vision_start_image`, `clip_vision_end_image`, `start_image`, `end_image` — both `start_image` and `end_image` are independently optional at the node level.
- Output tuple: `(CONDITIONING positive, CONDITIONING negative, LATENT latent)` — identical order to `WanImageToVideo`'s existing, already-verified output, so the downstream `KSampler` wiring in `_build_wan_video_workflow` needs no change when switching nodes.

## Scope

- Add an optional `last_frame` image to Forge's Video mode, alongside the existing start-frame image.
- Backend: new `WanFirstLastFrameToVideo`-based workflow branch, used whenever a last frame is supplied (with or without a start frame). Existing start-only and no-image paths are unchanged (`WanImageToVideo` / `EmptyHunyuanLatentVideo` respectively).
- Frontend: a second upload slot in Video mode's reference-image section for the ending frame, sharing the existing upload/replace/remove UI pattern rather than duplicating it.
- All four combinations (neither / start only / end only / both) are valid — no new validation rejects any combination, matching the Wan node's own optionality.

Out of scope: `clip_vision_start_image`/`clip_vision_end_image` (CLIP-vision-conditioned variants) — not requested, no clear use case yet, adds a second image-encoding pipeline (CLIPVisionLoader/CLIPVisionEncode) not otherwise needed here. Any other Wan node found in the `/object_info` listing (WanVace, WanCamera, WanPhantom, etc.) — unrelated to this request.

## Backend design

### `backend/schemas.py` — `ImageGenVideoIn`

Add one field, same shape as the existing `image` field:

```python
class ImageGenVideoIn(BaseModel):
    image: str | None = None   # data:image/...;base64,... — None = text-to-video, set = image-to-video
    last_frame: str | None = None   # data:image/...;base64,... — optional end frame; set alone or
                                     # together with `image` to interpolate via WanFirstLastFrameToVideo
    positive: str = ""
    negative: str = ""
    unet_name: str | None = None
    clip_name: str | None = None
    vae_name: str | None = None
    fps: int = 16
    num_frames: int = 33
    width: int = 832
    height: int = 480
    steps: int = 20
    cfg: float = 6.0
```

### `backend/routers/imagegen.py` — `stream_video`

Currently:
```python
image_bytes = _decode_reference_image(body.image) if body.image else None
```

Add, right after:
```python
last_frame_bytes = _decode_reference_image(body.last_frame) if body.last_frame else None
```

Pass `last_frame_bytes` through to `imagegen.generate_video_stream` alongside the existing `image_bytes`, and include `last_frame=bool(last_frame_bytes)` in the existing start-of-job `log.info` call (matching the existing `image_to_video=bool(image_bytes)` field), so job logs distinguish start-only / end-only / both / neither at a glance.

### `backend/imagegen.py` — `generate_video_stream`

Currently uploads the single reference image:
```python
image_name = await upload_reference_image(root, image_bytes, filename="video_source.png") if image_bytes else None
```

Add a parallel upload for the last frame:
```python
last_frame_name = await upload_reference_image(root, last_frame_bytes, filename="video_last_frame.png") if last_frame_bytes else None
```

Pass both `image_name` and `last_frame_name` into `imagegen_workflows._build_wan_video_workflow`.

### `backend/imagegen_workflows.py` — `_build_wan_video_workflow`

Add a `last_frame_name: str | None = None` parameter. Replace the existing `if image_name:` / `else:` branch with three-way branching:

```python
def _build_wan_video_workflow(positive: str, negative: str, unet_name: str, clip_name: str,
                              vae_name: str, image_name: str | None = None,
                              last_frame_name: str | None = None,
                              fps: int = 16, num_frames: int = 33,
                              width: int = 832, height: int = 480,
                              steps: int = 20, cfg: float = 6.0) -> dict:
    seed = random.randint(0, 2**32 - 1)
    wf = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet_name, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip_name, "type": "wan"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae_name}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["2", 0]}},
    }
    if last_frame_name:
        flf_inputs = {
            "width": width, "height": height, "length": num_frames, "batch_size": 1,
            "positive": ["4", 0], "negative": ["5", 0], "vae": ["3", 0],
        }
        wf["6b"] = {"class_type": "LoadImage", "inputs": {"image": last_frame_name}}
        flf_inputs["end_image"] = ["6b", 0]
        if image_name:
            wf["6"] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
            flf_inputs["start_image"] = ["6", 0]
        wf["7"] = {"class_type": "WanFirstLastFrameToVideo", "inputs": flf_inputs}
        positive_out, negative_out, latent_out = ["7", 0], ["7", 1], ["7", 2]
    elif image_name:
        wf["6"] = {"class_type": "LoadImage", "inputs": {"image": image_name}}
        wf["7"] = {"class_type": "WanImageToVideo", "inputs": {
            "width": width, "height": height, "length": num_frames, "batch_size": 1,
            "positive": ["4", 0], "negative": ["5", 0], "vae": ["3", 0],
            "start_image": ["6", 0],
        }}
        positive_out, negative_out, latent_out = ["7", 0], ["7", 1], ["7", 2]
    else:
        wf["7"] = {"class_type": "EmptyHunyuanLatentVideo", "inputs": {
            "width": width, "height": height, "length": num_frames, "batch_size": 1}}
        positive_out, negative_out, latent_out = ["4", 0], ["5", 0], ["7", 0]
    wf["8"] = {"class_type": "KSampler", "inputs": {
        "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler",
        "scheduler": "simple", "denoise": 1.0,
        "model": ["1", 0], "positive": positive_out, "negative": negative_out,
        "latent_image": latent_out,
    }}
    wf["9"] = {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}}
    wf["10"] = {"class_type": "CreateVideo", "inputs": {"images": ["9", 0], "fps": fps}}
    wf["11"] = {"class_type": "SaveVideo", "inputs": {
        "video": ["10", 0], "filename_prefix": "storyhavenai_video",
        "format": "mp4", "codec": "h264"}}
    return wf
```

Node id `"6b"` (rather than reusing/renumbering `"6"`/`"7"`) keeps the diff minimal and avoids colliding with the existing `image_name`-only branch's node ids when both branches are read side by side.

## Frontend design (`new_ui/js/forge.js`)

### State: a second reference-image slot

Currently `this._referenceImages = { image: null, inpaint: null, video: null, upscale: null }` with a single `referenceImage` getter/setter keyed by `this.mode`. Add a parallel structure scoped the same way, but only meaningful for video:

```js
this._lastFrameImages = { video: null };
```

```js
get lastFrameImage() {
  return this._lastFrameImages[this.mode] ?? null;
}

set lastFrameImage(val) {
  this._lastFrameImages[this.mode] = val;
}
```

(Keyed by `this.mode` for symmetry with `referenceImage`, even though only `"video"` ever populates it — consistent with the existing pattern rather than a special-cased single variable.)

### Upload/replace/remove: parameterize by slot instead of duplicating

`chooseReferenceSource()`, `onReferenceFile(file)`, and `clearReference()` currently operate unconditionally on `this.referenceImage`. Add a `slot = "reference"` parameter (default preserves every existing call site's behavior untouched) that switches which property they read/write:

```js
chooseReferenceSource(slot = "reference") {
  this._pendingRefSlot = slot;
  // ...existing body, unchanged...
}

onReferenceFile(file, slot = "reference") {
  // ...existing body, but wherever it currently does `this.referenceImage = ...`,
  // branch: slot === "lastFrame" ? this.lastFrameImage = url : this.referenceImage = url
}

clearReference(slot = "reference") {
  if (slot === "lastFrame") { this.lastFrameImage = null; } else { this.referenceImage = null; }
  this.render();
}
```

Existing call sites (`onclick="_activeForgeView.chooseReferenceSource()"` etc.) keep working unchanged since the parameter defaults to `"reference"`. New last-frame UI passes `'lastFrame'` explicitly.

### UI: second upload block in Video mode

In `referenceImageSectionHtml()`'s video branch (added in the prior fix), render a second, near-identical block below the first — reusing the same filled/empty conditional structure but sourced from `this.lastFrameImage`, labeled "Ending frame · optional", with its buttons passing `'lastFrame'` to `chooseReferenceSource`/`clearReference`. No denoise slider or Upscale button on this block either (same reasoning as the start-frame block: Wan img2vid doesn't use `denoise`, and upscaling an input frame isn't part of this flow).

### `generateVideo()`

Currently:
```js
image: this.referenceImage || undefined,
```

Add:
```js
last_frame: this.lastFrameImage || undefined,
```

## Draft/autosave

`draftFields()`/`restoreDraft()` currently don't persist `_referenceImages` at all (confirmed by reading the existing field list) — reference images are session-local, not autosaved, matching existing behavior. The new last-frame slot follows the same non-persisted pattern; no autosave changes needed.

## Testing

`backend/tests/test_imagegen_video.py` already exists and covers the current start-only/text-only paths. Add cases for:
- Last-frame-only: `_build_wan_video_workflow(..., image_name=None, last_frame_name="x.png")` → asserts a `WanFirstLastFrameToVideo` node exists with `end_image` wired to the loaded frame and no `start_image` key present.
- Both frames: `_build_wan_video_workflow(..., image_name="a.png", last_frame_name="b.png")` → asserts `WanFirstLastFrameToVideo` with both `start_image` and `end_image` wired to their respective `LoadImage` nodes.
- Existing start-only and neither-image cases must still pass unchanged (regression check that the `elif image_name:` / `else:` branches are untouched).
- `stream_video`/`generate_video_stream` integration: a last-frame-bytes-only request reaches the workflow builder with `last_frame_name` set and `image_name=None`.

No frontend test framework exists in this repo (per this app's established pattern) — frontend verification is manual/browser-driven: open Video mode, confirm two independent upload slots (start, ending), upload to each independently, confirm remove/replace on one doesn't affect the other, confirm a real generation request's JSON body (via browser devtools network tab, since this account may not have `dev` role to actually run the job — Video mode is currently gated to `role === "dev"` by an unrelated in-progress fix from another concurrent session, out of scope here) includes both `image` and `last_frame` when both are set.

## Logging

`stream_video`'s existing `log.info` start-of-job line gets a `last_frame=` field alongside its existing `image_to_video=` field (per this repo's logging rule — every distinguishable job configuration should be visible in the logs without reading chat/image content). No other new logging needed; existing success/failure logging in `stream_video`'s `gen()` closure already covers this job the same as any other video job.
