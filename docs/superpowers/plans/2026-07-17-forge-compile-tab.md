# Forge Compile Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th Forge mode, "Compile", that lets a user combine several images (uploaded locally, or picked from their own My Creations gallery or the public Pinacotheca feed) into either an animated GIF or a single vertical strip PNG — entirely client-side, downloaded directly, never saved to the server.

**Architecture:** A new `ForgeCompilePanel` class (real per-instance state: the ordered image list, output-type, GIF/strip settings) is instantiated by `ForgeView` and owns its own render/wire/compile logic, keeping `forge.js` from growing further. GIF encoding uses a vendored, dependency-free, synchronous median-cut + LZW encoder (`new_ui/js/vendor/gif-encoder.js`). Vertical-strip compositing uses a plain `<canvas>`.

**Tech Stack:** Vanilla JS (no framework, no build step), existing `new_ui/` component patterns (`filter-chip`, `card-grid`, `pe-gen-btn`, `openModal`), existing `GET /api/imagegen/standalone` (My Creations) and `GET /api/imagegen/community` (Pinacotheca) endpoints — no backend changes.

## Global Constraints

- Zero comments in any file — code must be self-documenting (per CLAUDE.md coding style).
- Never indent more than 3 levels deep; return early instead of nesting.
- No build step for `new_ui/js/*.js` — files are served as-is with `Cache-Control: no-cache`; verify by curling `https://storyhavenai.sillysillysupersillydomain.win/js/<file>` (plain `localhost:3000` is not reachable from this shell).
- This app has no JS test framework — verification is manual/browser-driven per file, using account `claude`/admin or `test`/user (per CLAUDE.md — never create new accounts).
- New files must be added to `new_ui/index.html`'s script list (`<script src="/js/..." defer></script>`) in the same style as existing entries, positioned before `forge.js` (line ~295) so both are defined before any view is constructed.
- No new backend endpoints, no DB writes — this feature only reads two existing endpoints.

---

## Task 1: Vendor GIF encoder module

**Files:**
- Create: `new_ui/js/vendor/gif-encoder.js`
- Modify: `new_ui/index.html:295` (add script tag before the `forge.js` line)

**Interfaces:**
- Produces: `window.GifEncoder.encode({ width, height, frames, delayMs, loop, boomerang })` → `Uint8Array` of a valid GIF89a file. `frames` is an array of `ImageData` objects, all the same `width`/`height` passed in. `delayMs` is a number (ms per frame, converted internally to GIF centiseconds). `loop`/`boomerang` are booleans.

- [ ] **Step 1: Create the vendor directory and encoder file**

Create `new_ui/js/vendor/gif-encoder.js`:

