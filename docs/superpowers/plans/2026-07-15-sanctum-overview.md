# Sanctum Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Sanctum overview screen (`/sanctum`) in `new_ui/` — a personal workshop dashboard with quick-create actions and a merged recent-items feed across characters/personas/lore/generated images — and move all Sanctum-owned routes under a nested `/sanctum/...` URL scheme.

**Architecture:** One new backend read endpoint (`GET /api/lore/mine`) fills a gap (lore has no cross-character "mine" listing today). One new frontend view class (`SanctumView`, `new_ui/js/sanctum.js`) follows the existing `ArtisansView`/`ParlanceView` mount/render pattern. `new_ui/js/router.js`'s `currentRoute()` gains a second multi-segment case (alongside its existing `/u/{username}` and `/symposium/{tid}` handling) to parse `/sanctum/{sub}/...` into a `sanctum-{sub}` route key. Every other file that links to the old flat `/forge`, `/grimoire`, `/masks`, `/casts`, `/create` routes is updated to the new nested paths in the same task as the router change, so the app is never left with dead links mid-plan.

**Tech Stack:** FastAPI + SQLAlchemy Core (backend), vanilla JS classes + Tailwind utility classes + hand-written CSS in `cards.css` (frontend, no build step, no framework).

## Global Constraints

- Zero comments in any file, ever — no exceptions (per `CLAUDE.md` coding style).
- No hardcoded hex colors outside `themes.css` — every color in new markup/CSS must reference a `var(--color-*)` custom property.
- Every mutating backend endpoint gets a `log.info` on success; this plan's new endpoint is read-only, so no logging call is required for it (matches the existing unlogged `GET /characters/{cid}/lore` pattern).
- Backend tests are repository-level pytest using the `db_conn` fixture (`backend/tests/conftest.py`) — there is no router/TestClient test pattern anywhere in this codebase; don't introduce one.
- `new_ui/` has no JS test runner or test files anywhere — frontend verification in this plan is manual, against the human's already-running `./rebuild.sh --watch` dev server on `:3001`, per `CLAUDE.md`. Never spin up a second dev server instance for this.
- Never use `EnterWorktree`/`git worktree` for this repo — edit `/var/home/staygold/ai-frontend` directly (bind-mounted into the live container).
- Absolute imports only inside `backend/` (`from backend.x import y`), never bare `import x`.

---

### Task 1: `lore.list_mine` repository function

**Files:**
- Modify: `backend/repositories/lore.py`
- Test: `backend/tests/test_lore_repo.py`

**Interfaces:**
- Consumes: `backend.db.lore`, `backend.db.characters` tables (already defined); `backend.repositories.characters.create` (test-only, to build an owned character to attach lore to).
- Produces: `async def list_mine(user_id: str) -> list[dict]` — same row shape as `list_for_character`/`get` (decrypted `content`/`name`/`appearance_tags`, `keys` as list, `always`/`hidden`/`is_explicit`/`global` as bool), ordered by `created` descending, scoped to lore whose owning character's `owner_id == user_id`. Later tasks (Task 3's `GET /api/lore/mine`) call this by name.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_lore_repo.py`:

```python
async def test_list_mine_scoped_to_owner(db_conn):
    from backend.repositories import characters as characters_repo

    char_a = await characters_repo.create({"owner_id": "user-a", "name": "Char A"})
    char_b = await characters_repo.create({"owner_id": "user-b", "name": "Char B"})
    lid_a1 = await lore.create(char_a["id"], ["k1"], "content a1", always=False, name="a1")
    lid_a2 = await lore.create(char_a["id"], ["k2"], "content a2", always=False, name="a2")
    await lore.create(char_b["id"], ["k3"], "content b1", always=False, name="b1")

    entries = await lore.list_mine("user-a")

    ids = [e["id"] for e in entries]
    assert ids == [lid_a2, lid_a1]
    assert all(e["name"] in ("a1", "a2") for e in entries)


