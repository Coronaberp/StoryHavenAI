"use strict";

const ADMIN_DEV_E2E_COMMAND = "cd tests/e2e && python3 -m pytest -v";

class AdminDevView {
  async mount(main) {
    this.main = main;
    this.translationStatus = null;
    this.render();
    this.loadTranslationStatus();
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_dev_title", "Dev"), t("ph_admin_dev_sub", "Test running, translations, and model procurement."))}
      ${adminScreenSwitcherHtml("admin-dev", window._adminSwitcherBadges || {})}
      <div class="border border-line rounded-lg p-3 mb-3">
        <div class="font-display font-semibold text-sm text-ink mb-1">${t("admin_dev_e2e_title", "Run E2E tests")}</div>
        <p class="text-xs text-muted mb-3">${t("admin_dev_e2e_description", "Playwright needs a real browser your host already has — run this in a terminal on the host.")}</p>
        <pre class="text-xs font-mono bg-surface-2 rounded-md p-2.5 mb-3 overflow-x-auto">${_esc(ADMIN_DEV_E2E_COMMAND)}</pre>
        <button type="button" id="devCopyE2eCommand" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_dev_e2e_copy_button", "Copy command")}</button>
      </div>
      <div class="border border-line rounded-lg p-3 mb-3">
        <div class="font-display font-semibold text-sm text-ink mb-1">${t("admin_config_resync_ui_translations_title")}</div>
        <p class="text-xs text-muted mb-3">${t("admin_config_resync_ui_translations_description")}</p>
        <div class="text-[10px] uppercase tracking-wide text-muted mb-1">${t("admin_dev_translation_status_label", "Coverage by language")}</div>
        <div id="devTranslationStatus" class="text-xs font-mono text-ink bg-surface-2 rounded-md p-2.5 mb-3 leading-relaxed">${t("common_loading", "Loading…")}</div>
        <button type="button" id="devResyncTranslations" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_config_resync_ui_translations_button")}</button>
      </div>
      <div data-admin-dev-container></div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    document.getElementById("devCopyE2eCommand").onclick = () => this.copyE2eCommand();
    document.getElementById("devResyncTranslations").onclick = () => this.resyncUiTranslations();
  }

  copyE2eCommand() {
    navigator.clipboard?.writeText(ADMIN_DEV_E2E_COMMAND);
    toast(t("admin_dev_e2e_command_copied", "Command copied"));
  }

  async loadTranslationStatus() {
    const el = document.getElementById("devTranslationStatus");
    try {
      this.translationStatus = await api("/api/admin/dev/ui-translations-status", {
        method: "POST", body: JSON.stringify({ strings: UI_STRINGS }),
      });
    } catch (e) {
      if (el) el.textContent = t("admin_dev_translation_status_failed", "Couldn't load translation status.");
      return;
    }
    if (!el) return;
    if (this.translationStatus.total_missing === 0) {
      el.textContent = t("admin_dev_translations_all_synced", "All translations up to date.");
      return;
    }
    const rows = this.translationStatus.languages
      .filter((l) => l.missing_count > 0)
      .map((l) => `${_esc(l.lang)}: ${l.missing_count}`)
      .join(" · ");
    el.textContent = `${this.translationStatus.total_missing} ${t("admin_dev_translations_missing_suffix", "missing")} — ${rows}`;
  }

  async resyncUiTranslations() {
    const btn = document.getElementById("devResyncTranslations");
    if (btn) { btn.disabled = true; btn.textContent = t("admin_config_resync_ui_translations_starting"); }
    try {
      const r = await api("/api/admin/resync-ui-translations", { method: "POST", body: JSON.stringify({ strings: UI_STRINGS }) });
      toast(`${t("admin_config_resync_ui_translations_started_prefix")} ${r.keys} ${t("admin_config_resync_ui_translations_started_middle")} ${r.languages} ${t("admin_config_resync_ui_translations_started_suffix")}`);
      await this.loadTranslationStatus();
    } catch (e) {
      errorToast(e.message || t("admin_config_resync_ui_translations_failed"));
    }
    if (btn) { btn.disabled = false; btn.textContent = t("admin_config_resync_ui_translations_button"); }
  }
}

if (typeof window !== "undefined") {
  window.AdminDevView = AdminDevView;
}
