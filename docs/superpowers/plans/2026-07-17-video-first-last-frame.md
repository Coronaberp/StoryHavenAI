# First/Last-Frame Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Forge's Video mode accept an optional end/last frame in addition to the existing start frame, using ComfyUI's native `WanFirstLastFrameToVideo` node, so video generation can interpolate between two frames instead of only animating outward from one.

**Architecture:** A new optional `last_frame` field flows from `ImageGenVideoIn` → `stream_video` → `generate_video_stream` → `_build_wan_video_workflow`, which gains a third branch (start+end / end-only) using `WanFirstLastFrameToVideo` instead of `WanImageToVideo`, verified against the live ComfyUI node's exact I/O contract. The frontend adds a second, independent upload slot to Forge's existing reference-image UI, reusing its upload/gallery-picker flow via a `slot` concept rather than duplicating it.

**Tech Stack:** FastAPI/Pydantic backend, ComfyUI HTTP/websocket API, vanilla JS frontend (no framework/build step).

## Global Constraints

- Zero comments in any file — code must be self-documenting. (Exception: this plan reuses one pre-existing explanatory comment block already in `_build_wan_video_workflow`'s call site area — do not add new comments.)
- Never indent more than 3 levels deep; return early instead of nesting.
- `WanFirstLastFrameToVideo`'s verified live contract (queried via `GET /object_info/WanFirstLastFrameToVideo` against this deployment's real ComfyUI): required inputs `positive`, `negative`, `vae`, `width`, `height`, `length`, `batch_size`; optional inputs `clip_vision_start_image`, `clip_vision_end_image`, `start_image`, `end_image`; output tuple `(CONDITIONING positive, CONDITIONING negative, LATENT latent)` — same order as the existing `WanImageToVideo`.
- All four frame combinations (neither / start-only / end-only / both) are valid — no validation may reject any combination.
- Start-only and neither-image paths must remain byte-for-byte behaviorally unchanged (still use `WanImageToVideo` / `EmptyHunyuanLatentVideo` respectively).
- No new backend endpoints — this extends the existing `POST /api/imagegen/video`.
- This repo is a LIVE bind-mounted app (`/var/home/staygold/ai-frontend`) — never create a git worktree; edit files directly. Python auto-reloads on save; static JS is served with no-cache headers. Verify HTTP-reachable checks against `https://storyhavenai.sillysillysupersillydomain.win` — plain `localhost:3000` is not reachable from this shell.
- Backend tests: run via `cd /var/home/staygold/ai-frontend && python3 -m pytest backend/tests/<file> -v` (or however this repo's existing test invocation works — check `backend/tests/test_imagegen_video.py`'s neighbors for the exact established command if unsure, e.g. inside the running container via `podman exec story-game ...` if a bare host-side `python3 -m pytest` doesn't have the app's dependencies installed).
- No JS test framework exists in `new_ui/` — frontend verification is manual/browser-driven or curl-based (confirming served files match committed source).
- Video mode is currently gated to `role === "dev"` users only (`new_ui/js/forge.js`, an unrelated in-progress fix from another concurrent session) — do not touch this gate, it is explicitly out of scope for this plan.

---

## Task 1: Backend — `WanFirstLastFrameToVideo` workflow branch

**Files:**
- Modify: `backend/imagegen_workflows.py:387-423` (`_build_wan_video_workflow`)
- Test: `backend/tests/test_imagegen_workflows.py` (extend the existing Wan video test block at the bottom of the file, after `test_build_wan_video_workflow_image_to_video`)

**Interfaces:**
- Produces: `_build_wan_video_workflow(positive, negative, unet_name, clip_name, vae_name, image_name=None, last_frame_name=None, fps=16, num_frames=33, width=832, height=480, steps=20, cfg=6.0) -> dict` — same return shape as today (a ComfyUI API-format workflow graph dict), with the new `last_frame_name` parameter appended after `image_name` to keep every existing positional/keyword call site (there are two, in `backend/imagegen.py` — updated in Task 2) compatible with keyword args as they already are.