```js
"use strict";

(function () {
  function channelRange(box) {
    let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
    for (const [r, g, b] of box) {
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (g < minG) minG = g; if (g > maxG) maxG = g;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
    const rangeR = maxR - minR, rangeG = maxG - minG, rangeB = maxB - minB;
    if (rangeR >= rangeG && rangeR >= rangeB) return { channel: 0, size: rangeR };
    if (rangeG >= rangeB) return { channel: 1, size: rangeG };
    return { channel: 2, size: rangeB };
  }

  function averageColor(box) {
    let r = 0, g = 0, b = 0;
    for (const px of box) { r += px[0]; g += px[1]; b += px[2]; }
    const n = box.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function buildPalette(sampleRgb, maxColors) {
    let boxes = [sampleRgb.slice()];
    while (boxes.length < maxColors) {
      let boxIdx = -1, boxRange = -1;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        const range = channelRange(boxes[i]);
        if (range.size > boxRange) { boxRange = range.size; boxIdx = i; }
      }
      if (boxIdx === -1) break;
      const box = boxes[boxIdx];
      const range = channelRange(box);
      box.sort((a, b) => a[range.channel] - b[range.channel]);
      const mid = Math.floor(box.length / 2);
      boxes.splice(boxIdx, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.filter((b) => b.length).map(averageColor);
  }

  function nearestIndex(r, g, b, palette) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  }

  function indexFrame(imageData, palette) {
    const { data, width, height } = imageData;
    const indices = new Uint8Array(width * height);
    const cache = new Map();
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = (r << 16) | (g << 8) | b;
      let idx = cache.get(key);
      if (idx === undefined) { idx = nearestIndex(r, g, b, palette); cache.set(key, idx); }
      indices[p] = idx;
    }
    return indices;
  }

  class ByteWriter {
    constructor() { this.bytes = []; }
    writeByte(b) { this.bytes.push(b & 0xff); }
    writeBytes(arr) { for (const b of arr) this.writeByte(b); }
    writeShort(n) { this.writeByte(n & 0xff); this.writeByte((n >> 8) & 0xff); }
    writeString(s) { for (let i = 0; i < s.length; i++) this.writeByte(s.charCodeAt(i)); }
    toUint8Array() { return new Uint8Array(this.bytes); }
  }

  function lzwEncode(indices, minCodeSize, writer) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize, nextCode, dict;
    const resetDict = () => {
      dict = new Map();
      for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    };
    resetDict();
    let bitBuffer = 0, bitCount = 0;
    const block = [];
    const emit = (code) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        block.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
        if (block.length === 255) { writer.writeByte(255); writer.writeBytes(block); block.length = 0; }
      }
    };
    emit(clearCode);
    let w = String(indices[0]);
    for (let i = 1; i < indices.length; i++) {
      const k = String(indices[i]);
      const wk = w + "," + k;
      if (dict.has(wk)) {
        w = wk;
      } else {
        emit(dict.get(w));
        if (nextCode < 4096) {
          dict.set(wk, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          emit(clearCode);
          resetDict();
        }
        w = k;
      }
    }
    emit(dict.get(w));
    emit(eoiCode);
    if (bitCount > 0) block.push(bitBuffer & 0xff);
    while (block.length) {
      const chunk = block.splice(0, 255);
      writer.writeByte(chunk.length);
      writer.writeBytes(chunk);
    }
    writer.writeByte(0);
  }

  function encodeGif({ width, height, frames, delayMs, loop, boomerang }) {
    let frameList = frames.slice();
    if (boomerang && frameList.length > 2) {
      frameList = frameList.concat(frameList.slice(1, -1).reverse());
    }
    const sample = [];
    const totalPixels = width * height * frameList.length;
    const sampleStep = Math.max(1, Math.floor(totalPixels / 20000));
    let counter = 0;
    for (const frame of frameList) {
      const { data } = frame;
      for (let i = 0; i < data.length; i += 4) {
        if (counter++ % sampleStep === 0) sample.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
    let palette = buildPalette(sample, 256);
    if (palette.length < 1) palette = [[0, 0, 0]];
    const bitsPerPixel = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))));
    const tableSize = 1 << bitsPerPixel;
    while (palette.length < tableSize) palette.push([0, 0, 0]);

    const writer = new ByteWriter();
    writer.writeString("GIF89a");
    writer.writeShort(width);
    writer.writeShort(height);
    writer.writeByte(0x80 | ((bitsPerPixel - 1) << 4) | (bitsPerPixel - 1));
    writer.writeByte(0);
    writer.writeByte(0);
    for (const [r, g, b] of palette) writer.writeBytes([r, g, b]);

    writer.writeBytes([0x21, 0xff, 0x0b]);
    writer.writeString("NETSCAPE2.0");
    writer.writeByte(3);
    writer.writeByte(1);
    writer.writeShort(loop ? 0 : 1);
    writer.writeByte(0);

    const delayCs = Math.max(1, Math.round(delayMs / 10));
    for (const frame of frameList) {
      const indices = indexFrame(frame, palette);
      writer.writeBytes([0x21, 0xf9, 4, 0x04]);
      writer.writeShort(delayCs);
      writer.writeByte(0);
      writer.writeByte(0);
      writer.writeByte(0x2c);
      writer.writeShort(0);
      writer.writeShort(0);
      writer.writeShort(width);
      writer.writeShort(height);
      writer.writeByte(0);
      writer.writeByte(bitsPerPixel);
      lzwEncode(indices, bitsPerPixel, writer);
    }
    writer.writeByte(0x3b);
    return writer.toUint8Array();
  }

  window.GifEncoder = { encode: encodeGif };
})();
```

