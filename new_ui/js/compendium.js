"use strict";

function _shuffleSample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

class CompendiumView {
  constructor() {
    this.chars = null;
    this.creators = null;
    this.images = null;
    this.threads = null;
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
    this.chars = _shuffleSample(chars, 6);
    this.creators = _shuffleSample(creators, 6);
    this.images = _shuffleSample(images, 6);
    this.threads = threads.slice(0, 3);
    this.render();
  }

  sectionHtml(title, seeAllRoute, bodyHtml, loaded) {
    return `
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <div>
            <div class="font-mono" style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-muted)">Featured</div>
            <div class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${title}</div>
          </div>
          <a href="/${seeAllRoute}" data-route="__seeall" onclick="event.preventDefault();navigate('/${seeAllRoute}')"
            style="font-family:var(--font-mono);font-size:10.5px;color:var(--color-accent);white-space:nowrap">See all &rarr;</a>
        </div>
        ${!loaded ? `<p style="color:var(--color-sec);font-size:13px">Consulting the archive…</p>` : bodyHtml}
      </div>
    `;
  }

  charCarouselHtml() {
    if (!this.chars.length) return `<p style="color:var(--color-sec);font-size:13px">Nothing here yet.</p>`;
    return `
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">
        ${this.chars.map((c) => `<div style="flex:none;width:130px">${characterCardHtml(c, null)}</div>`).join("")}
      </div>
    `;
  }

  creatorCarouselHtml() {
    if (!this.creators.length) return `<p style="color:var(--color-sec);font-size:13px">Nothing here yet.</p>`;
    return `
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">
        ${this.creators.map((a) => {
          const ring = a.accent_color
            ? `linear-gradient(135deg, ${a.accent_color}, ${a.banner_color || a.accent_color})`
            : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
          const avatarInner = a.avatar
            ? `<img src="${a.avatar}" alt="" style="width:100%;height:100%;object-fit:cover">`
            : `<span style="font-family:var(--font-display);font-weight:600">${(a.display_name || a.username)[0].toUpperCase()}</span>`;
          return `
            <div style="flex:none;width:84px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer"
              onclick="navigate('/u/${encodeURIComponent(a.username)}')">
              <span style="width:64px;height:64px;border-radius:999px;padding:2.5px;background:${ring}">
                <span style="width:100%;height:100%;border-radius:999px;background:var(--color-surface-2);display:grid;place-items:center;overflow:hidden">${avatarInner}</span>
              </span>
              <span style="font-family:var(--font-mono);font-size:10.5px;color:var(--color-ink);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:84px">${a.display_name || a.username}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  imageCarouselHtml() {
    if (!this.images.length) return `<p style="color:var(--color-sec);font-size:13px">Nothing here yet.</p>`;
    return `
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">
        ${this.images.map((img) => {
          const blur = img.is_explicit && !ME?.nsfw_allowed;
          return `
            <div style="flex:none;width:110px;height:110px;border-radius:12px;overflow:hidden;border:1px solid var(--color-line-2);position:relative">
              <img src="${img.image}" alt="" style="width:100%;height:100%;object-fit:cover;${blur ? "filter:blur(14px) saturate(60%)" : ""}">
              ${blur ? `<span style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--font-mono);font-size:9px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)">18+</span>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  threadCarouselHtml() {
    if (!this.threads.length) return `<p style="color:var(--color-sec);font-size:13px">No threads yet.</p>`;
    return `
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">
        ${this.threads.map((t) => `
          <div style="flex:none;width:220px;padding:12px;border-radius:14px;border:1px solid var(--color-line);background:var(--color-surface);cursor:pointer"
            onclick="navigate('/symposium')">
            <h3 style="font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink);margin:0 0 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.title}</h3>
            <p style="font-size:11.5px;line-height:1.4;color:var(--color-sec);margin:0;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden">${t.content}</p>
            <div style="margin-top:8px;display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:10px;color:var(--color-muted)">
              <span>@${t.author_username}</span><span>·</span><span>${t.like_count} likes</span><span>·</span><span>${t.reply_count} replies</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  render() {
    const loaded = this.chars !== null;
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:20px">
        ${pageHeaderHtml("Compendium", "Overview", "Compendium",
          "Every character, image, and conversation the community has laid open.")}
        ${this.sectionHtml("Pantheon", "pantheon", loaded ? this.charCarouselHtml() : "", loaded)}
        ${this.sectionHtml("Artisans", "artisans", loaded ? this.creatorCarouselHtml() : "", loaded)}
        ${this.sectionHtml("Pinacotheca", "pinacotheca", loaded ? this.imageCarouselHtml() : "", loaded)}
        ${this.sectionHtml("Symposium", "symposium", loaded ? this.threadCarouselHtml() : "", loaded)}
      </div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.CompendiumView = CompendiumView;
}
