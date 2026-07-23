"use strict";

function _esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function _attr(s) {
  return _esc(s).replace(/"/g, "&quot;");
}

function groupGridAvatar(members) {
  const list = (members || []).filter(Boolean).slice(0, 4);
  const n = Math.max(1, list.length);
  const cells = (list.length ? list : [{}]).map((m) => m.avatar
    ? `<span class="grp-av-cell" style="background-image:url('${_attr(m.avatar)}')"></span>`
    : `<span class="grp-av-cell">${_esc((m.name || "?")[0].toUpperCase())}</span>`).join("");
  return `<div class="grp-av grp-av-${n}">${cells}</div>`;
}

function visibleEls(root, selector) {
  return Array.from(root.querySelectorAll(selector)).filter((el) => el.offsetParent !== null);
}

function mediaTagHtml(rec, { style = "", className = "", controls = false, onclick = "" } = {}) {
  const classAttr = className ? ` class="${_attr(className)}"` : "";
  const onclickAttr = onclick ? ` onclick="${_attr(onclick)}"` : "";
  const explicitAttr = rec.is_explicit ? ` data-explicit="1"` : "";
  if (rec.media_type === "video") {
    const src = `${_attr(rec.image)}#t=0.1`;
    return `<video src="${src}"${classAttr} style="${_attr(style)}"${onclickAttr}${explicitAttr} ${controls ? "controls" : ""} muted playsinline preload="metadata"></video>`;
  }
  return `<img src="${_attr(rec.image)}" alt=""${classAttr} style="${_attr(style)}"${onclickAttr}${explicitAttr}>`;
}

function renderProfileCharactersHtml(chars) {
  if (!chars || !chars.length) return `<div class="gl-empty">${t("profile_no_public_characters_yet")}</div>`;
  return `<div class="gl-characters">${chars.map((c) => `
    <a class="gl-character-card" href="/c/${c.id}" onclick="event.preventDefault();navigate('/c/${c.id}')">
      <div class="gl-character-thumb">${c.avatar ? `<img class="gl-character-img" src="${_esc(c.avatar)}" alt="" ${c.is_explicit ? 'data-explicit="1"' : ""}>` : ""}</div>
      <div class="gl-character-title">${_esc(c.name)}</div>
      <div class="gl-character-summary">${_esc(c.description || "")}</div>
      <div class="gl-character-meta">
        <span class="gl-character-chats">${c.chats || 0}</span>
        ${(c.tags || []).length ? `<span class="gl-character-tags">${(c.tags || []).slice(0, 3).map((t) => `<span class="gl-tag">${_esc(t)}</span>`).join("")}</span>` : ""}
      </div>
    </a>
  `).join("")}</div>`;
}

function renderProfileLinksHtml(links) {
  const entries = SOCIAL_PLATFORMS.filter((sp) => (links || {})[sp.key]);
  if (!entries.length) return "";
  return `<div class="gl-links">${entries.map((sp) => `
    <a class="gl-link" data-platform="${sp.key}" style="--gl-color:${sp.color}" href="${_esc(socialLinkHref(sp.key, links[sp.key].trim()))}" target="_blank" rel="noopener noreferrer">
      <svg class="gl-link-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">${sp.icon}</svg>
      <span class="gl-link-host">${_esc(sp.host)}</span>
    </a>
  `).join("")}</div>`;
}

const PROFILE_GL_DEFAULT_CSS = `
.gl-links{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;}
.gl-link{width:34px;height:34px;padding:0 10px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--gl-color,var(--profile-gradient-start,#E3BD6C));color:#fff;flex:none;text-decoration:none;}
.gl-link-icon{width:16px;height:16px;flex:none;}
.gl-link-host{display:none;font-size:11px;white-space:nowrap;}
.gl-characters{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;}
.gl-character-card{display:block;background:#1a1a1a;border:1px solid #333;border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;}
.gl-character-thumb{aspect-ratio:1;overflow:hidden;background:#222;}
.gl-character-thumb .gl-character-img{width:100%;height:100%;object-fit:cover;display:block;}
.gl-character-title{font-weight:600;font-size:13px;padding:8px 10px 0;color:#fff;}
.gl-character-summary{font-size:11px;color:#999;padding:2px 10px 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.gl-character-meta{font-size:10px;color:var(--profile-gradient-start,#E3BD6C);padding:0 10px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.gl-character-chats::before{content:"\\1F4AC\\00A0";}
.gl-character-tags{display:flex;gap:4px;flex-wrap:wrap;}
.gl-tag{background:rgba(255,255,255,.08);border-radius:999px;padding:1px 6px;color:#ccc;}
.gl-empty{color:#888;font-size:13px;padding:12px 0;}
.gl-share,.gl-comments,.gl-block,.gl-edit,.gl-report,.gl-follow,.gl-followers{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);font-family:inherit;margin:4px 6px 4px 0;}
.gl-edit{background:var(--profile-gradient-start,#E3BD6C);border-color:transparent;color:#000;font-weight:600;}
.gl-block{background:rgba(224,60,60,.15);border-color:rgba(224,60,60,.35);}
.gl-follow{background:var(--profile-gradient-start,#E3BD6C);border-color:transparent;color:#000;font-weight:600;}
.gl-follow.following{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.25);color:#fff;font-weight:500;}
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
      .then(() => toast(t("profile_link_copied")))
      .catch(() => {
        if (copyTextFallback(url)) toast(t("profile_link_copied"));
        else errorToast(t("profile_couldnt_copy_the_link"));
      });
    return;
  }
  if (copyTextFallback(url)) toast(t("profile_link_copied"));
  else errorToast(t("profile_couldnt_copy_the_link"));
}

function wireProfileShareButton(doc) {
  doc.querySelectorAll(".gl-share").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      copyShareUrl(el.dataset.shareUrl || location.href);
    });
  });
}

function wireProfileCommentsButton(doc, targetId) {
  doc.querySelectorAll(".gl-comments").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openCommentsModal("user", targetId);
    });
  });
}

function wireProfileBlockButton(doc, view) {
  doc.querySelectorAll(".gl-block").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      view.toggleBlock();
    });
  });
}

function wireProfileFollowButton(doc, view) {
  doc.querySelectorAll(".gl-follow").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      if (el.dataset.busy) return;
      el.dataset.busy = "1";
      const username = view.profile.username;
      const wasFollowing = el.classList.contains("following");
      try {
        const res = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: wasFollowing ? "DELETE" : "POST" });
        view.profile.following = res.following;
        view.profile.follower_count = res.follower_count;
        el.classList.toggle("following", res.following);
        el.innerHTML = res.following ? `&#10003; ${t("profile_following", "Following")}` : `&#43; ${t("profile_follow_creator", "Follow this creator")}`;
      } catch (err) {
        errorToast(err.message || t("profile_follow_failed", "Couldn't update follow."));
      } finally {
        delete el.dataset.busy;
      }
    });
  });
  doc.querySelectorAll(".gl-followers").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); openFollowersModal(view.profile.username); });
  });
}

