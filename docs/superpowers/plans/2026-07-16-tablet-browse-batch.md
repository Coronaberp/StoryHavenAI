# Phase 1 / Browse Batch: Tablet Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to implement this plan — Tasks 2-5 touch independent files with no shared state and can run as parallel agent dispatches after Task 1 lands. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Symposium, Symposium-thread, CharacterView, and ArtisanProfileView a shared, consistent capped-and-centered content column at tablet width and up (≥768px), replacing ad-hoc/missing max-width handling with one CSS class.

**Architecture:** Add one shared `.content-col` utility class to `new_ui/css/app.css`, active only at `≥768px`. Apply it to the outermost render wrapper of the four affected views, removing any duplicate inline `max-width`/`margin` styles those views already carry.

**Tech Stack:** Vanilla JS (`new_ui/js/*.js`), plain CSS (`new_ui/css/app.css`), dev server on `:3001` (`./rebuild.sh --watch`, already running), Playwright MCP for viewport verification.

## Amendment (found during execution)

The 2026-07-16 tablet nav spec called for `.card-grid` to become `repeat(auto-fill, minmax(160px, 1fr))`, but this was never actually implemented — both `new_ui/css/app.css:2365` and `new_ui/css/cards.css:1` still hardcode `repeat(2, 1fr)`. This means the Browse batch's grid screens (Pantheon, Artisans, Pinacotheca, Compendium) are also broken at tablet+, not "already fine" as the design spec assumed. Task 0 below fixes this before the rest of the plan proceeds.

## Global Constraints

- Cap width: 680px (per `docs/superpowers/specs/2026-07-16-tablet-browse-batch-design.md`).
- Applies at `≥768px` only (`@media (width >= 48rem)`) — mobile (`<768px`) behavior must be unchanged.
- No new color/type tokens — CSS-only, uses existing `--color-*` variables where relevant.
- `.card-grid` screens (Pantheon, Artisans, Pinacotheca, Compendium) are explicitly untouched — do not add `.content-col` to them.
- Verify against the human's already-running `./rebuild.sh --watch` dev server on `:3001` — never spin up a second dev server instance (see CLAUDE.md).
- Zero comments in code.

---

### Task 0: Fix `.card-grid` to auto-fill columns (both duplicate rules)

**Files:**
- Modify: `new_ui/css/app.css:2365-2369`
- Modify: `new_ui/css/cards.css:1-5`

**Interfaces:**
- Produces: `.card-grid` responsive at all viewport widths, consumed implicitly by Pantheon/Artisans/Pinacotheca/Compendium (Task 6 regression check).

- [ ] **Step 1: Update `app.css`**

Change:
```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
```
to:
```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
```

- [ ] **Step 2: Update `cards.css` (identical change)**

Same replacement as Step 1, applied to `cards.css:1-5`.

- [ ] **Step 3: Verify at mobile width (375px) — 2 columns, matching prior behavior**

Playwright MCP against the running `:3001` dev server: navigate to `/pantheon`, viewport 375×800, screenshot. Expected: 2 columns (375px / 160px ≈ 2.3, so auto-fill still lands on 2 given the 12px gaps and card padding — matches the old hardcoded value at this width).

- [ ] **Step 4: Verify at tablet width (800px) — more than 2 columns**

Viewport 800×1000, screenshot `/pantheon`. Expected: more than 2 columns now render (previously stuck at 2), cards not stretched/distorted.

- [ ] **Step 5: Commit**

```bash
git add new_ui/css/app.css new_ui/css/cards.css
git commit -m "Fix .card-grid to auto-fill columns instead of hardcoded 2"
```

---

### Task 1: Add the `.content-col` utility class

**Files:**
- Modify: `new_ui/css/app.css` (near the existing `.card-grid` rule at line 2365)

**Interfaces:**
- Produces: CSS class `.content-col`, consumed by Tasks 2-5.

- [ ] **Step 1: Add the rule**

Insert immediately before the `.card-grid` rule in `new_ui/css/app.css`:

```css
@media (width >= 48rem) {
  .content-col {
    max-width: 680px;
    margin-inline: auto;
  }
}
```

- [ ] **Step 2: Verify no existing `.content-col` usage collides**

Run: `grep -rn "content-col" new_ui/`
Expected: only the new rule in `app.css`, no existing JS references (confirms the class name is free to use).

- [ ] **Step 3: Commit**

```bash
git add new_ui/css/app.css
git commit -m "Add shared .content-col tablet-and-up layout utility"
```

---

### Task 2: Apply `.content-col` to SymposiumView (thread list)

**Files:**
- Modify: `new_ui/js/symposium.js:219-220` (`SymposiumView.render()`)

**Interfaces:**
- Consumes: `.content-col` (Task 1).

- [ ] **Step 1: Add the class to the root wrapper**

