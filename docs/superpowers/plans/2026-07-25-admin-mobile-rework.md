# Admin Mobile Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all nine admin screens work on phones and tablets (dropdown switcher, A-cards for queues, C-rows with bottom sheet for directories, sparkline health), and fix the three functional defects: inline health checks stalling the Overview, media-gen-status wrongly blocking hosted image providers, and the stale training-progress poller.

**Architecture:** One shared frontend module (`new_ui/js/admin-mobile.js`) provides the dropdown, card/row/sheet renderers, and sparkline helper; each admin view emits through it at mobile width while keeping desktop markup untouched. Backend gets a cached service-health read plus an explicit refresh endpoint, and a provider-aware media-gen-status.

**Tech Stack:** FastAPI + pytest (live Postgres rollback fixture), vanilla JS + Tailwind tokens, Chart.js (already loaded for admin), tree-sitter for JS parse checks.

## Global Constraints

- Zero comments and zero docstrings in any file.
- User-facing strings: no em dashes, no semicolons; always `t("key", "Fallback")` with the key added alphabetically to UI_STRINGS in `new_ui/js/translations.js`.
- CSS goes in `new_ui/css/cards.css` using theme tokens (`var(--color-...)`) only, never hardcoded hex, never `app.css`. Run `./rebuild.sh --once` after CSS edits.
- Live bind-mounted app: edits hot-reload; after each task `curl -s -o /dev/null -w "%{http_code}" https://storyhavenai.sillysillysupersillydomain.win/api/health` must print 401.
- Never run git stash, git reset, git checkout, or use a worktree.
- Python tests: `set -a; . ./.env.dev; set +a; /tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -m pytest <files> -q` from the repo root.
- JS parse check: `/tmp/claude-1000/-var-home-staygold-ai-frontend/324ceabc-90f9-43ea-94ff-0d0899ad6bc4/scratchpad/tvenv/bin/python3 -c "import tree_sitter_javascript as j, tree_sitter as t; p=t.Parser(t.Language(j.language())); print(p.parse(open('<file>','rb').read()).root_node.has_error)"` must print False.
- Desktop (>=1024px) markup and behavior unchanged in every task.

---

### Task 1: Cached service-health read + explicit refresh endpoint

**Files:**
- Modify: `backend/routers/health.py` (`admin_service_health`, ~line 129)
- Test: `backend/tests/test_health_router.py` (append)

**Interfaces:**
- Produces: `GET /admin/service-health` no longer calls `run_all_checks_and_record()`; new `POST /admin/service-health/refresh` (admin) runs it and returns `{"services": [...]}` in the same shape as the GET's `services` list.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_health_router.py`:

```python
async def test_service_health_get_does_not_run_live_checks(db_conn, monkeypatch):
    from backend.routers import health as health_router

    async def must_not_run():
        raise AssertionError("live checks ran on GET")

    monkeypatch.setattr(health_router, "run_all_checks_and_record", must_not_run)
    result = await health_router.admin_service_health(hours=1, _={"id": "a", "is_admin": True})
    assert "services" in result


async def test_service_health_refresh_runs_live_checks(db_conn, monkeypatch):
    from backend.routers import health as health_router

    calls = []

    async def fake_checks():
        calls.append(1)
        return {name: (True, 5.0, "") for name in health_router.SERVICES}

    monkeypatch.setattr(health_router, "run_all_checks_and_record", fake_checks)
    result = await health_router.admin_service_health_refresh(_={"id": "a", "is_admin": True})
    assert calls == [1]
    assert {s["name"] for s in result["services"]} == set(health_router.SERVICES)
```

- [ ] **Step 2: Run to verify they fail**

Run the pytest command from Global Constraints on `backend/tests/test_health_router.py`.
Expected: first test FAILS (live checks ran on GET), second fails with AttributeError (`admin_service_health_refresh` missing).

- [ ] **Step 3: Implement**

In `backend/routers/health.py`, inside `admin_service_health`, replace the line `live = await run_all_checks_and_record()` with a read of the latest recorded ping per service:

```python
    live = {}
    for name in SERVICES:
        ping = await health_repo.latest_ping(name)
        if ping is None:
            live[name] = (False, None, "no data yet")
        else:
            live[name] = (bool(ping["ok"]), ping.get("latency_ms"), ping.get("error") or "")
```