async def test_list_mine_no_characters_returns_empty(db_conn):
    assert await lore.list_mine("nobody") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_lore_repo.py -k list_mine -v`
Expected: FAIL with `AttributeError: module 'backend.repositories.lore' has no attribute 'list_mine'`

- [ ] **Step 3: Write minimal implementation**

In `backend/repositories/lore.py`, change the import line to also pull in `characters`:

```python
from backend.db import lore, characters, nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret
```

Add the new function after `list_for_character`:

```python
async def list_mine(user_id: str) -> list[dict]:
    stmt = (select(lore)
            .join(characters, characters.c.id == lore.c.char_id)
            .where(characters.c.owner_id == user_id)
            .order_by(lore.c.created.desc()))
    return [_row(r) for r in await _q(stmt)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /var/home/staygold/ai-frontend && venv/bin/python3 -m pytest backend/tests/test_lore_repo.py -v`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 5: Commit**

```bash
git add backend/repositories/lore.py backend/tests/test_lore_repo.py
git commit -m "Add lore.list_mine repository function for cross-character lore listing"
```

---

### Task 2: `GET /api/lore/mine` route

**Files:**
- Modify: `backend/routers/lore.py`
- Test: (covered by Task 1's repository test — this route is a thin pass-through with no branching logic of its own, consistent with `list_lore`'s existing unlogged-GET pattern; no separate router test file exists anywhere in this codebase to add one to)

**Interfaces:**
- Consumes: `lore.list_mine(user_id: str)` from Task 1.
- Produces: `GET /api/lore/mine` (auth required via `get_current_user`) returning the same list shape as Task 1. Consumed by Task 4's `SanctumView`.

- [ ] **Step 1: Add the route**

In `backend/routers/lore.py`, add above `@api.post("/characters/{cid}/lore")`:

```python
@api.get("/lore/mine")
async def list_my_lore(current_user: dict = Depends(get_current_user)):
    return await lore.list_mine(current_user["id"])
```

- [ ] **Step 2: Verify it doesn't collide with `PUT/DELETE /lore/{lid}`**

Read: `backend/routers/lore.py` in full and confirm the only other `/lore/{lid}`-shaped routes are `PUT` and `DELETE` (different HTTP methods, so no path-matching conflict with `GET /lore/mine`). No route ordering change needed.

- [ ] **Step 3: Manually verify against the live app**

The container's `uvicorn --reload` on :3000 already picked up the edit. Run:

```bash
curl -s -c /tmp/claude-1000/-var-home-staygold-ai-frontend/200ded16-9cd6-4e17-8453-c76c9a7d45ab/scratchpad/cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"test","password":"11111111"}' -o /dev/null -w "login: %{http_code}\n"
curl -s -b /tmp/claude-1000/-var-home-staygold-ai-frontend/200ded16-9cd6-4e17-8453-c76c9a7d45ab/scratchpad/cookies.txt http://localhost:3000/api/lore/mine -w "\nlore/mine: %{http_code}\n"
```

Expected: `login: 200`, `lore/mine: 200` with a JSON array (possibly empty — the `test` account may have no characters with lore yet).

- [ ] **Step 4: Commit**

```bash
git add backend/routers/lore.py
git commit -m "Add GET /api/lore/mine endpoint"
```

---

### Task 3: Route nesting — `/sanctum/...` and every link into it

**Files:**
- Modify: `new_ui/js/router.js`
- Modify: `new_ui/js/nav-menus.js`
- Modify: `new_ui/js/settings.js`
- Modify: `new_ui/js/profile-template.js`
- Modify: `new_ui/js/pantheon.js`
- Modify: `new_ui/index.html`

**Interfaces:**
- Consumes: nothing new.
- Produces: route keys `sanctum-casts`, `sanctum-masks`, `sanctum-grimoire`, `sanctum-forge`, `sanctum-create` in the `routes` object and `TAB_FOR_ROUTE`, all still rendering via the existing `renderPlaceholder()` (unchanged signature) until each sub-screen gets its own design pass. `sanctum` itself is left as a placeholder in this task — Task 4 replaces it with the real `SanctumView`. Every `navigate(...)` call anywhere in the codebase that pointed at `/forge`, `/grimoire`, `/masks`, `/casts`, or `/create` now points at `/sanctum/forge`, `/sanctum/grimoire`, `/sanctum/masks`, `/sanctum/casts`, `/sanctum/create` respectively — no dead flat links remain anywhere after this task.

- [ ] **Step 1: Replace the flat placeholder route entries with nested ones**

In `new_ui/js/router.js`, replace these five lines inside the `routes` object:

```javascript
  create: (main) => renderPlaceholder(main, "Sanctum", "New Character", "New Character",
    "Bind a new character into being."),
