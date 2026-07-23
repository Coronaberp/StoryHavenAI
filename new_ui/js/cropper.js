"use strict";

async function isAnimatedImageFile(file) {
  try {
    if (file.type === "image/gif") {
      const buf = new Uint8Array(await file.slice(0, 2_000_000).arrayBuffer());
      let frames = 0;
      for (let i = 0; i < buf.length - 2; i++) {
        if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
          frames++;
          if (frames > 1) return true;
        }
      }
      return false;
    }
    if (file.type === "image/webp") {
      const buf = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      let text = "";
      for (const b of buf) text += String.fromCharCode(b);
      return text.includes("ANIM");
    }
  } catch {
    return false;
  }
  return false;
}

function openCropper(file, aspect, outW, outH, onDone) {
  const objectUrl = URL.createObjectURL(file);
  const layer = openModal(`
    <h3>Crop image</h3>
    <div id="cropWrap" style="position:relative;width:100%;aspect-ratio:${aspect};border-radius:12px;overflow:hidden;background:var(--color-surface-2);touch-action:none;cursor:grab">
      <img id="cropImg" src="${objectUrl}" draggable="false" alt="" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);user-select:none;pointer-events:none;max-width:none;max-height:none">
    </div>
    <div style="margin-top:14px">
      <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">Zoom</label>
      <input type="range" id="cropZoom" min="1" max="3" step="0.01" value="1" style="width:100%">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button type="button" class="pe-gen-btn" id="cropCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">Cancel</button>
      <button type="button" class="pe-gen-btn" id="cropApply" disabled>Apply</button>
    </div>
  `);
  const wrap = layer.querySelector("#cropWrap");
  const img = layer.querySelector("#cropImg");
  const zoomEl = layer.querySelector("#cropZoom");
  const applyBtn = layer.querySelector("#cropApply");
  let scale = 1, tx = 0, ty = 0, natW = 0, natH = 0, baseScale = 1, drag = false, sx = 0, sy = 0, stx = 0, sty = 0, ready = false;

  const clampPan = () => {
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    const dw = natW * baseScale * scale, dh = natH * baseScale * scale;
    const maxX = Math.max(0, (dw - ww) / 2), maxY = Math.max(0, (dh - wh) / 2);
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  };
  const render = () => {
    clampPan();
    img.style.transform = `translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${scale})`;
  };
  const setup = () => {
    natW = img.naturalWidth;
    natH = img.naturalHeight;
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    baseScale = Math.max(ww / natW, wh / natH);
    img.style.width = `${natW * baseScale}px`;
    img.style.height = `${natH * baseScale}px`;
    render();
    ready = true;
    applyBtn.disabled = false;
  };
  if (img.complete && img.naturalWidth) setup(); else img.onload = setup;

  wrap.onpointerdown = (e) => { drag = true; wrap.setPointerCapture(e.pointerId); sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; wrap.style.cursor = "grabbing"; };
  wrap.onpointermove = (e) => { if (!drag) return; tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy); render(); };
  wrap.onpointerup = wrap.onpointercancel = () => { drag = false; wrap.style.cursor = "grab"; };
  zoomEl.oninput = () => { scale = parseFloat(zoomEl.value); render(); };

  const cleanup = () => URL.revokeObjectURL(objectUrl);
  layer.querySelector("#cropCancel").onclick = () => { cleanup(); closeModal(layer); };
  applyBtn.onclick = () => {
    if (!ready) return;
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    const dw = natW * baseScale * scale, dh = natH * baseScale * scale;
    const left = (ww - dw) / 2 + tx, top = (wh - dh) / 2 + ty;
    const srcScale = 1 / (baseScale * scale);
    const sxCrop = (0 - left) * srcScale, syCrop = (0 - top) * srcScale, swCrop = ww * srcScale, shCrop = wh * srcScale;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext("2d").drawImage(img, sxCrop, syCrop, swCrop, shCrop, 0, 0, outW, outH);
    canvas.toBlob((blob) => {
      cleanup();
      closeModal(layer);
      const reader = new FileReader();
      reader.onload = () => onDone(reader.result, blob);
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.92);
  };
}

async function maybeCropUpload(file, aspect, outW, outH, onDone) {
  if (await isAnimatedImageFile(file)) {
    const reader = new FileReader();
    reader.onload = () => onDone(reader.result, file);
    reader.readAsDataURL(file);
    return;
  }
  openCropper(file, aspect, outW, outH, onDone);
}

async function maybeCropUploadNativeAspect(file, maxDim, onDone) {
  if (await isAnimatedImageFile(file)) {
    const reader = new FileReader();
    reader.onload = () => onDone(reader.result, file);
    reader.readAsDataURL(file);
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const round8 = (v) => Math.max(8, Math.round((v * scale) / 8) * 8);
    const w = round8(img.naturalWidth);
    const h = round8(img.naturalHeight);
    openCropper(file, `${img.naturalWidth}/${img.naturalHeight}`, w, h, onDone);
  };
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    openCropper(file, "1/1", maxDim, maxDim, onDone);
  };
  img.src = objectUrl;
}

function loadImageNative(file, maxDim, onDone) {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const round8 = (v) => Math.max(8, Math.round((v * scale) / 8) * 8);
    const width = round8(img.naturalWidth);
    const height = round8(img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(objectUrl);
    onDone(canvas.toDataURL("image/png"), width, height);
  };
  img.src = objectUrl;
}

if (typeof window !== "undefined") {
  window.isAnimatedImageFile = isAnimatedImageFile;
  window.openCropper = openCropper;
  window.maybeCropUpload = maybeCropUpload;
  window.maybeCropUploadNativeAspect = maybeCropUploadNativeAspect;
  window.loadImageNative = loadImageNative;
}
