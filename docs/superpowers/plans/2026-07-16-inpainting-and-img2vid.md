# Inpainting + Video Generation (img2vid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two backend generation features to the existing ComfyUI-backed standalone image-gen infrastructure — inpainting (repaint a masked region of an existing standalone image) and video generation (img2vid/t2v via Wan2.1) — reusing the `standalone_images` table, `_IMAGEGEN_INFLIGHT` rate limiting, and the SSE streaming pattern already used by `/imagegen/standalone/stream`.

**Architecture:** Both features follow the exact shape of the existing standalone image-gen path: a pure workflow-graph builder in `imagegen_workflows.py`, a ComfyUI-calling function in `imagegen.py`, an SSE router endpoint in `routers/imagegen.py`, and persistence via `standalone_images.create()` extended with new columns (`media_type`, `source_image_id`, `fps`, `frame_count`, `duration_s`). No new tables, no new routers, no new repositories.

**Tech Stack:** FastAPI, SQLAlchemy Core, ComfyUI HTTP/websocket API (`httpx`, `websockets`), pytest + pytest-asyncio.

## Global Constraints

- Zero comments in code except where a genuinely non-obvious invariant needs explaining (project style, see CLAUDE.md) — match the existing file's comment density, don't add new comments unless something is truly surprising.
- Every mutating endpoint gets `log.info` on success; every caught exception gets `log.warning`/`log.error` with detail — no silent phases, especially for the long-running video path.
- No chat/character content, API keys, or full endpoint URLs in logs.
- `backend/` modules import siblings with absolute `from backend.x import y` — never bare `import x`.
- Videos are always created with `is_explicit=True, classified=True` at creation — no NSFW classification task runs for video.
- Both features share the existing `_IMAGEGEN_INFLIGHT` one-job-per-user limiter in `backend/routers/imagegen.py`.
- Never use `EnterWorktree`/`git worktree` for this repo — edit files directly in `/var/home/staygold/ai-frontend` so the live `uvicorn --reload` picks up changes.
- Frontend UI (mask editor, video player) is explicitly out of scope for this plan.

---

### Task 1: Schema — `standalone_images` new columns

**Files:**
- Modify: `backend/db.py:215-246` (the `standalone_images` table definition)
- Test: `backend/tests/test_standalone_images_repo.py`

**Interfaces:**
- Produces: `standalone_images` table now has columns `media_type` (Text, default `'image'`), `source_image_id` (Text, nullable), `fps` (Integer, default `0`), `frame_count` (Integer, default `0`), `duration_s` (Float, default `0`) — every later task's `create()`/query changes depend on these existing.

- [ ] **Step 1: Add the new columns to the table definition**

In `backend/db.py`, inside the `standalone_images = sa.Table(...)` block (right after the `upscaler` column at line 246, before the closing `)`), add:

```python
    sa.Column("media_type", sa.Text, nullable=False, server_default=text("'image'")),
    sa.Column("source_image_id", sa.Text, nullable=True),
    sa.Column("fps", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("frame_count", sa.Integer, nullable=False, server_default=text("0")),
    sa.Column("duration_s", sa.Float, nullable=False, server_default=text("0")),
```

- [ ] **Step 2: Write a failing test asserting the new columns exist and default correctly**

Append to `backend/tests/test_standalone_images_repo.py`:

```python
async def test_new_media_columns_default(db_conn):
    img = await _make_image(db_conn)
    fetched = await standalone_image_repo.get(img["id"])
    assert fetched["media_type"] == "image"
    assert fetched["source_image_id"] is None
    assert fetched["fps"] == 0
    assert fetched["frame_count"] == 0
    assert fetched["duration_s"] == 0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_standalone_images_repo.py::test_new_media_columns_default -v`
