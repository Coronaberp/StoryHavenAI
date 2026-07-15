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

function heroScene(main, innerHtml) {
  const chrome = ensureHeroChrome();
  main.innerHTML = `
    <div class="absolute inset-0 overflow-y-auto flex flex-col" style="background:var(--color-paper)">
      <div data-hero-chrome-slot class="flex-none"></div>
      <div class="relative flex-1 px-6 pb-6">
        <div class="login-in w-full max-w-[320px] mx-auto py-4">${innerHtml}</div>
      </div>
    </div>
  `;
  const slot = main.querySelector("[data-hero-chrome-slot]");
  if (chrome && slot) slot.appendChild(chrome);
}

function compactLogoRow() {
  return `
    <div class="flex items-center justify-center gap-2.5">
      <div class="w-10 h-10 flex-none text-primary">
        <svg viewBox="0 0 500 500" width="100%" height="100%"><g>${SH_LOGO_PATHS}</g></svg>
      </div>
      <div class="flex flex-col leading-tight text-left">
        <span class="font-display text-[15px] font-semibold text-ink tracking-wide">StoryHaven AI</span>
        <span class="text-[10px] italic text-muted">Forge worlds. Remember everything.</span>
      </div>
    </div>
  `;
}

function compactScene(main, innerHtml) {
  hideHeroChrome();
  main.innerHTML = `
    <div class="absolute inset-0 overflow-y-auto flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, color-mix(in srgb, var(--color-accent) 22%, var(--color-paper)) 0%, var(--color-paper) 46%, var(--color-paper) 78%)">
      <div class="relative z-[1] flex-none pt-8 px-6">${compactLogoRow()}</div>
      <div class="relative z-[2] flex-1 px-6 py-4">
        <div class="login-in w-full max-w-[320px] mx-auto py-2">${innerHtml}</div>
      </div>
    </div>
  `;
}

if (typeof window !== "undefined") {
  window.heroScene = heroScene;
  window.compactScene = compactScene;
  window.spineStitchHtml = spineStitchHtml;
}
