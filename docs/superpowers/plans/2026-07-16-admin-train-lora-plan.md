# Admin Train LoRA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new admin-only "Train LoRA" screen in `new_ui`, porting `legacy_ui/js/lora-training.js` feature-for-feature, restyled for new_ui's mobile-first Tailwind design, with the loss chart done in Chart.js instead of legacy's hand-rolled canvas.

**Architecture:** One new file, `new_ui/js/admin-train.js`, exporting `class AdminTrainView` mounted by a new `admin-train` router entry. Four tabs (Train / Progress / Test / Jobs) rendered by one class instance — tab state and form state live on `this`, not the DOM, so switching tabs doesn't lose in-progress input. No backend changes: `backend/routers/lora_training.py` already implements the full contract.

**Tech Stack:** Vanilla JS (no framework, no build step — matches every other `new_ui/js/*.js` file), Tailwind utility classes + `--color-*` CSS custom properties, Chart.js 4.5.0 (already loaded globally via `new_ui/index.html`'s `<script>` tag — no new script tag needed).

## Global Constraints

- No comments in code, ever (project-wide rule — self-documenting via naming/structure; explanations belong in the PR description or chat, never the file).
- Real per-instance state → class (`AdminTrainView`, and a `TrainingJobWatcher` sub-class for the polling logic) — not free-floating module state, not classes wrapping stateless logic.
- No 4th-level indentation — extract a function/early-return instead.
- Every mutating action that can fail gets a caught error surfaced via `errorToast`, never swallowed.
- Route must redirect non-admin/dev users to `/compendium`, matching every other `admin-*` route in `new_ui/js/router.js`.
- Client-side form validation ranges must exactly mirror the backend's (`backend/routers/lora_training.py`'s `create_and_stream_lora_training_job`): resolution 256–1024 multiple of 64, batch 1–8, rank/alpha 1–128, learning_rate >0 and ≤0.01, ≥5 images, non-empty name, non-empty single-word trigger.
- No new JS test framework exists in this repo (no `package.json`, no `*.test.js` anywhere) — verification is manual, live, via Playwright against the running dev server, matching this session's established practice for every other `new_ui` change.
- Never start a real training job during automated/live verification — it rents a real GPU and bills immediately. Verify Progress-tab rendering against an already-existing job's persisted state instead.

---

### Task 1: Route scaffold + tab shell + Admin overview link

**Files:**
- Create: `new_ui/js/admin-train.js`
- Modify: `new_ui/js/router.js` (add route entry + back-target)
- Modify: `new_ui/index.html` (add `<script src="/js/admin-train.js" defer></script>` after `admin-previews.js`)
- Modify: `new_ui/js/admin.js` (add a card/link to the new screen on the Admin overview)

**Interfaces:**
- Produces: `class AdminTrainView` with `mount(main)`, `render()`, `switchTab(tab)` — `this.tab` one of `"train"|"progress"|"test"|"jobs"`. Later tasks fill in each tab's body via `this.trainTabHtml()` / `this.progressTabHtml()` / `this.testTabHtml()` / `this.jobsTabHtml()`, each returning `""` for now (filled in by Tasks 2–5). `window.AdminTrainView = AdminTrainView;` at the bottom, matching every other view file.

- [ ] **Step 1: Read the existing router pattern**

Read `new_ui/js/router.js` lines around the `"admin-previews"` entry (search for `admin-previews`) — copy its exact role-guard shape for the new `"admin-train"` entry, and find the `BACK_TARGETS` object (search for `"admin-previews": "dossier"`) to add `"admin-train": "dossier"` alongside it.

- [ ] **Step 2: Write the file**

```js
"use strict";

const ADMIN_TRAIN_TABS = [
  { key: "train", label: "Train" },
  { key: "progress", label: "Progress" },
  { key: "test", label: "Test" },
  { key: "jobs", label: "Jobs" },
];

class AdminTrainView {
  async mount(main) {
    this.main = main;
    this.tab = "train";
    this.checkpoints = [];
    this.checkpointPreviews = {};
    this.animaNames = new Set();
    this.jobs = [];
    this.watcher = new TrainingJobWatcher();
    this.render();
    await this.loadCheckpoints();
    await this.loadJobs();
    this.attachRunningWatcherIfAny();
  }

  async loadCheckpoints() {
    const [checkpoints, animaUnets, previews] = await Promise.all([
      api("/api/imagegen/checkpoints").catch(() => []),
      api("/api/imagegen/anima-unets").catch(() => []),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
    ]);
    this.checkpoints = [...checkpoints, ...animaUnets];
    this.animaNames = new Set(animaUnets);
    this.checkpointPreviews = previews;
    this.render();
  }

  async loadJobs() {
    this.jobs = await api("/api/admin/lora-training/jobs").catch(() => []);
    this.render();
  }

  attachRunningWatcherIfAny() {
    const active = this.jobs.find((j) => ["queued", "provisioning", "training", "saving"].includes(j.status));
    if (active) this.watchJob(active.id);
  }

  switchTab(tab) {
    this.tab = tab;
    this.render();
  }

  tabBarHtml() {
    return `
      <div class="flex gap-2 mb-4 overflow-x-auto">
        ${ADMIN_TRAIN_TABS.map((t) => `
          <button type="button" onclick="adminTrainView.switchTab('${t.key}')"
            class="px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap ${this.tab === t.key ? "text-paper bg-gradient-to-br from-primary to-primary-dark" : "text-ink border border-line"}">
            ${_esc(t.label)}
          </button>
        `).join("")}
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", "Train LoRA", "Train a custom LoRA on a rented cloud GPU, then test the result.")}
      ${this.tabBarHtml()}
      ${this.tab === "train" ? this.trainTabHtml() : ""}
      ${this.tab === "progress" ? this.progressTabHtml() : ""}
      ${this.tab === "test" ? this.testTabHtml() : ""}
      ${this.tab === "jobs" ? this.jobsTabHtml() : ""}
    `;
    this.wireTab();
  }

  wireTab() {}

  trainTabHtml() { return `<p class="text-sm text-muted">Train tab — coming in Task 2.</p>`; }
  progressTabHtml() { return `<p class="text-sm text-muted">Progress tab — coming in Task 4.</p>`; }
  testTabHtml() { return `<p class="text-sm text-muted">Test tab — coming in Task 6.</p>`; }
  jobsTabHtml() { return `<p class="text-sm text-muted">Jobs tab — coming in Task 5.</p>`; }

  watchJob(jobId) {}
}

class TrainingJobWatcher {
  constructor() {
    this.jobId = null;
    this.interval = null;
  }

  get isWatching() { return this.interval != null; }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }
}

if (typeof window !== "undefined") {
  window.AdminTrainView = AdminTrainView;
}
```

- [ ] **Step 3: Wire the router**

In `new_ui/js/router.js`, add next to the `"admin-previews"` entry:

```js
"admin-train": (main) => {
  if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/compendium"); return; }
  window.adminTrainView = new AdminTrainView();
  window.adminTrainView.mount(main);
},
```

And in the `BACK_TARGETS` object, next to `"admin-previews": "dossier",`:

```js
"admin-train": "dossier",
```

- [ ] **Step 4: Add the script tag**

In `new_ui/index.html`, immediately after the line `<script src="/js/admin-previews.js" defer></script>`, add:

```html
<script src="/js/admin-train.js" defer></script>
```

- [ ] **Step 5: Add an Admin overview link**

Read `new_ui/js/admin.js`'s card list (search for `admin-previews` there — the Admin overview likely links to it as a card/button with `navigate("/admin-previews")` or `data-route="admin-previews"`). Add a matching card for `admin-train` with label "Train LoRA" and a short description "Train a custom LoRA on a rented GPU", following the exact same markup pattern as the existing preview-curation card.