Add below `admin_service_health` (reusing whatever local helper it uses to shape each service dict — read the function body and keep the response shape identical):

```python
@api.post("/admin/service-health/refresh")
async def admin_service_health_refresh(_: dict = Depends(get_admin)):
    results = await run_all_checks_and_record()
    services = [{"name": name, "ok": results[name][0],
                 "latency_ms": results[name][1], "error": results[name][2]}
                for name in SERVICES]
    log.info("service-health: manual refresh ran %d checks", len(services))
    return {"services": services}
```

- [ ] **Step 4: Run to verify green**

Same command plus `backend/tests/test_health_repo.py`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/health.py backend/tests/test_health_router.py
git commit -m "Serve recorded pings from service-health and move live checks behind an explicit refresh endpoint"
```

---

### Task 2: media-gen-status honors hosted image providers

**Files:**
- Modify: `backend/routers/health.py` (`media_gen_status`, ~line 122)
- Test: `backend/tests/test_health_router.py` (append)

**Interfaces:**
- Produces: `GET /media-gen-status` returns `{"available": True}` whenever `CFG["image_provider"]` is set and not `"comfyui"`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_media_gen_status_available_with_hosted_provider(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG

    monkeypatch.setitem(CFG, "image_provider", "stability")

    async def must_not_read(name):
        raise AssertionError("comfyui ping read with hosted provider active")

    monkeypatch.setattr(health_router.health_repo, "latest_ping", must_not_read)
    result = await health_router.media_gen_status(_={"id": "u"})
    assert result == {"available": True}


async def test_media_gen_status_still_uses_ping_for_comfyui(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG

    monkeypatch.setitem(CFG, "image_provider", "comfyui")

    async def fake_ping(name):
        return {"ok": 0}

    monkeypatch.setattr(health_router.health_repo, "latest_ping", fake_ping)
    result = await health_router.media_gen_status(_={"id": "u"})
    assert result == {"available": False}
```

- [ ] **Step 2: Run to verify the first fails** (comfyui ping read with hosted provider active).

- [ ] **Step 3: Implement** — at the top of `media_gen_status`:

```python
    if (CFG.get("image_provider") or "comfyui") != "comfyui":
        return {"available": True}
```

`CFG` is already imported in the module (check; add to the existing state import if not).

- [ ] **Step 4: Run to verify green**, then confirm live: `curl -s -b <any logged-in cookie unnecessary here> https://storyhavenai.sillysillysupersillydomain.win/api/health` prints 401 (app up).

- [ ] **Step 5: Commit**

```bash
git add backend/routers/health.py backend/tests/test_health_router.py
git commit -m "media-gen-status reports available when a hosted image provider is active"
```

---

### Task 3: Shared admin-mobile module and styles

**Files:**
- Create: `new_ui/js/admin-mobile.js`
- Modify: `new_ui/css/cards.css` (append), `new_ui/index.html` (script tag before admin.js), `new_ui/js/translations.js` (new keys)
- Test: JS parse check + `./rebuild.sh --once` + live curl of the new file

**Interfaces (produced, used by Tasks 4-9):**
- `adminScreenSwitcherHtml(currentRoute: string, badges: object) -> string` — the dropdown; `badges` maps route → count. Renders nothing at >=1024px (CSS hides it).
- `adminAttachScreenSwitcher(root: Element)` — wires open/close and `navigate()` calls.
- `adminCardHtml({title, pill, pillTone, facts, actions}) -> string` — A-card; `actions` is `[{id, label, primary}]`; callers wire handlers via `data-admin-action="<id>"` delegation.
- `adminRowHtml({id, title, pill, pillTone, meta}) -> string` — C-row with chevron, `data-admin-row="<id>"`.
- `AdminBottomSheet` class — `open({title, meta, actions, onAction})`, `close()`; owns its DOM node and backdrop (real state, hence a class).
- `adminSparklineHtml(id) -> string` and `adminRenderSparkline(canvasId, points)` — Chart.js line, no axes, no legend, theme accent color.
- All routes list: `ADMIN_SCREENS = [{route, labelKey, fallback}]` for the nine screens.

- [ ] **Step 1: Write the module** — full skeleton (implementer fills only the CSS class names consistently with the styles in Step 2; all logic below is complete):

