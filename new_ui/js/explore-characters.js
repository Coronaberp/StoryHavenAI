"use strict";

const GENDER_TAGS = {
  male: ["male", "man", "boy"],
  female: ["female", "woman", "girl"],
  other: ["nonbinary", "non-binary", "androgynous", "other"],
};

const MODE_ICONS = {
  character: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1-4.5 3.5-6.5 7-6.5s6 2 7 6.5"/></svg>',
  rpg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19l9-9"/><path d="M17 5l2 2-9 9-3 1 1-3z"/></svg>',
};

const GENDER_ICONS = {
  male: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="14" r="5"/><path d="M13 10l6-6M13 4h6v6"/></svg>',
  female: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M12 14v6M9 18h6"/></svg>',
  other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M12 14v7"/></svg>',
};

const _domColorCache = new Map();

function _extractDominantColor(url) {
  if (!url) return Promise.resolve(null);
  if (_domColorCache.has(url)) return Promise.resolve(_domColorCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 12;
        canvas.height = 12;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 12, 12);
        const data = ctx.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 10) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (!n) { resolve(null); return; }
        const color = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
        _domColorCache.set(url, color);
        resolve(color);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wireCharCardDominantColors(root) {
  if (!root) return;
  root.querySelectorAll("[data-dom-src]").forEach((el) => {
    const src = el.dataset.domSrc;
    if (!src) return;
    _extractDominantColor(src).then((color) => {
      if (color) el.style.setProperty("--dom", color);
    });
  });
}

function searchByTag(tag) {
  if (window._activePantheonView && document.getElementById("pantheonGrid")) {
    window._activePantheonView.addTag(tag);
    return;
  }
  navigate(`/explore/characters?tag=${encodeURIComponent(tag)}`);
}

