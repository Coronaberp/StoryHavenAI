# Session Lore Web View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-chat Session Lore tab's placeholder SVG-circle "Web" view with a real `vis.js` force-directed graph — category-colored nodes, real relationship edges from `lore_links`, freeze/reset, click-to-isolate-neighborhood — matching the standalone Workshop Lorebook page's graph, adapted for session scope and a mobile-first modal.

**Architecture:** A new small module, `new_ui/js/session-lore-web.js`, owns the pure graph-building logic (category coloring, degree-based node sizing, player-edited-entry marking) as testable exported functions, plus a `mount`/`render` class mirroring `WorkshopLoreWebView`'s structure but reading session-effective lore entries (with their already-present `links` field) instead of the full character lorebook. `chat.js`'s existing `renderSessionLoreWeb` stub call site gets rewired to use it.

**Tech Stack:** Vanilla JS (no build step), `vis-network` (already loaded globally via `new_ui/index.html`, used today by `workshop-lore-web.js`), Node's built-in `node:test`/`node:assert/strict` for pure-function unit tests (existing project pattern, see `tests/new_ui/`).

## Global Constraints

- Zero comments, ever, in any file — self-documenting via naming only (per project CLAUDE.md).
- No em dashes, no semicolons, no AI-cliché stock phrasing in any UI-facing string (`PROSE_STYLE_GUARD` rule extends to `new_ui/` copy).
- Keep files small — one clear responsibility per file; don't grow `chat.js` further, put new graph logic in its own module.
- Mobile-first: canvas `4:5` aspect ratio and stacked controls below 640px (reusing `.grimoire-web-canvas`/`.grimoire-web-controls` CSS as-is, already responsive), `16:10` and side-by-side controls at ≥640px.
- No backend changes — `GET /sessions/{sid}/lore` already returns `links` per entry (`{target_id, label}`) and `player_edited` (bool), both already shipped.
- This repo is the live running app (per CLAUDE.md) — edits to `.js`/`.css` take effect on next page load via no-cache headers, no build step, no restart. Verify against the live public domain, not `localhost:3000` (unreachable from this shell).
- Test command for pure JS functions: `node --test tests/new_ui/session-lore-web.test.js` (matches the existing `tests/new_ui/auth-scene.test.js` pattern — plain `node:test`, import named exports directly from the `new_ui/js/*.js` source file).

---

### Task 1: Pure graph-data helpers, with tests

**Files:**
- Create: `new_ui/js/session-lore-web.js`
- Test: `tests/new_ui/session-lore-web.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no DOM, no network).
- Produces:
  - `sessionLoreCategoryColor(category: string, palette: {bg: string, border: string}[]) -> {bg: string, border: string}` — deterministic hash-based color pick, same algorithm as `workshop-lore-web.js`'s `categoryColor`.
  - `sessionLoreDegreeMap(entries: {id: string, links?: {target_id: string, label: string}[]}[]) -> Record<string, number>` — for each entry id, count of edges touching it (both directions), only counting edges whose target is also in `entries`.
  - `sessionLoreNodeRadius(degree: number) -> number` — `Math.min(40, 18 + degree * 4)`, identical formula to the workshop version's `nodeRadius`.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionLoreCategoryColor,
  sessionLoreDegreeMap,
  sessionLoreNodeRadius,
} from "../../new_ui/js/session-lore-web.js";

const PALETTE = [
  { bg: "#111111", border: "#222222" },
  { bg: "#333333", border: "#444444" },
];

test("sessionLoreCategoryColor is deterministic for the same category", () => {
  const a = sessionLoreCategoryColor("Locations", PALETTE);
  const b = sessionLoreCategoryColor("Locations", PALETTE);
  assert.deepEqual(a, b);
});

test("sessionLoreCategoryColor picks a palette entry", () => {
  const result = sessionLoreCategoryColor("Factions", PALETTE);
  assert.ok(PALETTE.includes(result));
});

test("sessionLoreDegreeMap counts edges touching each entry", () => {
  const entries = [
    { id: "a", links: [{ target_id: "b", label: "" }] },
    { id: "b", links: [] },
    { id: "c", links: [] },
  ];
  const degree = sessionLoreDegreeMap(entries);
  assert.equal(degree.a, 1);
  assert.equal(degree.b, 1);
  assert.equal(degree.c, 0);
});

test("sessionLoreDegreeMap ignores edges to entries outside the set", () => {
  const entries = [
    { id: "a", links: [{ target_id: "missing", label: "" }] },
  ];
  const degree = sessionLoreDegreeMap(entries);
  assert.equal(degree.a, 0);
});

test("sessionLoreNodeRadius grows with degree and caps at 40", () => {
  assert.equal(sessionLoreNodeRadius(0), 18);
  assert.equal(sessionLoreNodeRadius(2), 26);
  assert.equal(sessionLoreNodeRadius(100), 40);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/new_ui/session-lore-web.test.js`
