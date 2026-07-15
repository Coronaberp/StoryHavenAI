"use strict";

const SH_LOGO_PATHS = `
  <circle cx="250" cy="250" r="230" fill="none" stroke="currentColor" stroke-width="8" opacity="0.15"/>
  <circle cx="250" cy="250" r="210" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 12" opacity="0.4"/>
  <path d="M 250 40 L 420 138 L 420 362 L 250 460 L 80 362 L 80 138 Z" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="round"/>
  <path d="M 250 75 L 385 153 L 385 347 L 250 425 L 115 347 L 115 153 Z" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"/>
  <circle cx="250" cy="40" r="6" fill="currentColor"/>
  <circle cx="420" cy="138" r="6" fill="currentColor"/>
  <circle cx="420" cy="362" r="6" fill="currentColor"/>
  <circle cx="250" cy="460" r="6" fill="currentColor"/>
  <circle cx="80" cy="362" r="6" fill="currentColor"/>
  <circle cx="80" cy="138" r="6" fill="currentColor"/>
  <circle cx="195" cy="150" r="10" fill="currentColor" opacity="0.9"/>
  <line x1="145" y1="150" x2="225" y2="150" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
  <line x1="195" y1="120" x2="195" y2="180" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity="0.5"/>
  <circle cx="305" cy="150" r="35" fill="none" stroke="currentColor" stroke-width="10"/>
  <circle cx="305" cy="150" r="30" fill="currentColor" opacity="0.15"/>
  <path d="M 285 130 A 20 20 0 0 1 325 135" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity="0.6"/>
  <circle cx="346" cy="150" r="5" fill="none" stroke="currentColor" stroke-width="3"/>
  <line x1="350" y1="150" x2="350" y2="340" stroke="currentColor" stroke-width="3" stroke-dasharray="6 6" opacity="0.7"/>
  <path d="M 130 230 C 170 190, 220 200, 250 215 C 280 200, 330 190, 370 230 C 330 260, 280 240, 250 230 C 220 240, 170 260, 130 230 Z" fill="currentColor"/>
  <circle cx="350" cy="340" r="6" fill="currentColor"/>
  <circle cx="350" cy="340" r="12" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
  <path d="M 120 370 C 160 400, 220 390, 250 340 C 280 390, 340 400, 380 370 V 300 C 340 330, 280 320, 250 270 C 220 320, 160 330, 120 300 Z" fill="none" stroke="currentColor" stroke-width="12" stroke-linejoin="round"/>
  <path d="M 150 350 C 180 370, 220 365, 250 325 C 280 365, 320 370, 350 350 V 295 C 320 315, 280 310, 250 270 C 220 310, 180 315, 150 295 Z" fill="none" stroke="currentColor" stroke-width="6" opacity="0.6"/>
  <path d="M 180 330 C 200 345, 230 340, 250 310 C 270 340, 300 345, 320 330 V 290 C 300 305, 270 300, 250 270 C 230 300, 200 305, 180 290 Z" fill="none" stroke="currentColor" stroke-width="3" opacity="0.3"/>
  <line x1="250" y1="270" x2="250" y2="445" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>
`;

function loginEmbers() {
  let out = "";
  for (let i = 0; i < 10; i++) {
    const left = 6 + i * 9;
    const size = i % 3 ? 3 : 4;
    const dx = (i % 2 ? -1 : 1) * (10 + i * 3);
    const dur = (4.5 + i * 0.6).toFixed(1);
    const delay = (i * 0.5).toFixed(1);
    out += `<span class="login-ember" style="left:${left}%;width:${size}px;height:${size}px;--dx:${dx}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
  }
  return out;
}

function loginOrbit() {
  let out = "";
  for (let i = 0; i < 3; i++) {
    const dur = 14 + i * 5;
    const delay = i * -4;
    out += `<span class="login-orbit" style="--rad:96px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
  }
  return out;
}