- [ ] **Step 6: Verify live**

Start from the human's already-running `./rebuild.sh --watch` dev server on :3001 (per project convention) — actually for this session, verification target is the public domain `https://storyhavenai.sillysillysupersillydomain.win` per standing instruction. Log in as `claude`/`0987654321`, navigate to `/admin-train`, confirm: page loads with no console errors, all 4 tab buttons render, clicking each one switches the active tab's highlight and body placeholder text, back-link returns to Admin. Also confirm a non-admin (`test`/`11111111`) hitting `/admin-train` directly gets redirected to `/compendium`.

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/admin-train.js new_ui/js/router.js new_ui/index.html new_ui/js/admin.js
git commit -m "Add admin Train LoRA route scaffold with 4-tab shell"
```

---

### Task 2: Train tab — form fields, checkpoint picker, validation

**Files:**
- Modify: `new_ui/js/admin-train.js`

**Interfaces:**
- Consumes: `this.checkpoints` (array of names), `this.checkpointPreviews` (map), `this.animaNames` (Set) — populated by Task 1's `loadCheckpoints()`.
- Produces: `this.form` object holding every field's current value (`name`, `trigger_word`, `checkpoint`, `resolution`, `batch_size`, `rank`, `alpha`, `learning_rate`, `steps`, `noise_offset`, `network_dropout`, `advancedOpen`), initialized with the spec's defaults. `validateTrainForm()` returning a string array of error messages (empty = valid) — Task 3 and Task 4 both call this before submit.

- [ ] **Step 1: Add form state to the constructor**

In `mount()`, before `this.render()`, add:

```js
this.form = {
  name: "", trigger_word: "sks", checkpoint: "",
  resolution: 512, batch_size: 1, rank: 16, alpha: 16,
  learning_rate: 0.0001, steps: 1000,
  noise_offset: 0, network_dropout: 0,
  advancedOpen: false,
};
```

- [ ] **Step 2: Implement the checkpoint picker (reusing Forge's pattern)**

Read `new_ui/js/forge.js`'s `modelThumbHtml`, `modelPickerHtml`, `openModelPicker`, `modelPickerModalHtml`, `renderModelPickerGrid`, `renderModelPickerDetail` (lines ~509–600) — this task ports the same tap-to-open-grid pattern into `AdminTrainView`, sourced from `this.checkpoints`/`this.checkpointPreviews` instead of `ForgeView`'s own fields. Add these methods to `AdminTrainView`:

```js
  checkpointThumbHtml(name, size) {
    const p = this.checkpointPreviews[name];
    const img = p?.image;
    const label = p?.display_name || name || "?";
    const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)`;
    return img
      ? `<span style="${style}"><img src="${_attr(img)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
      : `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(label[0].toUpperCase())}</span>`;
  }

  checkpointPickerHtml() {
    const p = this.checkpointPreviews[this.form.checkpoint];
    const label = p?.display_name || this.form.checkpoint || "Choose a checkpoint";
    return `
      <div class="mb-4">
        <label class="grimoire-field-label">Base checkpoint</label>
        <button type="button" onclick="adminTrainView.openCheckpointPicker()" style="width:100%;display:flex;align-items:center;gap:12px;padding:10px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;cursor:pointer;text-align:left">
          ${this.checkpointThumbHtml(this.form.checkpoint, 52)}
          <span style="flex:1;min-width:0">
            <span style="display:block;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(label)}</span>
            <span style="display:block;font-size:11.5px;color:var(--color-muted);margin-top:2px">${this.checkpoints.length} installed</span>
          </span>
          <span style="color:var(--color-muted);flex:none">&rsaquo;</span>
        </button>
        <div class="hint text-xs text-muted mt-1">The existing model this LoRA will be trained on top of. Pick whichever checkpoint you plan to actually use it with later.</div>
      </div>
    `;
  }

  openCheckpointPicker() {
    this._cpQuery = "";
    this._cpPicked = this.form.checkpoint;
    openModal(`
      <h3>Choose a base checkpoint</h3>
      <input type="text" id="cpSearch" placeholder="Search checkpoints…" value="" style="width:100%;margin-bottom:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)">
      <div id="cpGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px;max-height:360px;overflow-y:auto;padding:2px"></div>
    `, { wide: true });
    document.getElementById("cpSearch").oninput = (e) => { this._cpQuery = e.target.value; this.renderCheckpointPickerGrid(); };
    this.renderCheckpointPickerGrid();
  }

  renderCheckpointPickerGrid() {
    const grid = document.getElementById("cpGrid");
    if (!grid) return;
    const q = (this._cpQuery || "").trim().toLowerCase();
    let list = this.checkpoints;
    if (q) list = list.filter((n) => n.toLowerCase().includes(q) || (this.checkpointPreviews[n]?.display_name || "").toLowerCase().includes(q));
    grid.innerHTML = list.length ? list.map((name) => {
      const p = this.checkpointPreviews[name];
      const label = p?.display_name || name;
      return `
        <button type="button" data-cp-name="${_attr(name)}" style="display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer">
          ${this.checkpointThumbHtml(name, 64)}
          <span style="font-size:10.5px;text-align:center;color:var(--color-sec);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px">${_esc(label)}</span>
        </button>
      `;
    }).join("") : `<p style="font-size:12.5px;color:var(--color-sec);grid-column:1/-1">No checkpoints match.</p>`;
    grid.querySelectorAll("[data-cp-name]").forEach((b) => b.onclick = () => {
      this.form.checkpoint = b.dataset.cpName;
      closeTopModal();
      this.render();
    });
  }