```
```javascript
  forge: (main) => renderPlaceholder(main, "Sanctum", "Generate media", "My Forge",
    "Conjure new images and video from nothing but a prompt or your own existing images."),
  grimoire: (main) => renderPlaceholder(main, "Sanctum", "Lore", "My Grimoire",
    "The lore entries that shape your worlds."),
  masks: (main) => renderPlaceholder(main, "Sanctum", "Personas", "My Masks",
    "The faces you wear when you step into a story."),
  casts: (main) => renderPlaceholder(main, "Sanctum", "Characters", "My Casts",
    "Characters you've created or imported, private to you."),
```

with:

```javascript
  "sanctum-create": (main) => renderPlaceholder(main, "Sanctum", "New Character", "New Character",
    "Bind a new character into being."),
  "sanctum-forge": (main) => renderPlaceholder(main, "Sanctum", "Generate media", "My Forge",
    "Conjure new images and video from nothing but a prompt or your own existing images."),
  "sanctum-grimoire": (main) => renderPlaceholder(main, "Sanctum", "Lore", "My Grimoire",
    "The lore entries that shape your worlds."),
  "sanctum-masks": (main) => renderPlaceholder(main, "Sanctum", "Personas", "My Masks",
    "The faces you wear when you step into a story."),
  "sanctum-casts": (main) => renderPlaceholder(main, "Sanctum", "Characters", "My Casts",
    "Characters you've created or imported, private to you."),
```

- [ ] **Step 2: Teach `currentRoute()` to parse `/sanctum/{sub}/...`**

In `new_ui/js/router.js`, in `currentRoute()`, change:

```javascript
function currentRoute() {
  const parts = location.pathname.split("/").filter(Boolean);
  const seg = parts[0];
  if (seg === "u") return "artisan-profile";
  if (seg === "symposium" && parts[1]) return "symposium-thread";
  if (seg === "i" && parts[1]) return "shared-image";
  return seg && routes[seg] ? seg : "compendium";
}
```

to:

```javascript
function currentRoute() {
  const parts = location.pathname.split("/").filter(Boolean);
  const seg = parts[0];
  if (seg === "u") return "artisan-profile";
  if (seg === "symposium" && parts[1]) return "symposium-thread";
  if (seg === "i" && parts[1]) return "shared-image";
  if (seg === "sanctum" && parts[1]) {
    const key = `sanctum-${parts[1]}`;
    return routes[key] ? key : "sanctum";
  }
  return seg && routes[seg] ? seg : "compendium";
}
```

This deliberately ignores any further path segments (`parts[2]`, `parts[3]`) — `/sanctum/casts/{cid}`, `/sanctum/masks/{pid}`, `/sanctum/grimoire/{cid}/{lid}`, and `/sanctum/forge/{iid}` all resolve to their respective `sanctum-{sub}` placeholder today. The id segments are preserved in the URL (so Task 4's feed links work and look correct) but unused until each sub-screen is actually built.

- [ ] **Step 3: Update `TAB_FOR_ROUTE`**

In `new_ui/js/router.js`, replace:

```javascript
  forge: "sanctum",
  grimoire: "sanctum",
  masks: "sanctum",
  casts: "sanctum",
```

with:

```javascript
  "sanctum-forge": "sanctum",
  "sanctum-grimoire": "sanctum",
  "sanctum-masks": "sanctum",
  "sanctum-casts": "sanctum",
  "sanctum-create": "sanctum",
