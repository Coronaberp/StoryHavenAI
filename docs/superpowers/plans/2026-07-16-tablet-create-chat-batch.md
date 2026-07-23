# Phase 1 / Create-Chat Batch: Tablet Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to implement this plan — Tasks 1-4 touch independent files with no shared state and can run as parallel agent dispatches. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the same `.content-col` capped-and-centered pattern (established in the Browse batch, `docs/superpowers/plans/2026-07-16-tablet-browse-batch.md`) to Sanctum-Create, Forge, Grimoire, and Masks — all four currently render single-column, full-bleed markup with no width cap at tablet+.

**Architecture:** `.content-col` already exists in `new_ui/css/cards.css` (680px cap, centered, `≥768px`). Wrap each screen's root render output in a `<div class="content-col">...</div>`.

## Global Constraints

- Cap width: 680px via the existing `.content-col` class — do not redefine it.
- Applies at `≥768px` only — mobile behavior must be unchanged.
- **Parlance (`new_ui/js/chat.js`, `ChatView`) is explicitly OUT of scope for this batch.** It renders chromeless (`position:absolute;inset:0`, no page header, immersive full-bleed layout via `hideChrome`) — a capped column would break it, not fix it. Chat's tablet/desktop treatment belongs to Phase 2's split-view work (transcript + composer vs. session info rail), not this capped-column pattern. Do not touch `chat.js` in this batch.
- Zero comments in code.
- Verify against the running `./rebuild.sh --watch` dev server on `:3001` via Playwright (Python `playwright` package, `sync_playwright`) — no browser MCP tool is available in this environment, drive it directly via a script. Login: `claude` / `0987654321`.

---

### Task 1: Cap Sanctum-Create (`CreateCharacterView`)

**Files:**
- Modify: `new_ui/js/create.js:815-827` (`render()`)

- [ ] **Step 1: Wrap both render branches in `.content-col`**

Change:
```js
  render() {
    this.main.innerHTML = this.isEdit
      ? `
        ${pageHeaderHtml("Sanctum", "Edit Character", "Edit Character", `Editing ${_esc(this.name || "your character")}.`)}
        ${this.manualFieldsHtml()}
      `
      : `
        ${pageHeaderHtml("Sanctum", "New Character", "New Character", "Bind a new character into being.")}
        ${this.sourceTabsHtml()}
        ${this.generateTabHtml()}
        ${this.importTabHtml()}
