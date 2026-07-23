# Forge Inpainting + Video Frontend Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real backend calls into Forge's already-scaffolded Inpaint/Video modes (replacing "coming soon" stubs), and add video-aware (`<video>` vs `<img>`) rendering everywhere a standalone image/video can appear.

**Architecture:** Backend: drop `image_id`-based lookup from the inpaint/video endpoints in favor of raw image bytes only (matching every other Forge mode). Frontend: extend `ForgeView`'s existing `generate()`/`save()`/`buildBody()` with per-mode branches reusing the existing SSE (`sseEvents`) plumbing; add a small shared `mediaTagHtml()` helper for video-aware markup, used by Forge's preview/recent/My-Creations views and Pinacotheca's feed/detail views.

**Tech Stack:** FastAPI/Pydantic (backend), vanilla JS classes, no build step (frontend). Manual/live verification via the running `:3001` dev server (no JS test harness exists in this project) plus pytest for backend.

## Global Constraints

- Zero comments in code except where a genuinely non-obvious invariant needs explaining — match each file's existing comment density.
- `backend/` modules import siblings with absolute `from backend.x import y`, never bare `import x`.
- Every mutating endpoint gets `log.info` on success; every caught exception gets `log.warning`/`log.error` with detail.
- This repo IS the live app checkout — edit files directly, never use `EnterWorktree`/`git worktree`.
- This is a live, shared, multi-session checkout — stage only the exact files each task touches, by explicit path, never `git add -A`/`git add .`. Before committing, diff each staged file and confirm it contains only your own changes.
- Frontend: no build step, no new dependencies: keep to vanilla JS matching `new_ui/js/*.js`'s existing style (template-literal HTML, `_esc`/`_attr` escaping, `onclick="_activeForgeView.method()"` wiring).
- `new_ui/` changes are verified live against the human's already-running `./rebuild.sh --watch` dev server on `:3001` — do not spin up a second dev server instance.

---

### Task 1: Backend — drop `image_id`, require/accept raw `image` on inpaint + video schemas

**Files:**
- Modify: `backend/schemas.py` (`ImageGenInpaintIn` ~line 283, `ImageGenVideoIn` ~line 296)
- Test: `backend/tests/test_imagegen_inpaint_router.py`, `backend/tests/test_imagegen_video_router.py` (will be rewritten in Task 2/3, not this task — this task only touches schemas.py)

**Interfaces:**
- Produces: `ImageGenInpaintIn` with `image: str` (required, replaces `image_id: str`), everything else unchanged. `ImageGenVideoIn` with `image: str | None = None` (replaces `image_id: str | None = None`), everything else unchanged.

- [ ] **Step 1: Edit `ImageGenInpaintIn`**

In `backend/schemas.py`, replace:

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

with:

```python
class ImageGenInpaintIn(BaseModel):
    image: str   # data:image/...;base64,... — the source image to inpaint
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

- [ ] **Step 2: Edit `ImageGenVideoIn`**

Replace:

```python
class ImageGenVideoIn(BaseModel):
    image_id: str | None = None   # None = text-to-video; set = image-to-video
    positive: str = ""
```

with:

```python
class ImageGenVideoIn(BaseModel):
    image: str | None = None   # data:image/...;base64,... — None = text-to-video, set = image-to-video
    positive: str = ""
```

(everything else in the class is unchanged)

- [ ] **Step 3: Verify the module imports cleanly**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -c \"from backend.schemas import ImageGenInpaintIn, ImageGenVideoIn; print(ImageGenInpaintIn(image='data:image/png;base64,AA==', mask='data:image/png;base64,AA==')); print(ImageGenVideoIn())\""`
Expected: both models print with no error.

- [ ] **Step 4: Commit**

```bash
git add backend/schemas.py
git commit -m "Replace image_id with raw image bytes on ImageGenInpaintIn/ImageGenVideoIn"
```

---

### Task 2: Backend — `stream_inpaint_image` uses raw `image`, drops ownership lookup

**Files:**
- Modify: `backend/routers/imagegen.py` (`stream_inpaint_image`, currently lines ~273-315)
- Modify: `backend/tests/test_imagegen_inpaint_router.py` (rewrite entirely — the 404/403 ownership tests are moot)

**Interfaces:**
- Consumes: `ImageGenInpaintIn` (Task 1), `_decode_reference_image` (existing helper, unchanged), `imagegen.generate_inpaint_image_stream` (existing, unchanged signature).
- Produces: `POST /api/imagegen/inpaint` — same SSE `preview`/`done`/`error` shape as before, minus the `source_image_id` field on each event (there is no id anymore) and minus any 404/403 responses.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/tests/test_imagegen_inpaint_router.py` with:

```python
import pytest
from fastapi import HTTPException

from backend.routers.imagegen import stream_inpaint_image
from backend.schemas import ImageGenInpaintIn

