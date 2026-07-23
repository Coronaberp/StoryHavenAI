"use strict";

class ExploreCreatorsView {
  constructor() {
    this.artisans = [];
    this.loading = true;
    this.error = "";
    this.q = "";
  }

  async mount(main) {
    this.main = main;
    window._activeExploreCreatorsView = this;
    this.render();
    await this.load();
  }

  async load() {
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const params = new URLSearchParams();
      if (this.q) params.set("q", this.q);
      const qs = params.toString();
      this.artisans = await api(`/api/users${qs ? `?${qs}` : ""}`);
    } catch (err) {
      this.error = err.message || t("artisans_couldnt_load_creators");
      this.artisans = [];
    }
    this.loading = false;
    this.render();
  }

  mountCustomCards() {
    this.main.querySelectorAll("[data-card-user]").forEach((box) => {
      const a = this.artisans.find((x) => x.username === box.dataset.cardUser);
      if (!a) return;
      mountSandboxedHTML(box, substituteCardTemplate(a.card_html, a), { autoHeight: false });
      const ifr = box.querySelector("iframe");
      if (ifr) ifr.style.pointerEvents = "none";
    });
  }

  rowHtml(a) {
    if (a.card_html && a.card_html.trim()) {
      return `<div class="artisan-card artisan-card-custom" data-card-user="${_attr(a.username)}" style="cursor:pointer" onclick="navigate('/u/${encodeURIComponent(a.username)}')"></div>`;
    }
    const hue = [...a.username].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const ring = a.accent_color
      ? `linear-gradient(135deg, ${a.accent_color}, ${a.banner_color || a.accent_color})`
      : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
    const banner = a.banner_img
      ? `background-image:url('${_attr(a.banner_img)}')`
      : `background:linear-gradient(150deg, hsl(${hue} 45% 24%), hsl(${(hue + 40) % 360} 40% 12%))`;
    const avatarInner = a.avatar
      ? `<img src="${_attr(a.avatar)}" alt="">`
      : `<span>${_esc((a.display_name || a.username)[0].toUpperCase())}</span>`;
    const charLabel = a.public_characters === 1 ? t("artisans_character_singular") : t("artisans_character_plural");
    const followerLabel = a.follower_count === 1 ? t("artisans_follower_singular", "follower") : t("artisans_follower_plural", "followers");
    const isSelf = ME?.username === a.username;
    return `
      <div class="artisan-card artisan-card-compact" data-username="${_attr(a.username)}" style="cursor:pointer" onclick="navigate('/u/${encodeURIComponent(a.username)}')">
        <div class="artisan-banner" style="${banner}"></div>
        <span class="artisan-ring" style="background:${ring}">
          <span class="artisan-ring-inner">${avatarInner}</span>
        </span>
        <div class="artisan-body">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <div class="artisan-name">${_esc(a.display_name || a.username)}</div>
            ${isSelf ? `<span style="font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));border:1px solid var(--color-accent);color:var(--color-accent)">You</span>` : ""}
          </div>
          <div class="artisan-handle">@${_esc(a.username)}</div>
          ${a.bio ? `<p class="artisan-bio">${_esc(a.bio)}</p>` : ""}
          <div class="artisan-stats"><b>${a.public_characters}</b> ${charLabel} &middot; <b>${a.follower_count || 0}</b> ${followerLabel}</div>
          ${!isSelf && ME ? `
            <button type="button" class="filter-chip${a.following ? " on" : ""}" data-follow-btn data-feature="follows"
              onclick="event.stopPropagation();_activeExploreCreatorsView.toggleFollow('${_jsEsc(a.username)}', this)"
              style="margin-top:8px;display:inline-flex;align-items:center;gap:5px">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${a.following ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M12 5v14M5 12h14"/>'}</svg>
              <span data-follow-label>${a.following ? t("profile_following", "Following") : t("artisans_follow", "Follow")}</span>
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }

  async toggleFollow(username, btn) {
    const a = this.artisans.find((x) => x.username === username);
    if (!a || btn.dataset.busy) return;
    btn.dataset.busy = "1";
    try {
      const res = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: a.following ? "DELETE" : "POST" });
      a.following = res.following;
      a.follower_count = res.follower_count;
      btn.classList.toggle("on", res.following);
      const label = btn.querySelector("[data-follow-label]");
      if (label) label.textContent = res.following ? t("profile_following", "Following") : t("artisans_follow", "Follow");
      const svg = btn.querySelector("svg");
      if (svg) svg.innerHTML = res.following ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M12 5v14M5 12h14"/>';
      const card = this.main.querySelector(`.artisan-card[data-username="${CSS.escape(username)}"] .artisan-stats`);
      if (card) card.innerHTML = `<b>${a.public_characters}</b> ${a.public_characters === 1 ? t("artisans_character_singular") : t("artisans_character_plural")} &middot; <b>${a.follower_count || 0}</b> ${a.follower_count === 1 ? t("artisans_follower_singular", "follower") : t("artisans_follower_plural", "followers")}`;
    } catch (err) {
      errorToast(err.message || t("profile_follow_failed", "Couldn't update follow."));
    } finally {
      delete btn.dataset.busy;
    }
  }

  render() {
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${pageHeaderHtml("Explore", "Creators", t("ph_creators_title"), t("ph_creators_sub"))}
        <input type="text" id="artisansSearch" value="${_attr(this.q)}" placeholder="${t("artisans_search_placeholder")}"
          style="padding:10px 12px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
        ${this.loading ? `<p style="color:var(--color-sec);font-size:13px">${t("artisans_consulting_archive")}</p>` : ""}
        ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${this.error}</p>` : ""}
        ${!this.loading && !this.error && !this.artisans.length ? `<p style="color:var(--color-sec);font-size:13px">${t("artisans_no_creators_match_search")}</p>` : ""}
        <div class="card-grid">${this.artisans.map((a) => this.rowHtml(a)).join("")}</div>
      </div>
    `;
    this.mountCustomCards();
    const search = this.main.querySelector("#artisansSearch");
    let searchTimer;
    search.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.q = search.value.trim();
        this.load();
      }, 350);
    };
  }
}

if (typeof window !== "undefined") {
  window.ExploreCreatorsView = ExploreCreatorsView;
}