```javascript
"use strict";

const ADMIN_SCREENS = [
  { route: "admin", labelKey: "admin_switch_overview", fallback: "Overview" },
  { route: "admin-users", labelKey: "admin_switch_users", fallback: "Users" },
  { route: "admin-moderation", labelKey: "admin_switch_moderation", fallback: "Moderation" },
  { route: "admin-previews", labelKey: "admin_switch_previews", fallback: "Model previews" },
  { route: "admin-train", labelKey: "admin_switch_train", fallback: "Train LoRA" },
  { route: "admin-emojis", labelKey: "admin_switch_emojis", fallback: "Emojis" },
  { route: "admin-config", labelKey: "admin_switch_config", fallback: "Server config" },
  { route: "admin-health", labelKey: "admin_switch_health", fallback: "Health and logs" },
  { route: "admin-features", labelKey: "admin_switch_features", fallback: "Feature flags" },
  { route: "admin-announce", labelKey: "admin_switch_announce", fallback: "Announcements" },
];

function _adminBadgeHtml(count) {
  if (!count) return "";
  return `<span class="admin-switch-badge">${count}</span>`;
}

function adminScreenSwitcherHtml(currentRoute, badges = {}) {
  const current = ADMIN_SCREENS.find((s) => s.route === currentRoute) || ADMIN_SCREENS[0];
  const items = ADMIN_SCREENS.map((s) => `
    <button type="button" class="admin-switch-item${s.route === currentRoute ? " on" : ""}" data-admin-switch-to="${s.route}">
      ${t(s.labelKey, s.fallback)}${_adminBadgeHtml(badges[s.route])}
    </button>`).join("");
  return `
    <div class="admin-switch" data-admin-switch>
      <button type="button" class="admin-switch-current" data-admin-switch-toggle>
        <span>${t(current.labelKey, current.fallback)}${_adminBadgeHtml(badges[currentRoute])}</span>
        <span class="admin-switch-caret">▾</span>
      </button>
      <div class="admin-switch-list hidden" data-admin-switch-list>${items}</div>
    </div>`;
}

function adminAttachScreenSwitcher(root) {
  const wrap = root.querySelector("[data-admin-switch]");
  if (!wrap) return;
  const list = wrap.querySelector("[data-admin-switch-list]");
  wrap.querySelector("[data-admin-switch-toggle]").onclick = () => list.classList.toggle("hidden");
  wrap.querySelectorAll("[data-admin-switch-to]").forEach((el) => {
    el.onclick = () => navigate("/" + el.dataset.adminSwitchTo);
  });
}

function adminCardHtml({ title, pill, pillTone, facts, actions }) {
  const actionHtml = (actions || []).map((a) =>
    `<button type="button" class="admin-card-action${a.primary ? " primary" : ""}" data-admin-action="${_attr(a.id)}">${_esc(a.label)}</button>`).join("");
  return `
    <div class="admin-card">
      <div class="admin-card-top">
        <span class="admin-card-title">${_esc(title)}</span>
        ${pill ? `<span class="admin-pill ${pillTone || ""}">${_esc(pill)}</span>` : ""}
      </div>
      ${facts ? `<div class="admin-card-facts">${_esc(facts)}</div>` : ""}
      ${actionHtml ? `<div class="admin-card-actions">${actionHtml}</div>` : ""}
    </div>`;
}

function adminRowHtml({ id, title, pill, pillTone, meta }) {
  return `
    <button type="button" class="admin-row" data-admin-row="${_attr(id)}">
      <span class="admin-row-main">
        <span class="admin-row-title">${_esc(title)}</span>
        <span class="admin-row-meta">${_esc(meta || "")}</span>
      </span>
      ${pill ? `<span class="admin-pill ${pillTone || ""}">${_esc(pill)}</span>` : ""}
      <span class="admin-row-chev">›</span>
    </button>`;
}

class AdminBottomSheet {
  constructor() {
    this.node = null;
  }

  open({ title, meta, actions, onAction }) {
    this.close();
    const actionHtml = (actions || []).map((a) =>
      `<button type="button" class="admin-sheet-action${a.primary ? " primary" : ""}" data-admin-action="${_attr(a.id)}">${_esc(a.label)}</button>`).join("");
    const node = document.createElement("div");
    node.className = "admin-sheet-layer";
    node.innerHTML = `
      <div class="admin-sheet-backdrop" data-admin-sheet-close></div>
      <div class="admin-sheet">
        <div class="admin-sheet-title">${_esc(title)}</div>
        <div class="admin-sheet-meta">${_esc(meta || "")}</div>
        <div class="admin-sheet-actions">${actionHtml}</div>
      </div>`;
    node.querySelector("[data-admin-sheet-close]").onclick = () => this.close();
    node.querySelectorAll("[data-admin-action]").forEach((el) => {
      el.onclick = () => onAction(el.dataset.adminAction);
    });
    document.body.appendChild(node);
    this.node = node;
  }

  close() {
    if (this.node) {
      this.node.remove();
      this.node = null;
    }
  }
}

let _adminSparkSeq = 0;

function adminSparklineHtml() {
  _adminSparkSeq += 1;
  return `<canvas class="admin-spark" id="adminSpark${_adminSparkSeq}" width="60" height="18"></canvas>`;
}

function adminRenderSparkline(canvasId, points) {
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === "undefined") return null;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  return new Chart(el, {
    type: "line",
    data: { labels: points.map((_, i) => i), datasets: [{ data: points, borderColor: accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3 }] },
    options: { responsive: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } } },
  });
}

if (typeof window !== "undefined") {
  window.ADMIN_SCREENS = ADMIN_SCREENS;
  window.adminScreenSwitcherHtml = adminScreenSwitcherHtml;
  window.adminAttachScreenSwitcher = adminAttachScreenSwitcher;
  window.adminCardHtml = adminCardHtml;
  window.adminRowHtml = adminRowHtml;
  window.AdminBottomSheet = AdminBottomSheet;
  window.adminSparklineHtml = adminSparklineHtml;
  window.adminRenderSparkline = adminRenderSparkline;
}
```