pytestmark = pytest.mark.asyncio


async def test_inpaint_rejects_malformed_mask(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenInpaintIn(image="data:image/png;base64,AAAA", mask="not-a-data-url",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 400


async def test_inpaint_rejects_malformed_image(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenInpaintIn(image="not-a-data-url", mask="data:image/png;base64,AAAA",
                             positive="a cat", negative="")
    with pytest.raises(HTTPException) as exc_info:
        await stream_inpaint_image(body, current_user=user)
    assert exc_info.value.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_router.py -v"`
Expected: FAIL (current `stream_inpaint_image` still expects `body.image_id`, `ImageGenInpaintIn` no longer has that field — `AttributeError` or Pydantic validation error).

- [ ] **Step 3: Rewrite `stream_inpaint_image`**

In `backend/routers/imagegen.py`, replace the existing function body (from `@api.post("/imagegen/inpaint")` through the `return StreamingResponse(...)` line) with:

```python
@api.post("/imagegen/inpaint")
async def stream_inpaint_image(body: ImageGenInpaintIn, current_user: dict = Depends(get_current_user)):
    """Live-preview inpaint generation for a caller-supplied image — nothing
    persisted until /save, same shape as /imagegen/standalone/stream."""
    image_bytes = _decode_reference_image(body.image)
    if not image_bytes:
        raise HTTPException(400, "image is required")
    mask_bytes = _decode_reference_image(body.mask)
    if not mask_bytes:
        raise HTTPException(400, "mask is required")

    checkpoint = body.checkpoint or CFG["comfyui_checkpoint"]
    log.info("imagegen: inpaint start user=%s checkpoint=%s",
             current_user["username"], checkpoint)
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
                yield "data: " + json.dumps({"type": kind, "image": f"data:{mime};base64,{b64}"}) + "\n\n"
            log.info("imagegen: inpaint done user=%s", current_user["username"])
        except Exception as e:
            log.warning("imagegen: inpaint failed user=%s: %s", current_user["username"], e)
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        finally:
            _IMAGEGEN_INFLIGHT.release(current_user["id"])

    return StreamingResponse(gen(), media_type="text/event-stream")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_router.py -v"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routers/imagegen.py backend/tests/test_imagegen_inpaint_router.py
git commit -m "Drop image_id lookup from /imagegen/inpaint, use raw image bytes"
```

---

### Task 3: Backend — `save_inpaint_image` drops `source_image_id` requirement; `stream_video` uses raw `image`

**Files:**
- Modify: `backend/routers/imagegen.py` (`save_inpaint_image` ~lines 320-352, `stream_video` ~lines 358-420)
- Modify: `backend/tests/test_imagegen_inpaint_save_router.py`, `backend/tests/test_imagegen_video_router.py` (rewrite — ownership tests are moot)

**Interfaces:**
- Consumes: `ImageGenVideoIn` (Task 1, `image` field replaces `image_id`), `_decode_reference_image` (existing).
- Produces: `POST /api/imagegen/inpaint/save` no longer requires `source_image_id` at all (field stays supported on `ImageGenSaveIn`, purely optional, never validated). `POST /api/imagegen/video` decodes `body.image` directly instead of looking up `body.image_id`.

- [ ] **Step 1: Write the failing tests for `save_inpaint_image`**

Replace the full contents of `backend/tests/test_imagegen_inpaint_save_router.py` with:

```python
import base64

import pytest

from backend.routers.imagegen import save_inpaint_image
from backend.schemas import ImageGenSaveIn

pytestmark = pytest.mark.asyncio


def _tiny_png_b64():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


async def test_inpaint_save_creates_variant_without_source_id(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenSaveIn(image=f"data:image/png;base64,{_tiny_png_b64()}",
                          positive="a dog", negative="")

    saved = await save_inpaint_image(body, current_user=user)

    assert saved["source_image_id"] is None
    assert saved["media_type"] == "image"
    assert saved["is_img2img"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_save_router.py -v"`
Expected: FAIL (current `save_inpaint_image` raises 400 when `source_image_id` is missing).

- [ ] **Step 3: Rewrite `save_inpaint_image`**

In `backend/routers/imagegen.py`, replace the function body's opening ownership-check block:

```python
    if not body.source_image_id:
        raise HTTPException(400, "source_image_id is required")
    source = await standalone_image_repo.get(body.source_image_id)
    if not source or source["user_id"] != current_user["id"]:
        raise HTTPException(404, "source image not found")

    image_bytes = _decode_reference_image(body.image)
```

with:

```python
    image_bytes = _decode_reference_image(body.image)
```

(the rest of the function — `validate_image`, extension derivation, `_write_file`, `standalone_image_repo.create(..., source_image_id=body.source_image_id)`, the classify callbacks — is unchanged; `body.source_image_id` naturally stays `None` when the caller never sent it, since the field is already optional on `ImageGenSaveIn`)

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_inpaint_save_router.py -v"`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `stream_video`**

Replace the full contents of `backend/tests/test_imagegen_video_router.py` with:

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


async def test_video_rejects_zero_fps(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running", fps=0)
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 400


async def test_video_rejects_malformed_image(db_conn):
    user = {"id": "user-a", "username": "user-a", "is_admin": False}
    body = ImageGenVideoIn(positive="a dog running", image="not-a-data-url")
    with pytest.raises(HTTPException) as exc_info:
        await stream_video(body, current_user=user)
    assert exc_info.value.status_code == 400
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_video_router.py -v"`
Expected: FAIL (`stream_video` still references `body.image_id`).

- [ ] **Step 7: Rewrite `stream_video`'s image-loading block**

In `backend/routers/imagegen.py`, replace:

```python
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
```

with:

```python
    image_bytes = _decode_reference_image(body.image) if body.image else None
```

And replace the later `standalone_image_repo.create(...)` call's `source_image_id=body.image_id` argument with `source_image_id=None` (there is no id anymore — the field stays supported on the row schema, just always null for video since Forge never tracks one).

- [ ] **Step 8: Run tests to verify they pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_imagegen_video_router.py -v"`
Expected: PASS

- [ ] **Step 9: Run the full backend test suite to check for regressions**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests -v"`
Expected: PASS, no failures (some count growth from other concurrent sessions is fine and expected on this live shared repo).

- [ ] **Step 10: Commit**

```bash
git add backend/routers/imagegen.py backend/tests/test_imagegen_inpaint_save_router.py backend/tests/test_imagegen_video_router.py
git commit -m "Drop source_image_id requirement from inpaint save; use raw image bytes for video"
```

---

### Task 4: Frontend — shared `mediaTagHtml()` helper for video-aware markup

**Files:**
- Modify: `new_ui/js/profile-template.js` (add helper near existing `_esc`/`_attr`)

**Interfaces:**
- Produces: `function mediaTagHtml(rec, { style = "", className = "", controls = false, onclick = "" } = {}) -> string` — a global function (no ES modules in this project; every `new_ui/js/*.js` file is a flat `<script>`, so this is callable from any file loaded after `profile-template.js`, which every relevant file already is per `new_ui/index.html`'s script order). Returns a `<video>` tag when `rec.media_type === "video"`, otherwise an `<img>` tag. Both branches accept the same style/className/onclick so callers don't need to branch themselves.

- [ ] **Step 1: Add the helper**

In `new_ui/js/profile-template.js`, add after the existing `_attr` function:

```javascript
function mediaTagHtml(rec, { style = "", className = "", controls = false, onclick = "" } = {}) {
  const classAttr = className ? ` class="${_attr(className)}"` : "";
  const onclickAttr = onclick ? ` onclick="${_attr(onclick)}"` : "";
  if (rec.media_type === "video") {
    const src = `${_attr(rec.image)}#t=0.1`;
    return `<video src="${src}"${classAttr} style="${_attr(style)}"${onclickAttr} ${controls ? "controls" : ""} muted playsinline preload="metadata"></video>`;
  }
  return `<img src="${_attr(rec.image)}" alt=""${classAttr} style="${_attr(style)}"${onclickAttr}>`;
}
```

- [ ] **Step 2: Verify the file still loads with no syntax errors**

Since there's no JS test harness in this project, verify via the running dev server: open `http://localhost:3001` in a browser (or check via Playwright if available), open the browser console, and confirm no syntax error is logged from `profile-template.js`. A quick sanity check: `curl -s http://localhost:3001/js/profile-template.js | tail -20` should show the new function with no truncation.

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/profile-template.js
git commit -m "Add shared mediaTagHtml() helper for video-aware image/video rendering"
```

---

### Task 5: Frontend — Forge inpaint mask capture + real `/imagegen/inpaint` generate/save calls

**Files:**
- Modify: `new_ui/js/forge.js` (`buildBody()` ~line 1053, `generate()` ~line 1076, `save()` ~line 1175, `generateBarHtml()` ~line 1138)

**Interfaces:**
- Consumes: `mediaTagHtml` (Task 4, not used in this task directly but confirms load order), `sseEvents`/`api`/`toast`/`errorToast` (existing globals), `this._maskCtx`/`this.main.querySelector("#forgeMaskCanvas")` (existing mask-canvas state from `setupMaskCanvas()`).
- Produces: `buildMaskDataUrl(): string` — new method on `ForgeView`, returns a `data:image/png;base64,...` black/white mask. `generate()` and `save()` gain inpaint branches. Later tasks (6, 7) add the video branches to these same methods.

- [ ] **Step 1: Add `buildMaskDataUrl()`**

In `new_ui/js/forge.js`, add a new method right after `setupMaskCanvas()` (currently ends around line 660, right before `durationFpsHtml()`):

```javascript
  buildMaskDataUrl() {
    const canvas = this.main.querySelector("#forgeMaskCanvas");
    if (!canvas) return null;
    const src = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const outCtx = out.getContext("2d");
    const outData = outCtx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const painted = src.data[i + 3] > 0;
      const v = painted ? 255 : 0;
      outData.data[i] = v;
      outData.data[i + 1] = v;
      outData.data[i + 2] = v;
      outData.data[i + 3] = 255;
    }
    outCtx.putImageData(outData, 0, 0);
    return out.toDataURL("image/png");
  }
```

- [ ] **Step 2: Add the inpaint branch to `buildBody()`**

In `new_ui/js/forge.js`, replace the end of `buildBody()`:

```javascript
    if (this.mode === "image" && this.referenceImage) {
      body.reference_image = this.referenceImage;
      body.denoise = this.denoise;
    }
    return body;
  }
```

with:

```javascript
    if (this.mode === "image" && this.referenceImage) {
      body.reference_image = this.referenceImage;
      body.denoise = this.denoise;
    }
    if (this.mode === "inpaint") {
      return {
        image: this.referenceImage,
        mask: this.buildMaskDataUrl(),
        positive: this.positive,
        negative: this.negative,
        checkpoint: this.checkpoint || null,
        denoise: this.denoise,
        sampler: this.sampler || null,
        scheduler: this.scheduler || null,
        steps: this.steps,
        cfg: this.cfg,
      };
    }
    return body;
  }
