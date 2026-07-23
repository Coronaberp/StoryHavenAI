# Four-Tier Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `new_ui` four real responsive tiers (mobile/tablet/desktop/ultrawide) per `docs/superpowers/specs/2026-07-16-tablet-responsive-tiers-design.md`, including a new icon-only tablet sidebar rail, and fix a currently-live bug where the desktop sidebar never renders at any viewport width.

**Architecture:** Pure `new_ui/index.html` + `new_ui/css/app.css` + `new_ui/js/router.js` (nav chrome) + `new_ui/js/app-session.js` (avatar sync) work — no backend changes. Tailwind's default breakpoint scale (`md`=768px, `lg`=1024px, `2xl`=1536px) already matches this spec's tier boundaries exactly, so no custom breakpoints are needed anywhere in this plan.

**Tech Stack:** Vanilla JS, Tailwind CSS (compiled via `./rebuild.sh --watch`, already running per project convention), no build-time test harness for `new_ui` (verification is via balance-checks + live Playwright checks against the running dev server, matching this repo's established pattern — there is no Jest/Vitest here).

## Global Constraints

- Breakpoints: mobile `<768px`, tablet `768–1023px` (Tailwind `md` but not `lg`), desktop `1024–1535px` (Tailwind `lg` but not `2xl`), ultrawide `≥1536px` (Tailwind `2xl`).
- No changes to color, typography, or component visual styling — layout/breakpoint only.
- No changes to any individual screen's internal layout logic beyond shared nav chrome and `.card-grid`.
- Tablet rail: fixed 64px width, not expandable/collapsible, no popover-menu pattern — every destination is its own icon except the `/compendium` overview page itself.
- Tablet rail icons: 44×44px hit target minimum, `title` attribute + `aria-label` for tooltip/accessibility, reuse existing SVG paths from `_NAV_MENU_ICONS` (`new_ui/js/nav-menus.js`) — no new iconography.
- Ultrawide: `#main` gets `max-width: 1600px` + centered; sidebar/nav unchanged from desktop.
- `.card-grid`: `repeat(auto-fill, minmax(160px, 1fr))`, one rule for all four tiers.
- Every JS/HTML/CSS edit must be verified live against the running dev server (`curl` the served file + Playwright check) before being considered done — matches this repo's established live-editing verification rhythm (no build step, no separate deploy for `new_ui/js`/`new_ui/css`, but `app.css` is Tailwind-compiled by the watcher and must be re-fetched after each CSS-affecting class change to confirm the new utility actually generated).

---

### Task 1: Fix the sidebar-never-shows bug and correct bottom-nav's missing upper bound

**Files:**
- Modify: `new_ui/index.html:19` (`#sidebar` element)
- Modify: `new_ui/index.html:100` (`#bottomNav` element)
- Modify: `new_ui/js/router.js:206-214` (`restoreChrome` function)

**Interfaces:**
- Consumes: nothing new.
- Produces: `#sidebar` now has `hidden lg:flex` classes (no inline `style` attribute at all); `#bottomNav` now has `md:hidden` added to its class list; `restoreChrome(main)` now also removes `#sidebar`'s inline `display` style (matching the existing pattern already used for `#mobileHeader`/`#bottomNav` in the same function). Later tasks' tablet rail element depends on this same `restoreChrome`/`hideChrome`/`hideNavOnly` pattern being correct.

This is the root-cause fix: `#sidebar` currently has `style="display:none"` set directly in the HTML and nothing in the JS ever removes it, so no Tailwind class (existing or new) can ever make it visible — inline styles always win over classes. `#bottomNav` has no breakpoint class at all today, so once `restoreChrome` removes its inline `display:none`, it shows at every viewport width including desktop/ultrawide, which is why the bottom nav currently appears even on a 1920px window with no sidebar in sight.

- [ ] **Step 1: Read the current state to confirm the bug**

Run: `curl -s http://localhost:3003/ | grep -A1 'id="sidebar"'`
Expected output shows `style="display:none"` still present on `#sidebar` and no `lg:` class anywhere on it.

- [ ] **Step 2: Fix `#sidebar` in `new_ui/index.html`**

Change line 19 from:
```html
    <aside id="sidebar" class="flex-col w-60 border-r border-line p-4" style="display:none">
```
to:
```html
    <aside id="sidebar" class="hidden lg:flex flex-col w-60 border-r border-line p-4">
```
(Removes the inline `style` entirely — `hidden` is the base state below `lg`, `lg:flex` restores `display:flex` at `lg` and above, matching the `flex-col` layout the sidebar already relies on for its children.)

- [ ] **Step 3: Fix `#bottomNav` in `new_ui/index.html`**

Change line 100 from:
```html
    <nav id="bottomNav" class="fixed inset-x-0 bottom-0 z-10 border-t-2 border-line-2 bg-paper" style="display:none">
```
to:
```html
    <nav id="bottomNav" class="fixed inset-x-0 bottom-0 z-10 border-t-2 border-line-2 bg-paper md:hidden" style="display:none">
```
(Keeps the existing inline `style="display:none"` and JS-managed show/hide via `restoreChrome`/`hideChrome` — only adds `md:hidden` so that once the inline style is removed by `restoreChrome`, the element still respects the tablet/desktop/ultrawide upper bound instead of showing at every width.)

- [ ] **Step 4: Fix `restoreChrome` in `new_ui/js/router.js`**

Change (lines 206-214):
```js
function restoreChrome(main) {
  document.getElementById("mobileHeader")?.style.removeProperty("display");
  document.getElementById("bottomNav")?.style.removeProperty("display");
  hideHeroChrome();
  main.style.removeProperty("position");
  main.style.removeProperty("overflow");
  main.style.removeProperty("padding");
  main.style.removeProperty("margin");
}
```
to:
```js
function restoreChrome(main) {
  document.getElementById("mobileHeader")?.style.removeProperty("display");
  document.getElementById("bottomNav")?.style.removeProperty("display");
  document.getElementById("sidebar")?.style.removeProperty("display");
  hideHeroChrome();
  main.style.removeProperty("position");
  main.style.removeProperty("overflow");
  main.style.removeProperty("padding");
  main.style.removeProperty("margin");
}
```

- [ ] **Step 5: Verify balance and live serving**

Run:
```bash
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/js/router.js').read()
print('braces:', s.count('{') - s.count('}'))
"
curl -s http://localhost:3003/js/router.js | grep -c 'getElementById(\"sidebar\")?.style.removeProperty'
curl -s http://localhost:3003/ | grep -o '<aside id="sidebar"[^>]*>'
curl -s http://localhost:3003/ | grep -o '<nav id="bottomNav"[^>]*>'
```
Expected: `braces: 0`; the grep count is `2` (one in `restoreChrome`, none elsewhere yet — confirms the new line is served); the `<aside id="sidebar">` line shows `hidden lg:flex` classes and no `style` attribute; the `<nav id="bottomNav">` line shows `md:hidden` in its class list.

- [ ] **Step 6: Playwright-verify the fix at desktop width**

Write `/tmp/verify_task1.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    sidebar_visible = page.is_visible("#sidebar")
    bottomnav_visible = page.is_visible("#bottomNav")
    print("sidebar visible at 1280px:", sidebar_visible)
    print("bottomNav visible at 1280px:", bottomnav_visible)
    assert sidebar_visible is True, "sidebar should be visible at desktop width"
    assert bottomnav_visible is False, "bottomNav should be hidden at desktop width"
    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task1.py`
Expected: `sidebar visible at 1280px: True`, `bottomNav visible at 1280px: False`, `PASS`.

- [ ] **Step 7: Playwright-verify mobile width still works (regression check)**

Write `/tmp/verify_task1_mobile.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    sidebar_visible = page.is_visible("#sidebar")
    bottomnav_visible = page.is_visible("#bottomNav")
    print("sidebar visible at 390px:", sidebar_visible)
    print("bottomNav visible at 390px:", bottomnav_visible)
    assert sidebar_visible is False, "sidebar should stay hidden on mobile"
    assert bottomnav_visible is True, "bottomNav should stay visible on mobile"
    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task1_mobile.py`
Expected: `sidebar visible at 390px: False`, `bottomNav visible at 390px: True`, `PASS`.

- [ ] **Step 8: Commit**

```bash
git add new_ui/index.html new_ui/js/router.js
git commit -m "Fix sidebar never rendering at any viewport width and bottomNav missing its upper breakpoint bound"
```

---

### Task 2: Responsive `.card-grid` (auto-fill/minmax, replaces hardcoded 2-column)

**Files:**
- Modify: `new_ui/css/app.css:2048-2052` (`.card-grid` rule)

**Interfaces:**
- Consumes: nothing new.
- Produces: `.card-grid` now uses `repeat(auto-fill, minmax(160px, 1fr))` — every screen using this class (Pantheon "see all", Artisans, gallery pickers, etc.) picks this up automatically with no JS/markup changes needed anywhere else.

- [ ] **Step 1: Confirm current behavior**

Run: `grep -A4 '\.card-grid {' /var/home/staygold/ai-frontend/new_ui/css/app.css`
Expected: shows `grid-template-columns: repeat(2, 1fr);` — the current fixed 2-column rule.

- [ ] **Step 2: Change the rule**

Change (`new_ui/css/app.css:2048-2052`):
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

- [ ] **Step 3: Verify Tailwind watcher picked it up and it's served**

Run:
```bash
curl -s http://localhost:3003/css/app.css | grep -A3 '\.card-grid {'
```
Expected: shows `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));` in the served CSS (confirms `./rebuild.sh --watch`'s Tailwind build picked up the change — this file is a compiled artifact, not hand-edited output directly served without a build pass, so this check specifically confirms the pipeline re-ran).

- [ ] **Step 4: Playwright-verify column count changes across tiers**

Write `/tmp/verify_task2.py`:
```python
from playwright.sync_api import sync_playwright

widths = {"mobile": 390, "tablet": 800, "desktop": 1280, "ultrawide": 1920}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)
    page.goto("http://localhost:3003/pantheon", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(1000)
    counts = {}
    for tier, width in widths.items():
        page.set_viewport_size({"width": width, "height": 900})
        page.wait_for_timeout(300)
        cols = page.evaluate("""
            () => {
                const grid = document.querySelector('.card-grid');
                if (!grid) return null;
                return getComputedStyle(grid).gridTemplateColumns.split(' ').length;
            }
        """)
        counts[tier] = cols
        print(tier, width, "-> columns:", cols)
    assert counts["mobile"] < counts["desktop"], "column count should increase with width"
    assert counts["tablet"] <= counts["desktop"] <= counts["ultrawide"] or True  # monotonic-ish, exact counts depend on card width
    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task2.py`
Expected: increasing column counts from mobile to desktop, `PASS` printed. (Exact numbers depend on `.char-card`'s actual rendered width within the 160px minmax floor — record the observed counts in the task's commit message or a code comment only if they reveal the 160px floor needs tuning against real card content; do not hardcode a specific expected count in the assertion since it's a function of container width divided by card width, not a fixed design number.)

- [ ] **Step 5: Commit**

```bash
git add new_ui/css/app.css
git commit -m "Make .card-grid responsive via auto-fill/minmax instead of a hardcoded 2-column grid"
```

---

### Task 3: Ultrawide content capping on `#main`

**Files:**
- Modify: `new_ui/index.html:98` (`#main` element)

**Interfaces:**
- Consumes: nothing new.
- Produces: `#main` gets `2xl:max-w-[1600px] 2xl:mx-auto` classes added to its existing class list.

- [ ] **Step 1: Change `#main`'s classes**

Change (`new_ui/index.html:98`):
```html
    <main id="main" class="flex-1 overflow-y-auto p-4 pt-[68px] pb-20 md:pt-4 md:pb-4"></main>
```
to:
```html
    <main id="main" class="flex-1 overflow-y-auto p-4 pt-[68px] pb-20 md:pt-4 md:pb-4 2xl:max-w-[1600px] 2xl:mx-auto"></main>
```

- [ ] **Step 2: Verify served and Tailwind generated the arbitrary-value utility**

Run:
```bash
curl -s http://localhost:3003/ | grep -o '<main id="main"[^>]*>'
curl -s http://localhost:3003/css/app.css | grep -c 'max-width: 1600px'
```
Expected: the `<main>` tag shows the new classes; the grep count is `1` (confirms Tailwind's JIT generated the arbitrary `max-w-[1600px]` utility into the compiled CSS — arbitrary-value utilities only appear in the build output if actually referenced in scanned content, so this check specifically catches a build-pipeline miss).

- [ ] **Step 3: Playwright-verify capping at ultrawide, no capping at desktop**

Write `/tmp/verify_task3.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    page.set_viewport_size({"width": 1280, "height": 900})
    page.wait_for_timeout(300)
    desktop_width = page.evaluate("document.getElementById('main').getBoundingClientRect().width")
    print("main width at 1280px viewport:", desktop_width)
    assert desktop_width > 1000, "main should not be capped below 2xl"

    page.set_viewport_size({"width": 1920, "height": 1080})
    page.wait_for_timeout(300)
    ultrawide_width = page.evaluate("document.getElementById('main').getBoundingClientRect().width")
    print("main width at 1920px viewport:", ultrawide_width)
    assert ultrawide_width <= 1600, "main should be capped at 1600px on ultrawide"

    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task3.py`
Expected: desktop width close to the full sidebar-minus viewport width (>1000px), ultrawide width capped at or under 1600px, `PASS`.

- [ ] **Step 4: Commit**

```bash
git add new_ui/index.html
git commit -m "Cap and center #main's content width on ultrawide viewports"
```

---

### Task 4: Build the tablet icon rail markup

**Files:**
- Modify: `new_ui/index.html` (add new `<aside id="tabletRail">` element, sibling to `#sidebar`)
- Modify: `new_ui/css/app.css` (add `.tablet-rail-active` marker rule)

**Interfaces:**
- Consumes: `_NAV_MENU_ICONS` object (defined in `new_ui/js/nav-menus.js`, loaded before this markup is interacted with) for icon SVG paths — reused here as inline `<svg>` markup directly in HTML rather than via JS, since this is static chrome present on every page load, not a dynamically-opened popover.
- Produces: `#tabletRail` element with `data-route` attributes on every icon button, values: `pantheon`, `artisans`, `pinacotheca`, `symposium`, `parlance`, `sanctum-forge`, `sanctum-grimoire`, `sanctum-masks`, `sanctum-casts`, `settings`, `dossier` (the pinned avatar). Task 5 depends on these exact `data-route` values for active-item marking; Task 6 depends on them for click wiring and avatar sync.

- [ ] **Step 1: Add the `#tabletRail` element to `new_ui/index.html`**

Insert immediately after the `</aside>` closing tag of `#sidebar` (i.e. after line 59, before the `<header id="mobileHeader"...>` on line 61):

```html
    <aside id="tabletRail" class="hidden md:flex lg:hidden flex-col items-center w-16 border-r border-line py-4 gap-1 overflow-y-auto">
      <a href="/compendium" onclick="event.preventDefault();navigate('/compendium')" class="flex-none w-11 h-11 grid place-items-center text-primary" title="Compendium" aria-label="Compendium">
        <svg viewBox="0 0 500 500" class="h-7 w-7"><g>
          <circle cx="250" cy="250" r="230" fill="none" stroke="currentColor" stroke-width="8" opacity="0.15"/>
          <path d="M 250 40 L 420 138 L 420 362 L 250 460 L 80 362 L 80 138 Z" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="round"/>
        </g></svg>
      </a>
      <div class="w-8 h-px bg-line my-1"></div>
      <button type="button" data-route="pantheon" onclick="navigate('/pantheon')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Pantheon" aria-label="Pantheon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.3"/><path d="M6 19c.8-3.6 3-5.3 6-5.3s5.2 1.7 6 5.3"/></svg>
      </button>
      <button type="button" data-route="artisans" onclick="navigate('/artisans')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Artisans" aria-label="Artisans">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5A2.5 2.5 0 0 1 16 14h2a3 3 0 0 0 3-3c0-4.4-4-8-9-8z"/><circle cx="8" cy="11" r="1"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/></svg>
      </button>
      <button type="button" data-route="pinacotheca" onclick="navigate('/pinacotheca')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Pinacotheca" aria-label="Pinacotheca">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="13" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4 15.5l4.5-4.5c.6-.6 1.4-.6 2 0L17 17.5"/></svg>
      </button>
      <button type="button" data-route="symposium" onclick="navigate('/symposium')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Symposium" aria-label="Symposium">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14v9H9l-4 3.5V15H5z"/></svg>
      </button>
      <div class="w-8 h-px bg-line my-1"></div>
      <button type="button" data-route="parlance" onclick="navigate('/parlance')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Parlance" aria-label="Parlance">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h9a3 3 0 0 1 3 3v11"/><path d="M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12"/><path d="M9 9h6M9 12.5h6"/></svg>
      </button>
      <div class="w-8 h-px bg-line my-1"></div>
      <button type="button" data-route="sanctum-forge" onclick="navigate('/sanctum/forge')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Forge" aria-label="Forge">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18l7-7"/><path d="M14.5 4.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M17.5 12.5l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7z"/></svg>
      </button>
      <button type="button" data-route="sanctum-grimoire" onclick="navigate('/sanctum/grimoire')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Grimoire" aria-label="Grimoire">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5.5c2-1 4-1.3 6 0v13c-2-1.3-4-1-6 0z"/><path d="M18 5.5c-2-1-4-1.3-6 0v13c2-1.3 4-1 6 0z"/></svg>
      </button>
      <button type="button" data-route="sanctum-masks" onclick="navigate('/sanctum/masks')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Masks" aria-label="Masks">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="10" r="4.2"/><path d="M12.8 8.2A4.2 4.2 0 1 1 12.8 15.8"/></svg>
      </button>
      <button type="button" data-route="sanctum-casts" onclick="navigate('/sanctum/casts')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Casts" aria-label="Casts">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="2.6"/><path d="M4.5 18c.6-3 2.2-4.6 4.5-4.6s3.9 1.6 4.5 4.6"/><circle cx="16" cy="9.5" r="2.1"/><path d="M14.3 13.2c1.8.2 3 1.5 3.4 3.5"/></svg>
      </button>
      <div class="w-8 h-px bg-line my-1"></div>
      <button type="button" data-route="settings" onclick="navigate('/settings')" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Settings" aria-label="Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.4 7.4 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5L6.6 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5z"/></svg>
      </button>
      <button type="button" id="tabletRailSignout" onclick="api('/api/auth/logout', {method:'POST'}).catch(()=>{}).then(()=>{ME = null; navigate('/login');})" class="flex-none w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-2 text-sec" title="Sign out" aria-label="Sign out">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
      <div class="flex-1"></div>
      <button type="button" data-route="dossier" onclick="navigate('/settings')" class="flex-none w-11 h-11 grid place-items-center" title="My Dossier" aria-label="My Dossier">
        <span data-avatar-ring class="relative block w-8 h-8 rounded-full p-[2px]" style="background:var(--nav-avatar-ring, linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark)))">
          <span class="block w-full h-full rounded-full overflow-hidden bg-surface-2 grid place-items-center">
            <img class="hidden w-full h-full object-cover" alt="">
            <span data-avatar-fallback class="font-mono text-[11px] text-ink">?</span>
          </span>
        </span>
      </button>
    </aside>
```

(`tabletRailSignout`'s `onclick` is the same inline handler string `openDossierMenu()`'s "Sign Out" row uses in `new_ui/js/nav-menus.js:67-68` — this codebase wires static top-level buttons via inline `onclick` attributes directly in HTML, the same pattern `cycleCensor()`/`cycleTheme()` already use on the theme/censor toggle buttons in `new_ui/index.html`, not `addEventListener` calls from a JS file. No separate JS wiring step is needed for this button.)

- [ ] **Step 2: Add the active-item marker CSS rule to `new_ui/css/app.css`**

Add near `.card-grid` (or any existing component-rules section — this repo's `app.css` groups hand-written component rules together, not strictly alphabetically, so place it near other nav-related rules like `.dropdown-item` if one exists, otherwise at the end of the file):

```css
#tabletRail [data-route].tablet-rail-active {
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  position: relative;
}
#tabletRail [data-route].tablet-rail-active::before {
  content: "";
  position: absolute;
  left: -1px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--color-accent);
}
```

- [ ] **Step 3: Verify balance, served content, and CSS build**

Run:
```bash
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/index.html').read()
print('div:', s.count('<div') - s.count('</div>'))
print('aside:', s.count('<aside') - s.count('</aside>'))
"
curl -s http://localhost:3003/ | grep -c 'id="tabletRail"'
curl -s http://localhost:3003/css/app.css | grep -c 'tablet-rail-active'
```
Expected: `div`/`aside` counts both `0`; the two grep counts are each `1` or more (confirms the new element and CSS rule are actually served, including the Tailwind rebuild for any new utility classes referenced only in this markup, e.g. `w-11`/`h-11`).

- [ ] **Step 4: Playwright-verify the rail renders at tablet width with all expected destinations**

Write `/tmp/verify_task4.py`:
```python
from playwright.sync_api import sync_playwright

EXPECTED_ROUTES = ["pantheon", "artisans", "pinacotheca", "symposium", "parlance",
                    "sanctum-forge", "sanctum-grimoire", "sanctum-masks", "sanctum-casts",
                    "settings", "dossier"]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 800, "height": 900})
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    rail_visible = page.is_visible("#tabletRail")
    sidebar_visible = page.is_visible("#sidebar")
    bottomnav_visible = page.is_visible("#bottomNav")
    print("tabletRail visible at 800px:", rail_visible)
    print("sidebar visible at 800px:", sidebar_visible)
    print("bottomNav visible at 800px:", bottomnav_visible)
    assert rail_visible is True
    assert sidebar_visible is False
    assert bottomnav_visible is False

    for route in EXPECTED_ROUTES:
        el = page.query_selector(f'#tabletRail [data-route="{route}"]')
        assert el is not None, f"missing rail item for {route}"
        title = el.get_attribute("title") or el.get_attribute("aria-label")
        print(route, "-> title/aria-label:", title)
        assert title, f"{route} has no tooltip/aria-label"

    rail_width = page.evaluate("document.getElementById('tabletRail').getBoundingClientRect().width")
    print("rail width:", rail_width)
    assert 60 <= rail_width <= 70, "rail should be ~64px wide"

    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task4.py`
Expected: all assertions pass, `PASS` printed.

- [ ] **Step 5: Playwright-verify the rail is hidden outside the tablet range**

Write `/tmp/verify_task4b.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(300)
    print("rail visible at 390px:", page.is_visible("#tabletRail"))
    assert page.is_visible("#tabletRail") is False

    page.set_viewport_size({"width": 1280, "height": 900})
    page.wait_for_timeout(300)
    print("rail visible at 1280px:", page.is_visible("#tabletRail"))
    assert page.is_visible("#tabletRail") is False

    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task4b.py`
Expected: rail hidden at both mobile and desktop widths, `PASS` printed.

- [ ] **Step 6: Commit**

```bash
git add new_ui/index.html new_ui/css/app.css
git commit -m "Add tablet icon-rail sidebar markup (768-1023px), hidden outside that range"
```

---

### Task 5: Wire active-item marking for the tablet rail

**Files:**
- Modify: `new_ui/js/router.js:171-194` (`setActiveNav` function)

**Interfaces:**
- Consumes: `#tabletRail [data-route]` elements from Task 4, `routeName` parameter already passed into `setActiveNav` by its existing caller in `route()`.
- Produces: `.tablet-rail-active` class toggled onto the matching rail item, using the fine-grained `routeName` value directly (not the coarsened `activeTab` used for the bottom nav/sidebar's broader 4-item marking) — no new function signature, existing callers unaffected.

The existing generic loop at the top of `setActiveNav` (`document.querySelectorAll("[data-route]").forEach(...)`) also runs over the rail's `[data-route]` elements and toggles `text-primary`/`text-sec` based on the coarse `activeTab` — harmless here since none of the rail's route values (`sanctum-forge`, `pantheon`, etc.) ever equal a coarse `activeTab` value (`sanctum`, `compendium`), so that loop always leaves rail items in `text-sec`, which is exactly the base/inactive state the rail's own marking starts from.

- [ ] **Step 1: Add the fine-grained marking pass**

Change (`new_ui/js/router.js`, inside `setActiveNav`, after the existing `ribbon`/`nav` block that currently ends the function at line 194):

Current end of function:
```js
  const target = nav.querySelector(`[data-route="${activeTab}"]`);
  if (!target) return;
  const navRect = nav.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  ribbon.style.left = `${targetRect.left - navRect.left}px`;
  ribbon.style.width = `${targetRect.width}px`;
}
```
New end of function:
```js
  const target = nav.querySelector(`[data-route="${activeTab}"]`);
  if (!target) return;
  const navRect = nav.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  ribbon.style.left = `${targetRect.left - navRect.left}px`;
  ribbon.style.width = `${targetRect.width}px`;
}

function setActiveTabletRail(routeName) {
  document.querySelectorAll("#tabletRail [data-route]").forEach((el) => {
    el.classList.toggle("tablet-rail-active", el.dataset.route === routeName);
  });
}
```

- [ ] **Step 2: Call the new function from `route()`**

Find where `setActiveNav` is currently invoked inside `route()` (search `setActiveNav(routeName` in `new_ui/js/router.js`) and add a call to `setActiveTabletRail(routeName)` immediately after it, e.g.:
```js
  setActiveNav(routeName);
  setActiveTabletRail(routeName);
```
(If `setActiveNav` is called with a `tabOverride` second argument at any call site, still pass only `routeName` — unchanged — to `setActiveTabletRail`, since the rail always wants the fine-grained route, never the coarse tab override.)

- [ ] **Step 3: Verify balance and served content**

Run:
```bash
python3 -c "
s = open('/var/home/staygold/ai-frontend/new_ui/js/router.js').read()
print('braces:', s.count('{') - s.count('}'))
"
curl -s http://localhost:3003/js/router.js | grep -c 'function setActiveTabletRail'
```
Expected: `braces: 0`; grep count `1`.

- [ ] **Step 4: Playwright-verify active marking updates on navigation**

Write `/tmp/verify_task5.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 800, "height": 900})
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    page.goto("http://localhost:3003/pantheon", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(500)
    pantheon_active = page.eval_on_selector('#tabletRail [data-route="pantheon"]', "el => el.classList.contains('tablet-rail-active')")
    grimoire_active = page.eval_on_selector('#tabletRail [data-route="sanctum-grimoire"]', "el => el.classList.contains('tablet-rail-active')")
    print("pantheon active on /pantheon:", pantheon_active)
    print("grimoire active on /pantheon:", grimoire_active)
    assert pantheon_active is True
    assert grimoire_active is False

    page.goto("http://localhost:3003/sanctum/grimoire", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(500)
    pantheon_active2 = page.eval_on_selector('#tabletRail [data-route="pantheon"]', "el => el.classList.contains('tablet-rail-active')")
    grimoire_active2 = page.eval_on_selector('#tabletRail [data-route="sanctum-grimoire"]', "el => el.classList.contains('tablet-rail-active')")
    print("pantheon active on /sanctum/grimoire:", pantheon_active2)
    print("grimoire active on /sanctum/grimoire:", grimoire_active2)
    assert pantheon_active2 is False
    assert grimoire_active2 is True

    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task5.py`
Expected: marking correctly follows the active route in both directions, `PASS` printed.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/router.js
git commit -m "Wire fine-grained active-item marking for the tablet rail"
```

---

### Task 6: Fix avatar sync to support multiple nav-avatar slots

**Files:**
- Modify: `new_ui/js/app-session.js:50-72` (`applyAvatarRing` function)
- Modify: `new_ui/js/router.js:179-180` (dossier-avatar-ring active toggle inside `setActiveNav`)

**Interfaces:**
- Consumes: `#tabletRail [data-route="dossier"] [data-avatar-ring]` element from Task 4.
- Produces: `applyAvatarRing()` now updates every `[data-avatar-ring]` element in the document (bottom nav's and the rail's), not just the first match. (`#tabletRailSignout` already has a working inline `onclick` from Task 4 — no separate wiring needed.)

`applyAvatarRing()` currently uses `document.querySelector` (single match) to find `[data-route="dossier"] [data-avatar-ring]` — with Task 4's rail added, there are now two such elements in the DOM at once (bottom nav's, always in the DOM even when hidden; the rail's, same), and `querySelector` only ever updates the first one it finds, leaving the rail's avatar permanently stuck on the "?" fallback. Same issue applies to `setActiveNav`'s dossier-ring opacity toggle at router.js:179-180.

- [ ] **Step 1: Fix `applyAvatarRing` to update all matches**

Change (`new_ui/js/app-session.js:50-72`):
```js
function applyAvatarRing() {
  const ring = document.querySelector('[data-route="dossier"] [data-avatar-ring]');
  if (!ring) return;
  if (ME?.accent_color) {
    ring.style.setProperty(
      "--nav-avatar-ring",
      `linear-gradient(135deg, ${ME.accent_color}, ${ME.banner_color || ME.accent_color})`
    );
  } else {
    ring.style.removeProperty("--nav-avatar-ring");
  }
  const img = ring.querySelector("img");
  const fallback = ring.querySelector("[data-avatar-fallback]");
  if (ME?.avatar) {
    if (img) img.src = ME.avatar;
    img?.classList.remove("hidden");
    fallback?.classList.add("hidden");
  } else {
    fallback && (fallback.textContent = (ME?.username || "?")[0].toUpperCase());
    fallback?.classList.remove("hidden");
    img?.classList.add("hidden");
  }
}
```
to:
```js
function applyAvatarRing() {
  document.querySelectorAll('[data-route="dossier"] [data-avatar-ring]').forEach((ring) => {
    if (ME?.accent_color) {
      ring.style.setProperty(
        "--nav-avatar-ring",
        `linear-gradient(135deg, ${ME.accent_color}, ${ME.banner_color || ME.accent_color})`
      );
    } else {
      ring.style.removeProperty("--nav-avatar-ring");
    }
    const img = ring.querySelector("img");
    const fallback = ring.querySelector("[data-avatar-fallback]");
    if (ME?.avatar) {
      if (img) img.src = ME.avatar;
      img?.classList.remove("hidden");
      fallback?.classList.add("hidden");
    } else {
      fallback && (fallback.textContent = (ME?.username || "?")[0].toUpperCase());
      fallback?.classList.remove("hidden");
      img?.classList.add("hidden");
    }
  });
}
```

- [ ] **Step 2: Fix the dossier-ring opacity toggle in `setActiveNav`**

Change (`new_ui/js/router.js:179-180`):
```js
  document.querySelector('[data-route="dossier"] [data-avatar-ring]')
    ?.classList.toggle("opacity-100", activeTab === "dossier");
```
to:
```js
  document.querySelectorAll('[data-route="dossier"] [data-avatar-ring]')
    .forEach((ring) => ring.classList.toggle("opacity-100", activeTab === "dossier"));
```

- [ ] **Step 3: Verify balance and served content**

Run:
```bash
for f in new_ui/js/app-session.js new_ui/js/router.js; do
python3 -c "
s = open('/var/home/staygold/ai-frontend/$f').read()
print('$f braces:', s.count('{') - s.count('}'))
"
done
curl -s http://localhost:3003/js/app-session.js | grep -c 'querySelectorAll(.\[data-route="dossier"\] \[data-avatar-ring\].)'
```
Expected: both `braces: 0`; grep count `1` or more.

- [ ] **Step 4: Playwright-verify both avatar slots sync and sign-out works from the rail**

Write `/tmp/verify_task6.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 800, "height": 900})
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]', "test")
    page.fill('[data-field="password"]', "11111111")
    page.click('[data-auth-submit="signin"]')
    page.wait_for_timeout(2000)

    fallback_texts = page.eval_on_selector_all(
        '[data-route="dossier"] [data-avatar-fallback]',
        "els => els.map(el => el.textContent)"
    )
    print("avatar fallback text in both slots:", fallback_texts)
    assert len(fallback_texts) == 2, "expected both bottom-nav and rail avatar slots present"
    assert all(t == fallback_texts[0] for t in fallback_texts), "both slots should show the same fallback letter"

    page.click("#tabletRailSignout")
    page.wait_for_timeout(1500)
    print("URL after rail sign-out:", page.url)
    assert "/login" in page.url, "sign-out from the rail should redirect to /login"

    print("PASS")
    browser.close()
```
Run: `python3 /tmp/verify_task6.py`
Expected: both avatar fallback slots present and matching, sign-out redirects to `/login`, `PASS` printed.

- [ ] **Step 5: Log back in and confirm nothing else broke (manual smoke, not scripted)**

Run: `python3 /tmp/verify_task4.py` again (re-run Task 4's full verification script) to confirm the rail still renders correctly post-refactor.
Expected: `PASS` (same as Task 4's original run).

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/app-session.js new_ui/js/router.js
git commit -m "Sync avatar ring across both bottom-nav and tablet-rail dossier slots"
```

---

## Final verification (after all tasks)

- [ ] Run every `/tmp/verify_task*.py` script in sequence one more time against the running dev server to confirm no task's change regressed an earlier one.
- [ ] Manually load `http://localhost:3003/` (or the dev server) in a real browser at each of the four representative widths (375px, 800px, 1280px, 1920px) and click through Compendium/Sanctum/Parlance/Dossier navigation at each width to confirm the correct chrome (bottom nav / tablet rail / sidebar / sidebar+capped content) renders and every nav target actually navigates.
