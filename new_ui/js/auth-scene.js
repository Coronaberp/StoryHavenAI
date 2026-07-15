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
  return `<div class="flex gap-2 mb-5">${segments.join("")}</div>`;
}

function heroScene(innerHtml) {
  return `
    <div class="fixed inset-0 overflow-hidden flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, #1a1509 0%, #0b0a0c 46%, #08080a 78%)">
      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">${loginEmbers()}</div>
      <div class="relative z-[1] flex-none">${loginEmblem()}</div>
      <div class="relative z-[2] flex-1 min-h-0 flex items-center px-6 pb-6">
        <div class="login-in w-full max-w-[320px] mx-auto">${innerHtml}</div>
      </div>
    </div>
  `;
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

function compactScene(innerHtml) {
  return `
    <div class="fixed inset-0 overflow-hidden flex flex-col" style="background:radial-gradient(120% 66% at 50% 4%, #1a1509 0%, #0b0a0c 46%, #08080a 78%)">
      <div class="relative z-[1] flex-none pt-8 px-6">${compactLogoRow()}</div>
      <div class="relative z-[2] flex-1 min-h-0 flex items-center px-6 py-4">
        <div class="login-in w-full max-w-[320px] mx-auto">${innerHtml}</div>
      </div>
    </div>
  `;
}

if (typeof window !== "undefined") {
  window.heroScene = heroScene;
  window.compactScene = compactScene;
  window.spineStitchHtml = spineStitchHtml;
}

export { heroScene, compactScene, spineStitchHtml };