```

- [ ] **Step 3: Rewrite `generate()` to dispatch by mode**

Replace the whole `generate(bodyOverride)` method with:

```javascript
  async generate(bodyOverride) {
    if (this.busy) return;
    if (!bodyOverride && this.mode === "video") return this.generateVideo();
    const body = bodyOverride || this.buildBody();
    if (this.mode === "inpaint" && !body.image) { toast("Add a reference image first."); return; }
    if (!body.positive.trim()) { toast("A prompt is required."); return; }
    const genToken = (this._genToken = (this._genToken || 0) + 1);
    this.busy = true;
    this.previewImage = "";
    this.lastResult = null;
    this.render();
    const endpoint = this.mode === "inpaint" ? "/api/imagegen/inpaint" : "/api/imagegen/standalone/stream";
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (genToken !== this._genToken) return;
        if (ev.type === "preview") {
          this.previewImage = ev.image;
          const img = this.main.querySelector("#forgePreviewBox img");
          if (img) img.src = ev.image;
          else this.render();
        } else if (ev.type === "done") {
          this.busy = false;
          this.lastResult = { image: ev.image, body, isImg2img: this.mode === "inpaint" || !!body.reference_image };
          this.render();
        } else if (ev.type === "error") {
          this.busy = false;
          errorToast(ev.message || "Generation failed.");
          this.render();
        }
      });
    } catch (err) {
      if (genToken !== this._genToken) return;
      this.busy = false;
      errorToast(err.message || "Generation failed.");
      this.render();
    }
  }
