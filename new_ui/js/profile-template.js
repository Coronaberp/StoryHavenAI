"use strict";

function _esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
}

function renderProfileCharactersHtml(chars) {
  if (!chars || !chars.length) return `<div class="gl-empty">No public characters yet.</div>`;
  return `<div class="gl-characters">${chars.map((c) => `
    <a class="gl-character-card" href="/casts" onclick="event.preventDefault();navigate('/casts')">
      <div class="gl-character-thumb">${c.avatar ? `<img src="${_esc(c.avatar)}" alt="" ${c.is_explicit ? 'data-explicit="1"' : ""}>` : ""}</div>
      <div class="gl-character-title">${_esc(c.name)}</div>
      <div class="gl-character-summary">${_esc(c.description || "")}</div>
      <div class="gl-character-meta"><span class="gl-character-chats">${c.chats || 0} chats</span></div>
    </a>
  `).join("")}</div>`;
}

function renderProfileLinksHtml(links) {
  const entries = SOCIAL_PLATFORMS.filter((sp) => (links || {})[sp.key]);
  if (!entries.length) return "";
  return `<div class="gl-links">${entries.map((sp) => `
    <a class="gl-link" href="${_esc(socialLinkHref(sp.key, links[sp.key].trim()))}" target="_blank" rel="noopener noreferrer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">${sp.icon}</svg>
    </a>
  `).join("")}</div>`;
}

const PROFILE_GL_DEFAULT_CSS = `
.gl-links{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;}
.gl-link{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--profile-gradient-start,#E3BD6C);color:#fff;flex:none;text-decoration:none;}
.gl-characters{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;}
.gl-character-card{display:block;background:#1a1a1a;border:1px solid #333;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;}
.gl-character-thumb{aspect-ratio:1;overflow:hidden;background:#222;}
.gl-character-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.gl-character-title{font-weight:600;font-size:13px;padding:8px 10px 0;color:#fff;}
.gl-character-summary{font-size:11px;color:#999;padding:2px 10px 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.gl-character-meta{font-size:10px;color:var(--profile-gradient-start,#E3BD6C);padding:0 10px 10px;}
.gl-empty{color:#888;font-size:13px;padding:12px 0;}
.gl-share{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);}
`;

function copyTextFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
  return ok;
}

function copyShareUrl(url) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => toast("Link copied."))
      .catch(() => {
        if (copyTextFallback(url)) toast("Link copied.");
        else errorToast("Couldn't copy the link.");
      });
    return;
  }
  if (copyTextFallback(url)) toast("Link copied.");
  else errorToast("Couldn't copy the link.");
}

function wireProfileShareButton(doc) {
  doc.querySelectorAll(".gl-share").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      copyShareUrl(el.dataset.shareUrl || location.href);
    });
  });
}

function substituteProfileTemplate(html, p) {
  const shareUrl = `${location.origin}/u/${encodeURIComponent(p.username || "")}`;
  const map = {
    "{{share}}": `<a class="gl-share" href="${_esc(shareUrl)}" data-share-url="${_esc(shareUrl)}">&#8663; Share</a>`,
    "{{edit}}": "",
    "{{comments}}": "",
    "{{block}}": "",
    "{{report}}": "",
    "{{display_name}}": _esc(p.display_name || p.username || ""),
    "{{bio}}": _esc(p.bio || ""),
    "{{rank}}": (p.title_status === "approved" && p.title) ? _esc(p.title) : (p.is_admin ? (p.role === "dev" ? "Dev" : "Admin") : ""),
    "{{title}}": _esc(p.title_status === "approved" ? (p.title || "") : ""),
    "{{avatar_url}}": _esc(p.avatar || ""),
    "{{banner_url}}": _esc(p.banner_img || ""),
    "{{character_count}}": String(p.stats?.characters ?? (p.characters || []).length),
    "{{chat_count}}": String(p.stats?.chats ?? 0),
    "{{member_since}}": p.joined ? new Date(p.joined * 1000).toLocaleDateString() : "",
    "{{characters}}": renderProfileCharactersHtml(p.characters || []),
    "{{links}}": renderProfileLinksHtml(p.social_links),
  };
  const out = html.replace(/\{\{[a-z_]+\}\}/g, (m) => map[m] !== undefined ? map[m] : m);
  const g1 = _esc(p.banner_color || "#E3BD6C");
  const g2 = _esc(p.accent_color || p.banner_color || "#A97F2C");
  const varStyle = `<style>:root{--profile-gradient-start:${g1};--profile-gradient-end:${g2};}\n${PROFILE_GL_DEFAULT_CSS}</style>`;
  return varStyle + out;
}
