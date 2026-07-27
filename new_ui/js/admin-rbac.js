"use strict";

class AdminRbacView {
  async mount(main) {
    this.main = main;
    this.roles = [];
    this.capabilities = [];
    this.activeRole = null;
    this.state = {};
    this.original = {};
    this.openNs = new Set();
    this.render();
    await this.loadAll();
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_rbac_title", "Roles & capabilities"), t("ph_admin_rbac_sub", "Grant or revoke exactly what each role can do."))}
      ${adminScreenSwitcherHtml("admin-rbac", window._adminSwitcherBadges || {})}
      <div id="rbacRoleTabs" class="flex gap-2 overflow-x-auto pb-3 mb-3 border-b border-line"></div>
      <div id="rbacNewRoleForm" class="hidden flex-wrap gap-2 items-center border border-line rounded-lg p-2.5 bg-surface mb-3">
        <input type="text" id="rbacNewRoleInput" placeholder="${_attr(t("admin_rbac_new_role_placeholder", "new_role_name"))}" class="flex-1 min-w-[140px] bg-surface-2 border border-line rounded-md px-2.5 py-2 text-sm text-ink font-mono">
        <button type="button" id="rbacCreateRoleBtn" class="px-3 py-2 rounded-md text-xs font-semibold" style="background:var(--color-accent);color:#1a1408">${t("admin_rbac_create_button", "Create")}</button>
        <button type="button" id="rbacCancelRoleBtn" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("common_cancel", "Cancel")}</button>
      </div>
      <div id="rbacRoleMeta" class="flex items-center justify-between gap-3 mb-4 flex-wrap"></div>
      <div id="rbacNsGroups"></div>
      </div>
      <div id="rbacSaveBar" class="hidden fixed left-0 right-0 bottom-0 z-20 flex items-center gap-3 flex-wrap px-4 py-3 border-t border-line bg-surface" style="box-shadow:0 -8px 24px rgba(0,0,0,0.35)">
        <span id="rbacStatus" class="text-xs" style="color:var(--color-sec)"></span>
        <div class="flex-1"></div>
        <button type="button" id="rbacDiscardBtn" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("common_discard", "Discard")}</button>
        <button type="button" id="rbacReviewBtn" class="px-3 py-2 rounded-md text-xs font-semibold" style="background:var(--color-accent);color:#1a1408">${t("admin_rbac_review_save", "Review & save")}</button>
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    document.getElementById("rbacCancelRoleBtn").onclick = () => this.toggleNewRoleForm(false);
    document.getElementById("rbacCreateRoleBtn").onclick = () => this.createRole();
    document.getElementById("rbacDiscardBtn").onclick = () => this.discard();
    document.getElementById("rbacReviewBtn").onclick = () => this.openReviewModal();
  }

  async loadAll() {
    try {
      const [roles, caps] = await Promise.all([
        api("/api/admin/rbac/roles"),
        api("/api/admin/rbac/capabilities"),
      ]);
      this.roles = roles;
      this.capabilities = caps;
    } catch (e) {
      errorToast(e.message || t("admin_rbac_load_failed", "Couldn't load roles."));
      return;
    }
    if (!this.activeRole && this.roles.length) this.activeRole = this.roles[0].name;
    const namespaces = [...new Set(this.capabilities.map((c) => c.namespace))];
    if (!this.openNs.size && namespaces.length) this.openNs.add(namespaces[0]);
    await this.loadActiveRoleCapabilities();
    this.renderTabs();
    this.renderMeta();
    this.renderGroups();
  }

  async loadActiveRoleCapabilities() {
    if (!this.activeRole) return;
    if (this.state[this.activeRole]) return;
    try {
      const granted = await api(`/api/admin/rbac/roles/${encodeURIComponent(this.activeRole)}/capabilities`);
      this.state[this.activeRole] = new Set(granted);
      this.original[this.activeRole] = new Set(granted);
    } catch (e) {
      this.state[this.activeRole] = new Set();
      this.original[this.activeRole] = new Set();
    }
  }

  isDirty(role) {
    const a = this.state[role], b = this.original[role];
    if (!a || !b) return false;
    if (a.size !== b.size) return true;
    for (const k of a) if (!b.has(k)) return true;
    return false;
  }

  renderTabs() {
    const el = document.getElementById("rbacRoleTabs");
    el.innerHTML = this.roles.map((r) => `
      <button type="button" data-role-tab="${_attr(r.name)}"
        class="flex-none px-3 py-2 rounded-full border text-xs whitespace-nowrap"
        style="${r.name === this.activeRole
          ? "border-color:var(--color-accent);color:var(--color-ink);background:color-mix(in srgb, var(--color-accent) 8%, transparent)"
          : "border-color:var(--color-line);color:var(--color-sec)"}">
        ${_esc(r.label)}
        <span class="text-[10px] ml-1" style="color:var(--color-muted)">${r.user_count}</span>
      </button>
    `).join("") + `
      <button type="button" id="rbacNewRoleTab" class="flex-none px-3 py-2 rounded-full border border-dashed text-xs whitespace-nowrap" style="border-color:var(--color-accent);color:var(--color-accent)">
        + ${t("admin_rbac_new_role", "New role")}
      </button>`;
    el.querySelectorAll("[data-role-tab]").forEach((btn) => {
      btn.onclick = async () => {
        if (this.isDirty(this.activeRole)) {
          const proceed = confirm(t("admin_rbac_unsaved_switch_confirm", "Discard unsaved changes to this role?"));
          if (!proceed) return;
          this.state[this.activeRole] = new Set(this.original[this.activeRole]);
        }
        this.activeRole = btn.dataset.roleTab;
        await this.loadActiveRoleCapabilities();
        this.renderTabs();
        this.renderMeta();
        this.renderGroups();
        this.updateSaveBar();
      };
    });
    document.getElementById("rbacNewRoleTab").onclick = () => this.toggleNewRoleForm(true);
  }

  toggleNewRoleForm(show) {
    const form = document.getElementById("rbacNewRoleForm");
    form.classList.toggle("hidden", !show);
    form.classList.toggle("flex", show);
    if (show) document.getElementById("rbacNewRoleInput").focus();
    else document.getElementById("rbacNewRoleInput").value = "";
  }

  async createRole() {
    const input = document.getElementById("rbacNewRoleInput");
    const name = input.value.trim().toLowerCase().replace(/\s+/g, "_");
    if (!name) return;
    try {
      await api("/api/admin/rbac/roles", { method: "POST", body: JSON.stringify({ name, label: name }) });
    } catch (e) {
      errorToast(e.message || t("admin_rbac_create_failed", "Couldn't create that role."));
      return;
    }
    this.toggleNewRoleForm(false);
    this.activeRole = name;
    this.state[name] = new Set();
    this.original[name] = new Set();
    await this.loadAll();
    toast(t("admin_rbac_role_created", "Role created."));
  }

  async deleteActiveRole() {
    const role = this.roles.find((r) => r.name === this.activeRole);
    if (!role || role.is_builtin) return;
    if (!confirm(t("admin_rbac_delete_role_confirm", "Delete this role? This can't be undone."))) return;
    try {
      await api(`/api/admin/rbac/roles/${encodeURIComponent(this.activeRole)}`, { method: "DELETE" });
    } catch (e) {
      errorToast(e.message || t("admin_rbac_delete_failed", "Couldn't delete that role."));
      return;
    }
    delete this.state[this.activeRole];
    delete this.original[this.activeRole];
    this.activeRole = null;
    await this.loadAll();
    toast(t("admin_rbac_role_deleted", "Role deleted."));
  }

  renderMeta() {
    const el = document.getElementById("rbacRoleMeta");
    const role = this.roles.find((r) => r.name === this.activeRole);
    if (!role) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="flex items-center gap-2">
        <h2 class="font-display text-lg text-ink">${_esc(role.label)}</h2>
        ${role.is_builtin ? `<span class="text-[10px] uppercase tracking-wide text-muted border border-line rounded px-1.5 py-0.5">${t("admin_rbac_builtin", "Built-in")}</span>` : ""}
      </div>
      ${!role.is_builtin ? `<button type="button" id="rbacDeleteRoleBtn" class="text-xs underline" style="color:var(--color-muted)">${t("admin_rbac_delete_role", "Delete this role")}</button>` : ""}
    `;
    const delBtn = document.getElementById("rbacDeleteRoleBtn");
    if (delBtn) delBtn.onclick = () => this.deleteActiveRole();
  }

  renderGroups() {
    const container = document.getElementById("rbacNsGroups");
    if (!this.activeRole) { container.innerHTML = ""; return; }
    const namespaces = [...new Set(this.capabilities.map((c) => c.namespace))];
    const state = this.state[this.activeRole] || new Set();
    container.innerHTML = namespaces.map((ns) => {
      const caps = this.capabilities.filter((c) => c.namespace === ns);
      const granted = caps.filter((c) => state.has(c.key)).length;
      const open = this.openNs.has(ns);
      return `
        <div class="mb-1.5">
          <div data-ns-head="${_attr(ns)}" class="flex items-center gap-2 py-2.5 px-1 cursor-pointer">
            <span class="text-[11px] uppercase tracking-wide font-mono flex-1" style="color:var(--color-muted)">${_esc(ns)}</span>
            <span class="text-[11px]" style="color:var(--color-muted)">${granted}/${caps.length}</span>
            <span class="text-[10px] transition-transform" style="color:var(--color-muted);transform:rotate(${open ? "180" : "0"}deg)">▾</span>
          </div>
          <div class="${open ? "" : "hidden"} border-t border-line" data-ns-list="${_attr(ns)}">
            ${caps.map((c) => `
              <label class="flex items-start gap-2.5 py-2.5 px-1 border-b border-line last:border-0 cursor-pointer">
                <input type="checkbox" data-cap-key="${_attr(c.key)}" ${state.has(c.key) ? "checked" : ""} class="mt-0.5 flex-none" style="accent-color:var(--color-accent)">
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-mono text-ink">${_esc(c.key)}</div>
                  <div class="text-xs mt-0.5" style="color:var(--color-sec)">${_esc(c.description)}</div>
                </div>
              </label>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");
    container.querySelectorAll("[data-ns-head]").forEach((head) => {
      head.onclick = () => {
        const ns = head.dataset.nsHead;
        this.openNs.has(ns) ? this.openNs.delete(ns) : this.openNs.add(ns);
        this.renderGroups();
      };
    });
    container.querySelectorAll("[data-cap-key]").forEach((cb) => {
      cb.onchange = () => {
        const key = cb.dataset.capKey;
        const s = this.state[this.activeRole];
        cb.checked ? s.add(key) : s.delete(key);
        this.renderGroups();
        this.renderTabs();
        this.updateSaveBar();
      };
    });
  }

  updateSaveBar() {
    const dirty = this.isDirty(this.activeRole);
    const added = [...(this.state[this.activeRole] || [])].filter((k) => !(this.original[this.activeRole] || new Set()).has(k)).length;
    const removed = [...(this.original[this.activeRole] || [])].filter((k) => !(this.state[this.activeRole] || new Set()).has(k)).length;
    const total = added + removed;
    document.getElementById("rbacStatus").textContent = `${total} ${total === 1 ? t("admin_rbac_capability_singular", "capability changed") : t("admin_rbac_capability_plural", "capabilities changed")}`;
    document.getElementById("rbacSaveBar").classList.toggle("hidden", total === 0);
    document.getElementById("rbacReviewBtn").disabled = total === 0;
  }

  discard() {
    this.state[this.activeRole] = new Set(this.original[this.activeRole]);
    this.renderTabs();
    this.renderGroups();
    this.updateSaveBar();
  }

  openReviewModal() {
    const role = this.activeRole;
    const added = [...this.state[role]].filter((k) => !this.original[role].has(k));
    const removed = [...this.original[role]].filter((k) => !this.state[role].has(k));
    const rows = [
      ...added.map((k) => `<div class="text-xs py-1.5 border-b border-line font-mono">${_esc(k)} — <span style="color:var(--color-success)">${t("admin_rbac_granted", "granted")}</span></div>`),
      ...removed.map((k) => `<div class="text-xs py-1.5 border-b border-line font-mono">${_esc(k)} — <span style="color:var(--color-warn)">${t("admin_rbac_revoked", "revoked")}</span></div>`),
    ].join("");
    const adminPanelNamespaces = new Set([...new Set(this.capabilities.map((c) => c.namespace))].filter((n) => n !== "test_site"));
    const lockoutCap = role === "admin"
      ? removed.find((k) => adminPanelNamespaces.has(k.split(".")[0]) && k.includes(".view"))
      : null;
    openModal(`
      <div style="padding:4px 2px">
        <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 4px">${t("admin_rbac_confirm_title", "Confirm capability changes")}</h3>
        <p style="font-size:12px;color:var(--color-muted);margin:0 0 12px">${t("admin_rbac_confirm_sub", "These take effect immediately for every user with this role.")}</p>
        ${lockoutCap ? `
        <div style="border:1px solid var(--color-warn);background:color-mix(in srgb, var(--color-warn) 8%, transparent);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--color-warn)">
          ${t("admin_rbac_lockout_warning_prefix", "This removes Admin's own")} <span class="font-mono">${_esc(lockoutCap)}</span> ${t("admin_rbac_lockout_warning_suffix", "capability. Once saved, no admin — including you — can undo this from the UI without direct database access.")}
        </div>` : ""}
        <div style="max-height:320px;overflow-y:auto;margin-bottom:14px">${rows || `<div class="text-xs" style="color:var(--color-muted)">${t("admin_rbac_no_changes", "No changes.")}</div>`}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" id="rbacModalCancel" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("common_cancel", "Cancel")}</button>
          <button type="button" id="rbacModalConfirm" class="px-3 py-2 rounded-md text-xs font-semibold" style="background:var(--color-accent);color:#1a1408">${t("admin_rbac_confirm_save", "Confirm & save")}</button>
        </div>
      </div>
    `);
    document.getElementById("rbacModalCancel").onclick = () => closeModal();
    document.getElementById("rbacModalConfirm").onclick = () => this.confirmSave();
  }

  async confirmSave() {
    const role = this.activeRole;
    const capabilities = [...this.state[role]];
    try {
      await api(`/api/admin/rbac/roles/${encodeURIComponent(role)}/capabilities`, {
        method: "PUT", body: JSON.stringify({ capabilities }),
      });
    } catch (e) {
      errorToast(e.message || t("admin_rbac_save_failed", "Couldn't save changes."));
      return;
    }
    this.original[role] = new Set(capabilities);
    closeModal();
    this.renderTabs();
    this.renderGroups();
    this.updateSaveBar();
    toast(t("admin_rbac_saved", "Capabilities saved."));
  }
}

if (typeof window !== "undefined") {
  window.AdminRbacView = AdminRbacView;
}
