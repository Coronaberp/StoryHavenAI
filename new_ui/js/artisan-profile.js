"use strict";

class ArtisanProfileView {
  constructor() {
    this.profile = null;
    this.chars = [];
    this.loading = true;
    this.error = "";
  }

  usernameFromPath() {
    return decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
  }

  async mount(main) {
    this.main = main;
    this.username = this.usernameFromPath();
    this.render();
    await this.load();
  }

  async load() {
    this.loading = true;
    this.error = "";
    this.render();
    try {
      this.profile = await api(`/api/users/${encodeURIComponent(this.username)}`);
      this.chars = this.profile.characters || [];
    } catch (err) {
      this.error = err.message || "Couldn't find that artisan.";
    }
    this.loading = false;
    this.render();
  }

  render() {
    const p = this.profile;
    const hue = [...this.username].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const banner = p?.banner_img
      ? `background-image:url('${p.banner_img}')`
      : `background:linear-gradient(150deg, hsl(${hue} 45% 24%), hsl(${(hue + 40) % 360} 40% 12%))`;
    const ring = p?.accent_color
      ? `linear-gradient(135deg, ${p.accent_color}, ${p.banner_color || p.accent_color})`
      : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
    const avatarInner = p?.avatar
      ? `<img src="${p.avatar}" alt="">`
      : `<span>${(p?.display_name || this.username || "?")[0]?.toUpperCase() || "?"}</span>`;
    const charCount = p?.stats?.characters ?? 0;
    const charLabel = charCount === 1 ? "character" : "characters";
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        <a href="/artisans" data-route="__back" onclick="event.preventDefault();navigate('/artisans')"
          style="font-family:var(--font-mono);font-size:11px;color:var(--color-sec);display:inline-flex;align-items:center;gap:4px;width:fit-content">
          &larr; Artisans
        </a>
        ${this.loading ? `<p style="color:var(--color-sec);font-size:13px">Consulting the archive…</p>` : ""}
        ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${this.error}</p>` : ""}
        ${p ? `
          <div class="artisan-card" style="margin-bottom:4px">
            <div class="artisan-banner" style="${banner}"></div>
            <span class="artisan-ring" style="background:${ring}">
              <span class="artisan-ring-inner">${avatarInner}</span>
            </span>
            <div class="artisan-body">
              <div class="artisan-name">${p.display_name || p.username}</div>
              <div class="artisan-handle">@${p.username}</div>
              ${p.bio ? `<p class="artisan-bio">${p.bio}</p>` : ""}
              <div class="artisan-stats"><b>${charCount}</b> ${charLabel}</div>
            </div>
          </div>
          <div>
            <div class="font-mono" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-muted);margin-bottom:8px">Characters</div>
            ${this.chars.length
              ? `<div class="card-grid">${this.chars.map((c) => characterCardHtml(c, p)).join("")}</div>`
              : `<p style="color:var(--color-sec);font-size:13px">No public characters yet.</p>`}
          </div>
        ` : ""}
      </div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.ArtisanProfileView = ArtisanProfileView;
}