```

- [ ] **Step 3: Implement the training-parameters section**

```js
  trainParamsHtml() {
    const f = this.form;
    return `
      <div class="mb-4">
        <label class="grimoire-field-label">Name</label>
        <input type="text" id="lt_name" value="${_attr(f.name)}" placeholder="my-character-lora" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <div class="text-xs text-muted mt-1">Just a label to tell this training job apart from others later — doesn't affect the result.</div>
      </div>
      <div class="mb-4">
        <label class="grimoire-field-label">Trigger word</label>
        <input type="text" id="lt_trigger" value="${_attr(f.trigger_word)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <div class="text-xs text-muted mt-1">A made-up word (like "sks") you'll type in prompts later to summon this LoRA's look. Keep it short and not a real word.</div>
      </div>
      ${this.checkpointPickerHtml()}
      <div class="grid grid-cols-2 gap-3 mb-2">
        ${this.numberFieldHtml("lt_res", "Resolution", f.resolution)}
        ${this.numberFieldHtml("lt_batch", "Batch size", f.batch_size)}
        ${this.numberFieldHtml("lt_rank", "Rank", f.rank)}
        ${this.numberFieldHtml("lt_alpha", "Alpha", f.alpha)}
        ${this.numberFieldHtml("lt_lr", "Learning rate", f.learning_rate)}
        ${this.numberFieldHtml("lt_steps", "Steps", f.steps)}
      </div>
      <div class="text-xs text-muted mb-4 leading-relaxed">
        <b>Resolution</b>: pixel size images are trained at (512 is the safe default; up to 1024 needs more VRAM/time).<br>
        <b>Batch size</b>: how many images processed at once — higher is faster but uses more GPU memory. Leave at 1 if unsure.<br>
        <b>Rank</b>: how much the LoRA can learn — 16 is a solid default; higher (32-64) for a complex look, lower (4-8) for a simple one.<br>
        <b>Alpha</b>: strength scaling for Rank — leave equal to Rank unless you know you want a different effect.<br>
        <b>Learning rate</b>: how fast it learns per step — 0.0001 is a safe default; too high can wreck the result.<br>
        <b>Steps</b>: total training iterations — more = more learning but risks overfitting if pushed too far.
      </div>
      <div style="border:1px solid var(--color-line);border-radius:14px;overflow:hidden;margin-bottom:16px">
        <button type="button" onclick="adminTrainView.form.advancedOpen = !adminTrainView.form.advancedOpen; adminTrainView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink)">
          <span style="flex:1;text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted)">Advanced</span>
          <span style="transform:rotate(${f.advancedOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${f.advancedOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line)">
            <div class="grid grid-cols-2 gap-3 mb-2">
              ${this.numberFieldHtml("lt_noise_offset", "Noise offset", f.noise_offset)}
              ${this.numberFieldHtml("lt_network_dropout", "Network dropout", f.network_dropout)}
            </div>
            <div class="text-xs text-muted leading-relaxed">
              <b>Noise offset</b> (0-1, default 0/off): helps produce truly dark/bright images instead of drifting to mid-gray — try ~0.05-0.1 if outputs look washed out.<br>
              <b>Network dropout</b> (0-1, default 0/off): randomly drops some LoRA weights during training to reduce overfitting — try ~0.1-0.2 if the result looks baked-in.
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  numberFieldHtml(id, label, value) {
    return `
      <div>
        <label class="text-xs text-sec block mb-1">${_esc(label)}</label>
        <input type="text" inputmode="decimal" id="${_attr(id)}" value="${_attr(value)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
    `;
  }
```

- [ ] **Step 4: Implement validation**

```js
  validateTrainForm() {
    const f = this.form;
    const errors = [];
    if (!f.name.trim()) errors.push("Name is required.");
    if (!f.trigger_word.trim()) errors.push("Trigger word is required.");
    else if (/\s/.test(f.trigger_word.trim())) errors.push("Trigger word must be a single word, no spaces.");
    if (!f.checkpoint) errors.push("Pick a base checkpoint.");
    const imageCount = (this.trainImages || []).length;
    if (!imageCount) errors.push("Training images are required — pick at least one.");
    else if (imageCount < 5) errors.push("Pick at least 5 training images — fewer than that won't train a usable LoRA.");
    const res = Number(f.resolution);
    if (!Number.isInteger(res) || res < 256 || res > 1024) errors.push("Resolution must be a whole number between 256 and 1024.");
    else if (res % 64 !== 0) errors.push("Resolution must be a multiple of 64.");
    const batch = Number(f.batch_size);
    if (!Number.isInteger(batch) || batch < 1 || batch > 8) errors.push("Batch size must be a whole number between 1 and 8.");
    const rank = Number(f.rank);
    if (!Number.isInteger(rank) || rank < 1 || rank > 128) errors.push("Rank must be a whole number between 1 and 128.");
    const alpha = Number(f.alpha);
    if (!Number.isInteger(alpha) || alpha < 1 || alpha > 128) errors.push("Alpha must be a whole number between 1 and 128.");
    const steps = Number(f.steps);
    if (!Number.isInteger(steps) || steps < 50 || steps > 20000) errors.push("Steps must be a whole number between 50 and 20000.");
    const lr = Number(f.learning_rate);
    if (!(lr > 0) || lr > 0.01) errors.push("Learning rate must be a positive number no greater than 0.01.");
    return errors;
  }
```

- [ ] **Step 5: Wire field inputs and replace `trainTabHtml()`**

```js
  trainTabHtml() {
    return `
      <div class="mb-6">
        ${this.trainParamsHtml()}
        <div id="lt_images_section"></div>
        <div class="flex items-center gap-3 mt-4">
          <button type="button" id="lt_start" class="flex-1 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">Start training</button>
          <span id="lt_time_est" class="text-xs text-muted font-mono"></span>
        </div>
        <div class="text-xs text-muted mt-2">Training runs on a rented cloud GPU and can take minutes to hours depending on Steps/Resolution/Batch size — watch live progress in the Progress tab once it starts.</div>
      </div>
    `;
  }
```

In `wireTab()`, add (guarded so it only wires when the Train tab is active):

```js
  wireTab() {
    if (this.tab === "train") this.wireTrainTab();
  }

  wireTrainTab() {
    [["lt_name", "name"], ["lt_trigger", "trigger_word"], ["lt_res", "resolution"], ["lt_batch", "batch_size"],
     ["lt_rank", "rank"], ["lt_alpha", "alpha"], ["lt_lr", "learning_rate"], ["lt_steps", "steps"],
     ["lt_noise_offset", "noise_offset"], ["lt_network_dropout", "network_dropout"]]
      .forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.oninput = (e) => { this.form[key] = e.target.value; };
      });
    const startBtn = document.getElementById("lt_start");
    if (startBtn) startBtn.onclick = () => {
      const errors = this.validateTrainForm();
      if (errors.length) { errorToast(errors[0]); return; }
      toast("Submit wiring lands in Task 4.");
    };
  }
```

- [ ] **Step 6: Verify live**

On `/admin-train`, Train tab: type a name/trigger, open the checkpoint picker, search, pick one and confirm it shows in the summary row with thumbnail; toggle Advanced open/closed; edit every numeric field and confirm the value sticks after switching to another tab and back (state lives on `this.form`, not the DOM); click Start with an empty form and confirm the first validation error toasts.

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/admin-train.js
git commit -m "Add Train LoRA form fields, checkpoint picker, and validation"
```

---

### Task 3: Train tab — training images grid with caption modal + bulk import

**Files:**
- Modify: `new_ui/js/admin-train.js`

**Interfaces:**
- Consumes: none new.
- Produces: `this.trainImages` (array of `File`), `this.trainCaptions` (parallel array of strings, same index as `trainImages`) — Task 4's submit step reads both directly.

- [ ] **Step 1: Add image state**

In `mount()`, alongside `this.form`, add:

```js
this.trainImages = [];
this.trainCaptions = [];
```

- [ ] **Step 2: Implement the image grid + caption modal**

```js
  imagesGridHtml() {
    const files = this.trainImages;
    return `
      <div class="mb-4">
        <label class="grimoire-field-label">Training images</label>
        <div class="flex items-center gap-2 mb-2">
          <label class="px-3 py-1.5 rounded-md border border-line text-xs text-ink cursor-pointer">
            Add images
            <input type="file" id="lt_images_input" accept="image/png,image/jpeg,image/webp" multiple class="hidden">
          </label>
          <label class="px-3 py-1.5 rounded-md border border-line text-xs text-ink cursor-pointer">
            Import captions (.txt)
            <input type="file" id="lt_captions_input" accept=".txt" multiple class="hidden">
          </label>
          <button type="button" id="lt_images_clear" class="px-3 py-1.5 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Remove all</button>
        </div>
        <span class="text-xs text-muted">${files.length ? `${files.length} image${files.length === 1 ? "" : "s"} selected` : ""}</span>
        <div class="grid gap-2 mt-2" style="grid-template-columns:repeat(auto-fill,minmax(84px,1fr))">
          ${files.map((f, i) => this.imageTileHtml(f, i)).join("")}
        </div>
        <div class="text-xs text-muted mt-2 leading-relaxed">
          Pick 10+ clear images, ideally cropped similarly. Tap any thumbnail to zoom in and caption it with whatever's <b>not</b> the thing you want the trigger word to mean — this keeps that one thing consistent instead of the LoRA blending everything together. Leave blank to just use the trigger word for that image.
        </div>
      </div>
    `;
  }

  imageTileHtml(file, i) {
    if (!this._imageUrls) this._imageUrls = new Map();
    if (!this._imageUrls.has(file)) this._imageUrls.set(file, URL.createObjectURL(file));
    const url = this._imageUrls.get(file);
    const hasCaption = !!(this.trainCaptions[i] || "").trim();
    return `
      <button type="button" data-img-tile="${i}" style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;border:1px solid var(--color-line);cursor:pointer;padding:0">
        <img src="${_attr(url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">
        ${hasCaption ? `<span style="position:absolute;top:3px;left:3px;width:8px;height:8px;border-radius:50%;background:var(--color-accent)"></span>` : ""}
      </button>
    `;
  }

  openImageCaptionModal(i) {
    const url = this._imageUrls.get(this.trainImages[i]);
    openModal(`
      <img src="${_attr(url)}" alt="" class="w-full rounded-lg mb-3">
      <div class="mb-3">
        <label class="text-xs text-sec block mb-1">Caption tags for this image</label>
        <input type="text" id="ic_caption" value="${_attr(this.trainCaptions[i] || "")}" placeholder="tags for this image (what's NOT the trigger concept)" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <button type="button" id="ic_remove" class="w-full py-2 rounded-md border text-sm" style="border-color:var(--color-warn);color:var(--color-warn)">Remove image</button>
    `);
    document.getElementById("ic_caption").oninput = (e) => { this.trainCaptions[i] = e.target.value; };
    document.getElementById("ic_remove").onclick = () => {
      this.trainImages.splice(i, 1);
      this.trainCaptions.splice(i, 1);
      closeTopModal();
      this.render();
    };
  }
```

- [ ] **Step 3: Wire the image controls**

Add to `wireTrainTab()`:

```js
    const imagesSection = document.getElementById("lt_images_section");
    if (imagesSection) imagesSection.innerHTML = this.imagesGridHtml();
    document.querySelectorAll("[data-img-tile]").forEach((b) => b.onclick = () => this.openImageCaptionModal(parseInt(b.dataset.imgTile, 10)));
    const imagesInput = document.getElementById("lt_images_input");
    if (imagesInput) imagesInput.onchange = () => {
      const newFiles = [...imagesInput.files];
      this.trainImages.push(...newFiles);
      newFiles.forEach(() => this.trainCaptions.push(""));
      this.render();
    };
    const clearBtn = document.getElementById("lt_images_clear");
    if (clearBtn) clearBtn.onclick = () => {
      this.trainImages = [];
      this.trainCaptions = [];
      this.render();
    };
    const captionsInput = document.getElementById("lt_captions_input");
    if (captionsInput) captionsInput.onchange = async () => {
      const txtFiles = [...captionsInput.files];
      if (!txtFiles.length) return;
      const stem = (n) => n.replace(/\.[^.]+$/, "");
      const byStem = new Map(txtFiles.map((f) => [stem(f.name), f]));
      let matched = 0;
      for (let i = 0; i < this.trainImages.length; i++) {
        const match = byStem.get(stem(this.trainImages[i].name));
        if (!match) continue;
        this.trainCaptions[i] = (await match.text()).trim();
        matched++;
      }
      captionsInput.value = "";
      this.render();
      toast(matched ? `Imported ${matched} caption(s) matched by filename.` : "No .txt filenames matched the current image filenames.");
    };
```

- [ ] **Step 4: Verify live**

Add several images via "Add images", confirm thumbnails render; tap one, add a caption, confirm the accent dot appears on that tile after closing the modal; tap another and hit "Remove image", confirm it's gone from the grid and the count updates; use "Remove all" and confirm the grid empties.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/admin-train.js
git commit -m "Add training-image grid with per-image caption modal and .txt bulk import"
```

---

### Task 4: Cost estimate + Start training submission

**Files:**
- Modify: `new_ui/js/admin-train.js`

**Interfaces:**
- Consumes: `this.jobs` (Task 1), `this.form`/`this.trainImages`/`this.trainCaptions` (Tasks 2–3), `this.watchJob(jobId)` (stubbed in Task 1, implemented in Task 5).
- Produces: `this.updateTimeEstimate()`, `this.submitTraining()`.

- [ ] **Step 1: Implement the cost/time estimate**

```js
  estimateTrainingRun(architecture, steps, batchSize) {
    const speeds = [];
    (this.jobs || []).forEach((j) => {
      if (j.architecture !== architecture) return;
      (j.metrics || []).forEach((m) => { if (m.speed_img_s > 0) speeds.push(m.speed_img_s); });
    });
    const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : (architecture === "anima" ? 0.35 : 0.8);
    const trainSeconds = (steps * batchSize) / avgSpeed;
    const totalSeconds = trainSeconds + 5 * 60;
    const totalHours = totalSeconds / 3600;
    return { seconds: totalSeconds, cost: totalHours * 0.80, fromHistory: speeds.length > 0 };
  }

  formatDuration(seconds) {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  updateTimeEstimate() {
    const pill = document.getElementById("lt_time_est");
    if (!pill) return;
    const f = this.form;
    const steps = Number(f.steps), batch = Number(f.batch_size);
    if (!f.checkpoint || !steps || !batch || steps <= 0 || batch <= 0) { pill.textContent = ""; return; }
    const architecture = this.animaNames.has(f.checkpoint) ? "anima" : "sdxl";
    const est = this.estimateTrainingRun(architecture, steps, batch);
    const imageCount = this.trainImages.length;
    const seenTxt = imageCount ? ` · sees each image ~${Math.round((steps * batch) / imageCount)}×` : "";
    pill.textContent = `~${this.formatDuration(est.seconds)} · ~$${est.cost.toFixed(2)} est.${est.fromHistory ? "" : " (rough)"}${seenTxt}`;
  }
```

- [ ] **Step 2: Call `updateTimeEstimate()` from every field that affects it**

In `wireTrainTab()`, at the end of the numeric-field loop's callback and the checkpoint-picker's `onclick`/image-add handlers, add a call to `this.updateTimeEstimate()`. Concretely, change the numeric-field wiring loop body to:

```js
        const el = document.getElementById(id);
        if (el) el.oninput = (e) => { this.form[key] = e.target.value; this.updateTimeEstimate(); };
```

And add `this.updateTimeEstimate();` as the last line of `wireTrainTab()` itself (so it also runs right after every render, picking up the checkpoint/image-count already set).

- [ ] **Step 3: Implement submission**

```js
  async submitTraining() {
    const errors = this.validateTrainForm();
    if (errors.length) { errorToast(errors[0]); return; }
    if (!confirm("Start training on a rented cloud GPU? This begins incurring cost immediately and typically runs for a while. Double-check your settings first.")) return;
    const f = this.form;
    const fd = new FormData();
    fd.append("name", f.name.trim());
    fd.append("trigger_word", f.trigger_word.trim());
    fd.append("local_checkpoint", f.checkpoint);
    fd.append("architecture", this.animaNames.has(f.checkpoint) ? "anima" : "sdxl");
    fd.append("resolution", String(f.resolution));
    fd.append("rank", String(f.rank));
    fd.append("alpha", String(f.alpha));
    fd.append("learning_rate", String(f.learning_rate));
    fd.append("steps", String(f.steps));
    fd.append("batch_size", String(f.batch_size));
    fd.append("noise_offset", String(f.noise_offset || 0));
    fd.append("network_dropout", String(f.network_dropout || 0));
    fd.append("captions", JSON.stringify(this.trainImages.map((_, i) => this.trainCaptions[i] || "")));
    this.trainImages.forEach((file) => fd.append("images", file, file.name));

    const startBtn = document.getElementById("lt_start");
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = "Starting…"; }
    try {
      const resp = await api("/api/admin/lora-training/jobs", { method: "POST", body: fd });
      this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
      this.tab = "progress";
      this.render();
      this.watchJob(resp.job_id);
    } catch (err) {
      errorToast(err.message || "Training request failed.");
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = "Start training"; }
    }
  }
```

- [ ] **Step 4: Wire the Start button to the real submit**

In `wireTrainTab()`, replace the placeholder `startBtn.onclick`:

```js
    if (startBtn) startBtn.onclick = () => this.submitTraining();
```

- [ ] **Step 5: Verify live (without actually starting a real job)**

Fill the form with valid values except leave images empty, click Start, confirm the "at least one training image" error toasts and no `confirm()` dialog or network request fires. Add 5+ tiny placeholder images, fill valid values, click Start, confirm the native `confirm()` dialog appears with the expected cost-warning text, then click Cancel and confirm nothing was submitted (no job appears in Jobs tab, no GPU cost incurred). Do not click OK — that starts a real billed GPU run.

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/admin-train.js
git commit -m "Add cost/time estimate and Start training submission"
```

---

### Task 5: Progress tab — TrainingJobWatcher, log, metrics, Chart.js loss chart

**Files:**
- Modify: `new_ui/js/admin-train.js`

**Interfaces:**
- Consumes: `TrainingJobWatcher` skeleton from Task 1.
- Produces: full `TrainingJobWatcher.watch(jobId, refs, onSettled)`; `AdminTrainView.watchJob(jobId)`, `progressTabHtml()`.

- [ ] **Step 1: Flesh out `TrainingJobWatcher`**

Replace the Task 1 skeleton class with:

```js
class TrainingJobWatcher {
  constructor() {
    this.jobId = null;
    this.interval = null;
    this.consecutiveFailures = 0;
    this.onVisible = null;
    this.chart = null;
  }

  get isWatching() { return this.interval != null; }

  stop() {
    clearInterval(this.interval);
    this.interval = null;
    this.consecutiveFailures = 0;
    if (this.onVisible) { document.removeEventListener("visibilitychange", this.onVisible); this.onVisible = null; }
  }

  appendLog(logEl, line) {
    if (!logEl || !line) return;
    const lines = logEl.dataset.lines ? JSON.parse(logEl.dataset.lines) : [];
    if (lines[lines.length - 1] === line) return;
    const wasAtBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 20;
    lines.push(line);
    if (lines.length > 200) lines.shift();
    logEl.dataset.lines = JSON.stringify(lines);
    logEl.textContent = lines.join("\n");
    if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  renderMetricsTable(tbody, metrics, job) {
    if (!tbody) return;
    const arr = metrics || [];
    const m = arr[arr.length - 1];
    if (!m) { tbody.innerHTML = ""; return; }
    const eta = m.eta_text || "—";
    const speed = m.speed_img_s != null ? `${m.speed_img_s.toFixed(1)} img/s` : "—";
    const gpu = m.gpu_mem_gb != null ? `${m.gpu_mem_gb.toFixed(1)} GB` : "—";
    const loss = m.loss != null ? m.loss.toFixed(4) : "—";
    const lr = job.learning_rate != null ? job.learning_rate.toExponential(2) : "—";
    tbody.innerHTML = `
      <tr class="border-t border-line">
        <td class="py-1 pr-2">${m.epoch ?? 0}/${m.total_epochs || "?"}</td>
        <td class="py-1 px-2">${m.step || 0}/${job.steps || "?"}</td>
        <td class="py-1 px-2">${loss}</td>
        <td class="py-1 px-2">${lr}</td>
        <td class="py-1 px-2">${speed}</td>
        <td class="py-1 px-2">${eta}</td>
        <td class="py-1 pl-2">${gpu}</td>
      </tr>
    `;
  }

  renderTransferTable(tbody, tp) {
    if (!tbody) return;
    const recv = (tp.bytes || 0) / (1024 * 1024);
    const total = tp.total_bytes ? tp.total_bytes / (1024 * 1024) : null;
    const pct = total ? `${Math.min(100, Math.round((recv / total) * 100))}%` : "—";
    const speed = tp.speed_mb_s != null ? `${tp.speed_mb_s.toFixed(1)} MB/s` : "—";
    tbody.innerHTML = `
      <tr class="border-t border-line">
        <td class="py-1 pr-2 truncate max-w-[160px]">${_esc(tp.name || "")}</td>
        <td class="py-1 px-2">${recv.toFixed(0)}${total ? `/${total.toFixed(0)}` : ""} MB</td>
        <td class="py-1 px-2">${pct}</td>
        <td class="py-1 pl-2">${speed}</td>
      </tr>
    `;
  }

  renderLossChart(canvas, metrics) {
    if (!canvas || typeof Chart === "undefined") return;
    const points = (metrics || []).filter((p) => p.loss != null);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#E3BD6C";
    const line = getComputedStyle(document.documentElement).getPropertyValue("--color-line").trim() || "#2A2A2E";
    if (!this.chart) {
      this.chart = new Chart(canvas, {
        type: "line",
        data: {
          labels: points.map((p) => p.step),
          datasets: [{ data: points.map((p) => p.loss), borderColor: accent, backgroundColor: accent, borderWidth: 1.5, pointRadius: 0, tension: 0.2 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false } },
          scales: { x: { title: { display: true, text: "Step" }, grid: { color: line } }, y: { title: { display: true, text: "Loss" }, grid: { color: line } } },
        },
      });
      return;
    }
    this.chart.data.labels = points.map((p) => p.step);
    this.chart.data.datasets[0].data = points.map((p) => p.loss);
    this.chart.update();
  }

  updateCostBanner(banner, job) {
    if (!banner) return;
    if (!["queued", "provisioning", "training", "saving"].includes(job.status) || !job.billing_started) {
      banner.style.display = "none";
      return;
    }
    const elapsedHours = Math.max(0, (Date.now() / 1000 - job.billing_started)) / 3600;
    const cost = elapsedHours * 0.80;
    banner.style.display = "flex";
    banner.textContent = `Cost so far: $${cost.toFixed(3)} (L4 @ $0.80/hr, running ${Math.round(elapsedHours * 60)}m)`;
  }

  watch(jobId, refs, onSettled) {
    this.stop();
    this.jobId = jobId;
    const { statusLabel, bar, logEl, costBanner, metricsTable, chart, metricsWrap, finalizing, doneTile,
            uploadWrap, uploadTable, downloadWrap, downloadTable } = refs;
    const poll = async () => {
      if (!statusLabel || !statusLabel.isConnected) { this.stop(); return; }
      let job;
      try {
        job = (await api("/api/admin/lora-training/jobs")).find((j) => j.id === jobId);
        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures === 3) errorToast("Lost touch with the training job status — the panel may be stale. Reload if it doesn't recover.");
        return;
      }
      if (!job) return;
      statusLabel.textContent = `Status: ${job.status}` + (job.resume_from_lora ? ` · resumed from ${job.resume_from_lora}` : "");
      bar.style.width = `${Math.round((job.progress || 0) * 100)}%`;
      if (job.log) this.appendLog(logEl, job.log);
      this.updateCostBanner(costBanner, job);
      const tp = job.transfer_progress || {};
      const uploadNow = tp.phase === "upload" && job.status === "provisioning";
      const downloadNow = tp.phase === "download" && ["training", "saving"].includes(job.status);
      const trainingNow = job.status === "training";
      const finalizingNow = job.status === "saving" && !downloadNow;
      const doneNow = job.status === "done";
      uploadWrap.style.display = uploadNow ? "" : "none";
      downloadWrap.style.display = downloadNow ? "" : "none";
      metricsWrap.style.display = trainingNow ? "" : "none";
      finalizing.style.display = finalizingNow ? "" : "none";
      doneTile.style.display = doneNow ? "" : "none";
      if (uploadNow) this.renderTransferTable(uploadTable, tp);
      if (downloadNow) this.renderTransferTable(downloadTable, tp);
      if (trainingNow) {
        this.renderMetricsTable(metricsTable, job.metrics, job);
        this.renderLossChart(chart, job.metrics);
      }
      if (["queued", "provisioning", "training", "saving"].includes(job.status)) return;
      this.stop();
      this.jobId = null;
      if (job.status === "failed") errorToast(`Training failed: ${job.error || "unknown error"}`);
      else if (job.status === "done") toast(`LoRA training complete: ${job.output_file || ""}`);
      onSettled && onSettled(job);
    };
    this.interval = setInterval(poll, 5000);
    this.onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", this.onVisible);
    poll();
  }
}
```

- [ ] **Step 2: Implement `progressTabHtml()` and `watchJob()` on `AdminTrainView`**

```js
  progressTabHtml() {
    return `
      <div id="lt_idle" class="text-sm text-muted" style="${this.watcher.isWatching ? "display:none" : ""}">No active training job. Start one from the Train tab.</div>
      <div id="lt_live" style="${this.watcher.isWatching ? "" : "display:none"}">
        <div id="lt_cost_banner" class="mb-3 px-3 py-2 rounded-md border border-line font-mono text-sm" style="display:none"></div>
        <div id="lt_status_label" class="text-sm text-muted mb-2">Status: —</div>
        <div class="h-2 rounded-full bg-surface-2 overflow-hidden mb-4">
          <div id="lt_progress_bar" class="h-full bg-accent" style="width:0%"></div>
        </div>
        <div id="lt_log" class="font-mono text-xs whitespace-pre-wrap border border-line rounded-md p-2 bg-surface-2 mb-4" style="max-height:260px;overflow-y:auto"></div>
        <div id="lt_upload_wrap" class="mb-4 overflow-x-auto" style="display:none">
          <table class="w-full text-xs font-mono"><thead><tr class="text-muted text-left"><th class="pr-2">Uploading</th><th class="px-2">Received</th><th class="px-2">Progress</th><th class="pl-2">Speed</th></tr></thead><tbody id="lt_upload_table"></tbody></table>
        </div>
        <div id="lt_download_wrap" class="mb-4 overflow-x-auto" style="display:none">
          <table class="w-full text-xs font-mono"><thead><tr class="text-muted text-left"><th class="pr-2">Downloading</th><th class="px-2">Received</th><th class="px-2">Progress</th><th class="pl-2">Speed</th></tr></thead><tbody id="lt_download_table"></tbody></table>
        </div>
        <div id="lt_metrics_wrap">
          <div class="mb-4 overflow-x-auto">
            <table class="w-full text-xs font-mono"><thead><tr class="text-muted text-left"><th class="pr-2">Epoch</th><th class="px-2">Step</th><th class="px-2">Loss</th><th class="px-2">LR</th><th class="px-2">Speed</th><th class="px-2">ETA</th><th class="pl-2">GPU</th></tr></thead><tbody id="lt_metrics_table"></tbody></table>
          </div>
          <div style="height:180px"><canvas id="lt_loss_chart"></canvas></div>
        </div>
        <div id="lt_finalizing" class="text-sm text-ink mb-4" style="display:none">Finalizing — saving and transferring the trained LoRA off the GPU…</div>
        <div id="lt_done_tile" class="text-center py-6 rounded-md border border-line mb-4" style="display:none">
          <div class="text-2xl mb-1">✓</div><div class="font-semibold text-ink">Done</div>
        </div>
        <button type="button" id="lt_checkpoint_now" class="w-full py-2 rounded-md border border-line text-sm text-ink">Request checkpoint now</button>
        <div class="text-xs text-muted mt-1">Saves the model's current state as its own snapshot for testing — doesn't stop or affect training.</div>
      </div>
    `;
  }

  watchJob(jobId) {
    this.tab = "progress";
    this.render();
    const refs = {
      statusLabel: document.getElementById("lt_status_label"), bar: document.getElementById("lt_progress_bar"),
      logEl: document.getElementById("lt_log"), costBanner: document.getElementById("lt_cost_banner"),
      metricsTable: document.getElementById("lt_metrics_table"), chart: document.getElementById("lt_loss_chart"),
      metricsWrap: document.getElementById("lt_metrics_wrap"), finalizing: document.getElementById("lt_finalizing"),
      doneTile: document.getElementById("lt_done_tile"), uploadWrap: document.getElementById("lt_upload_wrap"),
      uploadTable: document.getElementById("lt_upload_table"), downloadWrap: document.getElementById("lt_download_wrap"),
      downloadTable: document.getElementById("lt_download_table"),
    };
    document.getElementById("lt_idle").style.display = "none";
    document.getElementById("lt_live").style.display = "";
    this.watcher.watch(jobId, refs, async (job) => {
      if (job.status === "done") this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
    });
    const checkpointBtn = document.getElementById("lt_checkpoint_now");
    if (checkpointBtn) checkpointBtn.onclick = async () => {
      checkpointBtn.disabled = true;
      checkpointBtn.textContent = "Requesting…";
      try {
        await api(`/api/admin/lora-training/jobs/${encodeURIComponent(jobId)}/checkpoint`, { method: "POST" });
        toast("Checkpoint requested — it'll arrive as the model finishes its current step.");
      } catch (err) {
        errorToast(err.message || "Could not request checkpoint.");
      }
      checkpointBtn.disabled = false;
      checkpointBtn.textContent = "Request checkpoint now";
    };
  }
```

- [ ] **Step 3: Verify live against an existing job's persisted state (no new billed run)**

Confirm at least one training job already exists (`GET /api/admin/lora-training/jobs` via curl with the admin session cookie) — if the account has none yet, skip live-chart verification and instead confirm via code review that `renderLossChart`/`renderMetricsTable` match the shapes documented in `backend/routers/lora_training.py`'s job-metrics fields. If a `done` or `failed` job exists, navigate to Progress and manually call `adminTrainView.watchJob('<that-job-id>')` from the browser console to confirm the panel renders its final persisted state (status label, log, and — if `metrics` is non-empty — the metrics table and Chart.js line) without errors, then confirm the watcher stops polling immediately since the job is already terminal.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/admin-train.js
git commit -m "Add Progress tab: TrainingJobWatcher, log, metrics table, Chart.js loss chart"
```

---

### Task 6: Jobs tab — history list, delete, load-into-Test

**Files:**
- Modify: `new_ui/js/admin-train.js`

**Interfaces:**
- Consumes: `this.jobs` (Task 1).
- Produces: `this.testEntry` (the currently-loaded `{job, filename, label}` for the Test tab, or `null`), `this.jobsTabHtml()`, `this.loadJobEntries()`.

- [ ] **Step 1: Implement entry-building and the tab body**

```js
  async loadJobEntries() {
    const testableJobs = this.jobs.filter((j) => j.output_file);
    const ckptLists = await Promise.all(testableJobs.map((j) =>
      api(`/api/admin/lora-training/jobs/${encodeURIComponent(j.id)}/checkpoints`).catch(() => [])));
    const entries = [];
    testableJobs.forEach((j, i) => {
      entries.push({ job: j, filename: j.output_file, label: `${j.name} — latest (${j.status})` });
      ckptLists[i].forEach((c) => {
        const m = /_(\d{8}T\d{6}Z)\.safetensors$/.exec(c.filename);
        entries.push({ job: j, filename: c.filename, label: `${j.name} — checkpoint ${m ? m[1] : c.filename}` });
      });
    });
    return entries;
  }

  jobsTabHtml() {
    if (!this.jobs.length) return `<p class="text-sm text-muted">No training jobs yet.</p>`;
    return `<div id="lt_jobs_list"></div>`;
  }

  async renderJobsList() {
    const list = document.getElementById("lt_jobs_list");
    if (!list) return;
    const entries = await this.loadJobEntries();
    list.innerHTML = this.jobs.map((j) => {
      const jobEntries = entries.filter((e) => e.job.id === j.id);
      return `
        <div class="flex items-start gap-2.5 py-2.5 border-b border-line">
          <div class="flex-1 min-w-0">
            <b class="text-ink">${_esc(j.name)}</b> <span class="text-xs text-muted">${_esc(j.status)} · ${Math.round((j.progress || 0) * 100)}%</span>
            ${j.resume_from_lora ? `<div class="text-xs" style="color:var(--color-accent)">resumed from ${_esc(j.resume_from_lora)}</div>` : ""}
            ${j.error ? `<div class="text-xs" style="color:var(--color-warn)">${_esc(j.error)}</div>` : ""}
          </div>
          <button type="button" data-del-job="${_attr(j.id)}" class="px-2 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">Delete</button>
        </div>
        ${jobEntries.map((e, idx) => `
          <button type="button" data-select-entry="${idx}" data-select-job="${_attr(j.id)}" class="block w-full text-left text-xs text-ink px-3 py-1.5 ml-4 rounded-md border border-line mt-1">${_esc(e.label)}</button>
        `).join("")}
      `;
    }).join("");
    list.querySelectorAll("[data-del-job]").forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/api/admin/lora-training/jobs/${encodeURIComponent(b.dataset.delJob)}`, { method: "DELETE" });
        this.jobs = await api("/api/admin/lora-training/jobs").catch(() => this.jobs);
        this.renderJobsList();
      } catch (err) {
        errorToast(err.message || "Delete failed.");
        b.disabled = false;
      }
    });
    list.querySelectorAll("[data-select-entry]").forEach((b) => b.onclick = () => {
      const jobEntries = entries.filter((e) => e.job.id === b.dataset.selectJob);
      const picked = jobEntries[parseInt(b.dataset.selectEntry, 10)];
      if (!picked) return;
      this.testEntry = picked;
      this.tab = "test";
      this.render();
    });
  }
