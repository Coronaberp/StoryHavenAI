"use strict";

const SETTINGS_ICONS = {
  appearance: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M1.5 12H4M20 12h2.5M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>',
  model: '<path d="M12 3a5 5 0 0 0-5 5c0 2 1 3 1 5a4 4 0 0 0 8 0c0-2 1-3 1-5a5 5 0 0 0-5-5z"/><path d="M9.5 18h5M10 21h4"/>',
  eye: '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c7 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.3 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  masks: '<circle cx="9.5" cy="10" r="4.2"/><path d="M12.8 8.2A4.2 4.2 0 1 1 12.8 15.8"/>',
  ban: '<circle cx="12" cy="12" r="9"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  chevron: '<polyline points="9 6 15 12 9 18"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/>',
  beaker: '<path d="M9 3h6M10 3v5.5L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 8.5V3"/><path d="M7 15h10"/>',
};

function svgIcon(name, size = 18) {
  const cls = name === "chevron" ? ' class="icon-flip-rtl"' : "";
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SETTINGS_ICONS[name] || ""}</svg>`;
}

function sEyebrowHtml(text) {
  return `<div class="settings-eyebrow">${text}</div>`;
}

function backLinkHtml(label) {
  const route = label === "Admin" ? "/admin" : "/settings";
  return `<div class="settings-back-link" onclick="navigate('${route}')">${svgIcon("chevron", 12).replace('points="9 6 15 12 9 18"', 'points="15 6 9 12 15 18"')} ${label}</div>`;
}

function _attr(s) {
  return _esc(s).replace(/"/g, "&quot;");
}

function toggleSwitchHtml(onClickExpr, isOn) {
  return `<button type="button" onclick="${onClickExpr}" class="settings-toggle${isOn ? " on" : ""}"><span class="settings-toggle-knob"></span></button>`;
}

function settingsRowHtml({ icon, label, sublabel = "", right = "", onclick = "" }) {
  return `
    <div class="settings-row" ${onclick ? `style="cursor:pointer" onclick="${onclick}"` : ""}>
      <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line text-sec grid place-items-center">${icon}</span>
      <span class="flex-1 min-w-0">
        <span class="block text-[14.5px] text-ink">${label}</span>
        ${sublabel ? `<span class="block text-xs text-muted mt-0.5">${sublabel}</span>` : ""}
      </span>
      ${right || svgIcon("chevron", 18)}
    </div>
  `;
}

const NSFW_CONFIRM_STEPS = [
  () => t("settings_nsfw_confirm_step_1"),
  () => t("settings_nsfw_confirm_step_2"),
  () => t("settings_nsfw_confirm_step_3"),
  () => t("settings_nsfw_confirm_step_4"),
];

class SettingsView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.settings = await api("/api/me/settings");
    } catch (e) {
      this.settings = { overrides: {}, defaults: {} };
      errorToast(t("settings_couldnt_load_settings_showing_defaults"));
    }
    this.render();
  }

  render() {
    const theme = getThemeState();
    const activeBaseState = theme[theme.activeBase];
    const accentLabel = activeBaseState.accentId === "custom" ? "Custom" : ACCENT_NAMES[activeBaseState.accentId];
    const themeSummary = `${theme.activeBase === "dark" ? "Dark" : "Light"} · ${accentLabel}`;
    const overrides = this.settings.overrides || {};
    let modelSummary = "Default";
    if (overrides.base_url) {
      try { modelSummary = new URL(overrides.base_url).host; } catch { modelSummary = "Custom endpoint"; }
    }
    const nsfwOn = !!ME?.nsfw_allowed;
    const privacyOn = document.documentElement.dataset.censor === "1";
    const experimentalOn = !!ME?.experimental_features_enabled;

    this.main.innerHTML = `
      <div class="content-col">
      ${pageHeaderHtml(t("nav_dossier"), "Account", t("nav_settings"), t("ph_settings_sub"))}
      <div class="flex items-center gap-3.5 p-3.5 rounded-2xl border border-line bg-surface mb-4">
        <span class="w-12 h-12 rounded-full p-[2.5px] flex-none" style="background:${ME?.accent_color ? `linear-gradient(135deg, ${_attr(ME.accent_color)}, ${_attr(ME.banner_color || ME.accent_color)})` : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))"}">
          <span class="block w-full h-full rounded-full overflow-hidden bg-surface-2 grid place-items-center">
            ${ME?.avatar ? `<img src="${_attr(ME.avatar)}" alt="" class="w-full h-full object-cover">` : `<span class="font-display font-semibold text-lg text-ink">${(ME?.username || "?")[0].toUpperCase()}</span>`}
          </span>
        </span>
        <div class="min-w-0">
          <div class="font-display font-semibold text-[15.5px] text-ink truncate">${_esc(ME?.display_name || ME?.username || "")}</div>
          <div class="text-xs text-muted mt-0.5">@${_esc(ME?.username || "")}${ME?.role && ME.role !== "user" ? " · " + (ME.role === "dev" ? t("artisans_dev") : t("artisans_admin")) : ""}</div>
        </div>
      </div>
      ${sEyebrowHtml(t("settings_section_preferences"))}
      ${settingsRowHtml({ icon: svgIcon("appearance"), label: t("settings_row_appearance"), sublabel: themeSummary, onclick: "navigate('/settings-appearance')" })}
      ${settingsRowHtml({ icon: svgIcon("model"), label: t("settings_row_model"), sublabel: modelSummary, onclick: "navigate('/settings-model')" })}
      ${sEyebrowHtml(t("settings_section_safety"))}
      ${settingsRowHtml({ icon: svgIcon("eye"), label: t("settings_row_enable_mature_content"), sublabel: t("settings_row_enable_mature_content_sub"), right: toggleSwitchHtml("settingsView.toggleNsfw()", nsfwOn) })}
      ${settingsRowHtml({ icon: svgIcon("eyeOff"), label: t("settings_row_privacy_blur"), sublabel: t("settings_row_privacy_blur_sub"), right: toggleSwitchHtml("settingsView.togglePrivacy()", privacyOn) })}
      ${settingsRowHtml({ icon: svgIcon("ban"), label: t("settings_row_blocked_creators_tags"), sublabel: t("settings_row_blocked_creators_tags_sub"), onclick: "navigate('/settings-blocks')" })}
      ${sEyebrowHtml(t("settings_section_account"))}
      ${settingsRowHtml({ icon: svgIcon("lock"), label: t("settings_row_account_lang"), sublabel: t("settings_row_account_lang_sub"), onclick: "navigate('/settings-account')" })}
      ${settingsRowHtml({ icon: svgIcon("book"), label: t("settings_row_docs", "Docs & API"), sublabel: t("settings_row_docs_sub", "How StoryHaven works, and the raw API"), onclick: "navigate('/settings-docs')" })}
      ${sEyebrowHtml(t("settings_section_experimental", "Experimental"))}
      ${settingsRowHtml({ icon: svgIcon("beaker"), label: t("settings_row_experimental_features", "Enable multiplayer chat (experimental)"), sublabel: t("settings_row_experimental_features_sub", "Unlocks Multiplayer below — share a chat session with up to 8 people"), right: toggleSwitchHtml("settingsView.toggleExperimentalFeatures()", experimentalOn) })}
      ${experimentalOn ? settingsRowHtml({ icon: svgIcon("masks"), label: t("settings_row_multiplayer", "Multiplayer"), sublabel: t("settings_row_multiplayer_sub", "Invite links, party chat, and who's in your sessions"), onclick: "navigate('/multiplayer')" }) : ""}
      ${ME?.role === "admin" || ME?.role === "dev" ? settingsRowHtml({ icon: svgIcon("shield"), label: t("settings_row_admin"), sublabel: "Users, roles, server", onclick: "navigate('/admin')" }) : ""}
      <button type="button" onclick="confirmSignOut()"
        class="w-full flex items-center justify-center gap-2 mt-5 py-3.5 rounded-[13px] font-medium text-[14.5px]"
        style="border:1px solid var(--color-warn);background:color-mix(in srgb, var(--color-warn) 12%, transparent);color:var(--color-warn)">
        ${svgIcon("logout")} ${t("nav_sign_out")}
      </button>
      </div>
    `;
  }

  async confirmNsfwEnable() {
    for (const message of NSFW_CONFIRM_STEPS) {
      if (!await confirmDialog(message(), { confirmLabel: t("settings_continue"), danger: false })) return false;
    }
    return true;
  }

  async toggleNsfw() {
    if (ME?.nsfw_allowed) {
      try {
        await api("/api/me/nsfw", { method: "PUT", body: JSON.stringify({ allowed: false }) });
        ME.nsfw_allowed = false;
        toast(t("settings_mature_content_disabled"));
      } catch (e) { errorToast(e.message); }
      this.render();
      return;
    }
    const confirmed = await this.confirmNsfwEnable();
    if (!confirmed) return;
    try {
      await api("/api/me/nsfw", { method: "PUT", body: JSON.stringify({ allowed: true }) });
      ME.nsfw_allowed = true;
      toast(t("settings_mature_content_enabled"));
    } catch (e) { errorToast(e.message); }
    this.render();
  }

  togglePrivacy() {
    cycleCensor();
    this.render();
  }

  async toggleExperimentalFeatures() {
    const enabling = !ME?.experimental_features_enabled;
    try {
      await api("/api/me/experimental-features", { method: "PUT", body: JSON.stringify({ enabled: enabling }) });
      ME.experimental_features_enabled = enabling;
      toast(enabling
        ? t("settings_experimental_features_enabled", "Multiplayer unlocked. Look for it in the nav.")
        : t("settings_experimental_features_disabled", "Multiplayer hidden again."));
    } catch (e) { errorToast(e.message); }
    this.render();
  }
}

if (typeof window !== "undefined") {
  window.SettingsView = SettingsView;
}
