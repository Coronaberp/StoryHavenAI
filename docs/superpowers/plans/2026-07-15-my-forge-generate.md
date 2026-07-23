# My Forge Generate Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the My Forge Generate screen (`/sanctum/forge`) in `new_ui/` — standalone txt2img/img2img generation against the real ComfyUI-backed backend, with live SSE preview frames, model/LoRA/sampler controls, save, upscale, and regenerate — replacing the current placeholder.

**Architecture:** One new view file `new_ui/js/forge.js` (`class ForgeView`, same `mount(main)`/`render()` shape as every other Sanctum screen), plus a shared `sseEvents(response, onEvent)` helper ported into `new_ui/js/app-session.js` (the first thing in `new_ui/` that needs SSE-over-POST). No backend changes — every endpoint used already exists.

**Tech Stack:** Vanilla JS classes + Tailwind utility classes + hand-written CSS in `cards.css` (frontend, no build step, matching every other `new_ui/` screen).

## Global Constraints

- Zero comments in any file, ever — no exceptions (per `CLAUDE.md` coding style).
- No hardcoded hex colors outside `themes.css` — every color in new markup/CSS must reference a `var(--color-*)` custom property.
- `new_ui/` has no JS test runner — verification is manual against the human's already-running `./rebuild.sh --watch` dev server on `:3001`, per `CLAUDE.md`. Never spin up a second dev server instance for this.
- Never use `EnterWorktree`/`git worktree` for this repo — edit `/var/home/staygold/ai-frontend` directly (bind-mounted into the live container).
- This is a live, shared checkout — other agents may be editing the same files concurrently. Re-read a file immediately before editing it if there's any chance it changed since last read. Commit only the files each task actually touches.
- No fake progress percentage anywhere — the backend's SSE stream has no numeric progress field, only `preview`/`done`/`error` events. The evolving preview image is the only progress indicator.
- No seed field, no video mode, no inpaint/mask UI — none of these exist in the real backend (`ImageGenStandaloneIn` has no seed field; only txt2img/img2img are real modes). Do not add speculative UI for them.
- Aspect presets are fixed real width/height pairs (`ASPECT_SIZES` below) — never a computed/derived "ratio" sent to the backend, which only accepts `width`/`height`.

---

### Task 1: `sseEvents` helper + `ForgeView` skeleton (mode/architecture toggle, prompt block, aspect chips)

**Files:**
- Modify: `new_ui/js/app-session.js`
- Create: `new_ui/js/forge.js`
- Modify: `new_ui/index.html` (script tag)
- Modify: `new_ui/js/router.js` (wire the real view in)

**Interfaces:**
- Consumes: `pageHeaderHtml`, `api`, `navigate` (existing globals).
- Produces: `async function sseEvents(response, onEvent)` — a global function in `app-session.js`, reads `response.body`'s reader, splits buffered text on `\n\n`, parses each `data: ` line as JSON, calls `await onEvent(parsedObject)` for each. `class ForgeView` with `constructor()`, `async mount(main)`, `render()` — registered at `routes["sanctum-forge"]`. This task renders the static form shell (mode/architecture toggle, prompt block, aspect chips, denoise slider gated on img2img mode) with no network calls beyond nothing — independently testable before Task 2 adds model fetching.

- [ ] **Step 1: Port `sseEvents` into `app-session.js`**

Re-read `new_ui/js/app-session.js` fresh, then add after the `api` function:

```javascript
async function sseEvents(response, onEvent) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      await onEvent(ev);
    }
  }
}
```

- [ ] **Step 2: Create `new_ui/js/forge.js` with the form shell**

