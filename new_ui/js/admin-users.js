"use strict";

function adminRoleBadge(u) {
  if (u.role === "dev") return `<span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-accent);border:1px solid var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, transparent)">${t("admin_users_role_dev")}</span>`;
  if (u.is_admin) return `<span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-accent);border:1px solid var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, transparent)">${t("admin_users_role_admin")}</span>`;
  if (u.status === "suspended") return `<span class="font-mono text-[9px] tracking-[.08em] uppercase px-2 py-1 rounded-md" style="color:var(--color-warn);border:1px solid var(--color-warn);background:color-mix(in srgb, var(--color-warn) 12%, transparent)">${t("admin_users_role_suspended")}</span>`;
  return "";
}

class AdminUsersView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    await this.load();
  }

  async load() {
    try {
      this.users = await api("/api/admin/users");
    } catch (e) {
      this.users = [];
      errorToast(t("admin_users_couldnt_load"));
    }
    this.render();
  }

  userActionsHtml(u) {
    return `
      <button type="button" onclick="adminUsersView.resetPassword('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_reset_password")}</button>
      ${u.id !== ME.id ? (u.is_admin
        ? `<button type="button" onclick="adminUsersView.setRole('${_attr(u.id)}', false)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_demote")}</button>`
        : `<button type="button" onclick="adminUsersView.setRole('${_attr(u.id)}', true)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_make_admin")}</button>`) : ""}
      ${ME.role === "dev" && u.is_admin && u.id !== ME.id ? (u.role === "dev"
        ? `<button type="button" onclick="adminUsersView.setDevRole('${_attr(u.id)}', false)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_revoke_dev")}</button>`
        : `<button type="button" onclick="adminUsersView.setDevRole('${_attr(u.id)}', true)" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_grant_dev")}</button>`) : ""}
      ${u.id !== ME.id ? (u.status === "suspended"
        ? `<button type="button" onclick="adminUsersView.unsuspend('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_unsuspend")}</button>`
        : `<button type="button" onclick="adminUsersView.suspend('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_suspend")}</button>`) : ""}
      ${!u.is_admin && u.role !== "admin" && u.role !== "dev" ? (u.tier === "guest"
        ? `<button type="button" onclick="adminUsersView.setTier('${_attr(u.id)}', 'full')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_users_upgrade_full", "Upgrade to full")}</button>`
        : `<button type="button" onclick="adminUsersView.setTier('${_attr(u.id)}', 'guest')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_make_guest", "Make guest")}</button>`) : ""}
      <button type="button" onclick="adminUsersView.manageNotes('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_notes")}</button>
      ${u.totp_enabled ? `<button type="button" onclick="adminUsersView.clearTotp('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_users_clear_totp")}</button>` : ""}
      <button type="button" onclick="adminUsersView.setIdentityLabel('${_attr(u.id)}', ${_attr(JSON.stringify(u.identity_label || ""))})" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_users_identity_label")}</button>
      ${u.id !== ME.id ? `<button type="button" onclick="adminUsersView.deleteUser('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_users_delete")}</button>` : ""}
    `;
  }

  userAvatarHtml(u) {
    return `
      <span class="w-9 h-9 rounded-full overflow-hidden bg-surface-2 grid place-items-center flex-none">
        ${u.avatar ? `<img src="${_attr(u.avatar)}" alt="" class="w-full h-full object-cover">` : `<span class="font-display text-sm text-ink">${_esc((u.display_name || u.username || "?")[0].toUpperCase())}</span>`}
      </span>
    `;
  }

  matchesFilter(u) {
    const f = this.tierFilter || "all";
    const isAdmin = u.is_admin || u.role === "admin" || u.role === "dev";
    if (f === "admins") return isAdmin;
    if (f === "members") return !isAdmin && (u.tier || "full") !== "guest";
    if (f === "guests") return !isAdmin && u.tier === "guest";
    return true;
  }

  filterChipsHtml(visibleCount) {
    const chips = [
      ["all", t("admin_users_filter_all", "All")],
      ["members", t("admin_users_filter_members", "Members")],
      ["guests", t("admin_users_filter_guests", "Guests")],
      ["admins", t("admin_users_filter_admins", "Admins")],
    ];
    return `
      <div class="flex items-center gap-1.5 mb-4 flex-wrap">
        ${chips.map(([key, label]) => `
          <button type="button" class="filter-chip${(this.tierFilter || "all") === key ? " on" : ""}"
            onclick="adminUsersView.tierFilter='${key}';adminUsersView.render()">${label}</button>
        `).join("")}
        <span class="font-mono text-[10.5px] text-muted" style="margin-left:auto">${visibleCount} ${t("admin_users_shown_suffix", "shown")}</span>
      </div>
    `;
  }

  render() {
    const visible = this.users.filter((u) => this.matchesFilter(u));
    const rows = visible.map((u) => `
      <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-2.5 lg:hidden">
        <div class="flex items-center gap-3 mb-2.5">
          ${this.userAvatarHtml(u)}
          <div class="flex-1 min-w-0">
            <div class="font-display font-semibold text-sm text-ink truncate">
              ${_esc(u.username)}
              ${u.identity_label ? `<span class="font-mono text-[9px] text-muted ml-1">(${_esc(u.identity_label)})</span>` : ""}
              ${u.id === ME.id ? `<span class="font-mono text-[9px] text-muted ml-1">${t("admin_users_you")}</span>` : ""}
            </div>
            <div class="font-mono text-[10px] text-muted mt-0.5">${_esc(u.id.slice(0, 8))}…${u.status === "suspended" && u.suspension_reason ? ` · ${_esc(u.suspension_reason)}` : ""}</div>
          </div>
          ${adminRoleBadge(u)}
        </div>
        <div class="flex flex-wrap gap-1.5">${this.userActionsHtml(u)}</div>
      </div>
    `).join("");

    const tableRows = visible.map((u) => `
      <tr class="border-b border-line align-top">
        <td class="py-2.5 pr-3">
          <div class="flex items-center gap-2.5">
            ${this.userAvatarHtml(u)}
            <div class="min-w-0">
              <div class="font-display font-semibold text-sm text-ink truncate">
                ${_esc(u.username)}
                ${u.identity_label ? `<span class="font-mono text-[9px] text-muted ml-1">(${_esc(u.identity_label)})</span>` : ""}
                ${u.id === ME.id ? `<span class="font-mono text-[9px] text-muted ml-1">${t("admin_users_you")}</span>` : ""}
              </div>
              <div class="font-mono text-[10px] text-muted mt-0.5">${_esc(u.id.slice(0, 8))}…</div>
            </div>
          </div>
        </td>
        <td class="py-2.5 pr-3">${adminRoleBadge(u) || `<span class="font-mono text-[10px] text-muted">-</span>`}</td>
        <td class="py-2.5 pr-3">
          ${u.status === "suspended"
            ? `<span class="font-mono text-[10px] text-warn">${t("admin_users_suspended")}${u.suspension_reason ? ` · ${_esc(u.suspension_reason)}` : ""}</span>`
            : `<span class="font-mono text-[10px] text-muted">${t("admin_users_active")}</span>`}
        </td>
        <td class="py-2.5">
          <div class="flex flex-wrap gap-1.5 max-w-[420px]">${this.userActionsHtml(u)}</div>
        </td>
      </tr>
    `).join("");

    this.main.innerHTML = `
      <div class="content-col admin-users-content">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_users_title"), `${this.users.length} ${t("admin_users_users_count_suffix")}`)}
      <button type="button" onclick="adminUsersView.createUser()" class="w-full mb-4 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark lg:w-auto">
        ${t("admin_users_new_user")}
      </button>
      ${this.filterChipsHtml(visible.length)}
      ${rows}
      <div class="hidden lg:block overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b border-line-2 font-mono text-[10px] tracking-[.08em] uppercase text-muted">
              <th class="py-2 pr-3 font-normal">${t("admin_users_column_user")}</th>
              <th class="py-2 pr-3 font-normal">${t("admin_users_column_role")}</th>
              <th class="py-2 pr-3 font-normal">${t("admin_users_column_status")}</th>
              <th class="py-2 font-normal">${t("admin_users_column_actions")}</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      </div>
    `;
  }

  async createUser() {
    const username = (prompt(t("admin_users_prompt_username")) || "").trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "");
    if (!username) return;
    const password = prompt(t("admin_users_prompt_password")) || "";
    if (password.length < 8) { errorToast(t("admin_users_password_min_length")); return; }
    const isAdmin = await confirmDialog(t("admin_users_confirm_grant_admin_on_creation"), { confirmLabel: t("admin_users_grant"), danger: false });
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password, is_admin: isAdmin }) });
      toast(t("admin_users_user_created"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_create_user"));
    }
  }

  async deleteUser(uid) {
    if (!(await confirmDialog(t("admin_users_confirm_delete_permanently"), { confirmLabel: t("admin_users_delete") }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}`, { method: "DELETE" });
      toast(t("admin_users_user_deleted"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_delete_user"));
    }
  }
}

