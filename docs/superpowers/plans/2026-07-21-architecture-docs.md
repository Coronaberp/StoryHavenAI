# Architecture Docs & API Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app, authenticated architecture-docs page (prose + Mermaid diagrams + live config numbers) and a Swagger API explorer, under a new `settings-docs` tab.

**Architecture:** New authenticated `GET /api/docs/live-config` read-only endpoint feeds the docs page live numbers. A `settings-docs.js` view holds hand-written prose + two Mermaid diagrams and links to a Swagger UI page pointed at the already-shipped authenticated `GET /api/openapi-schema`. mermaid + swagger-ui-dist are vendored (no CDN at runtime).

**Tech Stack:** FastAPI, vanilla-JS SPA, Mermaid, Swagger UI, pytest.

## Global Constraints

- Zero comments/docstrings in any file, ever (including Python `"""..."""`).
- Absolute imports (`from backend.x import y`).
- Every mutating endpoint logs via `from backend.state import log` — the endpoints here are read-only GETs, so no new logging required beyond what exists.
- UI copy via `t(key, fallback)`, PROSE_STYLE_GUARD (no em dashes, no semicolons, no AI-cliché phrasing).
- No hardcoded hex in new UI CSS; use `var(--color-*)`. (Swagger UI's own vendored CSS is exempt — it is used as-is, unmodified, per the spec's non-goals.)
- The new live-config endpoint exposes ONLY non-secret numeric constants — never `api_key`, URLs, or anything not already in `PUBLIC_CFG_KEYS`.
- Access: every logged-in user (regular/admin/dev) can view the docs + explorer. Gate on `get_current_user` (authenticated), not admin.
- Route naming follows the codebase convention `settings-docs` (hyphen), NOT `settings/docs`.
- Vendored files (mermaid, swagger-ui-dist) go in `new_ui/js/vendor/` with `<script>`/`<link>` tags in `new_ui/index.html`, matching the `gif-encoder.js` precedent.
- Commits authored as the user, NO Claude attribution.
- Verify against the live app at `https://storyhavenai.sillysillysupersillydomain.win` (localhost:3000 unreachable from shell). Backend `.py` edits auto-reload; a change to `server.py`'s app construction needs `podman restart story-game`.

## Status

- **Task 1 (security fix) is DONE** — committed `1ba5d72`: `server.py` app built with `docs_url=None, redoc_url=None, openapi_url=None`; authenticated `GET /api/openapi-schema` added; `backend/tests/test_server_docs.py` passing; live-verified `/openapi.json` now 404 and `/api/openapi-schema` 401-without-auth / real-schema-with-auth. Do NOT redo it.

## File structure

- Modify `backend/routers/misc.py` — add `GET /api/docs/live-config`.
- Create `backend/tests/test_docs_live_config.py`.
- Create `new_ui/js/vendor/mermaid.min.js`, `new_ui/js/vendor/swagger-ui-bundle.js`, `new_ui/js/vendor/swagger-ui.css` (vendored).
- Create `new_ui/js/settings-docs.js` — `DocsSettingsView` (prose + diagrams + live config) and `ApiExplorerView` (Swagger UI mount).
- Modify `new_ui/index.html` — vendor script/style tags + `settings-docs.js` tag.
- Modify `new_ui/js/router.js` — `settings-docs` and `settings-api` routes + `ROOT_FOR_ROUTE`.
- Modify `new_ui/js/settings.js` — a "Docs & API" settings row.
- Modify `new_ui/js/translations.js` — new `docs_*` keys.

---

### Task 2: Live-config endpoint

**Files:**
- Modify: `backend/routers/misc.py` (add the endpoint; confirm it imports `api`, `CFG`, and `get_current_user` — add imports if missing)
- Test: `backend/tests/test_docs_live_config.py`

**Interfaces:**
- Produces: `GET /api/docs/live-config` → a flat dict of non-secret numeric constants: `{memory_v2_budget_tokens, memory_batch_size, history_turns, top_k_memory, top_k_lore, mem_max_dist, lore_max_dist}`.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from backend.routers import misc as misc_router
pytestmark = pytest.mark.asyncio