```

- [ ] **Step 2: Trigger `renderJobsList()` whenever the Jobs tab is active**

In `wireTab()`:

```js
  wireTab() {
    if (this.tab === "train") this.wireTrainTab();
    if (this.tab === "jobs") this.renderJobsList();
  }
```

- [ ] **Step 3: Verify live**

Switch to the Jobs tab, confirm every existing job renders with correct status/progress and (for any job with `output_file`) at least one tappable entry beneath it; delete one job (pick a `failed`/test one, not an in-progress or valuable one) and confirm it disappears from the list and a `DELETE` call actually fired (check via Network tab or by re-fetching `GET /api/admin/lora-training/jobs`); tap an entry and confirm the tab switches to Test with `adminTrainView.testEntry` set.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/admin-train.js
git commit -m "Add Jobs tab: job history, delete, load-entry-into-Test"
```

---

### Task 7: Test tab — reuse Forge's pickers, generate/stop/zoom/upscale/save/discard

**Files:**
- Modify: `new_ui/js/admin-train.js`

**Interfaces:**
- Consumes: `this.testEntry` (Task 6), `this.checkpoints`/`this.animaNames` (Task 1), and — by direct reuse, not copy-paste — `ForgeView`'s `simplePickerSummaryHtml`/`openSimplePicker`/`simplePickerModalHtml`/`renderSimplePickerList` static picker logic pattern for sampler/scheduler (`new_ui/js/forge.js`, already shipped this session).
- Produces: `testTabHtml()`, `runTestGenerate()`, `stopTestGenerate()`.