```javascript
"use strict";

const FORGE_ASPECTS = {
  "1:1": [1024, 1024],
  "2:3": [832, 1216],
  "3:4": [896, 1152],
  "16:9": [1216, 704],
  "9:16": [704, 1216],
};

class ForgeView {
  constructor() {
    this.mode = "txt2img";
    this.architecture = "sdxl";
    this.positive = "";
    this.negative = "";
    this.showNegative = false;
    this.aspect = "1:1";
    this.denoise = 0.6;
    this.referenceImage = null;
    this.checkpoints = [];
    this.checkpointPreviews = {};
    this.checkpoint = "";
    this.loraOptions = [];
    this.loras = [];
    this.lorasOpen = false;
    this.samplers = [];
    this.schedulers = [];
    this.sampler = "";
    this.scheduler = "";
    this.steps = 20;
    this.cfg = 7.0;
    this.advancedOpen = false;
    this.busy = false;
    this.previewImage = "";
    this.lastResult = null;
    this.recent = [];
    this.upscalers = [];
    this.upscalerPreviews = {};
    this.upscalePickerOpen = false;
    this.upscaling = false;
  }

  async mount(main) {
    this.main = main;
    this.render();
  }

  segChip(label, active, onclickExpr) {
    return `<button type="button" class="filter-chip${active ? " on" : ""}" onclick="${onclickExpr}">${label}</button>`;
  }

  modeArchRowHtml() {
    return `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px">
          ${this.segChip("Text-to-image", this.mode === "txt2img", "_activeForgeView.setMode('txt2img')")}
          ${this.segChip("Image-to-image", this.mode === "img2img", "_activeForgeView.setMode('img2img')")}
        </div>
        <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px">
          ${this.segChip("SDXL", this.architecture === "sdxl", "_activeForgeView.setArchitecture('sdxl')")}
          ${this.segChip("Anima", this.architecture === "anima", "_activeForgeView.setArchitecture('anima')")}
        </div>
      </div>
    `;
  }

  aspectRowHtml() {
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">Aspect ratio</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${Object.keys(FORGE_ASPECTS).map((a) => this.segChip(a, this.aspect === a, `_activeForgeView.setAspect('${a}')`)).join("")}
        </div>
      </div>
    `;
  }

  promptBlockHtml() {
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">Prompt</label>
        <textarea id="forgePositive" class="grimoire-field-textarea" rows="3" placeholder="Describe what to generate…">${this.positive}</textarea>
        <button type="button" onclick="_activeForgeView.toggleNegative()" style="display:flex;align-items:center;gap:6px;margin-top:9px;background:none;border:none;color:var(--color-muted);font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer">
          <span style="display:inline-block;transform:rotate(${this.showNegative ? "90deg" : "0deg"});transition:transform .2s">&rsaquo;</span> Negative prompt
        </button>
        ${this.showNegative ? `<textarea id="forgeNegative" class="grimoire-field-textarea" rows="2" placeholder="What to avoid…" style="margin-top:9px">${this.negative}</textarea>` : ""}
      </div>
    `;
  }

  denoiseRowHtml() {
    if (this.mode !== "img2img") return "";
    return `
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span class="grimoire-field-label" style="margin:0">Denoise strength</span>
          <span style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${this.denoise.toFixed(2)}</span>
        </div>
        <input type="range" id="forgeDenoise" min="0.05" max="1" step="0.05" value="${this.denoise}" style="width:100%">
      </div>
    `;
  }

  setMode(mode) { this.mode = mode; this.render(); }
  setArchitecture(arch) { this.architecture = arch; this.checkpoint = ""; this.render(); this.loadModels(); }
  setAspect(aspect) { this.aspect = aspect; this.render(); }
  toggleNegative() { this.showNegative = !this.showNegative; this.render(); }

  render() {
    window._activeForgeView = this;
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
      ${this.modeArchRowHtml()}
      ${this.aspectRowHtml()}
      ${this.promptBlockHtml()}
      ${this.denoiseRowHtml()}
    `;
    const posEl = this.main.querySelector("#forgePositive");
    if (posEl) posEl.oninput = () => { this.positive = posEl.value; };
    const negEl = this.main.querySelector("#forgeNegative");
    if (negEl) negEl.oninput = () => { this.negative = negEl.value; };
    const denoiseEl = this.main.querySelector("#forgeDenoise");
    if (denoiseEl) denoiseEl.oninput = () => { this.denoise = +denoiseEl.value; };
  }
}
```

- [ ] **Step 3: Register the script tag**

Re-read `new_ui/index.html` fresh, then add after the `grimoire.js` line:

```html
  <script src="/js/grimoire.js" defer></script>
  <script src="/js/forge.js" defer></script>
```

- [ ] **Step 4: Wire the real view into the router**

Re-read `new_ui/js/router.js` fresh, then replace:

```javascript
  "sanctum-forge": (main) => renderPlaceholder(main, "Sanctum", "Generate media", "My Forge",
    "Conjure new images and video from nothing but a prompt or your own existing images."),
```

with:

```javascript
  "sanctum-forge": (main) => new ForgeView().mount(main),
```

- [ ] **Step 5: Manually verify against `:3001`**

```bash
curl -s http://localhost:3001/js/forge.js -o /dev/null -w "%{http_code}\n"
curl -s http://localhost:3001/js/app-session.js | grep -c "async function sseEvents"
curl -s http://localhost:3001/js/router.js | grep -c "new ForgeView"
```

Expected: `200`, then two non-zero counts. In a browser at `http://localhost:3001/sanctum/forge` (logged in as `test`/`11111111`): confirm the header reads "Sanctum · Generate media" / "My Forge"; confirm the Mode and Architecture segmented toggles switch and re-render (Denoise strength row appears only in Image-to-image mode); confirm typing in the prompt textarea persists across re-renders triggered by toggling other controls; confirm the aspect chips switch the active one; confirm the negative-prompt chevron toggles the second textarea.

- [ ] **Step 6: Commit**