function _jsEsc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function characterCardHtml(c, profile, opts = {}) {
  const hue = [...c.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
  const dom = `hsl(${hue} 45% 20%)`;
  const art = c.avatar
    ? `background-image:url('${_attr(c.avatar)}')`
    : `background:linear-gradient(150deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 45% 16%))`;
  const creatorName = profile?.display_name || c.owner_username || c.creator || t("pantheon_you_fallback");
  const ringGradient = profile?.accent_color
    ? `linear-gradient(135deg, ${profile.accent_color}, ${profile.banner_color || profile.accent_color})`
    : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
  const avatarInner = profile?.avatar
    ? `<img src="${_attr(profile.avatar)}" alt="">`
    : `<span>${_esc(creatorName[0].toUpperCase())}</span>`;
  const chats = c.chats > 999 ? (c.chats / 1000).toFixed(1) + "k" : (c.chats || 0);
  return `
    <div class="char-card" style="--dom:${dom}" ${c.avatar ? `data-dom-src="${_attr(c.avatar)}"` : ""} onclick="navigate('/c/${encodeURIComponent(c.id)}')">
      <div class="char-card-frame">
        <div class="char-card-art" style="${art}" ${c.is_explicit ? 'data-explicit="1"' : ""}></div>
        <div class="char-card-fade"></div>
        <div class="char-card-body">
          <div class="char-card-tags">${(c.tags || []).slice(0, 2).map((t) => `<span class="char-card-tag" onclick="event.stopPropagation();searchByTag('${_jsEsc(t)}')" style="cursor:pointer">#${_esc(t)}</span>`).join("")}</div>
          <h3 class="char-card-title">${_esc(c.name)}</h3>
          <p class="char-card-log">${_esc(c.description || "")}</p>
          ${opts.hideCreator ? "" : `
          <div class="char-card-creator" ${c.owner_username ? `onclick="event.stopPropagation();navigate('/u/${encodeURIComponent(c.owner_username)}')" style="cursor:pointer"` : ""}>
            <span class="char-card-creator-ring" style="background:${ringGradient}">
              <span class="char-card-creator-ring-inner">${avatarInner}</span>
            </span>
            <span class="char-card-creator-name">${_esc(creatorName)}</span>
          </div>`}
        </div>
      </div>
      <div class="char-card-ribbon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 15c0-4-3-6-8-6s-8 2-8 6"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/></svg>
        <span>${chats}</span>
      </div>
    </div>
  `;
}

class ExploreCharactersView {
  constructor({ scope = "community" } = {}) {
    this.scope = scope;
    this.chars = [];
    this.loading = true;
    this.error = "";
    this.filters = { q: "", creators: [], tags: [], gender: "any", mode: "all", rating: ME?.nsfw_allowed ? "all" : "sfw" };
    this.drawerOpen = false;
    this.editingCreator = null;
    this.creatorProfiles = {};
  }

  async mount(main) {
    this.main = main;
    window._activePantheonView = this;
    const initialTag = new URLSearchParams(location.search).get("tag");
    if (initialTag) this.filters.tags = [initialTag];
    this.render();
    await this.load();
  }

  async load() {
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const params = new URLSearchParams({ scope: this.scope });
      if (this.filters.q) params.set("q", this.filters.q);
      if (this.filters.tags.length) params.set("tags", this.filters.tags.join(","));
      this.chars = await api(`/api/characters?${params.toString()}`);
    } catch (err) {
      this.error = err.message || (this.scope === "mine" ? t("pantheon_load_error_mine") : t("pantheon_load_error_community"));
      this.chars = [];
    }
    this.loading = false;
    this.render();
    if (this.scope === "community") this.loadCreatorProfiles();
  }

  async loadCreatorProfiles() {
    const usernames = [...new Set(this.chars.map((c) => c.owner_username).filter(Boolean))]
      .filter((u) => !this.creatorProfiles[u]);
    if (!usernames.length) return;
    const fetched = await Promise.all(usernames.map(async (u) => {
      try { return [u, await api(`/api/users/${encodeURIComponent(u)}`)]; }
      catch { return [u, null]; }
    }));
    fetched.forEach(([u, profile]) => { if (profile) this.creatorProfiles[u] = profile; });
    this.render();
  }

  visibleChars() {
    const rating = ME?.nsfw_allowed ? this.filters.rating : "sfw";
    return this.chars.filter((c) => {
      if (this.filters.mode !== "all" && c.mode !== this.filters.mode) return false;
      if (rating === "sfw" && c.is_explicit) return false;
      if (rating === "nsfw" && !c.is_explicit) return false;
      if (this.filters.creators.length) {
        const owner = (c.owner_username || "").toLowerCase();
        if (!this.filters.creators.some((cr) => cr.toLowerCase() === owner)) return false;
      }
      if (this.filters.gender !== "any") {
        const want = GENDER_TAGS[this.filters.gender] || [];
        const tags = (c.tags || []).map((t) => String(t).toLowerCase());
        if (!want.some((w) => tags.includes(w))) return false;
      }
      if (this.scope === "community") {
        const blockedTags = getBlockedTags();
        if (blockedTags.length) {
          const tags = (c.tags || []).map((t) => String(t).toLowerCase());
          if (blockedTags.some((bt) => tags.includes(bt))) return false;
        }
      }
      return true;
    });
  }

  defaultRating() {
    return ME?.nsfw_allowed ? "all" : "sfw";
  }

  activeFilterCount() {
    const f = this.filters;
    return f.creators.length + f.tags.length + (f.gender !== "any" ? 1 : 0) +
      (f.mode !== "all" ? 1 : 0);
  }

  allTags() {
    return [...new Set(this.chars.flatMap((c) => c.tags || []))].sort();
  }

  topTags(n) {
    const counts = new Map();
    this.chars.forEach((c) => (c.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
  }

  popularTagsHtml() {
    const f = this.filters;
    const top = this.topTags(6);
    if (!top.length) return "";
    return `
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">
        <button type="button" class="filter-chip${!f.tags.length ? " on" : ""}" data-for-you="1">${_esc(t("pantheon_for_you"))}</button>
        ${top.map((t) => `<button type="button" class="filter-chip${f.tags.includes(t) ? " on" : ""}" data-quick-tag="${t}">${t}</button>`).join("")}
      </div>
    `;
  }

  allCreators() {
    const names = [...new Set(this.chars.map((c) => c.owner_username).filter(Boolean))].sort();
    return names.map((name) => ({ name, profile: this.creatorProfiles[name] }));
  }

  updateSuggestions() {
    const box = this.main.querySelector("#pantheonSuggest");
    const search = this.main.querySelector("#pantheonSearch");
    if (!box || !search) return;
    const val = search.value;
    if (this.scope === "community" && val.startsWith("@")) {
      const q = val.slice(1).toLowerCase();
      const matches = this.allCreators()
        .filter((c) => !this.filters.creators.includes(c.name) && c.name.toLowerCase().includes(q))
        .slice(0, 6);
      if (!matches.length) { box.classList.remove("open"); box.innerHTML = ""; return; }
      box.innerHTML = matches.map((c) => `
        <button type="button" class="dropdown-item" style="display:flex;align-items:center;gap:8px" data-pick-creator="${_attr(c.name)}">
          <span style="width:22px;height:22px;border-radius:999px;flex:none;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center">
            ${c.profile?.avatar ? `<img src="${_attr(c.profile.avatar)}" style="width:100%;height:100%;object-fit:cover" alt="">` : `<span style="font-family:var(--font-mono);font-size:9px">${_esc(c.name[0].toUpperCase())}</span>`}
          </span>
          ${_esc(c.name)}
        </button>
      `).join("");
      box.classList.add("open");
    } else if (val.startsWith("#")) {
      const q = val.slice(1).toLowerCase();
      const matches = this.allTags().filter((t) => !this.filters.tags.includes(t) && t.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { box.classList.remove("open"); box.innerHTML = ""; return; }
      box.innerHTML = matches.map((t) => `<button type="button" class="dropdown-item" data-pick-tag="${_attr(t)}">#${_esc(t)}</button>`).join("");
      box.classList.add("open");
    } else {
      box.classList.remove("open");
      box.innerHTML = "";
    }
    box.querySelectorAll("[data-pick-creator]").forEach((btn) => btn.onclick = () => {
      this.filters.creators = [...this.filters.creators, btn.dataset.pickCreator];
      search.value = "";
      box.classList.remove("open");
      this.load();
    });
    box.querySelectorAll("[data-pick-tag]").forEach((btn) => btn.onclick = () => {
      search.value = "";
      box.classList.remove("open");
      this.addTag(btn.dataset.pickTag);
    });
  }

  cardHtml(c) {
    if (c.kind === "group") return this.groupTileHtml(c);
    return characterCardHtml(c, this.creatorProfiles[c.owner_username], { hideCreator: this.scope === "mine" });
  }

  groupTileHtml(g) {
    const modeLabel = g.group_mode === "chat" ? t("group_mode_chat", "Chat") : t("group_mode_roleplay", "Roleplay");
    return `
      <button type="button" class="char-card grp-card" onclick="navigate('/g/${encodeURIComponent(g.id)}')">
        <div style="aspect-ratio:1;width:100%;border-radius:12px;overflow:hidden">${groupGridAvatar(g.cast_preview)}</div>
        <div class="grp-card-meta">
          <span class="grp-card-name">${_esc(g.name)}</span>
          <span class="grp-card-badge">${modeLabel}</span>
        </div>
      </button>`;
  }

  activeFilterPills() {
    const f = this.filters;
    const pills = [];
    if (f.gender !== "any") pills.push({ key: "gender", type: "gender", label: f.gender, icon: GENDER_ICONS[f.gender] });
    if (f.mode !== "all") pills.push({ key: "mode", type: "mode", label: f.mode, icon: MODE_ICONS[f.mode] });
    f.creators.forEach((name) => pills.push({ key: "creator", type: "creator", value: name, label: `@${name}`, editable: true }));
    f.tags.forEach((tag) => pills.push({ key: "tag", type: "tag", value: tag, label: `#${tag}` }));
    return pills;
  }

  clearFilterPill(key, value) {
    const f = this.filters;
    if (key === "gender") f.gender = "any";
    else if (key === "mode") f.mode = "all";
    else if (key === "nsfw") f.rating = "sfw";
    else if (key === "creator") f.creators = f.creators.filter((c) => c !== value);
    else if (key === "tag") f.tags = f.tags.filter((t) => t !== value);
    this.load();
  }

  filterDrawerHtml() {
    const f = this.filters;
    const single = (group, id, current, label) =>
      `<button type="button" class="filter-chip${current === id ? " on" : ""}" data-${group}="${id}">${label}</button>`;
    const modeChip = (id, label) =>
      `<button type="button" class="filter-chip${f.mode === id ? " on" : ""}" data-mode="${id}" style="display:inline-flex;align-items:center;gap:5px">${MODE_ICONS[id]}${label}</button>`;
    const genderChip = (id, label) =>
      `<button type="button" class="filter-chip${f.gender === id ? " on" : ""}" data-gender="${id}" style="display:inline-flex;align-items:center;gap:5px">${GENDER_ICONS[id]}${label}</button>`;
    const heading = (label) => `<div style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-muted)">${label}</div>`;
    const ratingSection = ME?.nsfw_allowed ? `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${heading(t("pantheon_filter_rating_heading"))}
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            <button type="button" class="filter-chip${f.rating === "all" ? " on" : ""}" data-rating="all">${t("pantheon_filter_all")}</button>
            <button type="button" class="filter-chip${f.rating === "sfw" ? " on" : ""}" data-rating="sfw">${t("pantheon_filter_sfw")}</button>
            <button type="button" class="filter-chip${f.rating === "nsfw" ? " on" : ""}" data-rating="nsfw">${t("pantheon_filter_nsfw")}</button>
          </div>
        </div>` : "";
    return `
      <div id="pantheonDrawer" style="display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:14px;border:1px dashed color-mix(in srgb, var(--color-accent) 45%, transparent);background:var(--color-surface)">
        <div style="display:flex;flex-direction:column;gap:6px">
          ${heading(t("pantheon_filter_gender_heading"))}
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${single("gender", "any", f.gender, t("pantheon_filter_any"))}${genderChip("male", t("pantheon_filter_male"))}${genderChip("female", t("pantheon_filter_female"))}${genderChip("other", t("pantheon_filter_other"))}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${heading(t("pantheon_filter_mode_heading"))}
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${single("mode", "all", f.mode, t("pantheon_filter_all"))}${modeChip("character", t("pantheon_filter_character"))}${modeChip("rpg", t("pantheon_filter_rpg"))}
          </div>
        </div>
        ${ratingSection}
      </div>
    `;
  }

  wireDrawer(root) {
    const f = this.filters;
    root.querySelectorAll("[data-gender]").forEach((btn) => btn.onclick = () => { f.gender = btn.dataset.gender; this.load(); });
    root.querySelectorAll("[data-mode]").forEach((btn) => btn.onclick = () => { f.mode = btn.dataset.mode; this.load(); });
    root.querySelectorAll("[data-rating]").forEach((btn) => btn.onclick = () => { if (btn.disabled) return; f.rating = btn.dataset.rating; this.load(); });
  }

  addTag(tag) {
    if (!this.filters.tags.includes(tag)) this.filters.tags = [...this.filters.tags, tag];
    this.load();
  }

  pillHtml(p) {
    if (p.editable && this.editingCreator === p.value) {
      return `<span class="inline-pill pill-${p.type}">@<input type="text" id="creatorEditInput" value="${_attr(p.value)}" data-old="${_attr(p.value)}"></span>`;
    }
    const solid = p.icon ? ` type-chip${p.type === "mode" ? " type-chip-mode" : ""}` : "";
    return `
      <span class="inline-pill pill-${p.type}${solid}" data-clear="${_attr(p.key)}" data-clear-value="${_attr(p.value || "")}" ${p.editable ? `data-editable-value="${_attr(p.value)}" title="${_attr(t("pantheon_double_click_edit"))}"` : ""}>
        ${p.icon || ""}${_esc(p.label)}<span class="x" data-clear-x="1">&times;</span>
      </span>
    `;
  }

  render() {
    const f = this.filters;
    const count = this.activeFilterCount();
    const visible = this.visibleChars();
    const pills = this.activeFilterPills();
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${this.scope === "mine" ? `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="flex:1">${pageHeaderHtml("Workshop", "Characters", t("ph_mycharacters_title"), t("ph_mycharacters_sub"))}</div>
          <button type="button" class="grimoire-add-btn" onclick="navigate('/workshop/characters/new')" aria-label="${_attr(t("pantheon_new_character_aria"))}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        ` : `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="flex:1">${pageHeaderHtml("Explore", "Characters", t("ph_characters_title"), t("ph_characters_sub"))}</div>
        </div>
        `}
        <div style="display:flex;align-items:center;gap:5px">
          <div id="pantheonSearchBox" style="position:relative;flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
            ${pills.map((p) => this.pillHtml(p)).join("")}
            <input type="text" id="pantheonSearch" value="${_attr(f.q)}" placeholder="${pills.length ? "" : _attr(t("pantheon_search_placeholder"))}"
              style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
            <div id="pantheonSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
          </div>
          <button type="button" id="pantheonFilterBtn"
            style="position:relative;flex:none;width:40px;height:40px;border-radius:10px;display:grid;place-items:center;
            border:1px solid var(--color-accent);background:${this.drawerOpen || count ? "var(--color-accent)" : "color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))"};
            color:${this.drawerOpen || count ? "var(--color-paper-base, var(--color-paper))" : "var(--color-accent)"}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
            ${count ? `<span style="position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:999px;background:var(--color-warn);color:#fff;font-size:9px;font-weight:700;display:grid;place-items:center">${count}</span>` : ""}
          </button>
          ${ME ? `<button type="button" onclick="openGroupCreate()" aria-label="${_attr(t("group_create_button", "New group chat"))}" data-tooltip="${_attr(t("group_create_button", "New group chat"))}"
            style="flex:none;height:40px;padding:0 13px;border-radius:10px;display:inline-flex;align-items:center;gap:7px;border:none;cursor:pointer;background:linear-gradient(150deg, var(--color-accent), var(--color-accent-deep));color:var(--color-paper-base, #12100c);font-family:var(--font-display, inherit);font-size:13px;font-weight:600;white-space:nowrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span class="hidden sm:inline">${t("group_create_button", "New group")}</span>
          </button>` : ""}
        </div>
        ${this.popularTagsHtml()}
        ${this.drawerOpen ? this.filterDrawerHtml() : ""}
        ${this.loading ? `<p style="color:var(--color-sec);font-size:13px">${t("pantheon_loading")}</p>` : ""}
        ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${this.error}</p>` : ""}
        ${!this.loading && !this.error && !visible.length ? (
          this.scope === "mine" && !count
            ? `<p style="color:var(--color-sec);font-size:13px">${t("pantheon_empty_mine_prefix")} <a href="#" onclick="event.preventDefault();navigate('/workshop/characters/new')" style="color:var(--color-accent)">${t("pantheon_empty_mine_create_link")}</a>.</p>`
            : `<p style="color:var(--color-sec);font-size:13px">${t("pantheon_empty_no_match")}</p>`
        ) : ""}
        <div class="card-grid" id="pantheonGrid">${visible.map((c) => this.cardHtml(c)).join("")}</div>
      </div>
    `;
    wireCharCardDominantColors(this.main);
    this.main.querySelector("#pantheonFilterBtn").onclick = () => {
      this.drawerOpen = !this.drawerOpen;
      this.render();
    };
    this.main.querySelectorAll("[data-for-you]").forEach((btn) => btn.onclick = () => {
      f.tags = [];
      this.load();
    });
    this.main.querySelectorAll("[data-quick-tag]").forEach((btn) => btn.onclick = () => {
      const tag = btn.dataset.quickTag;
      f.tags = f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag];
      this.load();
    });
    this.main.querySelectorAll("[data-clear-x]").forEach((x) => {
      x.onclick = (e) => {
        e.stopPropagation();
        const pill = x.closest("[data-clear]");
        this.clearFilterPill(pill.dataset.clear, pill.dataset.clearValue);
      };
    });
    this.main.querySelectorAll("[data-editable-value]").forEach((pill) => {
      pill.ondblclick = () => {
        this.editingCreator = pill.dataset.editableValue;
        this.render();
      };
    });
    const editInput = this.main.querySelector("#creatorEditInput");
    if (editInput) {
      editInput.focus();
      editInput.select();
      const commit = () => {
        const old = editInput.dataset.old;
        const val = editInput.value.trim();
        this.editingCreator = null;
        const idx = f.creators.indexOf(old);
        if (idx === -1) return this.render();
        if (!val) f.creators.splice(idx, 1);
        else f.creators[idx] = val;
        this.load();
      };
      editInput.onkeydown = (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { this.editingCreator = null; this.render(); }
      };
      editInput.onblur = commit;
    }
    if (this.drawerOpen) this.wireDrawer(this.main.querySelector("#pantheonDrawer"));
    const search = this.main.querySelector("#pantheonSearch");
    let searchTimer;
    search.oninput = () => {
      this.updateSuggestions();
      if (search.value.startsWith("@") || search.value.startsWith("#")) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        f.q = search.value.trim();
        this.load();
      }, 350);
    };
    search.onkeydown = (e) => {
      if (e.key === "Backspace" || e.key === "Delete") {
        if (search.value !== "") return;
        e.preventDefault();
        if (f.tags.length) {
          const removed = f.tags[f.tags.length - 1];
          f.tags = f.tags.slice(0, -1);
          toast(`Removed #${removed} filter`);
        } else if (f.creators.length) {
          const removed = f.creators[f.creators.length - 1];
          f.creators = f.creators.slice(0, -1);
          toast(`Removed @${removed} filter`);
        } else return;
        this.load();
        return;
      }
      if (e.key !== "Enter") return;
      const val = search.value.trim();
      if (val.startsWith("@") && val.length > 1) {
        const name = val.slice(1);
        if (!f.creators.includes(name)) f.creators = [...f.creators, name];
        search.value = "";
        f.q = "";
        this.load();
      } else if (val.startsWith("#") && val.length > 1) {
        this.addTag(val.slice(1));
        search.value = "";
        f.q = "";
      }
    };
  }
}

if (typeof window !== "undefined") {
  window.ExploreCharactersView = ExploreCharactersView;
}
