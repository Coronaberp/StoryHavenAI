"use strict";

function spineStitchHtml(currentStep, totalSteps) {
  const labels = ["Volume", "Seal"];
  const segments = [];
  for (let step = 1; step <= totalSteps; step++) {
    const filled = step <= currentStep;
    segments.push(`
      <div class="flex-1 flex flex-col items-center gap-1.5">
        <div ${filled ? "data-stitch-filled" : ""} class="w-full h-[3px] rounded-full ${filled ? "bg-primary" : "bg-line-2"}"></div>
        <span class="font-mono text-[9px] tracking-[.14em] uppercase ${filled ? "text-primary" : "text-muted"}">${labels[step - 1] || step}</span>
      </div>
    `);
  }
  return `<div class="flex gap-2 mb-4">${segments.join("")}</div>`;
}

function ensureHeroChrome() {
  const el = document.getElementById("heroChrome");
  if (!el) return null;
  if (!el.dataset.rendered) {
    el.innerHTML = `
      <div class="relative overflow-hidden flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, color-mix(in srgb, var(--color-accent) 22%, var(--color-paper)) 0%, var(--color-paper) 46%, var(--color-paper) 78%)">
        <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">${loginEmbers()}</div>
        <div class="relative z-[1] flex-none">${loginEmblem()}</div>
      </div>
    `;
    el.dataset.rendered = "true";
  }
  el.classList.remove("hidden");
  return el;
}

function hideHeroChrome() {
  document.getElementById("heroChrome")?.classList.add("hidden");
}

function ensureAuthGalleryHost() {
  const el = document.getElementById("authGalleryHost");
  if (el) el.classList.remove("hidden");
  return el;
}

function hideAuthGalleryHost() {
  document.getElementById("authGalleryHost")?.classList.add("hidden");
}