- [ ] **Step 1: Add Test-tab state**

In `mount()`:

```js
this.testEntry = null;
this.testStrength = 1.0;
this.testSampler = "";
this.testScheduler = "";
this.testSteps = 20;
this.testCfg = 7.0;
this.testAspect = "1:1";
this.testResult = null;
this.testAbort = null;
```

- [ ] **Step 2: Load sampler/scheduler lists alongside checkpoints**

Extend `loadCheckpoints()` from Task 1 to also fetch samplers, and set sane defaults exactly like `ForgeView.loadModels()` does (search `new_ui/js/forge.js` for `dpmpp_2m_sde_gpu`/`karras` default-selection logic and mirror it here):

```js
  async loadCheckpoints() {
    const [checkpoints, animaUnets, previews, samplerData] = await Promise.all([
      api("/api/imagegen/checkpoints").catch(() => []),
      api("/api/imagegen/anima-unets").catch(() => []),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
    ]);
    this.checkpoints = [...checkpoints, ...animaUnets];
    this.animaNames = new Set(animaUnets);
    this.checkpointPreviews = previews;
    this.samplers = samplerData.samplers || [];
    this.schedulers = samplerData.schedulers || [];
    this.testSampler = this.samplers.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (this.samplers.includes("euler") ? "euler" : (this.samplers[0] || ""));
    this.testScheduler = this.schedulers.includes("karras") ? "karras" : (this.schedulers.includes("normal") ? "normal" : (this.schedulers[0] || ""));
    this.render();
  }
```

