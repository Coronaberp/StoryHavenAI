"use strict";

function getBlockedTags() {
  return store.get("blockedTags", []);
}

function setBlockedTags(tags) {
  store.set("blockedTags", tags);
}

class BlockedSettingsView {
  async mount(main) {
    this.main = main;
    this.tagInput = "";
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.blockedUsers = await api("/api/me/blocked");
    } catch (e) {
      this.blockedUsers = [];
      errorToast(t("blocks_couldnt_load_blocked_creators"));
    }
    this.render();
  }

  render() {
    const tags = getBlockedTags();
    const userRows = this.blockedUsers.length
      ? this.blockedUsers.map((u) => `
        <div class="settings-row">
          <span class="flex-none w-[34px] h-[34px] rounded-full overflow-hidden bg-surface-2 border border-line grid place-items-center">
            ${u.avatar ? `<img src="${_attr(u.avatar)}" alt="" class="w-full h-full object-cover">` : `<span class="font-display text-sm text-ink">${_esc((u.display_name || u.username || "?")[0].toUpperCase())}</span>`}
          </span>
          <span class="flex-1 min-w-0">
            <span class="block text-[14.5px] text-ink truncate">${_esc(u.display_name || u.username)}</span>
            <span class="block text-xs text-muted mt-0.5">@${_esc(u.username)}</span>
          </span>
          <button type="button" onclick="blockedView.unblockUser('${_attr(u.username)}')"
            class="px-3 py-1.5 rounded-lg border text-xs font-medium flex-none" style="border-color:var(--color-warn);color:var(--color-warn)">
            ${t("blocks_unblock")}
          </button>
        </div>
      `).join("")
      : `<p class="text-sm text-muted py-2">${t("blocks_havent_blocked_any_creators")}</p>`;

    const tagChips = tags.length
      ? tags.map((tg) => `
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium mr-2 mb-2" style="border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink)">
          #${_esc(tg)}
          <button type="button" onclick="blockedView.removeTag('${_attr(tg)}')" class="text-muted hover:text-warn" style="color:var(--color-muted)" aria-label="${t("blocks_remove")}">&times;</button>
        </span>
      `).join("")
      : `<p class="text-sm text-muted py-2">${t("blocks_no_blocked_tags_yet")}</p>`;

    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml(t("settings_row_settings"))}
      ${pageHeaderHtml("My Dossier", "Settings", t("ph_blocked_title"), t("ph_blocked_sub"))}

      ${sEyebrowHtml(t("blocks_blocked_creators"))}
      <div class="rounded-lg border border-line bg-surface px-3 mb-5">${userRows}</div>

      ${sEyebrowHtml(t("blocks_blocked_tags"))}
      <p class="text-xs text-muted mb-3">${t("blocks_tagged_characters_hidden_desc")}</p>
      <div class="flex gap-2 mb-3">
        <input type="text" id="block_tag_input" value="${_attr(this.tagInput)}" placeholder="${t("blocks_add_a_tag")}" autocomplete="off"
          class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <button type="button" onclick="blockedView.addTag()" class="px-4 py-2 rounded-md border text-sm font-medium" style="border-color:var(--color-line);color:var(--color-ink)">${t("blocks_add")}</button>
      </div>
      <div>${tagChips}</div>
      </div>
    `;

    const input = document.getElementById("block_tag_input");
    if (input) {
      input.addEventListener("input", () => { this.tagInput = input.value; });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.addTag(); } });
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  async unblockUser(username) {
    try {
      await api(`/api/users/${encodeURIComponent(username)}/unblock`, { method: "POST" });
      this.blockedUsers = this.blockedUsers.filter((u) => u.username !== username);
      toast("Unblocked.");
      this.render();
    } catch (e) {
      errorToast(e.message || "Couldn't unblock.");
    }
  }

  addTag() {
    const raw = (this.tagInput || "").trim().toLowerCase().replace(/^#/, "");
    if (!raw) return;
    const tags = getBlockedTags();
    if (!tags.includes(raw)) {
      tags.push(raw);
      setBlockedTags(tags);
    }
    this.tagInput = "";
    this.render();
  }

  removeTag(tag) {
    setBlockedTags(getBlockedTags().filter((t) => t !== tag));
    this.render();
  }
}

if (typeof window !== "undefined") {
  window.BlockedSettingsView = BlockedSettingsView;
}