- [ ] **Step 2: Register the script in index.html**

In `new_ui/index.html`, find line 295 (`<script src="/js/forge.js" defer></script>`) and insert immediately before it:

```html
  <script src="/js/vendor/gif-encoder.js" defer></script>
```

- [ ] **Step 3: Verify the file is served correctly**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/vendor/gif-encoder.js | tail -5`
Expected: the last 5 lines include `window.GifEncoder = { encode: encodeGif };` and `})();` — confirms the file is served and not 404.

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/ | grep gif-encoder`
Expected: one line containing `<script src="/js/vendor/gif-encoder.js" defer></script>`.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/vendor/gif-encoder.js new_ui/index.html
git commit -m "Vendor a dependency-free GIF encoder for Forge Compile"
```

---

## Task 2: ForgeCompilePanel scaffold — item list + three sources + Compile mode wiring

**Files:**
- Create: `new_ui/js/forge-compile.js`
- Modify: `new_ui/index.html:295` (add script tag before `forge.js`, after the gif-encoder tag added in Task 1)
- Modify: `new_ui/js/forge.js:72-113` (constructor — instantiate `this.compile`)
- Modify: `new_ui/js/forge.js:161-185` (`segChip`/`modeArchRowHtml` — add the Compile chip)
- Modify: `new_ui/js/forge.js:1632-1660` (`render()` — branch to the compile panel when `this.mode === "compile"`)

**Interfaces:**
- Consumes: global `api`, `openModal`, `closeModal`, `toast`, `errorToast`, `_esc`, `_attr`, `mediaTagHtml` (all already global via earlier-loaded scripts); `ForgeView` instance passed into the constructor (needs `.main` and `.render()`).
- Produces: `class ForgeCompilePanel` with `constructor(forgeView)`, `.html()` (returns markup string), `.wire()` (attaches DOM listeners, call after the markup is in the DOM), `.items` (array of `{ id, src }`), `.addItems(records)` where `records` is `[{ src }]`.

- [ ] **Step 1: Create the panel scaffold**

Create `new_ui/js/forge-compile.js`:

```js
"use strict";

class ForgeCompilePanel {
  constructor(forgeView) {
    this.forgeView = forgeView;
    this.items = [];
    this.outputType = "gif";
    this.gifDelay = 500;
    this.gifLoop = true;
    this.gifBoomerang = false;
    this.stripGap = 0;
    this.busy = false;
    this.resultUrl = null;
    this.resultFilename = "";
  }