function heroScene(main, innerHtml) {
  const chrome = ensureHeroChrome();
  const galleryHost = ensureAuthGalleryHost();
  main.innerHTML = `
    <div class="md:hidden absolute inset-0 overflow-y-auto flex flex-col" style="background:var(--color-paper)">
      <div data-hero-chrome-slot class="flex-none"></div>
      <div class="relative flex-1 px-6 pb-6 flex flex-col justify-center">
        <div class="login-in w-full max-w-[320px] mx-auto py-4">
          ${innerHtml}
          <button type="button" onclick="navigate('/explore/characters')" class="mt-5 w-fit mx-auto text-[12.5px] text-sec border-b border-dashed flex items-center justify-center gap-1.5" style="border-color:var(--color-line)">
            ${t("auth_continue_browsing")}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="hidden md:flex absolute inset-0 items-center justify-center overflow-hidden" style="background:var(--color-paper)">
      <div data-auth-gallery-slot class="absolute inset-0"></div>
      <div class="login-in relative grid grid-cols-2 w-[min(760px,92vw)] rounded-[20px] border overflow-hidden" style="border-color:var(--color-line);background:color-mix(in srgb, var(--color-paper-elevated, var(--color-surface)) 45%, transparent);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)">
        <div class="relative flex flex-col items-center justify-center text-center px-9 py-10 border-r" style="border-color:var(--color-line);background:radial-gradient(120% 70% at 50% 10%, color-mix(in srgb, var(--color-accent) 22%, transparent) 0%, transparent 55%)">
          ${loginEmblem()}
        </div>
        <div class="flex flex-col justify-center px-9 py-10">
          ${innerHtml}
          <button type="button" onclick="navigate('/explore/characters')" class="mt-5 text-center text-[12.5px] text-sec border-b border-dashed inline-flex items-center justify-center gap-1.5 self-center" style="border-color:var(--color-line)">
            ${t("auth_continue_browsing")}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
  const slot = main.querySelector("[data-hero-chrome-slot]");
  if (chrome && slot) slot.appendChild(chrome);
  const gallerySlot = main.querySelector("[data-auth-gallery-slot]");
  if (galleryHost && gallerySlot) gallerySlot.appendChild(galleryHost);
  startAuthGallery(galleryHost);
}

function compactLogoRow() {
  return `
    <div class="flex items-center justify-center gap-2.5">
      <div class="w-10 h-10 flex-none text-primary">
        <svg viewBox="0 0 500 500" width="100%" height="100%"><g>${SH_LOGO_PATHS}</g></svg>
      </div>
      <div class="flex flex-col leading-tight text-left">
        <span class="font-display text-[15px] font-semibold text-ink tracking-wide">StoryHaven AI</span>
        <span class="text-[10px] italic text-muted">${t("auth_tagline")}</span>
      </div>
    </div>
  `;
}

function compactScene(main, innerHtml) {
  hideHeroChrome();
  main.innerHTML = `
    <div class="absolute inset-0 overflow-y-auto flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, color-mix(in srgb, var(--color-accent) 22%, var(--color-paper)) 0%, var(--color-paper) 46%, var(--color-paper) 78%)">
      <div class="relative z-[1] flex-none pt-8 px-6">${compactLogoRow()}</div>
      <div class="relative z-[2] flex-1 px-6 py-4 flex flex-col justify-center">
        <div class="login-in w-full max-w-[320px] mx-auto py-2">${innerHtml}</div>
      </div>
    </div>
  `;
}

const AUTH_GALLERY_MAX_CONCURRENT = 5;
const AUTH_GALLERY_LANES = 9;
const AUTH_GALLERY_MIN_WIDTH = 130;
const AUTH_GALLERY_MAX_WIDTH = 190;

let _authGalleryPool = null;
let _authGalleryContainer = null;
let _authGalleryInterval = null;

async function _loadAuthGalleryPool() {
  if (_authGalleryPool) return _authGalleryPool;
  const [characters, images] = await Promise.all([
    api("/api/characters").catch(() => []),
    api("/api/imagegen/community").catch(() => []),
  ]);
  const fromCharacters = (characters || [])
    .filter((c) => c.avatar && !c.is_explicit)
    .map((c) => ({ src: c.avatar }));
  const fromImages = (images || [])
    .filter((i) => i.media_type !== "video" && !i.is_explicit)
    .map((i) => ({ src: i.image }));
  _authGalleryPool = [...fromCharacters, ...fromImages];
  return _authGalleryPool;
}

function _authGalleryLaneToX(lane, stageWidth, cardWidth, occupied) {
  const laneWidth = stageWidth / AUTH_GALLERY_LANES;
  const jitter = (Math.random() - 0.5) * Math.max(laneWidth - cardWidth, 0) * 0.5;
  return lane * laneWidth + (laneWidth - cardWidth) / 2 + jitter;
}

function _authGalleryPickSpreadLane(freeLanes, occupiedLanes) {
  if (!occupiedLanes.size) return freeLanes[Math.floor(Math.random() * freeLanes.length)];
  let best = [];
  let bestDist = -1;
  for (const lane of freeLanes) {
    const dist = Math.min(...[...occupiedLanes].map((o) => Math.abs(o - lane)));
    if (dist > bestDist) { bestDist = dist; best = [lane]; }
    else if (dist === bestDist) { best.push(lane); }
  }
  return best[Math.floor(Math.random() * best.length)];
}

function _startAuthGlitter(container) {
  const canvas = container.querySelector("#authGlitter");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const activeEls = new Set();
  let particles = [];
  const MAX_PARTICLES = 160;
  const SPAWN_INTERVAL = 220;
  const mouse = { x: -9999, y: -9999 };
  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  };
  window.addEventListener("mousemove", onMove);

  const REPEL_RADIUS = 90;
  const REPEL_STRENGTH = 420;

  // pre-rendered soft-glow sprites keyed by rounded size, reused across every
  // particle draw instead of paying canvas's expensive per-call shadowBlur cost
  const sprites = new Map();
  function spriteFor(size) {
    const key = Math.round(size * 4);
    let sprite = sprites.get(key);
    if (sprite) return sprite;
    const s = document.createElement("canvas");
    const dim = Math.ceil(size * 6);
    s.width = s.height = dim;
    const sctx = s.getContext("2d");
    const r = dim / 2;
    const g = sctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, "rgba(227, 189, 108, 0.95)");
    g.addColorStop(0.4, "rgba(227, 189, 108, 0.5)");
    g.addColorStop(1, "rgba(227, 189, 108, 0)");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, dim, dim);
    sprites.set(key, s);
    return s;
  }

  let lastTime = performance.now();
  let lastSpawn = 0;
  let rafId;

  function spawnParticlesFor(el) {
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const topY = rect.top - containerRect.top;
    if (topY < -20 || topY > container.clientHeight + 20) return;
    if (particles.length >= MAX_PARTICLES) return;
    const cx = rect.left - containerRect.left + rect.width / 2;
    particles.push({
      x: cx + (Math.random() - 0.5) * rect.width * 0.8,
      y: topY + rect.height * 0.15,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      size: 1 + Math.random() * 1.8,
      life: 0,
      maxLife: 3000 + Math.random() * 2500,
    });
  }

  function tick(now) {
    const dt = Math.min(now - lastTime, 48);
    lastTime = now;

    if (now - lastSpawn > SPAWN_INTERVAL) {
      lastSpawn = now;
      activeEls.forEach((el) => spawnParticlesFor(el));
    }

    ctx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    particles = particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.maxLife) return false;

      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < REPEL_RADIUS) {
        const force = ((REPEL_RADIUS - dist) / REPEL_RADIUS) * REPEL_STRENGTH;
        p.vx += (dx / dist) * force * (dt / 1000);
        p.vy += (dy / dist) * force * (dt / 1000);
      }

      p.vy += 4 * (dt / 1000);
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);

      const lifeRatio = p.life / p.maxLife;
      const alpha = lifeRatio < 0.15 ? lifeRatio / 0.15 : 1 - (lifeRatio - 0.15) / 0.85;

      const sprite = spriteFor(p.size);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.drawImage(sprite, p.x - sprite.width / 2, p.y - sprite.height / 2);
      return true;
    });
    ctx.globalAlpha = 1;

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  return {
    addEl: (el) => activeEls.add(el),
    removeEl: (el) => activeEls.delete(el),
    stop: () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    },
  };
}

let _authGlitter = null;

async function startAuthGallery(container) {
  if (!container || container === _authGalleryContainer) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (_authGalleryInterval) clearInterval(_authGalleryInterval);
  if (_authGlitter) _authGlitter.stop();
  _authGalleryContainer = container;
  _authGlitter = _startAuthGlitter(container);

  const pool = await _loadAuthGalleryPool();
  if (!pool.length || container !== _authGalleryContainer) return;

  const occupiedLanes = new Set();
  let active = 0;

  function spawn() {
    if (container !== _authGalleryContainer) return;
    if (active >= AUTH_GALLERY_MAX_CONCURRENT) return;
    const freeLanes = [...Array(AUTH_GALLERY_LANES).keys()].filter((l) => !occupiedLanes.has(l));
    if (!freeLanes.length) return;

    const lane = _authGalleryPickSpreadLane(freeLanes, occupiedLanes);
    occupiedLanes.add(lane);
    active++;

    const item = pool[Math.floor(Math.random() * pool.length)];
    const width = AUTH_GALLERY_MIN_WIDTH + Math.random() * (AUTH_GALLERY_MAX_WIDTH - AUTH_GALLERY_MIN_WIDTH);
    const stageWidth = container.clientWidth;
    const x = _authGalleryLaneToX(lane, stageWidth, width, occupiedLanes);
    const duration = 8000 + Math.random() * 112000;

    const el = document.createElement("div");
    el.className = "absolute rounded-md overflow-hidden opacity-0 will-change-transform";
    el.style.left = `${x}px`;
    el.style.width = `${width}px`;
    el.style.boxShadow = "0 20px 50px -20px rgba(0,0,0,.55)";
    el.innerHTML = `<img src="${item.src}" class="block w-full h-full object-cover" decoding="async" alt="">`;
    container.appendChild(el);

    const img = el.querySelector("img");
    img.decoding = "async";
    img.onload = () => {
      const height = width * (img.naturalHeight / img.naturalWidth || 1.3);
      el.style.height = `${height}px`;
      el.style.top = `-${height}px`;

      const stageHeight = container.clientHeight;
      const travel = stageHeight + height * 2;

      el.animate(
        [{ transform: "translateY(0)" }, { transform: `translateY(${travel}px)` }],
        { duration, easing: "linear", fill: "forwards" }
      );

      const fadePortion = 1800 / duration;
      const fade = el.animate(
        [
          { opacity: 0 },
          { opacity: 1, offset: Math.min(fadePortion, 0.2) },
          { opacity: 1, offset: Math.max(1 - fadePortion, 0.8) },
          { opacity: 0 },
        ],
        { duration, easing: "linear", fill: "forwards" }
      );

      if (_authGlitter) _authGlitter.addEl(el);

      fade.onfinish = () => {
        if (_authGlitter) _authGlitter.removeEl(el);
        el.remove();
        occupiedLanes.delete(lane);
        active--;
      };
    };
  }

  _authGalleryInterval = setInterval(() => {
    if (Math.random() < 0.35) spawn();
  }, 1800);
}

if (typeof window !== "undefined") {
  window.heroScene = heroScene;
  window.compactScene = compactScene;
  window.spineStitchHtml = spineStitchHtml;
}
