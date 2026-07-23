# Bottom Nav Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `new_ui`'s bottom nav (Library/Community/Personas/Creations/Forum) with Explore/Chats/[seal]/Studio/Account, add the four new/renamed routes as placeholders, and give the Account tab a theme-and-profile-aware avatar ring instead of an icon.

**Architecture:** Pure frontend change in `new_ui/` — no backend work (the profile fields the avatar ring needs, `accent_color`/`banner_color`/`avatar`, already come back from `GET /api/auth/me` via `backend/db.py`'s `_user_row`). Three files change: `new_ui/index.html` (markup), `new_ui/js/router.js` (routes, active-tab/ribbon logic, avatar ring), `new_ui/js/app-session.js` (the ring-painting function, since it's a small stateless helper next to `ME`/`api()`). One new Playwright test file verifies routing, ribbon geometry, and the ring's fallback behavior.

**Tech Stack:** Vanilla JS (no framework, no build step beyond Tailwind), Tailwind CSS v4 utility classes plus a handful of inline styles for gradients/clip-paths (matching the existing `auth-scene.js`/ribbon pattern), Playwright (Python sync API) for verification, following `tests/new_ui/test_auth_flow.py`'s self-contained static-server pattern.

## Global Constraints

- Mobile/phone-viewport only — no tablet/desktop responsive work (established project-wide rule, carried forward from every prior `new_ui` plan).
- Never hardcode a literal color — every new color must be a CSS custom property (`var(--color-...)`) so it reacts to theme switching. This includes the avatar ring's fallback gradient and the seal button's gradient.
- No backend changes in this plan — `GET /api/auth/me` already returns `avatar`/`accent_color`/`banner_color`.
- Zero comments in code, ever (project-wide rule).
- Test against the real running `:3001` dev server for manual/visual verification (never spin up a second parallel dev server instance) — the automated Playwright test, however, uses its own throwaway static file server on a random free port, exactly like `tests/new_ui/test_auth_flow.py` already does, which is not "a second dev server" in the sense the rule prohibits (it serves static files only, no API proxying, and is torn down at the end of the test module).
- `NAV_ROUTES` drives the ribbon indicator and must exactly match the four flat tabs — `create` (the seal's target) is deliberately excluded since it is not part of the tab-highlight set.

---

### Task 1: Router — routes, ribbon geometry, avatar-ring wiring

**Files:**
- Modify: `new_ui/js/router.js` (full file is 89 lines; every function in it is touched or replaced)
- Modify: `new_ui/js/app-session.js` (add `applyAvatarRing()`)
- Test: `tests/new_ui/test_bottom_nav.py` (new)

**Interfaces:**
- Consumes: global `ME` (set by `new_ui/js/app-session.js`'s existing `api()` calls in `boot.js`/`login.js`), the DOM elements `#bottomNav`, `#navRibbon`, and `[data-route]` anchors that Task 2 will add to `new_ui/index.html`. This task's tests use hand-built DOM fixtures (see below) so it does not need to wait on Task 2's markup to be testable in isolation — but the two tasks together are what makes the real page work, so run both before final verification.
- Produces: `NAV_ROUTES` (array of the 4 tab route names), `setActiveNav(routeName)` (now also positions the ribbon by measured geometry and toggles the avatar ring's active state), `applyAvatarRing()` (exported as `window.applyAvatarRing`, reads `ME.accent_color`/`ME.banner_color` and paints `--nav-avatar-ring` on `[data-route="account"] [data-avatar-ring]`).

Current `new_ui/js/router.js` in full, for reference (this task rewrites most of it):

```js
"use strict";

const routes = {
  library: (main) => renderPlaceholder(main, "Library"),
  community: (main) => renderPlaceholder(main, "Community"),
  personas: (main) => renderPlaceholder(main, "Personas"),
  images: (main) => renderPlaceholder(main, "Creations"),
  forum: (main) => renderPlaceholder(main, "Forum"),
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const UNAUTHENTICATED_ROUTE_NAMES = ["login", "register", "onboard", "wait"];
const CHROMELESS_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const PUBLIC_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const NAV_ROUTES = ["library", "community", "personas", "images", "forum"];

function renderPlaceholder(main, label) {
  main.innerHTML = `
    <div class="rounded-lg border border-line bg-surface p-6">
      <h1 class="font-display text-xl font-semibold text-ink">${label}</h1>
      <p class="mt-2 text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
  `;
}

function currentRoute() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return seg && routes[seg] ? seg : "library";
}

function setActiveNav(routeName) {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === routeName);
    el.classList.toggle("text-sec", el.dataset.route !== routeName);
  });
  const ribbon = document.getElementById("navRibbon");
  if (!ribbon) return;
  const idx = NAV_ROUTES.indexOf(routeName);
  ribbon.classList.toggle("hidden", idx === -1);
  if (idx !== -1) ribbon.style.transform = `translateX(${idx * 100}%)`;
}

function route() {
  const main = document.getElementById("main");
  const routeName = currentRoute();
  if (!ME && !PUBLIC_ROUTES.has(routeName)) {
    history.replaceState(null, "", "/login");
    return route();
  }
  if (ME && routeName === "login") {
    history.replaceState(null, "", "/");
    return route();
  }
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else restoreChrome(main);
  routes[routeName](main);
  setActiveNav(routeName);
}

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-route]");
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", route);
```

(`hideChrome`/`restoreChrome` are unchanged by this task — they are defined above `route()` in the same file and are not shown again here since this task does not touch them.)

- [ ] **Step 1: Write the failing tests for routing + ribbon geometry**

Create `tests/new_ui/test_bottom_nav.py`:

```python
import http.server
import socket
import threading
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

NEW_UI_DIR = Path(__file__).resolve().parents[2] / "new_ui"


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def static_server():
    port = _free_port()
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(NEW_UI_DIR), **kwargs)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    thread.join()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _new_page(browser):
    return browser.new_page(viewport={"width": 392, "height": 848})


def _mock_authenticated(page, accent_color="", banner_color="", avatar=""):
    page.route("**/api/auth/me", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=(
            '{"id":"u1","username":"test","status":"active",'
            f'"accent_color":"{accent_color}","banner_color":"{banner_color}",'
            f'"avatar":"{avatar}"}}'
        )))


def test_explore_is_default_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    assert page.evaluate("currentRoute()") == "explore"
    page.close()


def test_all_four_tab_routes_render_their_placeholder(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    for route_name, label in [
        ("explore", "Explore"), ("chats", "Chats"),
        ("studio", "Studio"), ("account", "Account"),
    ]:
        page.evaluate(f"navigate('/{route_name}')")
        page.wait_for_timeout(200)
        assert page.locator("#main h1").inner_text() == label
    page.close()


def test_create_route_renders_placeholder_and_is_not_in_nav_routes(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/create')")
    page.wait_for_timeout(200)
    assert page.locator("#main h1").inner_text() == "New Character"
    assert page.evaluate("NAV_ROUTES.includes('create')") is False
    page.close()


def test_ribbon_hidden_on_create_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    page.evaluate("navigate('/create')")
    page.wait_for_timeout(200)
    ribbon_hidden = page.evaluate("document.getElementById('navRibbon').classList.contains('hidden')")
    assert ribbon_hidden is True
    page.close()


def test_ribbon_geometry_matches_active_tab_for_every_nav_route(static_server, browser):
    page = _new_page(browser)
    _mock_authenticated(page)
    page.goto(static_server + "/")
    page.wait_for_timeout(400)
    for route_name in ["explore", "chats", "studio", "account"]:
        page.evaluate(f"navigate('/{route_name}')")
        page.wait_for_timeout(200)
        geo = page.evaluate(f"""() => {{
            const nav = document.getElementById('bottomNav');
            const ribbon = document.getElementById('navRibbon');
            const target = nav.querySelector('[data-route="{route_name}"]');
            const navRect = nav.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const ribbonRect = ribbon.getBoundingClientRect();
            return {{
                expectedLeft: targetRect.left - navRect.left,
                actualLeft: ribbonRect.left - navRect.left,
                expectedWidth: targetRect.width,
                actualWidth: ribbonRect.width,
            }};
        }}""")
        assert abs(geo["expectedLeft"] - geo["actualLeft"]) < 1
        assert abs(geo["expectedWidth"] - geo["actualWidth"]) < 1
    page.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest tests/new_ui/test_bottom_nav.py -v`
Expected: FAIL — `currentRoute()` still returns `"library"`, no `explore`/`chats`/`studio`/`account`/`create` routes exist yet, `#main h1` text won't match, `NAV_ROUTES` still has 5 old entries.

- [ ] **Step 3: Rewrite `new_ui/js/router.js`**

Replace the entire file:

```js
"use strict";

const routes = {
  explore: (main) => renderPlaceholder(main, "Explore"),
  chats: (main) => renderPlaceholder(main, "Chats"),
  studio: (main) => renderPlaceholder(main, "Studio"),
  account: (main) => renderPlaceholder(main, "Account"),
  create: (main) => renderPlaceholder(main, "New Character"),
  community: (main) => renderPlaceholder(main, "Community"),
  personas: (main) => renderPlaceholder(main, "Personas"),
  forum: (main) => renderPlaceholder(main, "Forum"),
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const UNAUTHENTICATED_ROUTE_NAMES = ["login", "register", "onboard", "wait"];
const CHROMELESS_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const PUBLIC_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const NAV_ROUTES = ["explore", "chats", "studio", "account"];

function renderPlaceholder(main, label) {
  main.innerHTML = `
    <div class="rounded-lg border border-line bg-surface p-6">
      <h1 class="font-display text-xl font-semibold text-ink">${label}</h1>
      <p class="mt-2 text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
  `;
}

function currentRoute() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return seg && routes[seg] ? seg : "explore";
}

function setActiveNav(routeName) {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === routeName);
    el.classList.toggle("text-sec", el.dataset.route !== routeName);
  });
  document.querySelector('[data-route="account"] [data-avatar-ring]')
    ?.classList.toggle("opacity-100", routeName === "account");
  const ribbon = document.getElementById("navRibbon");
  const nav = document.getElementById("bottomNav");
  if (!ribbon || !nav) return;
  const idx = NAV_ROUTES.indexOf(routeName);
  ribbon.classList.toggle("hidden", idx === -1);
  if (idx === -1) return;
  const target = nav.querySelector(`[data-route="${routeName}"]`);
  if (!target) return;
  const navRect = nav.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  ribbon.style.left = `${targetRect.left - navRect.left}px`;
  ribbon.style.width = `${targetRect.width}px`;
}

function route() {
  const main = document.getElementById("main");
  const routeName = currentRoute();
  if (!ME && !PUBLIC_ROUTES.has(routeName)) {
    history.replaceState(null, "", "/login");
    return route();
  }
  if (ME && routeName === "login") {
    history.replaceState(null, "", "/");
    return route();
  }
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else restoreChrome(main);
  routes[routeName](main);
  setActiveNav(routeName);
  applyAvatarRing();
}

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-route]");
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", route);
```

Do not touch `hideChrome`/`restoreChrome` — copy them unchanged from the current file into the same position in the new file (between `currentRoute()` — no, between `renderPlaceholder` and `route()` originally; preserve their exact current position and contents from the file shown in the "Interfaces" section above).

- [ ] **Step 4: Add `applyAvatarRing()` to `new_ui/js/app-session.js`**

Read the current file first — it is:

```js
"use strict";

const API = store.get("apiBase", "");
let ME = null;

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let message = res.statusText;
    let detail = null;
    try {
      const body = await res.json();
      detail = body.detail ?? null;
      message = typeof detail === "string" ? detail : message;
    } catch {}
    const err = new Error(message);
    err.detail = detail;
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
```

Append this function at the end of the file:

```js
function applyAvatarRing() {
  const ring = document.querySelector('[data-route="account"] [data-avatar-ring]');
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
    fallback?.classList.add("hidden");
  } else {
    fallback && (fallback.textContent = (ME?.username || "?")[0].toUpperCase());
    fallback?.classList.remove("hidden");
    img?.classList.add("hidden");
  }
}
```

`applyAvatarRing()` is called from `route()` (Step 3 above) on every navigation, which covers first load (`boot.js` calls `route()` after resolving `ME`), login (`login.js`'s `submitSignin()` calls `navigate("/")` after setting `ME`), and logout (`index.html`'s temp logout button sets `ME = null` then calls `navigate('/login')`) — no separate wiring needed in those three files. When `ME` is `null` (logged out) the function safely no-ops on the ring's gradient (the CSS fallback below in Task 2 keeps showing the theme accent) and sets the fallback letter to `"?"`.

- [ ] **Step 5: Run the tests to verify Step 1's tests now pass**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest tests/new_ui/test_bottom_nav.py -v`
Expected: 5 passed (the tests written in Step 1 only depend on `router.js`/`app-session.js` plus `new_ui/index.html`'s existing `#main`/`#bottomNav` elements — Task 2 has not run yet, so `[data-route="account"]` and `#navRibbon`'s new positioning classes don't exist in the markup yet for a *real* page load, but these particular tests only assert on `currentRoute()`, `NAV_ROUTES`, `#main h1` text, and `#navRibbon`'s hidden/geometry state against whatever `[data-route]` elements the *current* `index.html` already has — since Task 2 hasn't run, `index.html` still has the *old* 5-tab markup with `data-route="library"` etc., not `data-route="explore"` etc. This means `test_ribbon_geometry_matches_active_tab_for_every_nav_route` will fail at this point because `nav.querySelector('[data-route="explore"]')` returns `null` in the old markup.

This is expected and correct: Task 1 and Task 2 are interdependent for full page rendering (the router needs the markup's `data-route` attributes, the markup needs the router's `NAV_ROUTES`/icons). Run only the tests that do not require Task 2's markup at this checkpoint:

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest tests/new_ui/test_bottom_nav.py::test_explore_is_default_route tests/new_ui/test_bottom_nav.py::test_all_four_tab_routes_render_their_placeholder tests/new_ui/test_bottom_nav.py::test_create_route_renders_placeholder_and_is_not_in_nav_routes -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/router.js new_ui/js/app-session.js tests/new_ui/test_bottom_nav.py
git commit -m "Rework new_ui router for Explore/Chats/Studio/Account nav"
```

---

### Task 2: Bottom nav markup — tabs, seal, avatar ring

**Files:**
- Modify: `new_ui/index.html` (lines 100-124, the `<nav id="bottomNav">` block)

**Interfaces:**
- Consumes: `NAV_ROUTES`, `setActiveNav()`, `applyAvatarRing()`, `navigate()` from Task 1's `router.js`. Uses the exact `data-route` values Task 1's `routes` map defines: `explore`, `chats`, `studio`, `account`, plus the seal's `onclick="navigate('/create')"`.
- Produces: the `#navRibbon` element (already exists, but its Tailwind classes change — `w-1/5`/`left-0`/`transition-transform` are replaced since Task 1's `setActiveNav` now sets `style.left`/`style.width` directly instead of a `transform`), and `[data-avatar-ring]` inside the Account tab, which Task 1's `applyAvatarRing()` targets via `document.querySelector('[data-route="account"] [data-avatar-ring]')`.

Current markup at `new_ui/index.html:100-124` (this task replaces this entire block):

```html
    <nav id="bottomNav" class="fixed inset-x-0 bottom-0 z-10 border-t-2 border-dashed border-line-2 bg-paper" style="display:none">
      <div id="navRibbon" class="absolute left-0 -top-2.5 h-[18px] w-1/5 transition-transform duration-300 ease-out motion-reduce:transition-none" style="clip-path:polygon(22% 0%,78% 0%,78% 74%,50% 100%,22% 74%);background:linear-gradient(180deg, var(--color-primary-light), var(--color-primary-dark));filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"></div>
      <div class="relative flex">
        <a href="/" data-route="library" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5c-1.8-1.3-4-1.8-6-1.5v12c2-.3 4.2.2 6 1.5"/><path d="M12 6.5c1.8-1.3 4-1.8 6-1.5v12c-2-.3-4.2.2-6 1.5"/><path d="M12 6.5v12"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Library</span>
        </a>
        <a href="/community" data-route="community" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c1 2.5-1.5 3-1.5 5a1.5 1.5 0 0 0 3 0c0-.8-.5-1.2-.5-1.2"/><path d="M12 5.5c2 2 3.5 4.3 3.5 6.8a3.5 3.5 0 1 1-7 0c0-1 .3-1.8.8-2.6"/><path d="M5 20c2-1 3-1 4 0M15 20c1-1 2-1 4 0"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Community</span>
        </a>
        <a href="/personas" data-route="personas" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="5.5"/><path d="M14.5 14.5l1.8 1.8"/><path d="M10.5 16v3.5c0 1 .8 1.5 1.8 1.2"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Personas</span>
        </a>
        <a href="/images" data-route="images" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="12" height="12" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.3"/><path d="M4 14l3.5-3.5c.6-.6 1.4-.6 2 0L14 15"/><path d="M18.5 5v3.5M17 6.75h3M20 12v2.5M18.75 13.25h2.5"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Creations</span>
        </a>
        <a href="/forum" data-route="forum" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-6 0-11 4-13 11 2-1 4-1.5 5.5-3"/><path d="M19 5c0 6-4 11-11 13"/><path d="M9 15l4-4"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Forum</span>
        </a>
      </div>
    </nav>
```

- [ ] **Step 1: Replace the `<nav id="bottomNav">` block**

Replace lines 100-124 of `new_ui/index.html` with:

```html
    <nav id="bottomNav" class="fixed inset-x-0 bottom-0 z-10 border-t-2 border-dashed border-line-2 bg-paper" style="display:none">
      <div id="navRibbon" class="absolute -top-2.5 h-[18px] transition-[left,width] duration-300 ease-out motion-reduce:transition-none" style="clip-path:polygon(22% 0%,78% 0%,78% 74%,50% 100%,22% 74%);background:linear-gradient(180deg, var(--color-primary-light), var(--color-primary-dark));filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"></div>
      <div class="relative flex items-center">
        <a href="/explore" data-route="explore" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5c-1.8-1.3-4-1.8-6-1.5v12c2-.3 4.2.2 6 1.5"/><path d="M12 6.5c1.8-1.3 4-1.8 6-1.5v12c-2-.3-4.2.2-6 1.5"/><path d="M12 6.5v12"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Explore</span>
        </a>
        <a href="/chats" data-route="chats" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c.9 1.1.9 2-.1 3.1-.7.8-.7 1.5 0 2.2"/><rect x="10" y="9.3" width="4" height="9.2" rx="0.6"/><path d="M7 18.5h10"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Chats</span>
        </a>
        <button type="button" onclick="navigate('/create')" title="New character"
          class="flex-none -mt-[22px] w-[54px] h-[54px] rounded-2xl grid place-items-center text-paper"
          style="background:linear-gradient(150deg, var(--color-secondary-light), var(--color-secondary-dark));box-shadow:0 8px 18px -6px color-mix(in srgb, var(--color-secondary) 55%, transparent)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <a href="/studio" data-route="studio" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="12" height="12" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.3"/><path d="M4 14l3.5-3.5c.6-.6 1.4-.6 2 0L14 15"/><path d="M18.5 5v3.5M17 6.75h3M20 12v2.5M18.75 13.25h2.5"/></svg>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Studio</span>
        </a>
        <a href="/account" data-route="account" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
          <span data-avatar-ring class="relative block w-[22px] h-[22px] rounded-full p-[2px] opacity-70" style="background:var(--nav-avatar-ring, linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark)))">
            <span class="block w-full h-full rounded-full overflow-hidden bg-surface-2 grid place-items-center">
              <img class="hidden w-full h-full object-cover" alt="">
              <span data-avatar-fallback class="font-mono text-[10px] text-ink">?</span>
            </span>
          </span>
          <span class="font-mono text-[9px] tracking-[.12em] uppercase">Account</span>
        </a>
      </div>
    </nav>
```

- [ ] **Step 2: Run the full test suite to verify all Task 1 tests now pass against the updated markup**

Run: `cd /var/home/staygold/ai-frontend && python3 -m pytest tests/new_ui/test_bottom_nav.py -v`
Expected: 5 passed

- [ ] **Step 3: Manually verify against the running `:3001` dev server**

Do not start a second dev server. Confirm `rebuild.sh --watch` is running and has picked up the `index.html` change (no Tailwind rebuild needed here since no new utility class was introduced beyond ones already compiled in the current bottom-nav work — `transition-[left,width]` is a new arbitrary-value utility and does need a rebuild; if `bin/tailwindcss --watch` has died again per the earlier session note, run `./bin/tailwindcss -i new_ui/css/input.css -o new_ui/css/app.css` once by hand). Then, with Playwright against `http://localhost:3001` (log in as `test`/`11111111` per this repo's fixed test account — do not create a new account), verify:
- The 5-slot layout renders: Explore, Chats, the raised seal, Studio, Account, in that order.
- Tapping through Explore/Chats/Studio/Account moves the ribbon to the correct tab and shows the right placeholder heading.
- Tapping the seal navigates to `/create` and shows "New Character"; the ribbon disappears (since `create` is not in `NAV_ROUTES`).
- The Account tab's ring shows the default theme-accent gradient (test user `test` has no `accent_color` set) and switching the theme via the existing top-right theme-cycle button changes the ring's colors too (proves it reads the live `--color-primary-light`/`-dark` vars, not a frozen snapshot).
- Take a screenshot in both dark and light mode and visually confirm no hardcoded/mismatched colors.

- [ ] **Step 4: Commit**

```bash
git add new_ui/index.html
git commit -m "Rebuild bottom nav markup: Explore/Chats/seal/Studio/Account"
```

---

## Self-Review Notes (for the plan author, already applied above)

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-15-bottom-nav-rework-design.md` maps to a step above — routes table → Task 1 Step 3; ribbon geometry fix → Task 1 Step 3 + Task 2 Step 1; Chats candle icon → Task 2 Step 1; Studio/Explore icon reuse → Task 2 Step 1; Account avatar ring + theme/profile fallback → Task 1 Step 4 + Task 2 Step 1; seal button/color/`/create` target → Task 2 Step 1; testing section → Task 1 Steps 1-2 and Task 2 Step 2-3.
- **Placeholder scan:** no TBD/TODO; every step has literal code, not a description.
- **Type consistency:** `NAV_ROUTES`, `setActiveNav`, `applyAvatarRing`, `routes`, `renderPlaceholder`, `currentRoute` are used with identical names/signatures across both tasks and the test file.
