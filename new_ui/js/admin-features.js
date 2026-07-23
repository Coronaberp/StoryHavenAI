"use strict";

class AdminFeaturesPanel {
  constructor() {
    this.flags = {};
    this.selected = new Set();
  }

  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    await this.load();
  }

  async load() {
    try {
      this.flags = await api("/api/admin/feature-flags");
    } catch (e) {
      this.flags = {};
      errorToast(t("admin_features_couldnt_load", "Couldn't load feature flags."));
    }
    this.renderShell();
  }

  renderShell() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_features_title", "Feature Flags"), t("ph_admin_features_sub", "Disable or restore features platform-wide."))}
      <div data-admin-features-container></div>
      </div>
    `;
    const container = this.main.querySelector("[data-admin-features-container]");
    this.render(container);
  }

  render(container) {
    const rows = Object.entries(this.flags).map(([key, flag]) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--color-line);border-radius:10px;margin-bottom:6px">
        <input type="checkbox" data-feature-key="${_attr(key)}" ${this.selected.has(key) ? "checked" : ""}>
        <span style="flex:1">
          <div style="font-weight:600;color:var(--color-ink)">${_esc(flag.label)}</div>
          <div style="font-size:12px;color:${flag.enabled ? "var(--color-success)" : "var(--color-cmd-yellow)"}">
            ${flag.enabled ? t("admin_features_state_enabled", "Enabled") : t("admin_features_state_disabled", "Disabled")}
            ${!flag.enabled && flag.updated_by_name ? ` · ${_esc(flag.updated_by_role === "dev" ? "Dev" : "Admin")} ${_esc(flag.updated_by_name)}` : ""}
          </div>
        </span>
      </label>
    `).join("");
    container.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button type="button" id="adminFeaturesDisableSelected" class="pe-gen-btn">${t("admin_features_disable_selected", "Disable selected")}</button>
        <button type="button" id="adminFeaturesEnableSelected" class="pe-gen-btn">${t("admin_features_enable_selected", "Enable selected")}</button>
      </div>
      <div>${rows}</div>
    `;
    container.querySelectorAll("[data-feature-key]").forEach((el) => {
      el.onchange = () => {
        if (el.checked) this.selected.add(el.dataset.featureKey);
        else this.selected.delete(el.dataset.featureKey);
      };
    });
    container.querySelector("#adminFeaturesDisableSelected").onclick = () => {
      const keys = [...this.selected].filter((k) => this.flags[k]?.enabled);
      if (!keys.length) return;
      this.runDisableWizard(keys);
    };
    container.querySelector("#adminFeaturesEnableSelected").onclick = () => {
      const keys = [...this.selected].filter((k) => !this.flags[k]?.enabled);
      if (!keys.length) return;
      this.runEnableWizard(keys);
    };
  }

  async refreshAndRerender(container) {
    this.flags = await api("/api/admin/feature-flags").catch(() => this.flags);
    this.selected.clear();
    this.render(container);
  }

  async runWizardSteps(steps) {
    let stepIndex = 0;
    const context = {};
    while (stepIndex < steps.length) {
      const step = steps[stepIndex];
      const result = await step.render(context);
      if (result === "cancel") return null;
      stepIndex += 1;
    }
    return context;
  }

  runDisableWizard(keys) {
    const labels = keys.map((k) => this.flags[k].label);
    const steps = [
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step1_title", "Confirm which features you're disabling")}</h3>
              <ul style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${labels.map((l) => `<li>${_esc(l)}</li>`).join("")}</ul>
              <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-ink);margin-bottom:16px">
                <input type="checkbox" id="wizardStep1Ack">
                ${t("admin_features_wizard_step1_ack", "I have reviewed this list")}
              </label>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep1Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep1Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const ack = layer.querySelector("#wizardStep1Ack");
          const next = layer.querySelector("#wizardStep1Next");
          ack.onchange = () => { next.disabled = !ack.checked; };
          layer.querySelector("#wizardStep1Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const impacts = keys.map((k) => `<li>${_esc(this.flags[k].label)}: ${_esc(this.flags[k].impact || "")}</li>`).join("");
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step2_title", "What breaks for users")}</h3>
              <ul style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${impacts}</ul>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep2Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep2Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep2Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep2Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step3_title", "Message and estimated downtime")}</h3>
              <textarea id="wizardStep3Message" placeholder="${_attr(t("admin_features_wizard_message_placeholder", "Why is this disabled?"))}" style="width:100%;min-height:70px;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:10px"></textarea>
              <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-ink);margin-bottom:10px">
                <input type="checkbox" id="wizardStep3Blank">
                ${t("admin_features_wizard_leave_blank", "Leave blank, use generic message")}
              </label>
              <input type="number" id="wizardStep3Eta" placeholder="${_attr(t("admin_features_wizard_eta_placeholder", "Estimated minutes until back (optional)"))}" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep3Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep3Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep3Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep3Next").onclick = () => {
            const blank = layer.querySelector("#wizardStep3Blank").checked;
            const messageValue = layer.querySelector("#wizardStep3Message").value.trim();
            ctx.message = blank ? null : (messageValue || null);
            const etaValue = layer.querySelector("#wizardStep3Eta").value.trim();
            ctx.etaMinutes = etaValue ? parseInt(etaValue, 10) : null;
            closeModal(layer);
            resolve("next");
          };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const confirmPhrase = keys.length === 1 ? keys[0] : "DISABLE ALL SELECTED";
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step4_title", "Type to confirm")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 10px">${t("admin_features_wizard_step4_body", "Type this exactly")}: <strong>${_esc(confirmPhrase)}</strong></p>
              <input type="text" id="wizardStep4Input" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep4Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep4Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const input = layer.querySelector("#wizardStep4Input");
          const next = layer.querySelector("#wizardStep4Next");
          input.oninput = () => { next.disabled = input.value !== confirmPhrase; };
          layer.querySelector("#wizardStep4Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step5_title", "Dev accounts stay unaffected")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_wizard_step5_body", "Dev-tier accounts will keep using these features normally, so they can keep testing while everyone else sees the disabled state.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep5Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep5Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep5Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep5Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise(async (resolve) => {
          const activeUsers = await api("/api/admin/feature-flags/active-user-count").catch(() => ({ count: "an unknown number of" }));
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step6_title", "This notifies everyone right now")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_wizard_step6_body", "This will immediately notify {n} active users.").replace("{n}", activeUsers.count)}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep6Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep6Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep6Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep6Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-warn)">${t("admin_features_wizard_step7_title", "Final confirmation")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:10px 0 16px">${t("admin_features_wizard_step7_body", "This applies immediately and cannot be undone from here except by re-enabling.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="wizardStep7Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="wizardStep7Confirm" class="pe-gen-btn" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_features_wizard_confirm_shutdown", "CONFIRM SHUTDOWN")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#wizardStep7Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#wizardStep7Confirm").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
    ];
    this.runWizardSteps(steps).then(async (context) => {
      if (!context) return;
      try {
        await api("/api/admin/feature-flags/batch", {
          method: "PUT",
          body: JSON.stringify({ keys, enabled: false, message: context.message, eta_minutes: context.etaMinutes }),
        });
        const container = document.querySelector("[data-admin-features-container]");
        if (container) await this.refreshAndRerender(container);
      } catch (e) {
        errorToast(t("admin_features_disable_failed", "Failed to disable features.") + " " + (e.message || ""));
      }
    });
  }

  runEnableWizard(keys) {
    const labels = keys.map((k) => this.flags[k].label);
    const steps = [
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step1_title", "Confirm which features you're restoring")}</h3>
              <ul style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${labels.map((l) => `<li>${_esc(l)}</li>`).join("")}</ul>
              <label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--color-ink);margin-bottom:16px">
                <input type="checkbox" id="enableStep1Ack">
                ${t("admin_features_wizard_step1_ack", "I have reviewed this list")}
              </label>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep1Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep1Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const ack = layer.querySelector("#enableStep1Ack");
          const next = layer.querySelector("#enableStep1Next");
          ack.onchange = () => { next.disabled = !ack.checked; };
          layer.querySelector("#enableStep1Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step2_title", "What becomes available again")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step2_body", "All users, not just Dev accounts, will immediately be able to use these features normally again.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep2Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep2Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep2Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep2Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step3_title", "Existing message and ETA will be cleared")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step3_body", "Any downtime message and estimated return time currently shown to users will be removed once this restores.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep3Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep3Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep3Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep3Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const confirmPhrase = keys.length === 1 ? keys[0] : "RESTORE ALL SELECTED";
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_wizard_step4_title", "Type to confirm")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 10px">${t("admin_features_wizard_step4_body", "Type this exactly")}: <strong>${_esc(confirmPhrase)}</strong></p>
              <input type="text" id="enableStep4Input" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep4Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep4Next" class="pe-gen-btn" disabled>${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          const input = layer.querySelector("#enableStep4Input");
          const next = layer.querySelector("#enableStep4Next");
          input.oninput = () => { next.disabled = input.value !== confirmPhrase; };
          layer.querySelector("#enableStep4Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          next.onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step5_title", "Dev accounts already had this working")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step5_body", "Dev-tier accounts have been using these features normally the whole time this was disabled for everyone else.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep5Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep5Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep5Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep5Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise(async (resolve) => {
          const activeUsers = await api("/api/admin/feature-flags/active-user-count").catch(() => ({ count: "an unknown number of" }));
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_features_enable_wizard_step6_title", "This notifies everyone right now")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:0 0 16px">${t("admin_features_enable_wizard_step6_body", "This will immediately notify {n} active users that it's back.").replace("{n}", activeUsers.count)}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep6Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep6Next" class="pe-gen-btn">${t("admin_features_wizard_next", "Next")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep6Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep6Next").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
      {
        render: (ctx) => new Promise((resolve) => {
          const layer = openModal(`
            <div style="padding:4px 2px">
              <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${t("admin_features_enable_wizard_step7_title", "Final confirmation")}</h3>
              <p style="font-size:13px;color:var(--color-sec);margin:10px 0 16px">${t("admin_features_enable_wizard_step7_body", "This applies immediately.")}</p>
              <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" id="enableStep7Cancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
                <button type="button" id="enableStep7Confirm" class="pe-gen-btn" style="border-color:var(--color-accent);color:var(--color-accent)">${t("admin_features_wizard_confirm_restore", "CONFIRM RESTORE")}</button>
              </div>
            </div>
          `, { dismissible: false });
          layer.querySelector("#enableStep7Cancel").onclick = () => { closeModal(layer); resolve("cancel"); };
          layer.querySelector("#enableStep7Confirm").onclick = () => { closeModal(layer); resolve("next"); };
        }),
      },
    ];
    this.runWizardSteps(steps).then(async (context) => {
      if (!context) return;
      try {
        await api("/api/admin/feature-flags/batch", {
          method: "PUT",
          body: JSON.stringify({ keys, enabled: true, message: null, eta_minutes: null }),
        });
        const container = document.querySelector("[data-admin-features-container]");
        if (container) await this.refreshAndRerender(container);
      } catch (e) {
        errorToast(t("admin_features_enable_failed", "Failed to enable features.") + " " + (e.message || ""));
      }
    });
  }
}

if (typeof window !== "undefined") {
  window.AdminFeaturesPanel = AdminFeaturesPanel;
}