function loginEmblem() {
  return `
    <div class="relative flex flex-col items-center pt-16">
      <div class="relative w-[200px] h-[200px] grid place-items-center">
        <div class="login-pulse absolute w-[170px] h-[170px] rounded-full" style="background:radial-gradient(circle, color-mix(in srgb, var(--color-primary) 28%, transparent), transparent 68%)"></div>
        <div class="login-spin absolute inset-1.5"><div class="w-full h-full rounded-full opacity-30" style="border:1px dashed var(--color-primary)"></div></div>
        <div class="login-spin-rev absolute inset-6"><div class="w-full h-full rounded-full opacity-10" style="border:1px solid var(--color-primary)"></div></div>
        ${loginOrbit()}
        <div class="login-float relative w-[118px] h-[118px] text-primary" style="filter:drop-shadow(0 4px 16px color-mix(in srgb, var(--color-primary) 45%, transparent))">
          <svg viewBox="0 0 500 500" width="100%" height="100%"><g>${SH_LOGO_PATHS}</g></svg>
        </div>
      </div>
      <div class="font-display font-semibold text-2xl text-primary mt-5 tracking-tight">StoryHaven AI</div>
      <div class="font-display italic text-sm text-muted mt-1.5">Forge worlds. Remember everything.</div>
    </div>
  `;
}

function authField(label, key, opts = {}) {
  return `
    <div class="mb-4">
      <label class="block font-mono text-[9px] tracking-[.18em] uppercase text-muted mb-1.5" data-field-label="${key}">${label}</label>
      <input
        type="${opts.type || "text"}"
        data-field="${key}"
        placeholder="${opts.ph || ""}"
        autocomplete="off"
        class="w-full py-2 px-0.5 bg-transparent text-ink text-base outline-none border-0 border-b-[1.5px] border-line-2 focus:border-primary transition-colors"
      >
    </div>
  `;
}

function totpBoxes(err) {
  let boxes = "";
  for (let i = 0; i < 6; i++) {
    boxes += `<input data-totp="${i}" inputmode="numeric" maxlength="1" class="login-totp w-full aspect-[3/4] min-w-0 text-center rounded-lg border text-ink font-display font-semibold text-2xl outline-none ${
      err ? "border-warn" : "border-line-2"
    }" style="background:color-mix(in srgb, var(--color-paper) 55%, transparent)">`;
  }
  return `
    <div class="mb-1.5">
      <div class="flex gap-2 justify-between ${err ? "mb-2" : ""}">${boxes}</div>
      ${err ? `<div class="font-mono text-[11px] text-warn">Enter all 6 digits from your authenticator.</div>` : ""}
    </div>
  `;
}

function authError(message) {
  if (!message) return "";
  return `<div class="mb-4 rounded-lg border border-warn text-warn text-[13px] px-3 py-2.5" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${message}</div>`;
}

class AuthView {
  constructor() {
    this.view = "signin";
    this.loading = false;
    this.error = "";
    this.needsTotp = false;
    this.totpErr = false;
  }

  mount(main) {
    this.main = main;
    this.setView("signin");
  }

  setView(view) {
    this.view = view;
    this.error = "";
    this.needsTotp = false;
    this.totpErr = false;
    this.render();
  }

  render() {
    const body = this.view === "signin" ? this.renderSignin() : this.renderForgot();
    this.main.innerHTML = heroScene(body);
    this.wire();
  }

  renderSignin() {
    return `
      ${authError(this.error)}
      ${authField("Username", "username", { ph: "kael" })}
      ${authField("Password", "password", { type: "password", ph: "········" })}
      ${this.needsTotp ? `
        <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mt-2 mb-2.5">6-digit code from your authenticator</div>
        ${totpBoxes(this.totpErr)}
      ` : ""}
      <div class="flex justify-between -mt-1 mb-5">
        <button type="button" data-register-link class="text-primary text-[13px] font-medium">Create account</button>
        <button type="button" data-auth-link="forgot" class="text-primary text-[13px] font-medium">Can't sign in?</button>
      </div>
      <button type="button" data-auth-submit="signin" ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60">
        ${this.loading ? "Signing in…" : "Enter StoryHaven"}
      </button>
    `;
  }