_SECRET_SUBSTRINGS = ("key", "secret", "token", "password", "url", "base")


async def test_live_config_returns_whitelisted_numbers():
    cfg = await misc_router.docs_live_config(_user={"id": "u1", "username": "u", "is_admin": False})
    assert cfg["memory_v2_budget_tokens"] > 0
    assert cfg["memory_batch_size"] > 0
    assert all(isinstance(v, (int, float)) for v in cfg.values())


async def test_live_config_never_leaks_secretish_keys():
    cfg = await misc_router.docs_live_config(_user={"id": "u1", "username": "u", "is_admin": False})
    for key in cfg:
        assert not any(s in key.lower() for s in _SECRET_SUBSTRINGS), key
```

- [ ] **Step 2: Run to verify it fails**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_docs_live_config.py -q"`
Expected: FAIL (AttributeError: module has no attribute 'docs_live_config')

- [ ] **Step 3: Implement the endpoint**

At the top of `backend/routers/misc.py`, confirm these are imported (add any missing): `from backend.state import api, CFG` and `from backend.auth import get_current_user`, and `from fastapi import Depends`. Then add:

```python
@api.get("/docs/live-config")
async def docs_live_config(_user: dict = Depends(get_current_user)):
    from backend.memory_service import BATCH_SIZE
    return {
        "memory_v2_budget_tokens": int(CFG.get("memory_v2_budget_tokens") or 1000),
        "memory_batch_size": int(BATCH_SIZE),
        "history_turns": int(CFG.get("history_turns") or 16),
        "top_k_memory": int(CFG.get("top_k_memory") or 4),
        "top_k_lore": int(CFG.get("top_k_lore") or 6),
        "mem_max_dist": float(CFG.get("mem_max_dist") or 0.8),
        "lore_max_dist": float(CFG.get("lore_max_dist") or 0.8),
    }
```

Note: this is a fixed, explicit whitelist of numeric values. It does NOT iterate `CFG`, so no secret can leak by accident. The test enforces that no returned key looks secret-ish.

- [ ] **Step 4: Run to verify pass**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_docs_live_config.py -q"`
Expected: PASS (2 passed)

- [ ] **Step 5: Live-verify auth gate**

```bash
B=https://storyhavenai.sillysillysupersillydomain.win
echo "no-auth (expect 401): $(curl -s -o /dev/null -w '%{http_code}' $B/api/docs/live-config)"
J=$(mktemp); curl -s -c $J -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"username":"test","password":"11111111"}' -o /dev/null
curl -s -b $J $B/api/docs/live-config
```
Expected: 401 without auth; a JSON dict of numbers with auth.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/misc.py backend/tests/test_docs_live_config.py
git commit -m "Add authenticated read-only /api/docs/live-config exposing non-secret doc constants"
```

---

### Task 3: Vendor mermaid + swagger-ui-dist

**Files:**
- Create: `new_ui/js/vendor/mermaid.min.js`, `new_ui/js/vendor/swagger-ui-bundle.js`, `new_ui/js/vendor/swagger-ui.css`
- Modify: `new_ui/index.html` (vendor tags)

**Interfaces:**
- Produces: global `window.mermaid` and `window.SwaggerUIBundle` available to `settings-docs.js`.

- [ ] **Step 1: Download the vendored bundles**

```bash
cd /var/home/staygold/ai-frontend/new_ui/js/vendor
curl -fsSL https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js -o mermaid.min.js
curl -fsSL https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js -o swagger-ui-bundle.js
curl -fsSL https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css -o swagger-ui.css
ls -la mermaid.min.js swagger-ui-bundle.js swagger-ui.css
```
Expected: three non-empty files. If the shell has no outbound internet (curl fails), STOP and report BLOCKED — the human chose CDN vendoring; the alternative is they provide the files.

- [ ] **Step 2: Verify the bundles define their globals**

```bash
head -c 200 mermaid.min.js | grep -qi mermaid && echo "mermaid ok"
grep -qi "SwaggerUIBundle" swagger-ui-bundle.js && echo "swagger ok"
```
Expected: both print ok.

- [ ] **Step 3: Add tags to `new_ui/index.html`**

Near the existing `<script src="/js/vendor/gif-encoder.js" defer></script>` line, add:
```html
  <script src="/js/vendor/mermaid.min.js" defer></script>
  <script src="/js/vendor/swagger-ui-bundle.js" defer></script>