Expected: FAIL — `new_ui/js/session-lore-web.js` does not exist yet, import error.

- [ ] **Step 3: Write the minimal implementation**

`tests/new_ui/package.json` has `"type": "module"` — Node's test runner imports `.js` files as real ESM, which requires actual `export` bindings, not a `module.exports=` object (that CommonJS pattern does not satisfy an ESM named `import {...}` at all, and would fail even when the file exists). But `new_ui/index.html` loads every other script as a plain classic `<script src="...">` (no `type="module"`), and classic scripts throw a SyntaxError on any top-level `export` statement — so this file must be loaded differently from its siblings: as `<script type="module">` (handled in Task 4, Step 1). A module script can still be reached from classic scripts like `chat.js` by explicitly assigning to `window`, same as this file already needs to do for `SessionLoreWebView` itself.

Create `new_ui/js/session-lore-web.js`:

```js
"use strict";

export function sessionLoreCategoryColor(category, palette) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export function sessionLoreDegreeMap(entries) {
  const ids = new Set(entries.map((e) => e.id));
  const degree = {};
  entries.forEach((e) => { degree[e.id] = 0; });
  entries.forEach((e) => {
    (e.links || []).forEach((link) => {
      if (!ids.has(link.target_id)) return;
      degree[e.id] += 1;
      degree[link.target_id] += 1;
    });
  });
  return degree;
}

export function sessionLoreNodeRadius(degree) {
  return Math.min(40, 18 + degree * 4);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/new_ui/session-lore-web.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/session-lore-web.js tests/new_ui/session-lore-web.test.js
git commit -m "Add pure graph-data helpers for the session lore web view"
```

---

### Task 2: SessionLoreWebView class — dataset building and render

**Files:**
- Modify: `new_ui/js/session-lore-web.js`

**Interfaces:**
- Consumes: `sessionLoreCategoryColor`, `sessionLoreDegreeMap`, `sessionLoreNodeRadius` (Task 1). Global `vis` (vis-network, already loaded). Global `t()`, `_esc()`, `_attr()` (existing app-wide helpers, already used by `workshop-lore-web.js`).
- Produces: `class SessionLoreWebView` with:
  - `constructor(entries)` — `entries` is the array returned by `GET /sessions/{sid}/lore` (each with `id`, `name`, `category`, `content`, `player_edited`, `links`).
  - `mount(container: HTMLElement)` — renders into `container`.
  - Later tasks (3) add interaction on top of this.

- [ ] **Step 1: Add the class to `new_ui/js/session-lore-web.js`**