  renderForgot() {
    return `
      <div class="font-mono text-[10px] tracking-[.22em] uppercase text-primary mb-1">Recovery</div>
      <h2 class="font-display font-semibold text-[19px] text-ink mb-1.5">Verify it's you</h2>
      <p class="text-[12px] leading-snug text-sec mb-3">Open the authenticator app you set up and type the 6-digit code it shows right now, then set a new password.</p>
      ${authError(this.error)}
      ${authField("Username", "username", { ph: "kael" })}
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mt-0.5 mb-2">6-digit code from your app</div>
      ${totpBoxes(this.totpErr)}
      ${authField("New password", "newPassword", { type: "password", ph: "At least 8 characters" })}
      <button type="button" data-auth-submit="forgot" ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60 mt-1">
        ${this.loading ? "Verifying…" : "Reset password"}
      </button>
      <div class="text-center mt-3">
        <button type="button" data-auth-link="signin" class="text-primary text-[13px] font-medium">← Back to sign in</button>
      </div>
    `;
  }

  wire() {
    this.main.querySelectorAll("[data-auth-link]").forEach((btn) => {
      btn.addEventListener("click", () => this.setView(btn.dataset.authLink));
    });
    const registerLink = this.main.querySelector("[data-register-link]");
    if (registerLink) registerLink.addEventListener("click", () => navigate("/register"));
    this.main.querySelectorAll("[data-totp]").forEach((input) => {
      input.addEventListener("input", () => this.handleTotpInput(input));
      input.addEventListener("keydown", (e) => this.handleTotpKey(input, e));
    });
    const submitBtn = this.main.querySelector("[data-auth-submit]");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        const action = submitBtn.dataset.authSubmit;
        if (action === "signin") this.submitSignin();
        else this.submitForgot();
      });
    }
  }

  handleTotpInput(input) {
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    if (input.value) {
      const next = this.main.querySelector(`[data-totp="${Number(input.dataset.totp) + 1}"]`);
      if (next) next.focus();
    }
  }

  handleTotpKey(input, e) {
    if (e.key === "Backspace" && !input.value) {
      const prev = this.main.querySelector(`[data-totp="${Number(input.dataset.totp) - 1}"]`);
      if (prev) { prev.focus(); prev.value = ""; }
    }
  }

  fieldValue(key) {
    return this.main.querySelector(`[data-field="${key}"]`)?.value?.trim() || "";
  }

  totpValue() {
    return Array.from(this.main.querySelectorAll("[data-totp]")).map((el) => el.value || "").join("");
  }

  async submitSignin() {
    const username = this.fieldValue("username");
    const password = this.fieldValue("password");
    if (!username || !password) { this.error = "Enter your username and password."; this.render(); return; }
    const totp_code = this.needsTotp ? this.totpValue() : undefined;
    if (this.needsTotp && totp_code.length < 6) { this.totpErr = true; this.render(); return; }
    this.loading = true; this.error = ""; this.render();
    try {
      ME = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, totp_code }) });
      navigate("/");
    } catch (err) {
      this.loading = false;
      if (err.detail?.code === "totp_required") {
        this.needsTotp = true; this.error = "";
      } else if (err.detail?.code === "totp_invalid") {
        this.needsTotp = true; this.totpErr = true; this.error = "";
      } else {
        this.error = err.message || "Sign in failed.";
      }
      this.render();
    }
  }

  async submitForgot() {
    const username = this.fieldValue("username");
    const new_password = this.fieldValue("newPassword");
    const code = this.totpValue();
    if (!username || code.length < 6 || !new_password) {
      this.totpErr = code.length < 6;
      this.error = !username ? "Enter your username." : !new_password ? "Enter a new password." : "";
      this.render();
      return;
    }
    this.loading = true; this.error = ""; this.totpErr = false; this.render();
    try {
      await api("/api/auth/password-reset/totp", { method: "POST", body: JSON.stringify({ username, code, new_password }) });
      this.setView("signin");
    } catch (err) {
      this.loading = false;
      this.error = err.message || "Recovery failed.";
      this.render();
    }
  }
}

const AUTH = new AuthView();