```
to (wrap the whole ternary result in a `.content-col` div — add the opening div before the ternary's backtick strings and close it after, keeping the rest of the function body, including whatever comes after `importTabHtml()`, unchanged):
```js
  render() {
    this.main.innerHTML = `<div class="content-col">` + (this.isEdit
      ? `
        ${pageHeaderHtml("Sanctum", "Edit Character", "Edit Character", `Editing ${_esc(this.name || "your character")}.`)}
        ${this.manualFieldsHtml()}
      `
      : `
        ${pageHeaderHtml("Sanctum", "New Character", "New Character", "Bind a new character into being.")}
        ${this.sourceTabsHtml()}
        ${this.generateTabHtml()}
        ${this.importTabHtml()}
```

Read the full existing function body first (it continues past `importTabHtml()`) — find where the template literal assigned to `this.main.innerHTML` actually ends, and add `</div>` immediately before that closing backtick, then `);` to close the wrapping paren. Preserve every line in between exactly as-is.

- [ ] **Step 2: Verify**

Playwright: log in, navigate to `/sanctum/create`, viewport 375×900 (expect unchanged full-width), then 800×900 (expect centered, capped ~680px, no clipped form fields/tabs).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/create.js
git commit -m "Cap Sanctum-Create to content column at tablet width"
```

---

### Task 2: Cap Forge (`ForgeView`)

**Files:**
- Modify: `new_ui/js/forge.js:1322-1340ish` (`render()`)

- [ ] **Step 1: Wrap the render output in `.content-col`**

Find the `render()` method (starts around line 1323):
```js
  render() {
    window._activeForgeView = this;
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
```
Change the template literal's opening to wrap in `.content-col`:
```js
  render() {
    window._activeForgeView = this;
    this.main.innerHTML = `
      <div class="content-col">
      ${pageHeaderHtml("Sanctum", "Generate media", "My Forge", "Conjure new images from a prompt or your own reference image.")}
```
Then find where this same template literal closes (the backtick that ends the string assigned to `this.main.innerHTML` — read the rest of the function to locate it) and add a closing `</div>` immediately before that closing backtick. Preserve everything else unchanged, including any `card-grid`-based preview grids inside — they get an implicit extra cap from the wrapper, which is fine since 680px still comfortably fits the existing `minmax(160px, 1fr)` auto-fill.

- [ ] **Step 2: Verify**

Playwright: navigate to `/sanctum/forge`, viewport 375×900 (unchanged), then 800×900 (centered, capped, no clipped preview thumbnails/option pickers).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/forge.js
git commit -m "Cap Forge to content column at tablet width"
```

---

### Task 3: Cap Grimoire (`GrimoireView`)

**Files:**
- Modify: `new_ui/js/grimoire.js:490-500ish` (`render()`)

- [ ] **Step 1: Wrap the render output in `.content-col`**

Current:
```js
  render() {
    this.main.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")}</div>
        <button type="button" class="grimoire-add-btn" id="grimoireAddBtn" aria-label="Add lore entry">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
```
Add `class="content-col"` to a new outer wrapper (don't just add the class to the existing flex row, since the rest of the template — entries list, search box — renders as siblings after this div, not inside it; read the rest of the function to find where the full template literal ends and wrap the whole thing):
```js
  render() {
    this.main.innerHTML = `
      <div class="content-col">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")}</div>
        <button type="button" class="grimoire-add-btn" id="grimoireAddBtn" aria-label="Add lore entry">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
```
Add the matching closing `</div>` right before the closing backtick of this same template literal (read the rest of the function to find it).

- [ ] **Step 2: Verify**

Playwright: navigate to `/sanctum/grimoire`, viewport 375×900 (unchanged), then 800×900 (centered, capped, search box and entry rows not clipped).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/grimoire.js
git commit -m "Cap Grimoire to content column at tablet width"
```

---

### Task 4: Cap Masks (`MasksView`)

**Files:**
- Modify: `new_ui/js/masks.js:215-226` (`render()`)

- [ ] **Step 1: Wrap the render output in `.content-col`**

Current:
```js
  render() {
    this.main.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Personas", "My Masks", "The faces you wear when you step into a story.")}</div>
        <button type="button" class="grimoire-add-btn" id="masksAddBtn" aria-label="Add mask">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
```
Same pattern as Task 3 — wrap the whole template literal (read to its closing backtick) in a `.content-col` div:
```js
  render() {
    this.main.innerHTML = `
      <div class="content-col">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Personas", "My Masks", "The faces you wear when you step into a story.")}</div>
        <button type="button" class="grimoire-add-btn" id="masksAddBtn" aria-label="Add mask">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
```
Add the matching closing `</div>` before the closing backtick.

- [ ] **Step 2: Verify**

Playwright: navigate to `/sanctum/masks`, viewport 375×900 (unchanged), then 800×900 (centered, capped, tabs/rows not clipped).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/masks.js
git commit -m "Cap Masks to content column at tablet width"
```

---

## Self-Review Notes

- Spec coverage: all 5 Create/Chat batch screens accounted for — 4 get `.content-col` (Tasks 1-4), Chat is explicitly deferred to Phase 2 with reasoning given (chromeless immersive layout, not a capped-column candidate).
- No new CSS needed — reuses `.content-col` from the Browse batch.
- Each task is file-independent — safe for parallel dispatch.