- [ ] **Step 2: Styles** — append to `new_ui/css/cards.css` a section using only theme tokens: `.admin-switch` (hidden at `@media (min-width: 1024px)`), `.admin-switch-current` (full-width, surface background, line border, 10px radius), `.admin-switch-list` (absolute, surface, borders, one button per row), `.admin-switch-badge` (warn-colored count chip), `.admin-card` / `.admin-card-top` / `.admin-card-facts` / `.admin-card-actions` / `.admin-card-action` (flex-1 buttons, accent border for `.primary`), `.admin-pill` (mono uppercase chip, `.warn` tone uses `var(--color-warn)`), `.admin-row` (full-width flex button, min-height 44px), `.admin-sheet-layer` (fixed inset-0, z above nav), `.admin-sheet-backdrop` (scrim), `.admin-sheet` (bottom-anchored surface, 18px top radius, large touch targets), `.admin-spark` (fixed 60x18). Run `./rebuild.sh --once`.

- [ ] **Step 3: Register** — `new_ui/index.html`: add `<script src="/js/admin-mobile.js" defer></script>` immediately before the `admin.js` script tag. `new_ui/js/translations.js`: add the ten `admin_switch_*` keys alphabetically with the fallbacks above.

- [ ] **Step 4: Verify** — JS parse check on `admin-mobile.js` and `translations.js` prints False twice; `curl -s https://storyhavenai.sillysillysupersillydomain.win/js/admin-mobile.js | head -c 40` returns the file.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/admin-mobile.js new_ui/css/cards.css new_ui/css/app.css new_ui/index.html new_ui/js/translations.js
git commit -m "Add the shared admin mobile module: screen switcher, card and row renderers, bottom sheet, sparklines"
```

---

### Task 4: Screen switcher on all nine screens

**Files:**
- Modify: each of `new_ui/js/admin.js`, `admin-users.js`, `admin-moderation.js`, `admin-previews.js`, `admin-train.js`, `admin-emojis.js`, `admin-config.js`, `admin-health.js`, `admin-features.js`, `admin-announce.js`

**Interfaces:**
- Consumes: `adminScreenSwitcherHtml`, `adminAttachScreenSwitcher` from Task 3.

- [ ] **Step 1:** In each view's main render (the method that sets `this.main.innerHTML` or `main.innerHTML` — `render()` in admin.js:38, admin-users.js:84, admin-emojis.js:41, admin-previews.js:116, admin-train.js:99, admin-announce.js:9; `renderShell()` in admin-features.js:25; `renderHealth()` in admin-health.js:131; the equivalent top-level render in admin-moderation.js and admin-config.js — locate with `grep -n "innerHTML = \`" <file> | head -3`), insert `${adminScreenSwitcherHtml("<route>", this._switcherBadges || {})}` as the first child inside the `content-col` div, and call `adminAttachScreenSwitcher(this.main)` immediately after the innerHTML assignment. The route string is the screen's own route (e.g. `"admin-users"`).
- [ ] **Step 2:** In `admin.js` only, after the overview loads its counts, set `window._adminSwitcherBadges = { "admin-moderation": attentionTotal }` and pass it; every other screen reads `window._adminSwitcherBadges || {}`.
- [ ] **Step 3:** Parse-check every touched file (all print False). Live-verify the served `admin.js` contains `adminScreenSwitcherHtml`.
- [ ] **Step 4: Commit** — `git add new_ui/js/admin*.js && git commit -m "Pin the screen switcher dropdown to every admin screen at mobile and tablet widths"`

---

### Task 5: Moderation queues render A-cards

**Files:**
- Modify: `new_ui/js/admin-moderation.js`

**Interfaces:**
- Consumes: `adminCardHtml` from Task 3.

- [ ] **Step 1:** Read the file. For each queue's row renderer (pending signups, flagged endpoints, password resets, model requests, title requests, image reports, content reports), wrap the existing desktop row in a container hidden below 768px (`class="hidden md:block"` on the existing markup) and add a mobile sibling (`class="md:hidden"`) rendering `adminCardHtml` with: title = the row's primary identity (username, endpoint host, report subject), pill = its status, facts = the same secondary fields the desktop row shows, actions = the exact actions the desktop row exposes (`[{id: "approve", label: t("admin_mod_approve", "Approve"), primary: true}, ...]` using each queue's existing handler ids). Wire clicks by event delegation on the queue container: `container.querySelectorAll("[data-admin-action]")` dispatching to the same handler functions the desktop buttons call, passing the row id carried on a `data-admin-card-id` attribute added to the card wrapper.
- [ ] **Step 2:** Destructive/reject actions must call the same confirm modal the desktop buttons use, not bypass it.
- [ ] **Step 3:** Parse check False; live check the served file; visually verify at 375px (queues render as cards, actions work) and 1280px (unchanged).
- [ ] **Step 4: Commit** — `git commit -am "Render moderation queues as action cards at phone width"`

---

### Task 6: Users directory renders C-rows with the bottom sheet

**Files:**
- Modify: `new_ui/js/admin-users.js`

**Interfaces:**
- Consumes: `adminRowHtml`, `AdminBottomSheet` from Task 3.

- [ ] **Step 1:** In `AdminUsersView.render()` (line 84), keep the desktop table/list under `hidden md:block` and add a `md:hidden` list rendering `adminRowHtml` per user: title = display name or username, pill = Dev/Admin/Pending/Suspended/Member (warn tone for Pending/Suspended), meta = `@username · N chats`.
- [ ] **Step 2:** Instantiate one `AdminBottomSheet` on the view (`this.sheet = this.sheet || new AdminBottomSheet()`). Row tap opens it with the user's full meta line and the same actions the desktop row offers (change role, reset password, suspend or unsuspend, approve when pending, delete where allowed), `onAction` dispatching to the existing handler methods by id then `this.sheet.close()`.
- [ ] **Step 3:** Suspend/delete go through the existing confirm modal.
- [ ] **Step 4:** Parse check; live check; verify at 375px (rows + sheet actions) and 1280px (unchanged desktop).
- [ ] **Step 5: Commit** — `git commit -am "Render the users directory as compact rows with a bottom action sheet at phone width"`

---

### Task 7: Health screen sparkline rows, expandable charts, refresh button

**Files:**
- Modify: `new_ui/js/admin-health.js`
- Consumes: `adminSparklineHtml`, `adminRenderSparkline` from Task 3; `POST /admin/service-health/refresh` from Task 1.

- [ ] **Step 1:** In `renderHealth()` (line 131): at `md:hidden`, render one row per service (LED dot colored by `ok`, service label, current latency, `adminSparklineHtml()`), then after innerHTML assignment call `adminRenderSparkline` per service with the last 20 history points already present in `this.healthData`. Desktop markup stays under `hidden md:block`.
- [ ] **Step 2:** Row tap toggles an inline expanded container rendering the existing full Chart.js history chart (`renderChart(service)`, line 89) for that service only; collapse destroys the chart instance to avoid leaks.
- [ ] **Step 3:** Add a refresh button beside the hours selector that calls `await api("/api/admin/service-health/refresh", {method: "POST"})` then reloads `this.healthData` from the GET and re-renders; label `t("admin_health_refresh_now", "Check now")`. The periodic poll keeps using the fast GET.
- [ ] **Step 4:** Log viewer: level-filter chips (`All`, `Info`, `Warn`, `Error`) as `md:hidden` alternative to the existing selector if one exists (reuse the existing filter state), and wrap each log line in a container with `overflow-x: auto`.
- [ ] **Step 5:** Audit the screen's poll lifecycle: any `setInterval` must be cleared when the view unmounts (match how other admin views clean up; if no unmount hook exists, guard the interval callback with `this.main.isConnected` and self-clear when false).
- [ ] **Step 6:** Parse check; live check; verify 375px sparkline rows + expand + refresh, 1280px unchanged.
- [ ] **Step 7: Commit** — `git commit -am "Sparkline service rows with expandable charts and an explicit check-now refresh on the health screen"`

---

### Task 8: Training watcher rebind fix

**Files:**
- Modify: `new_ui/js/admin-train.js` (`TrainingJobWatcher`, line 836; `watch()` at ~943)
- Consumes: nothing new.

- [ ] **Step 1:** In `TrainingJobWatcher`, store refs on the instance: `watch(jobId, refs, onSettled)` sets `this.refs = refs`, and the poll body reads every element through `this.refs` instead of the destructured closure variables (mechanical rename inside `poll`).
- [ ] **Step 2:** Add:

```javascript
  rebind(refs) {
    this.refs = refs;
  }