  addItems(records) {
    for (const r of records) {
      this.items.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, src: r.src });
    }
    this.forgeView.render();
  }

  addFilesFromInput(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsDataURL(file);
    }))).then((dataUrls) => {
      this.addItems(dataUrls.map((src) => ({ src })));
    }).catch((err) => errorToast(err.message || "Couldn't add those files."));
  }

  async openSourcePicker(kind) {
    const endpoint = kind === "creations" ? "/api/imagegen/standalone" : "/api/imagegen/community";
    const title = kind === "creations" ? "My Creations" : "Pinacotheca";
    const layer = openModal(`<h3>${_esc(title)}</h3><div id="compilePickerGrid" style="margin-top:10px"><p style="font-size:13px;color:var(--color-sec)">Loading…</p></div>`, { wide: true });
    let records;
    try {
      records = (await api(endpoint)).filter((r) => r.media_type !== "video");
    } catch (err) {
      layer.querySelector("#compilePickerGrid").innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${_esc(err.message || "Couldn't load images.")}</p>`;
      return;
    }
    const selected = new Set();
    const grid = layer.querySelector("#compilePickerGrid");
    const renderGrid = () => {
      if (!records.length) {
        grid.innerHTML = `<p style="font-size:13px;color:var(--color-sec)">Nothing here yet.</p>`;
        return;
      }
      grid.innerHTML = `
        <div class="card-grid">
          ${records.map((rec) => `
            <button type="button" data-pick-id="${_attr(rec.id)}" style="position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;border:2px solid ${selected.has(rec.id) ? "var(--color-accent)" : "var(--color-line)"};background:var(--color-surface-2);padding:0;cursor:pointer">
              ${mediaTagHtml(rec, { style: "width:100%;height:100%;object-fit:cover" })}
              ${selected.has(rec.id) ? `<span style="position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:999px;background:var(--color-accent);color:#fff;display:grid;place-items:center;font-size:12px">&check;</span>` : ""}
            </button>
          `).join("")}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button type="button" class="pe-gen-btn" id="compilePickerConfirm">Add ${selected.size} selected</button>
        </div>
      `;
      grid.querySelectorAll("[data-pick-id]").forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.pickId;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          renderGrid();
        };
      });
      grid.querySelector("#compilePickerConfirm").onclick = () => {
        const chosen = records.filter((rec) => selected.has(rec.id));
        this.addItems(chosen.map((rec) => ({ src: rec.image })));
        closeModal(layer);
      };
    };
    renderGrid();
  }

  moveItem(id, dir) {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx === -1) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= this.items.length) return;
    [this.items[idx], this.items[swapWith]] = [this.items[swapWith], this.items[idx]];
    this.forgeView.render();
  }

  removeItem(id) {
    this.items = this.items.filter((it) => it.id !== id);
    this.forgeView.render();
  }

  setOutputType(type) { this.outputType = type; this.forgeView.render(); }
  setGifLoop(on) { this.gifLoop = on; }
  setGifBoomerang(on) { this.gifBoomerang = on; }

  html() {
    const outputChip = (label, val) => `<button type="button" class="filter-chip${this.outputType === val ? " on" : ""}" onclick="_activeForgeView.compile.setOutputType('${val}')">${label}</button>`;
    return `
      <div style="max-width:640px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button type="button" class="filter-chip" id="compileUploadBtn">Upload images</button>
          <button type="button" class="filter-chip" onclick="_activeForgeView.compile.openSourcePicker('creations')">My Creations</button>
          <button type="button" class="filter-chip" onclick="_activeForgeView.compile.openSourcePicker('community')">Pinacotheca</button>
          <input type="file" id="compileFileInput" accept="image/*" multiple hidden>
        </div>
        ${this.items.length ? `
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:16px">
            ${this.items.map((it, i) => `
              <div style="position:relative;flex:none;width:84px">
                <img src="${_attr(it.src)}" alt="" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--color-line)">
                <div style="display:flex;justify-content:space-between;margin-top:4px">
                  <button type="button" data-move="-1" data-id="${_attr(it.id)}" ${i === 0 ? "disabled" : ""} style="background:none;border:none;color:var(--color-muted);cursor:pointer;padding:2px 4px">&larr;</button>
                  <button type="button" data-remove data-id="${_attr(it.id)}" style="background:none;border:none;color:var(--color-warn);cursor:pointer;padding:2px 4px">&times;</button>
                  <button type="button" data-move="1" data-id="${_attr(it.id)}" ${i === this.items.length - 1 ? "disabled" : ""} style="background:none;border:none;color:var(--color-muted);cursor:pointer;padding:2px 4px">&rarr;</button>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<p style="font-size:13px;color:var(--color-sec);margin-bottom:16px">Add at least two images to compile.</p>`}
        <div style="display:flex;gap:6px;margin-bottom:16px">
          ${outputChip("GIF", "gif")}
          ${outputChip("Vertical Strip", "strip")}
        </div>
      </div>
    `;
  }

  wire() {
    const root = this.forgeView.main;
    const uploadBtn = root.querySelector("#compileUploadBtn");
    const fileInput = root.querySelector("#compileFileInput");
    if (uploadBtn && fileInput) {
      uploadBtn.onclick = () => fileInput.click();
      fileInput.onchange = () => { this.addFilesFromInput(fileInput.files); fileInput.value = ""; };
    }
    root.querySelectorAll("[data-move]").forEach((btn) => {
      btn.onclick = () => this.moveItem(btn.dataset.id, Number(btn.dataset.move));
    });
    root.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.onclick = () => this.removeItem(btn.dataset.id);
    });
  }
}