```

(`generateVideo()` is added in Task 6 — calling it here is forward-referenced but harmless since it's defined on the same class before this method is ever invoked in the browser)

- [ ] **Step 4: Add the inpaint branch to `save()`**

Replace the start of `save()`:

```javascript
  async save() {
    if (!this.lastResult) return;
    const b = this.lastResult.body || {};
    try {
      const rec = await api("/api/imagegen/standalone/save", {
```

with:

```javascript
  async save() {
    if (!this.lastResult) return;
    const b = this.lastResult.body || {};
    const saveEndpoint = this.mode === "inpaint" ? "/api/imagegen/inpaint/save" : "/api/imagegen/standalone/save";
    try {
      const rec = await api(saveEndpoint, {
```

(the rest of `save()`'s body — the request payload and success handling — is unchanged; `ImageGenSaveIn`'s fields already match what's sent for every mode, and `source_image_id` is simply never included, which Task 3 made optional)

- [ ] **Step 5: Remove the inpaint "coming soon" stub from `generateBarHtml()`**

Replace:

```javascript
    if (this.mode === "inpaint" || this.mode === "video") {
      const label = this.mode === "video" ? "Video" : "Inpaint";
      return `
        <div class="${wrapClass}" style="${wrapStyle}">
          <button type="button" class="forge-generate-btn" disabled title="${label} generation isn't available yet" style="opacity:.6;cursor:not-allowed">
            ${label} (coming soon)
          </button>
        </div>
      `;
    }
```

with nothing (delete this block entirely) — both `inpaint` and `video` now fall through to the generic real Generate/Cancel button below it. (Task 6 verifies the `video` case specifically once `generateVideo()`/`cancelGenerate()` are confirmed to handle it.)

- [ ] **Step 6: Live-verify the inpaint flow**

Using the human's already-running `./rebuild.sh --watch` dev server on `:3001`:
1. Open `http://localhost:3001`, log in, navigate to My Forge.
2. Switch to Inpaint mode, add a reference image (upload or from My Creations).
3. Paint a mask stroke over part of the image.
4. Enter a prompt, tap Generate.
5. Confirm: preview frames stream in during generation, a final result appears, "Save" persists it via `/api/imagegen/inpaint/save` (check network tab or the resulting toast).

Report the outcome in your task report — if ComfyUI itself isn't reachable/configured for a full round trip, note that explicitly (this is expected in some environments) but confirm the request body sent to `/api/imagegen/inpaint` is well-formed (correct `image`/`mask` data URLs, no `image_id` field) via the browser's network tab.

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/forge.js
git commit -m "Wire real /imagegen/inpaint generate and /imagegen/inpaint/save calls into Forge"
```

---

### Task 6: Frontend — Forge video generate/persist + resolution rescaling

**Files:**
- Modify: `new_ui/js/forge.js` (add `generateVideo()`, `videoDimensions()`, extend `durationFpsHtml()` state usage — no HTML changes needed there since `this.duration`/`this.fps` already exist)

**Interfaces:**
- Consumes: `FORGE_ASPECTS` (existing constant, line 7), `sseEvents`/`toast`/`errorToast` (existing globals).
- Produces: `videoDimensions(): [number, number]` and `async generateVideo()` on `ForgeView`. `generate()` (Task 5) already dispatches to this for `mode === "video"`.

- [ ] **Step 1: Add `videoDimensions()`**

In `new_ui/js/forge.js`, add a new method right after `buildBody()`:

```javascript
  videoDimensions() {
    const [w, h] = FORGE_ASPECTS[this.aspect];
    const targetPixels = 832 * 480;
    const scale = Math.sqrt(targetPixels / (w * h));
    const round8 = (v) => Math.max(8, Math.round((v * scale) / 8) * 8);
    return [round8(w), round8(h)];
  }
```

- [ ] **Step 2: Add `generateVideo()`**

Add a new method right after `generate()` (before `cancelGenerate()`):

```javascript
  async generateVideo() {
    if (!this.positive.trim()) { toast("A prompt is required."); return; }
    const [width, height] = this.videoDimensions();
    const numFrames = Math.min(120, Math.max(8, parseInt(this.duration) * this.fps));
    const body = {
      positive: this.positive,
      negative: this.negative,
      image: this.referenceImage || undefined,
      fps: this.fps,
      num_frames: numFrames,
      width,
      height,
      steps: this.steps,
      cfg: this.cfg,
    };
    const genToken = (this._genToken = (this._genToken || 0) + 1);
    this.busy = true;
    this.genStatus = "Starting…";
    this.lastResult = null;
    this.render();
    try {
      const res = await fetch(`${API}/api/imagegen/video`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (genToken !== this._genToken) return;
        if (ev.type === "status") {
          this.genStatus = ev.message;
          const el = this.main.querySelector("#forgeVideoStatus");
          if (el) el.textContent = ev.message;
          else this.render();
        } else if (ev.type === "done") {
          this.busy = false;
          this.lastResult = { image: ev.video.image, mediaType: "video", body, savedId: ev.video.id, isPublic: !!ev.video.is_public };
          this.render();
        } else if (ev.type === "error") {
          this.busy = false;
          errorToast(ev.message || "Video generation failed.");
          this.render();
        }
      });
    } catch (err) {
      if (genToken !== this._genToken) return;
      this.busy = false;
      errorToast(err.message || "Video generation failed.");
      this.render();
    }
  }
```

- [ ] **Step 3: Show generation status text in the preview box for video**

In `previewBoxHtml()`, replace the first branch:

```javascript
    if (this.busy && this.previewImage) {
      inner = `
        <img src="${this.previewImage}" style="width:100%;height:100%;object-fit:cover" alt="">
        <span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">Generating…</span>
      `;
    } else if (this.lastResult) {
```

with:

```javascript
    if (this.busy && this.mode === "video") {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="font-size:13.5px;color:var(--color-sec)">Generating your video…</div>
          <div id="forgeVideoStatus" style="font-family:var(--font-mono);font-size:11.5px;margin-top:8px;color:var(--color-accent)">${_esc(this.genStatus || "")}</div>
        </div>
      `;
    } else if (this.busy && this.previewImage) {
      inner = `
        <img src="${this.previewImage}" style="width:100%;height:100%;object-fit:cover" alt="">
        <span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">Generating…</span>
      `;
    } else if (this.lastResult) {
```

- [ ] **Step 4: Render `<video>` instead of `<img>` for a completed video result**

Still in `previewBoxHtml()`, replace the `else if (this.lastResult)` branch's opening `<img>` line:

```javascript
    } else if (this.lastResult) {
      inner = `
        <img src="${this.lastResult.image}" style="width:100%;height:100%;object-fit:cover;cursor:pointer" onclick="_activeForgeView.openResultZoom()" alt="">
```

with:

```javascript
    } else if (this.lastResult) {
      const resultTag = this.lastResult.mediaType === "video"
        ? `<video src="${_attr(this.lastResult.image)}" style="width:100%;height:100%;object-fit:cover" controls muted playsinline></video>`
        : `<img src="${this.lastResult.image}" style="width:100%;height:100%;object-fit:cover;cursor:pointer" onclick="_activeForgeView.openResultZoom()" alt="">`;
      inner = `
        ${resultTag}
```

And below that, the "Upscale"/"Regenerate" action buttons still make sense for video results EXCEPT Upscale (a video can't be upscaled by the existing image-upscale flow) — remove that one button when the result is a video. Find:

```javascript
          <button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.openUpscale()" title="Upscale"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></button>
```

and wrap it in a conditional (this line is inside a template literal, so use a ternary evaluated just above the `inner = \`` block for the result branch):

```javascript
      const upscaleBtn = this.lastResult.mediaType === "video" ? "" : `<button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.openUpscale()" title="Upscale"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></button>`;
```

placed right after the `resultTag` declaration, and reference `${upscaleBtn}` in place of the removed inline button markup inside the `inner` template literal.

- [ ] **Step 5: Video results are already saved — skip the redundant Save button/step**

In the same result-branch action-buttons block, the "Save" button (`onclick="event.stopPropagation();_activeForgeView.save()"`) should not appear for video results, since `generateVideo()`'s `done` handler already sets `savedId`/`isPublic` directly (video persists server-side inline, no separate save call exists for it). Wrap that button the same way as the upscale button:

```javascript
      const saveBtn = this.lastResult.mediaType === "video" ? "" : `<button type="button" class="forge-img-act" onclick="event.stopPropagation();_activeForgeView.save()" title="Save"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg></button>`;
```

and reference `${saveBtn}` in place of that inline button, right after `${upscaleBtn}`.

- [ ] **Step 6: Add `genStatus` to the constructor's initial state**

In the `constructor()`, add near the other mode-related fields (right after `this.fps = 24;`):

```javascript
    this.genStatus = "";
```

- [ ] **Step 7: Live-verify the video flow**

Using the human's already-running `./rebuild.sh --watch` dev server on `:3001`:
1. Switch to Video mode, optionally add a source image.
2. Set duration/fps, enter a prompt, tap Generate.
3. Confirm: status text updates during generation (`#forgeVideoStatus`), a `<video controls>` element appears on `done`, no separate Save button is shown (already-saved), Share/Unshare still works via `toggleSavedShare()` (uses `this.lastResult.savedId`, unaffected by this task).

Report the outcome, including a note if a full ComfyUI round trip isn't reachable in this environment (verify the request body/SSE handling logic is correct even if the generation itself can't complete end-to-end).

- [ ] **Step 8: Commit**

```bash
git add new_ui/js/forge.js
git commit -m "Wire real /imagegen/video generate calls into Forge, render video results"
```

---

### Task 7: Frontend — video-aware thumbnails in Forge (Recent, My Creations)

**Files:**
- Modify: `new_ui/js/forge.js` (`recentStripHtml()`, `recentColumnHtml()`, `renderMyCreationsGrid()`, `viewRecent()`)

**Interfaces:**
- Consumes: `mediaTagHtml` (Task 4).
- Produces: video-aware thumbnails in all three grids; `viewRecent()` correctly restores a video result (not just image fields) when re-opening a saved video from Recent.

- [ ] **Step 1: Update `recentStripHtml()`**

Replace:

```javascript
          ${this.recent.map((r) => `
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="flex:none;width:84px;height:84px;border-radius:12px;border:1px solid var(--color-line);overflow:hidden;padding:0;cursor:pointer;background:var(--color-surface-2)">
              <img src="${r.image}" style="width:100%;height:100%;object-fit:cover" alt="">
            </button>
          `).join("")}
```

with:

```javascript
          ${this.recent.map((r) => `
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="flex:none;width:84px;height:84px;border-radius:12px;border:1px solid var(--color-line);overflow:hidden;padding:0;cursor:pointer;background:var(--color-surface-2)">
              ${mediaTagHtml(r, { style: "width:100%;height:100%;object-fit:cover" })}
            </button>
          `).join("")}
```

- [ ] **Step 2: Update `recentColumnHtml()`**

Same substitution — replace:

```javascript
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="position:relative;width:100%;aspect-ratio:3/4;border-radius:10px;overflow:hidden;border:1px solid var(--color-line);padding:0;cursor:pointer;background:var(--color-surface-2)">
              <img src="${r.image}" style="width:100%;height:100%;object-fit:cover;display:block" alt="">
            </button>
```

with:

```javascript
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="position:relative;width:100%;aspect-ratio:3/4;border-radius:10px;overflow:hidden;border:1px solid var(--color-line);padding:0;cursor:pointer;background:var(--color-surface-2)">
              ${mediaTagHtml(r, { style: "width:100%;height:100%;object-fit:cover;display:block" })}
            </button>
```

- [ ] **Step 3: Update `renderMyCreationsGrid()`**

Replace:

```javascript
            <div style="aspect-ratio:1;overflow:hidden;cursor:pointer" data-creation-view="${_attr(img.id)}">
              <img src="${_attr(img.image)}" style="width:100%;height:100%;object-fit:cover${censored ? ";filter:blur(16px) saturate(60%)" : ""}" alt="">
            </div>
```

with:

```javascript
            <div style="aspect-ratio:1;overflow:hidden;cursor:pointer" data-creation-view="${_attr(img.id)}">
              ${mediaTagHtml(img, { style: `width:100%;height:100%;object-fit:cover${censored ? ";filter:blur(16px) saturate(60%)" : ""}` })}
            </div>
```

- [ ] **Step 4: Fix `viewRecent()` for a saved video**

`viewRecent()` currently always sets `this.lastResult = { image: rec.image, body, isImg2img: !!rec.is_img2img }` — for a video record this loses `mediaType`/`savedId`, which the preview box (Task 6) needs to render a `<video>` and skip the Save/Upscale buttons. Replace:

```javascript
    this.lastResult = { image: rec.image, body, isImg2img: !!rec.is_img2img };
    this.render();
  }
```

with:

```javascript
    this.lastResult = rec.media_type === "video"
      ? { image: rec.image, mediaType: "video", body, savedId: rec.id, isPublic: !!rec.is_public }
      : { image: rec.image, body, isImg2img: !!rec.is_img2img, savedId: rec.id, isPublic: !!rec.is_public };
    this.render();
  }
```

- [ ] **Step 5: Live-verify**

Generate and save (or generate a video, which auto-saves), confirm it shows up correctly as a poster-framed video tile in Recent and My Creations, and clicking it in Recent restores a working `<video controls>` in the preview box, not a broken `<img>`.

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/forge.js
git commit -m "Render video thumbnails in Forge Recent/My Creations via mediaTagHtml"
```

---

### Task 8: Frontend — video-aware rendering in Pinacotheca (community feed + detail modal)

**Files:**
- Modify: `new_ui/js/pinacotheca.js` (`frameHtml()`, `placardHtml()`, `detailHtml()`, `wireDetail()`)

**Interfaces:**
- Consumes: `mediaTagHtml` (Task 4).
- Produces: video-aware feed thumbnails and detail-modal playback; placard shows Duration/FPS for videos; `_wireZoomPan`/`use-reference`/`studio` actions are skipped for video items.

- [ ] **Step 1: Update `frameHtml()`**

Replace:

```javascript
        <img src="${_esc(img.image)}" alt="" ${img.is_explicit ? 'data-explicit="1"' : ""}
          ${blur ? 'style="filter:blur(16px) saturate(60%)"' : ""}>
```

with:

```javascript
        ${mediaTagHtml(img, { style: blur ? "filter:blur(16px) saturate(60%)" : "" })}
```

(the surrounding `data-explicit="1"` attribute was only used for CSS targeting of the blur — since `mediaTagHtml` already receives the blur style directly via the `style` option, this attribute is no longer needed; verify nothing else in this file's CSS selects on `[data-explicit]` before removing it — check `new_ui/css/*.css` for `data-explicit` usage first, and if it IS used elsewhere for something beyond the inline blur already covered by the `style` option, keep passing it through a new `mediaTagHtml` option instead of dropping it silently)

- [ ] **Step 2: Update `placardHtml()`**

Replace:

```javascript
  placardHtml(img) {
    const rows = [
      ["Model", img.checkpoint],
      ["Type", img.is_img2img ? "img2img" : "txt2img"],
      ["Sampler", img.sampler],
      ["Scheduler", img.scheduler],
      ["Steps", img.steps],
      ["CFG", img.cfg],
      ["Upscaled", img.upscaler],
    ].filter(([, v]) => v);
```

with:

```javascript
  placardHtml(img) {
    const rows = img.media_type === "video" ? [
      ["Duration", img.fps ? `${(img.frame_count / img.fps).toFixed(1)}s` : null],
      ["Frame rate", img.fps ? `${img.fps} fps` : null],
    ].filter(([, v]) => v) : [
      ["Model", img.checkpoint],
      ["Type", img.is_img2img ? "img2img" : "txt2img"],
      ["Sampler", img.sampler],
      ["Scheduler", img.scheduler],
      ["Steps", img.steps],
      ["CFG", img.cfg],
      ["Upscaled", img.upscaler],
    ].filter(([, v]) => v);
```

- [ ] **Step 3: Update `detailHtml()`**

Replace the detail image line:

```javascript
          <img src="${_esc(img.image)}" alt="" ${censored ? 'data-censored="1" style="filter:blur(24px) saturate(60%)"' : ""}>
```

with:

```javascript
          ${mediaTagHtml(img, { style: censored ? "filter:blur(24px) saturate(60%)" : "", controls: img.media_type === "video" })}
```

(this drops `data-censored="1"` the same way `frameHtml` drops `data-explicit="1"` — check the reveal-button click handler in `wireDetail()`, which currently does `revealImg.removeAttribute("data-censored"); revealImg.style.filter = "";` — that still works fine since `removeAttribute` on a non-existent attribute is a harmless no-op, but the `style.filter = ""` line is what actually matters and is untouched)

Also hide the "Use as reference image" (`data-act='use-reference'`) and "Send to Studio" (`data-act='studio'`) icon buttons for video items, since a video can't be used as an image reference. Find:

```javascript
            ${context === "forge" ? `
              <button type="button" class="ig-icon-btn" data-act="use-reference" data-tooltip="Use as reference image" aria-label="Use as reference image">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-9.5 9.5a1.5 1.5 0 0 1-2.1-2.1L13 6.9M17.8 6.2L19 5"/></svg>
              </button>
            ` : ME ? `
              <button type="button" class="ig-icon-btn" data-act="studio" data-tooltip="Send to Studio" aria-label="Send to Studio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-9.5 9.5a1.5 1.5 0 0 1-2.1-2.1L13 6.9M17.8 6.2L19 5"/></svg>
              </button>
            ` : ""}
```

and wrap the whole ternary in an outer `img.media_type === "video" ? "" : (...)`:

```javascript
            ${img.media_type === "video" ? "" : (context === "forge" ? `
              <button type="button" class="ig-icon-btn" data-act="use-reference" data-tooltip="Use as reference image" aria-label="Use as reference image">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-9.5 9.5a1.5 1.5 0 0 1-2.1-2.1L13 6.9M17.8 6.2L19 5"/></svg>
              </button>
            ` : ME ? `
              <button type="button" class="ig-icon-btn" data-act="studio" data-tooltip="Send to Studio" aria-label="Send to Studio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-9.5 9.5a1.5 1.5 0 0 1-2.1-2.1L13 6.9M17.8 6.2L19 5"/></svg>
              </button>
            ` : "")}
```

- [ ] **Step 4: Skip `_wireZoomPan` for video in `wireDetail()`**

Replace:

```javascript
  wireDetail(container, img, { onNavigate } = {}) {
    this.loadDetailComments(container, img);
    _wireZoomPan(container.querySelector(".ig-detail-img img"));
```

with:

```javascript
  wireDetail(container, img, { onNavigate } = {}) {
    this.loadDetailComments(container, img);
    if (img.media_type !== "video") _wireZoomPan(container.querySelector(".ig-detail-img img"));
```

- [ ] **Step 5: Confirm `downloadImage()` works unchanged for video**

Read `downloadImage()` (currently ~line 396) — it almost certainly does a generic `fetch(img.image).then(blob) → anchor download`, which works identically for an mp4 URL as for a png URL. Confirm this by reading the actual function body; if it does anything image-specific (e.g. assumes a `.png` extension in the downloaded filename), adjust the filename extension based on `img.media_type` (`.mp4` for video) — otherwise leave it unchanged.

- [ ] **Step 6: Live-verify**

Using the running `:3001` dev server: open Pinacotheca's community feed, confirm any video entries show a poster-framed tile (not a broken image icon), open one in the detail modal, confirm real `<video controls>` playback, correct Duration/FPS placard rows, and no "Use as reference"/"Send to Studio" icons.

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/pinacotheca.js
git commit -m "Render videos correctly in Pinacotheca feed and detail modal"
```

---

### Task 9: Final regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the entire backend test suite**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && venv/bin/python3 -m pytest backend/tests -v"`
Expected: all pass, no regressions (count may be higher than any specific number quoted earlier due to concurrent sessions — any failure or a lower pass count than previously observed is not acceptable).

- [ ] **Step 2: Confirm the live backend container is healthy**

Run: `podman logs --tail 30 story-game` — expect no fresh tracebacks since these changes landed.
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3003/api/health` — expect `401` (server responding, unauthenticated).

- [ ] **Step 3: Full live click-through on `:3001`**

Using the human's already-running dev server: run through the entire Forge flow end-to-end once more — Image mode (regression check, unaffected by this plan but confirm nothing broke), Inpaint mode (mask paint → generate → save), Video mode (generate → auto-save → share toggle), then check the result appears correctly in My Creations, Recent, and (if shared) the Pinacotheca community feed.