```

- [ ] **Step 4: Update `openSanctumMenu()` in `new_ui/js/nav-menus.js`**

Replace:

```javascript
function openSanctumMenu() {
  openModal(`
    <h3>Sanctum</h3>
    <p style="margin:-6px 0 12px;font-style:italic">Your workshop, everything you've made or are making.</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("forge", "My Forge", "Generate media")}
      ${_navMenuRow("grimoire", "My Grimoire", "Lore")}
      ${_navMenuRow("masks", "My Masks", "Personas")}
      ${_navMenuRow("casts", "My Casts", "Characters")}
    </div>
  `);
}
```

with:

```javascript
function openSanctumMenu() {
  openModal(`
    <h3 style="cursor:pointer" onclick="closeTopModal();navigate('/sanctum')">Sanctum</h3>
    <p style="margin:-6px 0 12px;font-style:italic">Your workshop, everything you've made or are making.</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("forge", "My Forge", "Generate media", `navigate('/sanctum/forge')`)}
      ${_navMenuRow("grimoire", "My Grimoire", "Lore", `navigate('/sanctum/grimoire')`)}
      ${_navMenuRow("masks", "My Masks", "Personas", `navigate('/sanctum/masks')`)}
      ${_navMenuRow("casts", "My Casts", "Characters", `navigate('/sanctum/casts')`)}
    </div>
  `);
}
```

(The clickable `<h3>` heading matches `openCompendiumMenu()`'s existing pattern — Compendium's own overview is real, so tapping its title in the menu already navigates there; Sanctum's overview becomes real in Task 4, so this makes the two menus consistent.)

- [ ] **Step 5: Fix the three other flat-route references**

In `new_ui/js/settings.js`, change:
```javascript
      ${settingsRowHtml({ icon: svgIcon("masks"), label: "Personas", sublabel: "How you appear in chats", onclick: "navigate('/masks')" })}
```
to:
```javascript
      ${settingsRowHtml({ icon: svgIcon("masks"), label: "Personas", sublabel: "How you appear in chats", onclick: "navigate('/sanctum/masks')" })}
```

In `new_ui/js/profile-template.js`, change:
```javascript
    <a class="gl-character-card" href="/casts" onclick="event.preventDefault();navigate('/casts')">
```
to:
```javascript
    <a class="gl-character-card" href="/sanctum/casts" onclick="event.preventDefault();navigate('/sanctum/casts')">
```

In `new_ui/js/pantheon.js`, change:
```javascript
    <div class="char-card" style="--dom:${dom}" onclick="navigate('/casts')">
```
to:
```javascript
    <div class="char-card" style="--dom:${dom}" onclick="navigate('/sanctum/casts')">
```

In `new_ui/index.html`, change:
```html
        <button type="button" onclick="navigate('/create')" title="New character"
```
to:
```html
        <button type="button" onclick="navigate('/sanctum/create')" title="New character"
```

- [ ] **Step 6: Verify no flat references remain**

Run: `grep -rn "'/forge'\|'/grimoire'\|'/masks'\|'/casts'\|'/create'\|\"/forge\"\|\"/grimoire\"\|\"/masks\"\|\"/casts\"\|\"/create\"" /var/home/staygold/ai-frontend/new_ui/`
Expected: no output (empty) — every reference now uses the nested `/sanctum/...` form.

- [ ] **Step 7: Manually verify against `:3001`**

Confirm the human's `./rebuild.sh --watch` dev server is serving fresh code:
```bash
curl -s http://localhost:3001/js/router.js | grep -c "sanctum-casts"
```
Expected: a non-zero count. Then in a browser at `http://localhost:3001`, log in as `test`/`11111111`, tap the Sanctum bottom-nav tab, tap "My Casts" — confirm the URL becomes `/sanctum/casts` and the Sanctum tab stays highlighted. Tap the `+` (new character) button — confirm the URL becomes `/sanctum/create`.

- [ ] **Step 8: Commit**

```bash
git add new_ui/js/router.js new_ui/js/nav-menus.js new_ui/js/settings.js new_ui/js/profile-template.js new_ui/js/pantheon.js new_ui/index.html
git commit -m "Nest Sanctum's sub-routes under /sanctum/... and update every link into them"
```

