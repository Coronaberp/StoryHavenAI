"use strict";

class ArtisansView {
  constructor() {
    this.artisans = [];
    this.loading = true;
    this.error = "";
    this.q = "";
  }

  async mount(main) {
    this.main = main;
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
      this.error = err.message || "Couldn't load the Artisans.";
      this.artisans = [];
    }
    this.loading = false;
    this.render();
  }

  rowHtml(a) {
    const hue = [...a.username].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const ring = a.accent_color
      ? `linear-gradient(135deg, ${a.accent_color}, ${a.banner_color || a.accent_color})`
      : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
    const banner = a.banner_img
      ? `background-image:url('${a.banner_img}')`
      : `background:linear-gradient(150deg, hsl(${hue} 45% 24%), hsl(${(hue + 40) % 360} 40% 12%))`;
    const avatarInner = a.avatar
      ? `<img src="${a.avatar}" alt="">`
      : `<span>${(a.display_name || a.username)[0].toUpperCase()}</span>`;
    const charLabel = a.public_characters === 1 ? "character" : "characters";
    return `
      <div class="artisan-card" style="cursor:pointer" onclick="navigate('/u/${encodeURIComponent(a.username)}')">
        <div class="artisan-banner" style="${banner}"></div>
        <span class="artisan-ring" style="background:${ring}">
          <span class="artisan-ring-inner">${avatarInner}</span>
        </span>
        <div class="artisan-body">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <div class="artisan-name">${a.display_name || a.username}</div>
            ${ME?.username === a.username ? `<span style="font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));border:1px solid var(--color-accent);color:var(--color-accent)">You</span>` : ""}
          </div>
          <div class="artisan-handle">@${a.username}</div>
          ${a.bio ? `<p class="artisan-bio">${a.bio}</p>` : ""}
          <div class="artisan-stats"><b>${a.public_characters}</b> ${charLabel}</div>
        </div>
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${pageHeaderHtml("Compendium", "Artisans", "Artisans",
          "The people behind every character, image, and world in the archive.")}
        <input type="text" id="artisansSearch" value="${this.q}" placeholder="Search artisans…"
          style="padding:10px 12px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
        ${this.loading ? `<p style="color:var(--color-sec);font-size:13px">Consulting the archive…</p>` : ""}
        ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${this.error}</p>` : ""}
        ${!this.loading && !this.error && !this.artisans.length ? `<p style="color:var(--color-sec);font-size:13px">No artisans match that search.</p>` : ""}
        <div style="display:flex;flex-direction:column;gap:14px">${this.artisans.map((a) => this.rowHtml(a)).join("")}</div>
      </div>
    `;
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
  window.ArtisansView = ArtisansView;
}
