"use strict";

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
      <div data-admin-dev-container></div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
  }
}

if (typeof window !== "undefined") {
  window.AdminDevView = AdminDevView;
}
