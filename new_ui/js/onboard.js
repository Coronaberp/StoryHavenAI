"use strict";

const OnboardView = {
  loading: false,
  error: "",
  totpErr: false,
  secret: "",
  otpauthUri: "",
  showSecret: false,
  async mount(main) {
    this.main = main;
    if (!OnboardFlow.username || !OnboardFlow.password) {
      navigate("/register");
      return;
    }
    this.error = "";
    this.totpErr = false;
    this.showSecret = false;
    this.renderLoading();
    try {
      const result = await api("/api/auth/totp/provision", {
        method: "POST",
        body: JSON.stringify({ username: OnboardFlow.username }),
      });
      this.secret = result.secret;
      this.otpauthUri = result.otpauth_uri;
      this.render();
    } catch (err) {
      this.error = err.message || "Could not start verification setup.";
      this.render();
    }
  },
  renderLoading() {
    this.main.innerHTML = compactScene(`
      <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">The archive verifies your hand</h2>
      ${spineStitchHtml(2, 2)}
      <div class="text-center text-muted text-sm py-10">Sealing the volume…</div>
    `);
  },
  qrSvg() {
    const qr = qrcode(0, "M");
    qr.addData(this.otpauthUri);
    qr.make();
    return qr.createSvgTag(4, 0);
  },
  render() {
    const body = `
      <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">The archive verifies your hand</h2>
      ${spineStitchHtml(2, 2)}
      ${this.error ? `<div class="mb-4 rounded-lg border border-warn text-warn text-[13px] px-3 py-2.5" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${this.error}</div>` : ""}
      <div class="flex items-center gap-3 mb-3">
        <div class="w-[84px] h-[84px] flex-none rounded-lg bg-white p-1.5 overflow-hidden [&>svg]:w-full [&>svg]:h-full">${this.otpauthUri ? this.qrSvg() : ""}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] leading-relaxed text-sec mb-1.5">Scan with an authenticator app, or</p>
          <button type="button" data-toggle-secret class="text-primary font-mono text-[11px]">${this.showSecret ? "Hide" : "Reveal"} the key</button>
          ${this.showSecret ? `<div class="mt-1.5 font-mono text-[11px] text-ink break-all">${this.secret}</div>` : ""}
        </div>
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">6-digit code from your app</div>
      ${totpBoxes(this.totpErr)}
      <button type="button" data-onboard-submit ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60 mt-3">
        ${this.loading ? "Sealing…" : "Seal this volume"}
      </button>
    `;
    this.main.innerHTML = compactScene(body);
    this.wire();
  },
  wire() {
    this.main.querySelector("[data-toggle-secret]").addEventListener("click", () => {
      this.showSecret = !this.showSecret;
      this.render();
    });
    this.main.querySelectorAll("[data-totp]").forEach((input) => {
      input.addEventListener("input", () => this.handleTotpInput(input));
      input.addEventListener("keydown", (e) => this.handleTotpKey(input, e));
    });
    this.main.querySelector("[data-onboard-submit]").addEventListener("click", () => this.submit());
  },
  handleTotpInput(input) {
    input.value = input.value.replace(/\D/g, "").slice(0, 1);
    if (input.value) {
      const next = this.main.querySelector(`[data-totp="${Number(input.dataset.totp) + 1}"]`);
      if (next) next.focus();
    }
  },
  handleTotpKey(input, e) {
    if (e.key === "Backspace" && !input.value) {
      const prev = this.main.querySelector(`[data-totp="${Number(input.dataset.totp) - 1}"]`);
      if (prev) { prev.focus(); prev.value = ""; }
    }
  },
  totpValue() {
    return Array.from(this.main.querySelectorAll("[data-totp]")).map((el) => el.value || "").join("");
  },
  async submit() {
    const code = this.totpValue();
    if (code.length < 6) { this.totpErr = true; this.render(); return; }
    this.loading = true;
    this.error = "";
    this.totpErr = false;
    this.render();
    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: OnboardFlow.username,
          password: OnboardFlow.password,
          totp_secret: this.secret,
          totp_code: code,
        }),
      });
      OnboardFlow.backupCodes = result.backup_codes;
      OnboardFlow.password = null;
      navigate("/wait");
    } catch (err) {
      this.loading = false;
      this.totpErr = true;
      this.error = err.message || "Verification failed.";
      this.render();
    }
  },
};

if (typeof window !== "undefined") window.OnboardView = OnboardView;