```
In the `<head>` (near other stylesheet links), add:
```html
  <link rel="stylesheet" href="/js/vendor/swagger-ui.css">
```

- [ ] **Step 4: Verify served**

```bash
B=https://storyhavenai.sillysillysupersillydomain.win
echo "mermaid: $(curl -s -o /dev/null -w '%{http_code}' $B/js/vendor/mermaid.min.js)"
echo "swagger js: $(curl -s -o /dev/null -w '%{http_code}' $B/js/vendor/swagger-ui-bundle.js)"
echo "swagger css: $(curl -s -o /dev/null -w '%{http_code}' $B/js/vendor/swagger-ui.css)"
```
Expected: all 200.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/vendor/mermaid.min.js new_ui/js/vendor/swagger-ui-bundle.js new_ui/js/vendor/swagger-ui.css new_ui/index.html
git commit -m "Vendor mermaid and swagger-ui-dist for the architecture docs and API explorer"
```

---

### Task 4: Architecture docs view + route + settings row

**Files:**
- Create: `new_ui/js/settings-docs.js` (`DocsSettingsView`)
- Modify: `new_ui/index.html` (script tag for settings-docs.js)
- Modify: `new_ui/js/router.js` (route + `ROOT_FOR_ROUTE`)
- Modify: `new_ui/js/settings.js` (docs settings row)
- Modify: `new_ui/js/translations.js` (docs_* keys)

**Interfaces:**
- Consumes: `GET /api/docs/live-config` (Task 2), `GET /api/feature-status` (existing), `window.mermaid` (Task 3), globals `api`, `navigate`, `t`, `_esc`, `ME`.
- Produces: `window.DocsSettingsView`; route `settings-docs` at `/settings-docs`.

- [ ] **Step 1: Create `new_ui/js/settings-docs.js`**