async function openFollowersModal(username) {
  const layer = openModal(`<h3>${t("profile_followers", "Followers")}</h3><div id="flwList" style="color:var(--color-muted);font-size:13px">${t("common_loading", "Loading...")}</div>`);
  let list;
  try {
    list = await api(`/api/users/${encodeURIComponent(username)}/followers`);
  } catch (err) {
    layer.querySelector("#flwList").textContent = err.message || t("profile_followers_load_failed", "Couldn't load followers.");
    return;
  }
  const body = layer.querySelector("#flwList");
  if (!list.length) { body.textContent = t("profile_no_followers_yet", "No followers yet."); return; }
  body.innerHTML = `<div style="display:flex;flex-direction:column;gap:2px">${list.map((f) => `
    <button type="button" class="grimoire-picker-row" data-flw="${_attr(f.username)}">
      <span class="sanctum-specimen" style="${f.avatar ? `background-image:url('${_attr(f.avatar)}')` : "background:var(--color-surface-2)"}">${f.avatar ? "" : _esc((f.display_name || f.username)[0].toUpperCase())}</span>
      <span style="display:flex;flex-direction:column;align-items:flex-start"><span class="font-display" style="font-size:14px;color:var(--color-ink)">${_esc(f.display_name || f.username)}</span><span style="font-size:11.5px;color:var(--color-muted)">@${_esc(f.username)}</span></span>
    </button>`).join("")}</div>`;
  body.querySelectorAll("[data-flw]").forEach((btn) => {
    btn.onclick = () => { closeModal(layer); navigate(`/u/${encodeURIComponent(btn.dataset.flw)}`); };
  });
}

function wireProfileEditButton(doc, view) {
  doc.querySelectorAll(".gl-edit").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openProfileEditor(view.profile, () => view.load());
    });
  });
}

