"use strict";

const SUPPORTED_UI_LANGUAGES = [
  "English",
  "Tagalog",
  "Spanish (Spain)",
  "Turkish",
  "Simplified Chinese (Singapore)",
  "Russian",
  "Portuguese (Portugal)",
  "Japanese",
  "Hindi",
  "Tamil",
  "Arabic",
  "Hebrew",
  "Dutch",
];

const SUPPORTED_UI_LANGUAGE_NATIVE_NAMES = {
  "English": "English",
  "Tagalog": "Tagalog",
  "Spanish (Spain)": "Español (España)",
  "Turkish": "Türkçe",
  "Simplified Chinese (Singapore)": "简体中文（新加坡）",
  "Russian": "Русский",
  "Portuguese (Portugal)": "Português (Portugal)",
  "Japanese": "日本語",
  "Hindi": "हिन्दी",
  "Tamil": "தமிழ்",
  "Arabic": "العربية",
  "Hebrew": "עברית",
  "Dutch": "Nederlands",
};

class AccountSettingsView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.settings = await api("/api/me/settings");
    } catch (e) {
      this.settings = { overrides: {}, defaults: {} };
      errorToast(t("acct_couldnt_load_your_settings"));
    }
    this.render();
    this.loadPasskeys();
    this.loadOauthIdentities();
    refreshGuestQuotaBoxes();
    this.checkOauthRedirectParams();
  }

  checkOauthRedirectParams() {
    const params = new URLSearchParams(location.search);
    if (params.has("oauth_linked")) {
      toast(t("oauth_linked_success"));
    } else if (params.has("oauth_error")) {
      errorToast(t("oauth_login_failed"));
    } else {
      return;
    }
    history.replaceState(null, "", "/settings-account");
  }

  render() {
    const lang = this.settings.overrides?.interface_language || "";
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml(t("settings_row_settings"))}
      ${pageHeaderHtml("My Dossier", "Settings", t("ph_account_lang_title"), t("ph_account_lang_sub"))}

      ${ME?.tier === "guest" ? `
      ${sEyebrowHtml(t("acct_guest_tier", "Guest account"))}
      ${guestQuotaBoxHtml()}
      ` : ""}
      ${sEyebrowHtml(t("acct_password"))}
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("acct_current_password")}</label>
        <input type="password" id="acct_old_pw" autocomplete="current-password" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("acct_new_password")}</label>
        <input type="password" id="acct_new_pw" autocomplete="new-password" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">${t("acct_confirm_new_password")}</label>
        <input type="password" id="acct_confirm_pw" autocomplete="new-password" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <button type="button" onclick="accountView.changePassword()" class="w-full mb-6 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">
        ${t("acct_change_password")}
      </button>

      ${sEyebrowHtml(t("acct_language"))}
      <div class="mb-2">
        <label class="block text-xs text-sec mb-1">${t("acct_interface_language")}</label>
        ${customSelectHtml("acct_lang",
          [...SUPPORTED_UI_LANGUAGES.map((l) => ({ value: l, label: SUPPORTED_UI_LANGUAGE_NATIVE_NAMES[l] || l })),
           ...(lang && !SUPPORTED_UI_LANGUAGES.some((l) => l.toLowerCase() === lang.toLowerCase()) ? [{ value: lang, label: lang }] : [])],
          SUPPORTED_UI_LANGUAGES.find((l) => l.toLowerCase() === lang.toLowerCase()) || lang || "English")}
      </div>
      <button type="button" onclick="accountView.saveLanguage()" class="w-full mb-2 py-2.5 rounded-xl border text-sm" style="border-color:var(--color-line);color:var(--color-ink)">
        ${t("acct_save_language")}
      </button>
      <button type="button" onclick="accountView.openAskAdminModal()" class="w-full py-2 text-xs" style="color:var(--color-muted)">
        ${t("acct_dont_see_your_language")} ${dirMark("&rarr;", "&larr;")}
      </button>

      ${sEyebrowHtml(t("acct_two_factor_authentication"))}
      <div class="mb-3 rounded-[13px] border border-line bg-surface p-3.5">
        ${ME?.totp_enabled ? `
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="min-w-0">
            <div class="text-sm text-ink font-medium">${ME?.totp_login_required ? t("acct_required_at_signin") : t("acct_not_required_at_signin")}</div>
            <div class="text-xs text-muted mt-0.5">${t("acct_always_required_for_password_reset")}</div>
          </div>
          <button type="button" onclick="accountView.openTotpRequirementModal()" class="settings-toggle${ME?.totp_login_required ? " on" : ""}" style="flex:none"><span class="settings-toggle-knob"></span></button>
        </div>
        <button type="button" onclick="accountView.openTotpResetModal()" class="w-full py-2.5 rounded-xl border text-sm" style="border-color:var(--color-line);color:var(--color-ink)">
          ${t("acct_reset_two_factor_codes")}
        </button>
        ` : `
        <div class="text-xs text-muted mb-2.5">${t("acct_two_factor_not_set_up")}</div>
        <button type="button" onclick="accountView.openTotpSetupModal()" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">
          ${t("acct_set_up_two_factor")}
        </button>
        `}
      </div>

      ${window.PublicKeyCredential ? `
      ${sEyebrowHtml(t("acct_passkeys", "Fingerprint & face sign-in"))}
      <div class="mb-3 rounded-[13px] border border-line bg-surface p-3.5">
        <div class="text-xs text-muted mb-2.5">${t("acct_passkeys_intro", "Sign in with the same fingerprint, face, or screen lock you already use to unlock this phone. Nothing to download - it's built in.")}</div>
        <div id="acct_passkey_list" class="text-xs text-muted mb-2.5">${t("acct_passkeys_loading", "Checking...")}</div>
        <button type="button" onclick="accountView.openPasskeyGuide()" class="w-full mb-2 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">
          ${t("acct_add_passkey", "Set up fingerprint sign-in")}
        </button>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm text-ink font-medium">${t("acct_passkey_required", "Always require it to sign in")}</div>
            <div class="text-xs text-muted mt-0.5">${t("acct_passkey_required_sub", "Your password alone will no longer be enough")}</div>
          </div>
          <button type="button" id="acct_passkey_required_toggle" onclick="accountView.togglePasskeyRequired()" class="settings-toggle${ME?.passkey_required ? " on" : ""}" style="flex:none"><span class="settings-toggle-knob"></span></button>
        </div>
      </div>
      ` : ""}
      ${sEyebrowHtml(t("oauth_connected_accounts"))}
      <div class="mb-3 rounded-[13px] border border-line bg-surface p-3.5">
        <div class="text-xs text-muted mb-2.5">${t("oauth_connected_accounts_hint")}</div>
        <div id="acct_oauth_list" class="text-xs text-muted">${t("common_loading")}</div>
      </div>
      </div>
    `;
    this.selectedLang = SUPPORTED_UI_LANGUAGES.find((l) => l.toLowerCase() === lang.toLowerCase()) || lang || "English";
    wireCustomSelect("acct_lang", (value) => { this.selectedLang = value; });
  }

  async loadPasskeys() {
    const list = document.getElementById("acct_passkey_list");
    if (!list) return;
    let keys;
    try {
      keys = await api("/api/me/passkeys");
    } catch (e) {
      list.textContent = e.message || t("acct_passkeys_load_failed", "Couldn't load passkeys.");
      return;
    }
    if (!keys.length) {
      list.textContent = t("acct_no_passkeys", "Not set up yet on this device.");
      return;
    }
    list.innerHTML = keys.map((k) => `
      <div class="flex items-center justify-between gap-2 py-1.5" style="border-bottom:1px solid var(--color-line)">
        <div class="min-w-0">
          <div class="text-sm text-ink">${_esc(k.nickname || t("acct_passkey_unnamed", "Unnamed device"))}</div>
          <div class="text-[11px] text-muted">${k.last_used ? t("acct_passkey_last_used", "Last used ") + new Date(k.last_used * 1000).toLocaleDateString() : t("acct_passkey_never_used", "Never used")}</div>
        </div>
        <button type="button" data-passkey-del="${_attr(k.id)}" class="text-xs" style="color:var(--color-warn)">${t("acct_remove", "Remove")}</button>
      </div>
    `).join("");
    list.querySelectorAll("[data-passkey-del]").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await confirmDialog(t("acct_remove_passkey_question", "Remove fingerprint sign-in for this device?"), { confirmLabel: t("acct_remove", "Remove") }))) return;
        try {
          await api(`/api/me/passkeys/${encodeURIComponent(btn.dataset.passkeyDel)}`, { method: "DELETE" });
          this.loadPasskeys();
        } catch (e) {
          errorToast(e.message);
        }
      };
    });
  }

  openPasskeyGuide() {
    openPasskeySetupGuide(() => this.loadPasskeys());
  }

  async loadOauthIdentities() {
    const list = document.getElementById("acct_oauth_list");
    if (!list) return;
    let identities, providers;
    try {
      [identities, providers] = await Promise.all([
        api("/api/me/oauth-identities"),
        api("/api/auth/oauth/providers").then((r) => r.providers),
      ]);
    } catch (e) {
      list.textContent = e.message || t("oauth_link_failed");
      return;
    }
    this.oauthIdentities = identities;
    const linkedProviders = new Set(identities.map((i) => i.provider));
    const unlinked = providers.filter((p) => !linkedProviders.has(p.provider));
    if (!identities.length && !unlinked.length) {
      list.innerHTML = `<div class="text-xs text-muted">${t("oauth_no_connected_accounts")}</div>`;
      return;
    }
    list.innerHTML = identities.map((i) => `
      <div class="flex items-center justify-between gap-2 py-1.5" style="border-bottom:1px solid var(--color-line)">
        <div class="flex items-center gap-2 min-w-0">
          <span class="shrink-0" style="color:${_attr(oauthProviderColor(i.provider))}">${oauthProviderIcon(i.provider)}</span>
          <div class="min-w-0">
            <div class="text-sm text-ink">${_esc(i.label)}</div>
            <div class="text-[11px] text-muted">${i.display_name ? _esc(i.display_name) : ""}</div>
          </div>
        </div>
        <button type="button" data-oauth-unlink="${_attr(i.id)}" class="text-xs shrink-0" style="color:var(--color-warn)">${t("oauth_unlink_button")}</button>
      </div>
    `).join("") + unlinked.map((p) => `
      <div class="flex items-center justify-between gap-2 py-1.5" style="border-bottom:1px solid var(--color-line)">
        <div class="flex items-center gap-2 min-w-0">
          <span class="shrink-0" style="color:${_attr(oauthProviderColor(p.provider))}">${oauthProviderIcon(p.provider)}</span>
          <div class="text-sm text-ink">${_esc(p.label)}</div>
        </div>
        <a href="/api/auth/oauth/${encodeURIComponent(p.provider)}/start-link" class="text-xs shrink-0" style="color:var(--color-accent)">${t("oauth_connect_button")}</a>
      </div>
    `).join("");
    list.querySelectorAll("[data-oauth-unlink]").forEach((btn) => {
      btn.onclick = async () => {
        if (!(await confirmDialog(t("oauth_unlink_confirm_question"), { confirmLabel: t("oauth_unlink_button") }))) return;
        try {
          await api(`/api/me/oauth-identities/${encodeURIComponent(btn.dataset.oauthUnlink)}`, { method: "DELETE" });
          this.loadOauthIdentities();
        } catch (e) {
          errorToast(e.message || t("oauth_link_failed"));
        }
      };
    });
  }

  async togglePasskeyRequired() {
    const next = !ME?.passkey_required;
    try {
      await api("/api/me/passkey-required", { method: "PUT", body: JSON.stringify({ value: next }) });
      ME.passkey_required = next;
      document.getElementById("acct_passkey_required_toggle")?.classList.toggle("on", next);
      toast(next ? t("acct_passkey_now_required", "Passkey now required at sign-in.")
                 : t("acct_passkey_no_longer_required", "Passkey no longer required."));
    } catch (e) {
      errorToast(e.message);
    }
  }

  async changePassword() {
    const oldPw = document.getElementById("acct_old_pw").value;
    const newPw = document.getElementById("acct_new_pw").value;
    const confirmPw = document.getElementById("acct_confirm_pw").value;
    if (!oldPw || !newPw) { errorToast(t("acct_enter_current_and_new_password")); return; }
    if (newPw !== confirmPw) { errorToast(t("acct_new_passwords_dont_match")); return; }
    try {
      await api("/api/auth/password", { method: "PUT", body: JSON.stringify({ old_password: oldPw, new_password: newPw }) });
      toast(t("acct_password_changed"));
      document.getElementById("acct_old_pw").value = "";
      document.getElementById("acct_new_pw").value = "";
      document.getElementById("acct_confirm_pw").value = "";
    } catch (e) {
      errorToast(e.message);
    }
  }

  async saveLanguage() {
    const lang = (this.selectedLang || "").trim();
    try {
      await api("/api/me/settings", { method: "PUT", body: JSON.stringify({ interface_language: lang || null }) });
      toast(t("acct_language_saved_reloading"));
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      errorToast(t("acct_save_failed_prefix") + e.message);
    }
  }

  openAskAdminModal() {
    openModal(`
      <h3>${t("acct_ask_admin_for_a_language")}</h3>
      <p style="margin:-6px 0 0;font-size:13px;color:var(--color-sec)">
        ${t("acct_ask_admin_language_body")}
      </p>
    `);
  }

  openTotpRequirementModal() {
    const nextValue = !ME?.totp_login_required;
    const layer = openModal(`
      <h3>${nextValue ? t("acct_require_code_at_signin") : t("acct_stop_requiring_code_at_signin")}</h3>
      <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">${t("acct_confirm_with_current_code")}</p>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">${t("acct_6digit_code_from_authenticator")}</div>
      <div id="totpReqBoxes">${totpBoxes(false)}</div>
      <button type="button" id="totpReqSubmit" class="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("acct_confirm")}</button>
    `);
    wireTotpBoxAutoAdvance(layer);
    layer.querySelector("#totpReqSubmit").onclick = async () => {
      const code = totpBoxValue(layer);
      if (code.length < 6) { errorToast(t("acct_enter_all_6_digits")); return; }
      try {
        await api("/api/auth/totp/login-enforcement", { method: "PUT", body: JSON.stringify({ required: nextValue, code }) });
        ME.totp_login_required = nextValue;
        closeModal(layer);
        toast(nextValue ? t("acct_now_required_at_signin") : t("acct_no_longer_required_at_signin"));
        this.render();
      } catch (err) {
        errorToast(err.message || t("acct_couldnt_verify_check_code"));
      }
    };
  }

  openTotpResetModal() {
    const layer = openModal(`
      <h3>${t("acct_reset_two_factor_codes")}</h3>
      <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">${t("acct_reset_totp_confirm_body")}</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("acct_password_label")}</label>
        <input type="password" id="totpResetPw" autocomplete="current-password" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">${t("acct_6digit_code_from_current_authenticator")}</div>
      <div id="totpResetBoxes">${totpBoxes(false)}</div>
      <button type="button" id="totpResetSubmit" class="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("acct_continue")}</button>
    `);
    wireTotpBoxAutoAdvance(layer);
    layer.querySelector("#totpResetSubmit").onclick = async () => {
      const password = layer.querySelector("#totpResetPw").value;
      const code = totpBoxValue(layer);
      if (!password || code.length < 6) { errorToast(t("acct_enter_password_and_all_6_digits")); return; }
      try {
        await api("/api/auth/totp/disable", { method: "POST", body: JSON.stringify({ password, code }) });
        closeModal(layer);
        ME.totp_login_required = false;
        ME.totp_enabled = false;
        await this.openTotpSetupModal();
      } catch (err) {
        errorToast(err.message || t("acct_couldnt_verify_check_password_and_code"));
      }
    };
  }

  async openTotpSetupModal() {
    let secret = "", otpauthUri = "";
    try {
      const result = await api("/api/auth/totp/setup", { method: "POST" });
      secret = result.secret;
      otpauthUri = result.otpauth_uri;
    } catch (err) {
      errorToast(err.message || t("acct_couldnt_start_setup"));
      this.render();
      return;
    }
    const qr = qrcode(0, "M");
    qr.addData(otpauthUri);
    qr.make();
    let setupCompleted = false;
    const layer = openModal(`
      <h3>${t("acct_set_up_your_new_authenticator")}</h3>
      <div class="flex items-center gap-3 mb-3 mt-2">
        <div class="w-[84px] h-[84px] flex-none rounded-lg bg-white p-1.5 overflow-hidden [&>svg]:w-full [&>svg]:h-full">${qr.createSvgTag(4, 0)}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] leading-relaxed text-sec mb-1.5">${t("acct_scan_with_authenticator_app_or")}</p>
          <button type="button" id="totpSetupToggleSecret" class="text-primary font-mono text-[11px]">${t("acct_reveal_the_key")}</button>
          <div id="totpSetupSecretValue" class="mt-1.5 font-mono text-[11px] text-ink break-all hidden">${_esc(secret)}</div>
        </div>
      </div>
      <div class="font-mono text-[9px] tracking-[.15em] uppercase text-muted mb-2">${t("acct_6digit_code_from_your_app")}</div>
      <div id="totpSetupBoxes">${totpBoxes(false)}</div>
      <button type="button" id="totpSetupSubmit" class="w-full mt-3 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("acct_confirm")}</button>
    `, {
      onClose: () => {
        if (!setupCompleted) errorToast(t("acct_two_factor_now_off_warning"));
      },
    });
    wireTotpBoxAutoAdvance(layer);
    layer.querySelector("#totpSetupToggleSecret").onclick = () => {
      layer.querySelector("#totpSetupSecretValue").classList.toggle("hidden");
    };
    layer.querySelector("#totpSetupSubmit").onclick = async () => {
      const code = totpBoxValue(layer);
      if (code.length < 6) { errorToast(t("acct_enter_all_6_digits")); return; }
      try {
        const result = await api("/api/auth/totp/enable", { method: "POST", body: JSON.stringify({ code }) });
        ME.totp_enabled = true;
        setupCompleted = true;
        closeModal(layer);
        this.openTotpBackupCodesModal(result.backup_codes);
      } catch (err) {
        errorToast(err.message || t("acct_invalid_code_try_again"));
      }
    };
  }

  openTotpBackupCodesModal(codes) {
    const layer = openModal(`
      <h3>${t("acct_save_your_new_recovery_codes")}</h3>
      ${backupCodesHtml(codes)}
      <button type="button" id="totpBackupDone" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("acct_done")}</button>
    `);
    layer.querySelector("#totpBackupDone").onclick = () => {
      closeModal(layer);
      toast(t("acct_two_factor_codes_reset"));
      this.render();
    };
  }
}

if (typeof window !== "undefined") {
  window.AccountSettingsView = AccountSettingsView;
}