- [ ] **Step 3: Implement `testTabHtml()`**

```js
  testTabHtml() {
    if (!this.testEntry) {
      return `<p class="text-sm text-muted">Pick a trained LoRA from the Jobs tab to test it.</p>`;
    }
    const e = this.testEntry;
    const notFound = !this.checkpoints.includes(e.job.base_checkpoint);
    return `
      <div class="mb-4 text-sm">
        <b class="text-ink">${_esc(e.label)}</b><br>
        <span class="text-xs text-muted">Trigger word: <b>${_esc(e.job.trigger_word || "—")}</b> · Base: ${_esc(e.job.base_checkpoint || "—")}</span>
        ${notFound ? `<div class="text-xs mt-1" style="color:var(--color-warn)">Base checkpoint no longer found — generation will fail.</div>` : ""}
      </div>
      <div class="mb-4">
        <label class="grimoire-field-label">Strength</label>
        <input type="range" id="tl_strength" min="-8" max="8" step="0.05" value="${this.testStrength}" style="width:100%">
        <span id="tl_strength_val" class="text-xs font-mono text-accent">${this.testStrength.toFixed(2)}</span>
      </div>
      ${this.simplePickerSummaryHtml("testSampler", "Sampler", this.samplers)}
      ${this.simplePickerSummaryHtml("testScheduler", "Scheduler", this.schedulers)}
      <div class="mb-4">
        <label class="grimoire-field-label">Steps</label>
        <input type="range" id="tl_steps" min="1" max="60" step="1" value="${this.testSteps}" style="width:100%">
        <span id="tl_steps_val" class="text-xs font-mono text-accent">${this.testSteps}</span>
      </div>
      <div class="mb-4">
        <label class="grimoire-field-label">Guidance (CFG)</label>
        <input type="range" id="tl_cfg" min="1" max="20" step="0.5" value="${this.testCfg}" style="width:100%">
        <span id="tl_cfg_val" class="text-xs font-mono text-accent">${this.testCfg.toFixed(1)}</span>
      </div>
      <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center">
        <img id="tl_preview_img" alt="" class="w-full h-full object-cover" style="display:${this.testResult ? "" : "none"}" src="${this.testResult ? _attr(this.testResult) : ""}">
        <span id="tl_preview_empty" class="text-xs text-muted" style="display:${this.testResult ? "none" : ""}">Preview will appear here</span>
      </div>
      <button type="button" id="tl_go" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark" ${notFound ? "disabled" : ""}>Generate</button>
    `;
  }

  simplePickerSummaryHtml(field, title, options) {
    const value = this[field];
    const label = value || "Default";
    return `
      <div class="mb-3">
        <label class="grimoire-field-label">${_esc(title)}</label>
        <button type="button" onclick="adminTrainView.openSimplePicker('${field}')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;cursor:pointer;text-align:left">
          <span style="flex:1;font-family:var(--font-mono);font-size:12.5px;color:var(--color-ink)">${_esc(label)}</span>
          <span style="color:var(--color-muted)">&rsaquo;</span>
        </button>
      </div>
    `;
  }

  openSimplePicker(field) {
    const source = field === "testSampler" ? this.samplers : this.schedulers;
    openModal(`
      <h3>Choose a ${field === "testSampler" ? "sampler" : "scheduler"}</h3>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:360px;overflow-y:auto">
        ${source.map((name) => `
          <button type="button" data-sp-name="${_attr(name)}" style="display:flex;align-items:center;padding:10px 12px;border-radius:10px;border:1px solid ${this[field] === name ? "var(--color-accent)" : "transparent"};background:none;cursor:pointer;text-align:left;font-family:var(--font-mono);font-size:13px;color:var(--color-ink)">${_esc(name)}</button>
        `).join("")}
      </div>
    `, { wide: true });
    document.querySelectorAll("[data-sp-name]").forEach((b) => b.onclick = () => {
      this[field] = b.dataset.spName;
      closeTopModal();
      this.render();
    });
  }
```

