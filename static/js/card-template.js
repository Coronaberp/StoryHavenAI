"use strict";
/* ============================ CARD/PROFILE TEMPLATE ============================
   Token-substitution templating for user-authored custom profile and character
   card HTML ({{avatar_url}}, {{comments}}, {{share}}, etc.) — a distinct concern
   from the character editor form itself; consumed by personas.js, dossier.js,
   report-image.js, modal-settings.js, and editor.js's own presentation preview. */
function renderProfileLinksHTML(links){
  const entries = SOCIAL_PLATFORMS.filter(sp=>(links||{})[sp.key]);
  if(!entries.length) return "";
  return `<div class="gl-links">${entries.map(sp=>{
    const raw=(links[sp.key]||"").trim();
    const href = /^https?:\/\//.test(raw) ? raw
      : sp.key==="twitter" ? `https://x.com/${raw.replace(/^@/,"")}`
      : sp.key==="twitch" ? `https://twitch.tv/${raw}`
      : sp.key==="instagram" ? `https://instagram.com/${raw.replace(/^@/,"")}`
      : sp.key==="pixiv" ? `https://pixiv.net/users/${raw}`
      : sp.key==="youtube" ? `https://youtube.com/${raw.startsWith('@')?raw:'@'+raw}`
      : sp.key==="patreon" ? `https://patreon.com/${raw}`
      : sp.key==="kofi" ? `https://ko-fi.com/${raw}`
      : raw;
    return `<a class="gl-link" data-platform="${sp.key}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(t("pf_social_"+sp.key))}" style="--gl-color:${sp.color}">
      <svg class="gl-link-icon" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">${sp.icon}</svg>
      <span class="gl-link-host">${esc(sp.host)}</span>
    </a>`;
  }).join("")}</div>`;
}
function renderProfileCharactersHTML(chars){
  if(!chars || !chars.length) return `<div class="empty"><div class="big">${esc(t("pf_no_chars"))}</div></div>`;
  return `<div class="gl-characters">${chars.map(c=>`
    <a class="gl-character-card" href="/c/${c.id}">
      <div class="gl-character-thumb">${avatar(c,"gl-character-img")}</div>
      <div class="gl-character-title">${esc(c.name)}</div>
      <div class="gl-character-summary">${esc(logline(c))}</div>
      <div class="gl-character-meta">
        <span class="gl-character-chats">${c.chats||0}</span>
        ${(c.tags||[]).length?`<span class="gl-character-tags">${(c.tags||[]).slice(0,3).map(tg=>`<span class="gl-tag">${esc(tg)}</span>`).join("")}</span>`:""}
      </div>
    </a>`).join("")}</div>`;
}
const PROFILE_GL_DEFAULT_CSS = `
.gl-links{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;}
.gl-link{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--gl-color,#c9a227);color:#fff;flex:none;text-decoration:none;transition:transform .15s,opacity .15s;}
.gl-link:hover{transform:translateY(-2px);opacity:.9;}
.gl-link-host{display:none;}
.gl-characters{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;}
.gl-character-card{display:block;background:#1a1a1a;border:1px solid #333;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;transition:.15s;}
.gl-character-card:hover{border-color:#c9a227;transform:translateY(-2px);}
.gl-character-thumb{aspect-ratio:1;overflow:hidden;background:#222;}
.gl-character-thumb .gl-character-img{width:100%;height:100%;object-fit:cover;display:block;border-radius:0;border:none;}
.gl-character-title{font-weight:600;font-size:14px;padding:8px 10px 0;color:#fff;}
.gl-character-summary{font-size:12px;color:#999;padding:2px 10px 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.gl-character-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:#c9a227;padding:0 10px 10px;flex-wrap:wrap;}
.gl-character-chats{color:#c9a227;}
.gl-character-chats::before{content:'💬';margin-right:4px;}
.gl-character-tags{display:flex;gap:5px;flex-wrap:wrap;}
.gl-tag{background:rgba(255,255,255,.08);color:#ccc;padding:1px 6px;border-radius:4px;text-transform:uppercase;font-size:9px;letter-spacing:.03em;}
.gl-share{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);}
.gl-share:hover{background:rgba(255,255,255,.15);}
.gl-edit{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:var(--profile-gradient-start,#E3BD6C);color:#111;text-decoration:none;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;}
.gl-edit:hover{opacity:.9;}
.gl-comments{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);font-family:inherit;}
.gl-comments:hover{background:rgba(255,255,255,.15);}
.gl-block{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);font-family:inherit;}
.gl-block:hover{background:rgba(180,35,24,.35);border-color:rgba(180,35,24,.5);}
`;
/* Minimal CSS for the {{comments}} placeholder on character cards, which have
   no other injected default stylesheet the way profile cards do (no
   gradient/links/characters grid system) — just enough to make the button
   look like a real control instead of unstyled browser default. */
const CARD_COMMENTS_CSS = `.gl-comments{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);font-family:inherit;}
.gl-comments:hover{background:rgba(255,255,255,.15);}`;
function substituteProfileTemplate(html, p, socialLinks, own){
  const shareUrl = `${location.origin}/u/${encodeURIComponent(p.username||"")}`;
  const map = {
    "{{share}}": `<a class="gl-share" href="${esc(shareUrl)}" data-share-url="${esc(shareUrl)}">⤴ ${esc(t("doss_share"))}</a>`,
    "{{edit}}": own ? `<a class="gl-edit" href="#" data-edit="1">✎ ${esc(t("pf_edit"))}</a>` : "",
    "{{comments}}": `<button class="gl-comments" data-comments="1" type="button">💬 ${esc(t("doss_comments"))}</button>`,
    "{{block}}": (!own && ME) ? `<button class="gl-block" data-block="1" type="button">${p.blocked_by_viewer?"Unblock":"🚫 Block"}</button>` : "",
    "{{report}}": (!own && ME) ? `<button class="gl-comments gl-report" data-report="1" type="button">🚩 ${esc(t("report_flag_tip"))}</button>` : "",
    "{{display_name}}": esc(p.display_name||p.username||""),
    "{{bio}}": esc(p.bio||""),
    "{{rank}}": (p.title_status==="approved"&&p.title)?esc(p.title):(p.is_admin?(p.role==="dev"?"Dev":esc(t("pf_admin"))):""),
    "{{title}}": esc(p.title_status==="approved"?(p.title||""):""),
    "{{avatar_url}}": esc(mediaURL(p.avatar||"")),
    "{{banner_url}}": esc(mediaURL(p.banner_img||"")),
    "{{character_count}}": String((p.stats&&p.stats.characters)||(p.characters||[]).length||0),
    "{{chat_count}}": String((p.stats&&p.stats.chats)||0),
    "{{member_since}}": p.joined ? new Date(p.joined*1000).toLocaleDateString() : "",
    "{{characters}}": renderProfileCharactersHTML(p.characters||[]),
    "{{links}}": renderProfileLinksHTML(socialLinks||p.social_links),
  };
  const out = html.replace(/\{\{[a-z_]+\}\}/g, m=>map[m]!==undefined?map[m]:m);
  const g1=esc(p.banner_color||"#E3BD6C"), g2=esc(p.accent_color||p.banner_color||"#A97F2C");
  const bannerUrl = p.banner_img ? `url('${esc(mediaURL(p.banner_img))}')` : "none";
  const varStyle = `<style>:root{--profile-gradient-start:${g1};--profile-gradient-end:${g2};--profile-banner-url:${bannerUrl};}\n${PROFILE_GL_DEFAULT_CSS}</style>`;
  return varStyle + out;
}
function wireProfileTemplateButtons(doc, {onEdit, onBlockToggle, blockedUsername, blockedByViewer}={}){
  doc.querySelectorAll(".gl-share, #pfShare").forEach(el=>{
    el.addEventListener("click", e=>{
      e.preventDefault();
      const url=el.dataset.shareUrl || `${location.origin}/u/${encodeURIComponent(ME?.username||"")}`;
      navigator.clipboard?.writeText(url).then(()=>toast(t("doss_share_copied"))).catch(()=>{});
    });
  });
  if(onEdit) doc.querySelectorAll(".gl-edit, #pfEdit").forEach(el=>{
    el.addEventListener("click", e=>{ e.preventDefault(); onEdit(); });
  });
  if(blockedUsername) doc.querySelectorAll(".gl-block").forEach(el=>{
    el.addEventListener("click", e=>{
      e.preventDefault();
      if(blockedByViewer){
        api("/api/users/"+encodeURIComponent(blockedUsername)+"/unblock",{method:"POST"})
          .then(()=>{ toast("Unblocked."); if(onBlockToggle) onBlockToggle(); })
          .catch(err=>errorToast(err.message));
        return;
      }
      openBlockUserModal(blockedUsername, ()=>navigate("/"));
    });
  });
}
/* Wires the {{comments}} placeholder (character and profile custom cards
   alike) to the same comments modal + live count the standalone Comments
   button always used — the button now lives wherever the card author placed
   it instead of a bar bolted above the iframe. `doc` may be the iframe's own
   contentDocument (custom-card path) or the top-level `document` (default,
   non-custom pages still using a real #cmtBtn/#pfCmtBtn, harmlessly a no-op
   match there since those don't carry the .gl-comments class). */
function wireCardCommentsButtons(doc, targetType, targetId, ctx){
  doc.querySelectorAll(".gl-comments").forEach(btn=>{
    btn.addEventListener("click", e=>{ e.preventDefault(); openCommentsModal(targetType, targetId, ctx||{}); });
    updateCommentBtn(btn, targetType, targetId);
  });
}
/* Character cards have no other template-substitution system (no
   {{display_name}}-style tokens like profiles) — {{comments}} and {{report}}
   are the only tokens characters support so far, kept intentionally minimal. */
function substituteCharacterTemplate(html, c, isOwner=false){
  const map = {
    "{{comments}}": `<button class="gl-comments" data-comments="1" type="button">💬 ${esc(t("doss_comments"))}</button>`,
    "{{report}}": (!isOwner && ME) ? `<button class="gl-comments gl-report" data-report="1" type="button">🚩 ${esc(t("report_flag_tip"))}</button>` : "",
  };
  const out=(html||"").replace(/\{\{[a-z_]+\}\}/g, m=>map[m]!==undefined?map[m]:m);
  return `<style>${CARD_COMMENTS_CSS}</style>` + out;
}
