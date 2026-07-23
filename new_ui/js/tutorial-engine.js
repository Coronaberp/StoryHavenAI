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
    this._ready = false;
    this._rafId = null;
    this._onCapture = this._onCapture.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onReposition = this._reposition.bind(this);
    this._loop = this._loop.bind(this);
    this._pollTimer = null;
    this._simTimers = [];
  }

  _liveTarget() {
    const step = this.lesson?.steps[this.idx];
    if (!step || !step.target) return null;
    return [...document.querySelectorAll(step.target)].find((e) => e.offsetParent !== null) || null;
  }

  _loop() {
    if (!this.active) return;
    this._reposition();
    this._rafId = requestAnimationFrame(this._loop);
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
    this._loop();
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
    if (!this.active || !this._ready) return;
    const step = this.lesson.steps[this.idx];
    if (!step) return;
    if (e.target.closest && e.target.closest("#tutorialCoach")) return;
    const onTarget = step.target && e.target.closest && e.target.closest(step.target);
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
    if (["intercept", "simulate-chat", "simulate-imagegen", "upload-simulate"].includes(step.advanceOn)) {
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
    else if (step.advanceOn === "upload-simulate") this._simulateUpload(step);
  }

  _simulateUpload(step) {
    const box = step.uploadTarget ? document.querySelector(step.uploadTarget) : null;
    if (box && step.uploadPreviewHtml) box.insertAdjacentHTML("beforeend", step.uploadPreviewHtml);
    this._coachReveal(step.reveal || "A file, allegedly chosen. Nothing left this browser tab.");
  }

  _coachReveal(text, thenAdvance = true) {
    const coach = document.getElementById("tutorialCoach");
    if (coach) {
      coach.querySelector(".tut-body").innerHTML = text;
    }
    const t = setTimeout(() => { if (this.active && thenAdvance) this._advance(); }, 2600);
    this._simTimers.push(t);
  }

  _fakeSuccess(step) {
    toast(step.successToast || "Done. Except it isn't - nothing was actually saved. This is a rehearsal, not a life.");
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
          this._coachReveal(step.reveal || "Riveting exchange. Also entirely fake - no model was troubled, no GPU woke up. That was a recording of enthusiasm you'll never actually receive.");
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
    const guard = setTimeout(() => { if (!usedFallback && (video.readyState < 2 || video.paused)) fallback(); }, 1200);
    this._simTimers.push(guard);
  }

  async _runStep(idx) {
    this.idx = idx;
    this._ready = false;
    const step = this.lesson.steps[idx];
    if (!step) return this._complete();
    const routePath = typeof step.route === "function" ? step.route() : step.route;
    if (routePath && location.pathname !== routePath) navigate(routePath);
    if (step.setup) step.setup();
    const el = await this._waitFor(step.target, 5000, step.setup);
    if (!this.active) return;
    if (!el) {
      toast("Well this is embarrassing - the thing I wanted to show you isn't here. Moving on, pretend you saw it.");
      return this._advance();
    }
    this.target = el;
    this._ready = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    this._showCoach(step);
    if (step.advanceOn === "input-exact") {
      this._watchValue(step, "input", (el) => (el.value || "").trim() === (step.expect || "").trim());
    } else if (step.advanceOn === "select") {
      this._watchValue(step, "change", (el) => el.value === step.expect);
    } else if (step.advanceOn === "toggle") {
      this._watchValue(step, "change", (el) => el.checked === (step.expect !== false));
    }
  }

  _watchValue(step, eventName, matchFn) {
    const handler = (e) => {
      const el = e.target;
      if (el && el.matches && el.matches(step.target) && matchFn(el)) this._advance();
    };
    document.addEventListener(eventName, handler, true);
    this._valueHandler = { eventName, handler };
  }

  _waitFor(selector, timeout = 5000, onTick) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (!this.active) return resolve(null);
        let el = [...document.querySelectorAll(selector)].find((e) => e.offsetParent !== null);
        if (!el && onTick) {
          onTick();
          el = [...document.querySelectorAll(selector)].find((e) => e.offsetParent !== null);
        }
        if (el) return resolve(el);
        if (Date.now() - start > timeout) return resolve(null);
        this._pollTimer = setTimeout(tick, 100);
      };
      tick();
    });
  }

  _reposition() {
    if (!this.active) return;
    const hole = document.getElementById("tutorialHole");
    let t = this._liveTarget();
    if (!t) {
      const step = this.lesson?.steps[this.idx];
      if (step?.setup) { step.setup(); t = this._liveTarget(); }
    }
    if (!hole || !t) return;
    const r = t.getBoundingClientRect();
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
      <div class="tut-eyebrow">${window.t("tutorial_engine_step_prefix")} ${this.idx + 1} ${window.t("tutorial_engine_step_of")} ${this.lesson.steps.length}</div>
      <div class="tut-body">${step.copy}</div>
      <button type="button" class="tut-skip">${window.t("tutorial_engine_skip")}</button>
    `;
    coach.querySelector(".tut-skip").onclick = () => this.exit();
    const t = this._liveTarget();
    if (t) this._positionCoach(t.getBoundingClientRect());
  }

  _advance() {
    if (this._valueHandler) {
      document.removeEventListener(this._valueHandler.eventName, this._valueHandler.handler, true);
      this._valueHandler = null;
    }
    this._ready = false;
    this._runStep(this.idx + 1);
  }

  _complete() {
    const progress = store.get("tutorialProgress", {});
    progress[this.lesson.key] = true;
    store.set("tutorialProgress", progress);
    const done = this.lesson.done || "Congratulations on doing the single most obvious action available. A parade is not forthcoming.";
    this._teardown();
    toast(done);
    this._returnToHub();
  }

  exit() {
    this._teardown();
    this._returnToHub();
  }

  _returnToHub() {
    navigate("/tutorial");
    [300, 800, 1500, 3000].forEach((delay) => {
      setTimeout(() => { if (location.pathname === "/tutorial") route(); }, delay);
    });
  }

  _teardown() {
    this.active = false;
    this.target = null;
    this._ready = false;
    cancelAnimationFrame(this._rafId);
    clearTimeout(this._pollTimer);
    this._simTimers.forEach((t) => clearTimeout(t));
    this._simTimers = [];
    if (this._valueHandler) {
      document.removeEventListener(this._valueHandler.eventName, this._valueHandler.handler, true);
      this._valueHandler = null;
    }
    document.removeEventListener("pointerdown", this._onCapture, true);
    document.removeEventListener("click", this._onCapture, true);
    document.removeEventListener("keydown", this._onKey, true);
    window.removeEventListener("scroll", this._onReposition, true);
    window.removeEventListener("resize", this._onReposition);
    document.getElementById("tutorialDim")?.remove();
    document.getElementById("tutorialCoach")?.remove();
    document.querySelectorAll(".tutorial-injected").forEach((el) => el.remove());
    let guard = 0;
    while (document.body.classList.contains("modal-open") && guard++ < 10) closeTopModal();
  }
}

if (typeof window !== "undefined") {
  window.TutorialEngine = TutorialEngine;
  window.tutorialEngine = new TutorialEngine();
}
