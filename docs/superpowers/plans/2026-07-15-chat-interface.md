# Chat Interface (Parlance Thread) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the chat/session view (`/parlance/{sid}`) for `new_ui` — send/stream messages, view history, regenerate/continue/edit/delete turns, RPG dice quick-rolls — wired in from both Parlance's session list and a character page's Play button.

**Architecture:** One new file, `new_ui/js/chat.js`, exporting a single `ChatView` class (constructor takes `sid`, has `mount(main)`), following the exact same class shape every other `new_ui` view uses (`CharacterView`, `SymposiumThreadView`). All backend endpoints already exist and are untouched — this is a pure frontend task. SSE parsing reuses the existing `sseEvents()` helper (`new_ui/js/card-sandbox.js`, already loaded in `index.html`); markdown reuses `symposiumMd()` (`new_ui/js/symposium.js`).

**Tech Stack:** Vanilla JS (no framework, no build step), Tailwind (compiled via `./rebuild.sh --watch` → `new_ui/css/app.css`), FastAPI backend (untouched by this plan), Server-Sent Events over `fetch()` + `ReadableStream` (not `EventSource` — these are POST requests).

## Global Constraints

- Zero code comments in any `.js`/`.css` file (project-wide rule — see `CLAUDE.md`'s Coding Style section).
- No new abstractions beyond what's needed; reuse `sseEvents`, `symposiumMd`, `copyShareUrl`/`copyTextFallback`, `.ig-icon-btn`/`[data-tooltip]`, `openModal`/`closeModal` — do not reimplement any of these.
- Every icon button gets `data-tooltip` + `aria-label` (never a native `title=`) — see `[data-tooltip]` CSS already in `new_ui/css/cards.css`.
- After every CSS edit, confirm `new_ui/css/app.css` actually rebuilt (`stat -c '%Y' new_ui/css/app.css new_ui/css/cards.css` — `app.css` must be `>=` `cards.css`'s mtime) before verifying visually; the Tailwind watcher (`./rebuild.sh --watch`) has intermittently died in this session — if `app.css` is stale after a few seconds, rebuild manually: `./bin/tailwindcss -i new_ui/css/input.css -o new_ui/css/app.css`.
- All verification is via Playwright against the real running dev server (`http://localhost:3001`, proxying to the real backend on `:3000`) — there is no frontend unit-test framework in this repo. Login as `test:11111111` (`[data-field="username"]`/`[data-field="password"]`/`[data-auth-submit="signin"]`).
- Any character/session created purely for verification must be deleted afterward (`DELETE /api/characters/{cid}` cascades its sessions) — do not leave test data behind.
- Balance-check every edited `.js` file after editing (`{`/`}`, `(`/`)`, `[`/`]` counts equal) before considering a step done — this file has 5 layers of concurrent edits from other sessions today; re-read the file immediately before editing if a system reminder shows it changed since last read.

---

## File Structure

- **Create:** `new_ui/js/chat.js` — the entire `ChatView` implementation (mount, render, SSE streaming, all actions).
- **Modify:** `new_ui/css/cards.css` — append chat-bubble, writing-indicator, and dice-chip CSS (existing file, existing append-only pattern used all session).
- **Modify:** `new_ui/index.html` — one new `<script src="/js/chat.js" defer></script>` tag, alongside the existing `pinacotheca.js`/`symposium.js`/`character.js` tags.
- **Modify:** `new_ui/js/router.js` — add the `parlance-thread` route entry, a `currentRoute()` segment check, and a `TAB_FOR_ROUTE` entry.
- **Modify:** `new_ui/js/parlance.js` — `rowHtml`'s `onclick` changes from a stub toast to `navigate(...)`.
- **Modify:** `new_ui/js/character.js` — `#charStartChat`'s click handler creates a real session instead of navigating to the `/sanctum/casts` placeholder.

---

## Task 1: Chat bubble, writing-indicator, and dice-chip CSS

**Files:**
- Modify: `new_ui/css/cards.css` (append to end)

**Interfaces:**
- Produces: CSS classes `.chat-turn`, `.chat-turn.ai`, `.chat-turn.you`, `.chat-bubble`, `.chat-name-label`, `.chat-writing`, `.chat-writing-dot`, `.chat-dice-bar`, `.chat-dice-chip`, `.chat-think` — all later tasks' `chat.js` markup depends on these exact names.

- [ ] **Step 1: Append the CSS block**

Read the current end of the file first (`tail -5 new_ui/css/cards.css`) since concurrent edits from other sessions have repeatedly changed what's at the end of this file today — anchor the edit on whatever is actually there, don't assume the anchor text below still matches verbatim.

```css
.chat-turn {
  display: flex;
  flex-direction: column;
  margin-bottom: 16px;
}
.chat-turn.you {
  align-items: flex-end;
}
.chat-turn.ai {
  align-items: flex-start;
}
.chat-name-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin: 0 4px 5px;
}
.chat-bubble {
  max-width: 82%;
  padding: 11px 14px;
  font-size: 14px;
  line-height: 1.55;
  cursor: pointer;
}
.chat-turn.ai .chat-bubble {
  border-radius: 16px 16px 16px 4px;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
}
.chat-turn.you .chat-bubble {
  border-radius: 16px 16px 4px 16px;
  border: 1px solid transparent;
  background: linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));
  color: var(--color-paper-base, var(--color-paper));
}
.chat-turn.you .chat-bubble .sym-body a {
  color: var(--color-paper-base, var(--color-paper));
  text-decoration: underline;
}
.chat-think {
  margin-bottom: 8px;
  max-width: 82%;
}
.chat-think summary {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--color-muted);
  cursor: pointer;
}
.chat-think-body {
  margin-top: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px dashed var(--color-line-2);
  background: var(--color-surface-2);
  font-size: 12.5px;
  color: var(--color-sec);
  font-style: italic;
}
.chat-writing {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--color-muted);
  padding: 0 4px;
}
.chat-writing-dot {
  width: 7px;
  height: 7px;
  border-radius: 4px;
  background: var(--color-accent);
  animation: chat-blink 1s steps(2) infinite;
}
@keyframes chat-blink {
  50% { opacity: .25; }
}
@media (prefers-reduced-motion: reduce) {
  .chat-writing-dot { animation: none; }
}
.chat-actions-row {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.chat-dice-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-2);
  overflow-x: auto;
}
.chat-dice-chip {
  flex: none;
  border: 1px solid var(--color-line-2);
  background: var(--color-surface);
  color: var(--color-sec);
  border-radius: 9px;
  padding: 6px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  cursor: pointer;
}
.chat-dice-chip:disabled,
.chat-composer.disabled {
  opacity: .5;
  pointer-events: none;
}
.chat-composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 9px;
  padding: 10px 14px calc(env(safe-area-inset-bottom, 12px) + 12px);
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-2);
}
.chat-composer textarea {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 11px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-line-2);
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: 14.5px;
  line-height: 1.4;
  outline: none;
}
.chat-composer-btn {
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 12px;
  border: 1px solid var(--color-line-2);
  background: var(--color-surface);
  color: var(--color-sec);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.chat-composer-send {
  border: none;
  background: linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));
  color: var(--color-paper-base, var(--color-paper));
}
```

- [ ] **Step 2: Rebuild and verify the CSS actually compiled**

```bash
sleep 2
stat -c '%Y %n' new_ui/css/app.css new_ui/css/cards.css
```

If `app.css`'s mtime is older than `cards.css`'s, the watcher died — rebuild manually:

```bash
./bin/tailwindcss -i new_ui/css/input.css -o new_ui/css/app.css
```

Then confirm the new classes are present:

```bash
grep -c "chat-bubble\|chat-writing-dot\|chat-dice-chip" new_ui/css/app.css
```

Expected: a nonzero count (at least 3).

- [ ] **Step 3: Commit**

```bash
git add new_ui/css/cards.css
git commit -m "Add chat bubble, writing-indicator, and dice-chip CSS for the new_ui chat view"
```

---

## Task 2: ChatView skeleton — mount, header, message history render (no sending yet)

**Files:**
- Create: `new_ui/js/chat.js`
- Modify: `new_ui/index.html` (add script tag)

**Interfaces:**
- Consumes: `api()` (`new_ui/js/app-session.js`), `_esc()` (`new_ui/js/profile-template.js`), `symposiumMd()` (`new_ui/js/symposium.js`), `MODE_ICONS` (`new_ui/js/pantheon.js`), `copyShareUrl()` (`new_ui/js/profile-template.js`), `openModal`/`closeModal` (`new_ui/js/modal.js`), `toast()`/`errorToast()` (`new_ui/js/toast.js`), `navigate()` (`new_ui/js/router.js`).
- Produces: `class ChatView` with `constructor(sid)`, `async mount(main)`, `render()`, `splitThink(content)`, `stripMood(text)` — later tasks in this plan add methods to this same class (`sendTurn`, `wireComposer`, message-action handlers) and must match this constructor/mount signature.

- [ ] **Step 1: Write `new_ui/js/chat.js`**

```javascript
"use strict";

function stripMood(text) {
  return String(text || "").replace(/\[mood:\s*[a-z0-9 _-]+\]/gi, "").replace(/[ \t]+\n/g, "\n").trim();
}

function splitThink(content) {
  const m = String(content || "").match(/<think>([\s\S]*?)<\/think>/);
  const think = m ? m[1].trim() : null;
  const body = stripMood(String(content || "").replace(/<think>[\s\S]*?<\/think>/, "")).trim();
  return { think, body };
}

class ChatView {
  constructor(sid) {
    this.sid = sid;
    this.session = null;
    this.char = null;
    this.error = "";
    this.streaming = false;
  }

  async mount(main) {
    this.main = main;
    this.render();
    try {
      this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
      this.char = await api(`/api/characters/${encodeURIComponent(this.session.char_id)}`);
    } catch (err) {
      this.error = err.message || "That conversation couldn't be found.";
      this.render();
      return;
    }
    this.render();
    this.scrollToBottom();
  }

  scrollToBottom() {
    const thread = this.main.querySelector("#chatThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  headerHtml() {
    const c = this.char;
    const hue = [...c.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const rpg = c.mode === "rpg";
    const avatarInner = c.avatar
      ? `<img src="${_esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;background:linear-gradient(150deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 45% 16%));display:grid;place-items:center;font-family:var(--font-display);font-size:16px;color:#fff">${_esc(c.name?.[0]?.toUpperCase() || "?")}</div>`;
    return `
      <div style="flex:none;padding-top:env(safe-area-inset-top,0px);background:var(--color-surface-2);border-bottom:1px solid var(--color-line)">
        <div style="display:flex;align-items:center;gap:11px;padding:8px 14px 11px">
          <button type="button" id="chatBack" class="ig-icon-btn" aria-label="Back" data-tooltip="Back" style="position:static">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span style="width:38px;height:38px;flex:none;border-radius:11px;overflow:hidden">${avatarInner}</span>
          <div style="flex:1;min-width:0">
            <div class="font-display" style="font-weight:600;font-size:15.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(c.name)}</div>
            <div style="font-size:11px;color:var(--color-muted);display:flex;align-items:center;gap:5px">
              <span style="width:6px;height:6px;border-radius:3px;background:#7bd88f"></span>
              memory on &middot; ${rpg ? "campaign" : "session"}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  turnHtml(msg) {
    const you = msg.role === "user";
    const { think, body } = you ? { think: null, body: stripMood(msg.content) } : splitThink(msg.content);
    const name = you ? (this.session.user_name || "You") : this.char.name;
    return `
      <div class="chat-turn ${you ? "you" : "ai"}" data-mid="${_esc(msg.id)}">
        <div class="chat-name-label">${_esc(name)}</div>
        ${think ? `<details class="chat-think"><summary>Thinking</summary><div class="chat-think-body sym-body">${symposiumMd(think)}</div></details>` : ""}
        <div class="chat-bubble">
          <div class="sym-body">${you ? _esc(body) : symposiumMd(body)}</div>
        </div>
      </div>
    `;
  }

  threadHtml() {
    if (!this.session.messages.length) {
      return `<p style="color:var(--color-sec);font-size:13px;text-align:center;padding:24px 0">No lines exchanged yet.</p>`;
    }
    return this.session.messages.map((m) => this.turnHtml(m)).join("");
  }

  render() {
    if (this.error) {
      this.main.innerHTML = `
        <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>
          <a href="/parlance" onclick="event.preventDefault();navigate('/parlance')" class="font-mono" style="font-size:11px;color:var(--color-accent)">&larr; Back to Parlance</a>
        </div>
      `;
      return;
    }
    if (!this.session || !this.char) {
      this.main.innerHTML = `<p style="padding:16px;color:var(--color-sec);font-size:13px">Unsealing the correspondence&hellip;</p>`;
      return;
    }
    this.main.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--color-paper)">
        ${this.headerHtml()}
        <div id="chatThread" style="flex:1;min-height:0;overflow-y:auto;padding:22px 16px 8px">
          ${this.threadHtml()}
        </div>
      </div>
    `;
    document.getElementById("chatBack").onclick = () => navigate("/parlance");
  }
}

if (typeof window !== "undefined") {
  window.ChatView = ChatView;
}
```

- [ ] **Step 2: Add the script tag**

Re-read `new_ui/index.html` first (other sessions have edited this file's script list repeatedly today). Find the line `<script src="/js/character.js" defer></script>` and add immediately after it:

```html
<script src="/js/chat.js" defer></script>
```

- [ ] **Step 3: Balance-check the new file**

```bash
python3 - <<'EOF'
s = open("new_ui/js/chat.js").read()
for pair in [("{","}"),("(",")"),("[","]")]:
    o,c = pair
    if s.count(o) != s.count(c):
        print(pair, s.count(o), s.count(c))
print("checked")
EOF
```

Expected output: `checked` with no mismatch lines printed above it.

- [ ] **Step 4: Manually verify against a real session**

`ChatView` isn't routed yet (Task 6 adds the route), so verify it directly by creating a throwaway character + session and calling `ChatView` from the browser console via a temporary Playwright script:

```bash
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{"name":"__chattest__","description":"temp","greeting":"Hello there, traveler.","mode":"character","is_public":false}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])"
```

Note the printed `cid`, then:

```bash
curl -s -b /tmp/cookies.txt -X POST "http://localhost:3000/api/characters/<cid>/sessions" \
  -H "Content-Type: application/json" -d '{}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])"
```

Note the printed `sid`. Write a throwaway Playwright script (scratchpad directory) that logs in as `test`, navigates to `http://localhost:3001/parlance` (any real page so all scripts are loaded), then runs in-page:

```python
result = await page.evaluate("""async (sid) => {
    document.getElementById('main').innerHTML = '';
    const view = new ChatView(sid);
    await view.mount(document.getElementById('main'));
    return document.querySelector('.chat-turn.ai .chat-bubble')?.textContent || null;
}""", sid)
print("first AI bubble text:", result)
```

Expected: prints the greeting text ("Hello there, traveler."). Screenshot and confirm visually: header with back arrow/avatar/name/"memory on · session", one AI bubble left-aligned in a surface-colored rounded box. Zero console errors.

- [ ] **Step 5: Clean up test data and commit**

```bash
curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/characters/<cid>" -o /dev/null -w "%{http_code}\n"
```

```bash
git add new_ui/js/chat.js new_ui/index.html
git commit -m "Add ChatView skeleton: mount, header, and read-only message history render"
```

---

## Task 3: Composer + streaming send (core `sendTurn`)

**Files:**
- Modify: `new_ui/js/chat.js`

**Interfaces:**
- Consumes: `sseEvents(response, onEvent)` (`new_ui/js/card-sandbox.js`) — signature: `async sseEvents(response, onEvent)` where `onEvent` is `async (ev) => {}` and `ev` is the parsed `{type, ...}` object per the SSE contract in the spec.
- Produces: `async sendTurn(endpoint, body, { optimisticUser } = {})` — later tasks (regenerate/continue/roll) call this directly with different `endpoint`/`body`/`optimisticUser`.

- [ ] **Step 1: Add the composer markup to `render()`**

In `new_ui/js/chat.js`, replace the `render()` method's main innerHTML block (the one ending `${this.threadHtml()}\n          </div>\n        </div>\n      \`;`) so the thread div is followed by a composer:

```javascript
  render() {
    if (this.error) {
      this.main.innerHTML = `
        <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>
          <a href="/parlance" onclick="event.preventDefault();navigate('/parlance')" class="font-mono" style="font-size:11px;color:var(--color-accent)">&larr; Back to Parlance</a>
        </div>
      `;
      return;
    }
    if (!this.session || !this.char) {
      this.main.innerHTML = `<p style="padding:16px;color:var(--color-sec);font-size:13px">Unsealing the correspondence&hellip;</p>`;
      return;
    }
    const rpg = this.char.mode === "rpg";
    this.main.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--color-paper)">
        ${this.headerHtml()}
        <div id="chatThread" style="flex:1;min-height:0;overflow-y:auto;padding:22px 16px 8px">
          ${this.threadHtml()}
          ${this.streaming ? `<div class="chat-writing"><span class="chat-writing-dot"></span>${_esc(this.char.name)} is writing&hellip;</div>` : ""}
        </div>
        <div class="chat-composer${this.streaming ? " disabled" : ""}">
          <button type="button" id="chatImageBtn" class="chat-composer-btn" aria-label="Generate image" data-tooltip="Generate image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </button>
          <textarea id="chatInput" rows="1" placeholder="${rpg ? "Describe your action…" : "Write your reply…"}" ${this.streaming ? "disabled" : ""}></textarea>
          <button type="button" id="chatSend" class="chat-composer-btn chat-composer-send" aria-label="Send" data-tooltip="Send" ${this.streaming ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    `;
    document.getElementById("chatBack").onclick = () => navigate("/parlance");
    this.wireComposer();
  }

  wireComposer() {
    const input = document.getElementById("chatInput");
    const send = document.getElementById("chatSend");
    document.getElementById("chatImageBtn").onclick = () => toast("Image generation isn't built yet — it'll work once My Forge ships.");
    if (!input || this.streaming) return;
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submitComposer();
      }
    });
    send.onclick = () => this.submitComposer();
  }

  submitComposer() {
    const input = document.getElementById("chatInput");
    const content = input.value.trim();
    if (!content || this.streaming) return;
    input.value = "";
    this.sendTurn("chat", { content }, { optimisticUser: content });
  }