Expected: FAIL (column does not exist yet, since `metadata.create_all` only creates missing tables/columns at startup and the test DB schema needs the column defined in `db.py` before `db_conn`'s engine setup picks it up)

- [ ] **Step 4: Run the schema Step 1 edit, then re-run the test**

Since the test DB is created fresh from `db.py`'s `_meta` (via `metadata.create_all`), no manual migration is needed for a fresh DB — the new columns appear automatically once the `Table` definition includes them.

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_standalone_images_repo.py::test_new_media_columns_default -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/tests/test_standalone_images_repo.py
git commit -m "Add media_type/source_image_id/video metadata columns to standalone_images"
```

---

### Task 2: Repository — thread new columns through `standalone_images.py`

**Files:**
- Modify: `backend/repositories/standalone_images.py:16-93` (`_standalone_row`, `create`)
- Test: `backend/tests/test_standalone_images_repo.py`

**Interfaces:**
- Consumes: `standalone_images` table columns from Task 1.
- Produces: `standalone_image_repo.create(user_id, image, positive, negative, ..., media_type: str = "image", source_image_id: str | None = None, fps: int = 0, frame_count: int = 0, duration_s: float = 0.0) -> dict` — the exact signature Tasks 4 and 7 (inpaint/video routers) call. `_standalone_row()` includes `media_type`, `source_image_id`, `fps`, `frame_count`, `duration_s` in every returned dict.

- [ ] **Step 1: Write failing tests for the new `create()` params and row shape**

Append to `backend/tests/test_standalone_images_repo.py`:

```python
async def test_create_inpaint_variant_with_source_image(db_conn):
    original = await _make_image(db_conn, user_id="user-a")
    variant = await standalone_image_repo.create(
        "user-a", "/media/inpaint.png", positive="a dog", negative="blurry",
        media_type="image", source_image_id=original["id"], is_img2img=True)
    assert variant["media_type"] == "image"
    assert variant["source_image_id"] == original["id"]

    fetched = await standalone_image_repo.get(variant["id"])
    assert fetched["source_image_id"] == original["id"]


async def test_create_video(db_conn):
    video = await standalone_image_repo.create(
        "user-a", "/media/clip.mp4", positive="a dog running", negative="",
        media_type="video", is_explicit=True, fps=16, frame_count=48, duration_s=3.0)
    assert video["media_type"] == "video"
    assert video["fps"] == 16
    assert video["frame_count"] == 48
    assert video["duration_s"] == 3.0
    assert video["is_explicit"] is True

    fetched = await standalone_image_repo.get(video["id"])
    assert fetched["media_type"] == "video"
    assert fetched["fps"] == 16
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_standalone_images_repo.py::test_create_inpaint_variant_with_source_image backend/tests/test_standalone_images_repo.py::test_create_video -v`
Expected: FAIL with `TypeError: create() got an unexpected keyword argument 'media_type'`

- [ ] **Step 3: Update `create()` and `_standalone_row()`**

In `backend/repositories/standalone_images.py`, replace the `create` function (lines 73-93) with:

```python
async def create(user_id: str, image: str, positive: str, negative: str,
                 checkpoint: str = "", loras: list | None = None,
                 is_explicit: bool = False, sampler: str = "",
                 scheduler: str = "", steps: int = 20,
                 is_img2img: bool = False, cfg: float = 7.0,
                 upscaler: str = "", media_type: str = "image",
                 source_image_id: str | None = None, fps: int = 0,
                 frame_count: int = 0, duration_s: float = 0.0) -> dict:
    iid = nid("si")
    created = time.time()
    loras_json = json.dumps(loras or [])
    await _w(insert(standalone_images).values(
        id=iid, user_id=user_id, image=image, positive=positive,
        negative=negative, created=created, checkpoint=checkpoint, loras=loras_json,
        sampler=sampler, scheduler=scheduler, steps=steps, cfg=cfg, upscaler=upscaler,
        is_explicit=1 if is_explicit else 0, is_img2img=1 if is_img2img else 0,
        media_type=media_type, source_image_id=source_image_id,
        fps=fps, frame_count=frame_count, duration_s=duration_s))
    log.info(f"standalone_images: created id={iid} user_id={user_id} media_type={media_type}")
    return {"id": iid, "image": image, "positive": positive, "negative": negative,
            "created": created, "is_public": False, "is_explicit": bool(is_explicit),
            "human_reviewed": False, "classified": False,
            "checkpoint": checkpoint, "loras": loras or [], "sampler": sampler,
            "scheduler": scheduler, "steps": steps, "is_img2img": bool(is_img2img),
            "cfg": cfg, "upscaler": upscaler, "media_type": media_type,
            "source_image_id": source_image_id, "fps": fps,
            "frame_count": frame_count, "duration_s": duration_s}
```

In `_standalone_row` (lines 16-32), add after the `d["steps"] = d.get("steps") or 20` line:

```python
    d["media_type"] = d.get("media_type") or "image"
    d["source_image_id"] = d.get("source_image_id")
    d["fps"] = d.get("fps") or 0
    d["frame_count"] = d.get("frame_count") or 0
    d["duration_s"] = d.get("duration_s") or 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_standalone_images_repo.py -v`
Expected: PASS (all tests in the file, including the new ones and the pre-existing ones — confirms no regression)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/standalone_images.py backend/tests/test_standalone_images_repo.py
git commit -m "Thread media_type/source_image_id/video metadata through standalone_images repo"
```

---

### Task 3: Inpaint workflow builder (pure, no I/O)

**Files:**
- Modify: `backend/imagegen_workflows.py` (add new function after `_splice_reference_image`, i.e. after line 250)
- Test: create `backend/tests/test_imagegen_workflows.py`

**Interfaces:**
- Consumes: `CHECKPOINT_NAME_BLACKLIST_EXACT`, `_lora_blacklisted` (already imported in this file from `imagegen_options`).
- Produces: `_build_inpaint_workflow(positive: str, negative: str, checkpoint: str, image_name: str, mask_name: str, denoise: float = 1.0, sampler: str = "euler", scheduler: str = "normal", steps: int = 20, cfg: float = 7.0) -> dict` — a ComfyUI node-graph dict. Task 5 (`imagegen.py`) imports and calls this exact signature.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_imagegen_workflows.py`:

```python
import pytest

from backend.imagegen_workflows import _build_inpaint_workflow


def test_build_inpaint_workflow_wires_mask_and_image():
    wf = _build_inpaint_workflow(
        "a cat", "blurry", "model.safetensors", "photo.png", "mask.png", denoise=0.8)

    load_image = next(n for n in wf.values() if n["class_type"] == "LoadImage"
                      and n["inputs"]["image"] == "photo.png")
    load_mask = next(n for n in wf.values() if n["class_type"] == "LoadImageMask"
                     and n["inputs"]["image"] == "mask.png")
    encode = next(n for n in wf.values() if n["class_type"] == "VAEEncodeForInpaint")
    load_image_id = next(k for k, v in wf.items() if v is load_image)
    load_mask_id = next(k for k, v in wf.items() if v is load_mask)
    assert encode["inputs"]["pixels"] == [load_image_id, 0]
    assert encode["inputs"]["mask"] == [load_mask_id, 0]

    ksampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
    assert ksampler["inputs"]["denoise"] == 0.8
    assert ksampler["inputs"]["positive"] is not None
    assert ksampler["inputs"]["negative"] is not None

    checkpoint_node = next(n for n in wf.values() if n["class_type"] == "CheckpointLoaderSimple")
    assert checkpoint_node["inputs"]["ckpt_name"] == "model.safetensors"

    save = next(n for n in wf.values() if n["class_type"] == "SaveImage")
    assert save is not None


def test_build_inpaint_workflow_rejects_blacklisted_checkpoint():
    with pytest.raises(ValueError):
        _build_inpaint_workflow(
            "a cat", "blurry", "prefect_illustrous_sdxl.safetensors",
            "photo.png", "mask.png")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_workflows.py -v`
Expected: FAIL with `ImportError: cannot import name '_build_inpaint_workflow'`

- [ ] **Step 3: Implement `_build_inpaint_workflow`**

In `backend/imagegen_workflows.py`, add after `_splice_reference_image` (after line 250, before `_splice_loras_anima`):

```python
def _build_inpaint_workflow(positive: str, negative: str, checkpoint: str,
                            image_name: str, mask_name: str, denoise: float = 1.0,
                            sampler: str = "euler", scheduler: str = "normal",
                            steps: int = 20, cfg: float = 7.0) -> dict:
    if checkpoint in CHECKPOINT_NAME_BLACKLIST_EXACT:
        raise ValueError(f"Checkpoint '{checkpoint}' is not available for generation")
    seed = random.randint(0, 2**32 - 1)
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "2": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "3": {"class_type": "LoadImageMask", "inputs": {"image": mask_name, "channel": "red"}},
        "4": {"class_type": "VAEEncodeForInpaint",
              "inputs": {"pixels": ["2", 0], "mask": ["3", 0], "vae": ["1", 2], "grow_mask_by": 6}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["1", 1]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["1", 1]}},
        "7": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler,
            "scheduler": scheduler, "denoise": denoise,
            "model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0],
            "latent_image": ["4", 0],
        }},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["1", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "storyhavenai_inpaint", "images": ["8", 0]}},
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_workflows.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/imagegen_workflows.py backend/tests/test_imagegen_workflows.py
git commit -m "Add _build_inpaint_workflow ComfyUI graph builder"
```

---

### Task 4: `imagegen.py` — inpaint generation function + mask upload

**Files:**
- Modify: `backend/imagegen.py` (add `upload_mask_image` after `upload_reference_image` at line 63; add `generate_inpaint_image_stream` after `generate_image_stream`)
- Test: create `backend/tests/test_imagegen_inpaint.py`

**Interfaces:**
- Consumes: `_build_inpaint_workflow` (Task 3), `upload_reference_image`'s pattern (existing, line 52-63), `_WS_PREVIEW_IMAGE` (existing module constant).
- Produces: `async def upload_mask_image(base_url: str, mask_bytes: bytes, filename: str = "mask.png") -> str` and `async def generate_inpaint_image_stream(positive: str, negative: str, base_url: str, checkpoint: str, image_bytes: bytes, mask_bytes: bytes, denoise: float = 1.0, sampler: str = "euler", scheduler: str = "normal", steps: int = 20, cfg: float = 7.0)` — an async generator yielding `("preview", jpeg_bytes)` / `("done", png_bytes)`, same shape as `generate_image_stream`. Task 6 (router) calls this exact signature.

- [ ] **Step 1: Write the failing test using a stub ComfyUI (mocked httpx/websockets)**

Create `backend/tests/test_imagegen_inpaint.py`:

```python
import json
import struct
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend import imagegen

