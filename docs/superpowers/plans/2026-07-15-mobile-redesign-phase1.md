# Mobile Redesign — Phase 1: Chrome + Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app chrome (bottom tab bar, drawer, create sheet) and the core content loop (Explore/Library → Character dossier → Chat thread, plus Chats/recents) in `new_ui/`, wired to real backend endpoints, matching the interaction design in `Mobile-first app redesign/Mobile App.dc.html`.

**Architecture:** Vanilla JS, one small file per screen/concept under `new_ui/js/`, mounted through the existing `routes` map in `new_ui/js/router.js`. Each screen module exposes a `mount(main)` function (matching the existing `AUTH.mount(main)` / `js/login.js` pattern) or, where a screen has real per-instance live state (the chat thread's SSE stream), a small class instantiated once per screen visit. Tailwind utility classes + the existing CSS custom properties in `new_ui/css/themes.css`/`app.css` for styling — no new design tokens introduced in this phase.

**Tech Stack:** Vanilla JS (no framework, no bundler beyond the vendored Tailwind CLI via `./rebuild.sh`), Tailwind CSS, FastAPI backend already running (`backend/routers/characters.py`, `backend/routers/sessions.py`, `backend/routers/chat.py`), served during development by `new_ui_server.py` on `:3001`.

## Global Constraints

- Zero comments in any `.py` or `.js` file added or modified, ever — no exceptions (per CLAUDE.md Coding style).
- No single-letter variable names outside genuine loop indices; no magic numbers.
- Never nest more than 3 levels deep — extract a function instead.
- Classes only where real per-instance state exists (a live SSE connection + turn list). Everything else is plain functions (per CLAUDE.md's "OOP is mandatory — for stateful code only").
- Every new function/class with real logic gets an automated test alongside it (pytest for any backend change; for `new_ui/js`, this repo has no existing JS test harness — see Task 0 below, which addresses this before any JS logic lands).
- `new_ui/` is served by `new_ui_server.py` via `./rebuild.sh`, never by the container's `uvicorn --reload` on `:3000` — do not touch `server.py`, `static/`, or restart `story-game` for this work.
- Follow existing file patterns exactly: `js/login.js`'s `mount(main)` / template-string-returning-functions / `data-*` attribute event delegation style is the reference implementation for every new screen file in this plan.
- `new_ui/js/app-session.js` already exposes `ME` (current user) and an `api(path, opts)` helper (used by `login.js` as `api("/api/auth/login", {...})`) — reuse it for every fetch in this plan; do not write a second fetch wrapper.
- **This plan is phone-only, full stop.** The eventual target is 4 responsive layouts (phone/tablet/pc/ultrawide) via Tailwind's already-configured breakpoints (`css/app.css:254-266`: `sm` 640px / `md` 768px / `lg` 1024px / `xl` 1280px / `2xl` 1536px), built mobile-first — i.e. the phone layout is the unprefixed base and every larger tier is a pure additive `md:`/`lg:`/`2xl:` override layered on top later, never a restructure of the phone markup. But that layering is explicitly **out of scope for Phase 1**: no `md:`/`lg:`/`xl:`/`2xl:` classes, no `#sidebar` wiring, no desktop-only structural changes (e.g. side panels) in any task below. `#sidebar`/`#mobileHeader` stay exactly as currently scaffolded (untouched); only `#bottomNav`-equivalent chrome (`chrome.js`) and `#main` content are built. Tablet/PC/ultrawide breakpoint work is its own later phase, added on top of a finished, verified phone experience — see the Roadmap section.
  - Manual verification in every task is phone-viewport only (devtools responsive mode at ~390px width, matching the mockup's 392px phone frame) — do not check or fix wider viewports in this plan.

---

## Pre-flight findings (do not re-derive these — already verified against the running codebase)

- **Auth is already fully built** in `new_ui/js/login.js` and matches the real backend (`/api/auth/login`, `/register`, `/password-reset/totp`) — TOTP-based recovery is real and working server-side (`backend/auth.py:283-468`). The mockup's dedicated "TOTP enroll" screen (QR code, step 2 of registration) does **not** match this app's actual flow: registration here creates a `status="pending"` account awaiting admin approval (`waitEl` in `login.js`), and TOTP is opt-in from Settings (`/api/auth/totp/setup` + `/totp/enable`), not a forced registration step. **Do not build a TOTP-enroll screen in Phase 1** — it belongs to the Settings phase (Phase 4 below) as an optional "Enable 2FA" row, not to auth. This closes the "TOTP gap" flagged during analysis: no backend work needed, and no auth frontend work needed either.
- **Generation studio's inpaint and video modes (txt2vid/img2vid) have no backend support at all** — `backend/imagegen_workflows.py` only builds txt2img/img2img (reference-image splice)/upscale workflows; there is no mask-splicing function and no video graph builder. This is excluded from Phase 1 entirely and is out of scope for this plan — it needs its own spec (new ComfyUI workflow types, likely new settings for a video-capable checkpoint) before any frontend work on those two modes starts.
- **Settings toggles the mockup shows (mature content, privacy blur, creator themes) do not exist as config keys today** — `PUBLIC_CFG_KEYS`/`USER_CFG_KEYS` in `backend/state.py:238-271` have no `mature_content`/`privacy_blur`/`creator_themes` entries. Out of scope for Phase 1 (no Settings screen in this phase); flagged for the Settings phase.
- **Per-character custom theming (mockup's `THEMES`/`creatorThemes`) already has a home**: `characters.presentation_html` (`backend/db.py:125`) is exactly this — a per-character HTML/CSS block. No new schema needed. Phase 1's dossier screen renders it if present (Task 5).
- `characters.is_explicit` (`backend/db.py:129`) is the real NSFW flag — maps 1:1 to the mockup's `NSFW` set / blur behavior.

## Roadmap (this document plans Phase 1 only)

1. **Phase 1 (this plan):** App chrome (bottom tab bar + drawer + create sheet) + routing wiring, Explore/Library screen, Character dossier screen, Chats (recents) screen, Chat thread screen with real SSE streaming.
2. **Phase 2 (separate plan):** Creations (my characters) + Personas + Create-character form — needs `backend/routers/characters.py` POST/PUT wiring, avatar upload.
3. **Phase 3 (separate plan):** Generation studio (txt2img/img2img/upscale only, per the gap above) + Gallery — needs `backend/routers/imagegen.py` streaming wiring and `imagegen_options.py` for real checkpoint/LoRA/sampler lists.
4. **Phase 4 (separate plan):** Settings modal — needs new `PUBLIC_CFG_KEYS`/`USER_CFG_KEYS` entries for mature/privacy/creator-theme toggles (small backend task) before the frontend panel is built.
5. **Phase 5 (separate plan):** Forum + Admin panel — largest remaining backend-surface screens, lowest priority per the mockup's own drawer ordering.
6. **Phase 6 (separate plan, after all screens exist at phone width):** Responsive layering — add `md:`/`lg:`/`2xl:` breakpoint overrides on top of every screen built in Phases 1-5 to produce the tablet/PC/ultrawide layouts, wire `#sidebar` as the tablet+ primary nav in place of the bottom tab bar, and add the wider-tier structural changes (max-width content columns, secondary side panels). Deliberately last: laying out 4 breakpoints per screen before the phone version of every screen is finished and reviewed would mean redoing responsive work every time a not-yet-built screen changes shape.

Do not start Phase 2+ work under this plan — each needs its own `writing-plans` pass once Phase 1 lands, since they depend on decisions (e.g. avatar upload UX, generation progress UI) that should be reviewed independently.

---

## File Structure

New files this plan creates:

- `new_ui/js/chrome.js` — bottom tab bar, drawer, create bottom-sheet: pure render/wire functions, no class (transient DOM, no persisted state beyond current route which `router.js` already owns).
- `new_ui/js/library.js` — Explore/Library screen: fetch character list, render hero + grid, mount into `routes.library`.
- `new_ui/js/chats.js` — Chats (recents) screen: fetch session list, render.
- `new_ui/js/dossier.js` — Character dossier screen: fetch one character + lore, render, "Start chat" CTA.
- `new_ui/js/chat-thread.js` — Chat thread screen: a `ChatThread` class owning the live SSE connection + turn list (this is the one genuine-state class in this plan, per the OOP rule) plus composer wiring.
- `new_ui/js/markdown.js` — the mockup's `md()` bold/italic/curly-quote formatter, ported as a plain function, shared by `chat-thread.js` and `dossier.js` (both render character prose).
- `new_ui/js/avatar.js` — the mockup's `avatar(mono, hue, size)` monogram-tile helper, ported as a plain function, shared across all screens in this plan (library cards, chats list, dossier, chat header).
- `tests/new_ui/markdown.test.js` and `tests/new_ui/avatar.test.js` — see Task 0.

Modified files:

- `new_ui/js/router.js` — replace the `library`, `community`(rename usage clarified in Task 1) placeholders with real mounts; add `dossier` and `chat` routes; wire the bottom tab bar / drawer / create sheet mount points from `chrome.js`.
- `new_ui/index.html` — add mount containers for the drawer and create-sheet overlays (currently only `#main` exists per the 107-line shell) and load the new script tags in dependency order.

No backend files are modified in Phase 1 — every endpoint this phase needs (`GET /api/characters`, `GET /api/characters/{cid}`, `GET /api/sessions`, `POST /api/characters/{cid}/sessions`, `POST /api/sessions/{sid}/chat` SSE) already exists.

---

### Task 0: Stand up a JS test harness

There is currently no JS test runner in this repo (`new_ui/` has zero test files). Every subsequent task in this plan needs to write a JS test per the Global Constraints, so this has to exist first.

**Files:**
- Create: `tests/new_ui/package.json`
- Create: `tests/new_ui/markdown.test.js`
- Modify: `new_ui/js/markdown.js` (created by this task, tested immediately)

**Interfaces:**
- Produces: `md(text)` — takes a string, returns an array of strings and `{tag: "strong"|"em"|"quote", text: string}` plain objects (no DOM/React dependency, so it's usable both in the browser via a tiny render helper and directly in Node tests).

- [ ] **Step 1: Create the test package**

```json
{
  "name": "new-ui-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

Write this to `tests/new_ui/package.json`.

- [ ] **Step 2: Write the failing test for `md()`**

Write to `tests/new_ui/markdown.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { md } from "../../new_ui/js/markdown.js";

test("md() splits bold, italic, and curly-quoted spans", () => {
  const out = md('Plain **bold** and *italic* and “quoted” text');
  assert.deepEqual(out, [
    "Plain ",
    { tag: "strong", text: "bold" },
    " and ",
    { tag: "em", text: "italic" },
    " and ",
    { tag: "quote", text: "quoted" },
    " text",
  ]);
});

test("md() returns the whole string unchanged when there is no markup", () => {
  assert.deepEqual(md("no markup here"), ["no markup here"]);
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `cd tests/new_ui && node --test` (from repo root: `cd /var/home/staygold/ai-frontend/tests/new_ui && node --test`)
Expected: FAIL — `Cannot find module '../../new_ui/js/markdown.js'` (file doesn't exist yet).

- [ ] **Step 4: Implement `md()` as an ES module**

Write to `new_ui/js/markdown.js`:

```js
export function md(text) {
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|“([^”]+)”/g;
  const out = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) out.push({ tag: "strong", text: match[1] });
    else if (match[2] !== undefined) out.push({ tag: "em", text: match[2] });
    else out.push({ tag: "quote", text: match[3] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

export function mdHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return md(text).map((part) => {
    if (typeof part === "string") return esc(part);
    if (part.tag === "strong") return `<strong class="text-ink font-bold">${esc(part.text)}</strong>`;
    if (part.tag === "em") return `<em class="text-sec italic">${esc(part.text)}</em>`;
    return `<span class="text-ink">“${esc(part.text)}”</span>`;
  }).join("");
}
```

`new_ui/index.html` loads plain `<script>` tags today (no `type="module"`, per `js/login.js`'s bare `class AuthView {}` / global-scope style), so also append a non-module global export at the bottom of the same file so browser usage keeps working without touching `index.html`'s script-loading style in this task:

```js
if (typeof window !== "undefined") {
  window.md = md;
  window.mdHtml = mdHtml;
}
```

- [ ] **Step 5: Run the test again and confirm it passes**

Run: `cd /var/home/staygold/ai-frontend/tests/new_ui && node --test`
Expected: PASS, 2 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add tests/new_ui/package.json tests/new_ui/markdown.test.js new_ui/js/markdown.js
git commit -m "test(new_ui): add JS test harness, port md() markdown formatter"
```

---

### Task 1: Port the avatar monogram helper

**Files:**
- Create: `new_ui/js/avatar.js`
- Test: `tests/new_ui/avatar.test.js`

**Interfaces:**
- Consumes: nothing beyond plain args.
- Produces: `avatarHtml(mono, hue, size, radius)` → HTML string. Used by Tasks 2, 3, 4, 5.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarHtml } from "../../new_ui/js/avatar.js";

test("avatarHtml embeds the monogram character and computed size", () => {
  const html = avatarHtml("A", 38, 50);
  assert.match(html, /width:50px;height:50px/);
  assert.match(html, /hsl\(38 42% 32%\)/);
  assert.match(html, />A</);
});

test("avatarHtml defaults radius to 28% of size when omitted", () => {
  const html = avatarHtml("K", 265, 100);
  assert.match(html, /border-radius:28px/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd /var/home/staygold/ai-frontend/tests/new_ui && node --test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Write to `new_ui/js/avatar.js`:

```js
export function avatarHtml(mono, hue, size, radius) {
  const borderRadius = radius ?? Math.round(size * 0.28);
  const fontSize = Math.round(size * 0.42);
  return `<div class="grid place-items-center flex-none font-display text-white" style="width:${size}px;height:${size}px;border-radius:${borderRadius}px;font-size:${fontSize}px;background:linear-gradient(150deg, hsl(${hue} 42% 32%), hsl(${hue} 45% 16%));box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)">${mono}</div>`;
}

if (typeof window !== "undefined") {
  window.avatarHtml = avatarHtml;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd /var/home/staygold/ai-frontend/tests/new_ui && node --test`
Expected: PASS, 4 tests total (2 from Task 0 + 2 here).

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/avatar.js tests/new_ui/avatar.test.js
git commit -m "feat(new_ui): add avatar monogram tile helper"
```

---

### Task 2: App chrome — bottom tab bar, drawer, create sheet

**Files:**
- Create: `new_ui/js/chrome.js`
- Modify: `new_ui/index.html:1-107` — add `#drawer` and `#createSheet` overlay containers, load `chrome.js`, `avatar.js`, `markdown.js` script tags before `router.js`.
- Modify: `new_ui/js/router.js:1-71` — call `Chrome.mount()` once at boot (from `boot.js`) and `Chrome.setActive(routeName)` inside `route()`.

**Interfaces:**
- Consumes: `navigate(path)` and `ME` (current user, `{username}` shape) from `new_ui/js/app-session.js`.
- Produces: `Chrome.mount()`, `Chrome.setActive(routeName)`, `Chrome.openDrawer()`, `Chrome.closeDrawer()`, `Chrome.openCreateSheet()`, `Chrome.closeCreateSheet()` — a plain object (not a class: it owns no data beyond DOM state already reflected in the DOM itself, matching the "AUTH is a class only because AuthView holds view/loading/error fields" precedent — Chrome holds nothing beyond what's already in the DOM, so it stays a plain object of functions, consistent with `dom-utils.js`'s precedent cited in CLAUDE.md).

- [ ] **Step 1: Read the current `index.html` shell to find the exact insertion points**

Run: `sed -n '1,107p' /var/home/staygold/ai-frontend/new_ui/index.html`

Confirm where `#sidebar`, `#mobileHeader`, `#bottomNav`, and `#main` are declared (per `router.js`'s `hideChrome`/`restoreChrome`, these three ids already exist). This step has no code output — it's a read to avoid guessing at existing markup.

- [ ] **Step 2: Add drawer and create-sheet containers to `index.html`**

Add immediately before the closing `</body>` tag in `new_ui/index.html`:

```html
<div id="drawer" class="fixed inset-0 z-50 hidden"></div>
<div id="createSheet" class="fixed inset-0 z-50 hidden"></div>
```

Add script tags for the new files, in this order, before the existing `router.js` tag:

```html
<script src="js/avatar.js"></script>
<script src="js/markdown.js"></script>
<script src="js/chrome.js"></script>
```

- [ ] **Step 3: Write `chrome.js`**

Write to `new_ui/js/chrome.js`:

```js
"use strict";

const TABS = [
  { route: "library", label: "Explore", icon: "explore" },
  { route: "chats", label: "Chats", icon: "chats" },
  { route: null, label: "", icon: "plus", isCreate: true },
  { route: "forum", label: "Forum", icon: "forum" },
  { route: "images", label: "Studio", icon: "creations" },
];

const TAB_ICON_PATHS = {
  explore: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.6-1 4-1 4 1 4 1"/><path d="M15.5 8.5l-2.2 4.2-4.2 2.2 2.2-4.2z"/>',
  chats: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  forum: '<path d="M17 8V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9l3-3h3"/><path d="M21 10a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6l3 3z"/>',
  creations: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/><circle cx="12" cy="12" r="2.6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
};

function tabIcon(name, size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${TAB_ICON_PATHS[name]}</svg>`;
}

function bottomNavHtml(activeRoute) {
  const items = TABS.map((tab) => {
    if (tab.isCreate) {
      return `
        <button type="button" data-create-open class="flex-none -mt-6 w-14 h-14 rounded-2xl grid place-items-center text-paper bg-gradient-to-br from-primary to-primary-dark shadow-lg">
          ${tabIcon("plus", 26)}
        </button>
      `;
    }
    const active = tab.route === activeRoute;
    return `
      <a href="/${tab.route}" data-route="${tab.route}" class="flex-1 flex flex-col items-center gap-0.5 py-1 ${active ? "text-primary" : "text-muted"}">
        ${tabIcon(tab.icon, 22)}
        <span class="text-[9.5px] ${active ? "font-semibold" : "font-medium"}">${tab.label}</span>
      </a>
    `;
  }).join("");
  return `
    <div class="flex items-end justify-between bg-surface border border-line rounded-[22px] px-2.5 py-2 shadow-lg">
      ${items}
    </div>
  `;
}

function renderBottomNav() {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;
  nav.innerHTML = bottomNavHtml(nav.dataset.active || "library");
  nav.querySelectorAll("[data-create-open]").forEach((btn) => {
    btn.addEventListener("click", () => Chrome.openCreateSheet());
  });
}

function drawerHtml() {
  const items = [
    ["explore", "Explore", "library"],
    ["chats", "Chats", "chats"],
    ["creations", "Creations", "images"],
    ["forum", "Community forum", "forum"],
  ];
  const rows = items.map(([icon, label, route]) => `
    <a href="/${route}" data-route="${route}" class="w-full flex items-center gap-3 px-5 py-3 text-ink">
      ${tabIcon(icon, 20)}<span>${label}</span>
    </a>
  `).join("");
  return `
    <div class="absolute inset-0 bg-black/60" data-drawer-scrim></div>
    <div class="absolute left-0 top-0 bottom-0 w-72 bg-surface-2 border-r border-line py-4">
      ${rows}
    </div>
  `;
}

function createSheetHtml() {
  const options = [
    ["New character", "Design a persona or a world", "/create"],
  ];
  const rows = options.map(([title, sub, href]) => `
    <a href="${href}" data-route="${href.slice(1)}" class="w-full flex items-center gap-3.5 p-3.5 bg-surface border border-line rounded-2xl mb-2.5">
      <div class="flex-1 text-left">
        <div class="font-display font-semibold text-[15px] text-ink">${title}</div>
        <div class="text-[12.5px] text-muted mt-0.5">${sub}</div>
      </div>
    </a>
  `).join("");
  return `
    <div class="absolute inset-0 bg-black/60" data-sheet-scrim></div>
    <div class="absolute left-0 right-0 bottom-0 bg-surface-2 border-t border-line rounded-t-3xl p-4 pb-8">
      <div class="w-9 h-1 rounded-full bg-line-2 mx-auto mb-4"></div>
      ${rows}
    </div>
  `;
}

const Chrome = {
  mount() {
    renderBottomNav();
  },
  setActive(routeName) {
    const nav = document.getElementById("bottomNav");
    if (nav) nav.dataset.active = routeName;
    renderBottomNav();
  },
  openDrawer() {
    const el = document.getElementById("drawer");
    if (!el) return;
    el.innerHTML = drawerHtml();
    el.classList.remove("hidden");
    el.querySelector("[data-drawer-scrim]").addEventListener("click", () => Chrome.closeDrawer());
  },
  closeDrawer() {
    document.getElementById("drawer")?.classList.add("hidden");
  },
  openCreateSheet() {
    const el = document.getElementById("createSheet");
    if (!el) return;
    el.innerHTML = createSheetHtml();
    el.classList.remove("hidden");
    el.querySelector("[data-sheet-scrim]").addEventListener("click", () => Chrome.closeCreateSheet());
  },
  closeCreateSheet() {
    document.getElementById("createSheet")?.classList.add("hidden");
  },
};

if (typeof window !== "undefined") window.Chrome = Chrome;
```

- [ ] **Step 4: Wire `Chrome.mount()`/`setActive()` into `router.js` and `boot.js`**

Read `new_ui/js/boot.js` first (3 lines) to see the exact current boot call, then modify `new_ui/js/router.js`'s `route()` function (around line 49-56) to call `Chrome.setActive(routeName)` alongside the existing `setActiveNav(routeName)` call:

```js
function route() {
  const main = document.getElementById("main");
  const routeName = currentRoute();
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else restoreChrome(main);
  routes[routeName](main);
  setActiveNav(routeName);
  Chrome.setActive(routeName);
}
```

Add `Chrome.mount();` as the first line inside whatever init function `boot.js` calls (read the file to match its existing call style exactly — likely appending one line next to an existing `route()`/`AUTH`-related call).

- [ ] **Step 5: Manual verification (no automated test — this is DOM wiring with no pure logic to unit test)**

Run `./rebuild.sh` from repo root, open `http://localhost:3001/library` in a browser, confirm: bottom tab bar renders with 5 slots, the center `+` button opens the create sheet overlay, tapping the scrim closes it. This satisfies "test in browser before reporting complete" per CLAUDE.md's UI-change rule.

- [ ] **Step 6: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/chrome.js new_ui/index.html new_ui/js/router.js
git commit -m "feat(new_ui): add bottom tab bar, drawer, and create sheet chrome"
```

---

### Task 3: Explore/Library screen

**Files:**
- Create: `new_ui/js/library.js`
- Modify: `new_ui/js/router.js:4` — replace `library: (main) => renderPlaceholder(main, "Library"),` with `library: (main) => Library.mount(main),`

**Interfaces:**
- Consumes: `api(path, opts)` from `app-session.js`, `avatarHtml` from `avatar.js`, `navigate(path)` from `router.js`.
- Produces: `Library.mount(main)`.
- Backend: `GET /api/characters?scope=community` (per `backend/routers/characters.py:29-49` — public list; the mockup's "For you"/genre tabs map to the `tags` query param in Phase 1's simplest form: pass the selected tab as `tags=<tab>` except for `"For you"` which omits the param).

- [ ] **Step 1: Write `library.js`**

```js
"use strict";

const LIBRARY_TABS = ["For you", "Fantasy", "RPG", "Cozy", "Sci-fi", "Romance"];

function libraryCardHtml(c) {
  const mono = (c.name || "?").charAt(0).toUpperCase();
  const hue = c.is_explicit ? 340 : 220;
  const blurred = c.is_explicit;
  return `
    <button type="button" data-open-char="${c.id}" class="text-left bg-surface border border-line rounded-2xl overflow-hidden flex flex-col">
      <div class="relative h-28 overflow-hidden">
        <div class="absolute inset-0" style="background:linear-gradient(155deg, hsl(${hue} 42% 30%), hsl(${hue} 48% 12%));${blurred ? "filter:blur(16px);transform:scale(1.15)" : ""}"></div>
        <div class="absolute inset-0 grid place-items-center font-display text-4xl text-white/90" style="${blurred ? "filter:blur(16px)" : ""}">${mono}</div>
        <span class="absolute left-2 top-2 font-mono text-[9.5px] tracking-widest uppercase px-1.5 py-0.5 rounded border ${c.mode === "rpg" ? "border-[#7bd88f44] text-[#7bd88f] bg-[#7bd88f10]" : "border-primary/30 text-primary bg-primary/10"}">${c.mode === "rpg" ? "RPG" : "Chat"}</span>
      </div>
      <div class="p-3">
        <div class="font-display font-semibold text-[14.5px] text-ink">${c.name}</div>
        <div class="text-[11.8px] text-sec mt-1 mb-2 line-clamp-2">${c.description || ""}</div>
      </div>
    </button>
  `;
}

const Library = {
  mount(main) {
    this.tab = this.tab || "For you";
    this.render(main);
    this.load(main);
  },
  render(main) {
    const tabs = LIBRARY_TABS.map((t) => `
      <button type="button" data-tab="${t}" class="flex-none px-3.5 py-1.5 rounded-full text-[12.5px] font-medium ${t === this.tab ? "bg-gradient-to-br from-primary to-primary-dark text-paper" : "border border-line-2 text-sec"}">${t}</button>
    `).join("");
    main.innerHTML = `
      <h1 class="font-display text-xl font-semibold text-ink mb-3">Explore</h1>
      <div class="flex gap-2 overflow-x-auto pb-3 mb-3" data-tab-row>${tabs}</div>
      <div class="grid grid-cols-2 gap-3" data-char-grid>
        <div class="col-span-2 text-center text-muted text-sm py-10">Loading…</div>
      </div>
    `;
    main.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.tab = btn.dataset.tab;
        this.render(main);
        this.load(main);
      });
    });
  },
  async load(main) {
    const grid = main.querySelector("[data-char-grid]");
    try {
      const query = this.tab === "For you" ? "" : `&tags=${encodeURIComponent(this.tab)}`;
      const chars = await api(`/api/characters?scope=community${query}`);
      if (!chars.length) {
        grid.innerHTML = `<div class="col-span-2 text-center text-muted text-sm py-10">No characters found.</div>`;
        return;
      }
      grid.innerHTML = chars.map(libraryCardHtml).join("");
      grid.querySelectorAll("[data-open-char]").forEach((btn) => {
        btn.addEventListener("click", () => navigate(`/dossier/${btn.dataset.openChar}`));
      });
    } catch (err) {
      grid.innerHTML = `<div class="col-span-2 text-center text-warn text-sm py-10">${err.message || "Failed to load characters."}</div>`;
    }
  },
};

if (typeof window !== "undefined") window.Library = Library;
```

Note: `navigate("/dossier/{id}")` requires the router to support a path segment beyond the route name — this is handled in Task 5's router change, which introduces the first parameterized route. If Task 3 is executed before Task 5, this link will 404 until Task 5 lands; that's expected within this plan's sequencing and does not block Task 3's own testable deliverable (the grid renders and fetches correctly).

- [ ] **Step 2: Wire the route**

In `new_ui/js/router.js`, change line 4 from:

```js
  library: (main) => renderPlaceholder(main, "Library"),
```

to:

```js
  library: (main) => Library.mount(main),
```

Add `<script src="js/library.js"></script>` to `new_ui/index.html` after the `avatar.js`/`markdown.js`/`chrome.js` tags added in Task 2.

- [ ] **Step 3: Manual verification**

Run `./rebuild.sh`, sign in at `http://localhost:3001/login` with `test`/`11111111` (per CLAUDE.md's user-account section — never create new accounts), confirm `/library` loads a character grid from the real backend, and switching tabs re-fetches with the `tags` filter (watch the network tab).

- [ ] **Step 4: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/library.js new_ui/js/router.js new_ui/index.html
git commit -m "feat(new_ui): build Explore/Library screen wired to GET /api/characters"
```

---

### Task 4: Chats (recents) screen

**Files:**
- Create: `new_ui/js/chats.js`
- Modify: `new_ui/js/router.js:5` — replace the `community` placeholder route key with `chats: (main) => Chats.mount(main),` (the mockup calls this tab "Chats"; the scaffold's placeholder route was named `community` for what is actually this same recents-list concept — rename the key to `chats` to match the mockup and Task 2's chrome, and remove the stale `community` key since nothing else references it).

**Interfaces:**
- Consumes: `api`, `avatarHtml`, `navigate`.
- Produces: `Chats.mount(main)`.
- Backend: `GET /api/sessions?limit=40` (`backend/routers/sessions.py:75-79`).

- [ ] **Step 1: Confirm the session list response shape before writing the renderer**

Run: `sed -n '75,80p' /var/home/staygold/ai-frontend/backend/repositories/chat_sessions.py` (or wherever `sessions.list_all`/equivalent is implemented — grep first: `grep -n "async def list_all\|async def list_sessions" backend/repositories/chat_sessions.py`) to confirm field names (expect at minimum `id`, `char_id`, `updated` or similar, and possibly a denormalized `char_name`/`last_message`). Do not guess the shape — read it.

- [ ] **Step 2: Write `chats.js`** (field names below use `session.char_id`, `session.updated`, `session.id` as the only fields guaranteed by the schema-independent read in Step 1; if Step 1 reveals additional denormalized fields like a stored preview line, use those directly instead of the two-fetch fallback shown here)

```js
"use strict";

const Chats = {
  async mount(main) {
    main.innerHTML = `
      <h1 class="font-display text-xl font-semibold text-ink mb-3">Chats</h1>
      <div data-chats-list class="flex flex-col">
        <div class="text-center text-muted text-sm py-10">Loading…</div>
      </div>
    `;
    await this.load(main);
  },
  async load(main) {
    const list = main.querySelector("[data-chats-list]");
    try {
      const sessions = await api("/api/sessions?limit=40");
      if (!sessions.length) {
        list.innerHTML = `<div class="text-center text-muted text-sm py-10">No conversations yet.</div>`;
        return;
      }
      const charIds = [...new Set(sessions.map((s) => s.char_id))];
      const chars = await Promise.all(charIds.map((id) => api(`/api/characters/${id}`).catch(() => null)));
      const charById = Object.fromEntries(charIds.map((id, i) => [id, chars[i]]));
      list.innerHTML = sessions.map((s) => this.rowHtml(s, charById[s.char_id])).join("");
      list.querySelectorAll("[data-open-session]").forEach((btn) => {
        btn.addEventListener("click", () => navigate(`/chat/${btn.dataset.openSession}`));
      });
    } catch (err) {
      list.innerHTML = `<div class="text-center text-warn text-sm py-10">${err.message || "Failed to load chats."}</div>`;
    }
  },
  rowHtml(session, char) {
    if (!char) return "";
    const mono = char.name.charAt(0).toUpperCase();
    const hue = char.is_explicit ? 340 : 220;
    return `
      <button type="button" data-open-session="${session.id}" class="w-full flex items-center gap-3 py-3 text-left">
        ${avatarHtml(mono, hue, 50, 15)}
        <div class="flex-1 min-w-0 border-b border-line pb-3.5">
          <div class="font-display font-semibold text-[15px] text-ink truncate">${char.name}</div>
        </div>
      </button>
    `;
  },
};

if (typeof window !== "undefined") window.Chats = Chats;
```

- [ ] **Step 3: Wire the route**

In `new_ui/js/router.js`, replace:

```js
  community: (main) => renderPlaceholder(main, "Community"),
```

with:

```js
  chats: (main) => Chats.mount(main),
```

Update `CHROMELESS_ROUTES` and any `data-route="community"` usages found via `grep -rn 'data-route="community"' new_ui/` — there should be none yet since chrome (Task 2) already used `"chats"` as the route key, so this is a safety check, not an expected change.

Add `<script src="js/chats.js"></script>` to `index.html`.

- [ ] **Step 4: Manual verification**

Confirm `/chats` lists real sessions for the signed-in `test` user, or shows the empty state if none exist yet.

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/chats.js new_ui/js/router.js new_ui/index.html
git commit -m "feat(new_ui): build Chats/recents screen wired to GET /api/sessions"
```

---

### Task 5: Character dossier screen + parameterized routing

**Files:**
- Create: `new_ui/js/dossier.js`
- Modify: `new_ui/js/router.js` — extend `currentRoute()`/`route()` to support a second path segment (`/dossier/{id}`), since every route so far has been a single static segment.

**Interfaces:**
- Consumes: `api`, `avatarHtml`, `mdHtml` (from Task 0), `navigate`.
- Produces: `Dossier.mount(main, charId)`.
- Backend: `GET /api/characters/{cid}` (`backend/routers/characters.py:57-75`), `POST /api/characters/{cid}/sessions` (`backend/routers/sessions.py:46-73`, body `{persona_id: null}` per `SessionIn`).

- [ ] **Step 1: Extend the router for one path parameter**

Modify `new_ui/js/router.js`. Replace `currentRoute()`:

```js
function currentRoute() {
  const segments = location.pathname.split("/").filter(Boolean);
  const seg = segments[0];
  return seg && routes[seg] ? seg : "library";
}

function routeParam() {
  return location.pathname.split("/").filter(Boolean)[1] || null;
}
```

Modify `route()` to pass the param through:

```js
function route() {
  const main = document.getElementById("main");
  const routeName = currentRoute();
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else restoreChrome(main);
  routes[routeName](main, routeParam());
  setActiveNav(routeName);
  Chrome.setActive(routeName);
}
```

Every existing route function in the `routes` map already ignores a second argument if not declared to accept one (JS silently drops extra args), so this is backward compatible with Tasks 2-4's route entries.

- [ ] **Step 2: Write `dossier.js`**

```js
"use strict";

const Dossier = {
  async mount(main, charId) {
    main.innerHTML = `<div class="text-center text-muted text-sm py-10">Loading…</div>`;
    try {
      const char = await api(`/api/characters/${charId}`);
      this.render(main, char);
    } catch (err) {
      main.innerHTML = `<div class="text-center text-warn text-sm py-10">${err.message || "Character not found."}</div>`;
    }
  },
  render(main, char) {
    const mono = char.name.charAt(0).toUpperCase();
    const hue = char.is_explicit ? 340 : 220;
    const tags = JSON.parse(char.tags || "[]");
    main.innerHTML = `
      <div class="relative h-48 -mx-4 -mt-4 overflow-hidden" style="background:linear-gradient(150deg, hsl(${hue} 46% 34%), hsl(${hue} 48% 12%))">
        <button type="button" data-back class="absolute left-4 top-4 w-9 h-9 rounded-lg border border-line bg-surface/80 grid place-items-center">←</button>
        <div class="absolute inset-0 grid place-items-center font-display text-8xl text-white/20">${mono}</div>
      </div>
      <div class="px-1 -mt-9 relative">
        <div class="flex items-end gap-3 mb-3">
          ${avatarHtml(mono, hue, 78, 17)}
          <h1 class="font-display font-semibold text-2xl text-ink pb-1">${char.name}</h1>
        </div>
        <p class="text-sm text-sec leading-relaxed mb-3">${char.description || ""}</p>
        <div class="flex flex-wrap gap-1.5 mb-4">
          ${tags.map((t) => `<span class="font-mono text-[10.5px] px-2.5 py-1 rounded-full border border-line-2 text-sec">${t}</span>`).join("")}
        </div>
        <div class="bg-surface border border-line rounded-2xl p-4 mb-5">
          <div class="font-mono text-[9.5px] tracking-widest uppercase text-muted mb-2">Opening scene</div>
          <div class="text-[13.5px] leading-relaxed">${mdHtml(char.greeting || "")}</div>
        </div>
        ${char.presentation_html ? `<div class="mb-5">${char.presentation_html}</div>` : ""}
      </div>
      <div class="sticky bottom-0 py-3 bg-gradient-to-t from-paper to-transparent">
        <button type="button" data-start-chat class="w-full py-3.5 rounded-2xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark">
          ${char.mode === "rpg" ? "Begin campaign" : "Start chat"}
        </button>
      </div>
    `;
    main.querySelector("[data-back]").addEventListener("click", () => navigate("/library"));
    main.querySelector("[data-start-chat]").addEventListener("click", () => this.startChat(char.id));
  },
  async startChat(charId) {
    try {
      const session = await api(`/api/characters/${charId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ persona_id: null }),
      });
      navigate(`/chat/${session.id}`);
    } catch (err) {
      alert(err.message || "Could not start chat.");
    }
  },
};