```

- [ ] **Step 2: Add `sendTurn` and the SSE handling**

Add this method to the `ChatView` class, after `wireComposer`/`submitComposer`:

```javascript
  async sendTurn(endpoint, body, { optimisticUser } = {}) {
    if (this.streaming) return;
    this.streaming = true;
    if (optimisticUser) {
      this.session.messages.push({ id: `pending-user-${Date.now()}`, role: "user", content: optimisticUser });
    }
    this.render();
    this.scrollToBottom();

    let thinkingAcc = "";
    let bodyAcc = "";
    let gotDone = false;

    const upsertPlaceholder = () => {
      const thread = this.main.querySelector("#chatThread");
      if (!thread) return;
      let node = thread.querySelector("[data-pending-ai]");
      if (!node) {
        thread.insertAdjacentHTML("beforeend", `<div class="chat-turn ai" data-pending-ai><div class="chat-name-label">${_esc(this.char.name)}</div></div>`);
        node = thread.querySelector("[data-pending-ai]");
      }
      node.innerHTML = `
        <div class="chat-name-label">${_esc(this.char.name)}</div>
        ${thinkingAcc ? `<details class="chat-think" open><summary>Thinking</summary><div class="chat-think-body sym-body">${symposiumMd(thinkingAcc)}</div></details>` : ""}
        ${bodyAcc ? `<div class="chat-bubble"><div class="sym-body">${symposiumMd(stripMood(bodyAcc))}</div></div>` : ""}
      `;
      this.scrollToBottom();
    };

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(this.sid)}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Request failed (${res.status})`);
      }
      await sseEvents(res, async (ev) => {
        if (ev.type === "thinking") {
          thinkingAcc += ev.content;
          upsertPlaceholder();
        } else if (ev.type === "delta") {
          bodyAcc = ev.content;
          upsertPlaceholder();
        } else if (ev.type === "error") {
          throw new Error(ev.message || "Generation failed.");
        } else if (ev.type === "done") {
          gotDone = true;
          this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
          await this.maybeAutoTitle(endpoint, ev.message);
        }
      });
    } catch (err) {
      toast(err.message || "That turn failed.");
      if (!gotDone) {
        try { this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`); } catch {}
      }
    } finally {
      this.streaming = false;
      this.render();
      this.scrollToBottom();
    }
  }

  async maybeAutoTitle(endpoint, doneMessage) {
    if (endpoint !== "chat") return;
    if (!this.session || this.session.title !== this.char.name) return;
    const raw = String(doneMessage?.content || "").replace(/<think>[\s\S]*?<\/think>/, "");
    const title = raw
      .replace(/<[^>]+>|\(OOC:[^)]*\)|[*_`#>[\]()~]/g, "")
      .trim()
      .split(/[.!?\n]/)[0]
      .trim()
      .slice(0, 60)
      .replace(/\s+\S{0,15}$/, "")
      .trim();
    if (!title) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}`, { method: "PATCH", body: JSON.stringify({ title }) });
      this.session.title = title;
    } catch {}
  }
