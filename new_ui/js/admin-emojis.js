"use strict";

function adminEmojiTileHtml(e, sizeClass) {
  return `
    <button type="button" data-admin-emoji-tile="${_attr(e.id)}" class="relative aspect-square rounded-[10px] border overflow-hidden flex flex-col ${sizeClass}" style="border-color:${e.is_explicit ? "color-mix(in srgb, var(--color-warn) 55%, var(--color-line))" : "var(--color-line)"};background:var(--color-surface)">
      ${e.is_explicit ? `<span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style="background:var(--color-warn);box-shadow:0 0 0 2px var(--color-paper)"></span>` : ""}
      <img src="${_attr(e.image)}" alt="" class="w-full flex-1 object-cover" style="background:var(--color-surface-2)">
      <span class="font-mono text-[9px] text-muted px-1 py-1 truncate" style="background:var(--color-surface)">:${_esc(e.shortcode)}:</span>
    </button>
  `;
}

class AdminEmojisView {
  async mount(main) {
    this.main = main;
    this.search = "";
    this.kindFilter = "all";
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

  matchesFilter(e) {
    if (this.kindFilter !== "all" && e.kind !== this.kindFilter) return false;
    if (this.search && !e.shortcode.toLowerCase().includes(this.search.toLowerCase())) return false;
    return true;
  }

  gridSectionHtml(items, kind, sizeClass, colsClass) {
    const filtered = items.filter((e) => e.kind === kind);
    if (!filtered.length) return "";
    return `
      <div class="font-mono text-[9.5px] uppercase tracking-[.06em] text-muted mt-2.5 mb-1.5">${kind === "sticker" ? t("admin_emojis_sticker_plural", "Stickers") : t("admin_emojis_emoji_plural", "Emoji")}</div>
      <div class="grid gap-2 ${colsClass}">${filtered.map((e) => adminEmojiTileHtml(e, sizeClass)).join("")}</div>
    `;
  }

  gridPanelHtml() {
    const visible = this.emojis.filter((e) => this.matchesFilter(e));
    const pending = visible.filter((e) => e.is_explicit);
    const approved = visible.filter((e) => !e.is_explicit);
    const emojiCols = "grid-cols-5 sm:grid-cols-9 lg:grid-cols-12";
    const stickerCols = "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6";
    return `
      <div data-admin-emoji-grid-panel>
        <div class="mb-3">
          <input type="text" id="ae_search" value="${_attr(this.search)}" placeholder="${t("admin_emojis_search_placeholder", "Search :shortcode:")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        </div>
        <div class="flex items-center gap-1.5 mb-1 flex-wrap">
          ${[["all", t("admin_emojis_filter_all", "All")], ["emoji", t("admin_emojis_emoji")], ["sticker", t("admin_emojis_sticker")]].map(([key, label]) => `
            <button type="button" class="filter-chip${this.kindFilter === key ? " on" : ""}" onclick="adminEmojisView.kindFilter='${key}';adminEmojisView.render()">${label}</button>
          `).join("")}
        </div>
        <div class="font-mono text-[10.5px] uppercase tracking-[.06em] text-muted mt-3 mb-1 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full" style="background:var(--color-warn)"></span>
          ${t("admin_emojis_pending_review")} <span class="text-ink font-semibold">(${pending.length})</span>
        </div>
        ${pending.length ? this.gridSectionHtml(pending, "emoji", "", emojiCols) + this.gridSectionHtml(pending, "sticker", "", stickerCols) : `<p class="text-sm text-muted mb-2">${t("admin_emojis_nothing_pending")}</p>`}
        <div class="font-mono text-[10.5px] uppercase tracking-[.06em] text-muted mt-4 mb-1">${t("admin_emojis_approved")} <span class="text-ink font-semibold">(${approved.length})</span></div>
        ${approved.length ? this.gridSectionHtml(approved, "emoji", "", emojiCols) + this.gridSectionHtml(approved, "sticker", "", stickerCols) : `<p class="text-sm text-muted">${t("admin_emojis_none_yet")}</p>`}
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_emojis_title"), `${this.emojis.length} ${t("admin_emojis_total")}`)}
      ${adminScreenSwitcherHtml("admin-emojis", window._adminSwitcherBadges || {})}
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
      ${this.gridPanelHtml()}
      </div>
    `;
    adminAttachScreenSwitcher(this.main);
    const search = document.getElementById("ae_search");
    if (search) {
      search.oninput = () => { this.search = search.value; this.renderGridOnly(); };
    }
    this.main.querySelectorAll("[data-admin-emoji-tile]").forEach((el) => {
      el.onclick = () => this.openEmojiSheet(el.dataset.adminEmojiTile);
    });
  }

  renderGridOnly() {
    const grid = this.main.querySelector("[data-admin-emoji-grid-panel]");
    if (!grid) return;
    const focused = document.activeElement === document.getElementById("ae_search");
    grid.outerHTML = this.gridPanelHtml();
    this.main.querySelectorAll("[data-admin-emoji-tile]").forEach((el) => {
      el.onclick = () => this.openEmojiSheet(el.dataset.adminEmojiTile);
    });
    const search = document.getElementById("ae_search");
    if (search) {
      search.oninput = () => { this.search = search.value; this.renderGridOnly(); };
      if (focused) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    }
  }

  openEmojiSheet(eid) {
    const item = this.emojis.find((e) => e.id === eid);
    if (!item) return;
    this.sheet = this.sheet || new AdminBottomSheet();
    const actions = item.is_explicit
      ? [{ id: "approve", label: t("admin_emojis_approve"), primary: true }, { id: "delete", label: t("admin_emojis_delete") }]
      : [{ id: "edit", label: t("admin_emojis_edit") }, { id: "delete", label: t("admin_emojis_delete") }];
    this.sheet.open({
      title: `:${item.shortcode}:`,
      meta: item.uploader_username || item.uploader_id || "",
      actions,
      onAction: (id) => {
        this.sheet.close();
        if (id === "approve") this.approveEmoji(eid);
        else if (id === "delete") this.deleteEmoji(eid);
        else if (id === "edit") this.editEmoji(eid);
      },
    });
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
