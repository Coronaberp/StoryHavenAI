"use strict";

const WAIT_LAYOUT = {
  full: {
    sealSize: "w-16 h-16",
    sealMargin: "mb-5",
    sealTextSize: "text-lg",
    headingSize: "text-[20px]",
    paragraphMargin: "mb-6",
  },
  compact: {
    sealSize: "w-11 h-11",
    sealMargin: "mb-2.5",
    sealTextSize: "text-sm",
    headingSize: "text-[17px]",
    paragraphMargin: "mb-3",
  },
};

function waxSealHtml(layout) {
  return `
    <div class="relative ${layout.sealSize} ${layout.sealMargin} mx-auto">
      <div class="wax-seal-idle absolute inset-0 rounded-full" style="background:radial-gradient(circle at 35% 30%, var(--color-primary-light), var(--color-primary-dark))"></div>
      <div class="absolute inset-0 grid place-items-center font-display font-semibold ${layout.sealTextSize} text-paper">S</div>
    </div>
  `;
}

function backupCodesHtml(codes) {
  const items = codes.map((code) => `<span class="font-mono text-[12.5px] text-ink">${code}</span>`).join("");
  return `
    <div class="mb-3">
      <div class="rounded-lg border border-warn text-warn text-[11.5px] leading-snug px-2.5 py-2 mb-2" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">
        Save these recovery codes now — they will not be shown again. Each one lets you back into your account if you lose your authenticator.
      </div>
      <div class="grid grid-cols-2 gap-1.5 rounded-xl border border-line-2 p-2.5" style="background:color-mix(in srgb, var(--color-paper) 55%, transparent)">${items}</div>
    </div>
  `;
}

function waitEl(main) {
  const codes = OnboardFlow.backupCodes;
  const layout = codes ? WAIT_LAYOUT.compact : WAIT_LAYOUT.full;
  const body = `
    ${waxSealHtml(layout)}
    ${codes ? backupCodesHtml(codes) : ""}
    <h2 class="font-display font-semibold ${layout.headingSize} text-ink text-center mb-1.5">Your volume awaits the archivist's seal</h2>
    <p class="text-[12.5px] leading-snug text-sec text-center ${layout.paragraphMargin}">A server admin reviews new accounts before they can be opened. This page doesn't need to stay open — come back and sign in once you're approved.</p>
    <button type="button" data-wait-exit class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark">
      Back to sign in
    </button>
  `;
  main.innerHTML = heroScene(body);
  main.querySelector("[data-wait-exit]").addEventListener("click", () => {
    OnboardFlow.backupCodes = null;
    OnboardFlow.username = null;
    navigate("/login");
  });
}

if (typeof window !== "undefined") window.waitEl = waitEl;