```javascript
"use strict";

const DOCS_MODULE_DIAGRAM = `flowchart TD
  Browser["Browser (SPA)"] --> Server["server.py (app assembly)"]
  Server --> Routers["backend/routers/* (one file per domain)"]
  Routers --> Repos["backend/repositories/* (DB access)"]
  Repos --> PG[("Postgres + pgvector")]
  Routers --> Chat["chat_service.py (SSE _run loop)"]
  Chat --> Memory["memory_service / lore_memory"]
  Memory --> PG`;

const DOCS_MEMORY_DIAGRAM = `flowchart LR
  Turn["Recent turn text"] --> Retrieve["retrieve: keyword + KNN lore"]
  Retrieve --> Candidates["fetch_lore_candidates + memory facts"]
  Candidates --> Rank["rank: decay-weighted retention"]
  Rank --> Pack["build_block: token budget"]
  Pack --> Prompt["build_system prompt"]`;

class DocsSettingsView {
  async mount(main) {
    this.main = main;
    this.render();
    try {
      this.cfg = await api("/api/docs/live-config");
    } catch { this.cfg = null; }
    try {
      this.features = await api("/api/feature-status");
    } catch { this.features = null; }
    this.render();
    this.renderDiagrams();
  }

  cfgLine(label, key, fallback) {
    const v = this.cfg && this.cfg[key] != null ? this.cfg[key] : fallback;
    return `<div class="docs-cfg-row"><span>${_esc(label)}</span><span class="font-mono">${_esc(String(v))}</span></div>`;
  }

  render() {
    this.main.innerHTML = `
      <div class="docs-wrap">
        <button type="button" class="settings-back" onclick="navigate('/settings')">${t("docs_back", "Settings")}</button>
        <h1 class="docs-title">${t("docs_title", "How StoryHaven works")}</h1>
        <p class="docs-intro">${t("docs_intro", "Curious how StoryHaven actually works under the hood? Start here. This is the same architecture the app itself runs on.")}</p>
        <div class="docs-diagram" id="docsModuleDiagram"></div>
        <div class="docs-diagram" id="docsMemoryDiagram"></div>
        <section class="docs-section">
          <h2>${t("docs_memory_heading", "Memory and lore")}</h2>
          <p>${t("docs_memory_body", "After each batch of settled exchanges the app extracts typed facts, reconciles them against what it already knows, then ranks everything by a decay-weighted score and packs it into a fixed token budget before the reply is written.")}</p>
          <div class="docs-cfg">
            ${this.cfgLine(t("docs_cfg_budget", "Memory token budget"), "memory_v2_budget_tokens", 1000)}
            ${this.cfgLine(t("docs_cfg_batch", "Extraction batch size"), "memory_batch_size", 5)}
            ${this.cfgLine(t("docs_cfg_history", "History turns"), "history_turns", 16)}
            ${this.cfgLine(t("docs_cfg_topk_mem", "Memory candidates (top k)"), "top_k_memory", 4)}
            ${this.cfgLine(t("docs_cfg_topk_lore", "Lore candidates (top k)"), "top_k_lore", 6)}
          </div>
        </section>
        <section class="docs-section">
          <h2>${t("docs_api_heading", "The API")}</h2>
          <p>${t("docs_api_body", "Want to see the raw API this app talks to? This is exactly what the frontend itself calls, and requests run as your own logged-in session.")}</p>
          <button type="button" class="pe-gen-btn" onclick="navigate('/settings-api')">${t("docs_open_explorer", "Open API explorer")}</button>
        </section>
      </div>`;
  }

  renderDiagrams() {
    if (typeof mermaid === "undefined") return;
    try {
      mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      const m = this.main.querySelector("#docsModuleDiagram");
      const mem = this.main.querySelector("#docsMemoryDiagram");
      mermaid.render("dgModule", DOCS_MODULE_DIAGRAM).then((r) => { if (m) m.innerHTML = r.svg; });
      mermaid.render("dgMemory", DOCS_MEMORY_DIAGRAM).then((r) => { if (mem) mem.innerHTML = r.svg; });
    } catch (err) { console.warn("mermaid render failed", err); }
  }
}

if (typeof window !== "undefined") window.DocsSettingsView = DocsSettingsView;
```

- [ ] **Step 2: Add minimal styles to `new_ui/css/cards.css`** (token-based; then run `./rebuild.sh --once` and commit app.css too)

```css
.docs-wrap { max-width: 760px; margin: 0 auto; padding: 20px 16px 60px; }
.docs-title { font-weight: 600; font-size: 22px; color: var(--color-ink); margin: 10px 0 6px; }
.docs-intro { color: var(--color-sec); font-size: 14px; margin-bottom: 18px; }
.docs-diagram { background: var(--color-surface-2); border: 1px solid var(--color-line-2); border-radius: 12px; padding: 14px; margin-bottom: 14px; overflow-x: auto; }
.docs-section { margin-top: 22px; }
.docs-section h2 { font-weight: 600; font-size: 16px; color: var(--color-ink); margin-bottom: 6px; }
.docs-section p { color: var(--color-sec); font-size: 13.5px; line-height: 1.5; }
.docs-cfg { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.docs-cfg-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--color-ink); border-bottom: 1px solid var(--color-line); padding-bottom: 4px; }
.docs-cfg-row .font-mono { color: var(--color-accent); }
```

- [ ] **Step 3: Register the route in `new_ui/js/router.js`**

