"use strict";

function _sanctumAgo(ts) {
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return t("sanctum_time_just_now");
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const _SANCTUM_QUICK_TILES = [
  { type: "mycharacters", labelKey: "sanctum_new_character", route: "/workshop/characters/new" },
  { type: "personas", labelKey: "sanctum_new_persona", route: "/workshop/personas" },
  { type: "lorebook", labelKey: "sanctum_new_lore_entry", route: "/workshop/lore" },
  { type: "generate", labelKey: "sanctum_new_image", route: "/workshop/media" },
];

const _SANCTUM_TYPE_LABEL_KEYS = {
  mycharacters: "sanctum_type_character",
  personas: "sanctum_type_persona",
  lorebook: "sanctum_type_lore",
  generate: "sanctum_type_generated",
};

class WorkshopView {
  constructor() {
    this.items = null;
    this.error = "";
  }

  async mount(main) {
    this.main = main;
    this.render();
    let failed = false;
    const [chars, personas, lore, images] = await Promise.all([
      api("/api/characters?scope=mine").catch((err) => {
        console.error("Sanctum section fetch failed:", err);
        failed = true;
        return [];
      }),
      api("/api/personas").catch((err) => {
        console.error("Sanctum section fetch failed:", err);
        failed = true;
        return [];
      }),
      api("/api/lore/mine").catch((err) => {
        console.error("Sanctum section fetch failed:", err);
        failed = true;
        return [];
      }),
      api("/api/imagegen/standalone").catch((err) => {
        console.error("Sanctum section fetch failed:", err);
        failed = true;
        return [];
      }),
    ]);
    if (failed && typeof errorToast === "function") {
      errorToast(t("sanctum_load_partial_error"));
    }
    this.items = [
      ...chars.map((c) => ({
        type: "mycharacters", id: c.id, created: c.created,
        title: c.name || t("sanctum_unnamed"), thumb: c.avatar || "", route: `/workshop/characters/${encodeURIComponent(c.id)}/edit`,
      })),
      ...personas.map((p) => ({
        type: "personas", id: p.id, created: p.created,
        title: p.name || t("sanctum_unnamed"), thumb: "", route: "/workshop/personas",
      })),
      ...lore.map((l) => ({
        type: "lorebook", id: l.id, created: l.created,
        title: l.name || t("sanctum_untitled_entry"), thumb: l.image || "", route: "/workshop/lore",
      })),
      ...images.map((i) => ({
        type: "generate", id: i.id, created: i.created,
        title: t("sanctum_generated_image"), thumb: i.image || "", route: "/workshop/media",
      })),
    ].sort((a, b) => b.created - a.created).slice(0, 20);
    this.render();
  }

  quickRowHtml() {
    return `
      <div class="sanctum-quick-row">
        ${_SANCTUM_QUICK_TILES.map((t) => `
          <button type="button" class="sanctum-quick-tile" onclick="navigate('${t.route}')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${_NAV_MENU_ICONS[t.type]}</svg>
            <span>${window.t(t.labelKey)}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  browseRowHtml() {
    return `
      <div class="sanctum-feed-header">${t("sanctum_browse")}</div>
      <div class="sanctum-browse-list">
        ${_navMenuRow("mycharacters", t("sanctum_my_characters"), t("sanctum_characters"), `navigate('/workshop/characters')`)}
        ${_navMenuRow("personas", t("sanctum_personas"), t("sanctum_personas"), `navigate('/workshop/personas')`)}
        ${_navMenuRow("lorebook", t("sanctum_lorebook"), t("sanctum_lore"), `navigate('/workshop/lore')`)}
        ${_navMenuRow("generate", t("sanctum_generate"), t("sanctum_generate_media"), `navigate('/workshop/media')`)}
      </div>
    `;
  }

  specimenHtml(item) {
    const initial = item.title[0].toUpperCase();
    const art = item.thumb
      ? `background-image:url('${_attr(item.thumb)}')`
      : `background:var(--color-surface-2)`;
    return `
      <div class="sanctum-feed-row" onclick="navigate('${_attr(item.route)}')">
        <span class="sanctum-specimen" style="${art}">
          ${item.thumb ? "" : _esc(initial)}
          <span class="sanctum-specimen-tab">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_NAV_MENU_ICONS[item.type]}</svg>
          </span>
        </span>
        <div class="sanctum-feed-body">
          <span class="sanctum-feed-title">${_esc(item.title)}</span>
          <span class="sanctum-feed-meta">${t(_SANCTUM_TYPE_LABEL_KEYS[item.type])} · ${_sanctumAgo(item.created)}</span>
        </div>
      </div>
    `;
  }

  bodyHtml() {
    if (this.items === null) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("sanctum_opening_workshop")}</p>`;
    }
    if (!this.items.length) {
      return `
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">${t("sanctum_empty_title")}</p>
          <p class="sanctum-empty-sub">${t("sanctum_empty_sub")}</p>
          <a href="/workshop/characters/new" data-route="__seeall" onclick="event.preventDefault();navigate('/workshop/characters/new')" class="sanctum-empty-cta">${t("sanctum_empty_cta")}</a>
        </div>
      `;
    }
    return `
      <div class="sanctum-feed-header">${t("sanctum_recent")}</div>
      <div class="sanctum-feed">${this.items.map((i) => this.specimenHtml(i)).join("")}</div>
    `;
  }

  render() {
    this.main.innerHTML = `
      ${pageHeaderHtml("Workshop", "Overview", t("ph_workshop_title"), t("ph_workshop_sub"))}
      ${this.quickRowHtml()}
      ${this.browseRowHtml()}
      ${this.bodyHtml()}
    `;
  }
}