```js
class SessionLoreWebView {
  constructor(entries) {
    this.entries = entries || [];
    this.frozen = window.matchMedia("(max-width: 639px)").matches;
    this.network = null;
  }

  palette() {
    return [
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-primary-dark").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-secondary").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-secondary-dark").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-tertiary-light").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-tertiary-dark").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-cmd-purple").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-line-2").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-cmd-yellow").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-line-2").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-success").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-line-2").trim() },
    ];
  }

  categoryNodeId(cat) {
    return `cat:${cat}`;
  }

  buildDatasets() {
    const entries = this.entries;
    const degree = sessionLoreDegreeMap(entries);
    const palette = this.palette();
    const inkColor = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
    const warn = getComputedStyle(document.documentElement).getPropertyValue("--color-warn").trim();
    const sec = getComputedStyle(document.documentElement).getPropertyValue("--color-sec").trim();
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim();

    const nodes = [];
    const edges = [];
    const categoryIds = new Set();
    entries.forEach((e) => {
      const cat = e.category || "Uncategorized";
      const catId = this.categoryNodeId(cat);
      if (!categoryIds.has(catId)) {
        categoryIds.add(catId);
        const { bg, border } = sessionLoreCategoryColor(cat, palette);
        nodes.push({
          id: catId, label: cat, shape: "dot", size: 26,
          font: { color: inkColor, size: 12.5 },
          color: { background: bg, border, highlight: { background: bg, border: accent }, hover: { background: bg, border: accent } },
        });
      }
    });
    entries.forEach((e) => {
      const cat = e.category || "Uncategorized";
      const { bg, border } = sessionLoreCategoryColor(cat, palette);
      const radius = sessionLoreNodeRadius(degree[e.id] || 0);
      const nodeBorder = e.player_edited ? warn : border;
      nodes.push({
        id: e.id, label: e.name || cat, shape: "dot", value: radius,
        font: { color: inkColor },
        color: { background: bg, border: nodeBorder, highlight: { background: bg, border: accent }, hover: { background: bg, border: accent } },
        borderWidth: e.player_edited ? 3 : 2,
      });
      edges.push({ from: this.categoryNodeId(cat), to: e.id, color: { color: border, opacity: 0.9 }, width: 2 });
    });
    const visibleIds = new Set(entries.map((e) => e.id));
    entries.forEach((e) => {
      (e.links || []).forEach((link) => {
        if (!visibleIds.has(link.target_id)) return;
        edges.push({
          from: e.id, to: link.target_id,
          label: link.label || undefined,
          font: { color: sec, size: 10.5, strokeWidth: 3, strokeColor: paper, align: "top" },
          arrows: { to: { enabled: true, scaleFactor: 0.6 } },
          color: { color: sec, opacity: 0.9 },
          dashes: true, width: 2, smooth: { type: "curvedCW", roundness: 0.15 },
        });
      });
    });
    return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  }

  legendHtml() {
    const cats = [...new Set(this.entries.map((e) => e.category || "Uncategorized"))].sort();
    if (!cats.length) return "";
    const palette = this.palette();
    return `
      <div class="grimoire-web-legend">
        ${cats.map((cat) => {
          const { bg } = sessionLoreCategoryColor(cat, palette);
          return `<span class="grimoire-web-legend-item"><span class="grimoire-web-legend-dot" style="background:${_attr(bg)}"></span>${_esc(cat)}</span>`;
        }).join("")}
      </div>
    `;
  }

  mount(container) {
    this.container = container;
    this.render();
  }

  render() {
    if (!this.entries.length) {
      this.container.innerHTML = `<p style="color:var(--color-sec);font-size:13px;padding:6px 0 16px">${t("chat_nothing_revealed_yet")}</p>`;
      return;
    }
    this.container.innerHTML = `
      <div class="grimoire-web-controls">
        <button type="button" class="pe-gen-btn" id="slwReset" style="flex:1;justify-content:center">${t("grimoire_reset_view_button")}</button>
        <button type="button" class="pe-gen-btn" id="slwFreeze" style="flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}">${this.frozen ? t("grimoire_unfreeze_layout_button") : t("grimoire_freeze_layout_button")}</button>
      </div>
      ${this.legendHtml()}
      <div class="grimoire-web-stage">
        <div id="slwCanvas" class="grimoire-web-canvas"></div>
      </div>
      <p class="grimoire-web-hint">${t("grimoire_tap_node_to_read_hint")}</p>
      <div id="slwDetail" class="grimoire-web-detail" hidden></div>
    `;
    this.container.querySelector("#slwReset").onclick = () => {
      this.hideDetail();
      this.network?.fit();
    };
    this.container.querySelector("#slwFreeze").onclick = () => {
      this.frozen = !this.frozen;
      this.network?.setOptions({ physics: { enabled: !this.frozen } });
      const btn = this.container.querySelector("#slwFreeze");
      btn.textContent = this.frozen ? t("grimoire_unfreeze_layout_button") : t("grimoire_freeze_layout_button");
      btn.style.cssText = `flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}`;
    };
    const canvas = this.container.querySelector("#slwCanvas");
    const { nodes, edges } = this.buildDatasets();
    this.nodesDataSet = nodes;
    this.edgesDataSet = edges;
    this.network = new vis.Network(canvas, { nodes, edges }, {
      physics: {
        enabled: !this.frozen,
        solver: "forceAtlas2Based",
        forceAtlas2Based: { avoidOverlap: 1, springLength: 120, gravitationalConstant: -70 },
        stabilization: { enabled: true, iterations: 150, fit: true },
      },
      interaction: { hover: true, dragNodes: true, dragView: true, zoomView: true },
      nodes: { scaling: { min: 18, max: 40 }, font: { size: 14 } },
      edges: { smooth: { type: "continuous" } },
    });
    this.network.once("stabilizationIterationsDone", () => this.network.fit({ animation: false }));
    this.network.fit({ animation: false });
  }

  hideDetail() {
    const panel = this.container.querySelector("#slwDetail");
    if (panel) panel.hidden = true;
  }
}

if (typeof window !== "undefined") {
  window.SessionLoreWebView = SessionLoreWebView;
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node --check new_ui/js/session-lore-web.js`
Expected: no output (syntax OK). This only checks parse validity — `vis`/`window`/`t`/`_esc`/`_attr` are browser globals not available under plain Node, so this step cannot execute the class, only confirm it parses.

