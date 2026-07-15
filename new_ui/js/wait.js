"use strict";

function waxSealHtml() {
  return `
    <div class="relative w-16 h-16 mx-auto mb-5">
      <div class="wax-seal-idle absolute inset-0 rounded-full" style="background:radial-gradient(circle at 35% 30%, var(--color-primary-light), var(--color-primary-dark))"></div>
      <div class="absolute inset-0 grid place-items-center font-display font-semibold text-lg text-paper">S</div>
    </div>
  `;
}

function backupCodesHtml(codes) {
  const items = codes.map((code) => `<span class="font-mono text-[13px] text-ink">${code}</span>`).join("");
  return `
    <div class="mb-5">
      <div class="rounded-lg border border-warn text-warn text-[12px] leading-relaxed px-3 py-2.5 mb-3" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">
        Save these recovery codes now — they will not be shown again. Each one lets you back into your account if you lose your authenticator.
      </div>
      <div class="grid grid-cols-2 gap-2 rounded-xl border border-line-2 p-3" style="background:color-mix(in srgb, var(--color-paper) 55%, transparent)">${items}</div>
    </div>
  `;
}

function waitEl(main) {
  const codes = OnboardFlow.backupCodes;
  const body = `
    ${waxSealHtml()}
    ${codes ? backupCodesHtml(codes) : ""}
    <h2 class="font-display font-semibold text-[20px] text-ink text-center mb-2">Your volume awaits the archivist's seal</h2>
    <p class="text-[13px] leading-relaxed text-sec text-center mb-6">A server admin reviews new accounts before they can be opened. This page doesn't need to stay open — come back and sign in once you're approved.</p>
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