```

- [ ] **Step 3: Balance-check**

```bash
python3 - <<'EOF'
s = open("new_ui/js/chat.js").read()
for pair in [("{","}"),("(",")"),("[","]")]:
    o,c = pair
    if s.count(o) != s.count(c):
        print(pair, s.count(o), s.count(c))
print("checked")
EOF
```

Expected: `checked`, no mismatches.

- [ ] **Step 4: Verify streaming send end-to-end**

Create a fresh throwaway character + session the same way as Task 2 Step 4 (a plain, non-RPG character). Using the same in-page-evaluate Playwright pattern, run:

```python
await page.evaluate("""async (sid) => {
    document.getElementById('main').innerHTML = '';
    window._testView = new ChatView(sid);
    await window._testView.mount(document.getElementById('main'));
}""", sid)
await page.fill("#chatInput", "Hello, who are you?")
await page.click("#chatSend")
await page.wait_for_timeout(8000)
bubbles = await page.locator(".chat-turn .chat-bubble").count()
last_text = await page.locator(".chat-turn.ai .chat-bubble").last.text_content()
print("bubble count:", bubbles, "last AI text:", last_text[:200])
```

Expected: `bubbles` is at least 3 (greeting + your message + new reply), `last_text` is non-empty real generated text, zero console errors during the whole exchange. Screenshot and confirm visually: your message right-aligned in a gold-gradient bubble, the AI's reply left-aligned, no lingering "is writing…" indicator after completion.

- [ ] **Step 5: Verify auto-title fired**

```bash
curl -s -b /tmp/cookies.txt "http://localhost:3000/api/sessions/<sid>" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])"
```

Expected: no longer equals the character's name (`__chattest__` or whatever you named it) — it's now derived from the AI's reply.

- [ ] **Step 6: Clean up and commit**

```bash
curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/characters/<cid>" -o /dev/null -w "%{http_code}\n"
```

```bash
git add new_ui/js/chat.js
git commit -m "Add streaming send: composer, sendTurn SSE loop, auto-title after first reply"
```

---

## Task 4: Message actions — copy, edit, delete, regenerate, continue

**Files:**
- Modify: `new_ui/js/chat.js`

**Interfaces:**
- Consumes: `sendTurn` (Task 3), `copyTextFallback` (`new_ui/js/profile-template.js`).
- Produces: `turnHtml` gains a tap-to-reveal actions row; `wireTurnActions()` method wired after every `render()`.

- [ ] **Step 1: Update `turnHtml` to include an actions row**

Replace the existing `turnHtml` method:

```javascript
  turnHtml(msg, isLastAssistant) {
    const you = msg.role === "user";
    const { think, body } = you ? { think: null, body: stripMood(msg.content) } : splitThink(msg.content);
    const name = you ? (this.session.user_name || "You") : this.char.name;
    return `
      <div class="chat-turn ${you ? "you" : "ai"}" data-mid="${_esc(msg.id)}">
        <div class="chat-name-label">${_esc(name)}</div>
        ${think ? `<details class="chat-think"><summary>Thinking</summary><div class="chat-think-body sym-body">${symposiumMd(think)}</div></details>` : ""}
        <div class="chat-bubble" data-toggle-actions="${_esc(msg.id)}">
          <div class="sym-body">${you ? _esc(body) : symposiumMd(body)}</div>
        </div>
        <div class="chat-actions-row" data-actions-for="${_esc(msg.id)}" style="display:none">
          <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="copy" aria-label="Copy" data-tooltip="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="edit" aria-label="Edit" data-tooltip="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button type="button" class="ig-icon-btn danger" style="position:static;width:26px;height:26px" data-act="delete" aria-label="Delete" data-tooltip="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
          ${isLastAssistant ? `
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="regenerate" aria-label="Regenerate" data-tooltip="Regenerate">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="continue" aria-label="Continue" data-tooltip="Continue">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }

  threadHtml() {
    if (!this.session.messages.length) {
      return `<p style="color:var(--color-sec);font-size:13px;text-align:center;padding:24px 0">No lines exchanged yet.</p>`;
    }
    const lastAssistantId = [...this.session.messages].reverse().find((m) => m.role === "assistant")?.id;
    return this.session.messages.map((m) => this.turnHtml(m, m.id === lastAssistantId)).join("");
  }