In the `routes` object (near the other `settings-*` entries around line 51-55):
```javascript
  "settings-docs": (main) => { new DocsSettingsView().mount(main); },
```
In `ROOT_FOR_ROUTE` (near line 163-167 where the other settings routes map to `"dossier"`):
```javascript
  "settings-docs": "dossier",
```

- [ ] **Step 4: Add the settings row in `new_ui/js/settings.js`**

Near the other `settingsRowHtml(...)` rows (around line 106, after the account row):
```javascript
      ${settingsRowHtml({ icon: svgIcon("info"), label: t("settings_row_docs", "Docs & API"), sublabel: t("settings_row_docs_sub", "How StoryHaven works, and the raw API"), onclick: "navigate('/settings-docs')" })}
```
If `svgIcon("info")` does not exist, use an icon key that does (check `svgIcon`'s known keys; `"help"`/`"book"` are candidates — grep `function svgIcon` and pick an existing key).

- [ ] **Step 5: Add the script tag in `new_ui/index.html`**

After the other settings view script tags (grep for `settings-account.js`):
```html
  <script src="/js/settings-docs.js" defer></script>
```

- [ ] **Step 6: Add translation keys to `new_ui/js/translations.js`**

Add near other settings keys: `docs_back`, `docs_title`, `docs_intro`, `docs_memory_heading`, `docs_memory_body`, `docs_cfg_budget`, `docs_cfg_batch`, `docs_cfg_history`, `docs_cfg_topk_mem`, `docs_cfg_topk_lore`, `docs_api_heading`, `docs_api_body`, `docs_open_explorer`, `settings_row_docs`, `settings_row_docs_sub` — each with the English default used verbatim in the `t()` calls above.

- [ ] **Step 7: Rebuild CSS + verify live**

Run `./rebuild.sh --once`. Then Playwright (cookie-injection auth pattern: log in via curl, extract the `sh_access` cookie, `ctx.add_cookies`, load `/explore`, wait for `ME`, then `navigate('/settings-docs')`): assert both `#docsModuleDiagram svg` and `#docsMemoryDiagram svg` render, the config rows show numbers, and there are zero `pageerror`s. Confirm `curl .../js/settings-docs.js | grep -c DocsSettingsView` >= 1.

- [ ] **Step 8: Commit**

```bash
git add new_ui/js/settings-docs.js new_ui/index.html new_ui/js/router.js new_ui/js/settings.js new_ui/js/translations.js new_ui/css/cards.css new_ui/css/app.css
git commit -m "Add architecture docs settings page with Mermaid diagrams and live config numbers"
```

---

### Task 5: API explorer (Swagger UI) page

**Files:**
- Modify: `new_ui/js/settings-docs.js` (add `ApiExplorerView`)
- Modify: `new_ui/js/router.js` (`settings-api` route + `ROOT_FOR_ROUTE`)

**Interfaces:**
- Consumes: `window.SwaggerUIBundle` (Task 3), `GET /api/openapi-schema` (Task 1).
- Produces: `window.ApiExplorerView`; route `settings-api` at `/settings-api`.

- [ ] **Step 1: Add `ApiExplorerView` to `new_ui/js/settings-docs.js`**

```javascript
class ApiExplorerView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `
      <div style="max-width:960px;margin:0 auto;padding:16px">
        <button type="button" class="settings-back" onclick="navigate('/settings-docs')">${t("docs_back_docs", "Docs")}</button>
        <p class="docs-intro">${t("docs_api_intro", "This is exactly what the frontend itself calls. Try it out runs as your own logged-in session with your real permissions.")}</p>
        <div id="swaggerRoot"></div>
      </div>`;
    if (typeof SwaggerUIBundle === "undefined") {
      main.querySelector("#swaggerRoot").innerHTML = `<p style="color:var(--color-warn)">${t("docs_api_unavailable", "The API explorer could not load.")}</p>`;
      return;
    }
    let schema;
    try { schema = await api("/api/openapi-schema"); }
    catch (err) {
      main.querySelector("#swaggerRoot").innerHTML = `<p style="color:var(--color-warn)">${_esc(err.message || t("docs_api_unavailable", "The API explorer could not load."))}</p>`;
      return;
    }
    SwaggerUIBundle({
      spec: schema,
      domNode: main.querySelector("#swaggerRoot"),
      requestInterceptor: (req) => { req.credentials = "include"; return req; },
    });
  }
}

if (typeof window !== "undefined") window.ApiExplorerView = ApiExplorerView;
```

Note: `requestInterceptor` sets `credentials: "include"` so Swagger's "try it out" carries the browser's session cookie — requests run as the real logged-in user (spec section 6). The schema is fetched from the authenticated endpoint and passed as `spec` (not `url`), so Swagger never tries to hit a public `/openapi.json`.

- [ ] **Step 2: Register the route in `new_ui/js/router.js`**

```javascript
  "settings-api": (main) => { new ApiExplorerView().mount(main); },
```
And in `ROOT_FOR_ROUTE`:
```javascript
  "settings-api": "dossier",
```

- [ ] **Step 3: Add the two new translation keys** (`docs_back_docs`, `docs_api_intro`, `docs_api_unavailable`) to `new_ui/js/translations.js` with their English defaults.

- [ ] **Step 4: Verify live**

Playwright (cookie-injection auth): `navigate('/settings-api')`, wait, assert the Swagger UI rendered (a `.swagger-ui` element exists and at least one operation block appears), zero pageerrors. Then verify the real-permission behavior: as the `test` (non-admin) account, expand an admin-only endpoint (e.g. one under `/admin/...`), click "Try it out" + "Execute", and confirm the response is a real `403` (not a hidden control). Report the observed status.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/settings-docs.js new_ui/js/router.js new_ui/js/translations.js
git commit -m "Add Swagger API explorer page pointed at the authenticated schema endpoint"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full backend group of new tests + a regression sweep**

Run: `podman exec story-game sh -c "cd /app/ai-frontend && ./venv/bin/python -m pytest backend/tests/test_server_docs.py backend/tests/test_docs_live_config.py -q"`
Expected: all pass.

- [ ] **Step 2: Re-confirm the security posture still holds**

```bash
B=https://storyhavenai.sillysillysupersillydomain.win
echo "/openapi.json (expect 404): $(curl -s -o /dev/null -w '%{http_code}' $B/openapi.json)"
echo "/api/openapi-schema no-auth (expect 401): $(curl -s -o /dev/null -w '%{http_code}' $B/api/openapi-schema)"
echo "/api/docs/live-config no-auth (expect 401): $(curl -s -o /dev/null -w '%{http_code}' $B/api/docs/live-config)"
```
Expected: 404, 401, 401.

- [ ] **Step 3: Live end-to-end as a non-admin** — log in as `test`, open `/settings` → "Docs & API" → confirm the docs page (diagrams + numbers) and the API explorer both render, and an admin-only "try it out" returns a real 403.

---

## Self-review notes

- **Spec coverage:** section 1 security fix (DONE, Task 1); section 2 access model (auth-gated via `get_current_user`, real-session execution via Swagger `requestInterceptor` credentials include — Task 5); section 3 location (`settings-docs` route + settings row — Task 4); section 4 docs content + live-config (Tasks 2, 4); section 5 diagrams (mermaid vendored Task 3, rendered Task 4); section 6 explorer (Swagger vendored Task 3, page Task 5); section 7 idiot-proof intros (copy in Tasks 4/5); non-goals respected (no permission changes, hand-written prose, Swagger used as-is, live-config whitelist only). All mapped.
- **Verify-before-use:** Task 4 Step 4 notes confirming `svgIcon("info")` exists (pick an existing icon key otherwise); Task 2 Step 3 notes confirming misc.py imports.
- **Vendoring dependency:** Task 3 requires outbound internet (the human chose CDN vendoring). If curl fails, that task is BLOCKED pending the human providing the files — Tasks 2 and the prose of Task 4 do not depend on it and can land first.