function openProfileReportModal(p) {
  const layer = openModal(`
    <h3>${t("profile_report_profile")}</h3>
    <p style="margin:8px 0 14px;font-size:13px;color:var(--color-sec)">${t("profile_flag_page_prefix")} ${_esc(p.display_name || p.username || t("profile_this_profile"))}${t("profile_flag_page_suffix")}</p>
    <textarea id="prReportNote" rows="3" placeholder="${t("profile_whats_wrong_placeholder")}"
      style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);resize:vertical"></textarea>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
      <button type="button" id="prReportCancel" class="dropdown-item" style="border:1px solid var(--color-line-2);padding:9px 16px">${t("profile_cancel")}</button>
      <button type="button" id="prReportSend" class="dropdown-item" style="border:1px solid var(--color-warn,#e0a800);color:var(--color-warn,#e0a800);padding:9px 16px">${t("profile_send_report")}</button>
    </div>
  `);
  layer.querySelector("#prReportCancel").onclick = () => closeModal(layer);
  layer.querySelector("#prReportSend").onclick = async () => {
    const note = layer.querySelector("#prReportNote").value.trim();
    try {
      await api("/api/report-image", {
        method: "POST",
        body: JSON.stringify({
          kind: "profile",
          label: `${p.display_name || p.username || "a user"}'s profile`,
          target_id: p.id,
          image: p.avatar || p.banner_img || "",
          note,
        }),
      });
      closeModal(layer);
      toast("Report sent - an admin will take a look.");
    } catch (err) {
      errorToast(err.message || "Couldn't send the report.");
    }
  };
}

function wireProfileReportButton(doc, p) {
  doc.querySelectorAll(".gl-report").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openProfileReportModal(p);
    });
  });
}

function substituteCardTemplate(html, a) {
  const avatar = a.avatar
    ? `<img src="${_esc(a.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
    : `<span>${_esc((a.display_name || a.username || "?")[0].toUpperCase())}</span>`;
  const map = {
    "{{avatar}}": avatar,
    "{{avatar_url}}": _esc(a.avatar || ""),
    "{{name}}": _esc(a.display_name || a.username || ""),
    "{{handle}}": `@${_esc(a.username || "")}`,
    "{{bio}}": _esc(a.bio || ""),
    "{{characters}}": String(a.public_characters ?? 0),
    "{{followers}}": String(a.follower_count ?? 0),
    "{{banner_url}}": _esc(a.banner_img || ""),
  };
  const out = String(html).replace(/\{\{[a-z_]+\}\}/g, (m) => map[m] !== undefined ? map[m] : m);
  const g1 = _esc(a.banner_color || "#E3BD6C");
  const g2 = _esc(a.accent_color || a.banner_color || "#A97F2C");
  const bannerUrl = a.banner_img ? `url('${_esc(a.banner_img)}')` : "none";
  return `<style>:root{--card-gradient-start:${g1};--card-gradient-end:${g2};--card-banner-url:${bannerUrl};}html,body{margin:0}</style>` + out;
}

function substituteProfileTemplate(html, p, own) {
  const shareUrl = `${location.origin}/u/${encodeURIComponent(p.username || "")}`;
  const map = {
    "{{share}}": `<a class="gl-share" href="${_esc(shareUrl)}" data-share-url="${_esc(shareUrl)}">&#8663; ${t("profile_share")}</a>`,
    "{{edit}}": own ? `<a class="gl-edit" href="/u/${_esc(encodeURIComponent(p.username || ""))}" onclick="return false">&#9998; ${t("profile_edit_profile")}</a>` : "",
    "{{comments}}": `<button class="gl-comments" type="button">&#128172; ${t("profile_comments")}</button>`,
    "{{block}}": (!own) ? `<button class="gl-block" type="button">${p.blocked_by_viewer ? t("profile_unblock") : `&#128683; ${t("profile_block")}`}</button>` : "",
    "{{report}}": (!own) ? `<button class="gl-report" type="button">&#9873; ${t("profile_report")}</button>` : "",
    "{{follow}}": !ME ? "" : (own
      ? `<button class="gl-followers" type="button">&#128101; ${p.follower_count || 0} ${t("profile_followers", "Followers")}</button>`
      : `<button class="gl-follow${p.following ? " following" : ""}" type="button" data-feature="follows">${p.following ? `&#10003; ${t("profile_following", "Following")}` : `&#43; ${t("profile_follow_creator", "Follow this creator")}`}</button>`),
    "{{display_name}}": _esc(p.display_name || p.username || ""),
    "{{bio}}": _esc(p.bio || ""),
    "{{rank}}": (p.title_status === "approved" && p.title) ? _esc(p.title) : (p.is_admin ? (p.role === "dev" ? t("artisans_dev") : t("artisans_admin")) : ""),
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
  const bannerUrl = p.banner_img ? `url('${_esc(p.banner_img)}')` : "none";
  const varStyle = `<style>:root{--profile-gradient-start:${g1};--profile-gradient-end:${g2};--profile-banner-url:${bannerUrl};}\n${PROFILE_GL_DEFAULT_CSS}</style>`;
  return varStyle + out;
}