```

- [ ] **Step 2: Add `wireTurnActions` and message-action methods**

```javascript
  wireTurnActions() {
    this.main.querySelectorAll("[data-toggle-actions]").forEach((bubble) => {
      bubble.onclick = () => {
        const mid = bubble.dataset.toggleActions;
        const row = this.main.querySelector(`[data-actions-for="${CSS.escape(mid)}"]`);
        if (row) row.style.display = row.style.display === "none" ? "flex" : "none";
      };
    });
    this.main.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const mid = btn.closest("[data-actions-for]")?.dataset.actionsFor;
        const msg = this.session.messages.find((m) => m.id === mid);
        if (!msg) return;
        const act = btn.dataset.act;
        if (act === "copy") this.copyMessage(msg);
        else if (act === "edit") this.beginEditMessage(msg);
        else if (act === "delete") this.deleteMessage(msg);
        else if (act === "regenerate") this.sendTurn("regenerate", {});
        else if (act === "continue") this.sendTurn("continue", {});
      });
    });
  }

  copyMessage(msg) {
    const { body } = msg.role === "user" ? { body: stripMood(msg.content) } : splitThink(msg.content);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(body)
        .then(() => toast("Copied."))
        .catch(() => { if (copyTextFallback(body)) toast("Copied."); else errorToast("Couldn't copy."); });
      return;
    }
    if (copyTextFallback(body)) toast("Copied.");
    else errorToast("Couldn't copy.");
  }

  beginEditMessage(msg) {
    const turnNode = this.main.querySelector(`[data-mid="${CSS.escape(msg.id)}"]`);
    const bubbleBody = turnNode?.querySelector(".chat-bubble .sym-body");
    if (!bubbleBody) return;
    const { body } = msg.role === "user" ? { body: stripMood(msg.content) } : splitThink(msg.content);
    bubbleBody.innerHTML = `
      <textarea style="width:100%;min-height:70px;resize:vertical;background:transparent;border:1px solid var(--color-line-2);border-radius:8px;padding:8px;color:inherit;font-family:inherit;font-size:inherit">${_esc(body)}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button type="button" class="tool" data-edit-save style="border:1px solid var(--color-accent);border-radius:8px;padding:4px 10px;color:var(--color-accent)">Save</button>
        <button type="button" class="tool" data-edit-cancel style="border:1px solid var(--color-line-2);border-radius:8px;padding:4px 10px">Cancel</button>
      </div>
    `;
    bubbleBody.querySelector("[data-edit-cancel]").onclick = (e) => { e.stopPropagation(); this.render(); };
    bubbleBody.querySelector("[data-edit-save]").onclick = async (e) => {
      e.stopPropagation();
      const newContent = bubbleBody.querySelector("textarea").value.trim();
      if (!newContent) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ content: newContent }),
        });
        this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
        this.render();
        toast("Saved.");
      } catch (err) {
        toast(err.message || "Couldn't save that edit.");
      }
    };
  }

  async deleteMessage(msg) {
    if (!confirm("Delete this message? This can't be undone.")) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
      this.session.messages = this.session.messages.filter((m) => m.id !== msg.id);
      this.render();
      toast("Deleted.");
    } catch (err) {
      toast(err.message || "Couldn't delete that message.");
    }
  }