Change:
```js
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
```
to:
```js
    this.main.innerHTML = `
      <div class="content-col" style="display:flex;flex-direction:column;gap:14px">
```

- [ ] **Step 2: Verify at mobile width (375px) — unchanged**

Using Playwright MCP against the running `:3001` dev server: navigate to `/symposium`, set viewport to 375×800, screenshot. Expected: thread list fills full width edge-to-edge as before (no visible change from current behavior).

- [ ] **Step 3: Verify at tablet width (800px) — centered, capped**

Set viewport to 800×1000, screenshot `/symposium`. Expected: content column is visibly centered with margin on both left and right sides, capped well short of the 800px viewport width.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/symposium.js
git commit -m "Cap Symposium thread list to content column at tablet width"
```

---

### Task 3: Apply `.content-col` to SymposiumThreadView, remove duplicate inline cap

**Files:**
- Modify: `new_ui/js/symposium.js:460-465`, `:469-474`, `:479-480` (`SymposiumThreadView.render()`, all three branches: error, loading, loaded)

**Interfaces:**
- Consumes: `.content-col` (Task 1).

- [ ] **Step 1: Update the error branch**

Change:
```js
      this.main.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
```
to:
```js
      this.main.innerHTML = `
        <div class="content-col" style="display:flex;flex-direction:column;gap:14px">
```

- [ ] **Step 2: Update the loading branch**

Same change as Step 1, applied to the second occurrence (the `!this.thread` branch).

- [ ] **Step 3: Update the loaded branch, removing the duplicate inline cap**

Change:
```js
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;max-width:640px">
```
to:
```js
    this.main.innerHTML = `
      <div class="content-col" style="display:flex;flex-direction:column;gap:14px">
```

- [ ] **Step 4: Verify at mobile width (375px) — unchanged**

Playwright MCP against `:3001`: navigate to any `/symposium/{thread-id}` (use a real thread id from the running dev DB, e.g. click into the first thread from `/symposium`), set viewport 375×800, screenshot. Expected: full-width as before.

- [ ] **Step 5: Verify at tablet width (800px) — centered at the new 680px cap**

Set viewport 800×1000, screenshot same thread. Expected: content centered, capped at 680px (visibly narrower margin than the old 640px cap, but not clipping any reply/vote UI).

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/symposium.js
git commit -m "Replace SymposiumThreadView's ad-hoc 640px cap with shared .content-col"
```

---

### Task 4: Apply `.content-col` to CharacterView, remove duplicate inline cap

**Files:**
- Modify: `new_ui/js/character.js:295-296`

**Interfaces:**
- Consumes: `.content-col` (Task 1).

- [ ] **Step 1: Update the root wrapper**

Change:
```js
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;max-width:640px;margin:0 auto">
```
to:
```js
    this.main.innerHTML = `
      <div class="content-col" style="display:flex;flex-direction:column">
```

- [ ] **Step 2: Verify at mobile width (375px) — unchanged**

