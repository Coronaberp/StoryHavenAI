"use strict";

const OnboardFlow = { username: null, password: null, backupCodes: null };

const RegisterView = {
  error: "",
  mount(main) {
    this.main = main;
    this.error = "";
    this.values = {};
    this.oauthProviders = [];
    this.render();
    this.loadOauthProviders();
  },
  async loadOauthProviders() {
    try {
      const { providers } = await api("/api/auth/oauth/providers");
      this.oauthProviders = providers;
    } catch (e) {
      this.oauthProviders = [];
    }
    this.render();
  },
  snapshotValues() {
    if (!this.main) return;
    this.values = this.values || {};
    visibleEls(this.main, "[data-field]").forEach((input) => {
      this.values[input.dataset.field] = input.value;
    });
  },
  render() {
    const body = `
      <h2 class="font-display font-semibold text-[19px] text-ink mb-1">${t("register_bind_new_volume_heading")}</h2>
      <p class="text-[12px] leading-snug text-sec mb-3 font-display italic">${t("register_account_volume_subheading")}</p>
      ${spineStitchHtml(1, 2)}
      ${this.error ? `<div class="mb-3 rounded-lg border border-warn text-warn text-[12.5px] leading-snug px-3 py-2" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${this.error}</div>` : ""}
      ${authField(t("register_field_username_label"), "username", { ph: "kael", value: this.values?.username })}
      ${authField(t("register_field_password_label"), "password", { type: "password", ph: t("register_password_placeholder_min_chars"), value: this.values?.password })}
      ${authField(t("register_field_confirm_password_label"), "password2", { type: "password", ph: t("register_confirm_password_placeholder"), value: this.values?.password2 })}
      ${authField(t("register_field_invite_code_label", "Invite code (optional)"), "inviteCode", { ph: t("register_invite_code_ph", "Have one? Skip the approval wait"), value: this.values?.inviteCode })}
      <button type="button" data-register-submit class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark mt-1">
        ${t("register_bind_volume_button")}
      </button>
      <button type="button" data-register-guest class="w-full mt-2 py-3 rounded-xl font-medium text-sm border" style="border-color:var(--color-line-2);color:var(--color-ink)">
        ${t("register_try_as_guest_button", "Try it as a guest - no waiting")}
      </button>
      ${this.oauthProviders.length ? `
      <div class="flex flex-row gap-2 mt-3">
        ${this.oauthProviders.map((p) => `
          <a href="/api/auth/oauth/${encodeURIComponent(p.provider)}/start" title="${_attr(t("oauth_continue_with"))} ${_attr(p.label)}" aria-label="${_attr(t("oauth_continue_with"))} ${_attr(p.label)}" class="flex-1 min-w-0 py-3 rounded-xl border flex items-center justify-center" style="border-color:${_attr(oauthProviderColor(p.provider))};color:${_attr(oauthProviderColor(p.provider))}">
            ${oauthProviderIcon(p.provider)}
          </a>
        `).join("")}
      </div>
      ` : ""}
      <div class="text-center mt-3">
        <button type="button" data-register-signin class="text-primary text-[13px] font-medium">${t("register_already_have_account_link")}</button>
      </div>
    `;
    heroScene(this.main, body);
    this.wire();
  },
  wire() {
    this.main.querySelectorAll("[data-register-submit]").forEach((btn) => btn.addEventListener("click", () => this.submit()));
    this.main.querySelectorAll("[data-register-signin]").forEach((btn) => btn.addEventListener("click", () => navigate("/login")));
    this.main.querySelectorAll("[data-register-guest]").forEach((btn) => btn.addEventListener("click", () => this.submitGuest()));
  },
  async submitGuest() {
    const password = this.fieldValue("password");
    const password2 = this.fieldValue("password2");
    this.snapshotValues();
    if (password.length < 8) { this.error = t("register_error_password_too_short"); this.render(); return; }
    if (password !== password2) { this.error = t("register_error_passwords_do_not_match"); this.render(); return; }
    const proceed = await confirmDialog(
      t("register_guest_explainer",
        "A guest account starts instantly - no approval wait, just set a password. You get a randomly "
        + "assigned username you can't change, no profile customization, and you can play existing "
        + "characters but not create your own. Trial allowance: 1,000,000 story tokens, 400 images, "
        + "8 videos. An admin can upgrade you to a full account later - your stories carry over."),
      { title: t("register_guest_title", "Start as a guest?"),
        confirmLabel: t("register_guest_confirm", "Start now"),
        cancelLabel: t("register_guest_cancel", "Go back"), danger: false });
    if (!proceed) return;
    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: "guest", password, guest: true }),
      });
      OnboardFlow.username = result.username;
      OnboardFlow.guestName = result.username;
      OnboardFlow.password = null;
      OnboardFlow.backupCodes = null;
      OnboardFlow.approved = true;
      navigate("/wait");
    } catch (err) {
      this.error = err.message || t("onboard_error_cannot_reach_server");
      this.render();
    }
  },
  fieldValue(key) {
    return visibleEls(this.main, `[data-field="${key}"]`)[0]?.value?.trim() || "";
  },
  submit() {
    const username = this.fieldValue("username");
    const password = this.fieldValue("password");
    const password2 = this.fieldValue("password2");
    this.snapshotValues();
    if (username.length < 2) { this.error = t("register_error_username_too_short"); this.render(); return; }
    if (password.length < 8) { this.error = t("register_error_password_too_short"); this.render(); return; }
    if (password !== password2) { this.error = t("register_error_passwords_do_not_match"); this.render(); return; }
    OnboardFlow.username = username;
    OnboardFlow.password = password;
    OnboardFlow.inviteCode = this.fieldValue("inviteCode") || null;
    OnboardFlow.backupCodes = null;
    OnboardFlow.approved = false;
    navigate("/onboard");
  },
};

if (typeof window !== "undefined") {
  window.OnboardFlow = OnboardFlow;
  window.RegisterView = RegisterView;
}