```bash
git status --short new_ui/js/app-session.js new_ui/js/forge.js new_ui/index.html new_ui/js/router.js
git add new_ui/js/app-session.js new_ui/js/forge.js new_ui/index.html new_ui/js/router.js
git commit -m "Add My Forge form shell: mode/architecture toggle, prompt, aspect chips"
```

---

### Task 2: Preview box (all states) + reference image upload

**Files:**
- Modify: `new_ui/js/forge.js`

**Interfaces:**
- Consumes: `toast`/`errorToast` (`new_ui/js/toast.js`).
- Produces: `previewBoxHtml()`, wired into `render()` between the mode/arch row and the aspect row (matches the spec's top-to-bottom order: preview box comes before the prompt block, so this task also moves `promptBlockHtml`'s render position — see Step 2). `onReferenceFile(file)` handles the upload.

- [ ] **Step 1: Add `previewBoxHtml()` and reference-upload handling**

In `new_ui/js/forge.js`, add this method to `ForgeView` (anywhere among the other `*Html` methods):

```javascript
  previewBoxHtml() {
    const [w, h] = FORGE_ASPECTS[this.aspect];
    const ratio = `${w} / ${h}`;
    let inner;
    if (this.busy && this.previewImage) {
      inner = `
        <img src="${this.previewImage}" style="width:100%;height:100%;object-fit:cover">
        <span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">Generating…</span>
      `;
    } else if (this.lastResult) {
      inner = `
        <img src="${this.lastResult.image}" style="width:100%;height:100%;object-fit:cover">
        <div style="position:absolute;right:10px;bottom:10px;display:flex;gap:8px">
          <button type="button" class="forge-img-act" onclick="_activeForgeView.save()" title="Save"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg></button>
          <button type="button" class="forge-img-act" onclick="_activeForgeView.openUpscale()" title="Upscale"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></button>
          <button type="button" class="forge-img-act" onclick="_activeForgeView.regenerate()" title="Regenerate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg></button>
        </div>
      `;
    } else if (this.mode === "img2img" && !this.referenceImage) {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>
          </div>
          <button type="button" class="pe-gen-btn" onclick="_activeForgeView.main.querySelector('#forgeRefFile').click()">Add a reference image</button>
        </div>
        <input type="file" id="forgeRefFile" accept="image/png,image/jpeg,image/webp" hidden>
      `;
    } else if (this.mode === "img2img" && this.referenceImage) {
      inner = `
        <img src="${this.referenceImage}" style="width:100%;height:100%;object-fit:cover">
        <button type="button" onclick="_activeForgeView.main.querySelector('#forgeRefFile').click()" style="position:absolute;right:10px;top:10px;display:flex;align-items:center;gap:6px;padding:7px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(10,10,12,.5);color:#fff;font-size:12px;font-weight:600;cursor:pointer;backdrop-filter:blur(6px)">Replace</button>
        <input type="file" id="forgeRefFile" accept="image/png,image/jpeg,image/webp" hidden>
      `;
    } else {
      inner = `
        <div style="text-align:center;color:var(--color-muted);padding:20px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>
          </div>
          <div style="font-size:13.5px;color:var(--color-sec)">Your image will appear here</div>
          <div style="font-size:11.5px;margin-top:4px">Describe it below, then tap Generate</div>
        </div>
      `;
    }
    return `
      <div id="forgePreviewBox" style="position:relative;width:100%;aspect-ratio:${ratio};border-radius:16px;overflow:hidden;border:1px solid var(--color-line);background:var(--color-surface);margin-bottom:14px;display:grid;place-items:center">
        ${inner}
      </div>
    `;
  }

  onReferenceFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      this.referenceImage = reader.result;
      this.render();
    };
    reader.readAsDataURL(file);
  }
