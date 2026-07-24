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
      <div class="font-display italic text-sm text-muted mt-1.5">${t("auth_tagline")}</div>
    </div>
  `;
}

function escAttr(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function authField(label, key, opts = {}) {
  return `
    <div class="mb-4">
      <label class="block font-mono text-[9px] tracking-[.18em] uppercase text-muted mb-1.5" data-field-label="${key}">${label}</label>
      <input
        type="${opts.type || "text"}"
        data-field="${key}"
        placeholder="${opts.ph || ""}"
        value="${escAttr(opts.value)}"
        autocomplete="${opts.autocomplete || "off"}"
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
      ${err ? `<div class="font-mono text-[11px] text-warn">${t("login_totp_incomplete_warning")}</div>` : ""}
    </div>
  `;
}

function wireTotpBoxAutoAdvance(scope) {
  scope.querySelectorAll("[data-totp]").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value) {
        const next = scope.querySelector(`[data-totp="${Number(input.dataset.totp) + 1}"]`);
        if (next) next.focus();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value) {
        const prev = scope.querySelector(`[data-totp="${Number(input.dataset.totp) - 1}"]`);
        if (prev) { prev.focus(); prev.value = ""; e.preventDefault(); }
      }
    });
  });
}

function totpBoxValue(scope) {
  return Array.from(scope.querySelectorAll("[data-totp]")).map((el) => el.value || "").join("");
}

function authError(message) {
  if (!message) return "";
  return `<div class="mb-3 rounded-lg border border-warn text-warn text-[12.5px] leading-snug px-3 py-2" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${message}</div>`;
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
    this.values = {};
    this.oauthProviders = [];
    this.setView("signin");
    this.startConditionalPasskey();
    this.loadOauthProviders();
    this.checkOauthRedirectParams();
  }

  checkOauthRedirectParams() {
    const params = new URLSearchParams(location.search);
    if (!params.has("oauth_error")) return;
    errorToast(t("oauth_login_failed"));
    history.replaceState(null, "", "/login");
  }

  async loadOauthProviders() {
    try {
      const { providers } = await api("/api/auth/oauth/providers");
      this.oauthProviders = providers;
    } catch (e) {
      this.oauthProviders = [];
    }
    if (this.view === "signin") this.render();
  }

  async startConditionalPasskey() {
    if (this._conditionalStarted || !(await webauthnConditionalAvailable())) return;
    this._conditionalStarted = true;
    try {
      ME = await webauthnLogin({ mediation: "conditional" });
      sessionStorage.removeItem("sh_known_anon");
      await syncMe();
      navigate("/");
    } catch (err) {
      this._conditionalStarted = false;
    }
  }

  setView(view) {
    this.view = view;
    this.error = "";
    this.needsTotp = false;
    this.totpErr = false;
    this.render();
  }

  snapshotValues() {
    if (!this.main) return;
    this.values = this.values || {};
    visibleEls(this.main, "[data-field]").forEach((input) => {
      this.values[input.dataset.field] = input.value;
    });
  }

  render() {
    const body = this.view === "signin" ? this.renderSignin() : this.renderForgot();
    heroScene(this.main, body);
    this.wire();
  }

  renderSignin() {
    return `
      ${authError(this.error)}
      ${authField(t("login_field_username_label"), "username", { ph: "kael", value: this.values?.username, autocomplete: "username webauthn" })}
      ${authField(t("login_field_password_label"), "password", { type: "password", ph: "········", value: this.values?.password })}
      ${this.needsTotp ? `
        <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mt-2 mb-2.5">${t("login_totp_prompt_authenticator")}</div>
        ${totpBoxes(this.totpErr)}
      ` : ""}
      <div class="flex justify-between -mt-1 mb-5">
        <button type="button" data-register-link class="text-primary text-[13px] font-medium">${t("login_create_account_link")}</button>
        <button type="button" data-auth-link="forgot" class="text-primary text-[13px] font-medium">${t("login_cannot_sign_in_link")}</button>
      </div>
      <button type="button" data-auth-submit="signin" ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60">
        ${this.loading ? t("login_signing_in_progress") : t("login_enter_storyhaven_button")}
      </button>
      ${window.PublicKeyCredential ? `
      <button type="button" data-auth-submit="passkey" class="w-full mt-2 py-3 rounded-xl font-medium text-sm border" style="border-color:var(--color-line-2);color:var(--color-ink)">
        ${t("login_with_passkey_button", "Sign in with fingerprint / face")}
      </button>
      ` : ""}
      ${this.oauthProviders.length ? `
      <div class="flex flex-row gap-2 mt-3">
        ${this.oauthProviders.map((p) => `
          <a href="/api/auth/oauth/${encodeURIComponent(p.provider)}/start" title="${_attr(t("oauth_continue_with"))} ${_attr(p.label)}" aria-label="${_attr(t("oauth_continue_with"))} ${_attr(p.label)}" class="flex-1 min-w-0 py-3 rounded-xl border flex items-center justify-center" style="border-color:${_attr(oauthProviderColor(p.provider))};color:${_attr(oauthProviderColor(p.provider))}">
            ${oauthProviderIcon(p.provider)}
          </a>
        `).join("")}
      </div>
      ` : ""}
    `;
  }

  renderForgot() {
    return `
      <div class="font-mono text-[10px] tracking-[.22em] uppercase text-primary mb-1">${t("login_recovery_label")}</div>
      <h2 class="font-display font-semibold text-[19px] text-ink mb-1.5">${t("login_verify_identity_heading")}</h2>
      <p class="text-[12px] leading-snug text-sec mb-3">${t("login_forgot_password_instructions")}</p>
      ${authError(this.error)}
      ${authField(t("login_field_username_label"), "username", { ph: "kael", value: this.values?.username })}
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mt-0.5 mb-1.5">${t("login_totp_prompt_app")}</div>
      ${totpBoxes(this.totpErr)}
      ${authField(t("login_field_new_password_label"), "newPassword", { type: "password", ph: t("login_password_placeholder_min_chars"), value: this.values?.newPassword })}
      <button type="button" data-auth-submit="forgot" ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60 mt-1">
        ${this.loading ? t("login_verifying_progress") : t("login_reset_password_button")}
      </button>
      <div class="text-center mt-2">
        <button type="button" data-auth-link="signin" class="text-primary text-[13px] font-medium">${t("login_back_to_sign_in_link")}</button>
      </div>
    `;
  }

  wire() {
    this.main.querySelectorAll("[data-auth-link]").forEach((btn) => {
      btn.addEventListener("click", () => this.setView(btn.dataset.authLink));
    });
    this.main.querySelectorAll("[data-register-link]").forEach((btn) => {
      btn.addEventListener("click", () => navigate("/register"));
    });
    this.main.querySelectorAll("[data-totp]").forEach((input) => {
      input.addEventListener("input", () => this.handleTotpInput(input));
      input.addEventListener("keydown", (e) => this.handleTotpKey(input, e));
    });
    this.main.querySelectorAll("[data-auth-submit]").forEach((submitBtn) => {
      submitBtn.addEventListener("click", () => {
        const action = submitBtn.dataset.authSubmit;
        if (action === "signin") this.submitSignin();
        if (action === "passkey") this.signinWithPasskey();
        else this.submitForgot();
      });
    });
  }

  handleTotpInput(input) {
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    if (input.value) {
      const next = visibleEls(this.main, `[data-totp="${Number(input.dataset.totp) + 1}"]`)[0];
      if (next) next.focus();
    }
  }

  handleTotpKey(input, e) {
    if (e.key === "Backspace" && !input.value) {
      const prev = visibleEls(this.main, `[data-totp="${Number(input.dataset.totp) - 1}"]`)[0];
      if (prev) { prev.focus(); prev.value = ""; }
    }
  }

  fieldValue(key) {
    return visibleEls(this.main, `[data-field="${key}"]`)[0]?.value?.trim() || "";
  }

  totpValue() {
    return visibleEls(this.main, "[data-totp]").map((el) => el.value || "").join("");
  }

  async signinWithPasskey(promptMessage) {
    if (!window.PublicKeyCredential) { errorToast(t("login_passkey_unsupported", "This browser doesn't support fingerprint sign-in.")); return; }
    if (promptMessage) toast(promptMessage);
    try {
      ME = await webauthnLogin();
      sessionStorage.removeItem("sh_known_anon");
      await syncMe();
      navigate("/");
    } catch (err) {
      if (err.name === "NotAllowedError") return;
      this.error = err.message || t("login_passkey_failed", "Fingerprint sign-in didn't work - use your password instead.");
      this.render();
    }
  }

  async submitSignin() {
    const username = this.fieldValue("username");
    const password = this.fieldValue("password");
    if (!username || !password) { this.snapshotValues(); this.error = t("login_error_missing_username_password"); this.render(); return; }
    const totp_code = this.needsTotp ? this.totpValue() : undefined;
    if (this.needsTotp && totp_code.length < 6) { this.totpErr = true; this.render(); return; }
    this.snapshotValues();
    this.loading = true; this.error = ""; this.render();
    try {
      ME = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, totp_code }) });
      sessionStorage.removeItem("sh_known_anon");
      await syncMe();
      navigate("/");
      maybeOfferPasskeySetup();
    } catch (err) {
      this.loading = false;
      this.snapshotValues();
      if (err.detail?.code === "passkey_required") {
        this.error = "";
        this.render();
        this.signinWithPasskey(t("login_passkey_step", "Confirm with your fingerprint or face to finish signing in."));
        return;
      }
      if (err.detail?.code === "totp_required") {
        this.needsTotp = true; this.error = "";
      } else if (err.detail?.code === "totp_invalid") {
        this.needsTotp = true; this.totpErr = true; this.error = "";
      } else {
        this.error = err.message || (err.status ? t("login_error_check_credentials") : t("login_error_cannot_reach_server"));
      }
      this.render();
    }
  }

  async submitForgot() {
    const username = this.fieldValue("username");
    const new_password = this.fieldValue("newPassword");
    const code = this.totpValue();
    if (!username || code.length < 6 || !new_password) {
      this.snapshotValues();
      this.totpErr = code.length < 6;
      this.error = !username ? t("login_error_missing_username") : !new_password ? t("login_error_missing_new_password") : "";
      this.render();
      return;
    }
    this.snapshotValues();
    this.loading = true; this.error = ""; this.totpErr = false; this.render();
    try {
      await api("/api/auth/password-reset/totp", { method: "POST", body: JSON.stringify({ username, code, new_password }) });
      this.setView("signin");
    } catch (err) {
      this.loading = false;
      this.snapshotValues();
      this.error = err.message || (err.status ? t("login_error_check_details") : t("login_error_cannot_reach_server"));
      this.render();
    }
  }
}

const AUTH = new AuthView();

if (typeof window !== "undefined") {
  window.wireTotpBoxAutoAdvance = wireTotpBoxAutoAdvance;
  window.totpBoxValue = totpBoxValue;
}
