"use strict";

const OnboardView = {
  loading: false,
  error: "",
  totpErr: false,
  secret: "",
  otpauthUri: "",
  showSecret: false,
  provisionFailed: false,
  async mount(main) {
    this.main = main;
    if (!OnboardFlow.username || !OnboardFlow.password) {
      navigate("/register");
      return;
    }
    this.error = "";
    this.totpErr = false;
    this.showSecret = false;
    this.provisionFailed = false;
    await this.provisionTotp();
  },
  async provisionTotp() {
    this.error = "";
    this.provisionFailed = false;
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
      this.error = err.message || t("onboard_error_setup_failed");
      this.provisionFailed = true;
      this.render();
    }
  },
  renderLoading() {
    compactScene(this.main, `
      <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">${t("onboard_verify_hand_heading")}</h2>
      ${spineStitchHtml(2, 2)}
      <div class="text-center text-muted text-sm py-10">${t("onboard_sealing_volume_progress")}</div>
    `);
  },
  qrSvg() {
    const qr = qrcode(0, "M");
    qr.addData(this.otpauthUri);
    qr.make();
    return qr.createSvgTag(4, 0);
  },
  render() {
    if (this.provisionFailed) {
      const body = `
        <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">${t("onboard_verify_hand_heading")}</h2>
        ${spineStitchHtml(2, 2)}
        ${authError(this.error || t("onboard_error_setup_failed"))}
        <button type="button" data-onboard-retry class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark mt-2">
          ${t("onboard_try_again_button")}
        </button>
        <div class="text-center mt-3">
          <button type="button" data-onboard-back class="text-primary text-[13px] font-medium">${t("onboard_back_to_registration_link")}</button>
        </div>
      `;
      compactScene(this.main, body);
      this.wireFailed();
      return;
    }
    const body = `
      <h2 class="font-display font-semibold text-[19px] text-ink mb-3 text-center">${t("onboard_verify_hand_heading")}</h2>
      ${spineStitchHtml(2, 2)}
      ${authError(this.error)}
      <div class="flex items-center gap-3 mb-3">
        <div class="w-[84px] h-[84px] flex-none rounded-lg bg-white p-1.5 overflow-hidden [&>svg]:w-full [&>svg]:h-full">${this.otpauthUri ? this.qrSvg() : ""}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] leading-relaxed text-sec mb-1.5">${t("onboard_scan_authenticator_instructions")}</p>
          <button type="button" data-toggle-secret class="text-primary font-mono text-[11px]">${this.showSecret ? t("onboard_hide_key_button") : t("onboard_reveal_key_button")}</button>
          ${this.showSecret ? `<div class="mt-1.5 font-mono text-[11px] text-ink break-all">${this.secret}</div>` : ""}
        </div>
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">${t("onboard_totp_prompt_app")}</div>
      ${totpBoxes(this.totpErr)}
      <button type="button" data-onboard-submit ${this.loading ? "disabled" : ""} class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60 mt-3">
        ${this.loading ? t("onboard_sealing_progress") : t("onboard_seal_volume_button")}
      </button>
      <button type="button" data-onboard-skip ${this.loading ? "disabled" : ""} class="w-full py-2.5 mt-2 text-[13px]" style="color:var(--color-muted)">
        ${t("onboard_skip_totp_link", "Skip this step")}
      </button>
    `;
    compactScene(this.main, body);
    this.wire();
  },
  wireFailed() {
    this.main.querySelector("[data-onboard-retry]").addEventListener("click", () => this.provisionTotp());
    this.main.querySelector("[data-onboard-back]").addEventListener("click", () => navigate("/register"));
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
    this.main.querySelector("[data-onboard-skip]").addEventListener("click", () => this.confirmSkip());
  },
  async confirmSkip() {
    const proceed = await confirmDialog(
      t("onboard_skip_totp_warning",
        "Without this step you will NOT be able to reset your password yourself - there's no email here, so if you forget it, only an admin can unlock your account, and that can take a while. You can set this up later in Settings."),
      { title: t("onboard_skip_totp_title", "Skip account recovery?"),
        confirmLabel: t("onboard_skip_totp_confirm", "Skip anyway"),
        cancelLabel: t("onboard_skip_totp_cancel", "Go back") });
    if (!proceed) return;
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: OnboardFlow.username, password: OnboardFlow.password,
                               invite_code: OnboardFlow.inviteCode || undefined }),
      });
      OnboardFlow.approved = result.pending === false;
      OnboardFlow.backupCodes = null;
      OnboardFlow.password = null;
      navigate("/wait");
    } catch (err) {
      this.loading = false;
      this.error = err.message || t("onboard_error_cannot_reach_server");
      this.render();
    }
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
          invite_code: OnboardFlow.inviteCode || undefined,
        }),
      });
      OnboardFlow.backupCodes = result.backup_codes;
      OnboardFlow.approved = result.pending === false;
      OnboardFlow.password = null;
      navigate("/wait");
    } catch (err) {
      this.loading = false;
      this.totpErr = true;
      this.error = err.message || (err.status ? t("onboard_error_check_code") : t("onboard_error_cannot_reach_server"));
      this.render();
    }
  },
};

if (typeof window !== "undefined") window.OnboardView = OnboardView;