Playwright MCP against `:3001`: navigate to `/c/{any-character-id}`, viewport 375×800, screenshot. Expected: full-width banner/card as before (the `.content-col` media query doesn't apply below 768px).

- [ ] **Step 3: Verify at tablet width (800px) — centered at 680px**

Viewport 800×1000, screenshot. Expected: character detail card centered, capped at 680px, banner/greeting-preview/lore panels not clipped.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/character.js
git commit -m "Replace CharacterView's ad-hoc 640px cap with shared .content-col"
```

---

### Task 5: Apply `.content-col` to ArtisanProfileView

**Files:**
- Modify: `new_ui/js/artisan-profile.js:137-138`

**Interfaces:**
- Consumes: `.content-col` (Task 1).

- [ ] **Step 1: Add the class to the root wrapper**

Change:
```js
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
```
to:
```js
    this.main.innerHTML = `
      <div class="content-col" style="display:flex;flex-direction:column;gap:16px">
```

- [ ] **Step 2: Verify at mobile width (375px) — unchanged**

Playwright MCP against `:3001`: navigate to `/u/{any-username}`, viewport 375×800, screenshot. Expected: full-width profile banner as before.

- [ ] **Step 3: Verify at tablet width (800px) — centered at 680px**

Viewport 800×1000, screenshot. Expected: profile card centered, capped at 680px, banner/share-button/badges not clipped or overlapping.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/artisan-profile.js
git commit -m "Cap ArtisanProfileView to content column at tablet width"
```

---

### Task 6: Regression check — grid screens unaffected

**Files:** None modified — verification only.

- [ ] **Step 1: Verify Pantheon/Artisans/Pinacotheca/Compendium column counts are unchanged at 800px**

Playwright MCP against `:3001`: for each of `/pantheon`, `/artisans`, `/pinacotheca`, `/compendium`, set viewport 800×1000, screenshot. Expected: `.card-grid` still auto-fills the same column count it did before this plan (compare against a screenshot taken before Task 1, or reason from the unchanged `.card-grid` CSS rule that column count is a pure function of viewport width and 160px minimum, which this plan didn't touch).

- [ ] **Step 2: Verify `.content-col` has zero effect below 768px across all 4 changed screens**

Playwright MCP against `:3001`: for `/symposium`, `/symposium/{id}`, `/c/{id}`, `/u/{username}`, set viewport 767×900 (one pixel below the breakpoint), screenshot. Expected: full-width layout, no centering/capping visible — confirms the `@media (width >= 48rem)` guard is working at the boundary.

---

## Status: Phase 1 / Browse batch complete, plus shared tablet-chrome fixes

All 6 tasks above are done and committed. During execution, several bugs in the **shared tablet chrome** (not scoped to Browse specifically, but blocking/breaking every tablet screen) were found and fixed in the same branch, since they made the tablet tier unusable regardless of which screen batch was being tested:

- **Desktop sidebar nav (`#sidebar`)** — Compendium/Sanctum/My Dossier were opening the mobile modal-sheet menu (`openCompendiumMenu()`/etc., always `openModal(...)`) instead of expanding inline. Replaced with a real accordion: each group is a label (`<a>`, navigates to the section's own overview route) + a separate chevron `<button>` (toggles `.sidebar-group-open`, animated via `grid-template-rows` in `new_ui/css/cards.css`). `router.js`'s `setActiveNav` now calls `setSidebarGroupOpen(activeTab)` so the correct group auto-expands on navigation.
- **Fixed notif bell / privacy toggle (`#notifBellBtn`, `#censorToggle`)** — was `fixed top-2 right-2 z-[9999]` at every tier, overlapping in-flow page-header buttons (e.g. Masks' "+") on tablet/desktop since `#main` only reserved top padding for mobile's fixed header. Moved to the tablet rail's bottom area (above the avatar, centered, tooltips flipped rightward via `.rail-tools` scoped CSS to avoid clipping at the viewport's left edge) via responsive Tailwind classes (`md:` bottom-left, `lg:` reverts to top-right). `#main`'s top padding adjusted to match (`md:pt-4 lg:pt-16`).
- **Tablet rail avatar disappearing** — `#tabletRail` had `overflow-y-auto` wrapping its *entire* content including the avatar; once the bell/toggle were added the rail's content exceeded viewport height and the avatar (meant to be pinned to the bottom) required scrolling to reach. Fixed by splitting the rail into a scrollable icon-list region (`flex-1 min-h-0 overflow-y-auto`) and an avatar footer outside the scroll area, with the `<aside>` itself made `md:sticky md:top-0 md:h-screen` so it's capped to viewport height (previously it grew as tall as `#main`'s content via the parent's `min-h-screen`).
- **Tablet rail avatar action** — was `navigate('/settings')`; changed to `openDossierMenu()` (same modal the mobile bottom nav's avatar already opens: Dossier/Settings/Tutorial/Sign Out).
- **Tablet rail active-state marker** — was a plain 3px rounded bar; replaced with the same bookmark/ribbon-notch `clip-path` shape as the mobile bottom nav's `#navRibbon`, rotated for vertical left-edge placement (`.tablet-rail-active::before` in `new_ui/css/cards.css`).
- **Notifications panel positioning** (`new_ui/js/notifications.js`) — assumed the bell was always top-right (`right = innerWidth - bell.right`, `top = bell.bottom + 8`), which put the panel off-screen once the bell could be bottom-left. Made direction-aware: checks whether the panel fits below/right of the bell and falls back to above/left when it doesn't.
- Removed two now-redundant standalone Settings/Sign-out icons from the tablet rail (covered by the avatar's Dossier modal).

These are prerequisites for Phase 2 (desktop) and Phase 3 (ultrawide) sanity — desktop's sidebar accordion and the notif-bell/panel fixes are shared chrome, not Browse-batch-specific, so later phases build on a working baseline rather than re-discovering the same bugs.

## Self-Review Notes

- Spec coverage: all 4 screens named in `2026-07-16-tablet-browse-batch-design.md` have a task (Symposium=Task 2, Symposium-thread=Task 3, character=Task 4, artisan-profile=Task 5); the spec's explicit exclusion (grid screens) is verified in Task 6; the spec's "no clipping of existing sub-caps" concern (`.ig-detail`'s 460px) is satisfied structurally since 460px < 680px.
- The plan additionally consolidates two pre-existing ad-hoc 640px inline caps (Symposium-thread, CharacterView) into the shared class instead of leaving three different cap values in the codebase — this is in scope of "capped centered column" and keeps the codebase DRY per CLAUDE.md's coding style rules, not scope creep.
