"use strict";

class AdminDevView {
  constructor() {
    this.e2ePollTimer = null;
  }

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
        <p class="text-xs text-muted mb-3">${t("admin_dev_e2e_description", "Runs the Playwright auth + chat suite against this dev instance.")}</p>
        <button type="button" id="devRunE2e" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_dev_e2e_run_button", "Run E2E tests")}</button>
        <pre id="devE2eLog" class="mt-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto" style="display:none"></pre>
      </div>
      <div data-admin-dev-container></div>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    document.getElementById("devRunE2e").onclick = () => this.runE2eTests();
  }

  async runE2eTests() {
    const btn = document.getElementById("devRunE2e");
    const logEl = document.getElementById("devE2eLog");
    btn.disabled = true;
    logEl.style.display = "block";
    logEl.textContent = t("admin_dev_e2e_starting", "Starting…");
    try {
      await api("/api/admin/dev/run-e2e-tests", { method: "POST" });
    } catch (e) {
      errorToast(e.message || t("admin_dev_e2e_start_failed", "Couldn't start the test run."));
      btn.disabled = false;
      return;
    }
    this.pollE2eStatus();
  }

  pollE2eStatus() {
    clearInterval(this.e2ePollTimer);
    this.e2ePollTimer = setInterval(async () => {
      let status;
      try {
        status = await api("/api/admin/dev/e2e-test-status");
      } catch (e) {
        return;
      }
      const logEl = document.getElementById("devE2eLog");
      const btn = document.getElementById("devRunE2e");
      if (logEl) logEl.textContent = status.log || "";
      if (!status.running) {
        clearInterval(this.e2ePollTimer);
        if (btn) btn.disabled = false;
        if (status.exit_code === 0) toast(t("admin_dev_e2e_passed", "E2E tests passed"));
        else if (status.exit_code != null) errorToast(t("admin_dev_e2e_failed", "E2E tests failed"));
      }
    }, 2000);
  }
}

if (typeof window !== "undefined") {
  window.AdminDevView = AdminDevView;
}
