"use strict";

function _shuffleSample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function _compendiumTier() {
  const w = window.innerWidth;
  if (w >= 1536) return "ultrawide";
  if (w >= 1024) return "desktop";
  if (w >= 768) return "tablet";
  return "mobile";
}

const _COMPENDIUM_LIMITS = {
  chars: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  creators: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  images: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  threads: { mobile: 3, tablet: 4, desktop: 6, ultrawide: 9 },
};

class ExploreView {
  constructor() {
    this.chars = null;
    this.creators = null;
    this.images = null;
    this.threads = null;
    this.charCreatorProfiles = {};
    this._resizeTimer = null;
    this._onResize = () => {
      if (!this.main?.isConnected) { window.removeEventListener("resize", this._onResize); return; }
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.render(), 150);
    };
  }

  async mount(main) {
    this.main = main;
    this.render();
    const [chars, creators, images, threads] = await Promise.all([
      api("/api/characters?scope=community").catch(() => []),
      api("/api/users").catch(() => []),
      api("/api/imagegen/community").catch(() => []),
      api("/api/forum/threads?sort=top").catch(() => []),
    ]);
    this._charsAll = _shuffleSample(chars.filter((c) => c.kind !== "group" && !c.is_explicit), _COMPENDIUM_LIMITS.chars.ultrawide);
    this._creatorsAll = _shuffleSample(creators, _COMPENDIUM_LIMITS.creators.ultrawide);
    this._imagesAll = _shuffleSample(images.filter((i) => !i.is_explicit), _COMPENDIUM_LIMITS.images.ultrawide);
    this._threadsAll = threads.slice(0, _COMPENDIUM_LIMITS.threads.ultrawide);
    this.applyTierLimits();
    this.render();
    this.loadCharCreatorProfiles();
    window.addEventListener("resize", this._onResize);
  }

  applyTierLimits() {
    const tier = _compendiumTier();
    this.chars = this._charsAll.slice(0, _COMPENDIUM_LIMITS.chars[tier]);
    this.creators = this._creatorsAll.slice(0, _COMPENDIUM_LIMITS.creators[tier]);
    this.images = this._imagesAll.slice(0, _COMPENDIUM_LIMITS.images[tier]);
    this.threads = this._threadsAll.slice(0, _COMPENDIUM_LIMITS.threads[tier]);
  }

  async loadCharCreatorProfiles() {
    const usernames = [...new Set([
      ...this.chars.map((c) => c.owner_username),
      ...this.images.map((i) => i.owner_username),
    ].filter(Boolean))];
    if (!usernames.length) return;
    const fetched = await Promise.all(usernames.map(async (u) => {
      try { return [u, await api(`/api/users/${encodeURIComponent(u)}`)]; }
      catch { return [u, null]; }
    }));
    fetched.forEach(([u, profile]) => { if (profile) this.charCreatorProfiles[u] = profile; });
    this.render();
  }

  sectionHtml(title, seeAllRoute, bodyHtml, loaded) {
    return `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <div>
            <div class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${title}</div>
            <div class="font-mono" style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-muted)">${t("compendium_featured")}</div>
          </div>
          <a href="/${seeAllRoute}" data-route="__seeall" onclick="event.preventDefault();navigate('/${seeAllRoute}')"
            style="font-family:var(--font-mono);font-size:10.5px;color:var(--color-accent);white-space:nowrap">${t("compendium_see_all")}</a>
        </div>
        ${!loaded ? `<p style="color:var(--color-sec);font-size:13px">${t("compendium_loading")}</p>` : bodyHtml}
      </div>
    `;
  }

  charCarouselHtml() {
    if (!this.chars.length) return `<p style="color:var(--color-sec);font-size:13px">${t("compendium_nothing_here_yet")}</p>`;
    return `
      <div class="compendium-row compendium-row-char">
        ${this.chars.map((c) => `<div class="compendium-row-item">${characterCardHtml(c, this.charCreatorProfiles[c.owner_username])}</div>`).join("")}
      </div>
    `;
  }

  creatorCarouselHtml() {
    if (!this.creators.length) return `<p style="color:var(--color-sec);font-size:13px">${t("compendium_nothing_here_yet")}</p>`;
    return `
      <div class="compendium-row compendium-row-creator">
        ${this.creators.map((a) => {
          const ring = a.accent_color
            ? `linear-gradient(135deg, ${a.accent_color}, ${a.banner_color || a.accent_color})`
            : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
          const avatarInner = a.avatar
            ? `<img src="${_attr(a.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">`
            : `<span style="font-family:var(--font-display);font-weight:600">${_esc((a.display_name || a.username)[0].toUpperCase())}</span>`;
          return `
            <div class="compendium-row-item" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer"
              onclick="navigate('/u/${encodeURIComponent(a.username)}')">
              <span style="width:64px;height:64px;border-radius:999px;padding:2.5px;background:${ring}">
                <span style="width:100%;height:100%;border-radius:999px;background:var(--color-surface-2);display:grid;place-items:center;overflow:hidden">${avatarInner}</span>
              </span>
              <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--color-ink);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:84px">${_esc(a.display_name || a.username)}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  imageCarouselHtml() {
    if (!this.images.length) return `<p style="color:var(--color-sec);font-size:13px">${t("compendium_nothing_here_yet")}</p>`;
    return `
      <div class="compendium-row compendium-row-image">
        ${this.images.map((img) => {
          const blur = img.is_explicit && !ME?.nsfw_allowed;
          const creatorName = img.owner_display_name || img.owner_username || t("compendium_you_fallback");
          const profile = this.charCreatorProfiles[img.owner_username];
          const avatarSrc = profile?.avatar || img.owner_avatar;
          const avatarInner = avatarSrc
            ? `<img src="${_attr(avatarSrc)}" alt="">`
            : `<span>${_esc(creatorName[0].toUpperCase())}</span>`;
          const ringGradient = profile?.accent_color
            ? `linear-gradient(135deg, ${profile.accent_color}, ${profile.banner_color || profile.accent_color})`
            : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
          const hue = [...(img.id || creatorName)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
          const dom = `hsl(${hue} 45% 20%)`;
          return `
            <div class="compendium-row-item" style="border-radius:12px;overflow:hidden;border:1px solid var(--color-line-2);position:relative;cursor:pointer;aspect-ratio:1;--dom:${dom}"
              data-dom-src="${_attr(img.image)}"
              onclick="navigate('/i/${encodeURIComponent(img.id)}')">
              <img src="${_attr(img.image)}" alt="" ${img.is_explicit ? 'data-explicit="1"' : ""} style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;${blur ? "filter:blur(14px) saturate(60%)" : ""}">
              ${blur ? `<span style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--font-mono);font-size:9px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)">18+</span>` : ""}
              <div class="char-card-fade"></div>
              <div class="char-card-creator" style="position:absolute;left:8px;right:8px;bottom:7px" ${img.owner_username ? `onclick="event.stopPropagation();navigate('/u/${encodeURIComponent(img.owner_username)}')" style="cursor:pointer"` : ""}>
                <span class="char-card-creator-ring" style="background:${ringGradient}">
                  <span class="char-card-creator-ring-inner">${avatarInner}</span>
                </span>
                <span class="char-card-creator-name">${_esc(creatorName)}</span>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  threadCarouselHtml() {
    if (!this.threads.length) return `<p style="color:var(--color-sec);font-size:13px">${t("compendium_no_threads_yet")}</p>`;
    return `
      <div class="compendium-row compendium-row-thread">
        ${this.threads.map((t) => `
          <div class="compendium-row-item" style="padding:12px;border-radius:14px;border:1px solid var(--color-line);background:var(--color-surface);cursor:pointer"
            onclick="navigate('/explore/forum')">
            <h3 style="font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink);margin:0 0 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(t.title)}</h3>
            <p style="font-size:11.5px;line-height:1.4;color:var(--color-sec);margin:0;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden">${_esc(t.content)}</p>
            <div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:10px;color:var(--color-muted)">
              <span>@${_esc(t.author_username)}</span><span>·</span><span>${t.like_count} likes</span><span>·</span><span>${t.reply_count} replies</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  render() {
    if (this._charsAll) this.applyTierLimits();
    const loaded = this.chars !== null;
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px">
        ${pageHeaderHtml("Explore", "Overview", t("ph_explore_title"), t("ph_explore_sub"))}
        ${this.sectionHtml(t("compendium_section_characters"), "explore/characters", loaded ? this.charCarouselHtml() : "", loaded)}
        ${this.sectionHtml(t("compendium_section_creators"), "explore/creators", loaded ? this.creatorCarouselHtml() : "", loaded)}
        ${this.sectionHtml(t("compendium_section_media_gallery"), "explore/images", loaded ? this.imageCarouselHtml() : "", loaded)}
        ${this.sectionHtml(t("compendium_section_forum"), "explore/forum", loaded ? this.threadCarouselHtml() : "", loaded)}
      </div>
    `;
    wireCharCardDominantColors(this.main);
  }
}

if (typeof window !== "undefined") {
  window.ExploreView = ExploreView;
}