```

- [ ] **Step 3: Call `wireTurnActions()` from `render()`**

In `render()`, immediately after the `this.wireComposer();` line, add:

```javascript
    this.wireTurnActions();
```

- [ ] **Step 4: Balance-check**

```bash
python3 - <<'EOF'
s = open("new_ui/js/chat.js").read()
for pair in [("{","}"),("(",")"),("[","]")]:
    o,c = pair
    if s.count(o) != s.count(c):
        print(pair, s.count(o), s.count(c))
print("checked")
EOF
```

Expected: `checked`, no mismatches.

- [ ] **Step 5: Verify actions end-to-end**

Reuse a throwaway character/session (create fresh, as in Task 2 Step 4), send one real message via the composer (as in Task 3 Step 4) so there's an assistant turn to act on, then in the same Playwright session:

```python
await page.click(".chat-turn.ai .chat-bubble >> nth=-1")
await page.wait_for_timeout(300)
regen_visible = await page.locator("[data-act='regenerate']").is_visible()
print("regenerate button visible after tap:", regen_visible)

before_text = await page.locator(".chat-turn.ai .chat-bubble").last.text_content()
await page.click("[data-act='regenerate']")
await page.wait_for_timeout(8000)
after_text = await page.locator(".chat-turn.ai .chat-bubble").last.text_content()
print("text changed after regenerate:", before_text.strip() != after_text.strip())

