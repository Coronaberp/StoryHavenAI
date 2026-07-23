# My Grimoire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the My Grimoire screen (`/sanctum/grimoire`) in `new_ui/` — a codex of every lore entry across the user's characters, grouped by category, with full add/view/edit/delete and deep-link auto-open — replacing the current placeholder.

**Architecture:** One new frontend file, `new_ui/js/grimoire.js`, holding `class GrimoireView` (list state + rendering, following the existing `SanctumView`/`ParlanceView` mount/render shape) plus three free-function modal builders (character picker, view modal, edit modal) that hold no state of their own. No backend changes — `GET /api/lore/mine`, `GET /api/characters?scope=mine`, and the existing lore CRUD routes (`POST /characters/{cid}/lore`, `PUT /lore/{lid}`, `DELETE /lore/{lid}`) already cover everything this screen needs.

**Tech Stack:** Vanilla JS classes + Tailwind utility classes + hand-written CSS in `cards.css` (frontend, no build step, no framework, matching every other `new_ui/` screen).

## Global Constraints

- Zero comments in any file, ever — no exceptions (per `CLAUDE.md` coding style).
- No hardcoded hex colors outside `themes.css` — every color in new markup/CSS must reference a `var(--color-*)` custom property.
- `new_ui/` has no JS test runner or test files anywhere — frontend verification in this plan is manual, against the human's already-running `./rebuild.sh --watch` dev server on `:3001`, per `CLAUDE.md`. Never spin up a second dev server instance for this.
- Never use `EnterWorktree`/`git worktree` for this repo — edit `/var/home/staygold/ai-frontend` directly (bind-mounted into the live container).
- This is a live, shared checkout — other agents may be editing the same files concurrently. Re-read a file immediately before editing it if there's any chance it changed since last read. Commit only the files each task actually touches.
- Stateless logic (the three modal builders) stays as plain functions, not classes — only `GrimoireView` itself owns real state (per `CLAUDE.md`'s OOP rule).

---

### Task 1: `GrimoireView` — list, category grouping, empty state

**Files:**
- Create: `new_ui/js/grimoire.js`
- Modify: `new_ui/index.html` (script tag)
- Modify: `new_ui/js/router.js` (wire the real view in)

**Interfaces:**
- Consumes: `pageHeaderHtml(nav, subnav, title, subtitle)` (`new_ui/js/router.js`), `api(path, opts)` (`new_ui/js/app-session.js`), `navigate(path)` (`new_ui/js/router.js`), `_NAV_MENU_ICONS` (`new_ui/js/nav-menus.js`, for the specimen row's corner icon — reuse the `grimoire` key already defined there).
- Produces: `class GrimoireView` with `constructor()` and `async mount(main)`, matching `SanctumView`'s shape exactly. Registered in `routes["sanctum-grimoire"]`. This task renders the list read-only (no add/view/edit/delete yet — those are Tasks 2-4) so it's independently testable before the interactive pieces exist.

- [ ] **Step 1: Create `new_ui/js/grimoire.js` with the list view**

```javascript
"use strict";

function _grimoireEntryTitle(entry) {
  return entry.name || (entry.keys && entry.keys[0]) || "Untitled entry";
}

class GrimoireView {
  constructor() {
    this.entries = null;
    this.chars = {};
  }

  async mount(main) {
    this.main = main;
    this.render();
    const [entries, chars] = await Promise.all([
      api("/api/lore/mine").catch(() => []),
      api("/api/characters?scope=mine").catch(() => []),
    ]);
    this.entries = entries;
    chars.forEach((c) => { this.chars[c.id] = c; });
    this.render();
  }

  groupedByCategory() {
    const groups = new Map();
    for (const entry of this.entries) {
      const key = (entry.category || "").trim() || "Uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const sections = [...groups.entries()].filter(([key]) => key !== "Uncategorized");
    sections.sort((a, b) => b[1].length - a[1].length);
    if (groups.has("Uncategorized")) sections.push(["Uncategorized", groups.get("Uncategorized")]);
    return sections;
  }

  rowHtml(entry) {
    const title = _grimoireEntryTitle(entry);
    const initial = title[0].toUpperCase();
    const art = entry.image
      ? `background-image:url('${entry.image}')`
      : `background:var(--color-surface-2)`;
    const charName = this.chars[entry.char_id]?.name || "Unknown character";
    return `
      <div class="sanctum-feed-row" data-lore-id="${entry.id}" data-char-id="${entry.char_id}">
        <span class="sanctum-specimen" style="${art}">
          ${entry.image ? "" : initial}
          <span class="sanctum-specimen-tab">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_NAV_MENU_ICONS.grimoire}</svg>
          </span>
        </span>
        <div class="sanctum-feed-body">
          <span class="sanctum-feed-title">${title}</span>
          <span class="grimoire-tag">${charName}</span>
        </div>
      </div>
    `;
  }

  bodyHtml() {
    if (this.entries === null) {
      return `<p style="color:var(--color-sec);font-size:13px">Opening the grimoire…</p>`;
    }
    if (!this.entries.length) {
      return `
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">Nothing recorded yet.</p>
          <p class="sanctum-empty-sub">Lore entries you write for your characters will show up here.</p>
        </div>
      `;
    }
    return this.groupedByCategory().map(([category, entries]) => `
      <div class="sanctum-feed-header">${category}</div>
      <div class="sanctum-feed">${entries.map((e) => this.rowHtml(e)).join("")}</div>
    `).join("");
  }

  render() {
    this.main.innerHTML = `
      ${pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")}
      ${this.bodyHtml()}
    `;
  }
}
```

- [ ] **Step 2: Register the script tag**

In `new_ui/index.html`, add after the `sanctum.js` line:

```html
  <script src="/js/sanctum.js" defer></script>
  <script src="/js/grimoire.js" defer></script>
```

- [ ] **Step 3: Wire the real view into the router**

In `new_ui/js/router.js`, replace:

```javascript
  "sanctum-grimoire": (main) => renderPlaceholder(main, "Sanctum", "Lore", "My Grimoire",
    "The lore entries that shape your worlds."),
```

with:

```javascript
  "sanctum-grimoire": (main) => new GrimoireView().mount(main),
```

- [ ] **Step 4: Manually verify against `:3001`**

```bash
curl -s http://localhost:3001/js/grimoire.js -o /dev/null -w "%{http_code}\n"
curl -s http://localhost:3001/js/router.js | grep -c "new GrimoireView"
```

Expected: `200`, then a non-zero count. In a browser at `http://localhost:3001/sanctum/grimoire` (logged in as `test`/`11111111`), confirm the header reads "Sanctum · Lore" / "My Grimoire", and either category-grouped rows or the "Nothing recorded yet." empty state render depending on whether that account has any lore yet (it likely doesn't — this is expected, verify the empty state specifically shows correctly).

- [ ] **Step 5: Commit**

```bash
git status --short new_ui/js/grimoire.js new_ui/index.html new_ui/js/router.js
git add new_ui/js/grimoire.js new_ui/index.html new_ui/js/router.js
git commit -m "Add My Grimoire list view: category-grouped lore entries"
```

---

### Task 2: Grimoire CSS — section headers, rows, tag, add button

**Files:**
- Modify: `new_ui/css/cards.css`

**Interfaces:**
- Consumes: existing `.sanctum-feed-header`, `.sanctum-feed`, `.sanctum-feed-row`, `.sanctum-specimen`, `.sanctum-specimen-tab`, `.sanctum-feed-body`, `.sanctum-feed-title` (already defined, reused as-is by Task 1's `rowHtml`/`bodyHtml` — no changes needed to those). Theme custom properties from `new_ui/css/themes.css` (`--color-accent`, `--color-accent-deep`, `--color-ink`, `--color-sec`, `--color-muted`, `--color-surface`, `--color-surface-2`, `--color-line`, `--color-line-2`, `--color-paper-base`, `--color-warn`, `--font-display`, `--font-mono`).
- Produces: `.grimoire-tag` (referenced by Task 1's `rowHtml`), `.grimoire-add-btn`, `.grimoire-picker-row` (referenced by Task 3), `.grimoire-field-label`, `.grimoire-field-input`, `.grimoire-field-textarea`, `.grimoire-toggle-row`, `.grimoire-img-box` (referenced by Task 4).

- [ ] **Step 1: Append the CSS block**

Re-read the current tail of `new_ui/css/cards.css` first (other agents may have appended more since this plan was written), then append:

```css
.grimoire-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-muted);
}
.grimoire-add-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  display: grid;
  place-items: center;
  color: var(--color-paper-base);
  background: linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));
  cursor: pointer;
  flex: none;
}
.grimoire-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 10px;
  cursor: pointer;
}
.grimoire-picker-row:hover { background: var(--color-surface-2); }
.grimoire-field-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.grimoire-field-input {
  width: 100%;
  padding: 8px 0 8px 2px;
  background: transparent;
  color: var(--color-ink);
  font-size: 14px;
  outline: none;
  border: none;
  border-bottom: 1.5px solid var(--color-line-2);
}
.grimoire-field-input:focus { border-bottom-color: var(--color-accent); }
.grimoire-field-textarea {
  width: 100%;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--color-line-2);
  background: var(--color-surface-2);
  color: var(--color-ink);
  font-size: 14px;
  outline: none;
  resize: vertical;
}
.grimoire-field-textarea:focus { border-color: var(--color-accent); }
.grimoire-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 2px;
}
.grimoire-img-box {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  border: 1.5px dashed var(--color-line-2);
  background: var(--color-surface-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  position: relative;
  flex: none;
  overflow: hidden;
}
.grimoire-img-box img { width: 100%; height: 100%; object-fit: cover; }
.grimoire-img-clear {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .6);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
```

- [ ] **Step 2: Verify the stylesheet loads with the new classes**

```bash
curl -s http://localhost:3001/css/cards.css | grep -c "grimoire-tag\|grimoire-add-btn\|grimoire-field-input\|grimoire-img-box"
```

Expected: a non-zero count.

- [ ] **Step 3: Commit**

```bash
git status --short new_ui/css/cards.css
git add new_ui/css/cards.css
git commit -m "Add Grimoire CSS: category header reuse, tag, add button, form fields, image box"
```

---

### Task 3: Add flow — character picker modal

**Files:**
- Modify: `new_ui/js/grimoire.js`

**Interfaces:**
- Consumes: `openModal(innerHtml, opts)` / `closeModal(layer)` (`new_ui/js/modal.js`), `api` (as above), `this.chars` (populated by Task 1's `mount`, a `{id: character}` map already fetched from `GET /api/characters?scope=mine` — this task's picker reuses that same fetched data, no second request).
- Produces: `_grimoireCharacterPickerModal(chars, onPick)` — a free function taking an array of character objects and a callback invoked with the chosen character's `id`. Called by the header "+" button and the empty-state CTA (both added in this task). Task 4's edit-modal flow is the thing `onPick` calls into.

- [ ] **Step 1: Add the picker function**

In `new_ui/js/grimoire.js`, add after `_grimoireEntryTitle`:

```javascript
function _grimoireCharacterPickerModal(chars, onPick) {
  if (!chars.length) {
    const layer = openModal(`
      <h3>Pick a character</h3>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-sec)">Lore entries belong to a character. Create one first, then come back to add lore.</p>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button type="button" class="pe-gen-btn" id="grimoireNoCharsGo">Create a character &rarr;</button>
      </div>
    `);
    layer.querySelector("#grimoireNoCharsGo").onclick = () => { closeModal(layer); navigate("/sanctum/create"); };
    return;
  }
  const layer = openModal(`
    <h3>Pick a character</h3>
    <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">Which character does this lore belong to?</p>
    <div style="display:flex;flex-direction:column;gap:2px">
      ${chars.map((c) => `
        <div class="grimoire-picker-row" data-char-id="${c.id}">
          <span class="sanctum-specimen" style="${c.avatar ? `background-image:url('${c.avatar}')` : "background:var(--color-surface-2)"}">${c.avatar ? "" : c.name[0].toUpperCase()}</span>
          <span class="font-display" style="font-size:14px;color:var(--color-ink)">${c.name}</span>
        </div>
      `).join("")}
    </div>
  `);
  layer.querySelectorAll(".grimoire-picker-row").forEach((row) => {
    row.onclick = () => { closeModal(layer); onPick(row.dataset.charId); };
  });
}
```

- [ ] **Step 2: Wire the "+" button and empty-state CTA into the header/body**

In `new_ui/js/grimoire.js`, replace the `bodyHtml()` empty-state block:

```javascript
    if (!this.entries.length) {
      return `
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">Nothing recorded yet.</p>
          <p class="sanctum-empty-sub">Lore entries you write for your characters will show up here.</p>
        </div>
      `;
    }
```

with:

```javascript
    if (!this.entries.length) {
      return `
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">Nothing recorded yet.</p>
          <p class="sanctum-empty-sub">Lore entries you write for your characters will show up here.</p>
          <button type="button" class="sanctum-empty-cta" style="border:none;background:none;cursor:pointer" id="grimoireEmptyAdd">Add your first entry &rarr;</button>
        </div>
      `;
    }
```

Replace `render()`:

```javascript
  render() {
    this.main.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml("Sanctum", "Lore", "My Grimoire", "The lore entries that shape your worlds.")}</div>
        <button type="button" class="grimoire-add-btn" id="grimoireAddBtn" aria-label="Add lore entry">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${this.bodyHtml()}
    `;
    const addBtn = this.main.querySelector("#grimoireAddBtn");
    if (addBtn) addBtn.onclick = () => this.openAddFlow();
    const emptyAdd = this.main.querySelector("#grimoireEmptyAdd");
    if (emptyAdd) emptyAdd.onclick = () => this.openAddFlow();
  }

  openAddFlow() {
    _grimoireCharacterPickerModal(Object.values(this.chars), (charId) => {
      toast("Entry editor comes in the next task.");
    });
  }
```

(The `toast(...)` placeholder inside `openAddFlow` is intentionally temporary — Task 4 replaces it with the real call into the edit modal. Leaving it as an inert stub keeps this task's diff testable on its own: the picker opens and closes correctly, its callback fires with the right `charId`, without depending on code that doesn't exist yet.)

- [ ] **Step 3: Manually verify against `:3001`**

At `http://localhost:3001/sanctum/grimoire`, tap the "+" button in the header. If the `test` account has zero characters, confirm the "no characters" variant shows and its CTA navigates to `/sanctum/create`. If it has characters, confirm each renders as a row with avatar/initial + name, and tapping one closes the modal and shows the "Entry editor comes in the next task." toast.

If the `test` account currently has zero characters, create one first via the existing character creation flow (or check via `curl -s -b cookies.txt http://localhost:3001/api/characters?scope=mine` — reuse the login cookie pattern from earlier verification steps in this project) so both picker variants can be exercised. Note in the task report which variant(s) were actually verified live.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/js/grimoire.js
git add new_ui/js/grimoire.js
git commit -m "Add character-picker modal for the Grimoire add flow"
```

---

### Task 4: Edit form modal — create and update

**Files:**
- Modify: `new_ui/js/grimoire.js`

**Interfaces:**
- Consumes: `api`, `openModal`/`closeModal`, `toast`/`errorToast` (`new_ui/js/toast.js`), `this.mount`/`this.render` (to refresh the list after a successful save).
- Produces: `_grimoireEditModal(charId, entry, onSave)` — `entry` is `null` for create, an existing entry object for edit. `onSave` is called with no arguments after a successful save (the caller re-fetches). Called from `GrimoireView.openAddFlow` (replacing Task 3's placeholder toast) and from Task 5's view modal's Edit button.

- [ ] **Step 1: Add the edit modal function**

In `new_ui/js/grimoire.js`, add after `_grimoireCharacterPickerModal`:

```javascript
function _grimoireEditModal(charId, entry, onSave) {
  const e = entry || { content: "", keys: [], always: false, hidden: false, category: "", name: "", image: "" };
  let curImage = e.image || "";
  const layer = openModal(`
    <h3>${entry ? "Edit Entry" : "New Entry"}</h3>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">Name</label>
      <input type="text" id="gName" class="grimoire-field-input" value="${e.name || ""}" placeholder="e.g. Maeve">
    </div>
    <div style="margin-bottom:16px;display:flex;gap:14px;align-items:flex-start">
      <div class="grimoire-img-box" id="gImgBox">
        ${curImage ? `<img id="gImgPreview" src="${curImage}" alt=""><span class="grimoire-img-clear" id="gImgClear">&times;</span>`
          : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`}
      </div>
      <input type="file" id="gImgFile" accept="image/png,image/jpeg,image/webp" hidden>
      <button type="button" class="pe-gen-btn" id="gImgGen">Generate</button>
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">Category</label>
      <input type="text" id="gCategory" class="grimoire-field-input" value="${e.category || ""}" placeholder="e.g. Character, Location, Item">
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">Keys</label>
      <input type="text" id="gKeys" class="grimoire-field-input" value="${(e.keys || []).join(", ")}" placeholder="e.g. the King, royal palace">
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">Content</label>
      <textarea id="gContent" class="grimoire-field-textarea" rows="5">${e.content || ""}</textarea>
    </div>
    <div class="grimoire-toggle-row">
      <span style="font-size:14px;color:var(--color-ink)">Always included</span>
      <input type="checkbox" id="gAlways" ${e.always ? "checked" : ""}>
    </div>
    <div class="grimoire-toggle-row">
      <span style="font-size:14px;color:var(--color-ink)">Hidden from replies</span>
      <input type="checkbox" id="gHidden" ${e.hidden ? "checked" : ""}>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      <button type="button" class="pe-gen-btn" id="gCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">Cancel</button>
      <button type="button" class="pe-gen-btn" id="gSave">Save</button>
    </div>
  `);
  layer.querySelector("#gCancel").onclick = () => closeModal(layer);
  layer.querySelector("#gImgGen").onclick = () => toast("My Forge isn't built yet — image generation will work once it exists.");
  layer.querySelector("#gImgBox").onclick = (ev) => {
    if (ev.target.closest("#gImgClear")) return;
    layer.querySelector("#gImgFile").click();
  };
  const wireClear = () => {
    const btn = layer.querySelector("#gImgClear");
    if (btn) btn.onclick = (ev) => {
      ev.stopPropagation();
      curImage = "";
      layer.querySelector("#gImgBox").innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    };
  };
  wireClear();
  layer.querySelector("#gImgFile").onchange = async () => {
    const file = layer.querySelector("#gImgFile").files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      const r = await api(`/api/characters/${encodeURIComponent(charId)}/media`, { method: "POST", body: fd });
      curImage = r.url;
      layer.querySelector("#gImgBox").innerHTML = `<img id="gImgPreview" src="${curImage}" alt=""><span class="grimoire-img-clear" id="gImgClear">&times;</span>`;
      wireClear();
    } catch (err) {
      errorToast(err.message || "Upload failed.");
    }
  };
  layer.querySelector("#gSave").onclick = async () => {
    const content = layer.querySelector("#gContent").value.trim();
    if (!content) { toast("Content required."); return; }
    const body = {
      content,
      keys: layer.querySelector("#gKeys").value,
      always: layer.querySelector("#gAlways").checked,
      hidden: layer.querySelector("#gHidden").checked,
      image: curImage,
      category: layer.querySelector("#gCategory").value.trim(),
      name: layer.querySelector("#gName").value.trim(),
    };
    try {
      if (entry) await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else await api(`/api/characters/${encodeURIComponent(charId)}/lore`, { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      errorToast(err.message || "Save failed.");
      return;
    }
    closeModal(layer);
    toast("Saved.");
    onSave();
  };
}
```

- [ ] **Step 2: Wire it into the add flow**

In `new_ui/js/grimoire.js`, replace `GrimoireView.openAddFlow`:

```javascript
  openAddFlow() {
    _grimoireCharacterPickerModal(Object.values(this.chars), (charId) => {
      toast("Entry editor comes in the next task.");
    });
  }
```

with:

```javascript
  openAddFlow() {
    _grimoireCharacterPickerModal(Object.values(this.chars), (charId) => {
      _grimoireEditModal(charId, null, () => this.mount(this.main));
    });
  }
```

- [ ] **Step 3: Manually verify against `:3001`**

At `http://localhost:3001/sanctum/grimoire`, tap "+", pick a character, fill in Content (required) and Name, save. Confirm: a toast reads "Saved.", the modal closes, and the new entry appears in the list under the right category section (or "Uncategorized" if left blank). Try saving with empty Content — confirm the "Content required." toast fires and nothing is submitted. Test the image upload: pick a file, confirm the box shows the uploaded image preview immediately after upload completes; tap the × to clear it; tap "Generate" and confirm the inert toast fires.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/js/grimoire.js
git add new_ui/js/grimoire.js
git commit -m "Add Grimoire entry create/edit form with image upload"
```

---

### Task 5: View modal, edit-from-view, delete, deep-link auto-open

**Files:**
- Modify: `new_ui/js/grimoire.js`

**Interfaces:**
- Consumes: `_grimoireEditModal` (Task 4), `_grimoireEntryTitle` (Task 1), everything else as above.
- Produces: `_grimoireViewModal(entry, charName, { onEdit, onDelete })` — a free function rendering the read-only view with Edit/Delete buttons wired to the passed callbacks. `GrimoireView.rowHtml`'s rows become clickable (Task 1 rendered them inert). `GrimoireView.mount` gains deep-link auto-open behavior.

- [ ] **Step 1: Add the view modal function**

In `new_ui/js/grimoire.js`, add after `_grimoireEditModal`:

```javascript
function _grimoireViewModal(entry, charName, { onEdit, onDelete }) {
  const title = _grimoireEntryTitle(entry);
  const layer = openModal(`
    <div class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px">${entry.category || "Uncategorized"} &middot; ${charName}</div>
    <h3 class="font-display" style="margin:0 0 10px">${title}</h3>
    ${(entry.keys || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${entry.keys.map((k) => `<span class="grimoire-tag" style="border:1px solid var(--color-line-2);border-radius:999px;padding:3px 9px">${k}</span>`).join("")}</div>` : ""}
    <p style="font-size:14px;color:var(--color-ink);line-height:1.6;white-space:pre-wrap">${entry.content}</p>
    <div style="display:flex;gap:16px;margin-top:16px;font-size:12px;color:var(--color-sec)">
      <span>Always <b style="color:var(--color-ink)">${entry.always ? "Yes" : "No"}</b></span>
      <span>Global <b style="color:var(--color-ink)">${entry.global ? "Yes" : "No"}</b></span>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
      <button type="button" class="pe-gen-btn" id="gvEdit">Edit</button>
      <button type="button" class="pe-gen-btn" id="gvDelete" style="border-color:var(--color-warn, #c0392b);color:var(--color-warn, #c0392b)">Delete</button>
    </div>
  `);
  layer.querySelector("#gvEdit").onclick = () => { closeModal(layer); onEdit(); };
  layer.querySelector("#gvDelete").onclick = () => {
    const confirmLayer = openModal(`
      <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">Delete this entry?</h3>
      <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">"${title}" will be gone for good.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="gvDelCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">Keep it</button>
        <button type="button" class="pe-gen-btn" id="gvDelConfirm" style="border-color:var(--color-warn, #c0392b);color:var(--color-warn, #c0392b)">Delete</button>
      </div>
    `);
    confirmLayer.querySelector("#gvDelCancel").onclick = () => closeModal(confirmLayer);
    confirmLayer.querySelector("#gvDelConfirm").onclick = () => {
      closeModal(confirmLayer);
      closeModal(layer);
      onDelete();
    };
  };
}
```

- [ ] **Step 2: Wire row clicks, edit, and delete into `GrimoireView`**

In `new_ui/js/grimoire.js`, replace the `rowHtml` method's outer `<div>` open tag:

```javascript
      <div class="sanctum-feed-row" data-lore-id="${entry.id}" data-char-id="${entry.char_id}">
```

with:

```javascript
      <div class="sanctum-feed-row" data-lore-id="${entry.id}" data-char-id="${entry.char_id}" onclick="_activeGrimoireView?.openEntry('${entry.id}')">
```

Add these methods to `GrimoireView`, and set `window._activeGrimoireView` in `mount` (mirrors the `window._activeParlanceView` pattern already used in `new_ui/js/parlance.js`):

```javascript
  async mount(main) {
    this.main = main;
    window._activeGrimoireView = this;
    this.render();
    const [entries, chars] = await Promise.all([
      api("/api/lore/mine").catch(() => []),
      api("/api/characters?scope=mine").catch(() => []),
    ]);
    this.entries = entries;
    chars.forEach((c) => { this.chars[c.id] = c; });
    this.render();
    this.maybeAutoOpen();
  }

  maybeAutoOpen() {
    const parts = location.pathname.split("/").filter(Boolean);
    const lid = parts[3];
    if (!lid) return;
    const entry = this.entries.find((e) => e.id === lid);
    if (entry) this.openEntry(lid);
  }

  openEntry(lid) {
    const entry = this.entries.find((e) => e.id === lid);
    if (!entry) return;
    const charName = this.chars[entry.char_id]?.name || "Unknown character";
    _grimoireViewModal(entry, charName, {
      onEdit: () => _grimoireEditModal(entry.char_id, entry, () => this.mount(this.main)),
      onDelete: async () => {
        try {
          await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
          toast("Deleted.");
          this.mount(this.main);
        } catch (err) {
          errorToast(err.message || "Couldn't delete that entry.");
        }
      },
    });
  }
```

This replaces the plan's earlier `mount` (Task 1's version) entirely — the new version adds `window._activeGrimoireView = this;` and the trailing `this.maybeAutoOpen();` call, otherwise identical.

- [ ] **Step 3: Manually verify against `:3001`**

Tap an existing entry's row — confirm the view modal opens with category/character eyebrow, title, key tags, content, Always/Global stats. Tap Edit — confirm the edit form opens pre-filled, save a change, confirm it persists (reopen the entry, see the new value). Tap Delete on a different entry, confirm it (or cancel first to verify Cancel doesn't delete), confirm the row disappears from the list. Finally, test deep-link auto-open: note an entry's `char_id`/`id` from the list (`data-char-id`/`data-lore-id` attributes, inspectable in devtools), navigate directly to `http://localhost:3001/sanctum/grimoire/{charId}/{loreId}` (fresh page load, not a client-side nav), confirm the view modal auto-opens after the list loads. Then try a bogus id pair — confirm it silently falls back to just the list, no error toast.

- [ ] **Step 4: Commit**

```bash
git status --short new_ui/js/grimoire.js
git add new_ui/js/grimoire.js
git commit -m "Add Grimoire view modal, edit-from-view, delete, and deep-link auto-open"
```

---

## Post-plan verification checklist

- [ ] `/sanctum/grimoire` shows real category-grouped entries (or the empty state) for the `test` account, matching the approved spec's layout order (header + add button → grouped sections).
- [ ] Add flow works end-to-end: character picker (both empty and populated variants) → edit form → save → appears in the list.
- [ ] View → Edit → Save persists changes; View → Delete (with confirm) removes the entry.
- [ ] Deep-link `/sanctum/grimoire/{cid}/{lid}` auto-opens the right entry on a fresh page load; a bogus id pair degrades silently to the list.
- [ ] The Sanctum overview's existing feed rows (already linking to `/sanctum/grimoire/{cid}/{lid}` from earlier work) now land on a real, working auto-opened entry instead of a placeholder.
- [ ] Image upload works (`/api/characters/{cid}/media`), the inert "Generate" button shows its explanatory toast instead of doing nothing silently.
- [ ] Theme switching (light/dark × at least one accent) leaves nothing on this screen a fixed, non-reactive color.