Object.assign(AdminUsersView.prototype, {
  async resetPassword(uid) {
    const username = this.users.find((u) => u.id === uid)?.username;
    if (!username) { errorToast(t("admin_users_couldnt_find_user")); return; }
    const password = prompt(t("admin_users_prompt_new_password")) || "";
    if (password.length < 8) { errorToast(t("admin_users_password_min_length")); return; }
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/password`, { method: "PUT", body: JSON.stringify({ username, password }) });
      toast(t("admin_users_password_reset"));
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_reset_password"));
    }
  },

  async setRole(uid, isAdmin) {
    const username = this.users.find((u) => u.id === uid)?.username;
    if (!username) { errorToast(t("admin_users_couldnt_find_user")); return; }
    if (!(await confirmDialog(isAdmin ? t("admin_users_confirm_grant_admin") : t("admin_users_confirm_remove_admin"), { confirmLabel: isAdmin ? t("admin_users_grant") : t("admin_users_revoke"), danger: !isAdmin }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/role`, { method: "PUT", body: JSON.stringify({ username, password: "unused", is_admin: isAdmin }) });
      toast(isAdmin ? t("admin_users_admin_granted") : t("admin_users_admin_removed"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_change_role"));
    }
  },

  async setDevRole(uid, isDev) {
    if (!(await confirmDialog(isDev ? t("admin_users_confirm_grant_dev") : t("admin_users_confirm_revoke_dev"), { confirmLabel: isDev ? t("admin_users_grant") : t("admin_users_revoke"), danger: !isDev }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/dev-role`, { method: "PUT", body: JSON.stringify({ is_dev: isDev }) });
      toast(isDev ? t("admin_users_dev_granted") : t("admin_users_dev_revoked"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_change_dev_role"));
    }
  },

  async setTier(uid, tier) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/tier`, { method: "PUT", body: JSON.stringify({ tier }) });
      toast(tier === "full" ? t("admin_users_upgraded", "Upgraded to full account.") : t("admin_users_made_guest", "Moved to guest tier."));
      await this.load();
    } catch (e) {
      errorToast(e.message);
    }
  },

  async suspend(uid) {
    const reason = prompt(t("admin_users_prompt_suspension_reason")) || "";
    if (!(await confirmDialog(t("admin_users_confirm_suspend"), { confirmLabel: t("admin_users_suspend") }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/suspend`, { method: "POST", body: JSON.stringify({ reason: reason || null }) });
      toast(t("admin_users_user_suspended"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_suspend_user"));
    }
  },

  async unsuspend(uid) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/unsuspend`, { method: "POST" });
      toast(t("admin_users_user_unsuspended"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_unsuspend_user"));
    }
  },

  async clearTotp(uid) {
    if (!(await confirmDialog(t("admin_users_confirm_clear_totp"), { confirmLabel: t("admin_users_clear") }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/totp/clear`, { method: "POST" });
      toast(t("admin_users_totp_cleared"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_clear_totp"));
    }
  },

  async manageNotes(uid) {
    let notes;
    try {
      notes = await api(`/api/admin/users/${encodeURIComponent(uid)}/notes`);
    } catch (e) {
      errorToast(t("admin_users_couldnt_load_notes"));
      return;
    }
    const notesHtml = () => notes.length
      ? notes.map((n) => `
        <div class="flex items-start justify-between gap-2 py-2 border-b border-line">
          <div class="min-w-0">
            <div class="text-sm text-ink">${_esc(n.note)}</div>
            <div class="font-mono text-[10px] text-muted mt-1">${_esc(n.author_username)} · ${new Date(n.created * 1000).toLocaleDateString()}</div>
          </div>
          <button type="button" data-del-note="${_attr(n.id)}" class="text-xs flex-none" style="color:var(--color-warn)">${t("admin_users_delete")}</button>
        </div>
      `).join("")
      : `<p class="text-sm text-muted py-2">${t("admin_users_no_notes_yet")}</p>`;

    openModal(`
      <h3>${t("admin_users_admin_notes")}</h3>
      <div id="admin_notes_list" class="mb-3">${notesHtml()}</div>
      <div class="flex gap-2">
        <input type="text" id="admin_note_input" placeholder="${t("admin_users_add_a_note_placeholder")}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <button type="button" id="admin_note_add" class="px-3 py-2 rounded-md border border-line text-sm text-ink">${t("admin_users_add")}</button>
      </div>
    `);

    const refresh = () => { document.getElementById("admin_notes_list").innerHTML = notesHtml(); wireDeletes(); };
    const wireDeletes = () => {
      document.querySelectorAll("[data-del-note]").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(`/api/admin/notes/${encodeURIComponent(btn.dataset.delNote)}`, { method: "DELETE" });
            notes = notes.filter((n) => n.id !== btn.dataset.delNote);
            refresh();
          } catch (e) {
            errorToast(t("admin_users_couldnt_delete_note"));
          }
        };
      });
    };
    wireDeletes();

    document.getElementById("admin_note_add").onclick = async () => {
      const input = document.getElementById("admin_note_input");
      const text = input.value.trim();
      if (!text) return;
      try {
        const created = await api(`/api/admin/users/${encodeURIComponent(uid)}/notes`, { method: "POST", body: JSON.stringify({ note: text }) });
        notes = [created, ...notes];
        input.value = "";
        refresh();
      } catch (e) {
        errorToast(t("admin_users_couldnt_add_note"));
      }
    };
  },

  async setIdentityLabel(uid, currentLabel) {
    const label = prompt(t("admin_users_prompt_identity_label"), currentLabel || "");
    if (label === null) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/identity`, { method: "PUT", body: JSON.stringify({ label: label.trim() || null }) });
      toast(t("admin_users_identity_label_updated"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_users_couldnt_update_identity_label"));
    }
  },
});

if (typeof window !== "undefined") {
  window.AdminUsersView = AdminUsersView;
}
