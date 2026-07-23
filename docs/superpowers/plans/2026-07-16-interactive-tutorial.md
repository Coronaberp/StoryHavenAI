# Interactive App-Wide Tutorial Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the passive read-only tutorial with a live, forced-action guided tutorial that spotlights the correct control, blocks everything else, and simulates costly actions (chat streaming, image gen) convincingly-but-fake, all in an extremely obtuse/rude/sarcastic voice.

**Architecture:** A lesson-agnostic `TutorialEngine` (`new_ui/js/tutorial-engine.js`) drives ordered step data over the real app — a dim+spotlight overlay, a document-level capture-phase click gate (only the spotlighted element is clickable; wrong clicks toast sarcasm), a step runner that navigates and polls for targets, and client-side simulations that fake the payoff. Lesson data + the launcher hub live in a rewritten `new_ui/js/tutorial.js`. Overlay styling is `new_ui/css/tutorial.css` (compiled into `app.css` by the running Tailwind watcher).

**Tech Stack:** Vanilla JS (no framework, no build for JS), Tailwind source CSS compiled to `app.css` by the host `./rebuild.sh --watch` (shared bind mount → served at :3003). No backend changes. No JS test harness — verification is balance-checks + live Playwright against `http://localhost:3003` (this repo's established convention; test account `test`/`11111111`, admin `claude`/`0987654321`). Playwright is on the host at `/home/staygold/.local/lib/python3.14/site-packages/playwright`, run with plain `python3`.

## Global Constraints

- Pure `new_ui` — zero API calls from the tutorial; every consequential action (chat, generate, create, save, post) is simulated client-side. Assert this in tests (no `/api/*` chat/generate/comment POST during a lesson).
- The engine never lets a real costly handler fire: costly triggers are intercepted at the capture phase with `stopImmediatePropagation()` + `preventDefault()`.
- One persistent "Skip. Give up. It's fine." control and the ESC key always exit cleanly (idempotent teardown: remove overlay node, remove all installed listeners, clear all timers, restore `document.body`).
- Voice is extremely obtuse, rude, sarcastic, goading — theatrical condescension only, never real hostility or protected-characteristic insults. Exact strings are in the lesson data (Task 3).
- Per-lesson completion persists in `store` under the existing `tutorialProgress` key (a `{lessonKey: true}` map); the hub shows a checkmark for completed lessons.
- The old `confirm()` in the tutorial reset flow is replaced with `await confirmDialog(...)`.
- CSS lives in `new_ui/css/tutorial.css` (source) imported by `new_ui/css/input.css`; never hand-edit `new_ui/css/app.css` (it is the compiled artifact — the watcher regenerates it; verify changes via `curl :3003/css/app.css`).
- Every edit verified live: brace/paren balance, `curl` the served file, then Playwright.

## Real target selectors (verified in the current code — use these exactly)

- Global nav (always in DOM): `[data-route="compendium"]`, `[data-route="parlance"]`, `[data-route="sanctum"]`, `[data-route="dossier"]`.
- Pantheon character card: `.char-card` (its `onclick` navigates to `/c/{id}`).
- Chat: `#chatInput` (textarea), `#chatSend` (button), `#chatThread` (scroll container).
- New Character: route `/sanctum/create`, `#cf_name` (input), `#cSaveBtn` (button).
- Masks: route `/sanctum/masks`, `#masksAddBtn` (opens the new-persona modal), then `#mkName` (input), `#mkSave` (button).
- Forge: route `/sanctum/forge`, `#forgePositive` (textarea), `#forgePreviewBox` (preview container), `.forge-generate-btn` (the generate button when not busy).
- Parlance: route `/parlance`, `.parlance-group-header` (character group toggle).
- Comments: opened via `openCommentsModal('user', ME.username)`; `#commentEmojiBtn`, `#commentInput`, `#commentPicker [data-emoji]`.
- Settings: route `/settings`, `#censorToggle` (global privacy-blur button — only present when `ME.nsfw_allowed`, so the Settings lesson uses the in-screen rows instead; spotlight the appearance row via `[onclick*="settings-appearance"]`).

## Available app globals the engine calls

`navigate(path)`, `currentRoute()` (returns a route key), `store.get(key, default)`/`store.set(key, val)`, `toast(msg)`, `errorToast(msg)`, `confirmDialog(msg, opts)`, `openCommentsModal(type, id)`, `ME` (current user). All are global (non-module scripts). `location.pathname` is the source of truth for the current URL path.

---

### Task 1: TutorialEngine core — overlay, spotlight, click-gate, step runner

**Files:**
- Create: `new_ui/js/tutorial-engine.js`
- Create: `new_ui/css/tutorial.css`
- Modify: `new_ui/css/input.css` (add the import)
- Modify: `new_ui/index.html` (add the engine script before `tutorial.js`)

**Interfaces:**
- Produces: a global `TutorialEngine` class and a singleton `window.tutorialEngine`. Public methods later tasks/lessons use: `tutorialEngine.start(lesson)` where `lesson = { key: string, title: string, steps: Step[] }`; `tutorialEngine.exit()`. A `Step` is `{ route?: string | (() => string), target: string (CSS selector), copy: string, advanceOn: "click"|"input-exact"|"intercept"|"simulate-chat"|"simulate-imagegen", expect?: string, reveal?: string, wrongToast?: string }`. `route` may be a function so a lesson can target a runtime path like the current user's own profile (`() => "/u/" + encodeURIComponent(ME.username)`). Task 2 adds the `intercept`/`simulate-*` handlers; Task 3 supplies real lessons and calls `start`.

- [ ] **Step 1: Create `new_ui/css/tutorial.css`**

```css
#tutorialDim {
  position: fixed;
  inset: 0;
  z-index: 10050;
  pointer-events: none;
}
#tutorialHole {
  position: fixed;
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(8, 8, 10, .74);
  transition: all .18s ease;
  pointer-events: none;
}
#tutorialHole::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 12px;
  border: 2px solid var(--color-accent);
  animation: tutorialPulse 1.4s ease-in-out infinite;
}
@keyframes tutorialPulse {
  0%, 100% { opacity: .55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  #tutorialHole::after { animation: none; opacity: .85; }
}
#tutorialCoach {
  position: fixed;
  z-index: 10052;
  max-width: min(340px, calc(100vw - 24px));
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--color-accent);
  background: var(--color-surface);
  box-shadow: 0 16px 40px -12px rgba(0, 0, 0, .6);
  pointer-events: auto;
}
#tutorialCoach .tut-eyebrow {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--color-accent);
  margin-bottom: 5px;
}
#tutorialCoach .tut-body {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--color-ink);
}
#tutorialCoach .tut-skip {
  margin-top: 12px;
  background: none;
  border: none;
  color: var(--color-muted);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0;
}
#tutorialCoach .tut-skip:hover { color: var(--color-warn); }
```

- [ ] **Step 2: Add the import to `new_ui/css/input.css`**

The file currently imports themes/login/overlay/cards/settings. Add one line after the existing `@import "./cards.css";` line:

```css
@import "./tutorial.css";
```

(Read the file first; place the new import alongside the other component imports, order does not matter functionally.)

- [ ] **Step 3: Create `new_ui/js/tutorial-engine.js` with the core engine**

```javascript
"use strict";

const TUT_WRONG_LINES = [
  "Astonishing. You missed the one glowing thing on the entire screen. It's pulsing. For you.",
  "No. The other one. The one lit up like a landing strip. Try again, ace.",
  "That's not it. It has never been it. It will never be it. Click the glowing thing.",
  "Bold choice, clicking the void. The correct target is, once again, the one screaming for attention.",
  "Incredible instincts. All of them wrong. The highlighted control is right there.",
];

class TutorialEngine {
  constructor() {
    this.active = false;
    this.lesson = null;
    this.idx = 0;
    this.target = null;
    this._onCapture = this._onCapture.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onReposition = this._reposition.bind(this);
    this._pollTimer = null;
    this._simTimers = [];
  }

  start(lesson) {
    if (this.active) this._teardown();
    this.active = true;
    this.lesson = lesson;
    this.idx = 0;
    const dim = document.createElement("div");
    dim.id = "tutorialDim";
    dim.innerHTML = `<div id="tutorialHole"></div>`;
    document.body.appendChild(dim);
    const coach = document.createElement("div");
    coach.id = "tutorialCoach";
    document.body.appendChild(coach);
    document.addEventListener("pointerdown", this._onCapture, true);
    document.addEventListener("click", this._onCapture, true);
    document.addEventListener("keydown", this._onKey, true);
    window.addEventListener("scroll", this._onReposition, true);
    window.addEventListener("resize", this._onReposition);
    this._runStep(0);
  }

  _wrongToast() {
    const line = this.lesson?.steps[this.idx]?.wrongToast
      || TUT_WRONG_LINES[Math.floor(Math.random() * TUT_WRONG_LINES.length)];
    errorToast(line);
  }

  _onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.exit(); }
  }

  _onCapture(e) {
    if (!this.active) return;
    const step = this.lesson.steps[this.idx];
    if (!step || !this.target) return;
    if (e.target.closest && e.target.closest("#tutorialCoach")) return;
    const onTarget = this.target === e.target || this.target.contains(e.target);
    if (!onTarget) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click") this._wrongToast();
      return;
    }
    if (step.advanceOn === "click") {
      if (e.type === "click") setTimeout(() => this._advance(), 0);
      return;
    }
    if (["intercept", "simulate-chat", "simulate-imagegen"].includes(step.advanceOn)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click") this._runInterception(step);
      return;
    }
  }

  _runInterception(step) {
    if (step.advanceOn === "intercept") this._fakeSuccess(step);
    else if (step.advanceOn === "simulate-chat") this._simulateChat(step);
    else if (step.advanceOn === "simulate-imagegen") this._simulateImagegen(step);
  }

  _fakeSuccess(step) { this._advance(); }
  _simulateChat(step) { this._advance(); }
  _simulateImagegen(step) { this._advance(); }

  async _runStep(idx) {
    this.idx = idx;
    const step = this.lesson.steps[idx];
    if (!step) return this._complete();
    const routePath = typeof step.route === "function" ? step.route() : step.route;
    if (routePath && location.pathname !== routePath) navigate(routePath);
    const el = await this._waitFor(step.target);
    if (!this.active) return;
    if (!el) {
      toast("Well this is embarrassing — the thing I wanted to show you isn't here. Moving on, pretend you saw it.");
      return this._advance();
    }
    this.target = el;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => { this._reposition(); this._showCoach(step); }, 260);
    if (step.advanceOn === "input-exact") this._watchInput(step);
  }

  _watchInput(step) {
    const el = this.target;
    const handler = () => {
      if ((el.value || "").trim() === (step.expect || "").trim()) {
        el.removeEventListener("input", handler);
        this._advance();
      }
    };
    el.addEventListener("input", handler);
    this._inputHandler = { el, handler };
  }

  _waitFor(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (!this.active) return resolve(null);
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) return resolve(el);
        if (Date.now() - start > timeout) return resolve(null);
        this._pollTimer = setTimeout(tick, 100);
      };
      tick();
    });
  }

  _reposition() {
    if (!this.active || !this.target) return;
    const hole = document.getElementById("tutorialHole");
    if (!hole) return;
    const r = this.target.getBoundingClientRect();
    const pad = 6;
    hole.style.left = `${r.left - pad}px`;
    hole.style.top = `${r.top - pad}px`;
    hole.style.width = `${r.width + pad * 2}px`;
    hole.style.height = `${r.height + pad * 2}px`;
    this._positionCoach(r);
  }

  _positionCoach(r) {
    const coach = document.getElementById("tutorialCoach");
    if (!coach) return;
    const cw = coach.offsetWidth || 320;
    const ch = coach.offsetHeight || 120;
    let top = r.bottom + 12;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 12);
    let left = Math.min(Math.max(8, r.left), window.innerWidth - cw - 8);
    coach.style.top = `${top}px`;
    coach.style.left = `${left}px`;
  }

  _showCoach(step) {
    const coach = document.getElementById("tutorialCoach");
    if (!coach) return;
    coach.innerHTML = `
      <div class="tut-eyebrow">Step ${this.idx + 1} of ${this.lesson.steps.length}</div>
      <div class="tut-body">${step.copy}</div>
      <button type="button" class="tut-skip">Skip. Give up. It's fine.</button>
    `;
    coach.querySelector(".tut-skip").onclick = () => this.exit();
    const r = this.target.getBoundingClientRect();
    this._positionCoach(r);
  }

  _advance() {
    if (this._inputHandler) {
      this._inputHandler.el.removeEventListener("input", this._inputHandler.handler);
      this._inputHandler = null;
    }
    this._runStep(this.idx + 1);
  }

  _complete() {
    const progress = store.get("tutorialProgress", {});
    progress[this.lesson.key] = true;
    store.set("tutorialProgress", progress);
    const done = this.lesson.done || "Congratulations on doing the single most obvious action available. A parade is not forthcoming.";
    this._teardown();
    toast(done);
    navigate("/tutorial");
  }

  exit() {
    this._teardown();
    navigate("/tutorial");
  }

  _teardown() {
    this.active = false;
    this.target = null;
    clearTimeout(this._pollTimer);
    this._simTimers.forEach((t) => clearTimeout(t));
    this._simTimers = [];
    if (this._inputHandler) {
      this._inputHandler.el.removeEventListener("input", this._inputHandler.handler);
      this._inputHandler = null;
    }
    document.removeEventListener("pointerdown", this._onCapture, true);
    document.removeEventListener("click", this._onCapture, true);
    document.removeEventListener("keydown", this._onKey, true);
    window.removeEventListener("scroll", this._onReposition, true);
    window.removeEventListener("resize", this._onReposition);
    document.getElementById("tutorialDim")?.remove();
    document.getElementById("tutorialCoach")?.remove();
  }
}

if (typeof window !== "undefined") {
  window.TutorialEngine = TutorialEngine;
  window.tutorialEngine = new TutorialEngine();
}
```

- [ ] **Step 4: Add the engine script to `new_ui/index.html` before `tutorial.js`**

Find the existing line `<script src="/js/tutorial.js" defer></script>` and insert the engine script immediately before it:

```html
  <script src="/js/tutorial-engine.js" defer></script>
  <script src="/js/tutorial.js" defer></script>
```

- [ ] **Step 5: Verify balance, served content, CSS compile**

```bash
python3 -c "s=open('/var/home/staygold/ai-frontend/new_ui/js/tutorial-engine.js').read(); print('braces:', s.count('{')-s.count('}'), 'parens:', s.count('(')-s.count(')'))"
curl -s http://localhost:3003/js/tutorial-engine.js | grep -c "class TutorialEngine"
sleep 2
curl -s http://localhost:3003/css/app.css | grep -c "tutorialHole"
curl -s http://localhost:3003/ | grep -c "tutorial-engine.js"
```
Expected: `braces: 0 parens: 0`; each grep `1` or more (confirms the engine is served, the CSS compiled into app.css, and the script tag is present).

- [ ] **Step 6: Playwright-verify the core (spotlight, gate, click-advance, input-exact, ESC)**

Write `/tmp/verify_tut1.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={"width":390,"height":800})
    errors=[]; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]',"test"); page.fill('[data-field="password"]',"11111111")
    page.click('[data-auth-submit="signin"]'); page.wait_for_timeout(2000)
    # start a hardcoded 2-step lesson: click the Parlance nav, then type-exact into the search box
    page.evaluate("""() => {
      tutorialEngine.start({ key: "_probe", title: "probe", steps: [
        { target: '[data-route="parlance"]', copy: "click parlance", advanceOn: "click", route: null },
        { route: "/parlance", target: "#parlanceSearch", copy: "type it", advanceOn: "input-exact", expect: "hello" },
      ]});
    }""")
    page.wait_for_timeout(600)
    assert page.is_visible("#tutorialDim") and page.is_visible("#tutorialCoach"), "overlay should show"
    # wrong click (on the header logo) should be blocked + toast, not navigate
    page.click("text=StoryHaven AI", force=True)
    page.wait_for_timeout(400)
    assert page.is_visible("#tutorialCoach"), "wrong click must not tear down the tutorial"
    # correct click advances to step 2 (navigates to parlance)
    page.click('[data-route="parlance"]')
    page.wait_for_timeout(1500)
    # step 2: typing the exact text advances -> lesson completes -> overlay gone
    page.fill("#parlanceSearch", "hello")
    page.wait_for_timeout(800)
    assert not page.is_visible("#tutorialCoach"), "exact input should complete the lesson and remove overlay"
    # ESC teardown from a fresh lesson
    page.evaluate("""() => tutorialEngine.start({key:"_p2",title:"p",steps:[{target:'[data-route=\\"parlance\\"]',copy:"x",advanceOn:"click"}]})""")
    page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    assert not page.is_visible("#tutorialCoach"), "ESC should tear down"
    print("errors:", errors); assert errors == []
    print("PASS"); b.close()
```
Run: `python3 /tmp/verify_tut1.py`
Expected: `PASS`, empty errors.

- [ ] **Step 7: Commit**

```bash
git add new_ui/js/tutorial-engine.js new_ui/css/tutorial.css new_ui/css/input.css new_ui/css/app.css new_ui/index.html
git commit -m "Add TutorialEngine core: spotlight overlay, capture-phase click gate, step runner with route nav + click/input-exact advance, ESC/skip teardown"
```

---

### Task 2: Interception + chat & image-gen simulations

**Files:**
- Modify: `new_ui/js/tutorial-engine.js` (replace the three stub methods `_fakeSuccess`/`_simulateChat`/`_simulateImagegen`)

**Interfaces:**
- Consumes: the engine from Task 1 (`this.target`, `this.idx`, `this.lesson`, `this._advance()`, `this._simTimers`, `this._showCoach`-style coach access).
- Produces: working `intercept` (fake success beat), `simulate-chat` (fake streaming reply into `#chatThread`), and `simulate-imagegen` (fake generation in `#forgePreviewBox` with video + CSS fallback) advance handlers, driven by the same `Step` fields plus `step.reveal` (the smug post-simulation reveal copy).

- [ ] **Step 1: Replace the three stub methods in `new_ui/js/tutorial-engine.js`**

Replace:
```javascript
  _fakeSuccess(step) { this._advance(); }
  _simulateChat(step) { this._advance(); }
  _simulateImagegen(step) { this._advance(); }
```
with:
```javascript
  _coachReveal(text, thenAdvance = true) {
    const coach = document.getElementById("tutorialCoach");
    if (coach) {
      coach.querySelector(".tut-body").innerHTML = text;
    }
    const t = setTimeout(() => { if (this.active && thenAdvance) this._advance(); }, 2600);
    this._simTimers.push(t);
  }

  _fakeSuccess(step) {
    toast(step.successToast || "Done. Except it isn't — nothing was actually saved. This is a rehearsal, not a life.");
    this._coachReveal(step.reveal || "See? You could have. We both know you'll do it wrong later anyway.");
  }

  _simulateChat(step) {
    const input = document.getElementById("chatInput");
    const thread = document.getElementById("chatThread");
    if (!input || !thread) return this._advance();
    const userText = (input.value || "").trim();
    input.value = "";
    const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };
    const userBubble = document.createElement("div");
    userBubble.style.cssText = "display:flex;justify-content:flex-end;margin:10px 0";
    userBubble.innerHTML = `<div class="chat-bubble" style="max-width:80%;background:var(--color-accent);color:var(--color-paper-base,#0C0C0E);padding:9px 12px;border-radius:14px"><div class="sym-body">${esc(userText)}</div></div>`;
    thread.appendChild(userBubble);
    thread.scrollTop = thread.scrollHeight;
    const aiWrap = document.createElement("div");
    aiWrap.style.cssText = "display:flex;justify-content:flex-start;margin:10px 0";
    aiWrap.innerHTML = `<div class="chat-bubble" style="max-width:82%;background:var(--color-surface-2);color:var(--color-ink);padding:9px 12px;border-radius:14px"><div class="sym-body tut-ai-body"><span class="tut-dots">…</span></div></div>`;
    thread.appendChild(aiWrap);
    thread.scrollTop = thread.scrollHeight;
    const body = aiWrap.querySelector(".tut-ai-body");
    const reply = step.simReply || "Ah, a challenger appears. *tilts head* You typed exactly what you were told, like a very good little participant. I'd be impressed if this were real. It is not.";
    const chunks = reply.match(/\S+\s*/g) || [reply];
    let i = 0;
    const thinkT = setTimeout(() => {
      body.innerHTML = "";
      const step2 = () => {
        if (!this.active) return;
        if (i >= chunks.length) {
          this._coachReveal(step.reveal || "Riveting exchange. Also entirely fake — no model was troubled, no GPU woke up. That was a recording of enthusiasm you'll never actually receive.");
          return;
        }
        body.textContent += chunks[i++];
        thread.scrollTop = thread.scrollHeight;
        const t = setTimeout(step2, 20 + Math.random() * 45);
        this._simTimers.push(t);
      };
      step2();
    }, 750);
    this._simTimers.push(thinkT);
  }

  _simulateImagegen(step) {
    const box = document.getElementById("forgePreviewBox");
    if (!box) return this._advance();
    const result = step.simResult || "";
    const finish = () => {
      box.innerHTML = result
        ? `<img src="${result}" alt="" style="width:100%;height:100%;object-fit:cover">`
        : `<div style="display:grid;place-items:center;height:100%;color:var(--color-sec);font-size:13px">✦ Masterpiece ✦</div>`;
      this._coachReveal(step.reveal || "Magnificent. It's also a recording I made earlier. Your prompt did precisely nothing. It's very pretty though, isn't it.");
    };
    const video = document.createElement("video");
    video.src = step.simVideo || "/tutorial-imagegen.webm";
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.style.cssText = "width:100%;height:100%;object-fit:cover";
    let usedFallback = false;
    const fallback = () => {
      if (usedFallback) return; usedFallback = true;
      box.innerHTML = `
        <div style="position:absolute;inset:0;background:var(--color-surface-2);filter:blur(18px);animation:none" id="tutGenBlur"></div>
        <div style="position:absolute;left:0;bottom:0;height:4px;width:0;background:var(--color-accent);transition:width .1s" id="tutGenBar"></div>
        <div style="position:relative;color:var(--color-sec);font-size:12px;font-family:var(--font-mono)">denoising…</div>`;
      const bar = box.querySelector("#tutGenBar");
      const blur = box.querySelector("#tutGenBlur");
      let pct = 0;
      const stepBar = () => {
        if (!this.active) return;
        pct += 4 + Math.random() * 6;
        if (bar) bar.style.width = Math.min(100, pct) + "%";
        if (blur) blur.style.filter = `blur(${Math.max(0, 18 - pct / 6)}px)`;
        if (pct < 100) { const t = setTimeout(stepBar, 180); this._simTimers.push(t); }
        else finish();
      };
      stepBar();
    };
    video.onerror = fallback;
    video.onended = finish;
    box.innerHTML = "";
    box.appendChild(video);
    // If the video can't even start within 1.2s, fall back.
    const guard = setTimeout(() => { if (!usedFallback && (video.readyState < 2 || video.paused)) fallback(); }, 1200);
    this._simTimers.push(guard);
  }
```

- [ ] **Step 2: Verify balance and served content**

```bash
python3 -c "s=open('/var/home/staygold/ai-frontend/new_ui/js/tutorial-engine.js').read(); print('braces:', s.count('{')-s.count('}'), 'parens:', s.count('(')-s.count(')'))"
curl -s http://localhost:3003/js/tutorial-engine.js | grep -c "_coachReveal\|simReply\|forgePreviewBox"
```
Expected: `braces: 0 parens: 0`; grep `3` or more.

- [ ] **Step 3: Playwright-verify simulations fire with zero API calls**

Write `/tmp/verify_tut2.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={"width":390,"height":800})
    api_calls = []
    page.on("request", lambda r: api_calls.append(r.url) if ("/api/" in r.url and r.method == "POST") else None)
    errors=[]; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]',"test"); page.fill('[data-field="password"]',"11111111")
    page.click('[data-auth-submit="signin"]'); page.wait_for_timeout(2000)
    # Drive a hardcoded chat-sim step directly on a chat route. Use any existing session if present,
    # else just inject a fake #chatThread + #chatInput to exercise the simulation in isolation.
    page.evaluate("""() => {
      if (!document.getElementById('chatThread')) {
        const t = document.createElement('div'); t.id='chatThread'; document.body.appendChild(t);
        const i = document.createElement('textarea'); i.id='chatInput'; i.value='hi'; document.body.appendChild(i);
        const s = document.createElement('button'); s.id='chatSend'; s.textContent='Send'; document.body.appendChild(s);
      }
      tutorialEngine.start({ key:"_simchat", title:"x", steps:[
        { target:"#chatSend", copy:"send it", advanceOn:"simulate-chat", reveal:"FAKE.", simReply:"one two three four five" }
      ]});
    }""")
    page.wait_for_timeout(600)
    api_calls.clear()  # ignore anything before the sim
    page.click("#chatSend")
    page.wait_for_timeout(3500)  # let the streaming + reveal run
    thread_txt = page.eval_on_selector("#chatThread", "el => el.innerText")
    print("thread after sim:", thread_txt[:120])
    assert "one two three" in thread_txt, "simulated reply should stream into the thread"
    chat_posts = [u for u in api_calls if "chat" in u or "sessions" in u or "comments" in u]
    print("chat/generate POSTs during sim (must be 0):", chat_posts)
    assert chat_posts == [], "simulation must make no real API calls"
    print("errors:", errors); assert errors == []
    print("PASS"); b.close()
```
Run: `python3 /tmp/verify_tut2.py`
Expected: `PASS`, `chat/generate POSTs during sim (must be 0): []`.

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/tutorial-engine.js
git commit -m "TutorialEngine simulations: fake-success beat, canned chat streaming, image-gen video with CSS fallback — all client-side, zero API calls"
```

---

### Task 3: Lesson data + hub view + launcher wiring

**Files:**
- Modify (full rewrite of the class + data): `new_ui/js/tutorial.js`

**Interfaces:**
- Consumes: `tutorialEngine.start(lesson)`/`tutorialEngine.exit()` from Tasks 1–2; `store`, `confirmDialog`, `navigate`, `pageHeaderHtml`, `backLinkHtml`, `_esc`, `ME`.
- Produces: a global `TUTORIAL_LESSONS` array and a rewritten `TutorialView` (the `/tutorial` hub) that lists lessons with completion checkmarks and launches each via `tutorialEngine.start(...)`. The router already maps `tutorial: (main) => { window._activeTutorialView = new TutorialView(); ... }` — keep that entry working (same class name, same `mount(main)` signature).

- [ ] **Step 1: Replace the entire contents of `new_ui/js/tutorial.js`**

Replace the whole file (the old `TUTORIAL_CHAPTERS` data and `TutorialView` class) with:

```javascript
"use strict";

const TUTORIAL_LESSONS = [
  {
    key: "browse", title: "Finding a character (yes, they're right there)", icon: "🔎",
    blurb: "Locate a character. On a screen full of them. Somehow a challenge for you.",
    done: "You found a character. On the character page. Truly the frontier of human achievement.",
    steps: [
      { target: '[data-route="compendium"]', copy: "This is Compendium — everything the community made, catalogued. Click it. A menu appears. Try to contain yourself.", advanceOn: "click" },
      { target: '[onclick*="pantheon"]', copy: "Pantheon is where the characters live. Click it. We're inching toward you interacting with something.", advanceOn: "click" },
      { route: "/pantheon", target: ".char-card", copy: "That rectangle with a face is a character. Click it to open it. Yes, the picture. The big obvious one.", advanceOn: "click" },
    ],
  },
  {
    key: "chat", title: "Talking. With words.", icon: "💬",
    blurb: "Type a message and send it. The bar is on the floor and you're still tripping.",
    done: "You sent a message into a conversation that never happened. Beautiful, in a hollow sort of way.",
    steps: [
      { target: "#chatInput", copy: "This box is where words go. Type EXACTLY: <b>Hello there.</b> — no improvising, you'll only hurt yourself.", advanceOn: "input-exact", expect: "Hello there." },
      { target: "#chatSend", copy: "Now hit send. Watch the magic. (It's not magic. It's a recording. But look busy.)", advanceOn: "simulate-chat", simReply: "Hello there. *smiles faintly* You typed exactly what the tutorial demanded, which is the most obedient thing you'll do all day. Sadly none of this is real — I'm a canned line, and you're doing a tutorial. We've both made choices.", reveal: "That reply? Pre-written. No model, no GPU, no spark of anything. You practiced small talk with a corpse. Onward." },
    ],
  },
  {
    key: "create", title: "Making your own (brace yourself)", icon: "🧵",
    blurb: "Fill one field and press a button. We'll stop you before you create actual garbage.",
    done: "A character was almost born. We spared the world. You're welcome.",
    steps: [
      { route: "/sanctum/create", target: "#cf_name", copy: "Every character needs a name. Type EXACTLY: <b>Tutorial Test</b> — I've picked it for you, since your judgment is clearly on trial.", advanceOn: "input-exact", expect: "Tutorial Test" },
      { route: "/sanctum/create", target: "#cSaveBtn", copy: "This creates the character. Click it and marvel. We won't actually save it — the archive has standards.", advanceOn: "intercept", reveal: "Nothing was created. Nothing was saved. It was a fire drill for your fingers. The real button works exactly the same, for when you're trusted with consequences." },
    ],
  },
  {
    key: "masks", title: "Your masks", icon: "🎭",
    blurb: "Make a persona. It's you, but with less to apologize for.",
    done: "A mask, unmade. Much like your understanding, moments ago.",
    steps: [
      { route: "/sanctum/masks", target: "#masksAddBtn", copy: "A persona is who YOU are in a story. Click the add button to make one. It's the glowing one. It's always the glowing one.", advanceOn: "click" },
      { target: "#mkName", copy: "Name your persona. Type EXACTLY: <b>Me But Cooler</b> — aspirational, I know.", advanceOn: "input-exact", expect: "Me But Cooler" },
      { target: "#mkSave", copy: "Save it. Or 'save' it — we're not actually keeping this. Click.", advanceOn: "intercept", reveal: "Unsaved, unmourned. But now you know where the button is, which is more than we assumed walking in." },
    ],
  },
  {
    key: "forge", title: "Making pictures", icon: "🖼️",
    blurb: "Describe an image and generate it. Prepare to be lied to, convincingly.",
    done: "An image, generated entirely in your imagination and my pre-rendered footage.",
    steps: [
      { route: "/sanctum/forge", target: "#forgePositive", copy: "Describe the image here. Type EXACTLY: <b>a cat in a tiny hat</b> — bold, timeless, achievable.", advanceOn: "input-exact", expect: "a cat in a tiny hat" },
      { route: "/sanctum/forge", target: ".forge-generate-btn", copy: "Hit Generate and watch it cook. (It's a video. Of a cook that already happened. You're watching a rerun.)", advanceOn: "simulate-imagegen", reveal: "That was a recording. Your prompt moved zero electrons. No GPU was harmed, or even mildly inconvenienced. Gorgeous cat though." },
    ],
  },
  {
    key: "parlance", title: "Your conversations, sorted for you", icon: "🗂️",
    blurb: "Expand a group. Click a triangle. We're really scraping the difficulty barrel now.",
    done: "You expanded a group. The triangle turned. Civilization advances.",
    steps: [
      { route: "/parlance", target: ".parlance-group-header", copy: "Conversations are grouped by character. Click a header to expand it. The little + / − is doing its best to signal this.", advanceOn: "click" },
    ],
  },
  {
    key: "comments", title: "Comments, emoji, stickers", icon: "😐",
    blurb: "Open the emoji picker and pick one. Try not to overthink a smiley.",
    done: "One emoji, selected. A rich inner life, expressed at last.",
    steps: [
      { route: () => "/u/" + encodeURIComponent(ME?.username || ""), target: '[onclick*="openCommentsModal"]', copy: "This is your own glorious profile. That 'Comments' button opens the comment panel. Click it. People might one day say things here. Probably not to you.", advanceOn: "click" },
      { target: "#commentEmojiBtn", copy: "That 🙂 opens the emoji picker. Click it. Express something. Anything. This is the most feeling you'll show all week.", advanceOn: "click" },
      { target: "#commentPicker [data-emoji]", copy: "Pick an emoji. Any of them. They each convey more personality than you've managed this entire tutorial.", advanceOn: "click" },
    ],
  },
  {
    key: "settings", title: "Settings & the panic button", icon: "⚙️",
    blurb: "Find the blur button. For when someone glances at your screen and your dignity.",
    done: "You found the settings. Your secrets are as safe as your competence allows.",
    steps: [
      { route: "/settings", target: '[onclick*="settings-appearance"]', copy: "This is where the app bends to your will — themes, safety, your password. Click the appearance row to prove you can.", advanceOn: "click" },
    ],
  },
];

class TutorialView {
  async mount(main) {
    this.main = main;
    this.progress = store.get("tutorialProgress", {});
    this.render();
  }

  launch(key) {
    const lesson = TUTORIAL_LESSONS.find((l) => l.key === key);
    if (!lesson) return;
    tutorialEngine.start(lesson);
  }

  async resetProgress() {
    if (!(await confirmDialog("Reset your tutorial progress? It just clears the checkmarks — your fragile ego is untouched.", { confirmLabel: "Reset", danger: false }))) return;
    this.progress = {};
    store.set("tutorialProgress", {});
    this.render();
  }

  render() {
    const done = TUTORIAL_LESSONS.filter((l) => this.progress[l.key]).length;
    this.main.innerHTML = `
      ${backLinkHtml("My Dossier")}
      ${pageHeaderHtml("My Dossier", "Tutorial", "Tutorial", "You clicked Tutorial. On an interface engineered so a concussed raccoon could use it. Let's begin, champion.")}
      <div style="margin-bottom:16px;font-size:12px;color:var(--color-sec)">${done} of ${TUTORIAL_LESSONS.length} lessons survived. Each one launches you into the real app and won't let you leave until you do the one correct thing.</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${TUTORIAL_LESSONS.map((l) => `
          <button type="button" onclick="_activeTutorialView.launch('${l.key}')" style="width:100%;display:flex;align-items:center;gap:12px;padding:14px;border-radius:14px;border:1px solid ${this.progress[l.key] ? "var(--color-accent)" : "var(--color-line)"};background:var(--color-surface);cursor:pointer;text-align:left">
            <span style="flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-size:18px;background:linear-gradient(150deg, var(--color-accent), var(--color-accent-deep))">${l.icon}</span>
            <span style="flex:1;min-width:0">
              <span class="font-display" style="display:block;font-weight:600;font-size:15px;color:var(--color-ink)">${_esc(l.title)}</span>
              <span style="display:block;font-size:12px;color:var(--color-sec)">${_esc(l.blurb)}</span>
            </span>
            ${this.progress[l.key] ? `<span style="flex:none;color:var(--color-accent);font-size:18px">&check;</span>` : `<span style="flex:none;color:var(--color-muted)">&rsaquo;</span>`}
          </button>
        `).join("")}
      </div>
      <button type="button" onclick="_activeTutorialView.resetProgress()" style="margin-top:14px;background:none;border:none;color:var(--color-muted);font-size:11.5px;cursor:pointer">Reset tutorial progress</button>
    `;
  }
}

if (typeof window !== "undefined") {
  window.TutorialView = TutorialView;
  window.TUTORIAL_LESSONS = TUTORIAL_LESSONS;
}
```

- [ ] **Step 2: Verify balance and served content**

```bash
python3 -c "s=open('/var/home/staygold/ai-frontend/new_ui/js/tutorial.js').read(); print('braces:', s.count('{')-s.count('}'), 'parens:', s.count('(')-s.count(')'))"
curl -s http://localhost:3003/js/tutorial.js | grep -c "TUTORIAL_LESSONS\|tutorialEngine.start"
```
Expected: `braces: 0 parens: 0`; grep `2` or more.

- [ ] **Step 3: Playwright-verify the hub launches a real lesson end-to-end**

Write `/tmp/verify_tut3.py`:
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={"width":390,"height":800})
    errors=[]; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:3003/", wait_until="networkidle", timeout=15000)
    page.fill('[data-field="username"]',"test"); page.fill('[data-field="password"]',"11111111")
    page.click('[data-auth-submit="signin"]'); page.wait_for_timeout(2000)
    page.goto("http://localhost:3003/tutorial", wait_until="networkidle", timeout=15000)
    page.wait_for_timeout(800)
    # hub lists lessons
    assert page.query_selector('button[onclick*="launch(\'parlance\')"]'), "hub should list the parlance lesson"
    # launch the single-step parlance lesson
    page.click('button[onclick*="launch(\'parlance\')"]')
    page.wait_for_timeout(1800)
    assert page.is_visible("#tutorialCoach"), "launching should open the overlay on the parlance screen"
    # do the correct thing -> lesson completes -> checkmark on return to hub
    hdr = page.query_selector(".parlance-group-header")
    if hdr:
        hdr.click(); page.wait_for_timeout(1500)
        # completing navigates back to /tutorial; the parlance lesson should now show a checkmark
        assert "/tutorial" in page.url, "completing a lesson returns to the hub"
    print("errors:", errors); assert errors == []
    print("PASS"); b.close()
```
Run: `python3 /tmp/verify_tut3.py`
Expected: `PASS`. (If the `test` account has zero conversations, `.parlance-group-header` may be absent — in that case the engine's 5s timeout skips the step with a sarcastic toast and still completes; the assertion on returning to `/tutorial` still holds. Note this in the task report if it occurs.)

- [ ] **Step 4: Commit**

```bash
git add new_ui/js/tutorial.js
git commit -m "Replace passive tutorial with interactive lesson hub: 8 forced-action lessons in a sarcastic voice, launched into the real app via TutorialEngine"
```

---

## Final verification (after all tasks)

- [ ] Re-run `/tmp/verify_tut1.py`, `/tmp/verify_tut2.py`, `/tmp/verify_tut3.py` in sequence — all `PASS`.
- [ ] Manually launch each of the 8 lessons from `/tutorial` in a real browser as the `test` account; for each, confirm: the overlay spotlights the right control, a deliberate wrong click toasts and does not proceed, the correct action advances, `input-exact` steps refuse to advance until the exact text is typed, the chat and forge lessons stream/animate a fake result and make no network request (watch the Network panel — no `/api/*/chat` or `/api/imagegen/*` POST), and ESC/Skip exits cleanly back to the hub at any point.
- [ ] Confirm no `confirm(` remains in `new_ui/js/tutorial.js` (`grep -c "confirm(" new_ui/js/tutorial.js` returns only `confirmDialog` usages).