```

- [ ] **Step 2: Wire it into `render()` and reorder to match the spec's layout**

In `new_ui/js/forge.js`, replace the `render()` method's `innerHTML` template and the listener-wiring block:

```javascript
  render() {
    window._activeForgeView = this;
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
      ${this.modeArchRowHtml()}
      ${this.previewBoxHtml()}
      ${this.promptBlockHtml()}
      ${this.denoiseRowHtml()}
      ${this.aspectRowHtml()}
    `;
    const posEl = this.main.querySelector("#forgePositive");
    if (posEl) posEl.oninput = () => { this.positive = posEl.value; };
    const negEl = this.main.querySelector("#forgeNegative");
    if (negEl) negEl.oninput = () => { this.negative = negEl.value; };
    const denoiseEl = this.main.querySelector("#forgeDenoise");
    if (denoiseEl) denoiseEl.oninput = () => { this.denoise = +denoiseEl.value; };
    const refFile = this.main.querySelector("#forgeRefFile");
    if (refFile) refFile.onchange = () => {
      const file = refFile.files[0];
      if (file) this.onReferenceFile(file);
    };
  }
```

- [ ] **Step 3: Manually verify against `:3001`**

At `http://localhost:3001/sanctum/forge`: confirm the empty preview box shows in Text-to-image mode; switch to Image-to-image, confirm the "Add a reference image" prompt shows; tap it, pick a file, confirm the uploaded image renders in the box with a "Replace" button; tap Replace, pick a different file, confirm it swaps.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/js/forge.js
git add new_ui/js/forge.js
git commit -m "Add Forge preview box states and reference image upload"
```

---

### Task 3: Model, LoRA, and Advanced controls

**Files:**
- Modify: `new_ui/js/forge.js`

**Interfaces:**
- Consumes: `api` (as above).
- Produces: `async loadModels()`, `modelPickerHtml()`, `loraSectionHtml()`, `advancedHtml()`, all wired into `render()`. `mount()` now calls `loadModels()` after the initial render.

- [ ] **Step 1: Add `loadModels()`**

In `new_ui/js/forge.js`, add to `ForgeView`:

```javascript
  async loadModels() {
    const checkpointEndpoint = this.architecture === "anima" ? "/api/imagegen/anima-unets" : "/api/imagegen/checkpoints";
    const [checkpoints, previews, loraOptions, samplerData] = await Promise.all([
      api(checkpointEndpoint).catch(() => []),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/loras").catch(() => []),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
    ]);
    this.checkpoints = checkpoints;
    this.checkpointPreviews = previews;
    this.loraOptions = loraOptions;
    this.samplers = samplerData.samplers || [];
    this.schedulers = samplerData.schedulers || [];
    if (!this.checkpoint && checkpoints.length) this.checkpoint = checkpoints[0];
    if (!this.sampler && this.samplers.length) this.sampler = this.samplers[0];
    if (!this.scheduler && this.schedulers.length) this.scheduler = this.schedulers[0];
    this.render();
  }
```

- [ ] **Step 2: Add `modelPickerHtml()`, `loraSectionHtml()`, `advancedHtml()`**

Add these methods to `ForgeView`:

```javascript
  modelPickerHtml() {
    if (!this.checkpoints.length) {
      return `<div style="margin-bottom:16px"><label class="grimoire-field-label">Model</label><p style="font-size:12.5px;color:var(--color-sec)">Couldn't load models.</p></div>`;
    }
    return `
      <div style="margin-bottom:16px">
        <label class="grimoire-field-label">Model</label>
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px">
          ${this.checkpoints.map((c) => {
            const p = this.checkpointPreviews[c];
            const active = this.checkpoint === c;
            const art = p?.image ? `background-image:url('${p.image}')` : "background:var(--color-surface-2)";
            const label = p?.display_name || c;
            return `
              <button type="button" onclick="_activeForgeView.setCheckpoint('${c.replace(/'/g, "\\'")}')" style="flex:none;width:78px;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
                <span class="sanctum-specimen" style="width:64px;height:64px;border-radius:12px;${art};border-color:${active ? "var(--color-accent)" : "var(--color-line)"}">${p?.image ? "" : label[0].toUpperCase()}</span>
                <span style="font-size:10.5px;text-align:center;color:${active ? "var(--color-accent)" : "var(--color-sec)"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${label}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  loraSectionHtml() {
    return `
      <div style="margin-bottom:16px;border:1px solid var(--color-line);border-radius:14px;overflow:hidden">
        <button type="button" onclick="_activeForgeView.lorasOpen = !_activeForgeView.lorasOpen; _activeForgeView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink)">
          <span style="flex:1;text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted)">LoRAs${this.loras.length ? ` (${this.loras.length})` : ""}</span>
          <span style="transform:rotate(${this.lorasOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${this.lorasOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line);display:flex;flex-direction:column;gap:8px">
            ${this.loraOptions.length ? this.loraOptions.map((name) => {
              const active = this.loras.find((l) => l.name === name);
              return `
                <div style="padding:11px 12px;background:var(--color-surface-2);border:1px solid ${active ? "var(--color-accent)" : "var(--color-line)"};border-radius:12px">
                  <div style="display:flex;align-items:center;gap:10px">
                    <input type="checkbox" ${active ? "checked" : ""} onchange="_activeForgeView.toggleLora('${name.replace(/'/g, "\\'")}')">
                    <span style="flex:1;font-size:13.5px;color:var(--color-ink)">${name}</span>
                    ${active ? `<span style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${active.strength.toFixed(2)}</span>` : ""}
                  </div>
                  ${active ? `<input type="range" min="0" max="1" step="0.05" value="${active.strength}" oninput="_activeForgeView.setLoraStrength('${name.replace(/'/g, "\\'")}', +this.value)" style="width:100%;margin-top:9px">` : ""}
                </div>
              `;
            }).join("") : `<p style="font-size:12.5px;color:var(--color-sec)">No LoRAs available.</p>`}
          </div>
        ` : ""}
      </div>
    `;
  }

  advancedHtml() {
    return `
      <div style="margin-bottom:16px;border:1px solid var(--color-line);border-radius:14px;overflow:hidden">
        <button type="button" onclick="_activeForgeView.advancedOpen = !_activeForgeView.advancedOpen; _activeForgeView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink)">
          <span style="flex:1;text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted)">Advanced</span>
          <span style="transform:rotate(${this.advancedOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${this.advancedOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line)">
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
                <span class="grimoire-field-label" style="margin:0">Steps</span>
                <span id="forgeStepsVal" style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${this.steps}</span>
              </div>
              <input type="range" min="1" max="60" step="1" value="${this.steps}" oninput="_activeForgeView.steps = +this.value; _activeForgeView.main.querySelector('#forgeStepsVal').textContent = this.value" style="width:100%">
            </div>
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
                <span class="grimoire-field-label" style="margin:0">Guidance (CFG)</span>
                <span id="forgeCfgVal" style="font-family:var(--font-mono);font-size:11.5px;color:var(--color-accent)">${this.cfg.toFixed(1)}</span>
              </div>
              <input type="range" min="1" max="15" step="0.5" value="${this.cfg}" oninput="_activeForgeView.cfg = +this.value; _activeForgeView.main.querySelector('#forgeCfgVal').textContent = (+this.value).toFixed(1)" style="width:100%">
            </div>
            <label class="grimoire-field-label">Sampler</label>
            <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:14px">
              ${this.samplers.map((s) => this.segChip(s, this.sampler === s, `_activeForgeView.sampler = '${s.replace(/'/g, "\\'")}'; _activeForgeView.render()`)).join("")}
            </div>
            <label class="grimoire-field-label">Scheduler</label>
            <div style="display:flex;gap:6px;overflow-x:auto">
              ${this.schedulers.map((s) => this.segChip(s, this.scheduler === s, `_activeForgeView.scheduler = '${s.replace(/'/g, "\\'")}'; _activeForgeView.render()`)).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  setCheckpoint(name) { this.checkpoint = name; this.render(); }

  toggleLora(name) {
    const idx = this.loras.findIndex((l) => l.name === name);
    if (idx === -1) this.loras = [...this.loras, { name, strength: 0.8 }];
    else this.loras = this.loras.filter((l) => l.name !== name);
    this.render();
  }

  setLoraStrength(name, strength) {
    this.loras = this.loras.map((l) => (l.name === name ? { ...l, strength } : l));
  }
```

The "Steps"/"CFG" sliders update their displayed value via direct DOM text updates (`#forgeStepsVal`/`#forgeCfgVal`, already in the code above) rather than a full `render()` on every drag tick — a full re-render on every `input` event would destroy the range input's own drag state. The underlying `this.steps`/`this.cfg` values are still kept correctly in sync either way.

- [ ] **Step 3: Wire the three new sections into `render()` and call `loadModels()` from `mount()`**

In `new_ui/js/forge.js`, replace:

```javascript
  async mount(main) {
    this.main = main;
    this.render();
  }
```

with:

```javascript
  async mount(main) {
    this.main = main;
    this.render();
    this.loadModels();
  }
```

And replace the `render()` method's `innerHTML` template again:

```javascript
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
      ${this.modeArchRowHtml()}
      ${this.previewBoxHtml()}
      ${this.promptBlockHtml()}
      ${this.denoiseRowHtml()}
      ${this.aspectRowHtml()}
    `;
```

with:

```javascript
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
      ${this.modeArchRowHtml()}
      ${this.previewBoxHtml()}
      ${this.promptBlockHtml()}
      ${this.denoiseRowHtml()}
      ${this.aspectRowHtml()}
      ${this.modelPickerHtml()}
      ${this.loraSectionHtml()}
      ${this.advancedHtml()}
    `;
```

- [ ] **Step 4: Manually verify against `:3001`**

```bash
cd /tmp/claude-1000/-var-home-staygold-ai-frontend/200ded16-9cd6-4e17-8453-c76c9a7d45ab/scratchpad
curl -s -b cookies.txt "http://localhost:3001/api/imagegen/checkpoints" -w "\ncheckpoints: %{http_code}\n" -o /dev/null
curl -s -b cookies.txt "http://localhost:3001/api/imagegen/loras" -w "\nloras: %{http_code}\n" -o /dev/null
curl -s -b cookies.txt "http://localhost:3001/api/imagegen/samplers" -w "\nsamplers: %{http_code}\n"
```

Expected: `200`s (a `502` from the checkpoints/samplers calls means ComfyUI itself isn't reachable in this environment — note this in the task report rather than treating it as a plan defect, since it's an infra dependency outside this task's control; the picker's own "Couldn't load models." fallback should still render correctly in that case). In a browser at `/sanctum/forge`: confirm the Model row shows thumbnail tiles (or the fallback message), tapping one selects it (accent border); confirm the LoRAs section expands/collapses and toggling a LoRA on shows its strength slider; confirm Advanced expands and Steps/CFG sliders drag smoothly without losing focus, Sampler/Scheduler chips select correctly; switch Architecture to Anima and confirm the model row refetches from the anima-unets endpoint (`curl -s http://localhost:3001/js/forge.js | grep anima-unets` to confirm the code path exists, plus visual confirmation the list actually changes if the environment has both configured).

- [ ] **Step 5: Commit**

```bash
git status --short new_ui/js/forge.js
git add new_ui/js/forge.js
git commit -m "Add Forge model, LoRA, and advanced sampler controls"
```

---

### Task 4: Generate flow — SSE streaming, live preview, generate bar, cancel

**Files:**
- Modify: `new_ui/js/forge.js`

**Interfaces:**
- Consumes: `sseEvents` (Task 1), `toast`/`errorToast`.
- Produces: `buildBody()`, `async generate(bodyOverride)`, `async cancelGenerate()`, `generateBarHtml()`, wired into `render()`.

- [ ] **Step 1: Add `buildBody()`, `generate()`, `cancelGenerate()`, `generateBarHtml()`**

In `new_ui/js/forge.js`, add to `ForgeView`:

```javascript
  buildBody() {
    const [width, height] = FORGE_ASPECTS[this.aspect];
    const body = {
      positive: this.positive,
      negative: this.negative,
      checkpoint: this.checkpoint || null,
      loras: this.loras,
      width,
      height,
      sampler: this.sampler || null,
      scheduler: this.scheduler || null,
      steps: this.steps,
      cfg: this.cfg,
      architecture: this.architecture,
    };
    if (this.mode === "img2img" && this.referenceImage) {
      body.reference_image = this.referenceImage;
      body.denoise = this.denoise;
    }
    return body;
  }

  async generate(bodyOverride) {
    if (this.busy) return;
    const body = bodyOverride || this.buildBody();
    if (!body.positive.trim()) { toast("A prompt is required."); return; }
    this.busy = true;
    this.previewImage = "";
    this.lastResult = null;
    this.render();
    try {
      const res = await fetch(`${API}/api/imagegen/standalone/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (ev.type === "preview") {
          this.previewImage = ev.image;
          const img = this.main.querySelector("#forgePreviewBox img");
          if (img) img.src = ev.image;
        } else if (ev.type === "done") {
          this.busy = false;
          this.lastResult = { image: ev.image, body, isImg2img: this.mode === "img2img" };
          this.render();
        } else if (ev.type === "error") {
          this.busy = false;
          errorToast(ev.message || "Generation failed.");
          this.render();
        }
      });
    } catch (err) {
      this.busy = false;
      errorToast(err.message || "Generation failed.");
      this.render();
    }
  }

  async cancelGenerate() {
    this.busy = false;
    this.render();
    try {
      await api("/api/imagegen/standalone/stream/stop", { method: "POST" });
    } catch (err) {
      errorToast(err.message || "Couldn't stop generation.");
    }
  }

  regenerate() {
    if (!this.lastResult) return;
    this.generate(this.lastResult.body);
  }

  generateBarHtml() {
    return `
      <div style="position:sticky;bottom:calc(70px + 12px);z-index:5">
        <button type="button" class="forge-generate-btn" onclick="_activeForgeView.${this.busy ? "cancelGenerate" : "generate"}()">
          ${this.busy ? "Generating… tap to cancel" : "Generate"}
        </button>
      </div>
    `;
  }