await page.click(".chat-turn.you .chat-bubble >> nth=0")
await page.click("[data-act='delete']")
```

Note: the `deleteMessage` confirm() call will block Playwright unless you first run `page.on("dialog", lambda d: d.accept())` before the click. Expected: `regen_visible` is `True`, the AI's text actually changed after regenerate, and after accepting the delete confirm the deleted bubble is gone from the DOM (`await page.locator(".chat-turn").count()` decreased by one). Zero console errors throughout.

- [ ] **Step 6: Clean up and commit**

```bash
curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/characters/<cid>" -o /dev/null -w "%{http_code}\n"
```

```bash
git add new_ui/js/chat.js
git commit -m "Add message actions: copy, inline edit, delete, regenerate, continue"
```

---

## Task 5: RPG dice quick-roll bar

**Files:**
- Modify: `new_ui/js/chat.js`

**Interfaces:**
- Consumes: `sendTurn` (Task 3).
- Produces: `.chat-dice-bar` rendered only when `this.char.mode === "rpg"`, wired to `sendTurn("roll", {expr, note: ""})`.

- [ ] **Step 1: Add the dice bar to `render()`**

In `render()`, insert the dice bar between the `#chatThread` div and the `.chat-composer` div:

```javascript
        ${rpg ? `
          <div class="chat-dice-bar">
            <span style="color:var(--color-accent);display:flex">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/><circle cx="12" cy="12" r="1"/></svg>
            </span>
            ${["d4", "d6", "d8", "d20", "2d6"].map((d) => `<button type="button" class="chat-dice-chip" data-roll="${d}" ${this.streaming ? "disabled" : ""}>${d}</button>`).join("")}
          </div>
        ` : ""}
```

Note: this block must be inserted into the template literal string, using the already-declared `rpg` local variable from Step 1 of Task 3 (`const rpg = this.char.mode === "rpg";`).

- [ ] **Step 2: Wire the dice chips**

In `wireComposer()` (or immediately after its call in `render()`), add:

```javascript
    this.main.querySelectorAll("[data-roll]").forEach((chip) => {
      chip.onclick = () => {
        if (this.streaming) return;
        const expr = chip.dataset.roll.replace(/^d/, "1d");
        this.sendTurn("roll", { expr, note: "" });
      };
    });
```