---

### Task 4: `SanctumView` — quick-create row, merged recent feed, empty state

**Files:**
- Create: `new_ui/js/sanctum.js`
- Modify: `new_ui/index.html` (script tag)
- Modify: `new_ui/js/router.js` (wire the real view in)

**Interfaces:**
- Consumes: `pageHeaderHtml(nav, subnav, title, subtitle)` (`new_ui/js/router.js`), `api(path, opts)` (global fetch wrapper, used identically to `ParlanceView`/`ArtisansView`), `_NAV_MENU_ICONS` (`new_ui/js/nav-menus.js`, for tile/row icons), `navigate(path)` (`new_ui/js/router.js`), `ME` (global current-user object, for nothing in this task but available if needed later).
- Produces: `class SanctumView` with `async mount(main)`, matching the exact shape of `ParlanceView`/`ArtisansView` (constructor sets initial state, `mount` renders once immediately then again after fetch). Registered in `routes.sanctum`.

- [ ] **Step 1: Create `new_ui/js/sanctum.js` with the merged-feed data layer**

```javascript
"use strict";

function _sanctumAgo(ts) {
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const _SANCTUM_QUICK_TILES = [
  { type: "casts", label: "New Character", route: "/sanctum/create" },
  { type: "masks", label: "New Persona", route: "/sanctum/masks" },
  { type: "grimoire", label: "New Lore Entry", route: "/sanctum/casts" },
  { type: "forge", label: "New Image", route: "/sanctum/forge" },
];

const _SANCTUM_TYPE_LABELS = {
  casts: "Cast",
  masks: "Mask",
  grimoire: "Grimoire",
  forge: "Forge",
};

class SanctumView {
  constructor() {
    this.items = null;
    this.error = "";
  }

  async mount(main) {
    this.main = main;
    this.render();
    const [chars, personas, lore, images] = await Promise.all([
      api("/api/characters?scope=mine").catch(() => []),
      api("/api/personas").catch(() => []),
      api("/api/lore/mine").catch(() => []),
      api("/api/imagegen/standalone").catch(() => []),
    ]);
    this.items = [
      ...chars.map((c) => ({
        type: "casts", id: c.id, created: c.created,
        title: c.name || "Unnamed", thumb: c.avatar || "", route: `/sanctum/casts/${encodeURIComponent(c.id)}`,
      })),
      ...personas.map((p) => ({
        type: "masks", id: p.id, created: p.created,
        title: p.name || "Unnamed", thumb: "", route: `/sanctum/masks/${encodeURIComponent(p.id)}`,
      })),
      ...lore.map((l) => ({
        type: "grimoire", id: l.id, created: l.created,
        title: l.name || "Untitled entry", thumb: l.image || "",
        route: `/sanctum/grimoire/${encodeURIComponent(l.char_id || "")}/${encodeURIComponent(l.id)}`,
      })),
      ...images.map((i) => ({
        type: "forge", id: i.id, created: i.created,
        title: "Generated image", thumb: i.image || "", route: `/sanctum/forge/${encodeURIComponent(i.id)}`,
      })),
    ].sort((a, b) => b.created - a.created).slice(0, 20);
    this.render();
  }

  quickRowHtml() {
    return `
      <div class="sanctum-quick-row">
        ${_SANCTUM_QUICK_TILES.map((t) => `
          <button type="button" class="sanctum-quick-tile" onclick="navigate('${t.route}')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${_NAV_MENU_ICONS[t.type]}</svg>
            <span>${t.label}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  specimenHtml(item) {
    const initial = item.title[0].toUpperCase();
    const art = item.thumb
      ? `background-image:url('${item.thumb}')`
      : `background:var(--color-surface-2)`;
    return `
      <div class="sanctum-feed-row" onclick="navigate('${item.route}')">
        <span class="sanctum-specimen" style="${art}">
          ${item.thumb ? "" : initial}
          <span class="sanctum-specimen-tab">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_NAV_MENU_ICONS[item.type]}</svg>
          </span>
        </span>
        <div class="sanctum-feed-body">
          <span class="sanctum-feed-title">${item.title}</span>
          <span class="sanctum-feed-meta">${_SANCTUM_TYPE_LABELS[item.type]} · ${_sanctumAgo(item.created)}</span>
        </div>
      </div>
    `;
  }

  bodyHtml() {
    if (this.items === null) {
      return `<p style="color:var(--color-sec);font-size:13px">Opening the workshop…</p>`;
    }
    if (!this.items.length) {
      return `
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">Nothing forged yet.</p>
          <p class="sanctum-empty-sub">Everything you make will show up here.</p>
          <a href="/sanctum/create" data-route="__seeall" onclick="event.preventDefault();navigate('/sanctum/create')" class="sanctum-empty-cta">Create your first character &rarr;</a>
        </div>
      `;
    }
    return `<div class="sanctum-feed">${this.items.map((i) => this.specimenHtml(i)).join("")}</div>`;
  }

  render() {
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Overview", "Sanctum", "Your workshop with everything you've made, or are making.")}
      ${this.quickRowHtml()}
      ${this.bodyHtml()}
    `;
  }
}
```

- [ ] **Step 2: Register the script tag**

In `new_ui/index.html`, add after the `nav-menus.js` line:

```html
  <script src="/js/nav-menus.js" defer></script>
  <script src="/js/sanctum.js" defer></script>