- [ ] **Step 3: Re-run Task 1's tests to confirm nothing broke**

Run: `node --test tests/new_ui/session-lore-web.test.js`
Expected: PASS, 5 tests (unchanged from Task 1 — this task only appended code, the pure functions are untouched).

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/session-lore-web.js
git commit -m "Add SessionLoreWebView: vis.js graph rendering for session lore"
```

---

### Task 3: Click-to-isolate, detail panel, edit integration

**Files:**
- Modify: `new_ui/js/session-lore-web.js`

**Interfaces:**
- Consumes: a callback the caller supplies for editing, since the edit UI (`openSessionLoreEditor`) lives in `chat.js` and this module must not reach into `ChatView` internals directly (keeps `session-lore-web.js` free of any dependency on `ChatView`).
- Produces: `SessionLoreWebView`'s constructor gains a third argument: `constructor(entries, onEdit)` where `onEdit(entry)` is called when the user clicks Edit in the detail panel. `mount`/`render` unchanged in signature.

- [ ] **Step 1: Update the constructor and wire the click handler**

In `new_ui/js/session-lore-web.js`, change the constructor:

```js
  constructor(entries, onEdit) {
    this.entries = entries || [];
    this.onEdit = onEdit;
    this.frozen = window.matchMedia("(max-width: 639px)").matches;
    this.network = null;
  }