Place this call right after `this.wireTurnActions();` in `render()`.

- [ ] **Step 3: Balance-check**

```bash
python3 - <<'EOF'
s = open("new_ui/js/chat.js").read()
for pair in [("{","}"),("(",")"),("[","]")]:
    o,c = pair
    if s.count(o) != s.count(c):
        print(pair, s.count(o), s.count(c))
print("checked")
EOF
```

Expected: `checked`, no mismatches.

- [ ] **Step 4: Verify with a real RPG-mode character**

```bash
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{"name":"__dicetest__","description":"temp","greeting":"The dungeon awaits.","mode":"rpg","is_public":false}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])"
```

Create a session for it (same as Task 2 Step 4), mount `ChatView` in Playwright, and check:

```python
dice_count = await page.locator(".chat-dice-chip").count()
print("dice chips visible for RPG character:", dice_count)
await page.click("[data-roll='d20']")
await page.wait_for_timeout(8000)
new_user_turn = await page.locator(".chat-turn.you").last.text_content()
print("last user turn after roll:", new_user_turn[:200])
```

Expected: `dice_count` is 5, and after clicking the `d20` chip a new turn appears showing the roll result was sent (the backend formats the roll into a user-role message per `backend/dice.py`). Also verify a plain (non-RPG) character's chat page shows **zero** `.chat-dice-chip` elements (reuse the character from Task 3/4's verification).

- [ ] **Step 5: Clean up and commit**

```bash
curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/characters/<cid>" -o /dev/null -w "%{http_code}\n"
```

```bash
git add new_ui/js/chat.js
git commit -m "Add RPG-only dice quick-roll bar"
```

---

## Task 6: Router wiring

**Files:**
- Modify: `new_ui/js/router.js`

**Interfaces:**
- Consumes: `ChatView` (Task 2).
- Produces: route name `parlance-thread`, resolvable from `/parlance/{sid}`.

- [ ] **Step 1: Re-read the current router.js**