```

- [ ] **Step 3:** In `AdminTrainView`, wherever the Progress tab renders its DOM while `this.watcher && this.watcher.jobId` (find the render path that builds `statusLabel`/`bar`/`logEl` etc. — the same refs object passed to `watch`), call `this.watcher.rebind(newRefs)` after the innerHTML assignment so an in-flight job immediately paints onto the fresh nodes. Trigger one immediate poll after rebinding by extracting the existing `poll` into `this._poll` and calling it from `rebind` when set.
- [ ] **Step 4:** Parse check; live check; verify by starting no job (rebind is a no-op) and by code inspection that `watch` behavior (settle, toasts, visibilitychange) is unchanged.
- [ ] **Step 5: Commit** — `git commit -am "Rebind the training watcher to fresh DOM on tab remount so progress never goes stale"`

---

### Task 9: Forms stack at phone width

**Files:**
- Modify: `new_ui/js/admin-config.js`, `new_ui/js/admin-announce.js`, `new_ui/js/admin-features.js`

- [ ] **Step 1:** In each, find multi-column grids/flex rows in the form markup (`grid-cols-2`, side-by-side inputs) and make them stack below 768px (`grid-cols-1 md:grid-cols-2` pattern); inputs become full-width at phone width.
- [ ] **Step 2:** The primary button (Save configuration, Send to all users, the feature-flag action bar) gets `sticky bottom-0` with a surface background at `md:hidden`-width only, so it stays reachable on long forms.
- [ ] **Step 3:** Parse check all three; verify 375px and 1280px.
- [ ] **Step 4: Commit** — `git commit -am "Stack admin forms single column with a sticky primary action at phone width"`

---

### Task 10: Four-tier visual verification pass

**Files:** none (verification only, fixes go in this task's commit if found)

- [ ] **Step 1:** For each of the nine screens, verify at 375px, 800px, 1280px, 2200px against the live app (log in as the admin account from CLAUDE.md). Checklist per screen: no horizontal page scroll, dropdown present below 1024px and absent at 1024px+, cards/rows/sheet/sparklines behave, desktop unchanged.
- [ ] **Step 2:** Run the full backend suite (Global Constraints command on `backend/tests`) — expected all green except the known environment skip.
- [ ] **Step 3:** Fix anything found, parse-check and re-verify, then commit remaining fixes: `git commit -am "Admin mobile rework verification fixes"` (skip commit if clean).
