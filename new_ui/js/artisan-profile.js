"use strict";

const SOCIAL_PLATFORMS = [
  { key: "twitter", host: "x.com", icon: '<path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-6.9L4.4 22H1.3l8.1-9.3L1 2h7.2l5 6.3L18.9 2Zm-1.2 18h1.7L6.4 4H4.6l13.1 16Z"/>' },
  { key: "twitch", host: "twitch.tv", icon: '<path d="M4 2 2 6v14h6v2h4l2-2h4l4-4V2H4Zm18 12-3 3h-5l-2 2h-2v-2H6V4h16v10Z"/><path d="M14 7h2v5h-2zM9 7h2v5H9z"/>' },
  { key: "instagram", host: "instagram.com", icon: '<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5ZM17.8 6a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z"/>' },
  { key: "discord", host: "discord.gg", icon: '<path d="M20.3 5.4A18 18 0 0 0 15.9 4l-.3.6a13 13 0 0 1 3.9 1.5 15 15 0 0 0-11 0A13 13 0 0 1 12.4 4l-.3-.6a18 18 0 0 0-4.4 1.4C3.5 10 2.7 14.4 3.1 18.8a18 18 0 0 0 5.5 2.8l1-1.6a11 11 0 0 1-1.9-.9l.5-.4a13 13 0 0 0 11.6 0l.5.4a11 11 0 0 1-1.9.9l1 1.6a18 18 0 0 0 5.5-2.8c.5-5.2-.8-9.6-4.1-13.4ZM9.7 15.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"/>' },
  { key: "pixiv", host: "pixiv.net", icon: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm5 6-3.6 4.2L17 16h-2.8l-2.5-3-1.2 1.4V16H8.2V8h2.3v3.6L13.7 8H17Z"/>' },
  { key: "youtube", host: "youtube.com", icon: '<path d="M23 12s0-3.5-.5-5.2a2.8 2.8 0 0 0-2-2C18.9 4.3 12 4.3 12 4.3s-6.9 0-8.5.5a2.8 2.8 0 0 0-2 2C1 8.5 1 12 1 12s0 3.5.5 5.2a2.8 2.8 0 0 0 2 2c1.6.5 8.5.5 8.5.5s6.9 0 8.5-.5a2.8 2.8 0 0 0 2-2C23 15.5 23 12 23 12ZM9.8 15.5v-7l6 3.5Z"/>' },
  { key: "patreon", host: "patreon.com", icon: '<circle cx="15" cy="9.5" r="6.5"/><rect x="3" y="2" width="3" height="20"/>' },
  { key: "kofi", host: "ko-fi.com", icon: '<path d="M4 3h13a3 3 0 0 1 0 6h-.3A6 6 0 0 1 11 15H8v3H4V3Zm4 4v6h3a3 3 0 0 0 0-6H8Zm9 0a1 1 0 1 0 0 2h.3a1 1 0 0 0 0-2Z"/>' },
];

function socialLinkHref(key, raw) {
  if (/^https?:\/\//.test(raw)) return raw;
  if (key === "twitter") return `https://x.com/${raw.replace(/^@/, "")}`;
  if (key === "twitch") return `https://twitch.tv/${raw}`;
  if (key === "instagram") return `https://instagram.com/${raw.replace(/^@/, "")}`;
  if (key === "pixiv") return `https://pixiv.net/users/${raw}`;
  if (key === "youtube") return `https://youtube.com/${raw.startsWith("@") ? raw : "@" + raw}`;
  if (key === "patreon") return `https://patreon.com/${raw}`;
  if (key === "kofi") return `https://ko-fi.com/${raw}`;
  return raw;
}

function socialLinksHtml(links) {
  const entries = SOCIAL_PLATFORMS.filter((sp) => (links || {})[sp.key]);
  if (!entries.length) return "";
  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${entries.map((sp) => `
        <a href="${socialLinkHref(sp.key, links[sp.key].trim())}" target="_blank" rel="noopener noreferrer"
          style="width:36px;height:36px;border-radius:999px;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line-2);color:var(--color-ink)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">${sp.icon}</svg>
        </a>
      `).join("")}
    </div>
  `;
}

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

  shareProfile() {
    const url = `${location.origin}/u/${encodeURIComponent(this.username)}`;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied.")).catch(() => {});
  }

  renderCustom(p) {
    this.main.innerHTML = `<div id="pfCustom" style="margin:-16px"></div>`;
    mountSandboxedHTML(this.main.querySelector("#pfCustom"), substituteProfileTemplate(p.profile_html, p), {
      onReady: (doc) => wireProfileShareButton(doc),
    });
  }

  render() {
    const p = this.profile;
    if (p?.profile_html && p.profile_html.trim()) {
      this.renderCustom(p);
      return;
    }
    const c1 = p?.banner_color || "#E3BD6C";
    const c2 = p?.accent_color || p?.banner_color || "#A97F2C";
    const banner = p?.banner_img
      ? `background-image:url('${p.banner_img}')`
      : `background:linear-gradient(100deg, ${c1}, ${c2})`;
    const ring = p?.accent_color
      ? `linear-gradient(135deg, ${p.accent_color}, ${p.banner_color || p.accent_color})`
      : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
    const avatarInner = p?.avatar
      ? `<img src="${p.avatar}" alt="">`
      : `<span>${(p?.display_name || this.username || "?")[0]?.toUpperCase() || "?"}</span>`;
    const charCount = p?.stats?.characters ?? 0;
    const charLabel = charCount === 1 ? "character" : "characters";
    const chatCount = p?.stats?.chats ?? 0;
    const chatLabel = chatCount === 1 ? "chat" : "chats";
    const joined = p?.joined ? new Date(p.joined * 1000).toLocaleDateString() : "";
    const badge = p?.title_status === "approved" && p?.title
      ? `<span style="font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));border:1px solid var(--color-accent);color:var(--color-accent)">${p.title}</span>`
      : p?.is_admin
        ? `<span style="font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:color-mix(in srgb, var(--color-accent) 18%, var(--color-surface));border:1px solid var(--color-accent);color:var(--color-accent)">${p.role === "dev" ? "Dev" : "Admin"}</span>`
        : "";
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
            <button type="button" onclick="event.stopPropagation();this.closest('.artisan-card').__view.shareProfile()"
              style="position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:999px;display:grid;place-items:center;background:rgba(10,10,12,.55);border:1px solid rgba(255,255,255,.25);color:#fff">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>
            </button>
            <div class="artisan-body">
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
                <div class="artisan-name">${p.display_name || p.username}</div>
                ${badge}
              </div>
              <div class="artisan-handle">@${p.username}</div>
              ${p.bio ? `<p class="artisan-bio">${p.bio}</p>` : ""}
              <div class="artisan-stats" style="display:flex;gap:14px;flex-wrap:wrap">
                <span><b>${charCount}</b> ${charLabel}</span>
                <span><b>${chatCount}</b> ${chatLabel}</span>
                ${joined ? `<span>Joined ${joined}</span>` : ""}
              </div>
              ${socialLinksHtml(p.social_links)}
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
    const card = this.main.querySelector(".artisan-card");
    if (card) card.__view = this;
  }
}

if (typeof window !== "undefined") {
  window.ArtisanProfileView = ArtisanProfileView;
}