- [ ] **Step 4: Implement generate/stop and wire the Test tab**

```js
  async runTestGenerate() {
    const e = this.testEntry;
    if (!e || !this.checkpoints.includes(e.job.base_checkpoint)) return;
    const goBtn = document.getElementById("tl_go");
    this.testAbort = new AbortController();
    goBtn.textContent = "Stop";
    goBtn.onclick = () => this.stopTestGenerate();
    const anima = this.animaNames.has(e.job.base_checkpoint);
    const [width, height] = FORGE_ASPECTS[this.testAspect] || [1024, 1024];
    const body = {
      positive: `${e.job.trigger_word || ""}, masterpiece, best quality, absurdres`,
      negative: "worst quality, bad quality, worst detail",
      checkpoint: e.job.base_checkpoint, architecture: anima ? "anima" : "sdxl",
      loras: [{ name: e.filename, strength: this.testStrength }],
      width, height,
      sampler: this.testSampler, scheduler: this.testScheduler,
      steps: this.testSteps, cfg: this.testCfg,
    };
    try {
      const res = await fetch(`${API}/api/imagegen/standalone/stream`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: this.testAbort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (ev.type === "preview" || ev.type === "done") {
          this.testResult = ev.image;
          const img = document.getElementById("tl_preview_img");
          const empty = document.getElementById("tl_preview_empty");
          if (img) { img.src = ev.image; img.style.display = ""; }
          if (empty) empty.style.display = "none";
        }
        if (ev.type === "error") errorToast(ev.message || "Test generation failed.");
      });
    } catch (err) {
      if (err.name !== "AbortError") errorToast(err.message || "Test generation failed.");
    }
    this.testAbort = null;
    if (goBtn) { goBtn.textContent = "Generate"; goBtn.onclick = () => this.runTestGenerate(); }
  }

  stopTestGenerate() {
    if (this.testAbort) { try { this.testAbort.abort(); } catch (err) {} this.testAbort = null; }
    fetch(`${API}/api/imagegen/standalone/stream/stop`, { method: "POST", credentials: "include" }).catch(() => {});
    const goBtn = document.getElementById("tl_go");
    if (goBtn) { goBtn.textContent = "Generate"; goBtn.onclick = () => this.runTestGenerate(); }
  }
```