if (typeof window !== "undefined") window.Dossier = Dossier;
```

`presentation_html` is inserted via `innerHTML` deliberately here (it's admin/owner-authored character presentation markup already trusted and rendered server-side elsewhere in this app per CLAUDE.md's character-theming description — not user chat input); do not reuse this pattern for any untrusted string in later tasks (chat message content in Task 6 must go through `mdHtml`'s escaping, never raw `innerHTML`).

- [ ] **Step 3: Wire the route**

Add to the `routes` map in `router.js`:

```js
  dossier: (main, id) => Dossier.mount(main, id),
```

Add `<script src="js/dossier.js"></script>` to `index.html`.

- [ ] **Step 4: Manual verification**

From `/library`, tap a character card, confirm `/dossier/{id}` loads real character data, tapping "Start chat" creates a real session (`POST /api/characters/{cid}/sessions`) and navigates to `/chat/{sid}` (which 404s until Task 6 lands — expected at this point in sequencing).

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/dossier.js new_ui/js/router.js new_ui/index.html
git commit -m "feat(new_ui): build character dossier screen, add parameterized routing"
```

---

### Task 6: Chat thread screen with real SSE streaming

**Files:**
- Create: `new_ui/js/chat-thread.js`

**Interfaces:**
- Consumes: `api`, `avatarHtml`, `mdHtml`, `navigate`.
- Produces: `ChatThread` class — `new ChatThread(main, sessionId)`, `.mount()`, `.send(text)`, `.destroy()`. This is a real stateful class per the Global Constraints: it owns a live turn array and an in-flight `fetch`/stream reader that must be torn down on navigation away, which is exactly the "live SSE connection" case CLAUDE.md calls out as legitimate class state (same shape as the LoRA training `TrainingJobWatcher` precedent cited in the Module responsibilities table).
- Backend: `GET /api/sessions/{sid}` for initial state (`backend/routers/sessions.py:81-86`), `POST /api/sessions/{sid}/chat` SSE stream (`backend/routers/chat.py:51-57`, body `{content, think}` per `ChatIn`). SSE event types per CLAUDE.md: `meta`, `status`, `thinking`, `delta`, `error`, `done`.