```

- [ ] **Step 3: Wire the real view into the router**

In `new_ui/js/router.js`, change:

```javascript
  sanctum: (main) => renderPlaceholder(main, "Sanctum", "Overview", "Sanctum",
    "Your workshop with everything you've made, or are making."),
```

to:

```javascript
  sanctum: (main) => new SanctumView().mount(main),
```

- [ ] **Step 4: Verify real data end-to-end via curl**

```bash
cd /tmp/claude-1000/-var-home-staygold-ai-frontend/200ded16-9cd6-4e17-8453-c76c9a7d45ab/scratchpad
curl -s -c cookies.txt -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"username":"test","password":"11111111"}' -o /dev/null -w "login: %{http_code}\n"
curl -s -b cookies.txt "http://localhost:3001/api/characters?scope=mine" -w "\ncasts: %{http_code}\n" -o /dev/null
curl -s -b cookies.txt "http://localhost:3001/api/personas" -w "\nmasks: %{http_code}\n" -o /dev/null
curl -s -b cookies.txt "http://localhost:3001/api/lore/mine" -w "\ngrimoire: %{http_code}\n" -o /dev/null
curl -s -b cookies.txt "http://localhost:3001/api/imagegen/standalone" -w "\nforge: %{http_code}\n" -o /dev/null
```

Expected: all four `200`.

- [ ] **Step 5: Manually verify the rendered screen in a browser against `:3001`**

Navigate to `http://localhost:3001/sanctum` while logged in as `test`. Confirm: the header reads "Sanctum · Overview" / "Sanctum"; four quick-create tiles render with icons and labels; below them, either a feed of specimen rows (thumbnail + type label + relative time, newest first) or the "Nothing forged yet." empty state if the account has nothing yet; tapping a feed row navigates to its nested detail URL (e.g. `/sanctum/casts/{cid}`) and shows the placeholder screen from Task 3 (expected — that sub-screen isn't built yet); tapping a quick-create tile navigates to the right placeholder/create route.

- [ ] **Step 6: Commit**

```bash
git add new_ui/js/sanctum.js new_ui/index.html new_ui/js/router.js
git commit -m "Add Sanctum overview screen: quick-create tiles and merged recent-items feed"
```

---

### Task 5: Sanctum CSS — quick-create tiles, feed rows, empty state

**Files:**
- Modify: `new_ui/css/cards.css`

