# Phase 1 / Account Batch: Tablet Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to implement this plan — Tasks 2-6 touch independent files with no shared state and can run as parallel agent dispatches after Task 1 lands. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the established `.content-col` capped-and-centered pattern to Dossier (placeholder) and all 5 Settings screens.

**Architecture:** `.content-col` already exists in `new_ui/css/cards.css` (680px cap, centered, `≥768px`). Wrap each screen's root render output in a `<div class="content-col">...</div>`. Dossier is covered centrally via `renderPlaceholder()` in `router.js` since every currently-unbuilt placeholder route uses it.

## Global Constraints

- Cap width: 680px via the existing `.content-col` class — do not redefine it.
- Applies at `≥768px` only — mobile behavior must be unchanged.
- Zero comments in code.
- Verify with Python's `playwright` package directly against the running `:3001` dev server (no browser MCP tool available) — do NOT start or restart any dev server. Login: `claude` / `0987654321`.

---

### Task 1: Wrap `renderPlaceholder()` in `.content-col`

**Files:**
- Modify: `new_ui/js/router.js:155-162`

- [ ] **Step 1: Wrap the placeholder markup**

Change:
```js
function renderPlaceholder(main, nav, subnav, title, subtitle) {
  main.innerHTML = `
    ${pageHeaderHtml(nav, subnav, title, subtitle)}
    <div class="rounded-lg border border-line bg-surface p-6">
      <p class="text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
  `;
}
```
to:
```js
function renderPlaceholder(main, nav, subnav, title, subtitle) {
  main.innerHTML = `
    <div class="content-col">
    ${pageHeaderHtml(nav, subnav, title, subtitle)}
    <div class="rounded-lg border border-line bg-surface p-6">
      <p class="text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
    </div>
  `;
}
```

- [ ] **Step 2: Verify**

Playwright: navigate to `/dossier`, viewport 800×900, confirm `.content-col` div exists and is capped/centered.

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/router.js
git commit -m "Cap the unbuilt-placeholder route (Dossier) to content column at tablet width"
```

---

### Task 2: Cap Settings (`SettingsView`)

**Files:**
- Modify: `new_ui/js/settings.js:83` (`render()`)

- [ ] **Step 1: Read the full `render()` method to find where the template literal assigned to `this.main.innerHTML` ends, then wrap its entire content in `<div class="content-col">...</div>`** — opening div right after the literal's opening backtick, closing div right before the literal's closing backtick. Leave all content in between unchanged.

- [ ] **Step 2: Verify**

Playwright: navigate to `/settings`, viewport 375×900 (unchanged), then 800×900 (centered, capped ~680px, no clipped preference rows/toggles).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/settings.js
git commit -m "Cap Settings to content column at tablet width"
```

---

### Task 3: Cap Settings-Appearance (`AppearanceSettingsView`)

**Files:**
- Modify: `new_ui/js/settings-appearance.js:306` (render function)

- [ ] **Step 1: Same wrap pattern as Task 2** — read the full render method, wrap its `this.main.innerHTML` template literal's content in `.content-col`.

- [ ] **Step 2: Verify**

Playwright: navigate to `/settings/appearance` (or however it's routed — check `router.js`'s `settings-appearance` entry / trigger it via the Settings screen's Appearance row if there's no direct URL), viewport 375×900 (unchanged) then 800×900 (centered, capped, theme swatches/pickers not clipped).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/settings-appearance.js
git commit -m "Cap Settings Appearance to content column at tablet width"
```

---

### Task 4: Cap Settings-Model (`ModelSettingsView`)

**Files:**
- Modify: `new_ui/js/settings-model.js:56` (`render()`)

- [ ] **Step 1: Same wrap pattern** — read the full render method, wrap its `this.main.innerHTML` template literal's content in `.content-col`.

- [ ] **Step 2: Verify**

Playwright: navigate to the Model & memory settings screen, viewport 375×900 (unchanged) then 800×900 (centered, capped, form fields not clipped).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/settings-model.js
git commit -m "Cap Settings Model to content column at tablet width"
```

---

### Task 5: Cap Settings-Account (`AccountSettingsView`)

**Files:**
- Modify: `new_ui/js/settings-account.js:18` (`render()`)

- [ ] **Step 1: Same wrap pattern** — read the full render method, wrap its `this.main.innerHTML` template literal's content in `.content-col`.

- [ ] **Step 2: Verify**

Playwright: navigate to the Account & language settings screen, viewport 375×900 (unchanged) then 800×900 (centered, capped, password/language fields not clipped).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/settings-account.js
git commit -m "Cap Settings Account to content column at tablet width"
```

---

### Task 6: Cap Settings-Blocks (`BlockedSettingsView`)

**Files:**
- Modify: `new_ui/js/settings-blocks.js:54` (`render()`)

- [ ] **Step 1: Same wrap pattern** — read the full render method, wrap its `this.main.innerHTML` template literal's content in `.content-col`.

- [ ] **Step 2: Verify**

Playwright: navigate to the Blocked creators & tags settings screen, viewport 375×900 (unchanged) then 800×900 (centered, capped, blocked-list rows not clipped).

- [ ] **Step 3: Commit**

```bash
git add new_ui/js/settings-blocks.js
git commit -m "Cap Settings Blocks to content column at tablet width"
```

---

## Self-Review Notes

- Spec coverage: all Account-batch screens covered — Dossier via the shared `renderPlaceholder()` helper (Task 1), the 5 Settings sub-screens each individually (Tasks 2-6).
- No new CSS — reuses `.content-col` from the Browse batch.
- Tasks 2-6 are file-independent — safe for parallel dispatch. Task 1 is a shared helper and should land first since Dossier's routing depends on it, though it doesn't block Tasks 2-6 (different files).