- [ ] **Step 1: Write the failing tests**

Open `backend/tests/test_imagegen_workflows.py` and add, immediately after the existing `test_build_wan_video_workflow_image_to_video` function (end of file):

```python
def test_build_wan_video_workflow_last_frame_only():
    wf = _build_wan_video_workflow(
        "a dog running", "blurry", "wan_unet.safetensors", "wan_clip.safetensors",
        "wan_vae.safetensors", image_name=None, last_frame_name="ending.png", fps=16, num_frames=33)
    flf = next(n for n in wf.values() if n["class_type"] == "WanFirstLastFrameToVideo")
    assert "start_image" not in flf["inputs"]
    end_loader_id = flf["inputs"]["end_image"][0]
    assert wf[end_loader_id]["inputs"]["image"] == "ending.png"
    assert not any(n["class_type"] == "WanImageToVideo" for n in wf.values())
    ksampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
    assert ksampler["inputs"]["positive"] == [next(k for k, v in wf.items() if v["class_type"] == "WanFirstLastFrameToVideo"), 0]
    assert ksampler["inputs"]["negative"] == [next(k for k, v in wf.items() if v["class_type"] == "WanFirstLastFrameToVideo"), 1]
    assert ksampler["inputs"]["latent_image"] == [next(k for k, v in wf.items() if v["class_type"] == "WanFirstLastFrameToVideo"), 2]


def test_build_wan_video_workflow_start_and_last_frame():
    wf = _build_wan_video_workflow(
        "a dog running", "blurry", "wan_unet.safetensors", "wan_clip.safetensors",
        "wan_vae.safetensors", image_name="starting.png", last_frame_name="ending.png",
        fps=16, num_frames=33)
    flf = next(n for n in wf.values() if n["class_type"] == "WanFirstLastFrameToVideo")
    start_loader_id = flf["inputs"]["start_image"][0]
    end_loader_id = flf["inputs"]["end_image"][0]
    assert wf[start_loader_id]["inputs"]["image"] == "starting.png"
    assert wf[end_loader_id]["inputs"]["image"] == "ending.png"
    assert start_loader_id != end_loader_id
    assert not any(n["class_type"] == "WanImageToVideo" for n in wf.values())


def test_build_wan_video_workflow_start_only_unaffected_by_last_frame_param():
    wf = _build_wan_video_workflow(
        "a dog running", "blurry", "wan_unet.safetensors", "wan_clip.safetensors",
        "wan_vae.safetensors", image_name="source.png", last_frame_name=None, fps=16, num_frames=33)
    assert not any(n["class_type"] == "WanFirstLastFrameToVideo" for n in wf.values())
    image_to_video = next(n for n in wf.values() if n["class_type"] == "WanImageToVideo")
    assert image_to_video["inputs"]["start_image"][0] == next(k for k, v in wf.items() if v["class_type"] == "LoadImage")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `podman exec story-game python3 -m pytest backend/tests/test_imagegen_workflows.py -k wan_video -v`
Expected: the three new tests FAIL with `AttributeError`/`StopIteration` (no `WanFirstLastFrameToVideo` node exists yet — `last_frame_name` parameter doesn't exist), while `test_build_wan_video_workflow_text_to_video` and `test_build_wan_video_workflow_image_to_video` still PASS (unchanged).

- [ ] **Step 3: Implement the workflow branch**

In `backend/imagegen_workflows.py`, replace the full `_build_wan_video_workflow` function (currently lines 387-423) with:

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `podman exec story-game python3 -m pytest backend/tests/test_imagegen_workflows.py -v`
Expected: all tests in the file PASS, including the 3 new ones and the 2 pre-existing Wan video tests (`test_build_wan_video_workflow_text_to_video`, `test_build_wan_video_workflow_image_to_video`), confirming no regression.

- [ ] **Step 5: Commit**

```bash
git add backend/imagegen_workflows.py backend/tests/test_imagegen_workflows.py
git commit -m "Add WanFirstLastFrameToVideo branch to Wan2.1 video workflow builder"
```

---

## Task 2: Backend — wire `last_frame` through the API

**Files:**
- Modify: `backend/schemas.py:326-338` (`ImageGenVideoIn`)
- Modify: `backend/imagegen.py:467-480` (`generate_video_stream`)
- Modify: `backend/routers/imagegen.py:356-411` (`stream_video`)
- Test: `backend/tests/test_imagegen_video.py` (extend with a last-frame-only integration case)

**Interfaces:**
- Consumes: `_build_wan_video_workflow(..., last_frame_name=None)` from Task 1.
- Produces: `ImageGenVideoIn.last_frame: str | None` (request field); `generate_video_stream(..., last_frame_bytes: bytes | None = None)` (new keyword param, uploads it the same way `image_bytes` is uploaded today).

- [ ] **Step 1: Add the schema field**

In `backend/schemas.py`, in `ImageGenVideoIn` (currently lines 326-338), change:

```python
class ImageGenVideoIn(BaseModel):
    image: str | None = None   # data:image/...;base64,... — None = text-to-video, set = image-to-video
    positive: str = ""