**Interfaces:**
- Consumes: theme custom properties already defined in `new_ui/css/themes.css` (`--color-accent`, `--color-accent-deep`, `--color-ink`, `--color-sec`, `--color-muted`, `--color-surface`, `--color-surface-2`, `--color-line`, `--color-paper-base`, `--font-display`, `--font-mono`).
- Produces: `.sanctum-quick-row`, `.sanctum-quick-tile`, `.sanctum-feed`, `.sanctum-feed-row`, `.sanctum-specimen`, `.sanctum-specimen-tab`, `.sanctum-feed-body`, `.sanctum-feed-title`, `.sanctum-feed-meta`, `.sanctum-empty`, `.sanctum-empty-mark`, `.sanctum-empty-title`, `.sanctum-empty-sub`, `.sanctum-empty-cta` — class names referenced by Task 4's `sanctum.js` markup.

- [ ] **Step 1: Append the CSS block**

In `new_ui/css/cards.css`, add after the existing `.parlance-*` block (before the `html[data-censor="1"]` rule at the end of the file):

```css
.sanctum-quick-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 14px 0 20px;
}
.sanctum-quick-tile {
  flex: 1 1 calc(50% - 4px);
  min-width: 120px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  border: none;
  color: var(--color-paper-base);
  background: linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));
  cursor: pointer;
  text-align: left;
}
.sanctum-quick-tile span {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 13px;
}
.sanctum-feed {
  display: flex;
  flex-direction: column;
}
.sanctum-feed-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 4px;
  border-bottom: 1px solid var(--color-line);
  cursor: pointer;
}
.sanctum-feed-row:last-child { border-bottom: none; }
.sanctum-specimen {
  position: relative;
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background-size: cover;
  background-position: center;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-line);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--color-ink);
}
.sanctum-specimen-tab {
  position: absolute;
  bottom: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--color-accent);
  color: var(--color-paper-base);
  border: 2px solid var(--color-paper);
}
.sanctum-feed-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sanctum-feed-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14px;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sanctum-feed-meta {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.sanctum-empty {
  text-align: center;
  padding: 48px 16px;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: var(--color-surface);
}
.sanctum-empty-mark {
  font-family: var(--font-display);
  font-size: 28px;
  color: var(--color-accent);
  margin-bottom: 6px;
}
.sanctum-empty-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  color: var(--color-ink);
  margin: 0;
}
.sanctum-empty-sub {
  font-size: 13px;
  color: var(--color-sec);
  margin: 4px 0 14px;
}
.sanctum-empty-cta {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: .06em;
  color: var(--color-accent);
}
```

- [ ] **Step 2: Verify the stylesheet still loads and no selector typos exist**

```bash
curl -s http://localhost:3001/css/cards.css | grep -c "sanctum-quick-tile\|sanctum-feed-row\|sanctum-empty"
```

Expected: a non-zero count (each class name appears at least once).

- [ ] **Step 3: Manually verify in a browser**

Reload `http://localhost:3001/sanctum`. Confirm: the four quick-create tiles show as accent-gradient rounded rectangles in a 2×2 wrapping row; feed rows show a rounded-square thumbnail with a small icon tab in the bottom-right corner, title, and mono type/time line; switch the theme (light/dark and at least one non-default accent, via the existing theme toggle) and confirm every color on the screen changes with it — nothing stays a fixed color across the switch.

- [ ] **Step 4: Commit**

```bash
git add new_ui/css/cards.css
git commit -m "Style Sanctum overview: quick-create tiles, specimen feed rows, empty state"
```

---

## Post-plan verification checklist

- [ ] `/sanctum` shows real quick-create tiles and a real feed (or empty state) for the `test` account, matching the approved spec's layout order (header → quick-create → feed).
- [ ] `/sanctum/casts`, `/sanctum/masks`, `/sanctum/grimoire`, `/sanctum/forge`, `/sanctum/create` all still resolve (to placeholders) and highlight the Sanctum tab.
- [ ] No remaining references to the old flat `/forge`, `/grimoire`, `/masks`, `/casts`, `/create` routes anywhere in `new_ui/`.
- [ ] `pytest backend/tests/test_lore_repo.py` passes in full.
- [ ] Theme switching (light/dark × at least one accent) leaves nothing on `/sanctum` a fixed, non-reactive color.
