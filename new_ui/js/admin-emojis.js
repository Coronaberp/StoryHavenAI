"use strict";

function adminEmojiCardHtml(e) {
  const badge = e.is_explicit
    ? `<span class="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-md" style="background:var(--color-warn);color:var(--color-paper)">${t("admin_emojis_pending_review")}</span>`
    : "";
  const actions = e.is_explicit
    ? `<button type="button" onclick="adminEmojisView.approveEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_emojis_approve")}</button>
       <button type="button" onclick="adminEmojisView.deleteEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_emojis_delete")}</button>`
    : `<button type="button" onclick="adminEmojisView.editEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_emojis_edit")}</button>
       <button type="button" onclick="adminEmojisView.deleteEmoji(${_attr(JSON.stringify(e.id))})" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_emojis_delete")}</button>`;
  return `
    <div class="flex items-center gap-3 p-3 rounded-[13px] border border-line bg-surface mb-2">
      <img src="${_attr(e.image)}" alt="" class="w-12 h-12 rounded-lg object-cover flex-none">
      <div class="min-w-0 flex-1">
        <div class="text-sm text-ink">:${_esc(e.shortcode)}: <span class="text-xs text-muted">${_esc(e.kind)}</span> ${badge}</div>
        <div class="text-xs text-muted mt-0.5">${_esc(e.uploader_username || e.uploader_id)}</div>
      </div>
      <div class="flex flex-wrap gap-1.5 flex-none">${actions}</div>
    </div>
  `;
}

class AdminEmojisView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    await this.load();
  }

  async load() {
    try {
      this.emojis = await api("/api/admin/emojis");
    } catch (e) {
      this.emojis = [];
      errorToast(t("admin_emojis_couldnt_load"));
    }
    this.render();
  }

  render() {
    const pending = this.emojis.filter((e) => e.is_explicit);
    const approved = this.emojis.filter((e) => !e.is_explicit);
    this.main.innerHTML = `
      <div class="content-col">
      ${adminScreenSwitcherHtml("admin-emojis", window._adminSwitcherBadges || {})}
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_emojis_title"), `${this.emojis.length} ${t("admin_emojis_total")}`)}
      <div class="mb-5 p-3.5 rounded-[13px] border border-line bg-surface">
        <div class="font-display font-semibold text-sm text-ink mb-3">${t("admin_emojis_add_new")}</div>
        <input type="text" id="ae_shortcode" placeholder="${t("admin_emojis_shortcode_placeholder")}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <select id="ae_kind" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <option value="emoji">${t("admin_emojis_emoji")}</option>
          <option value="sticker">${t("admin_emojis_sticker")}</option>
        </select>
        <input type="file" id="ae_file" accept="image/*" class="w-full mb-3 text-sm text-ink">
        <button type="button" onclick="adminEmojisView.addEmoji()" data-feature="emojis" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_emojis_add")}</button>
      </div>
      <div class="mb-2 font-display font-semibold text-base text-ink">${t("admin_emojis_pending_review")} <span class="text-xs text-muted font-normal">(${pending.length})</span></div>
      ${pending.length ? pending.map(adminEmojiCardHtml).join("") : `<p class="text-sm text-muted mb-4">${t("admin_emojis_nothing_pending")}</p>`}
      <div class="mt-5 mb-2 font-display font-semibold text-base text-ink">${t("admin_emojis_approved")} <span class="text-xs text-muted font-normal">(${approved.length})</span></div>
      ${approved.length ? approved.map(adminEmojiCardHtml).join("") : `<p class="text-sm text-muted">${t("admin_emojis_none_yet")}</p>`}
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
  }

  async addEmoji() {
    const shortcode = document.getElementById("ae_shortcode").value.trim().toLowerCase();
    const kind = document.getElementById("ae_kind").value;
    const file = document.getElementById("ae_file").files[0];
    if (!shortcode || !file) { toast(t("admin_emojis_pick_file_and_shortcode")); return; }
    if (file.size > 10 * 1024 * 1024) { errorToast(t("admin_emojis_file_too_large")); return; }
    const fd = new FormData();
    fd.append("shortcode", shortcode);
    fd.append("kind", kind);
    fd.append("file", file, file.name);
    try {
      await api("/api/emojis", { method: "POST", body: fd });
      toast(t("admin_emojis_added"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_emojis_couldnt_add"));
    }
  }

  async approveEmoji(eid) {
    try {
      await api(`/api/admin/emojis/${encodeURIComponent(eid)}/approve`, { method: "POST" });
      toast(t("admin_emojis_approved"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_emojis_couldnt_approve"));
    }
  }

  async deleteEmoji(eid) {
    if (!(await confirmDialog(t("admin_emojis_confirm_delete")))) return;
    try {
      await api(`/api/emojis/${encodeURIComponent(eid)}`, { method: "DELETE" });
      toast(t("admin_emojis_deleted"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_emojis_couldnt_delete"));
    }
  }

  editEmoji(eid) {
    const item = this.emojis.find((e) => e.id === eid);
    if (!item) return;
    openModal(`
      <h3>${t("admin_emojis_edit_modal_title")}</h3>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_emojis_shortcode")}</label>
        <input type="text" id="ae_edit_shortcode" value="${_attr(item.shortcode)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">${t("admin_emojis_kind")}</label>
        <select id="ae_edit_kind" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          <option value="emoji" ${item.kind === "emoji" ? "selected" : ""}>${t("admin_emojis_emoji")}</option>
          <option value="sticker" ${item.kind === "sticker" ? "selected" : ""}>${t("admin_emojis_sticker")}</option>
        </select>
      </div>
      <button type="button" id="ae_edit_save" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_emojis_save")}</button>
    `);
    document.getElementById("ae_edit_save").onclick = async () => {
      const shortcode = document.getElementById("ae_edit_shortcode").value.trim().toLowerCase();
      const kind = document.getElementById("ae_edit_kind").value;
      try {
        await api(`/api/admin/emojis/${encodeURIComponent(eid)}`, { method: "PATCH", body: JSON.stringify({ shortcode, kind }) });
        toast(t("admin_emojis_saved"));
        closeTopModal();
        await this.load();
      } catch (e) {
        errorToast(e.message || t("admin_emojis_couldnt_save"));
      }
    };
  }
}

if (typeof window !== "undefined") {
  window.AdminEmojisView = AdminEmojisView;
}