```

to:

```python
class ImageGenVideoIn(BaseModel):
    image: str | None = None   # data:image/...;base64,... — None = text-to-video, set = image-to-video
    last_frame: str | None = None   # data:image/...;base64,... — optional end frame; set alone or
                                     # together with `image` to interpolate via WanFirstLastFrameToVideo
    positive: str = ""
```

- [ ] **Step 2: Write the failing test**

Open `backend/tests/test_imagegen_video.py` and add, after the last existing test function (`test_generate_video_stream_surfaces_comfyui_rejection_detail`):

```python
@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
@patch("backend.imagegen.upload_reference_image")
async def test_generate_video_stream_last_frame_only_uploads_and_wires_end_image(
        mock_upload, mock_ws_connect, mock_client_cls):
    mock_upload.side_effect = ["ending.png"]

    prompt_resp = MagicMock()
    prompt_resp.status_code = 200
    prompt_resp.json.return_value = {"prompt_id": "pid-vid4"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-vid4": {"status": {"status_str": "success"},
                     "outputs": {"11": {"videos": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"MP4DATA4"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-vid4", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__ = MagicMock(return_value=_fake_ws_iter([finished_msg]))
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_video_stream(
            "a dog running", "blurry", "http://comfyui:8188",
            "wan_unet.safetensors", "wan_clip.safetensors", "wan_vae.safetensors",
            image_bytes=None, last_frame_bytes=b"ENDBYTES", fps=16, num_frames=33):
        results.append((kind, data))

    assert ("done", b"MP4DATA4") in results
    mock_upload.assert_called_once()
    assert mock_upload.call_args.kwargs["filename"] == "video_last_frame.png"
    prompt_call = client_instance.post.call_args_list[0]
    submitted_workflow = prompt_call.kwargs.get("json", {}).get("prompt") if prompt_call.kwargs.get("json") else None
    if submitted_workflow is None:
        submitted_workflow = prompt_call.args[1]["prompt"] if len(prompt_call.args) > 1 else None
    assert any(node.get("class_type") == "WanFirstLastFrameToVideo" for node in submitted_workflow.values())
```

Note: the exact shape of `client_instance.post.call_args_list[0]` (whether the workflow is under `kwargs["json"]["prompt"]` or a positional arg) must match however `_submit_prompt` in `backend/imagegen.py` actually calls `client.post` — read that function before finalizing this assertion; adjust the extraction lines (not the assertion itself) to match its real call signature. The goal of this assertion is simply: confirm the submitted ComfyUI workflow contains a `WanFirstLastFrameToVideo` node when only a last frame is given.

- [ ] **Step 3: Run the test to verify it fails**

Run: `podman exec story-game python3 -m pytest backend/tests/test_imagegen_video.py -k last_frame -v`
Expected: FAILS — `generate_video_stream()` doesn't accept a `last_frame_bytes` keyword argument yet (`TypeError`).

- [ ] **Step 4: Update `generate_video_stream`**

In `backend/imagegen.py`, replace the current `generate_video_stream` signature and its first few lines (currently lines 467-480):

```python
async def generate_video_stream(positive: str, negative: str, base_url: str,
                                unet_name: str, clip_name: str, vae_name: str,
                                image_bytes: bytes | None = None, fps: int = 16,
                                num_frames: int = 33, width: int = 832, height: int = 480,
                                steps: int = 20, cfg: float = 6.0):
    """Wan2.1 video generation over ComfyUI's websocket/HTTP API: image_bytes
    present switches this to image-to-video, absent means text-to-video.
    Yields ("status", str) phase/progress markers, then ("done", mp4_bytes)."""
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    image_name = await upload_reference_image(root, image_bytes, filename="video_source.png") if image_bytes else None
    workflow = _build_wan_video_workflow(positive, negative, unet_name, clip_name, vae_name,
                                         image_name=image_name, fps=fps, num_frames=num_frames,
                                         width=width, height=height, steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex
    log.info("comfyui: video submit client_id=%s image_to_video=%s frames=%s fps=%s",
             client_id, bool(image_name), num_frames, fps)
    yield ("status", "submitted")
```

with:

```python
async def generate_video_stream(positive: str, negative: str, base_url: str,
                                unet_name: str, clip_name: str, vae_name: str,
                                image_bytes: bytes | None = None, last_frame_bytes: bytes | None = None,
                                fps: int = 16, num_frames: int = 33, width: int = 832, height: int = 480,
                                steps: int = 20, cfg: float = 6.0):
    """Wan2.1 video generation over ComfyUI's websocket/HTTP API: image_bytes
    present switches this to image-to-video, absent means text-to-video.
    last_frame_bytes present switches to WanFirstLastFrameToVideo (with or
    without image_bytes as the start frame). Yields ("status", str)
    phase/progress markers, then ("done", mp4_bytes)."""
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    image_name = await upload_reference_image(root, image_bytes, filename="video_source.png") if image_bytes else None
    last_frame_name = await upload_reference_image(root, last_frame_bytes, filename="video_last_frame.png") if last_frame_bytes else None
    workflow = _build_wan_video_workflow(positive, negative, unet_name, clip_name, vae_name,
                                         image_name=image_name, last_frame_name=last_frame_name,
                                         fps=fps, num_frames=num_frames,
                                         width=width, height=height, steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex
    log.info("comfyui: video submit client_id=%s image_to_video=%s last_frame=%s frames=%s fps=%s",
             client_id, bool(image_name), bool(last_frame_name), num_frames, fps)
    yield ("status", "submitted")
```

- [ ] **Step 5: Wire the router**

In `backend/routers/imagegen.py`, in `stream_video` (currently lines 356-411):

Replace:
```python
    image_bytes = _decode_reference_image(body.image) if body.image else None
```
with:
```python
    image_bytes = _decode_reference_image(body.image) if body.image else None
    last_frame_bytes = _decode_reference_image(body.last_frame) if body.last_frame else None
```

Replace:
```python
    log.info("imagegen: video start user=%s image_to_video=%s frames=%s fps=%s",
             current_user["username"], bool(image_bytes), body.num_frames, body.fps)
```
with:
```python
    log.info("imagegen: video start user=%s image_to_video=%s last_frame=%s frames=%s fps=%s",
             current_user["username"], bool(image_bytes), bool(last_frame_bytes), body.num_frames, body.fps)
```

Replace:
```python
            async for kind, data in imagegen.generate_video_stream(
                    body.positive, body.negative, CFG["comfyui_url"],
                    unet_name, clip_name, vae_name, image_bytes=image_bytes,
                    fps=body.fps, num_frames=body.num_frames,
                    width=body.width, height=body.height, steps=body.steps, cfg=body.cfg):
```
with:
```python
            async for kind, data in imagegen.generate_video_stream(
                    body.positive, body.negative, CFG["comfyui_url"],
                    unet_name, clip_name, vae_name, image_bytes=image_bytes,
                    last_frame_bytes=last_frame_bytes,
                    fps=body.fps, num_frames=body.num_frames,
                    width=body.width, height=body.height, steps=body.steps, cfg=body.cfg):
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `podman exec story-game python3 -m pytest backend/tests/test_imagegen_video.py -v`
Expected: all tests PASS, including the new last-frame test and every pre-existing test in the file (regression check).

- [ ] **Step 7: Commit**

```bash
git add backend/schemas.py backend/imagegen.py backend/routers/imagegen.py backend/tests/test_imagegen_video.py
git commit -m "Wire optional last_frame through /api/imagegen/video request/response path"
```

---

## Task 3: Frontend — second upload slot for the ending frame in Forge's Video mode

**Files:**
- Modify: `new_ui/js/forge.js` (state, `chooseReferenceSource`/`onReferenceFile`/`clearReference`/`setReferenceFromUrl`, `referenceImageSectionHtml`, `generateVideo`)

**Interfaces:**
- Produces: `get lastFrameImage()`/`set lastFrameImage(val)` on `ForgeView` (mirrors the existing `referenceImage` getter/setter, scoped by `this.mode`); `chooseReferenceSource(slot = "reference")`, `clearReference(slot = "reference")` (new optional `slot` params, `"lastFrame"` is the only other value used); `generateVideo()`'s request body gains `last_frame`.

- [ ] **Step 1: Add the last-frame state slot**

In `new_ui/js/forge.js`, in the `ForgeView` constructor, find:

```js
    this._referenceImages = { image: null, inpaint: null, video: null, upscale: null };
```

and add immediately after it:

```js
    this._lastFrameImages = { video: null };
```

Then find the existing `referenceImage` getter/setter:

```js
  get referenceImage() {
    return this._referenceImages[this.mode] ?? null;
  }

  set referenceImage(val) {
    this._referenceImages[this.mode] = val;
  }
```

and add immediately after it:

```js
  get lastFrameImage() {
    return this._lastFrameImages[this.mode] ?? null;
  }

  set lastFrameImage(val) {
    this._lastFrameImages[this.mode] = val;
  }
```

- [ ] **Step 2: Thread a `slot` through the reference-picking flow**

In `new_ui/js/forge.js`, find `onReferenceFile`:

```js
  onReferenceFile(file) {
    if (this.mode === "upscale") {
      maybeCropUpload(file, "1/1", 1024, 1024, (dataUrl) => {
        this.referenceImage = dataUrl;
        this.render();
      });
      return;
    }
    if (this.mode === "inpaint") {
      loadImageNative(file, 1024, (dataUrl, width, height) => {
        this.inpaintDims = [width, height];
        this.referenceImage = dataUrl;
        this.render();
      });
      return;
    }
    const [w, h] = FORGE_ASPECTS[this.aspect] || [1024, 1024];
    maybeCropUpload(file, `${w}/${h}`, w, h, (dataUrl) => {
      this.referenceImage = dataUrl;
      this.render();
    });
  }
```

Replace with:

```js
  onReferenceFile(file) {
    const slot = this._pendingRefSlot || "reference";
    const assign = (dataUrl) => {
      if (slot === "lastFrame") this.lastFrameImage = dataUrl;
      else this.referenceImage = dataUrl;
    };
    if (this.mode === "upscale") {
      maybeCropUpload(file, "1/1", 1024, 1024, (dataUrl) => {
        assign(dataUrl);
        this.render();
      });
      return;
    }
    if (this.mode === "inpaint") {
      loadImageNative(file, 1024, (dataUrl, width, height) => {
        this.inpaintDims = [width, height];
        assign(dataUrl);
        this.render();
      });
      return;
    }
    const [w, h] = FORGE_ASPECTS[this.aspect] || [1024, 1024];
    maybeCropUpload(file, `${w}/${h}`, w, h, (dataUrl) => {
      assign(dataUrl);
      this.render();
    });
  }
```

Find `clearReference`:

```js
  clearReference() {
    this.referenceImage = null;
    this.inpaintDims = null;
    this.render();
  }
```

Replace with:

```js
  clearReference(slot = "reference") {
    if (slot === "lastFrame") this.lastFrameImage = null;
    else { this.referenceImage = null; this.inpaintDims = null; }
    this.render();
  }
```

Find `chooseReferenceSource() {` (the function definition, not any call site) and its first line inside the function body — currently:

```js
  chooseReferenceSource() {
    const layer = openModal(`
```

Replace with:

```js
  chooseReferenceSource(slot = "reference") {
    this._pendingRefSlot = slot;
    const layer = openModal(`
```

Find `setReferenceFromUrl`:

```js
  async setReferenceFromUrl(url, layer) {
    try {
      const blob = await (await fetch(url)).blob();
      if (layer) closeModal(layer);
      closeTopModal();
      if (this.mode === "upscale") {
        maybeCropUpload(blob, "1/1", 1024, 1024, (dataUrl) => {
          this.referenceImage = dataUrl;
          this.render();
        });
        return;
      }
      if (this.mode === "inpaint") {
        loadImageNative(blob, 1024, (dataUrl, width, height) => {
          this.inpaintDims = [width, height];
          this.referenceImage = dataUrl;
          this.render();
        });
        return;
      }
      const [w, h] = FORGE_ASPECTS[this.aspect] || [1024, 1024];
      maybeCropUpload(blob, `${w}/${h}`, w, h, (dataUrl) => {
        this.referenceImage = dataUrl;
        this.render();
      });
    } catch (err) {
      errorToast(err.message || "Couldn't load that image.");
    }
  }
```

Replace with:

```js
  async setReferenceFromUrl(url, layer) {
    const slot = this._pendingRefSlot || "reference";
    const assign = (dataUrl) => {
      if (slot === "lastFrame") this.lastFrameImage = dataUrl;
      else this.referenceImage = dataUrl;
    };
    try {
      const blob = await (await fetch(url)).blob();
      if (layer) closeModal(layer);
      closeTopModal();
      if (this.mode === "upscale") {
        maybeCropUpload(blob, "1/1", 1024, 1024, (dataUrl) => {
          assign(dataUrl);
          this.render();
        });
        return;
      }
      if (this.mode === "inpaint") {
        loadImageNative(blob, 1024, (dataUrl, width, height) => {
          this.inpaintDims = [width, height];
          assign(dataUrl);
          this.render();
        });
        return;
      }
      const [w, h] = FORGE_ASPECTS[this.aspect] || [1024, 1024];
      maybeCropUpload(blob, `${w}/${h}`, w, h, (dataUrl) => {
        assign(dataUrl);
        this.render();
      });
    } catch (err) {
      errorToast(err.message || "Couldn't load that image.");
    }
  }
```

This keeps every existing call site of `chooseReferenceSource()`/`clearReference()` (Image/Inpaint/Upscale modes, all still calling with zero arguments) working identically — `slot` defaults to `"reference"`, which routes to the pre-existing `this.referenceImage`.

- [ ] **Step 3: Add the ending-frame upload block to `referenceImageSectionHtml`**

In `new_ui/js/forge.js`, find `referenceImageSectionHtml()` (already modified by a prior fix to support Video mode's starting-frame block). Locate its closing:

```js
        ` : `
          <button type="button" onclick="_activeForgeView.chooseReferenceSource()" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:7px;padding:22px;background:var(--color-surface);border:1.5px dashed var(--color-line-2);border-radius:12px;color:var(--color-sec);cursor:pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add a reference image</span>
            <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--color-muted)">DROP OR BROWSE &middot; PNG / JPG</span>
          </button>
        `}
      </div>
    `;
  }
```

Replace the final `` `} </div> ` ; } `` closing block with a version that, for video mode, appends a second block below the first for the ending frame:

```js
        ` : `
          <button type="button" onclick="_activeForgeView.chooseReferenceSource()" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:7px;padding:22px;background:var(--color-surface);border:1.5px dashed var(--color-line-2);border-radius:12px;color:var(--color-sec);cursor:pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add a reference image</span>
            <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--color-muted)">DROP OR BROWSE &middot; PNG / JPG</span>
          </button>
        `}
      </div>
      ${isVideo ? this.lastFrameSectionHtml() : ""}
    `;
  }

  lastFrameSectionHtml() {
    return `
      <div style="margin-bottom:16px">
        <div class="grimoire-field-label" style="margin-bottom:6px">Ending frame <span style="text-transform:none;color:var(--color-muted)">&middot; optional</span></div>
        <p style="margin:0 0 12px;color:var(--color-muted);font-size:12.5px;line-height:1.5">Interpolate toward a final frame instead of animating freely. Leave empty to only use the starting frame (or none).</p>
        ${this.lastFrameImage ? `
          <div style="display:flex;gap:14px;align-items:center;background:var(--color-surface-2);border:1px solid var(--color-line);border-radius:12px;padding:12px">
            <div style="position:relative;width:96px;height:96px;border-radius:10px;overflow:hidden;flex:none;border:1px solid var(--color-line-2)">
              <img src="${this.lastFrameImage}" style="width:100%;height:100%;object-fit:cover;display:block" alt="">
              <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px;z-index:3">
                <button type="button" onclick="_activeForgeView.chooseReferenceSource('lastFrame')" data-tooltip="Replace" aria-label="Replace" style="width:22px;height:22px;border-radius:6px;background:rgba(0,0,0,.55);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
                </button>
              </div>
            </div>
            <div style="flex:1;min-width:0"></div>
            <button type="button" onclick="_activeForgeView.clearReference('lastFrame')" style="background:none;border:1px solid var(--color-line-2);border-radius:8px;color:var(--color-muted);font-size:11px;padding:5px 9px;cursor:pointer;flex:none">Remove</button>
          </div>
        ` : `
          <button type="button" onclick="_activeForgeView.chooseReferenceSource('lastFrame')" style="width:100%;display:flex;flex-direction:column;align-items:center;gap:7px;padding:22px;background:var(--color-surface);border:1.5px dashed var(--color-line-2);border-radius:12px;color:var(--color-sec);cursor:pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add an ending frame</span>
            <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--color-muted)">DROP OR BROWSE &middot; PNG / JPG</span>
          </button>
        `}
      </div>
    `;
  }
```

Note: `isVideo` is already computed at the top of `referenceImageSectionHtml()` by the prior fix that added the starting-frame video block — reuse that existing local variable, do not redeclare it.

- [ ] **Step 4: Send `last_frame` in the video generation request**

In `new_ui/js/forge.js`, in `generateVideo()`, find:

```js
      image: this.referenceImage || undefined,
      fps: this.fps,
```

Replace with:

```js
      image: this.referenceImage || undefined,
      last_frame: this.lastFrameImage || undefined,
      fps: this.fps,
```

- [ ] **Step 5: Verify the served file matches source**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/forge.js | md5sum` and `md5sum new_ui/js/forge.js`
Expected: both hashes match.

- [ ] **Step 6: Manual browser verification**

Since Video mode is currently `role === "dev"`-gated (out of scope to change per this plan's constraints), verification of the actual upload UI requires either a `dev`-role account or reading the rendered HTML directly. If no `dev` account is available: verify via `curl`-fetching a rendered page is not possible for authenticated SPA routes, so instead confirm correctness by re-reading the diff for: (a) `lastFrameSectionHtml()` only renders when `isVideo` is true, (b) its Remove/Replace buttons pass `'lastFrame'` explicitly, (c) every pre-existing `chooseReferenceSource()`/`clearReference()` call site (Image/Inpaint/Upscale) was NOT modified and still calls with zero arguments. If a `dev` account is available: open `/sanctum/forge` → Video, confirm two independent upload slots (Starting frame, Ending frame) both render, upload to each independently, confirm Remove on one doesn't clear the other, confirm the network request body (via browser devtools) includes both `image` and `last_frame` when both are set.

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/forge.js
git commit -m "Add ending-frame upload slot to Forge Video mode for Wan2.1 FLF2V"
```