```

Add this at the end of `render()`, right after `this.network.fit({ animation: false });`:

```js
    this.network.on("click", (params) => {
      if (!params.nodes.length) { this.hideDetail(); return; }
      const nodeId = params.nodes[0];
      const entry = this.entries.find((e) => e.id === nodeId);
      if (!entry) { this.hideDetail(); return; }
      if (nodeId === this.selectedNodeId) { this.hideDetail(); return; }
      const neighborhood = [nodeId, ...this.network.getConnectedNodes(nodeId)];
      this.isolateNeighborhood(neighborhood);
      this.network.fit({ nodes: neighborhood, animation: { duration: 400, easingFunction: "easeInOutQuad" } });
      this.selectedNodeId = nodeId;
      this.showDetail(entry);
    });
```

Add these methods to the class, after `render()`:

```js
  isolateNeighborhood(keepIds) {
    const keep = new Set(keepIds);
    this.nodesDataSet.get().forEach((n) => {
      this.nodesDataSet.update({ id: n.id, hidden: !keep.has(n.id) });
    });
    this.edgesDataSet.get().forEach((e) => {
      this.edgesDataSet.update({ id: e.id, hidden: !(keep.has(e.from) && keep.has(e.to)) });
    });
  }

  restoreAll() {
    if (!this.nodesDataSet) return;
    this.nodesDataSet.get().forEach((n) => { if (n.hidden) this.nodesDataSet.update({ id: n.id, hidden: false }); });
    this.edgesDataSet.get().forEach((e) => { if (e.hidden) this.edgesDataSet.update({ id: e.id, hidden: false }); });
  }

  showDetail(entry) {
    const panel = this.container.querySelector("#slwDetail");
    panel.innerHTML = `
      <div class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px">${_esc(entry.category || "Uncategorized")}${entry.player_edited ? ` &middot; ${t("chat_edited_badge")}` : ""}</div>
      <h3 class="font-display" style="margin:0 0 10px">${_esc(entry.name || t("chat_untitled_lore_entry"))}</h3>
      <p style="font-size:14px;color:var(--color-ink);line-height:1.6;white-space:pre-wrap">${_esc(entry.content)}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button type="button" class="pe-gen-btn" id="slwDetailEdit">${t("chat_edit")}</button>
      </div>
    `;
    panel.hidden = false;
    panel.querySelector("#slwDetailEdit").onclick = () => this.onEdit && this.onEdit(entry);
  }
```

Update `hideDetail()` to also restore hidden nodes/edges and clear selection:

```js
  hideDetail() {
    const panel = this.container.querySelector("#slwDetail");
    if (panel) panel.hidden = true;
    this.restoreAll();
    this.selectedNodeId = null;
    this.network?.unselectAll();
  }
```

- [ ] **Step 2: Verify syntax**

Run: `node --check new_ui/js/session-lore-web.js`
Expected: no output.

- [ ] **Step 3: Re-run Task 1's tests**

Run: `node --test tests/new_ui/session-lore-web.test.js`
Expected: PASS, 5 tests (unchanged).

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/session-lore-web.js
git commit -m "Add click-to-isolate and edit integration to SessionLoreWebView"
```

---

### Task 4: Wire into chat.js, load the script, remove the old stub, live verification

**Files:**
- Modify: `new_ui/js/chat.js`
- Modify: `new_ui/index.html`

**Interfaces:**
- Consumes: `window.SessionLoreWebView` (Task 3's finished class).
- Produces: `ChatView.renderSessionLoreWeb(body, entries)` now delegates to `SessionLoreWebView` instead of the old hand-rolled SVG circle.

This task has no new automated test — it is the wiring/integration point, verified by live manual check per the spec's own Testing section ("Verification is manual").

- [ ] **Step 1: Load the new script**

`new_ui/index.html` currently has this line (around line 340):

```html
  <script src="/js/chat.js" defer></script>
```

Add a new line immediately before it:

```html
  <script src="/js/session-lore-web.js" type="module"></script>
  <script src="/js/chat.js" defer></script>
```

This file must use `type="module"` (not the plain `defer` every other `new_ui/js/*.js` file uses) because Task 1 gave its pure functions real `export` statements — required for the Node test's ESM import, but only legal inside a module script. Module scripts are deferred automatically by the spec (they don't block parsing, same practical effect as `defer`), so no separate `defer` attribute is needed or valid alongside `type="module"` here. `chat.js` still works unchanged: it reaches the class via `window.SessionLoreWebView`, which Task 2/3 assign explicitly, and that assignment is visible on `window` regardless of the module boundary.

