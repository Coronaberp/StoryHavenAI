# Grimoire Web View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, undirected relationship between lore entries and a mobile-first vis.js graph view of a lorebook, toggled alongside the existing flat list on the Grimoire page.

**Architecture:** A new `lore_links` join table + `backend/repositories/lore_links.py` backs a single new endpoint (`PUT /api/lore/{lid}/links`); `linked_ids` is added to the existing lore-listing responses. The frontend gains a "Linked entries" picker in the existing edit modal, a List/Web toggle on the Grimoire page, and a new `GrimoireWebView` class (`new_ui/js/grimoire-web.js`) that renders a vis.js Network from the same data the list already fetches.

**Tech Stack:** FastAPI + SQLAlchemy Core (async, Postgres) on the backend; vanilla JS + vis.js (CDN, standalone UMD bundle) on the frontend. No build step.

## Global Constraints

- Zero comments in any file — code must be self-documenting (see project CLAUDE.md Coding style).
- Never hardcode a hex color outside `themes.css` — any custom styling must use the existing CSS custom properties (`var(--color-accent)`, etc.) so it re-themes correctly.
- New DB columns/tables are added by editing `backend/db.py`'s `Table` definitions; they're created automatically via `metadata.create_all(checkfirst=True)` at startup — no manual migration script needed.
- Every mutating endpoint gets a `log.info` on success; every caught exception that doesn't re-raise gets `log.warning`/`log.error` — via `from backend.state import log`.
- Absolute imports only inside `backend/` (`from backend.x import y`), never bare `import x`.
- Mobile-first: dropdowns/buttons stack full-width (≥44px tall targets) below the mobile breakpoint; the graph canvas uses a fixed aspect ratio, not viewport-height-locked.
- This is a live app (`/var/home/staygold/ai-frontend` is the running container's bind mount) — edit files directly, never in a worktree. Backend `.py` edits hot-reload; `new_ui/js`/`new_ui/css` edits are picked up on next page load (no-cache headers).
- Verify against `https://storyhavenai.sillysillysupersillydomain.win` — plain `localhost:3000` is not reachable from this shell.

---

### Task 1: `lore_links` table + repository

**Files:**
- Modify: `backend/db.py` (add table definition near the existing `lore` table, ~line 176)
- Create: `backend/repositories/lore_links.py`
- Test: `backend/tests/test_lore_links_repo.py`

**Interfaces:**
- Produces (used by Task 2 and Task 4):
  - `async def link(a: str, b: str) -> None`
  - `async def unlink(a: str, b: str) -> None`
  - `async def links_for(lore_id: str) -> list[str]`
  - `async def links_for_many(lore_ids: list[str]) -> dict[str, list[str]]`
  - `async def delete_all_for(lore_id: str) -> None`
  - `async def set_links(lore_id: str, target_ids: list[str]) -> None`

- [ ] **Step 1: Add the `lore_links` table to `backend/db.py`**

Insert right after the closing `)` of the `lore` table definition (currently ending at line 176, right before `sessions = sa.Table(...)`):

```python
lore_links = sa.Table(
    "lore_links", _meta,
    sa.Column("id", sa.Text, primary_key=True),
    sa.Column("lore_id_a", sa.Text, nullable=False),
    sa.Column("lore_id_b", sa.Text, nullable=False),
    sa.Column("created", sa.Float, nullable=False),
    sa.UniqueConstraint("lore_id_a", "lore_id_b", name="uq_lore_link_pair"),
    sa.CheckConstraint("lore_id_a != lore_id_b", name="ck_lore_link_no_self"),
)
```

Then find the existing `sa.Index("idx_lore_char", lore.c.char_id)` line (around line 604) and add two more indexes right after it:

```python
sa.Index("idx_lore_links_a", lore_links.c.lore_id_a)
sa.Index("idx_lore_links_b", lore_links.c.lore_id_b)
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_lore_links_repo.py`:

```python
import pytest

from backend.repositories import lore, lore_links

pytestmark = pytest.mark.asyncio


async def _make_lore(db_conn, name):
    return await lore.create(None, [], "content", always=False, name=name)


async def test_link_and_links_for(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.link(a, b)
    assert await lore_links.links_for(a) == [b]
    assert await lore_links.links_for(b) == [a]


async def test_link_is_idempotent(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.link(a, b)
    await lore_links.link(a, b)
    assert await lore_links.links_for(a) == [b]


async def test_link_reversed_order_is_same_pair(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.link(a, b)
    await lore_links.link(b, a)
    assert await lore_links.links_for(a) == [b]


async def test_link_self_raises(db_conn):
    a = await _make_lore(db_conn, "a")
    with pytest.raises(Exception):
        await lore_links.link(a, a)


async def test_unlink(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.link(a, b)
    await lore_links.unlink(a, b)
    assert await lore_links.links_for(a) == []


async def test_unlink_missing_is_noop(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    await lore_links.unlink(a, b)
    assert await lore_links.links_for(a) == []


async def test_delete_all_for(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.link(a, b)
    await lore_links.link(a, c)
    await lore_links.delete_all_for(a)
    assert await lore_links.links_for(a) == []
    assert await lore_links.links_for(b) == []
    assert await lore_links.links_for(c) == []


async def test_links_for_many(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.link(a, b)
    result = await lore_links.links_for_many([a, b, c])
    assert result[a] == [b]
    assert result[b] == [a]
    assert result[c] == []


async def test_set_links_adds_and_removes(db_conn):
    a = await _make_lore(db_conn, "a")
    b = await _make_lore(db_conn, "b")
    c = await _make_lore(db_conn, "c")
    await lore_links.link(a, b)
    await lore_links.set_links(a, [c])
    assert await lore_links.links_for(a) == [c]
    assert await lore_links.links_for(b) == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/test_lore_links_repo.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.repositories.lore_links'`

- [ ] **Step 4: Implement `backend/repositories/lore_links.py`**

```python
"""Lore-link repository — undirected relationships between two lore entries,
encapsulating pair normalization so a link can never be stored both ways."""
import time

from sqlalchemy import select, insert, delete as sa_delete, or_, and_

from backend.db import lore_links, nid, _q, _w
from backend.state import log


def _ordered(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


async def link(a: str, b: str) -> None:
    lo, hi = _ordered(a, b)
    existing = await _q(select(lore_links).where(
        and_(lore_links.c.lore_id_a == lo, lore_links.c.lore_id_b == hi)))
    if existing:
        return
    await _w(insert(lore_links).values(id=nid("ll"), lore_id_a=lo, lore_id_b=hi, created=time.time()))
    log.info("lore_links: linked a=%s b=%s", lo, hi)


async def unlink(a: str, b: str) -> None:
    lo, hi = _ordered(a, b)
    await _w(sa_delete(lore_links).where(
        and_(lore_links.c.lore_id_a == lo, lore_links.c.lore_id_b == hi)))
    log.info("lore_links: unlinked a=%s b=%s", lo, hi)


async def links_for(lore_id: str) -> list[str]:
    rows = await _q(select(lore_links).where(
        or_(lore_links.c.lore_id_a == lore_id, lore_links.c.lore_id_b == lore_id)))
    return [r.lore_id_b if r.lore_id_a == lore_id else r.lore_id_a for r in rows]


async def links_for_many(lore_ids: list[str]) -> dict[str, list[str]]:
    result = {lid: [] for lid in lore_ids}
    if not lore_ids:
        return result
    id_set = set(lore_ids)
    rows = await _q(select(lore_links).where(
        or_(lore_links.c.lore_id_a.in_(lore_ids), lore_links.c.lore_id_b.in_(lore_ids))))
    for r in rows:
        if r.lore_id_a in id_set:
            result[r.lore_id_a].append(r.lore_id_b)
        if r.lore_id_b in id_set:
            result[r.lore_id_b].append(r.lore_id_a)
    return result


async def delete_all_for(lore_id: str) -> None:
    await _w(sa_delete(lore_links).where(
        or_(lore_links.c.lore_id_a == lore_id, lore_links.c.lore_id_b == lore_id)))
    log.info("lore_links: deleted all links for id=%s", lore_id)


async def set_links(lore_id: str, target_ids: list[str]) -> None:
    current = set(await links_for(lore_id))
    target = set(target_ids)
    for tid in target - current:
        await link(lore_id, tid)
    for tid in current - target:
        await unlink(lore_id, tid)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/test_lore_links_repo.py -v`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/db.py backend/repositories/lore_links.py backend/tests/test_lore_links_repo.py
git commit -m "Add lore_links table and repository for lore entry relationships"
```

---

### Task 2: Wire link cleanup into lore deletion

**Files:**
- Modify: `backend/repositories/lore.py:delete` (around line 91)
- Test: `backend/tests/test_lore_repo.py` (append)

**Interfaces:**
- Consumes: `lore_links.delete_all_for(lore_id: str) -> None` (Task 1)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_lore_repo.py`:

```python
from backend.repositories import lore_links


async def test_delete_cleans_up_links(db_conn):
    a = await lore.create(None, [], "a-content", always=False, name="a")
    b = await lore.create(None, [], "b-content", always=False, name="b")
    await lore_links.link(a, b)
    await lore.delete(a)
    assert await lore_links.links_for(b) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/test_lore_repo.py::test_delete_cleans_up_links -v`
Expected: FAIL — `links_for(b)` still returns `[a]` since `lore.delete` doesn't clean up links yet.

- [ ] **Step 3: Update `backend/repositories/lore.py`**

Add the import at the top of the file:

```python
from backend.repositories import lore_links
```

Change the existing `delete` function:

```python
async def delete(lid: str) -> None:
    await lore_links.delete_all_for(lid)
    await _w(sa_delete(lore).where(lore.c.id == lid))
    log.info("lore: deleted id=%s", lid)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/test_lore_repo.py::test_delete_cleans_up_links -v`
Expected: PASS

- [ ] **Step 5: Run the full lore test suite to check for regressions**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/test_lore_repo.py backend/tests/test_lore_links_repo.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend/repositories/lore.py backend/tests/test_lore_repo.py
git commit -m "Clean up lore_links rows when a lore entry is deleted"
```

---

### Task 3: `PUT /api/lore/{lid}/links` endpoint + `linked_ids` in listings

**Files:**
- Modify: `backend/schemas.py` (add `LoreLinksIn` near `LorePersonaToggleIn`, ~line 69)
- Modify: `backend/routers/lore.py` (add endpoint; extend `list_my_lore` and `list_lore`)
- Test: `backend/tests/test_lore_repo.py` is repository-level only — endpoint-level behavior is covered by the router test file if one exists; check first.

**Interfaces:**
- Consumes: `lore_links.set_links`, `lore_links.links_for_many` (Task 1)
- Produces: `PUT /api/lore/{lid}/links` → `{"id": lid, "link_ids": [...]}`; `linked_ids: list[str]` field added to every entry returned by `GET /api/lore/mine` and `GET /characters/{cid}/lore`.

- [ ] **Step 1: Check for an existing router-level test file**

Run: `ls backend/tests/ | grep -i lore`
If a `test_lore_router.py` or similar exists, add tests there following its existing pattern (import its fixtures/helpers for an authenticated test client). If none exists, skip automated endpoint tests for this task — verify manually via curl in Step 4, consistent with how the rest of `backend/routers/lore.py` (an unauthenticated smoke path aside) is currently tested only at the repository layer.

- [ ] **Step 2: Add `LoreLinksIn` to `backend/schemas.py`**

Insert right after `LorePersonaToggleIn` (around line 71):

```python
class LoreLinksIn(BaseModel):
    link_ids: list[str] = []
```

- [ ] **Step 3: Add the endpoint and extend listings in `backend/routers/lore.py`**

Add the import:

```python
from backend.repositories import lore_links
from backend.schemas import LoreIn, LorePersonaToggleIn, LoreLinksIn
```

Replace the `list_my_lore` handler:

```python
@api.get("/lore/mine")
async def list_my_lore(current_user: dict = Depends(get_current_user)):
    entries = await lore.list_mine(current_user["id"])
    links = await lore_links.links_for_many([e["id"] for e in entries])
    for e in entries:
        e["linked_ids"] = links.get(e["id"], [])
    return entries
```

Replace the `list_lore` handler:

```python
@api.get("/characters/{cid}/lore")
async def list_lore(cid: str, current_user: dict | None = Depends(get_current_user_optional)):
    c = await db.get_character(cid)
    if not c:
        raise HTTPException(404, "character not found")
    is_owner = bool(current_user) and c.get("owner_id") == current_user["id"]
    if not c.get("is_public") and not is_owner:
        raise HTTPException(404, "character not found")
    entries = await lore.list_for_character(cid)
    links = await lore_links.links_for_many([e["id"] for e in entries])
    for e in entries:
        e["linked_ids"] = links.get(e["id"], [])
        if not is_owner:
            e["content"] = "" if e["hidden"] else e["content"]
            e["appearance_tags"] = ""
            e["appearance_tags_negative"] = ""
    return entries
```

Add the new endpoint at the end of the file:

```python
@api.put("/lore/{lid}/links")
async def set_lore_links(lid: str, body: LoreLinksIn, current_user: dict = Depends(get_current_user)):
    entry = await lore.get(lid)
    if not entry:
        raise HTTPException(404, "lore entry not found")
    if entry.get("char_id"):
        c = await db.get_character(entry["char_id"])
        if not current_user["is_admin"] and (not c or c.get("owner_id") != current_user["id"]):
            raise HTTPException(403, "Not authorized")
    elif not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    target_ids = [t for t in body.link_ids if t != lid]
    await lore_links.set_links(lid, target_ids)
    log.info("lore: links set id=%s count=%s by=%s", lid, len(target_ids), current_user["username"])
    return {"id": lid, "link_ids": target_ids}
```

Note the `if not is_owner: e["content"] = "" if e["hidden"] else e["content"]` line above preserves the exact original conditional logic (`if e["hidden"]: e["content"] = ""`) just restructured to fit alongside the new `linked_ids` assignment in the same loop — behavior is unchanged.

- [ ] **Step 4: Manual verification**

The container hot-reloads `.py` changes. Log in as `test:11111111`, then from this shell:

```bash
curl -s -c /tmp/ck.txt -X POST https://storyhavenai.sillysillysupersillydomain.win/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"test","password":"11111111"}' | head -c 200
curl -s -b /tmp/ck.txt https://storyhavenai.sillysillysupersillydomain.win/api/lore/mine | head -c 400
```

Expected: entries include a `"linked_ids": []` field. Pick two real entry ids from that output (`ID_A`, `ID_B`) and:

```bash
curl -s -b /tmp/ck.txt -X PUT https://storyhavenai.sillysillysupersillydomain.win/api/lore/ID_A/links \
  -H "Content-Type: application/json" -d '{"link_ids":["ID_B"]}'
curl -s -b /tmp/ck.txt https://storyhavenai.sillysillysupersillydomain.win/api/lore/mine | grep -o "\"id\":\"ID_A\"[^}]*linked_ids\":\[[^]]*\]" || true
```

Expected: the PUT returns `{"id":"ID_A","link_ids":["ID_B"]}`, and `ID_A`'s `linked_ids` in the subsequent listing includes `ID_B`. Clean up by setting links back to `[]` on `ID_A` when done, and remove `/tmp/ck.txt`.

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/ -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend/schemas.py backend/routers/lore.py
git commit -m "Add lore link-set endpoint and linked_ids field to lore listings"
```

---

### Task 4: "Linked entries" picker in the lore edit modal

**Files:**
- Modify: `new_ui/js/grimoire.js` (`_grimoireEditModal`, lines 328–481)

**Interfaces:**
- Consumes: `entry.linked_ids: string[]` (from Task 3's API response), `api(path, opts)` (existing global helper), `_esc`/`_attr` (existing global helpers).
- Produces: on save, calls `PUT /api/lore/{lid}/links` with the picked set — no new exported functions, this is a self-contained modal change.

`_grimoireEditModal(charId, entry, onSave)` needs the full list of candidate link targets (every other entry in the same lorebook). The modal currently only receives `entry` and `charId`, not the full entry list. It's called from two places in `GrimoireView`: `openEntry` (line 582) and `openAddFlow` (line 734). Both have access to `this.entries`.

- [ ] **Step 1: Change `_grimoireEditModal`'s signature to accept candidate entries**

In `new_ui/js/grimoire.js`, change the function signature (line 328):

```javascript
function _grimoireEditModal(charId, entry, allEntries, onSave) {
```

- [ ] **Step 2: Update both call sites**

In `GrimoireView.openEntry` (around line 582):

```javascript
onEdit: () => _grimoireEditModal(entry.char_id, entry, this.entries, () => this.mount(this.main)),
```

In `GrimoireView.openAddFlow` (around line 734):

```javascript
_grimoireEditModal(charId, null, this.entries, () => this.mount(this.main));
```

- [ ] **Step 3: Add link candidate state and the picker markup**

Inside `_grimoireEditModal`, right after the existing `let curImage = e.image || "";` line (330), add:

```javascript
  const candidates = (allEntries || []).filter((c) =>
    c.id !== (entry ? entry.id : null) && (c.char_id === charId || c.char_id === null));
  let linkedIds = new Set(entry ? (entry.linked_ids || []) : []);
```

Insert a new field block right after the Keys field block (after the `</div>` that closes the `gKeys` block, before the Content field block, i.e. right before the existing `<div style="margin-bottom:16px"><label class="grimoire-field-label">Content</label>` block):

```javascript
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">Linked entries</label>
      <div id="gLinkPills" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
      <input type="text" id="gLinkSearch" class="grimoire-field-input" placeholder="Search entries to link…" autocomplete="off">
      <div id="gLinkSuggest" class="dropdown-menu" style="position:relative;left:0;right:0;top:4px"></div>
    </div>
```

- [ ] **Step 4: Wire the picker's rendering and interaction**

After the existing `wireClear();` call (line 430), add:

```javascript
  const renderLinkPills = () => {
    const pillsEl = layer.querySelector("#gLinkPills");
    pillsEl.innerHTML = [...linkedIds].map((id) => {
      const c = candidates.find((x) => x.id === id);
      const label = c ? _grimoireEntryTitle(c) : "Unknown entry";
      return `<span class="inline-pill pill-tag">${_esc(label)}<span class="x" data-unlink="${_attr(id)}">&times;</span></span>`;
    }).join("");
    pillsEl.querySelectorAll("[data-unlink]").forEach((x) => {
      x.onclick = () => { linkedIds.delete(x.dataset.unlink); renderLinkPills(); };
    });
  };
  const linkSearch = layer.querySelector("#gLinkSearch");
  const linkSuggest = layer.querySelector("#gLinkSuggest");
  linkSearch.oninput = () => {
    const q = linkSearch.value.trim().toLowerCase();
    const matches = candidates.filter((c) => !linkedIds.has(c.id) &&
      (!q || _grimoireEntryTitle(c).toLowerCase().includes(q))).slice(0, 8);
    if (!matches.length) { linkSuggest.classList.remove("open"); linkSuggest.innerHTML = ""; return; }
    linkSuggest.innerHTML = matches.map((c) =>
      `<button type="button" class="dropdown-item" data-pick-link="${_attr(c.id)}">${_esc(_grimoireEntryTitle(c))}</button>`).join("");
    linkSuggest.classList.add("open");
    linkSuggest.querySelectorAll("[data-pick-link]").forEach((btn) => btn.onclick = () => {
      linkedIds.add(btn.dataset.pickLink);
      linkSearch.value = "";
      linkSuggest.classList.remove("open");
      linkSuggest.innerHTML = "";
      renderLinkPills();
    });
  };
  renderLinkPills();
```

- [ ] **Step 5: Save links after the entry itself saves**

In the `gSave` handler (around line 445–480), right after the existing `try { ... } catch (err) { ... return; }` block that creates/updates the entry and sets `lid`, and right after the existing `usable_as_persona` sync block, add:

```javascript
    try {
      await api(`/api/lore/${encodeURIComponent(lid)}/links`, { method: "PUT", body: JSON.stringify({ link_ids: [...linkedIds] }) });
    } catch (err) {
      errorToast(err.message || "Couldn't save linked entries.");
      return;
    }
```

This goes inside the same `try` block as the existing save calls (before the outer `catch`), so a failure here surfaces the same way a failed entry save already does — nothing is silently dropped.

- [ ] **Step 6: Manual verification**

Open `https://storyhavenai.sillysillysupersillydomain.win`, log in as `test:11111111`, navigate to My Grimoire. Edit an existing entry (or create two entries first if none exist), confirm:
- The "Linked entries" search shows other entries by name, not the entry being edited itself.
- Picking one adds a pill; the `×` on a pill removes it.
- Saving, then reopening the edit modal, shows the same pills restored (proves the round trip through `PUT /lore/{lid}/links` and the `linked_ids` field on `GET /api/lore/mine` both work).

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/grimoire.js
git commit -m "Add linked-entries picker to the lore edit modal"
```

---

### Task 5: List/Web toggle on the Grimoire page

**Files:**
- Modify: `new_ui/js/grimoire.js` (`GrimoireView` class: constructor, `render`)

**Interfaces:**
- Produces: `this.mode: "list" | "web"` on `GrimoireView`, read by Task 6's `GrimoireWebView` mount call.

- [ ] **Step 1: Add mode state**

In `GrimoireView`'s constructor (around line 520), add:

```javascript
    this.mode = "list";
```

- [ ] **Step 2: Add the toggle control and branch rendering**

In `GrimoireView.render()` (around line 655), change the header row to include the toggle. Replace:

```javascript
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")}</div>
        <button type="button" class="grimoire-add-btn" id="grimoireAddBtn" aria-label="Add lore entry">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
```

with:

```javascript
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")}</div>
        <button type="button" class="grimoire-add-btn" id="grimoireAddBtn" aria-label="Add lore entry">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;width:fit-content;margin-bottom:16px">
        <button type="button" class="filter-chip${this.mode === "list" ? " on" : ""}" id="grimoireModeList">List</button>
        <button type="button" class="filter-chip${this.mode === "web" ? " on" : ""}" id="grimoireModeWeb">Web</button>
      </div>
```

Then change the body so `mode === "web"` mounts `GrimoireWebView` instead of the list markup. Replace:

```javascript
      ${this.entries && this.entries.length ? `
        <div id="grimoireSearchBox" style="position:relative;margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
          ${this.keyFilters.map((k) => `
            <span class="inline-pill pill-tag">#${_esc(k)}<span class="x" data-remove-key="${_attr(k)}">&times;</span></span>
          `).join("")}
          <input type="text" id="grimoireSearch" value="${_attr(this.q)}" placeholder="${this.keyFilters.length ? "" : "Search, #key…"}"
            style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
          <div id="grimoireSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
        </div>
      ` : ""}
      ${this.bodyHtml()}
      </div>
    `;
```

with:

```javascript
      ${this.mode === "list" ? `
        ${this.entries && this.entries.length ? `
          <div id="grimoireSearchBox" style="position:relative;margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
            ${this.keyFilters.map((k) => `
              <span class="inline-pill pill-tag">#${_esc(k)}<span class="x" data-remove-key="${_attr(k)}">&times;</span></span>
            `).join("")}
            <input type="text" id="grimoireSearch" value="${_attr(this.q)}" placeholder="${this.keyFilters.length ? "" : "Search, #key…"}"
              style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
            <div id="grimoireSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
          </div>
        ` : ""}
        ${this.bodyHtml()}
      ` : `<div id="grimoireWebMount"></div>`}
      </div>
    `;
```

At the end of `render()`, after the existing `if (search) { ... }` block, add:

```javascript
    const modeListBtn = this.main.querySelector("#grimoireModeList");
    const modeWebBtn = this.main.querySelector("#grimoireModeWeb");
    if (modeListBtn) modeListBtn.onclick = () => { this.mode = "list"; this.render(); };
    if (modeWebBtn) modeWebBtn.onclick = () => { this.mode = "web"; this.render(); };
    const webMount = this.main.querySelector("#grimoireWebMount");
    if (webMount && this.entries !== null) {
      const webView = new GrimoireWebView(this.entries, this.chars);
      webView.mount(webMount);
    }
```

- [ ] **Step 3: Manual verification**

Reload My Grimoire. Confirm the List/Web segmented control appears, defaults to List (unchanged current behavior), and clicking Web shows an empty `#grimoireWebMount` div (the actual graph is built in Task 6 — a blank area here is expected and correct for this task alone). Clicking back to List still works exactly as before.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/grimoire.js
git commit -m "Add List/Web toggle to the Grimoire page"
```

---

### Task 6: Load vis.js

**Files:**
- Modify: `new_ui/index.html`

**Interfaces:**
- Produces: global `vis.Network`, `vis.DataSet` (vis.js's own globals), available to Task 7.

- [ ] **Step 1: Add the CDN script tag**

In `new_ui/index.html`, add this line to the `<head>` block, alongside the other CDN scripts (after the existing `Chart.js` line, ~line 24):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js" integrity="sha384-yxKDWWf0wwdUj/gPeuL11czrnKFQROnLgY8ll7En9NYoXibgg3C6NK/UDHNtUgWJ" crossorigin="anonymous" defer></script>
```

- [ ] **Step 2: Add the new script tag for the view file**

Add right after the existing `<script src="/js/grimoire.js" defer></script>` line (~292):

```html
  <script src="/js/grimoire-web.js" defer></script>
```

- [ ] **Step 3: Manual verification**

Run:

```bash
curl -sI https://storyhavenai.sillysillysupersillydomain.win/ | head -5
curl -s https://storyhavenai.sillysillysupersillydomain.win/ | grep -c vis-network
```

Expected: `HTTP/2 200`, and the grep count is `1` (the script tag is present in the served HTML).

- [ ] **Step 4: Commit**

```bash
git add new_ui/index.html
git commit -m "Load vis.js for the Grimoire web view"
```

---

### Task 7: `GrimoireWebView` graph rendering

**Files:**
- Create: `new_ui/js/grimoire-web.js`
- Modify: `new_ui/css/cards.css` (append graph-specific styles)

**Interfaces:**
- Consumes: `entries: array` (each with `id`, `name`, `keys`, `category`, `char_id`, `linked_ids`), `chars: {[id]: object}` — the exact shape `GrimoireView.entries`/`GrimoireView.chars` already hold (Task 5 passes these in).
- Consumes: global `vis.Network`, `vis.DataSet` (Task 6), `_grimoireEntryTitle`, `_grimoireViewModal`, `customSelectHtml`, `wireCustomSelect`, `_esc`, `_attr` (existing globals from `grimoire.js`/`dropdown.js`).
- Produces: `class GrimoireWebView { constructor(entries, chars); mount(container); }` — no other file depends on internals beyond this.

- [ ] **Step 1: Write `new_ui/js/grimoire-web.js`**

```javascript
"use strict";

class GrimoireWebView {
  constructor(entries, chars) {
    this.entries = entries || [];
    this.chars = chars || {};
    this.selectedCharId = Object.keys(this.chars)[0] || "";
    this.categoryFilter = "";
    this.frozen = false;
    this.network = null;
  }

  visibleEntries() {
    return this.entries.filter((e) => {
      if (e.char_id !== null && e.char_id !== this.selectedCharId) return false;
      if (this.categoryFilter && (e.category || "Uncategorized") !== this.categoryFilter) return false;
      return true;
    });
  }

  categoryOptions() {
    const cats = [...new Set(this.visibleEntriesUnfiltered().map((e) => e.category || "Uncategorized"))].sort();
    return [{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c, label: c }))];
  }

  visibleEntriesUnfiltered() {
    return this.entries.filter((e) => e.char_id === null || e.char_id === this.selectedCharId);
  }

  degreeMap(visible) {
    const ids = new Set(visible.map((e) => e.id));
    const degree = {};
    visible.forEach((e) => { degree[e.id] = 0; });
    visible.forEach((e) => {
      (e.linked_ids || []).forEach((lid) => {
        if (ids.has(lid)) degree[e.id] += 1;
      });
    });
    return degree;
  }

  nodeRadius(degree) {
    const base = 18;
    const max = 40;
    return Math.min(max, base + degree * 4);
  }

  resolvedColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  buildDatasets() {
    const visible = this.visibleEntries();
    const degree = this.degreeMap(visible);
    const accent = this.resolvedColor("--color-accent");
    const accentDeep = this.resolvedColor("--color-accent-deep");
    const primary = this.resolvedColor("--color-primary");
    const lineColor = this.resolvedColor("--color-line-2");
    const inkColor = this.resolvedColor("--color-ink");
    const nodes = visible.map((e) => ({
      id: e.id,
      label: _grimoireEntryTitle(e),
      value: this.nodeRadius(degree[e.id] || 0),
      shape: "dot",
      color: {
        background: e.char_id === null ? accent : primary,
        border: e.char_id === null ? accentDeep : lineColor,
      },
      font: { color: inkColor },
    }));
    const visibleIds = new Set(visible.map((e) => e.id));
    const edgeSeen = new Set();
    const edges = [];
    visible.forEach((e) => {
      (e.linked_ids || []).forEach((lid) => {
        if (!visibleIds.has(lid)) return;
        const key = [e.id, lid].sort().join(":");
        if (edgeSeen.has(key)) return;
        edgeSeen.add(key);
        edges.push({ from: e.id, to: lid, color: { color: lineColor } });
      });
    });
    return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  }

  mount(container) {
    this.container = container;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="grimoire-web-controls">
        <div style="flex:1;min-width:0">${customSelectHtml("gwCharSelect", Object.values(this.chars).map((c) => ({ value: c.id, label: c.name })), this.selectedCharId)}</div>
        <div style="flex:1;min-width:0">${customSelectHtml("gwCategorySelect", this.categoryOptions(), this.categoryFilter)}</div>
      </div>
      <div class="grimoire-web-controls">
        <button type="button" class="pe-gen-btn" id="gwReset" style="flex:1;justify-content:center">Reset view</button>
        <button type="button" class="pe-gen-btn" id="gwFreeze" style="flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}">${this.frozen ? "Unfreeze layout" : "Freeze layout"}</button>
      </div>
      <div id="gwCanvas" class="grimoire-web-canvas"></div>
      <p class="grimoire-web-hint">Tap any node to read it — the web zooms to just that entry and its links.</p>
    `;
    if (!Object.keys(this.chars).length) {
      this.container.innerHTML = `<p style="color:var(--color-sec);font-size:13px">Create a character first — lore belongs to a character's lorebook.</p>`;
      return;
    }
    wireCustomSelect("gwCharSelect", (v) => { this.selectedCharId = v; this.categoryFilter = ""; this.render(); });
    wireCustomSelect("gwCategorySelect", (v) => { this.categoryFilter = v; this.render(); });
    this.container.querySelector("#gwReset").onclick = () => this.network?.fit();
    this.container.querySelector("#gwFreeze").onclick = () => {
      this.frozen = !this.frozen;
      this.network?.setOptions({ physics: { enabled: !this.frozen } });
      this.render();
    };
    const canvas = this.container.querySelector("#gwCanvas");
    const { nodes, edges } = this.buildDatasets();
    this.network = new vis.Network(canvas, { nodes, edges }, {
      physics: { enabled: !this.frozen, solver: "forceAtlas2Based" },
      interaction: { hover: true, dragNodes: true, zoomView: true },
      nodes: { scaling: { min: 18, max: 40 } },
    });
    this.network.on("click", (params) => {
      if (!params.nodes.length) return;
      const entry = this.entries.find((e) => e.id === params.nodes[0]);
      if (!entry) return;
      const charName = this.chars[entry.char_id]?.name || "Global";
      _grimoireViewModal(entry, charName, {
        onEdit: () => _grimoireEditModal(entry.char_id, entry, this.entries, () => {
          window._activeGrimoireView?.mount(window._activeGrimoireView.main);
        }),
        onDelete: async () => {
          try {
            await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
            toast("Deleted.");
            window._activeGrimoireView?.mount(window._activeGrimoireView.main);
          } catch (err) {
            errorToast(err.message || "Couldn't delete that entry.");
          }
        },
      });
    });
  }
}
```

- [ ] **Step 2: Add graph-specific CSS**

Append to `new_ui/css/cards.css`:

```css
.grimoire-web-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}
@media (max-width: 640px) {
  .grimoire-web-controls { flex-direction: column; }
}
.grimoire-web-canvas {
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
}
@media (min-width: 640px) {
  .grimoire-web-canvas { aspect-ratio: 16 / 10; }
}
.grimoire-web-hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--color-muted);
  text-align: center;
}
```

- [ ] **Step 3: Manual verification**

Open My Grimoire on `https://storyhavenai.sillysillysupersillydomain.win`, switch to Web. Confirm:
- The character dropdown and category dropdown render and are full-width stacked on a narrow (mobile-width) browser window, side-by-side on a wide one.
- Nodes appear for the selected character's entries plus global entries; entries linked in Task 4 show a connecting line between them.
- Dragging a node moves it; "Freeze layout" stops the layout from re-settling; "Reset view" re-fits the graph in the canvas.
- Tapping/clicking a node opens the same detail modal the List view uses, and Edit/Delete from there work.
- Switching the character dropdown changes which character-owned nodes appear while global nodes stay present.
- Switching the category dropdown filters nodes down to that category only.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/grimoire-web.js new_ui/css/cards.css
git commit -m "Add GrimoireWebView vis.js graph rendering"
```

---

### Task 8: Final regression pass

**Files:** None modified — verification only.

- [ ] **Step 1: Run the full backend test suite**

Run: `podman exec story-game venv/bin/python3 -m pytest backend/tests/ -v`
Expected: All PASS, no regressions from earlier tasks.

- [ ] **Step 2: Full manual walkthrough on the live app**

On `https://storyhavenai.sillysillysupersillydomain.win`, logged in as `test:11111111`:
1. My Grimoire → List view unchanged (search, key-filter pills, category grouping all still work).
2. Edit an entry → add two links via the new picker → save → reopen → links persisted.
3. Switch to Web → confirm nodes/edges match what was just linked.
4. Delete one of the two linked entries from the Web view's detail modal → confirm the graph refreshes without the deleted node, and re-editing the surviving entry shows it no longer linked to the deleted one (proves Task 2's cascade cleanup).
5. Resize the browser window narrow (mobile width) and confirm controls stack and remain usable.

- [ ] **Step 3: Check server logs for unexpected errors**

Run: `podman exec story-game venv/bin/python3 -c "import json; [print(json.loads(l).get('message','')) for l in open('/app/ai-frontend/storyhavenai.logs.jsonl') if 'lore' in l.lower()]" 2>/dev/null | tail -30`

Expected: only the `lore:`/`lore_links:` `log.info` lines from the actions taken during manual testing — no `log.error`/`log.warning` entries related to this feature.