- [ ] **Step 1: Confirm the session detail response shape (turn history field name) before writing the renderer**

Run: `grep -n "async def get\b" backend/repositories/chat_sessions.py` and read the surrounding function to confirm what field holds the message list (likely `messages`) and each message's shape (`role`, `content`, `id`). Do not guess — read it, then use the confirmed field names below in place of any placeholder.

- [ ] **Step 2: Write `chat-thread.js`**

```js
"use strict";

class ChatThread {
  constructor(main, sessionId) {
    this.main = main;
    this.sessionId = sessionId;
    this.turns = [];
    this.thinking = false;
    this.reader = null;
  }

  async mount() {
    this.main.innerHTML = `<div class="text-center text-muted text-sm py-10">Loading…</div>`;
    try {
      const session = await api(`/api/sessions/${this.sessionId}`);
      this.char = await api(`/api/characters/${session.char_id}`);
      this.turns = session.messages.map((m) => ({ role: m.role, text: m.content }));
      this.render();
    } catch (err) {
      this.main.innerHTML = `<div class="text-center text-warn text-sm py-10">${err.message || "Could not load chat."}</div>`;
    }
  }

  render() {
    const mono = this.char.name.charAt(0).toUpperCase();
    const hue = this.char.is_explicit ? 340 : 220;
    this.main.innerHTML = `
      <div class="flex flex-col h-full -m-4">
        <div class="flex-none flex items-center gap-3 px-3.5 py-2.5 border-b border-line bg-surface-2">
          <button type="button" data-back class="w-9 h-9 rounded-lg grid place-items-center text-sec">←</button>
          ${avatarHtml(mono, hue, 38, 11)}
          <div class="flex-1 min-w-0 font-display font-semibold text-[15.5px] text-ink truncate">${this.char.name}</div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-4 py-5" data-thread></div>
        <form data-composer class="flex-none flex items-end gap-2 px-3.5 py-2.5 border-t border-line bg-surface-2">
          <textarea data-composer-input rows="1" placeholder="Write your reply…" class="flex-1 resize-none rounded-xl border border-line-2 bg-surface text-ink px-3.5 py-2.5 text-[14.5px] outline-none"></textarea>
          <button type="submit" class="w-10 h-10 flex-none rounded-xl bg-gradient-to-br from-primary to-primary-dark text-paper grid place-items-center">→</button>
        </form>
      </div>
    `;
    this.renderTurns();
    this.main.querySelector("[data-back]").addEventListener("click", () => {
      this.destroy();
      navigate("/chats");
    });
    this.main.querySelector("[data-composer]").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = this.main.querySelector("[data-composer-input]");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      this.send(text);
    });
  }

  renderTurns() {
    const thread = this.main.querySelector("[data-thread]");
    if (!thread) return;
    thread.innerHTML = this.turns.map((t) => this.turnHtml(t)).join("") +
      (this.thinking ? `<div class="text-[10.5px] font-mono uppercase text-muted">${this.char.name} is writing…</div>` : "");
    thread.scrollTop = thread.scrollHeight;
  }

  turnHtml(turn) {
    const you = turn.role === "user";
    const bubbleClass = you
      ? "ml-auto bg-gradient-to-br from-primary to-primary-dark text-paper rounded-[16px_16px_4px_16px]"
      : "bg-surface border border-line text-ink rounded-[16px_16px_16px_4px]";
    return `
      <div class="max-w-[82%] mb-4 px-3.5 py-2.5 text-[14px] leading-relaxed ${bubbleClass}" style="width:fit-content">
        ${you ? turn.text : mdHtml(turn.text)}
      </div>
    `;
  }

  async send(text) {
    this.turns.push({ role: "user", text });
    this.thinking = true;
    this.renderTurns();
    let replyText = "";
    try {
      const response = await fetch(`/api/sessions/${this.sessionId}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!response.ok || !response.body) throw new Error("Chat request failed.");
      this.reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const raw of events) {
          const parsed = this.parseSseEvent(raw);
          if (!parsed) continue;
          if (parsed.event === "delta") replyText = parsed.data.text || parsed.data.content || "";
          if (parsed.event === "error") throw new Error(parsed.data.message || "Generation error.");
        }
      }
      this.thinking = false;
      this.turns.push({ role: "assistant", text: replyText });
      this.renderTurns();
    } catch (err) {
      this.thinking = false;
      this.turns.push({ role: "assistant", text: `*Error: ${err.message || "generation failed"}*` });
      this.renderTurns();
    }
  }

  parseSseEvent(raw) {
    const lines = raw.split("\n").filter(Boolean);
    if (!lines.length) return null;
    let event = "message";
    let dataLine = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
    }
    if (!dataLine) return null;
    try {
      return { event, data: JSON.parse(dataLine) };
    } catch {
      return { event, data: {} };
    }
  }

  destroy() {
    if (this.reader) this.reader.cancel().catch(() => {});
  }
}