In `wireTab()`:

```js
  wireTab() {
    if (this.tab === "train") this.wireTrainTab();
    if (this.tab === "jobs") this.renderJobsList();
    if (this.tab === "test") this.wireTestTab();
  }

  wireTestTab() {
    if (!this.testEntry) return;
    const strengthInp = document.getElementById("tl_strength");
    if (strengthInp) strengthInp.oninput = (e) => {
      this.testStrength = parseFloat(e.target.value);
      document.getElementById("tl_strength_val").textContent = this.testStrength.toFixed(2);
    };
    const stepsInp = document.getElementById("tl_steps");
    if (stepsInp) stepsInp.oninput = (e) => {
      this.testSteps = parseInt(e.target.value, 10);
      document.getElementById("tl_steps_val").textContent = this.testSteps;
    };
    const cfgInp = document.getElementById("tl_cfg");
    if (cfgInp) cfgInp.oninput = (e) => {
      this.testCfg = parseFloat(e.target.value);
      document.getElementById("tl_cfg_val").textContent = this.testCfg.toFixed(1);
    };
    const goBtn = document.getElementById("tl_go");
    if (goBtn) goBtn.onclick = () => this.runTestGenerate();
  }
```

- [ ] **Step 5: Verify live**

From the Jobs tab, pick an entry with a real `output_file` (an already-completed job — do not start a new one). Confirm the Test tab shows the entry's label/trigger/base checkpoint. Open the sampler and scheduler pickers and confirm selecting an option updates the summary row (same interaction already verified for Forge's identical picker this session). Move the strength/steps/CFG sliders and confirm the live value labels update. Click Generate and confirm a real generation streams in (this reuses the existing, already-verified `/imagegen/standalone/stream` endpoint — no new GPU rental, this runs on the always-on ComfyUI instance, not Modal). Click Stop mid-generation and confirm it aborts cleanly with no console error.

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/admin-train.js
git commit -m "Add Test tab: sampler/scheduler pickers, sliders, generate/stop"
```

---

## Self-Review Notes

**Spec coverage:** All four tabs (Train, Progress, Test, Jobs) from the spec are covered — Task 2/3/4 build Train, Task 5 builds Progress with Chart.js per the correction, Task 7 builds Test, Task 6 builds Jobs. Route/access/tab-shell (spec's "Route & access" + "Structure" sections) covered by Task 1. Cost/time estimate, validation ranges, confirm-before-billing/abort guards, image caption grid with modal + bulk .txt import, checkpoint picker reusing Forge's pattern, sampler/scheduler pickers reusing Forge's pattern, TrainingJobWatcher reload-recovery behavior, "Request checkpoint now" — all present in their respective tasks. Zoom/Upscale/Save/Discard on a test result and per-image zoom (present in legacy, mentioned in the spec's Test tab and Train tab bullets) are the one deliberately deferred piece — flagged below.

**Deferred from legacy parity (call out to human before/after Task 7):** Legacy's Test-LoRA panel also has Zoom/Upscale/Save/Discard actions on a generated result, and the training-image grid has a full-image zoom view. This plan's Task 3/Task 7 give the core flows (caption editing, generate/stop) but not these secondary actions, to keep tasks reviewable in one sitting. If full parity on these is wanted, they're small additive follow-ups reusing Forge's existing zoom/upscale/save code paths (`new_ui/js/forge.js`'s upscale-picker and `/imagegen/standalone/save` call) — flag this to the human after Task 7 lands rather than silently shipping it as "done."

**Placeholder scan:** No TBD/TODO left in any step; every code block is complete, runnable JS matching the file's existing conventions (double quotes, `_esc`/`_attr` escaping, `api()` helper, `openModal`/`closeTopModal`).

**Type consistency:** `this.form.checkpoint` (Task 2) is read consistently in Task 4's `submitTraining()`, Task 4's `updateTimeEstimate()`, and nowhere renamed. `this.trainImages`/`this.trainCaptions` (Task 3) are read by Task 4's `submitTraining()` and Task 2's `validateTrainForm()` with matching names throughout. `this.watcher` (Task 1) is the single `TrainingJobWatcher` instance used by Task 5's `watchJob()`. `this.testEntry` (Task 6) is read by Task 7's `testTabHtml()`/`wireTestTab()`/`runTestGenerate()` with a consistent `{job, filename, label}` shape matching legacy's `buildTestLoraEntries()`.