This file has been edited by concurrent sessions repeatedly today — read it fresh immediately before editing, and anchor edits on whatever text is actually there (do not assume line numbers from earlier in this plan's writing).

- [ ] **Step 2: Add the route entry**

In the `routes` object, add (near the other `character`/`shared-image` entries):

```javascript
  "parlance-thread": (main) => {
    const sid = location.pathname.split("/").filter(Boolean)[1];
    return new ChatView(sid).mount(main);
  },
```

- [ ] **Step 3: Add the `currentRoute()` segment check**

In `currentRoute()`, alongside the existing `seg === "symposium"`/`seg === "i"`/`seg === "c"` checks, add:

```javascript
  if (seg === "parlance" && parts[1]) return "parlance-thread";
```

- [ ] **Step 4: Add the `TAB_FOR_ROUTE` entry**

In `TAB_FOR_ROUTE`, add:

```javascript
  "parlance-thread": "parlance",
```

- [ ] **Step 5: Use the chromeless full-bleed layout for this route**

In the `route()` function, find the line that currently reads (or equivalent — re-check the actual current condition, it has grown other clauses today):

```javascript
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else if ((!ME && routeName === "shared-image") || routeName === "character") hideNavOnly(main);
  else restoreChrome(main);
```

Add `"parlance-thread"` to the `hideNavOnly` condition:

```javascript
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else if ((!ME && routeName === "shared-image") || routeName === "character" || routeName === "parlance-thread") hideNavOnly(main);
  else restoreChrome(main);
```

- [ ] **Step 6: Balance-check**

```bash
python3 - <<'EOF'
s = open("new_ui/js/router.js").read()
for pair in [("{","}"),("(",")"),("[","]")]:
    o,c = pair
    if s.count(o) != s.count(c):
        print(pair, s.count(o), s.count(c))
print("checked")
EOF
```

Expected: `checked`, no mismatches.

- [ ] **Step 7: Verify the real route works end-to-end**

Create a throwaway character + session (as before), then navigate a fresh Playwright page directly to `http://localhost:3001/parlance/<sid>` (logged in as `test`) — no manual `ChatView` construction this time, the router should do it:

```python
await page.goto(f"http://localhost:3001/parlance/{sid}", wait_until="networkidle")
await page.wait_for_timeout(1000)
print("URL:", page.url)
has_composer = await page.locator("#chatInput").count()
print("composer present:", has_composer)
```

Expected: URL stays at `/parlance/{sid}` (no redirect to `/login` or `/compendium`), composer is present, no bottom nav visible (chromeless), zero console errors.

- [ ] **Step 8: Clean up and commit**

```bash
curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/characters/<cid>" -o /dev/null -w "%{http_code}\n"
```

```bash
git add new_ui/js/router.js
git commit -m "Wire /parlance/{sid} route to ChatView"
```

---

## Task 7: Entry points — Parlance row click and character page Play button

**Files:**
- Modify: `new_ui/js/parlance.js`
- Modify: `new_ui/js/character.js`

**Interfaces:**
- Consumes: `parlance-thread` route (Task 6), `POST /api/characters/{cid}/sessions` (existing backend endpoint, body `{persona_id: null}`, returns the created session object with `.id`).

- [ ] **Step 1: Re-read both files fresh** (both have been edited by concurrent sessions today).

- [ ] **Step 2: Fix Parlance's row click**

In `new_ui/js/parlance.js`'s `rowHtml`, change:

```javascript
      <div class="parlance-row" data-sid="${s.id}" onclick="toast('Parlance is being rebuilt — the chat itself isn\\'t here yet.')">
```

to:

```javascript
      <div class="parlance-row" data-sid="${s.id}" onclick="navigate('/parlance/${s.id}')">
```

- [ ] **Step 3: Fix the character page's Play button**

In `new_ui/js/character.js`, find the `charStartChat` wiring (currently `document.getElementById("charStartChat").onclick = () => navigate("/sanctum/casts");`) and replace it with:

```javascript
    document.getElementById("charStartChat").onclick = async () => {
      const btn = document.getElementById("charStartChat");
      btn.disabled = true;
      btn.style.opacity = ".5";
      try {
        const session = await api(`/api/characters/${encodeURIComponent(c.id)}/sessions`, {
          method: "POST",
          body: JSON.stringify({ persona_id: null }),
        });
        navigate(`/parlance/${session.id}`);
      } catch (err) {
        toast(err.message || "Couldn't start that chat.");
        btn.disabled = false;
        btn.style.opacity = "";
      }
    };
```

- [ ] **Step 4: Balance-check both files**

```bash
for f in new_ui/js/parlance.js new_ui/js/character.js; do
python3 - "$f" <<'EOF'
import sys
s = open(sys.argv[1]).read()
for pair in [("{","}"),("(",")"),("[","]")]:
    o,c = pair
    if s.count(o) != s.count(c):
        print(sys.argv[1], pair, s.count(o), s.count(c))
print(sys.argv[1], "checked")
EOF
done
```

Expected: both files print `checked` with no mismatches above.

- [ ] **Step 5: Verify the full click-through flow**

Create one throwaway public character (`is_public: true` so it's easy to reach via its own page), then in Playwright:

```python
await page.goto(f"http://localhost:3001/c/{cid}", wait_until="networkidle")
await page.wait_for_timeout(1000)
await page.click("#charStartChat")
await page.wait_for_timeout(2000)
print("URL after Play click:", page.url)
has_greeting = await page.locator(".chat-turn.ai .chat-bubble").count()
print("greeting bubble present:", has_greeting)
```

Expected: URL becomes `/parlance/<some-new-sid>`, one AI bubble is present (the auto-seeded greeting). Then separately verify Parlance itself:

```python
await page.goto("http://localhost:3001/parlance", wait_until="networkidle")
await page.wait_for_timeout(1000)
await page.click(".parlance-row >> nth=0")
await page.wait_for_timeout(1000)
print("URL after Parlance row click:", page.url)
```

Expected: URL matches `/parlance/{sid}` pattern (a real chat, not the old stub toast). Zero console errors in both flows.

- [ ] **Step 6: Clean up and commit**

```bash
curl -s -b /tmp/cookies.txt -X DELETE "http://localhost:3000/api/characters/<cid>" -o /dev/null -w "%{http_code}\n"
```

```bash
git add new_ui/js/parlance.js new_ui/js/character.js
git commit -m "Wire Parlance row clicks and the character page Play button into real chat sessions"
```

---

## Self-Review Notes

**Spec coverage:** header/status line (Task 2) · message history render, think/mood stripping (Task 2) · streaming send with all 5 SSE event types + auto-title (Task 3) · copy/edit/delete/regenerate/continue actions, tap-to-reveal (Task 4) · RPG-only dice bar (Task 5) · route + chromeless layout (Task 6) · both entry points (Task 7). Explicitly-deferred items from the spec (image gen, VN mode, translation, author's-note modals, lorebook picker, slash commands, recap/memory-viewer, milestones) have no tasks, correctly — the image-gen composer button is a `toast()` stub (Task 3 Step 1), matching the same deferred-feature pattern already used for Studio/Edit elsewhere in this codebase.

**Placeholder scan:** every step above has complete, real code — no `TBD`/`// ...`/"similar to Task N" shortcuts.

**Type consistency:** `ChatView(sid)` constructor signature is identical everywhere it's referenced (Tasks 2, 6, 7). `sendTurn(endpoint, body, opts)` signature matches between its definition (Task 3) and every call site (Task 3's `submitComposer`, Task 4's regenerate/continue handlers, Task 5's dice handler). `splitThink`/`stripMood` module-level functions (Task 2) are used consistently in Tasks 2 and 4 without redefinition.

---

## ⚠️ Contract change (2026-07-17): structured directives, legacy text commands NOT supported

The backend no longer honors text-format commands. **Do not** implement `/ooc`, `/scene`,
`/note`, `/time`, or `/as` as message-text rewrites (`(OOC: ...)`, `*[Scene: ...]`, etc.) —
the v2 prompt explicitly treats those strings as in-fiction speech, the server strips the
director sigil (`╾━╤デ╦︻`) from all user-supplied text, and `_run` attaches a `warning`
field to the SSE `meta` event whenever a message starts with a legacy form.

Instead, slash commands map to structured fields on `POST /api/sessions/{sid}/chat`:

```json
{"content": "the text", "directive": "ooc" | "scene" | "note" | "time" | "as",
 "directive_arg": "Name (only for \"as\")"}
```

The server wraps the message as `(╾━╤デ╦︻:[command] ...)` itself — that exact string in a
stored user message is proof it was server-generated. Dice stay on `POST .../roll` (the
server formats the `[roll]` directive). Feature-detect via `GET /api/config`:
`directives` (the valid command list) and `legacy_text_commands_supported: false`.
Render stored `(╾━╤デ╦︻:[command] ...)` messages as a command chip (e.g. an "OOC" badge +
the text), never as raw glyphs. Surface the `meta.warning` field to the user when present.