const ChatThreadRoute = {
  current: null,
  mount(main, sessionId) {
    if (this.current) this.current.destroy();
    this.current = new ChatThread(main, sessionId);
    this.current.mount();
  },
};

if (typeof window !== "undefined") window.ChatThreadRoute = ChatThreadRoute;
```

The SSE parsing above assumes the standard `event: <type>\ndata: <json>\n\n` wire format for `text/event-stream` — confirm this against `backend/chat_service.py`'s `_run` function before Step 4's verification (`grep -n "event:" backend/chat_service.py` or wherever the SSE frames are actually formatted) since CLAUDE.md documents the event *names* (`meta`/`status`/`thinking`/`delta`/`error`/`done`) but this task needs the exact byte format to parse correctly — adjust `parseSseEvent` if the real format differs (e.g. if `data:` carries a bare string instead of JSON for some event types).

- [ ] **Step 3: Wire the route**

Add to `router.js`'s `routes` map:

```js
  chat: (main, id) => ChatThreadRoute.mount(main, id),
```

Add this route to `CHROMELESS_ROUTES` (the mockup's chat screen has no bottom tab bar/sidebar visible, matching `sc-if value="{{ showTabs }}"` excluding `chat` from its `top` array in the mockup's `renderVals()`):

```js
const CHROMELESS_ROUTES = new Set(["login", "wait", "chat"]);
```

Add `<script src="js/chat-thread.js"></script>` to `index.html`.

- [ ] **Step 4: Manual verification**

Confirm sending a message in `/chat/{sid}` streams a real reply from the backend (watch network tab for the `text/event-stream` response), the thread auto-scrolls, and navigating back via the `←` button cancels the in-flight reader if generation is still running (trigger by sending a message and immediately tapping back).

- [ ] **Step 5: Commit**

```bash
cd /var/home/staygold/ai-frontend
git add new_ui/js/chat-thread.js new_ui/js/router.js new_ui/index.html
git commit -m "feat(new_ui): build chat thread screen with real SSE streaming"
```

---

## Self-Review

**Spec coverage:** Every Phase-1-scoped screen from the roadmap (chrome, Library, Chats, Dossier, Chat thread) has a task. Phases 2-5 are explicitly out of scope for this document and named as follow-up plans, not silently dropped. The three confirmed backend gaps (inpaint/video generation, mature-content settings keys, TOTP-enroll-as-registration-step) are resolved as "does not apply to Phase 1" with the reasoning shown, not left as unexamined TODOs.

**Placeholder scan:** No "TBD"/"handle appropriately"/unshown code. The two places that read as soft ("confirm the shape before writing") are Task 4 Step 1 and Task 6 Step 1 — these are legitimate "read the file first" steps, not placeholders, because guessing a DB-backed field name here would produce code that fails at runtime against the real schema; the step names the exact grep/read command to run and what to do with the result.

**Type/name consistency:** `avatarHtml(mono, hue, size, radius)` (Task 1) is called identically in Tasks 3/4/5/6. `mdHtml(text)` (Task 0) is called identically in Tasks 5/6. `api(path, opts)` and `navigate(path)` are reused, never redefined. `ChatThread`/`ChatThreadRoute` names are consistent between definition and router wiring in Task 6.

Plan complete and saved to `docs/superpowers/plans/2026-07-15-mobile-redesign-phase1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