- [ ] **Step 2: Replace `chat.js`'s `renderSessionLoreWeb` method**

Find the current `renderSessionLoreWeb(body, entries)` method in `new_ui/js/chat.js` (added in the prior session as a quick SVG-circle stopgap) and replace its entire body with:

```js
  renderSessionLoreWeb(body, entries) {
    const view = new SessionLoreWebView(entries, (entry) => {
      this.openSessionLoreEditor(body, entries, entry.id);
    });
    view.mount(body);
  }
```

Remove the old SVG-circle-drawing code this replaces (the `size`/`cx`/`cy`/`ringR`/`nodeR`/`byId`/`edges` loop and the inline `<svg>` template it built) — confirm by reading the current method body in `new_ui/js/chat.js` before deleting, since exact line numbers may have shifted from other work done earlier in this session.

- [ ] **Step 3: Verify syntax**

Run: `node --check new_ui/js/chat.js`
Expected: no output.

- [ ] **Step 4: Live verification against the running app**

This repo is the live bind-mounted app (per CLAUDE.md) — no build step, no restart needed for `.js`/`.css` changes, just reload the page. Since `localhost:3000` is unreachable from this shell, verify via:

```bash
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 https://storyhavenai.sillysillysupersillydomain.win/api/health
curl -s https://storyhavenai.sillysillysupersillydomain.win/js/session-lore-web.js | grep -c "class SessionLoreWebView"
curl -s https://storyhavenai.sillysillysupersillydomain.win/js/chat.js | grep -c "SessionLoreWebView"
podman logs --tail 20 story-game 2>&1 | grep -i "error\|traceback"
```

Expected: health check returns `401` (server up, auth required is fine), both grep counts are `>= 1`, no new tracebacks in the log tail.

If browser access is available, additionally: open a chat whose character has lore entries with real `lore_links` relationships, open the header menu → View memory → Session Lore tab → Web view, confirm the graph renders with real edges (not the old radial-to-nothing lines), confirm tapping a node isolates its neighborhood and shows the detail panel, confirm Edit opens the existing session-override textarea editor, confirm a player-edited entry shows a distinct border color. Confirm the Memory tab (not Session Lore) no longer shows any List/Web toggle at all — state clearly if browser verification wasn't possible and only the curl/log checks above were run.

- [ ] **Step 5: Commit**

```bash
git add new_ui/index.html new_ui/js/chat.js
git commit -m "Wire SessionLoreWebView into the chat Session Lore tab, replacing the SVG-circle stopgap"
```

---

## Self-Review Notes

- **Spec coverage:** category coloring + real edges (Task 2), player-edited marker (Task 2's `nodeBorder`/badge), click-to-isolate + detail panel + edit integration (Task 3), mobile-first sizing (Task 2 reuses `.grimoire-web-canvas`/`.grimoire-web-controls` CSS as-is, freeze-by-default-on-mobile via `window.matchMedia` in the constructor), no char/global selector (never added — the class only ever takes one character's `entries`, no selector UI exists), no delete button (never added to `showDetail`), Memory tab list-only (already true from earlier work this session, Task 4 confirms it's still the case and doesn't touch it), wiring into the modal (Task 4).
- **Type consistency:** `SessionLoreWebView` constructor signature is introduced in Task 2 as `(entries)` and widened in Task 3 to `(entries, onEdit)` — Task 4's call site uses the final two-argument form, matching Task 3's produced interface, not Task 2's intermediate one.
- **No new CSS** — deliberately reuses `.grimoire-web-*` classes verbatim, per the spec's explicit instruction not to write new responsive rules.
