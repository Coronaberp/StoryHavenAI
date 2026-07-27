"use strict";

const ADMIN_DEV_E2E_COMMAND = "cd tests/e2e && python3 -m pytest -v";

class AdminDevView {
  async mount(main) {
    this.main = main;
    this.render();
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
      <div data-admin-dev-container></div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    document.getElementById("devCopyE2eCommand").onclick = () => this.copyE2eCommand();
  }

  copyE2eCommand() {
    navigator.clipboard?.writeText(ADMIN_DEV_E2E_COMMAND);
    toast(t("admin_dev_e2e_command_copied", "Command copied"));
  }
}

if (typeof window !== "undefined") {
  window.AdminDevView = AdminDevView;
}
