"use strict";

class LikesSettingsView {
  constructor() {
    this.tab = "characters";
    this.likes = { characters: [], groups: [], images: [] };
    this.mediaView = new ExploreMediaView();
  }

  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.likes = await api("/api/me/likes");
    } catch (e) {
      this.likes = { characters: [], groups: [], images: [] };
      errorToast(t("likes_couldnt_load", "Couldn't load your likes."));
    }
    this.render();
  }

  render() {
    const tabs = [
      ["characters", t("likes_tab_characters", "Characters"), this.likes.characters.length],
      ["groups", t("likes_tab_groups", "Groups"), this.likes.groups.length],
      ["images", t("likes_tab_images", "Images"), this.likes.images.length],
    ];
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml(t("settings_row_settings"))}
      ${pageHeaderHtml("My Dossier", "Settings", t("ph_likes_title", "My Likes"), t("ph_likes_sub", "Everything you've liked, in one place"))}

      <div class="settings-tabs" style="display:flex;gap:6px;margin-bottom:14px">
        ${tabs.map(([key, label, count]) => `
          <button type="button" class="settings-tab-btn${this.tab === key ? " active" : ""}" data-tab="${key}"
            style="padding:8px 14px;border-radius:999px;border:1px solid var(--color-line);font-size:13px;font-weight:500;background:${this.tab === key ? "var(--color-accent)" : "var(--color-surface)"};color:${this.tab === key ? "var(--color-paper)" : "var(--color-ink)"}">
            ${label}${count ? ` (${count})` : ""}
          </button>
        `).join("")}
      </div>

      <div id="likesTabBody"></div>
      </div>
    `;
    this.main.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.onclick = () => { this.tab = btn.dataset.tab; this.render(); };
    });
    this.renderTabBody();
  }

  renderTabBody() {
    const body = this.main.querySelector("#likesTabBody");
    if (!body) return;
    if (this.tab === "characters") {
      body.innerHTML = this.likes.characters.length
        ? `<div class="pin-wall">${this.likes.characters.map((c) => characterCardHtml(c)).join("")}</div>`
        : `<p class="text-sm text-muted py-2">${t("likes_no_characters", "You haven't liked any characters yet.")}</p>`;
      wireCharCardDominantColors(body);
      return;
    }
    if (this.tab === "groups") {
      body.innerHTML = this.likes.groups.length
        ? this.likes.groups.map((g) => this.groupRowHtml(g)).join("")
        : `<p class="text-sm text-muted py-2">${t("likes_no_groups", "You haven't liked any groups yet.")}</p>`;
      body.querySelectorAll("[data-gid]").forEach((row) => {
        row.onclick = () => navigate(`/g/${encodeURIComponent(row.dataset.gid)}`);
      });
      return;
    }
    if (this.likes.images.length) {
      body.innerHTML = `<div class="pin-wall">${this.likes.images.map((img) => this.mediaView.frameHtml(img)).join("")}</div>`;
      wireCharCardDominantColors(body);
      body.querySelectorAll(".pin-frame").forEach((el) => {
        el.onclick = () => {
          const img = this.likes.images.find((i) => i.id === el.dataset.iid);
          if (img) {
            openModal(this.mediaView.detailHtml(img), { wide: true });
            this.mediaView.wireDetailModal(img);
          }
        };
      });
    } else {
      body.innerHTML = `<p class="text-sm text-muted py-2">${t("likes_no_images", "You haven't liked any images yet.")}</p>`;
    }
  }

  groupRowHtml(g) {
    const initial = _esc((g.name || "?")[0].toUpperCase());
    return `
      <div class="settings-row" data-gid="${_attr(g.id)}" style="cursor:pointer">
        <span class="flex-none w-[34px] h-[34px] rounded-full overflow-hidden bg-surface-2 border border-line grid place-items-center">
          <span class="font-display text-sm text-ink">${initial}</span>
        </span>
        <span class="flex-1 min-w-0">
          <span class="block text-[14.5px] text-ink truncate">${_esc(g.name)}</span>
        </span>
      </div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.LikesSettingsView = LikesSettingsView;
}