```

- [ ] **Step 2: Wire `generateBarHtml()` into `render()`**

In `new_ui/js/forge.js`, replace the `render()` method's `innerHTML` template one more time — add `${this.generateBarHtml()}` at the end, after `${this.advancedHtml()}`:

```javascript
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
      ${this.modeArchRowHtml()}
      ${this.previewBoxHtml()}
      ${this.promptBlockHtml()}
      ${this.denoiseRowHtml()}
      ${this.aspectRowHtml()}
      ${this.modelPickerHtml()}
      ${this.loraSectionHtml()}
      ${this.advancedHtml()}
      ${this.generateBarHtml()}
    `;
```

- [ ] **Step 3: Manually verify against `:3001`**

Enter a prompt, tap Generate. If ComfyUI is reachable in this environment: confirm the preview box shows live-updating preview frames (the `<img>` inside `#forgePreviewBox` swapping `src` repeatedly without a full-page flash), the button reads "Generating… tap to cancel", and on completion the button reverts to "Generate" and the preview shows the final image with Save/Upscale/Regenerate overlay buttons. Tap the button mid-generation to confirm Cancel actually stops it (no further preview frames arrive, `POST /imagegen/standalone/stream/stop` returns `200`). If ComfyUI is not reachable in this environment, verify the error path instead: confirm an `errorToast` fires with a real message and the button correctly reverts to "Generate" (not stuck on "Generating…") — note in the task report which path was actually exercised.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/js/forge.js
git add new_ui/js/forge.js
git commit -m "Add Forge generation flow: live SSE preview, generate bar, cancel"
```

---

### Task 5: Save, Upscale (with picker), and Recent strip

**Files:**
- Modify: `new_ui/js/forge.js`

**Interfaces:**
- Consumes: `sseEvents`, `toast`/`errorToast`, `api`.
- Produces: `async save()`, `async openUpscale()`, `upscalePickerHtml()`, `async runUpscale(name)`, `recentStripHtml()`, all wired into the preview box's result-state buttons (already referencing `_activeForgeView.save()`/`openUpscale()`/`regenerate()` from Task 2) and `render()`.

- [ ] **Step 1: Add `save()`, upscale picker, `runUpscale()`, and `recentStripHtml()`**

In `new_ui/js/forge.js`, add to `ForgeView`:

```javascript
  async save() {
    if (!this.lastResult) return;
    const b = this.lastResult.body;
    try {
      const rec = await api("/api/imagegen/standalone/save", {
        method: "POST",
        body: JSON.stringify({
          image: this.lastResult.image,
          positive: b.positive,
          negative: b.negative,
          checkpoint: b.checkpoint || "",
          loras: b.loras || [],
          sampler: b.sampler || "",
          scheduler: b.scheduler || "",
          steps: b.steps,
          is_img2img: !!this.lastResult.isImg2img,
          cfg: b.cfg,
          upscaler: this.lastResult.upscaler || "",
        }),
      });
      this.recent = [rec, ...this.recent].slice(0, 20);
      toast("Saved to your gallery.");
      this.render();
    } catch (err) {
      errorToast(err.message || "Couldn't save that image.");
    }
  }

  async openUpscale() {
    if (!this.lastResult) return;
    if (!this.upscalers.length) {
      const [upscalers, previews] = await Promise.all([
        api("/api/imagegen/upscalers").catch(() => []),
        api("/api/imagegen/upscaler-previews").catch(() => ({})),
      ]);
      this.upscalers = upscalers;
      this.upscalerPreviews = previews;
    }
    this.upscalePickerOpen = true;
    this.render();
  }

  upscalePickerHtml() {
    if (!this.upscalePickerOpen) return "";
    if (!this.upscalers.length) {
      return `<div style="margin-bottom:16px"><p style="font-size:12.5px;color:var(--color-sec)">No upscaler models available.</p></div>`;
    }
    return `
      <div style="margin-bottom:16px;padding:14px;border:1px solid var(--color-line);border-radius:14px;background:var(--color-surface)">
        <label class="grimoire-field-label">Choose an upscaler</label>
        <div style="display:flex;gap:8px;overflow-x:auto">
          ${this.upscalers.map((u) => {
            const p = this.upscalerPreviews[u];
            const art = p?.image ? `background-image:url('${p.image}')` : "background:var(--color-surface-2)";
            const label = p?.display_name || u;
            return `
              <button type="button" onclick="_activeForgeView.runUpscale('${u.replace(/'/g, "\\'")}')" style="flex:none;width:78px;display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
                <span class="sanctum-specimen" style="width:64px;height:64px;border-radius:12px;${art}">${p?.image ? "" : label[0].toUpperCase()}</span>
                <span style="font-size:10.5px;text-align:center;color:var(--color-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${label}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  async runUpscale(upscalerName) {
    if (!this.lastResult || this.upscaling) return;
    this.upscaling = true;
    this.upscalePickerOpen = false;
    this.busy = true;
    this.previewImage = this.lastResult.image;
    this.render();
    try {
      const res = await fetch(`${API}/api/imagegen/upscale/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: this.lastResult.image, upscaler: upscalerName }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (ev.type === "preview") {
          this.previewImage = ev.image;
          const img = this.main.querySelector("#forgePreviewBox img");
          if (img) img.src = ev.image;
        } else if (ev.type === "done") {
          this.busy = false;
          this.upscaling = false;
          this.lastResult = { ...this.lastResult, image: ev.image, upscaler: upscalerName };
          this.render();
        } else if (ev.type === "error") {
          this.busy = false;
          this.upscaling = false;
          errorToast(ev.message || "Upscale failed.");
          this.render();
        }
      });
    } catch (err) {
      this.busy = false;
      this.upscaling = false;
      errorToast(err.message || "Upscale failed.");
      this.render();
    }
  }

  recentStripHtml() {
    if (!this.recent.length) return "";
    return `
      <div style="margin-bottom:16px">
        <div class="grimoire-field-label" style="margin-bottom:8px">Recent</div>
        <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">
          ${this.recent.map((r) => `
            <button type="button" onclick="_activeForgeView.viewRecent('${r.id}')" style="flex:none;width:84px;height:84px;border-radius:12px;border:1px solid var(--color-line);overflow:hidden;padding:0;cursor:pointer;background:var(--color-surface-2)">
              <img src="${r.image}" style="width:100%;height:100%;object-fit:cover">
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  viewRecent(id) {
    const rec = this.recent.find((r) => r.id === id);
    if (!rec) return;
    this.lastResult = { image: rec.image, body: this.buildBody(), isImg2img: !!rec.is_img2img };
    this.render();
  }
```

- [ ] **Step 2: Wire `upscalePickerHtml()` and `recentStripHtml()` into `render()`**

In `new_ui/js/forge.js`, replace the `render()` method's `innerHTML` template one final time:

```javascript
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
      ${this.modeArchRowHtml()}
      ${this.previewBoxHtml()}
      ${this.upscalePickerHtml()}
      ${this.promptBlockHtml()}
      ${this.denoiseRowHtml()}
      ${this.aspectRowHtml()}
      ${this.modelPickerHtml()}
      ${this.loraSectionHtml()}
      ${this.advancedHtml()}
      ${this.recentStripHtml()}
      ${this.generateBarHtml()}
    `;
```

- [ ] **Step 3: Manually verify against `:3001`**

Generate an image (or use a completed result from Task 4's verification). Tap Save — confirm a `toast("Saved to your gallery.")` fires and `GET /api/imagegen/standalone` (via curl with the login cookie) now includes the new record. Tap Upscale — confirm the upscaler picker appears inline with thumbnail tiles; pick one — confirm the same live-preview behavior as generation, ending with the upscaled image replacing the preview. Confirm the Recent strip appears after the first successful Save, showing a thumbnail; tap it — confirm it re-shows in the preview box.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/js/forge.js
git add new_ui/js/forge.js
git commit -m "Add Forge save, upscale picker, and session-local recent strip"
```

---

### Task 6: Forge CSS

**Files:**
- Modify: `new_ui/css/cards.css`

**Interfaces:**
- Consumes: existing `.filter-chip`, `.grimoire-field-label`, `.grimoire-field-textarea`, `.sanctum-specimen`, `.pe-gen-btn` (all reused as-is by `forge.js`, no changes needed to those). Theme custom properties from `themes.css`.
- Produces: `.forge-img-act`, `.forge-generate-btn` — the two new classes `forge.js` references that don't already exist elsewhere.

- [ ] **Step 1: Append the CSS block**

Re-read the current tail of `new_ui/css/cards.css` first (shared checkout, other agents may have appended more since this plan was written), then append:

```css
.forge-img-act {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, .2);
  background: rgba(10, 10, 12, .5);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  backdrop-filter: blur(6px);
}
.forge-generate-btn {
  width: 100%;
  padding: 15px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  font-size: 15.5px;
  color: var(--color-paper-base);
  background: linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));
  box-shadow: 0 10px 24px -12px color-mix(in srgb, var(--color-accent) 55%, transparent);
}
```

- [ ] **Step 2: Verify the stylesheet loads with the new classes**

```bash
curl -s http://localhost:3001/css/cards.css | grep -c "forge-img-act\|forge-generate-btn"
```

Expected: non-zero.

- [ ] **Step 3: Manually verify in a browser**

Reload `/sanctum/forge`. Confirm the Generate button reads as an accent-gradient full-width pill matching the visual weight of Grimoire's Save button; confirm the Save/Upscale/Regenerate overlay buttons on a completed result look like small frosted-glass circular icon buttons over the image, not bare unstyled `<button>`s. Switch theme (light/dark × at least one accent) and confirm both stay theme-reactive.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/css/cards.css
git add new_ui/css/cards.css
git commit -m "Style Forge: image action buttons, generate bar"
```

---

## Post-plan verification checklist

- [ ] `/sanctum/forge` renders the full form: mode/architecture toggle, preview box, prompt, aspect chips, model/LoRA/advanced controls, generate bar.
- [ ] txt2img generation works end-to-end if ComfyUI is reachable in this environment: live preview frames visibly update, final result shows with action buttons, Save persists a real row (confirmed via `GET /api/imagegen/standalone`).
- [ ] img2img: reference image upload works, denoise slider only shows in this mode, generation actually uses the reference (verify via the saved record).
- [ ] Architecture toggle refetches the correct checkpoint list (`checkpoints` vs `anima-unets`).
- [ ] Cancel actually stops generation (no further preview frames, confirmed via server logs or the button reverting).
- [ ] Upscale picker shows real upscaler options and produces a re-encoded result.
- [ ] Every fetch failure path (models, generate, save, upscale) shows a real error message via toast, never a silently stuck UI.
- [ ] No fake progress percentage, no seed field, no video/inpaint UI anywhere on this screen.
- [ ] Theme switching leaves nothing on this screen a fixed, non-reactive color.