if (typeof window !== "undefined") {
  window.ForgeCompilePanel = ForgeCompilePanel;
}
```

- [ ] **Step 2: Register the script in index.html**

In `new_ui/index.html`, insert immediately before the `forge.js` line (after the `gif-encoder.js` tag from Task 1):

```html
  <script src="/js/forge-compile.js" defer></script>
```

- [ ] **Step 3: Instantiate the panel in ForgeView's constructor**

In `new_ui/js/forge.js`, in the `ForgeView` constructor (around line 112, right before the closing `}`), add:

```js
    this.genStatus = "";
    this.compile = new ForgeCompilePanel(this);
```

- [ ] **Step 4: Add the Compile chip to the mode switcher**

In `new_ui/js/forge.js`, in `modeArchRowHtml()` (around line 171-180), change:

```js
            ${this.segChip("Image Gen", this.mode === "image", "_activeForgeView.setMode('image')")}
            ${this.segChip("Inpaint", this.mode === "inpaint", "_activeForgeView.setMode('inpaint')")}
            ${this.segChip("Video", this.mode === "video", "_activeForgeView.setMode('video')")}
            ${this.segChip("Upscale", this.mode === "upscale", "_activeForgeView.setMode('upscale')")}
          </div>
          ${this.mode === "upscale" || this.mode === "video" ? "" : `
```

to:

```js
            ${this.segChip("Image Gen", this.mode === "image", "_activeForgeView.setMode('image')")}
            ${this.segChip("Inpaint", this.mode === "inpaint", "_activeForgeView.setMode('inpaint')")}
            ${this.segChip("Video", this.mode === "video", "_activeForgeView.setMode('video')")}
            ${this.segChip("Upscale", this.mode === "upscale", "_activeForgeView.setMode('upscale')")}
            ${this.segChip("Compile", this.mode === "compile", "_activeForgeView.setMode('compile')")}
          </div>
          ${this.mode === "upscale" || this.mode === "video" || this.mode === "compile" ? "" : `
```

- [ ] **Step 5: Branch render() to the compile panel**

In `new_ui/js/forge.js`, at the very start of `render()` (around line 1632), add an early branch:

```js
  render() {
    window._activeForgeView = this;
    if (this.mode === "compile") {
      this.main.innerHTML = `
        <div class="content-col forge-content">
        ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
        ${this.modeArchRowHtml("")}
        ${this.compile.html()}
        </div>
      `;
      this.compile.wire();
      return;
    }
    this.main.innerHTML = `
```

(the rest of the existing `render()` body is unchanged, just now reached only for non-compile modes).

- [ ] **Step 6: Verify scripts are served and load in order**

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/ | grep -E "forge-compile|forge\.js|gif-encoder"`
Expected: three `<script>` lines, in this order: `gif-encoder.js`, `forge-compile.js`, `forge.js`.

Run: `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/forge-compile.js | grep "class ForgeCompilePanel"`
Expected: one match.

- [ ] **Step 7: Manual browser verification**

Log in as `test`/user (or `claude`/admin). Navigate to `/sanctum/forge`. Click the new **Compile** chip.
Expected: the generation settings panel (prompt/checkpoint/sampler) disappears, replaced by "Upload images" / "My Creations" / "Pinacotheca" buttons, a "GIF" / "Vertical Strip" toggle, and the placeholder text "Add at least two images to compile."

Click **Upload images**, pick 2+ local image files.
Expected: thumbnails appear in a horizontal strip with ←/×/→ controls; clicking → on the first thumbnail moves it right; clicking × removes it and re-renders the strip.

Click **My Creations**, then **Pinacotheca**.
Expected: each opens a modal grid of that user's/community's images (skipping any videos); clicking a thumbnail highlights it with an accent border and updates the "Add N selected" button count; clicking that button adds the chosen images to the same thumbnail strip and closes the modal.

- [ ] **Step 8: Commit**

```bash
git add new_ui/js/forge-compile.js new_ui/index.html new_ui/js/forge.js
git commit -m "Add Forge Compile tab: item list from upload, My Creations, and Pinacotheca"
```

---

## Task 3: GIF output — settings, compile, download

**Files:**
- Modify: `new_ui/js/forge-compile.js` (add GIF settings UI, frame-building, compile, download)

**Interfaces:**
- Consumes: `window.GifEncoder.encode(...)` from Task 1 (`{ width, height, frames, delayMs, loop, boomerang }` → `Uint8Array`).
- Produces: `.compileGif()`, `.setResult(blob, filename)`, `.download()` — reused by Task 4's strip compile too.

- [ ] **Step 1: Add image-loading and GIF-frame-building helpers**

In `new_ui/js/forge-compile.js`, add these methods to `ForgeCompilePanel` (after `removeItem`):

```js
  loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't load an image."));
      img.src = src;
    });
  }

  async buildGifFrames() {
    const imgs = await Promise.all(this.items.map((it) => this.loadImageEl(it.src)));
    const targetW = Math.max(...imgs.map((im) => im.naturalWidth));
    const targetH = Math.max(...imgs.map((im) => im.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    const frames = [];
    for (const img of imgs) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, targetW, targetH);
      const scale = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (targetW - w) / 2, (targetH - h) / 2, w, h);
      frames.push(ctx.getImageData(0, 0, targetW, targetH));
    }
    return { frames, width: targetW, height: targetH };
  }

  setResult(blob, filename) {
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = URL.createObjectURL(blob);
    this.resultFilename = filename;
  }

  download() {
    if (!this.resultUrl) return;
    const a = document.createElement("a");
    a.href = this.resultUrl;
    a.download = this.resultFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async compileGif() {
    if (this.items.length < 2 || this.busy) return;
    this.busy = true;
    this.forgeView.render();
    try {
      const { frames, width, height } = await this.buildGifFrames();
      const bytes = window.GifEncoder.encode({
        width, height, frames,
        delayMs: this.gifDelay, loop: this.gifLoop, boomerang: this.gifBoomerang,
      });
      this.setResult(new Blob([bytes], { type: "image/gif" }), "compiled.gif");
    } catch (err) {
      errorToast(err.message || "Couldn't compile the GIF.");
    }
    this.busy = false;
    this.forgeView.render();
  }
```

- [ ] **Step 2: Add the GIF settings markup**

In `new_ui/js/forge-compile.js`, add a new method to `ForgeCompilePanel`:

```js
  gifSettingsHtml() {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <label style="font-size:12px;color:var(--color-muted)">Frame delay: <span id="compileGifDelayVal">${this.gifDelay}</span>ms</label>
        <input type="range" id="compileGifDelay" min="50" max="3000" step="50" value="${this.gifDelay}">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-ink)"><input type="checkbox" id="compileGifLoop" ${this.gifLoop ? "checked" : ""}> Loop forever</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-ink)"><input type="checkbox" id="compileGifBoomerang" ${this.gifBoomerang ? "checked" : ""}> Boomerang (play forward then reverse)</label>
        <button type="button" class="pe-gen-btn" id="compileRunBtn" ${this.items.length < 2 || this.busy ? "disabled" : ""}>${this.busy ? "Compiling…" : "Compile GIF"}</button>
      </div>
    `;
  }
```

- [ ] **Step 3: Wire the GIF settings and result preview into `html()`**

In `new_ui/js/forge-compile.js`, in `html()`, replace:

```js
        <div style="display:flex;gap:6px;margin-bottom:16px">
          ${outputChip("GIF", "gif")}
          ${outputChip("Vertical Strip", "strip")}
        </div>
      </div>
    `;
```

with:

```js
        <div style="display:flex;gap:6px;margin-bottom:16px">
          ${outputChip("GIF", "gif")}
          ${outputChip("Vertical Strip", "strip")}
        </div>
        ${this.outputType === "gif" ? this.gifSettingsHtml() : ""}
        ${this.resultUrl ? `
          <div style="margin-top:18px">
            <img src="${_attr(this.resultUrl)}" alt="" style="max-width:100%;border-radius:12px;border:1px solid var(--color-line)">
            <button type="button" class="pe-gen-btn" id="compileDownloadBtn" style="margin-top:10px">Download</button>
          </div>
        ` : ""}
      </div>
    `;
```

- [ ] **Step 4: Wire the new controls in `wire()`**

In `new_ui/js/forge-compile.js`, in `wire()`, add before the closing `}`:

```js
    const delayEl = root.querySelector("#compileGifDelay");
    if (delayEl) delayEl.oninput = () => {
      this.gifDelay = Number(delayEl.value);
      root.querySelector("#compileGifDelayVal").textContent = this.gifDelay;
    };
    const loopEl = root.querySelector("#compileGifLoop");
    if (loopEl) loopEl.onchange = () => this.setGifLoop(loopEl.checked);
    const boomEl = root.querySelector("#compileGifBoomerang");
    if (boomEl) boomEl.onchange = () => this.setGifBoomerang(boomEl.checked);
    const runBtn = root.querySelector("#compileRunBtn");
    if (runBtn) runBtn.onclick = () => this.outputType === "gif" ? this.compileGif() : this.compileStrip();
    const dlBtn = root.querySelector("#compileDownloadBtn");
    if (dlBtn) dlBtn.onclick = () => this.download();
```

(the reference to `this.compileStrip()` is implemented in Task 4 — leave it as-is; it will exist by the time this code runs since `wire()` isn't invoked until after Task 4 is complete if tasks are done in order, but for standalone testing of this task, temporarily verify with the GIF path only.)

- [ ] **Step 5: Manual browser verification**

Navigate to `/sanctum/forge` → **Compile**. Upload 2 small local images (or add 2 from My Creations). Confirm the GIF settings panel shows (delay slider, loop checkbox, boomerang checkbox, "Compile GIF" button — enabled once 2+ items exist).

Move the delay slider to e.g. 1000ms.
Expected: the "1000ms" label next to "Frame delay:" updates live as the slider moves.

Click **Compile GIF**.
Expected: the button reads "Compiling…" and is disabled briefly, then an animated GIF preview appears below with a **Download** button. Click Download.
Expected: a `compiled.gif` file downloads; opening it in an image viewer/browser tab shows it animating between the source images at roughly the chosen delay.

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/forge-compile.js
git commit -m "Add GIF compile settings and export to Forge Compile tab"
```

---

## Task 4: Vertical strip output — settings, compile, download

**Files:**
- Modify: `new_ui/js/forge-compile.js` (add strip settings UI + compile logic)

**Interfaces:**
- Consumes: `.loadImageEl(src)`, `.setResult(blob, filename)` from Task 3.
- Produces: `.compileStrip()` — the method Task 3's `wire()` already references.

- [ ] **Step 1: Add the strip settings markup and compile method**

In `new_ui/js/forge-compile.js`, add these methods to `ForgeCompilePanel` (after `gifSettingsHtml`):

```js
  stripSettingsHtml() {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <label style="font-size:12px;color:var(--color-muted)">Gap: <span id="compileStripGapVal">${this.stripGap}</span>px</label>
        <input type="range" id="compileStripGap" min="0" max="40" step="1" value="${this.stripGap}">
        <button type="button" class="pe-gen-btn" id="compileRunBtn" ${!this.items.length || this.busy ? "disabled" : ""}>${this.busy ? "Compiling…" : "Compile Strip"}</button>
      </div>
    `;
  }

  async compileStrip() {
    if (!this.items.length || this.busy) return;
    this.busy = true;
    this.forgeView.render();
    try {
      const imgs = await Promise.all(this.items.map((it) => this.loadImageEl(it.src)));
      const targetW = Math.max(...imgs.map((im) => im.naturalWidth));
      const scaled = imgs.map((im) => ({ img: im, h: im.naturalHeight * (targetW / im.naturalWidth) }));
      const totalH = Math.round(scaled.reduce((sum, s) => sum + s.h, 0) + this.stripGap * Math.max(0, scaled.length - 1));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = totalH;
      const ctx = canvas.getContext("2d");
      let y = 0;
      for (const s of scaled) {
        ctx.drawImage(s.img, 0, y, targetW, s.h);
        y += s.h + this.stripGap;
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      this.setResult(blob, "compiled-strip.png");
    } catch (err) {
      errorToast(err.message || "Couldn't compile the strip.");
    }
    this.busy = false;
    this.forgeView.render();
  }
```

- [ ] **Step 2: Show the strip settings when that output type is selected**

In `new_ui/js/forge-compile.js`, in `html()`, change:

```js
        ${this.outputType === "gif" ? this.gifSettingsHtml() : ""}
```

to:

```js
        ${this.outputType === "gif" ? this.gifSettingsHtml() : this.stripSettingsHtml()}
```

- [ ] **Step 3: Wire the gap slider**

In `new_ui/js/forge-compile.js`, in `wire()`, add:

```js
    const gapEl = root.querySelector("#compileStripGap");
    if (gapEl) gapEl.oninput = () => {
      this.stripGap = Number(gapEl.value);
      root.querySelector("#compileStripGapVal").textContent = this.stripGap;
    };
```

- [ ] **Step 4: Manual browser verification**

Navigate to `/sanctum/forge` → **Compile**, with 2+ images already in the list from the previous task's testing (or add fresh ones). Click **Vertical Strip**.
Expected: the panel switches to show the "Gap" slider and a "Compile Strip" button (enabled with even 1 image, per the design — unlike GIF's 2-image minimum).

Move the gap slider to 20px, click **Compile Strip**.
Expected: button shows "Compiling…" briefly, then a tall PNG preview appears (all source images stacked top-to-bottom, each scaled to the widest source's width, with visible 20px gaps between them) with a Download button. Click Download.
Expected: a `compiled-strip.png` downloads and opens correctly, matching the preview.

Switch back to **GIF** and confirm the GIF settings/compile from Task 3 still work (output-type toggle doesn't lose the item list or break the other mode).

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/forge-compile.js
git commit -m "Add vertical-strip compile settings and export to Forge Compile tab"
```

---

## Task 5: Full manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: End-to-end walkthrough as a regular user**

Log in as `test`/user. Navigate to `/sanctum/forge` → **Compile**.
1. Add 1 image via Upload only → confirm GIF's "Compile GIF" button is disabled (needs 2+), Vertical Strip's "Compile Strip" button is enabled.
2. Add a 2nd image via **My Creations** (or via Pinacotheca if the account has no saved creations) → confirm both buttons are now enabled and the thumbnail strip shows both images in add-order.
3. Reorder: click → on the first thumbnail, confirm order swaps; click × on one thumbnail, confirm it's removed and the list re-renders without gaps.
4. Compile a GIF with boomerang ON and loop OFF → download, confirm the file plays forward-then-reverse once (open it in a browser tab, since play-once GIFs stop on the last frame after cycling forward+reverse once).
5. Switch to another Forge mode (e.g. Image Gen) and back to Compile → confirm the item list, per the design, is not required to persist (in-memory only is acceptable — note whatever the actual observed behavior is, since the spec doesn't require preserving it across mode switches).

- [ ] **Step 2: Verify no console errors**

Using the claude-in-chrome skill (or manual DevTools), open `/sanctum/forge`, switch to Compile, run through steps 1-4 above, and check the browser console for any uncaught exceptions.
Expected: no errors logged during any of the add/reorder/remove/compile/download actions.

- [ ] **Step 3: Confirm served files match source one final time**

Run:
```bash
curl -s https://storyhavenai.sillysillysupersillydomain.win/js/forge-compile.js | md5sum
md5sum new_ui/js/forge-compile.js
```
Expected: both hashes match, confirming the live app is serving the exact committed source (no stale edge cache).

- [ ] **Step 4: Report results**

Summarize what was verified and any deviations observed from the plan's expected outcomes (there is no further commit for this task — it's verification only).