pytestmark = pytest.mark.asyncio


class _FakeWSMessage:
    def __init__(self, payload):
        self._payload = payload


async def _fake_ws_iter(messages):
    for m in messages:
        yield m


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_inpaint_image_stream_yields_done(mock_ws_connect, mock_client_cls):
    upload_resp = MagicMock()
    upload_resp.json.return_value = {"name": "uploaded.png"}
    upload_resp.raise_for_status = MagicMock()

    prompt_resp = MagicMock()
    prompt_resp.json.return_value = {"prompt_id": "pid-1"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-1": {"status": {"status_str": "success"},
                  "outputs": {"9": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"PNGDATA"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [upload_resp, upload_resp, prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-1", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__.return_value = _fake_ws_iter([finished_msg])
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_inpaint_image_stream(
            "a cat", "blurry", "http://comfyui:8188", "model.safetensors",
            b"IMAGEBYTES", b"MASKBYTES", denoise=0.8):
        results.append((kind, data))

    assert results == [("done", b"PNGDATA")]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint.py -v`
Expected: FAIL with `AttributeError: module 'backend.imagegen' has no attribute 'generate_inpaint_image_stream'`

- [ ] **Step 3: Add `upload_mask_image` and `generate_inpaint_image_stream` to `backend/imagegen.py`**

Add after `upload_reference_image` (after line 63):

```python
async def upload_mask_image(base_url: str, mask_bytes: bytes, filename: str = "mask.png") -> str:
    """Uploads an inpaint mask into ComfyUI's input folder the same way
    upload_reference_image does for a reference image — returns the filename
    ComfyUI stored it under for a LoadImageMask node to reference."""
    root = (base_url or "").rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{root}/upload/image",
                              files={"image": (filename, mask_bytes, "image/png")},
                              data={"overwrite": "true"})
        r.raise_for_status()
        return r.json()["name"]
```

Add after `generate_image_stream` (at the end of the file), and add the import at the top of the file's `from backend.imagegen_workflows import (...)` block (add `_build_inpaint_workflow,` to that import list):

```python
async def generate_inpaint_image_stream(positive: str, negative: str, base_url: str, checkpoint: str,
                                        image_bytes: bytes, mask_bytes: bytes, denoise: float = 1.0,
                                        sampler: str = "euler", scheduler: str = "normal",
                                        steps: int = 20, cfg: float = 7.0):
    """Live-preview inpaint generation for the standalone image-gen page —
    same websocket/preview/done shape as generate_image_stream, but builds
    the masked-inpaint graph instead of a plain txt2img/img2img one."""
    root = (base_url or "").rstrip("/")
    ws_scheme_root = root.replace("http://", "ws://").replace("https://", "wss://")
    image_name = await upload_reference_image(root, image_bytes, filename="inpaint_source.png")
    mask_name = await upload_mask_image(root, mask_bytes)
    workflow = _build_inpaint_workflow(positive, negative, checkpoint, image_name, mask_name,
                                       denoise=denoise, sampler=sampler, scheduler=scheduler,
                                       steps=steps, cfg=cfg)
    client_id = uuid.uuid4().hex

    async with websockets.connect(f"{ws_scheme_root}/ws?clientId={client_id}", max_size=None) as ws:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
            r.raise_for_status()
            prompt_id = r.json()["prompt_id"]

            finished = False
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    if len(raw) < 8:
                        continue
                    event_type = struct.unpack(">I", raw[:4])[0]
                    if event_type == _WS_PREVIEW_IMAGE:
                        yield ("preview", bytes(raw[8:]))
                    continue
                try:
                    msg = json.loads(raw)
                except Exception as e:
                    log.warning("comfyui: skipping malformed websocket message error=%s", e)
                    continue
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        finished = True
                        break

            if not finished:
                raise TimeoutError("ComfyUI connection closed before generation finished")

        async with httpx.AsyncClient(timeout=30) as client:
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            history = hr.json().get(prompt_id, {})
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI generation failed: {status}")
            outputs = history.get("outputs", {})
            image_info = None
            for node_out in outputs.values():
                imgs = node_out.get("images") or []
                if imgs:
                    image_info = imgs[0]
                    break
            if not image_info:
                raise RuntimeError("ComfyUI finished but produced no image output")
            vr = await client.get(f"{root}/view", params={
                "filename": image_info["filename"],
                "subfolder": image_info.get("subfolder", ""),
                "type": image_info.get("type", "output"),
            })
            vr.raise_for_status()
            yield ("done", vr.content)
```

Also add `import websockets` at module level near the other imports in `backend/imagegen.py` (currently imported lazily inside `generate_image_stream` — since `generate_inpaint_image_stream` needs it too, hoist the import to the top of the file, matching how `httpx` is already imported at module level, and remove the lazy `try/except ImportError` block from `generate_image_stream` in favor of the top-level import; if `websockets` truly isn't installed, both functions now fail at import time with a clear `ModuleNotFoundError`, which is acceptable since `requirements.txt` already lists it as a real dependency of this file).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint.py -v`
Expected: PASS

- [ ] **Step 5: Run the full imagegen-related test suite to check for regressions**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_workflows.py backend/tests/test_imagegen_inpaint.py backend/tests/test_standalone_images_repo.py -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/imagegen.py backend/tests/test_imagegen_inpaint.py
git commit -m "Add generate_inpaint_image_stream and upload_mask_image to imagegen.py"
```

---

### Task 5: Schema for `ImageGenInpaintIn` request body

**Files:**
- Modify: `backend/schemas.py` (add after `ImageGenSaveIn`, around line 278)

**Interfaces:**
- Produces: `class ImageGenInpaintIn(BaseModel)` with fields `image_id: str`, `mask: str`, `positive: str = ""`, `negative: str = ""`, `checkpoint: str | None = None`, `denoise: float = 1.0`, `sampler: str | None = None`, `scheduler: str | None = None`, `steps: int = 20`, `cfg: float = 7.0` — Task 6's router endpoint depends on this exact class name/fields.

- [ ] **Step 1: Add the schema**

In `backend/schemas.py`, add after `ImageGenSaveIn` (after line 278, before `ImageShareIn`):

```python
class ImageGenInpaintIn(BaseModel):
    image_id: str
    mask: str   # data:image/...;base64,... — the painted-region mask
    positive: str = ""
    negative: str = ""
    checkpoint: str | None = None
    denoise: float = 1.0   # 1.0 = fully regenerate masked region from prompt
    sampler: str | None = None
    scheduler: str | None = None
    steps: int = 20
    cfg: float = 7.0
```

- [ ] **Step 2: Verify the module still imports cleanly**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -c "from backend.schemas import ImageGenInpaintIn; print(ImageGenInpaintIn(image_id='x', mask='data:image/png;base64,AA=='))"`
Expected: Prints the constructed model with no error.

- [ ] **Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "Add ImageGenInpaintIn request schema"
```

---

### Task 6: Router — `POST /api/imagegen/inpaint`

**Files:**
- Modify: `backend/routers/imagegen.py` (add import of `ImageGenInpaintIn` to the existing schemas import at line ~28; add new endpoint near `stream_standalone_image`)
- Test: create `backend/tests/test_imagegen_inpaint_router.py`

**Interfaces:**
- Consumes: `ImageGenInpaintIn` (Task 5), `imagegen.generate_inpaint_image_stream` (Task 4), `standalone_image_repo.get`/`create` (Task 2), `_decode_reference_image` (existing helper in this file, reused unchanged for the `mask` field since it already validates any `data:image/...` URL generically), `_IMAGEGEN_INFLIGHT` (existing module-level limiter).
- Produces: `POST /api/imagegen/inpaint` SSE endpoint — `preview`/`done`/`error` events, `done` event's `image` field is a `data:image/png;base64,...` URL of the raw result (not yet persisted — matches `/imagegen/standalone/stream`'s "nothing written until /save" pattern). Persistence is a separate follow-up endpoint mirroring `/imagegen/standalone/save`, added in Task 6 Step 3 below as `POST /api/imagegen/inpaint/save`.

- [ ] **Step 1: Write the failing router test**

This codebase's router tests call the endpoint function directly with a plain `current_user` dict — there is no HTTP client/login fixture (see `backend/tests/test_settings_router.py`, `backend/tests/test_health_router.py`). Follow that same pattern.

Create `backend/tests/test_imagegen_inpaint_router.py`:

```python
import pytest
from fastapi import HTTPException

from backend.repositories import standalone_images as standalone_image_repo
from backend.routers.imagegen import stream_inpaint_image
from backend.schemas import ImageGenInpaintIn

pytestmark = pytest.mark.asyncio


async def test_inpaint_requires_owned_image_id(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenInpaintIn(image_id="nonexistent", mask="data:image/png;base64,AAAA",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 404


async def test_inpaint_rejects_other_users_image(db_conn):
    owner = {"id": "user-a", "username": "user-a", "is_admin": False}
    other = {"id": "user-b", "username": "user-b", "is_admin": False}
    img = await standalone_image_repo.create("user-a", "/media/x.png", "cat", "")
    body = ImageGenInpaintIn(image_id=img["id"], mask="data:image/png;base64,AAAA",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=other)
    assert exc_info.value.status_code == 403


async def test_inpaint_rejects_malformed_mask(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    img = await standalone_image_repo.create("user-a", "/media/x.png", "cat", "")
    body = ImageGenInpaintIn(image_id=img["id"], mask="not-a-data-url",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_router.py -v`
Expected: FAIL with `ImportError: cannot import name 'stream_inpaint_image'` since the endpoint doesn't exist yet.

- [ ] **Step 3: Implement the router endpoint**

In `backend/routers/imagegen.py`:

1. Add `ImageGenInpaintIn` to the existing `from backend.schemas import (...)` block.
2. Add the endpoint after `stop_standalone_image` (after the function ending around line 260):

```python
@api.post("/imagegen/inpaint")
async def stream_inpaint_image(body: ImageGenInpaintIn, current_user: dict = Depends(get_current_user)):
    """Live-preview inpaint generation for an existing standalone image — same
    nothing-persisted-until-/save shape as /imagegen/standalone/stream."""
    source = await standalone_image_repo.get(body.image_id)
    if not source:
        raise HTTPException(404, "image not found")
    if source["user_id"] != current_user["id"]:
        raise HTTPException(403, "not your image")

    mask_bytes = _decode_reference_image(body.mask)
    if not mask_bytes:
        raise HTTPException(400, "mask is required")
    image_bytes = _decode_reference_image(source["image"]) if source["image"].startswith("data:") else None
    if image_bytes is None:
        with open(source["image"].replace("/media/", MEDIA_DIR + "/"), "rb") as f:
            image_bytes = f.read()

    checkpoint = body.checkpoint or CFG["comfyui_checkpoint"]
    log.info("imagegen: inpaint start user=%s image_id=%s checkpoint=%s",
             current_user["username"], body.image_id, checkpoint)
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])

    async def gen():
        try:
            async for kind, data in imagegen.generate_inpaint_image_stream(
                    body.positive, body.negative, CFG["comfyui_url"], checkpoint,
                    image_bytes, mask_bytes, denoise=body.denoise,
                    sampler=body.sampler or "euler", scheduler=body.scheduler or "normal",
                    steps=_clamp_steps(body.steps), cfg=body.cfg):
                mime = "image/jpeg" if kind == "preview" else "image/png"
                b64 = base64.b64encode(data).decode()
                yield "data: " + json.dumps({
                    "type": kind, "image": f"data:{mime};base64,{b64}",
                    "source_image_id": body.image_id,
                }) + "\n\n"
            log.info("imagegen: inpaint done user=%s image_id=%s", current_user["username"], body.image_id)
        except Exception as e:
            log.warning("imagegen: inpaint failed user=%s image_id=%s: %s",
                        current_user["username"], body.image_id, e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_router.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/routers/imagegen.py backend/tests/test_imagegen_inpaint_router.py
git commit -m "Add POST /api/imagegen/inpaint streaming endpoint"
```

---

### Task 7: Router — `POST /api/imagegen/inpaint/save`

**Files:**
- Modify: `backend/routers/imagegen.py` (add endpoint near the existing `/imagegen/standalone/save`, which must first be located — search for it since it wasn't in the excerpts read during planning)

**Interfaces:**
- Consumes: `ImageGenSaveIn` (existing schema — reused as-is, since the save payload shape is identical: a data-URL image plus generation metadata), `standalone_image_repo.create` (Task 2), extended with `media_type="image"` and `source_image_id`.
- Produces: `POST /api/imagegen/inpaint/save` — persists the inpaint result as a new `standalone_images` row with `source_image_id` set, `media_type="image"`, `is_img2img=True`. Reuses `classify_image_background` exactly like the existing image-save path.

- [ ] **Step 1: Locate the existing standalone save endpoint for the exact pattern to mirror**

Run: `grep -n "imagegen/standalone/save" -A 30 backend/routers/imagegen.py`

Read the full function body returned by this grep before writing Step 2 — it shows exactly how `_write_file`, `MEDIA_DIR`, `classify_image_background`, and `standalone_image_repo.create` are wired together for the existing save flow, which this task's endpoint must mirror with the two differences called out below (media_type/source_image_id passed through, and requiring `source_image_id` in the request body).

- [ ] **Step 2: Write the failing test**

Same direct-call pattern as Task 6 (no HTTP client — call the endpoint function with a plain `current_user` dict).

Create `backend/tests/test_imagegen_inpaint_save_router.py`:

```python
import base64

import pytest
from fastapi import HTTPException

from backend.repositories import standalone_images as standalone_image_repo
from backend.routers.imagegen import save_inpaint_image
from backend.schemas import ImageGenSaveIn

pytestmark = pytest.mark.asyncio


async def test_inpaint_save_creates_variant_with_source_image_id(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    original = await standalone_image_repo.create("user-a", "/media/orig.png", "cat", "")
    tiny_png_b64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20).decode()
    body = ImageGenSaveIn(image=f"data:image/png;base64,{tiny_png_b64}",
                          positive="a dog", negative="", source_image_id=original["id"])

    saved = await save_inpaint_image(body, current_user=user)

    assert saved["source_image_id"] == original["id"]
    assert saved["media_type"] == "image"
    assert saved["is_img2img"] is True


async def test_inpaint_save_requires_source_image_id(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    tiny_png_b64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20).decode()
    body = ImageGenSaveIn(image=f"data:image/png;base64,{tiny_png_b64}",
                          positive="a dog", negative="", source_image_id=None)

    with pytest.raises(HTTPException) as exc_info:
        await save_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 400
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_save_router.py -v`
Expected: FAIL with `ImportError: cannot import name 'save_inpaint_image'` (route not implemented yet)

- [ ] **Step 4: Add `source_image_id` to `ImageGenSaveIn` and implement the endpoint**

In `backend/schemas.py`, modify `ImageGenSaveIn` (lines 266-278) to add one field:

```python
class ImageGenSaveIn(BaseModel):
    image: str
    positive: str = ""
    negative: str = ""
    checkpoint: str = ""
    loras: list[LoraSpec] = []
    sampler: str = ""
    scheduler: str = ""
    steps: int = 20
    is_img2img: bool = False
    cfg: float = 7.0
    upscaler: str = ""
    source_image_id: str | None = None
```

In `backend/routers/imagegen.py`, add the new endpoint directly after whatever function Step 1's grep located (the existing `/imagegen/standalone/save` handler), matching its body/media-write/classify pattern exactly but targeting a new route and forcing `is_img2img=True`, `media_type="image"`:

```python
@api.post("/imagegen/inpaint/save")
async def save_inpaint_image(body: ImageGenSaveIn, current_user: dict = Depends(get_current_user)):
    if not body.source_image_id:
        raise HTTPException(400, "source_image_id is required")
    source = await standalone_image_repo.get(body.source_image_id)
    if not source or source["user_id"] != current_user["id"]:
        raise HTTPException(404, "source image not found")

    image_bytes = _decode_reference_image(body.image)
    if not image_bytes:
        raise HTTPException(400, "image is required")
    fname = f"img_{uuid.uuid4().hex[:10]}.png"
    await _write_file(os.path.join(MEDIA_DIR, fname), image_bytes)
    url = f"/media/{fname}"

    saved = await standalone_image_repo.create(
        current_user["id"], url, body.positive, body.negative,
        checkpoint=body.checkpoint, loras=[l.model_dump() for l in body.loras],
        sampler=body.sampler, scheduler=body.scheduler, steps=body.steps,
        is_img2img=True, cfg=body.cfg, upscaler=body.upscaler,
        media_type="image", source_image_id=body.source_image_id)
    log.info("imagegen: inpaint saved user=%s id=%s source_image_id=%s",
             current_user["username"], saved["id"], body.source_image_id)
    classify_image_background(image_bytes, "image/png", current_user["id"],
                              current_user.get("is_admin", False),
                              lambda: standalone_image_repo.set_explicit(saved["id"], True))
    return saved
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_save_router.py -v`
Expected: PASS

- [ ] **Step 6: Run the full backend test suite to check for regressions**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests -v`
Expected: PASS (all)

- [ ] **Step 7: Commit**

```bash
git add backend/routers/imagegen.py backend/schemas.py backend/tests/test_imagegen_inpaint_save_router.py
git commit -m "Add POST /api/imagegen/inpaint/save persistence endpoint"
```

---

### Task 8: Wan2.1 option listing (`imagegen_options.py`)

**Files:**
- Modify: `backend/imagegen_options.py` (add after `list_vaes`, around line 60)
- Test: create `backend/tests/test_imagegen_options_wan.py`

**Interfaces:**
- Produces: `async def list_wan_unets(base_url: str) -> list[str]` and `async def list_wan_clip_models(base_url: str) -> list[str]` — reusing `list_object_options` exactly like `list_anima_unets`/`list_clip_models`. Task 9's workflow builder and Task 10's router depend on these existing (used for populating the model picker; the workflow builder itself just takes filenames as strings, same as the Anima path).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_imagegen_options_wan.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from backend import imagegen_options

pytestmark = pytest.mark.asyncio


@patch("backend.imagegen_options.list_object_options", new_callable=AsyncMock)
async def test_list_wan_unets_queries_unet_loader(mock_list):
    mock_list.return_value = ["wan2.1_1.3b.safetensors"]
    result = await imagegen_options.list_wan_unets("http://comfyui:8188")
    assert result == ["wan2.1_1.3b.safetensors"]
    mock_list.assert_called_once_with("http://comfyui:8188", "UNETLoader", "unet_name")


@patch("backend.imagegen_options.list_object_options", new_callable=AsyncMock)
async def test_list_wan_clip_models_queries_clip_loader(mock_list):
    mock_list.return_value = ["umt5_xxl.safetensors"]
    result = await imagegen_options.list_wan_clip_models("http://comfyui:8188")
    assert result == ["umt5_xxl.safetensors"]
    mock_list.assert_called_once_with("http://comfyui:8188", "CLIPLoader", "clip_name")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_options_wan.py -v`
Expected: FAIL with `AttributeError: module 'backend.imagegen_options' has no attribute 'list_wan_unets'`

- [ ] **Step 3: Implement the two functions**

In `backend/imagegen_options.py`, add after `list_vaes` (after line 59):

```python
async def list_wan_unets(base_url: str) -> list[str]:
    return await list_object_options(base_url, "UNETLoader", "unet_name")


async def list_wan_clip_models(base_url: str) -> list[str]:
    return await list_object_options(base_url, "CLIPLoader", "clip_name")
```

*(Wan2.1's UNet and CLIP both load through the same generic `UNETLoader`/`CLIPLoader` node types Anima already uses, since ComfyUI's `/object_info` reports whatever files exist on disk regardless of architecture — this function pair only differs from `list_anima_unets`/`list_clip_models` in name, which keeps callers unambiguous about which architecture's picker they're populating, matching the project's existing one-name-per-architecture convention rather than reusing `list_anima_unets` for an unrelated model family.)*

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_options_wan.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/imagegen_options.py backend/tests/test_imagegen_options_wan.py
git commit -m "Add list_wan_unets/list_wan_clip_models option listing"
```

---

### Task 9: Wan2.1 video workflow builder (pure, no I/O)

**Files:**
- Modify: `backend/imagegen_workflows.py` (add after `_build_upscale_workflow`, at the end of the file)
- Test: extend `backend/tests/test_imagegen_workflows.py`

**Interfaces:**
- Produces: `_build_wan_video_workflow(positive: str, negative: str, unet_name: str, clip_name: str, vae_name: str, image_name: str | None = None, fps: int = 16, num_frames: int = 33, width: int = 832, height: int = 480, steps: int = 20, cfg: float = 6.0) -> dict` — a ComfyUI node-graph dict. Branches internally on whether `image_name` is `None` (text-to-video) or set (image-to-video). Task 11 (`imagegen.py`) imports and calls this exact signature.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_imagegen_workflows.py`:

```python
from backend.imagegen_workflows import _build_wan_video_workflow


def test_build_wan_video_workflow_text_to_video():
    wf = _build_wan_video_workflow(
        "a dog running", "blurry", "wan_unet.safetensors", "wan_clip.safetensors",
        "wan_vae.safetensors", image_name=None, fps=16, num_frames=33)
    assert not any(n["class_type"] == "LoadImage" for n in wf.values())
    unet = next(n for n in wf.values() if n["class_type"] == "UNETLoader")
    assert unet["inputs"]["unet_name"] == "wan_unet.safetensors"
    ksampler = next(n for n in wf.values() if n["class_type"] == "KSampler")
    assert ksampler is not None
    save = next(n for n in wf.values() if "Video" in n["class_type"])
    assert save is not None


def test_build_wan_video_workflow_image_to_video():
    wf = _build_wan_video_workflow(
        "a dog running", "blurry", "wan_unet.safetensors", "wan_clip.safetensors",
        "wan_vae.safetensors", image_name="source.png", fps=16, num_frames=33)
    load_image = next(n for n in wf.values() if n["class_type"] == "LoadImage")
    assert load_image["inputs"]["image"] == "source.png"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_workflows.py -v -k wan_video`
Expected: FAIL with `ImportError: cannot import name '_build_wan_video_workflow'`

- [ ] **Step 3: Implement `_build_wan_video_workflow`**

*(Node class names below — `WanImageToVideo`, `WanTextToVideo` if it doesn't exist and text-only conditioning must go through `WanImageToVideo` with a blank/None image input instead, `CreateVideo`/`SaveVideo` — must be confirmed against the real ComfyUI instance's `/object_info` before this step is executed for real, since this plan is written without live access to that ComfyUI instance's exact installed node set, per the spec's explicit note that the save/combine node type is "confirmed against the real ComfyUI `/object_info` listing at implementation time, not assumed" in the design doc. The implementer must run `curl http://<comfyui-host>/object_info/WanImageToVideo` (and similarly for any candidate text-to-video/video-save node) against the actual ComfyUI instance before finalizing this function's node graph, and adjust the class_type strings below to match reality.)*

Add to `backend/imagegen_workflows.py` at the end of the file:

```python
def _build_wan_video_workflow(positive: str, negative: str, unet_name: str, clip_name: str,
                              vae_name: str, image_name: str | None = None,
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
    if image_name:
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
        "video": ["10", 0], "filename_prefix": "storyhavenai_video"}}
    return wf
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_workflows.py -v`
Expected: PASS (all, including pre-existing inpaint tests)

- [ ] **Step 5: Commit**

```bash
git add backend/imagegen_workflows.py backend/tests/test_imagegen_workflows.py
git commit -m "Add _build_wan_video_workflow ComfyUI graph builder for Wan2.1"
```

---

### Task 10: Schema for `ImageGenVideoIn` request body

**Files:**
- Modify: `backend/schemas.py` (add after `ImageGenInpaintIn`)

**Interfaces:**
- Produces: `class ImageGenVideoIn(BaseModel)` with fields `image_id: str | None = None`, `positive: str = ""`, `negative: str = ""`, `unet_name: str | None = None`, `clip_name: str | None = None`, `vae_name: str | None = None`, `fps: int = 16`, `num_frames: int = 33`, `width: int = 832`, `height: int = 480`, `steps: int = 20`, `cfg: float = 6.0` — Task 12's router depends on this exact class.

- [ ] **Step 1: Add the schema**

In `backend/schemas.py`, add after `ImageGenInpaintIn`:

```python
class ImageGenVideoIn(BaseModel):
    image_id: str | None = None   # None = text-to-video; set = image-to-video
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

- [ ] **Step 2: Verify the module still imports cleanly**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -c "from backend.schemas import ImageGenVideoIn; print(ImageGenVideoIn())"`
Expected: Prints the constructed model with defaults, no error.

- [ ] **Step 3: Commit**

```bash
git add backend/schemas.py
git commit -m "Add ImageGenVideoIn request schema"
```

---

### Task 11: `imagegen.py` — video generation function

**Files:**
- Modify: `backend/imagegen.py` (add `generate_video_stream` at the end of the file; add `_build_wan_video_workflow` to the existing `imagegen_workflows` import block)
- Test: create `backend/tests/test_imagegen_video.py`

**Interfaces:**
- Consumes: `_build_wan_video_workflow` (Task 9), `upload_reference_image` (existing, reused unchanged for the optional source image), `_WS_PREVIEW_IMAGE` (existing).
- Produces: `async def generate_video_stream(positive: str, negative: str, base_url: str, unet_name: str, clip_name: str, vae_name: str, image_bytes: bytes | None = None, fps: int = 16, num_frames: int = 33, width: int = 832, height: int = 480, steps: int = 20, cfg: float = 6.0)` — async generator yielding `("status", str)` progress markers and `("done", video_bytes)`. Task 12's router calls this exact signature.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_imagegen_video.py`:

```python
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend import imagegen

pytestmark = pytest.mark.asyncio


async def _fake_ws_iter(messages):
    for m in messages:
        yield m


@patch("backend.imagegen.httpx.AsyncClient")
@patch("backend.imagegen.websockets.connect")
async def test_generate_video_stream_text_to_video_yields_done(mock_ws_connect, mock_client_cls):
    prompt_resp = MagicMock()
    prompt_resp.json.return_value = {"prompt_id": "pid-vid"}
    prompt_resp.raise_for_status = MagicMock()

    history_resp = MagicMock()
    history_resp.json.return_value = {
        "pid-vid": {"status": {"status_str": "success"},
                    "outputs": {"11": {"videos": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}}}
    }
    history_resp.raise_for_status = MagicMock()

    view_resp = MagicMock()
    view_resp.content = b"MP4DATA"
    view_resp.raise_for_status = MagicMock()

    client_instance = AsyncMock()
    client_instance.post.side_effect = [prompt_resp]
    client_instance.get.side_effect = [history_resp, view_resp]
    mock_client_cls.return_value.__aenter__.return_value = client_instance

    finished_msg = json.dumps({"type": "executing", "data": {"prompt_id": "pid-vid", "node": None}})
    ws_instance = AsyncMock()
    ws_instance.__aiter__.return_value = _fake_ws_iter([finished_msg])
    mock_ws_connect.return_value.__aenter__.return_value = ws_instance

    results = []
    async for kind, data in imagegen.generate_video_stream(
            "a dog running", "blurry", "http://comfyui:8188",
            "wan_unet.safetensors", "wan_clip.safetensors", "wan_vae.safetensors",
            image_bytes=None, fps=16, num_frames=33):
        results.append((kind, data))

    assert ("done", b"MP4DATA") in results
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_video.py -v`
Expected: FAIL with `AttributeError: module 'backend.imagegen' has no attribute 'generate_video_stream'`

- [ ] **Step 3: Implement `generate_video_stream`**

Add `_build_wan_video_workflow,` to the existing `from backend.imagegen_workflows import (...)` block at the top of `backend/imagegen.py`. Then add at the end of the file:

```python
async def generate_video_stream(positive: str, negative: str, base_url: str,
                                unet_name: str, clip_name: str, vae_name: str,
                                image_bytes: bytes | None = None, fps: int = 16,
                                num_frames: int = 33, width: int = 832, height: int = 480,
                                steps: int = 20, cfg: float = 6.0):
    """Live-progress Wan2.1 video generation: image_bytes present switches this
    to image-to-video, absent means text-to-video — same websocket-driven
    submit/poll shape as generate_image_stream, but yields ("status", str)
    phase markers instead of preview frames (Wan2.1's KSampler step count is
    the only progress signal available; no live frame preview node is used
    here), then ("done", mp4_bytes) once the video is saved."""
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

    async with websockets.connect(f"{ws_scheme_root}/ws?clientId={client_id}", max_size=None) as ws:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{root}/prompt", json={"prompt": workflow, "client_id": client_id})
            r.raise_for_status()
            prompt_id = r.json()["prompt_id"]

            finished = False
            last_step_logged = -1
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    continue
                try:
                    msg = json.loads(raw)
                except Exception as e:
                    log.warning("comfyui: skipping malformed websocket message error=%s", e)
                    continue
                if msg.get("type") == "progress":
                    data = msg.get("data", {})
                    step, total = data.get("value"), data.get("max")
                    if step is not None and step != last_step_logged:
                        last_step_logged = step
                        log.info("comfyui: video sampling step=%s/%s prompt_id=%s", step, total, prompt_id)
                        yield ("status", f"sampling {step}/{total}")
                if msg.get("type") == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        finished = True
                        break

            if not finished:
                raise TimeoutError("ComfyUI connection closed before video generation finished")

        yield ("status", "saving")
        async with httpx.AsyncClient(timeout=30) as client:
            hr = await client.get(f"{root}/history/{prompt_id}")
            hr.raise_for_status()
            history = hr.json().get(prompt_id, {})
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI video generation failed: {status}")
            outputs = history.get("outputs", {})
            video_info = None
            for node_out in outputs.values():
                vids = node_out.get("videos") or node_out.get("gifs") or []
                if vids:
                    video_info = vids[0]
                    break
            if not video_info:
                raise RuntimeError("ComfyUI finished but produced no video output")
            vr = await client.get(f"{root}/view", params={
                "filename": video_info["filename"],
                "subfolder": video_info.get("subfolder", ""),
                "type": video_info.get("type", "output"),
            })
            vr.raise_for_status()
            log.info("comfyui: video done prompt_id=%s bytes=%s", prompt_id, len(vr.content))
            yield ("done", vr.content)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_video.py -v`
Expected: PASS

- [ ] **Step 5: Run all imagegen-related tests to check for regressions**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_workflows.py backend/tests/test_imagegen_inpaint.py backend/tests/test_imagegen_video.py backend/tests/test_imagegen_options_wan.py -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/imagegen.py backend/tests/test_imagegen_video.py
git commit -m "Add generate_video_stream for Wan2.1 image/text-to-video"
```

---

### Task 12: Router — `POST /api/imagegen/video`

**Files:**
- Modify: `backend/routers/imagegen.py` (add `ImageGenVideoIn` to schema imports; add endpoint after the inpaint endpoints)
- Test: create `backend/tests/test_imagegen_video_router.py`

**Interfaces:**
- Consumes: `ImageGenVideoIn` (Task 10), `imagegen.generate_video_stream` (Task 11), `imagegen_options.list_wan_unets`/`list_wan_clip_models`/`list_vaes` (Task 8, plus existing `list_vaes`), `standalone_image_repo.get`/`create` (Task 2), `_IMAGEGEN_INFLIGHT`.
- Produces: `POST /api/imagegen/video` SSE endpoint. On the `done` event, persists directly (unlike inpaint's separate preview/save split — video is expensive enough that re-running it just to "save" would be wasteful, so this endpoint persists as part of the same request, matching how chat-message image generation persists inline rather than following the standalone-image preview/save split).

- [ ] **Step 1: Write the failing test**

Same direct-call pattern as Task 6/7 — no HTTP client, call the endpoint function with a plain `current_user` dict and `monkeypatch` any ComfyUI-facing listing function.

Create `backend/tests/test_imagegen_video_router.py`:

```python
import pytest
from fastapi import HTTPException

from backend.routers.imagegen import stream_video
from backend.schemas import ImageGenVideoIn

pytestmark = pytest.mark.asyncio


async def test_video_rejects_missing_wan_models(db_conn, monkeypatch):
    from backend import imagegen

    async def fake_empty_list(url):
        return []
    monkeypatch.setattr(imagegen, "list_wan_unets", fake_empty_list)
    monkeypatch.setattr(imagegen, "list_wan_clip_models", fake_empty_list)
    monkeypatch.setattr(imagegen, "list_vaes", fake_empty_list)

    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running")
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 400


async def test_video_rejects_unowned_image_id(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running", image_id="nonexistent")
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_video_router.py -v`
Expected: FAIL with `ImportError: cannot import name 'stream_video'` (route not implemented yet)

- [ ] **Step 3: Implement the router endpoint**

In `backend/routers/imagegen.py`, add `ImageGenVideoIn` to the schemas import block, then add after the inpaint-save endpoint:

```python
@api.post("/imagegen/video")
async def stream_video(body: ImageGenVideoIn, current_user: dict = Depends(get_current_user)):
    """Wan2.1 image-to-video / text-to-video generation. Unlike standalone
    image gen, the result is persisted directly on the done event rather than
    via a separate /save step — re-running a multi-minute video job just to
    save it would waste real GPU time for no reason."""
    image_bytes = None
    if body.image_id:
        source = await standalone_image_repo.get(body.image_id)
        if not source:
            raise HTTPException(404, "image not found")
        if source["user_id"] != current_user["id"]:
            raise HTTPException(403, "not your image")
        if source["image"].startswith("data:"):
            image_bytes = _decode_reference_image(source["image"])
        else:
            with open(source["image"].replace("/media/", MEDIA_DIR + "/"), "rb") as f:
                image_bytes = f.read()

    unet_name = body.unet_name
    clip_name = body.clip_name
    vae_name = body.vae_name
    if not (unet_name and clip_name and vae_name):
        unets = await imagegen.list_wan_unets(CFG["comfyui_url"])
        clips = await imagegen.list_wan_clip_models(CFG["comfyui_url"])
        vaes = await imagegen.list_vaes(CFG["comfyui_url"])
        if not (unets and clips and vaes):
            raise HTTPException(400, "No Wan2.1 model files available in ComfyUI")
        unet_name = unet_name or unets[0]
        clip_name = clip_name or clips[0]
        vae_name = vae_name or vaes[0]

    log.info("imagegen: video start user=%s image_to_video=%s frames=%s fps=%s",
             current_user["username"], bool(image_bytes), body.num_frames, body.fps)
    _IMAGEGEN_INFLIGHT.acquire(current_user["id"])

    async def gen():
        try:
            video_bytes = None
            async for kind, data in imagegen.generate_video_stream(
                    body.positive, body.negative, CFG["comfyui_url"],
                    unet_name, clip_name, vae_name, image_bytes=image_bytes,
                    fps=body.fps, num_frames=body.num_frames,
                    width=body.width, height=body.height, steps=body.steps, cfg=body.cfg):
                if kind == "done":
                    video_bytes = data
                    continue
                yield "data: " + json.dumps({"type": kind, "message": data}) + "\n\n"

            fname = f"vid_{uuid.uuid4().hex[:10]}.mp4"
            await _write_file(os.path.join(MEDIA_DIR, fname), video_bytes)
            url = f"/media/{fname}"
            saved = await standalone_image_repo.create(
                current_user["id"], url, body.positive, body.negative,
                is_explicit=True, media_type="video", source_image_id=body.image_id,
                fps=body.fps, frame_count=body.num_frames, duration_s=body.num_frames / body.fps)
            log.info("imagegen: video done user=%s id=%s", current_user["username"], saved["id"])
            yield "data: " + json.dumps({"type": "done", "video": saved}) + "\n\n"
        except Exception as e:
            log.warning("imagegen: video failed user=%s: %s", current_user["username"], e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_video_router.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add backend/routers/imagegen.py backend/tests/test_imagegen_video_router.py
git commit -m "Add POST /api/imagegen/video streaming endpoint"
```

---

### Task 13: Final regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests -v`
Expected: PASS (all tests, no regressions across the whole suite)

- [ ] **Step 2: Confirm the live app still starts cleanly**

Since this repo's live container auto-reloads on `.py` changes (`uvicorn --reload`), check the container picked up the changes without crashing:

Run: `podman logs --tail 50 story-game`
Expected: No traceback since the last file save; most recent log lines show a normal reload, not an import error.

- [ ] **Step 3: Hit the health endpoint to confirm the process is actually up**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health`
Expected: `401` (unauthenticated but the server responded — per CLAUDE.md, a 401 here means the server is up)
