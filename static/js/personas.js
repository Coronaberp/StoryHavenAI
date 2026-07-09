"use strict";
/* ============================ PERSONAS ============================ */
async function viewProfile(main, username){
  let p=null;
  try{ p=await api("/api/users/"+encodeURIComponent(username)); }
  catch(e){ return errorPage(main, {code:"404", title:"Page not found", message:t("pf_not_found")}); }
  const own = ME && ME.username===p.username;
  const c1=p.banner_color||"#E3BD6C", c2=p.accent_color||p.banner_color||"#A97F2C";
  const banner = p.banner_img
    ? `background:url('${esc(mediaURL(p.banner_img))}') center/cover`
    : `background:linear-gradient(100deg,${esc(c1)},${esc(c2)})`;
  const cardTint = `background:linear-gradient(160deg, color-mix(in srgb, ${esc(c1)} 16%, var(--surface)), color-mix(in srgb, ${esc(c2)} 10%, var(--surface)) 55%, var(--surface));`;
  const pfNb=nsfwCls({is_explicit:p.is_explicit});
  const avaHTML = p.avatar
    ? `<img class="pf-ava${pfNb}" src="${esc(mediaURL(p.avatar))}" alt="">`
    : `<div class="pf-ava mono">${esc((p.display_name||p.username||"?")[0].toUpperCase())}</div>`;
  const joined = p.joined ? new Date(p.joined*1000).toLocaleDateString() : "";
  if(p.profile_html && p.profile_html.trim()){
    /* {{comments}} and {{block}} are both mandatory placeholders now (save-time
       + retroactive compliance enforced), so every custom profile is
       guaranteed to already carry its own working Comments and Block controls
       wherever the owner placed them — no bar bolted above the iframe needed
       for either anymore. */
    main.innerHTML=`<div class="wrap wrap-wide"><div id="pfCustom"></div></div>`;
    mountSandboxedHTML($("#pfCustom"), substituteProfileTemplate(p.profile_html, p, null, own), {onReady:doc=>{
      wireProfileTemplateButtons(doc, {
        onEdit: own ? ()=>openProfileEditor(p, ()=>viewProfile(main, username)) : null,
        blockedUsername: p.username, blockedByViewer: p.blocked_by_viewer,
        onBlockToggle: ()=>viewProfile(main, username),
      });
      wireCardCommentsButtons(doc, "user", p.username, {ownerId:p.id});
      if(!own || _complianceShownThisLoad) return;
      const reasons=cardComplianceReasons(p.profile_html, doc, "user");
      if(!reasons.length) return;
      _complianceShownThisLoad=true;
      openComplianceModal({
        html: p.profile_html,
        filename: `${(p.username||"profile").replace(/[^a-z0-9]+/gi,"-")}-profile.html`,
        reasons,
        onEdit: ()=>openProfileEditor(p, ()=>viewProfile(main, username)),
        onClear: async()=>{
          await api("/api/me/profile", j("PUT", {profile_html:""}));
          viewProfile(main, username);
        },
      });
    }});
    return;
  }
  const linksHTML = renderProfileLinksHTML(p.social_links);
  main.innerHTML=`
    <div class="pf-banner-full${pfNb}" style="${banner}"></div>
    <div class="wrap wrap-wide">
    <div class="pf-card pf-glass">
      <div class="pf-body">
        <div class="pf-head">
          <div class="pf-ava-wrap" style="background-image:linear-gradient(var(--surface),var(--surface)),linear-gradient(150deg, ${esc(c1)} 0%, ${esc(c2)} 100%);">${avaHTML}</div>
          <div class="pf-id">
            <div class="pf-name-row">
              <span class="pf-name">${esc(p.display_name||p.username)}</span>
              ${(p.title_status==="approved"&&p.title)?`<span class="pf-badge pf-badge-title">${esc(p.title)}</span>`:(p.is_admin?`<span class="pf-badge">${p.username==="zukaarimoto"?"Dev":esc(t("pf_admin"))}</span>`:"")}
            </div>
            <div class="pf-user">@${esc(p.username)}</div>
          </div>
          <div style="display:flex;gap:8px;margin-left:auto;">
            <button class="btn" id="pfShare" data-share-url="${esc(location.origin)}/u/${esc(encodeURIComponent(p.username))}">⤴ ${esc(t("doss_share"))}</button>
            <button class="btn" id="pfCmtBtn">💬 Comments</button>
            ${(!own && ME)?`<button class="btn" id="pfBlock">${p.blocked_by_viewer?"Unblock":"🚫 Block"}</button>`:""}
            ${own?`<button class="btn primary" id="pfEdit" style="background:linear-gradient(135deg, ${esc(c1)}, ${esc(c2)});border-color:transparent;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6),0 0 8px color-mix(in srgb, var(--accent) 70%, transparent);">✎ ${esc(t("pf_edit"))}</button>`:""}
          </div>
        </div>
        <div class="pf-stats">
          <span><b>${p.stats.characters}</b> ${esc(t("pf_characters"))}</span>
          <span><b>${p.stats.chats}</b> ${esc(t("pf_chats"))}</span>
          ${joined?`<span>${esc(t("pf_joined"))} ${esc(joined)}</span>`:""}
        </div>
        ${p.bio?`<div class="pf-bio" id="pfBio">${esc(p.bio)}</div>`:""}
        ${linksHTML}
      </div>
    </div>
    <div class="section-heading" style="margin-top:26px;display:flex;align-items:center;justify-content:space-between;">
      <span>${esc(t("pf_characters"))}</span>
      <div class="view-switch" id="pfViewSwitch" role="group" aria-label="Layout">
        <button type="button" class="vs-btn" data-view="list" title="${esc(t("view_list"))}">☰</button>
        <button type="button" class="vs-btn" data-view="card" title="${esc(t("view_card"))}">▦</button>
      </div>
    </div>
    <div class="catalog pf-cat" id="pfCatalog"></div>
  </div>`;
  localizeContent([{el:$("#pfBio"), text:p.bio}]);
  const pfCmtBtn=$("#pfCmtBtn");
  if(pfCmtBtn){ pfCmtBtn.onclick=()=>openCommentsModal("user", p.username, {ownerId:p.id}); updateCommentBtn(pfCmtBtn,"user",p.username); }
  const box=$("#pfCatalog");
  let _v=store.get("libView","list");
  const paintPfSwitch=()=>{ $("#pfViewSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.view===_v)); };
  const renderPfCatalog=()=>{
    box.classList.toggle("catalog-card", _v==="card");
    const r=_catalogView(p.characters, _v, id=>navigate("/c/"+id));
    if(r){ box.innerHTML=r.html; r.wire(box); }
    else box.innerHTML=`<div class="empty"><div class="big">${esc(t("pf_no_chars"))}</div></div>`;
  };
  paintPfSwitch();
  renderPfCatalog();
  $("#pfViewSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    _v=b.dataset.view; store.set("libView",_v); paintPfSwitch(); renderPfCatalog();
  });
  if(own && $("#pfEdit")) $("#pfEdit").onclick=()=>openProfileEditor(p, ()=>viewProfile(main, username));
  wirePfBlock(p, main, username);
  wireProfileTemplateButtons(document);
}
function wirePfBlock(p, main, username){
  const pfBlock=document.getElementById("pfBlock");
  if(!pfBlock) return;
  pfBlock.onclick=()=>{
    if(p.blocked_by_viewer){
      api("/api/users/"+encodeURIComponent(p.username)+"/unblock",{method:"POST"})
        .then(()=>{ toast("Unblocked."); viewProfile(main, username); })
        .catch(e=>errorToast(e.message));
      return;
    }
    openBlockUserModal(p.username, ()=>navigate("/"));
  };
}
function openProfileEditor(p, onSave){
  let curAvatar = p.avatar || "";
  openModal(`<h3>${esc(t("pf_edit"))}</h3>
    <div class="field"><label>${esc(t("pf_display"))}</label><input type="text" id="pf_dn" maxlength="48" value="${esc(p.display_name||"")}" placeholder="${esc(p.username)}"></div>
    <div class="field"><label>${esc(t("pf_bio"))} <span class="hint">${esc(t("pf_bio_hint"))}</span></label>
      <textarea id="pf_bio_in" maxlength="600" style="min-height:100px">${esc(p.bio||"")}</textarea></div>
    <div class="field"><label>${esc(t("pf_title"))} <span class="hint">${esc(t("pf_title_hint"))}</span></label>
      <input type="text" id="pf_title_in" maxlength="32" value="${esc(p.title||"")}" placeholder="${esc(t("pf_title_ph"))}">
      ${p.title_status&&p.title_status!=="none"?`<span class="hint pf-title-status pf-title-${esc(p.title_status)}">${esc(t("pf_title_status_"+p.title_status))}</span>`:""}</div>
    <div class="field-group">
      <div class="field-group-label">${esc(t("pf_social"))}</div>
      ${SOCIAL_PLATFORMS.map(sp=>`
        <div class="field"><label>${esc(t("pf_social_"+sp.key))}</label>
          <input type="text" id="pf_soc_${sp.key}" maxlength="300" placeholder="${esc(sp.ph)}" value="${esc((p.social_links||{})[sp.key]||"")}"></div>`).join("")}
    </div>
    <div class="field"><label>${esc(t("pf_accent"))}</label>
      <div style="display:flex;gap:10px;align-items:center;">
        <input type="color" id="pf_bc" value="${esc(p.banner_color||"#E3BD6C")}" style="width:64px;height:38px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--surface);">
        <input type="color" id="pf_ac" value="${esc(p.accent_color||p.banner_color||"#A97F2C")}" style="width:64px;height:38px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--surface);">
        <div id="pf_grad_preview" style="flex:1;height:38px;border-radius:8px;border:1px solid var(--line);"></div>
      </div></div>
    <div class="field"><label>${esc(t("pf_upload_ava"))} <span class="hint">${esc(t("pf_ava_hint"))}</span></label>
      <div class="ava-edit" id="pfAvaEdit">
        <div class="img-pick-box ava-edit-box" id="pfAvaBox">
          ${curAvatar
            ? `${avatar({avatar:curAvatar,name:p.display_name||p.username},"ava-edit-img")}<button type="button" class="img-pick-x" id="pf_ava_clear" title="${esc(t("ed_remove"))}">✕</button>`
            : `<div class="img-pick-empty ava-edit-img" id="pf_ava_empty" title="${esc(t("ed_upload"))}">${UPLOAD_ICON_SVG}</div>`}
        </div>
        <div class="ava-edit-right">
          <div class="ava-edit-btns">
            <button type="button" class="btn" id="pf_ava_gen">🎨 ${esc(t("ig_generate"))}</button>
          </div>
          <div class="ava-url-row">
            <input type="text" id="pf_ava_url" placeholder="${esc(t("ed_ava_url_ph"))}" value="${esc(curAvatar&&curAvatar.startsWith('http')?curAvatar:'')}">
          </div>
        </div>
        <input type="file" id="pf_ava_file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </div></div>
    <div class="field"><label>${esc(t("pf_banner_img"))} <span class="hint">${esc(t("pf_banner_hint"))}</span></label>
      <div class="banner-edit" id="pf_banner_edit"${p.banner_img?` style="background-image:url('${esc(mediaURL(p.banner_img))}')"`:""}>
        <div class="banner-empty" id="pf_banner_empty"${p.banner_img?` style="display:none"`:""}>${UPLOAD_ICON_SVG}</div>
        <button type="button" class="img-pick-x" id="pf_banner_clear" title="${esc(t("ed_remove"))}"${p.banner_img?"":` style="display:none"`}>✕</button>
      </div>
      <div class="ava-edit-right" style="margin-top:10px;">
        <div class="ava-edit-btns">
          <button type="button" class="btn" id="pf_banner_gen">🎨 ${esc(t("ig_generate"))}</button>
        </div>
      </div>
      <input type="file" id="pf_banner_file" accept="image/png,image/jpeg,image/webp" hidden></div>
    <details class="stage-editor">
      <summary>${esc(t("pf_html_summary"))}</summary>
      <p class="hint">${esc(t("pf_html_sub"))}</p>
      <p class="hint">${esc(t("pf_html_no_external_links"))}</p>
      <p class="hint"><b>${esc(t("pf_html_placeholders"))}</b><br>
        <code>{{display_name}} {{bio}} {{rank}} {{title}} {{avatar_url}} {{banner_url}} {{character_count}} {{chat_count}} {{member_since}}</code></p>
      <p class="hint"><b>${esc(t("pf_html_title_label"))}</b> ${esc(t("pf_html_title_hint"))}</p>
      <p class="hint">${esc(t("pf_html_title_example"))}<br>
        <code>&lt;span class="my-title-badge"&gt;{{title}}&lt;/span&gt; &lt;!-- blank if no admin-approved title --&gt;</code><br>
        <code>&lt;style&gt;.my-title-badge{background:var(--accent);color:#000;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase}&lt;/style&gt;</code></p>
      <p class="hint"><b>${esc(t("pf_html_characters_label"))}</b> ${esc(t("pf_html_characters_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_links_label"))}</b> ${esc(t("pf_html_links_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_share_label"))}</b> ${esc(t("pf_html_share_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_edit_label"))}</b> ${esc(t("pf_html_edit_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_comments_label"))}</b> ${esc(t("pf_html_comments_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_block_label"))}</b> ${esc(t("pf_html_block_hint"))}</p>
      <p class="hint" style="color:var(--warn,#e0a800);"><b>${esc(t("pf_html_height_label"))}</b> ${esc(t("pf_html_height_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_vars_label"))}</b> ${esc(t("pf_html_vars_hint"))}</p>
      <p class="hint">${esc(t("pf_html_example"))} <code>&lt;style&gt;body{display:grid;grid-template-columns:200px 1fr;gap:24px;padding:24px}&lt;/style&gt; &lt;h1&gt;{{display_name}}&lt;/h1&gt;&lt;p&gt;{{bio}}&lt;/p&gt;{{share}} {{edit}} {{comments}} {{block}}&lt;h2&gt;Cast&lt;/h2&gt;{{characters}}</code></p>
      <input type="file" id="pf_html_file" accept=".html,.css,.txt" hidden>
      <div class="field" style="margin-top:10px;"><label>${esc(t("pf_html_code_label"))}</label>
        <div class="html-field-wrap" style="position:relative;">
          <div class="html-field-tools" style="position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:1;">
            <button type="button" class="tool" id="pf_html_upload_btn" title="${esc(t("pf_html_upload_btn"))}" aria-label="${esc(t("pf_html_upload_btn"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </button>
            <button type="button" class="tool" id="pf_html_download_btn" title="${esc(t("pf_html_download_btn"))}" aria-label="${esc(t("pf_html_download_btn"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button type="button" class="tool danger" id="pf_html_clear_btn" title="${esc(t("pf_html_clear_btn"))}" aria-label="${esc(t("pf_html_clear_btn"))}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
          <textarea id="pf_html_in" style="min-height:160px;font-family:var(--mono);font-size:12.5px;">${esc(p.profile_html||"")}</textarea>
        </div></div>
      <div class="field"><label>${esc(t("pf_html_preview_label"))}</label>
        <div class="pres-preview" id="pfHtmlPreview"></div></div>
    </details>
    <div class="modal-foot"><button class="btn" id="pf_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="pf_save">${esc(t("btn_save"))}</button></div>`, "modal-wide");
  $("#pf_cancel").onclick=closeModal;
  const _grad=()=>{ $("#pf_grad_preview").style.background=`linear-gradient(100deg,${$("#pf_bc").value},${$("#pf_ac").value})`; };
  $("#pf_bc").oninput=_grad; $("#pf_ac").oninput=_grad; _grad();

  const wirePfAvaEmpty=()=>{ const e=$("#pf_ava_empty"); if(e) e.onclick=()=>$("#pf_ava_file").click(); };
  const renderPfAvaBox=(src)=>{
    $("#pfAvaBox").innerHTML = src
      ? `<img class="ava ava-edit-img" src="${esc(src)}" alt=""><button type="button" class="img-pick-x" id="pf_ava_clear" title="${esc(t("ed_remove"))}">✕</button>`
      : `<div class="img-pick-empty ava-edit-img" id="pf_ava_empty" title="${esc(t("ed_upload"))}">${UPLOAD_ICON_SVG}</div>`;
    wirePfAvaClear(); wirePfAvaEmpty();
  };
  const refreshPfAva=()=> renderPfAvaBox(curAvatar ? mediaURL(curAvatar) : "");
  const wirePfAvaClear=()=>{ const b=$("#pf_ava_clear"); if(b) b.onclick=()=>{ curAvatar=""; $("#pf_ava_url").value=""; refreshPfAva(); }; };
  wirePfAvaClear(); wirePfAvaEmpty();
  const pfAvaUrlEl=$("#pf_ava_url");
  const applyPfAvaUrl=()=>{ const v=pfAvaUrlEl.value.trim(); if(v!==curAvatar){ curAvatar=v; refreshPfAva(); } };
  pfAvaUrlEl.addEventListener("blur", applyPfAvaUrl);
  pfAvaUrlEl.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); applyPfAvaUrl(); } });
  $("#pf_ava_file").onchange=()=>{
    const f=$("#pf_ava_file").files[0]; if(!f) return;
    const pending={display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value, title:$("#pf_title_in").value, title_status:p.title_status};
    if(f.type==="image/gif"){
      const fd=new FormData(); fd.append("file",f,f.name);
      api("/api/me/avatar",{method:"POST",body:fd}).then(r=>{
        toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:r.avatar}, onSave);
      }).catch(e=>{ errorToast("Upload failed: "+e.message); openProfileEditor({...p, ...pending}, onSave); });
      return;
    }
    openCropper(URL.createObjectURL(f), "1", 512, 512, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"avatar.jpg");
      try{ const r=await api("/api/me/avatar",{method:"POST",body:fd});
        toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:r.avatar}, onSave); }
      catch(e){ errorToast("Upload failed: "+e.message); openProfileEditor({...p, ...pending}, onSave); }
    });
  };
  $("#pf_ava_gen").onclick=()=>{
    const pending={display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value, title:$("#pf_title_in").value, title_status:p.title_status};
    openImageGenPickerModal(genBlob=>{
      openCropper(URL.createObjectURL(genBlob), "1", 512, 512, async blob=>{
        const fd=new FormData(); fd.append("file",blob,"avatar.jpg");
        try{ const r=await api("/api/me/avatar",{method:"POST",body:fd});
          toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:r.avatar}, onSave); }
        catch(e){ errorToast("Upload failed: "+e.message); openProfileEditor({...p, ...pending}, onSave); }
      });
    }, {positive:(pending.bio||"").slice(0,200)});
  };

  const pfBannerPreview=v=>{
    const el=$("#pf_banner_edit"); if(!el) return;
    el.style.backgroundImage = v ? `url('${v}')` : "";
    const has=!!v;
    $("#pf_banner_empty").style.display = has ? "none" : "";
    $("#pf_banner_clear").style.display = has ? "" : "none";
  };
  const wirePfBannerClear=()=>{ const b=$("#pf_banner_clear"); if(b) b.onclick=async ev=>{
    ev.stopPropagation();
    try{ await api("/api/me/profile", j("PUT",{banner_img:""})); pfBannerPreview(""); toast(t("pf_saved")); onSave(); }
    catch(e){ errorToast("Failed: "+e.message); }
  }; };
  wirePfBannerClear();
  $("#pf_banner_edit").onclick=e=>{ if(e.target.closest("#pf_banner_clear")) return; $("#pf_banner_file").click(); };
  $("#pf_banner_file").onchange=()=>{
    const f=$("#pf_banner_file").files[0]; if(!f) return;
    const pending={display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value, title:$("#pf_title_in").value, title_status:p.title_status};
    openCropper(URL.createObjectURL(f), "3", 1200, 400, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"banner.jpg");
      try{ const r=await api("/api/me/banner",{method:"POST",body:fd});
        toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:curAvatar, banner_img:r.banner_img}, onSave); }
      catch(e){ errorToast("Upload failed: "+e.message); openProfileEditor({...p, ...pending, avatar:curAvatar}, onSave); }
    });
  };
  $("#pf_banner_gen").onclick=()=>{
    const pending={display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value, title:$("#pf_title_in").value, title_status:p.title_status};
    openImageGenPickerModal(genBlob=>{
      openCropper(URL.createObjectURL(genBlob), "3", 1200, 400, async blob=>{
        const fd=new FormData(); fd.append("file",blob,"banner.jpg");
        try{ const r=await api("/api/me/banner",{method:"POST",body:fd});
          toast(t("pf_saved")); onSave(); openProfileEditor({...p, ...pending, avatar:curAvatar, banner_img:r.banner_img}, onSave); }
        catch(e){ errorToast("Upload failed: "+e.message); openProfileEditor({...p, ...pending, avatar:curAvatar}, onSave); }
      });
    }, {positive:(pending.bio||"").slice(0,200)});
  };

  const collectSocialLinks=()=>{
    const links={};
    SOCIAL_PLATFORMS.forEach(sp=>{ const v=$("#pf_soc_"+sp.key).value.trim(); if(v) links[sp.key]=v; });
    return links;
  };
  const renderPfHtmlPreview=()=>{
    const html=$("#pf_html_in").value;
    const box=$("#pfHtmlPreview"); if(!box) return;
    if(!html.trim()){ box.innerHTML=""; return; }
    const previewP={...p, display_name:$("#pf_dn").value, bio:$("#pf_bio_in").value,
      avatar:curAvatar, banner_img:p.banner_img, is_admin:p.is_admin, joined:p.joined,
      stats:p.stats, characters:p.characters};
    mountSandboxedHTML(box, substituteProfileTemplate(html, previewP, collectSocialLinks(), true));
  };
  let _pfHtmlT; $("#pf_html_in").addEventListener("input",()=>{ clearTimeout(_pfHtmlT); _pfHtmlT=setTimeout(renderPfHtmlPreview,400); });
  renderPfHtmlPreview();
  $("#pf_html_upload_btn").onclick=()=>$("#pf_html_file").click();
  $("#pf_html_file").onchange=()=>{
    const f=$("#pf_html_file").files[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=()=>{ $("#pf_html_in").value=reader.result; renderPfHtmlPreview(); };
    reader.readAsText(f);
    $("#pf_html_file").value="";
  };
  $("#pf_html_download_btn").onclick=()=>{
    const content=$("#pf_html_in").value;
    if(!content.trim()) return;
    const blob=new Blob([content], {type:"text/html"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`${(p.username||"profile").replace(/[^a-z0-9]+/gi,"-")}-profile.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  };
  $("#pf_html_clear_btn").onclick=async()=>{
    if(!$("#pf_html_in").value.trim()) return;
    if(!(await confirmAction($("#pf_html_clear_btn"), t("pf_html_clear_confirm"), t("btn_clear")))) return;
    $("#pf_html_in").value=""; renderPfHtmlPreview();
  };

  $("#pf_save").onclick=async()=>{
    const htmlIn=$("#pf_html_in").value;
    if(htmlIn.trim() && !htmlIn.includes("{{share}}")){
      toast(t("pf_html_share_required")); return;
    }
    if(htmlIn.trim() && !htmlIn.includes("{{edit}}")){
      toast(t("pf_html_edit_required")); return;
    }
    if(htmlIn.trim() && !htmlIn.includes("{{comments}}")){
      toast(t("pf_html_comments_required")); return;
    }
    if(htmlIn.trim() && !htmlIn.includes("{{block}}")){
      toast(t("pf_html_block_required")); return;
    }
    if(htmlIn.trim()){
      const badUrl=findExternalCardLink(htmlIn);
      if(badUrl){ toast(t("pf_html_external_link_found").replace("{url}", badUrl)); return; }
      // The sandboxed frame auto-sizes to fit content after load — forcing
      // html/body to height:100% traps everything inside the frame's tiny
      // pre-resize starting height, silently clipping the page (confirmed
      // real-world bug, not theoretical). Block save rather than let it
      // happen again.
      if(/\b(?:html|body)\s*\{[^}]*height\s*:\s*100%/i.test(htmlIn)){
        toast(t("pf_html_height_blocked")); return;
      }
    }
    try{
      await api("/api/me/profile", j("PUT",{display_name:$("#pf_dn").value.trim(),
        bio:$("#pf_bio_in").value, banner_color:$("#pf_bc").value, accent_color:$("#pf_ac").value,
        title:$("#pf_title_in").value, avatar:curAvatar, social_links:collectSocialLinks(),
        profile_html:$("#pf_html_in").value}));
      closeModal(); toast(t("pf_saved")); onSave();
    }catch(e){ errorToast("Failed: "+e.message); }
  };
}
// Reusable "generate instead of upload" modal — same generation UI as the
// standalone Image Gen page, but "Use this image" hands the final PNG back
// as a Blob instead of saving to the gallery, so callers can feed it straight
// into their existing upload flow (openCropper, FormData, etc.) exactly as if
// the user had picked a file, for anywhere an avatar/banner/pfp is uploaded.
async function openImageGenPickerModal(onBlob, opts={}){
  const {checkpoints, loras}=await getImagegenOptions();
  if(!checkpoints.length){ toast(t("img_gen_no_checkpoints")); return; }
  // Two independent locks. A locked checkpoint (setting a model's own preview
  // image) pins the model and suppresses LoRAs so the output shows that
  // checkpoint's native look, unskewed by any selection. A locked LoRA
  // (setting a LoRA's own preview image) only pins the LoRA — the admin still
  // picks whichever checkpoint to preview it against, same as a normal
  // generation, since a LoRA has no look of its own without a base model.
  const lockLora=opts.lockLora||null;
  const lockCkpt=opts.lockCheckpoint||null;
  // A locked sampler/scheduler pins that ONE algorithm axis (the point of the
  // preview: "a sample generated USING this sampler/scheduler") while the admin
  // still picks checkpoint/LoRA/prompt freely, since a sampler has no look of
  // its own without a full generation around it.
  const lockSampler=opts.lockSampler||null;
  const lockScheduler=opts.lockScheduler||null;
  const hideLora=opts.hideLoraPicker||!!lockCkpt||!!lockLora;
  // Only the free-form quick-generate use (no lock, no caller-supplied prompt)
  // remembers what was last generated with — the locked model/LoRA/sampler/
  // scheduler preview-setting flows always start fresh, since "prefill with
  // whatever I last generated" would fight the very thing they're locked to.
  const isGeneral=!lockCkpt && !lockLora && !lockSampler && !lockScheduler && !opts.positive && !opts.negative;
  let savedGen=null;
  if(isGeneral){ try{ savedGen=JSON.parse(localStorage.getItem("ig_admin_gen_state")||"null"); }catch(e){} }
  const lockedRow=(labelKey, name, previews)=>`<div class="field"><label>${esc(t(labelKey))}</label>
        <div class="ig-locked-ckpt"><span class="ig-tile-thumb ava mono sm">${esc((modelLabel(name,previews||{})||"?")[0].toUpperCase())}</span><span>${esc(modelLabel(name,previews||{}))}</span></div></div>`;
  const samplerField=lockSampler?lockedRow("ig_sampler", lockSampler, _samplerPreviews):"";
  const schedulerField=lockScheduler?lockedRow("ig_scheduler", lockScheduler, _schedulerPreviews):"";
  const ckptField=lockCkpt
    ? `<div class="field"><label>${esc(t("img_gen_checkpoint"))}</label>
        <div class="ig-locked-ckpt"><span class="ig-tile-thumb ava mono sm">${esc((modelLabel(lockCkpt,_checkpointPreviews||{})||"?")[0].toUpperCase())}</span><span>${esc(modelLabel(lockCkpt,_checkpointPreviews||{}))}</span></div></div>`
    : `<div class="field"><label>${esc(t("img_gen_checkpoint"))}</label><div id="ig_ckpt"></div></div>`;
  const loraField=hideLora
    ? (lockLora ? `<div class="field"><label>${esc(t("img_gen_lora"))}</label>
        <div class="ig-locked-ckpt"><span class="ig-tile-thumb ava mono sm">${esc((modelLabel(lockLora,_loraPreviews||{})||"?")[0].toUpperCase())}</span><span>${esc(modelLabel(lockLora,_loraPreviews||{}))}</span></div></div>` : "")
    : `<div class="field" id="ig_lora_field"><label>${esc(t("img_gen_lora"))}</label><div id="ig_lora"></div></div>`;
  openModal(`
    <div class="img-gen-head"><span class="img-gen-icon">🎨</span><h3>${esc(t("ig_picker_title"))}</h3></div>
    <div class="field-group">
      ${ckptField}
      ${loraField}
      ${samplerField}
      ${schedulerField}
    </div>
    <button type="button" class="ig-show-more" id="ig_upscaler_req_btn">${esc(t("ig_upscaler_request_link"))}</button>
    <div class="field" id="ig_ref_field"><label>${esc(t("img_gen_reference"))} <span class="hint">${esc(t("img_gen_reference_hint"))}</span></label>
      <div id="ig_ref"></div></div>
    <div class="hint" id="ig_arch_note" style="display:none;margin:-6px 0 14px;"></div>
    <div class="field"><label>${esc(t("img_gen_positive"))}</label>
      <textarea id="ig_positive" class="ig-autosize" rows="2" placeholder="${esc(t("ig_positive_ph"))}">${esc(opts.positive||(savedGen&&savedGen.positive)||IG_ADMIN_DEFAULT_POSITIVE)}</textarea>
      <div class="ig-anima-prompt-banner" id="ig_anima_prompt_banner" style="display:none;">${esc(t("ig_anima_prompt_hint"))}</div></div>
    <div class="field"><label>${esc(t("img_gen_negative"))}</label>
      <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("ig_negative_ph"))}">${esc(opts.negative||(savedGen&&savedGen.negative)||IG_ADMIN_DEFAULT_NEGATIVE)}</textarea></div>
    <div class="field" style="margin:0;">
      <label>${esc(t("ig_steps"))} <span class="hint" id="ig_steps_val">${(savedGen&&savedGen.steps)||IG_ADMIN_DEFAULT_STEPS}</span></label>
      <input type="range" id="ig_steps_in" min="1" max="60" step="1" value="${(savedGen&&savedGen.steps)||IG_ADMIN_DEFAULT_STEPS}">
      <div class="hint" style="margin-top:4px;" id="ig_steps_hint"></div>
    </div>
    <div class="modal-foot"><button class="btn" id="ig_pick_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ig_go">${esc(t("ig_generate"))}</button></div>
    <div id="igPreviewWrap" style="display:none;margin:20px 0;">
      <div class="ig-preview-box"><img id="igPreviewImg" alt=""></div>
      <div class="actions" id="igResultActions" style="display:none;">
        <button class="btn primary" id="ig_use">${esc(t("ig_use_image"))}</button>
        <button class="btn" id="ig_details">${esc(t("ig_details_btn"))}</button>
      </div>
    </div>`, null, {stack:true});
  $("#ig_pick_cancel").onclick=closeModal;
  $("#ig_upscaler_req_btn").onclick=()=>openUpscalerRequestModal();
  // The steps field auto-updates to a checkpoint's own saved override (Admin
  // → model edit → Default steps) whenever the checkpoint selection changes,
  // but only if the admin hasn't already hand-typed a different value here —
  // an explicit in-modal edit always wins over the stored per-model default.
  let stepsTouched=false;
  const applyStepsForCkpt=name=>{
    const override=(_checkpointPreviews||{})[name]?.default_steps;
    const hint=$("#ig_steps_hint"), input=$("#ig_steps_in"), val=$("#ig_steps_val");
    const animaDefault=isAnimaModel(name)?30:((savedGen&&savedGen.steps)||IG_ADMIN_DEFAULT_STEPS);
    if(override!=null){
      hint.textContent=t("ig_steps_model_default").replace("{n}",override);
      if(!stepsTouched){ input.value=override; val.textContent=override; }
    }else{
      hint.textContent="";
      if(!stepsTouched){ input.value=animaDefault; val.textContent=animaDefault; }
    }
  };
  // Each architecture needs its own field visibility: Anima has a real,
  // tested workflow (see imagegen.ANIMA_WORKFLOW) but doesn't support LoRAs
  // or a reference image, so those fields hide and a note explains the
  // recommended-defaults switch. Flux V2 is UI-only right now — no model
  // file exists to build/test a real workflow against yet (see
  // imagegen.py's ANIMA_WORKFLOW comment for why guessing at an untested
  // graph is worse than not building one) — so its fields hide too, plus a
  // clearer "not generatable yet" note, and runGenerate refuses to submit.
  const applyArchForCkpt=name=>{
    const cat=modelCategory(name,_checkpointPreviews||{});
    const loraField=$("#ig_lora_field"), refField=$("#ig_ref_field"), note=$("#ig_arch_note");
    // Anima LoRA support is fixed now — only Flux V2 (no real workflow to
    // test against yet, see below) still hides the LoRA field. The old
    // Anima note is gone entirely per explicit correction — its claim was
    // wrong. The sampler/scheduler/cfg values ARE still force-set to
    // ANIMA_DEFAULT_* below regardless of what's picked in the UI (unrelated
    // to this note removal, left as-is) — just nothing on screen claims it.
    if(loraField) loraField.style.display=cat==="flux_v2"?"none":"";
    if(refField) refField.style.display=cat==="flux_v2"?"none":"";
    if(note){
      note.style.display=cat==="flux_v2"?"":"none";
      note.textContent=cat==="flux_v2"?t("ig_flux_v2_note"):"";
    }
    const promptBanner=$("#ig_anima_prompt_banner");
    if(promptBanner) promptBanner.style.display="none";
  };
  const savedCkpt=savedGen&&savedGen.checkpoint&&checkpoints.includes(savedGen.checkpoint)?savedGen.checkpoint:null;
  const ckptSel=lockCkpt ? {value:lockCkpt}
    : mountCheckpointButton($("#ig_ckpt"), checkpoints,
        {previews:_checkpointPreviews||{}, value:savedCkpt||(checkpoints.includes(IG_ADMIN_DEFAULT_CHECKPOINT)?IG_ADMIN_DEFAULT_CHECKPOINT:undefined),
         onChange:v=>{ applyStepsForCkpt(v); applyArchForCkpt(v); }});
  applyStepsForCkpt(ckptSel.value);
  applyArchForCkpt(ckptSel.value);
  $("#ig_steps_in").addEventListener("input",e=>{ stepsTouched=true; $("#ig_steps_val").textContent=e.target.value; });
  const savedLoras=(savedGen&&savedGen.loras)||undefined;
  const loraPicker=lockLora ? {getSelected:()=>[{name:lockLora,strength:1.0}]}
    : hideLora ? {getSelected:()=>[]} : mountLoraButton($("#ig_lora"), loras, {previews:_loraPreviews||{}, value:savedLoras});
  const refPicker=mountReferenceImagePicker($("#ig_ref"));
  [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta));
    ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0));
    autosize(ta);
  });

  let lastImage=null, genAbort=null, lastGenBody=null;
  const resetGoBtn=()=>{ const b=$("#ig_go"); b.disabled=false; b.classList.remove("stop"); b.textContent=t("ig_generate"); b.onclick=runGenerate; };
  const stopGenerate=()=>{
    if(genAbort){ try{ genAbort.abort(); }catch(e){} genAbort=null; }
    fetch(API+"/api/imagegen/standalone/stream/stop",{method:"POST"}).catch(()=>{});
    resetGoBtn();
  };
  const runGenerate=async()=>{
    const positive=$("#ig_positive").value.trim();
    if(!positive){ toast(t("ig_positive_ph")); return; }
    if(modelCategory(ckptSel.value,_checkpointPreviews||{})==="flux_v2"){ toast(t("ig_flux_v2_note")); return; }
    genAbort=new AbortController();
    const goBtn=$("#ig_go"); goBtn.classList.add("stop"); goBtn.textContent=t("ig_stop"); goBtn.onclick=stopGenerate;
    $("#igResultActions").style.display="none";
    $("#igPreviewWrap").style.display="";
    const anima=isAnimaModel(ckptSel.value);
    const body={positive, negative:$("#ig_negative").value.trim(), checkpoint:ckptSel.value,
      architecture:anima?"anima":"sdxl",
      // Anima LoRA support is fixed now — no longer force-emptied.
      loras:loraPicker.getSelected(),
      reference_image:refPicker.getDataUrl(), denoise:refPicker.getDenoise()};
    body.steps=parseInt($("#ig_steps_in").value,10)||IG_ADMIN_DEFAULT_STEPS;
    body.cfg=anima?ANIMA_DEFAULT_CFG:IG_ADMIN_DEFAULT_CFG;
    body.sampler=anima?ANIMA_DEFAULT_SAMPLER:(lockSampler||IG_ADMIN_DEFAULT_SAMPLER);
    body.scheduler=anima?ANIMA_DEFAULT_SCHEDULER:(lockScheduler||IG_ADMIN_DEFAULT_SCHEDULER);
    if(isGeneral){
      try{ localStorage.setItem("ig_admin_gen_state", JSON.stringify({
        checkpoint:body.checkpoint, positive:body.positive, negative:body.negative, steps:body.steps, loras:body.loras
      })); }catch(e){}
    }
    try{
      const res=await fetch(API+"/api/imagegen/standalone/stream",{method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:genAbort.signal});
      if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
      await sseEvents(res, ev=>{
        if(ev.type==="preview"||ev.type==="done"){ $("#igPreviewImg").src=ev.image; }
        if(ev.type==="done"){ lastImage=ev.image; lastGenBody=body; $("#igResultActions").style.display=""; }
        if(ev.type==="error"){ errorToast("Image generation failed: "+ev.message); }
      });
    }catch(e){ if(e.name!=="AbortError") errorToast("Image generation failed: "+e.message); }
    genAbort=null;
    resetGoBtn();
  };
  $("#ig_go").onclick=runGenerate;
  $("#ig_details").onclick=()=>{
    if(!lastGenBody) return;
    const b=lastGenBody;
    const rows=[
      [t("ig_details_checkpoint"), b.checkpoint],
      [t("ig_details_architecture"), b.architecture],
      [t("ig_details_loras"), (b.loras&&b.loras.length)?b.loras.map(l=>`${l.name} (${l.strength})`).join(", "):"—"],
      [t("ig_details_sampler"), b.sampler], [t("ig_details_scheduler"), b.scheduler],
      [t("ig_details_steps"), b.steps], [t("ig_details_cfg"), b.cfg],
      [t("ig_details_denoise"), b.reference_image?b.denoise:"—"],
    ];
    openModal(`<h3>${esc(t("ig_details_title"))}</h3>
      <div class="field"><label>${esc(t("img_gen_positive"))}</label>
        <textarea readonly rows="3" style="resize:vertical;">${esc(b.positive)}</textarea></div>
      <div class="field"><label>${esc(t("img_gen_negative"))}</label>
        <textarea readonly rows="2" style="resize:vertical;">${esc(b.negative||"")}</textarea></div>
      <table class="ig-details-table">${rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join("")}</table>
      <div class="modal-foot"><button class="btn primary" id="ig_details_close">${esc(t("btn_close"))}</button></div>`,
      null, {stack:true});
    document.getElementById("ig_details_close").onclick=closeModal;
  };
  $("#ig_use").onclick=async()=>{
    if(!lastImage) return;
    const useBtn=$("#ig_use"); useBtn.disabled=true;
    try{
      const blob=await (await fetch(lastImage)).blob();
      closeModal();
      onBlob(blob);
    }catch(e){ errorToast("Could not use that image: "+e.message); useBtn.disabled=false; }
  };
}
async function viewImages(main, initialTab){
  const {checkpoints, loras}=await getImagegenOptions();
  let tab=initialTab||"generate";
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("nav_images"))}</div><h1 class="page">${esc(t("images_title"))}</h1>
    <div class="page-sub">${esc(t("images_sub"))}</div>
    <div class="seg lib-tabs images-tabs" id="imagesTabs" style="margin:16px 0 22px;">
      <button type="button" class="seg-btn" data-tab="generate"><b>${esc(t("images_tab_generate"))}</b></button>
      <button type="button" class="seg-btn" data-tab="gallery"><b>${esc(t("images_tab_gallery"))}</b></button>
      <button type="button" class="seg-btn" data-tab="community"><b>${esc(t("images_tab_community"))}</b></button>
    </div>
    <div id="imagesBody"></div>
  </div>`;
  const body=$("#imagesBody");
  const setActive=()=>main.querySelectorAll("#imagesTabs .seg-btn").forEach(b=>b.classList.toggle("on", b.dataset.tab===tab));
  // Real per-tab URL (/images/generate, /images/gallery, /images/community)
  // so refreshing or sharing a link lands back on the same tab instead of
  // always bouncing to Generate — replaceState, not pushState, so switching
  // tabs doesn't spam browser history with one entry per click.
  const syncUrl=()=>{
    const path="/images/"+tab;
    if(location.pathname!==path) history.replaceState(null,"",path+location.search);
  };
  const render=()=>{
    setActive();
    syncUrl();
    if(tab==="generate") return renderGenerateTab(body, checkpoints, loras);
    if(tab==="gallery") return renderChatGalleryTab(body);
    return renderCommunityTab(body);
  };
  main.querySelectorAll("#imagesTabs .seg-btn").forEach(b=>b.onclick=()=>{ tab=b.dataset.tab; render(); });
  render();
}

function igMasonryCard(s, {owner=false, community=false, ownerInfo=null}={}){
  // My Creations normally never blurs your own images (you already know what
  // you generated) — but Privacy Mode exists specifically to protect a
  // shared/public screen, and that has to override "it's just you looking at
  // your own stuff" too, or the whole point of the toggle falls apart the
  // moment someone opens their own gallery.
  const nb=(community||PRIVACY_MODE)?nsfwCls({is_explicit:s.is_explicit}):"";
  const shared=!!s.is_public;
  let tools="";
  if(owner){
    const shareWait=!shared && !s.classified;
    const shareTitle=shared?t("ig_unshare"):shareWait?t("ig_share_wait_label"):t("ig_share");
    tools=`<div class="ig-mcard-tools">
      <button class="tool ${shared?"":"primary"}" data-act="ig-share" ${shareWait?"disabled":""} title="${esc(shareWait?t("ig_share_wait"):shareTitle)}" aria-label="${esc(shareTitle)}">${SHARE_ICON_SVG}</button>
      <button class="tool danger" data-act="ig-saved-del" title="${esc(t("tool_delete"))}" aria-label="${esc(t("tool_delete"))}">${TRASH_ICON_SVG}</button>
    </div>`;
  } else if(community && ownerInfo){
    tools=`<div class="ig-mcard-owner">${avatar({avatar:ownerInfo.owner_avatar, name:ownerInfo.owner_display_name}, "ig-owner-ava")}<span>${esc(t("ig_community_by"))} ${esc(ownerInfo.owner_display_name||ownerInfo.owner_username||"")}</span></div>`;
  }
  const badge=(owner&&shared)?`<span class="ig-shared-badge">${esc(t("ig_shared_badge"))}</span>`:"";
  // The rating badge is only meaningful where it protects OTHER viewers from
  // unwanted content (the public Community feed) — in "My Creations" it's
  // just the owner looking at their own images, so it's noise, and worse, it
  // can show a stale pre-classification default badge for a few seconds
  // right after generating since classification runs in the background.
  return `<div class="ig-mcard" data-iid="${esc(s.id)}">
    <div class="ig-mthumb" data-act="ig-view"><img class="${nb.trim()}" src="${esc(mediaURL(s.image))}" alt="">${ratingBadge(s)}${badge}</div>
    ${tools}
  </div>`;
}

function igSectionHead(key, label){
  return `<button type="button" class="ig-sec-head" data-sec="${esc(key)}">
    <span>${esc(label)}</span>
    <svg class="ig-sec-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
  </button>`;
}
function wireIgSections(root){
  root.querySelectorAll(".ig-sec").forEach(sec=>{
    const key=sec.dataset.key;
    const def=sec.dataset.default==="open"?"false":"true";
    const collapsed=store.get("igsec:"+key, def)==="true";
    sec.classList.toggle("collapsed", collapsed);
    const head=sec.querySelector(".ig-sec-head");
    if(!head) return;
    head.setAttribute("aria-expanded", collapsed?"false":"true");
    head.onclick=()=>{
      const c=sec.classList.toggle("collapsed");
      store.set("igsec:"+key, c?"true":"false");
      head.setAttribute("aria-expanded", c?"false":"true");
    };
  });
}
async function renderGenerateTab(body, checkpoints, loras){
  let savedCreateGen=null;
  try{ savedCreateGen=JSON.parse(localStorage.getItem("ig_create_gen_state")||"null"); }catch(e){}
  const saved=await api("/api/imagegen/standalone").catch(()=>[]);
  let savedById=new Map(saved.map(s=>[s.id,s]));
  const masonry=list=>list.length?`<div class="ig-creations-grid">${list.map(s=>igMasonryCard(s,{owner:true})).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("ig_saved_empty"))}</div></div>`;
  body.innerHTML=`<div class="ig-layout">
    <aside class="ig-panel">
      <div class="ig-panel-title">${esc(t("ig_panel_title"))}</div>
      <div class="ig-sec" data-key="model">${igSectionHead("model", t("ig_model"))}
        <div class="ig-sec-body"><div id="ig_ckpt"></div></div></div>
      <div class="hint" id="ig_create_arch_note" style="display:none;margin:-8px 0 14px;"></div>
      <div class="ig-sec" data-key="lora" id="ig_lora_sec">${igSectionHead("lora", t("ig_lora_section"))}
        <div class="ig-sec-body"><div id="ig_lora"></div></div></div>
      <div id="ig_aspectres"></div>
      <div class="ig-sec" data-key="sampler">${igSectionHead("sampler", t("ig_sampler_section"))}
        <div class="ig-sec-body"><div id="ig_sampler"></div></div></div>
      <div class="ig-sec" data-key="steps">${igSectionHead("steps", t("ig_steps"))}
        <div class="ig-sec-body">
          <div class="field" style="margin:0;">
            <label>${esc(t("ig_steps"))} <span class="hint" id="igStepsVal">${(savedCreateGen&&savedCreateGen.steps)||20}</span></label>
            <input type="range" id="igSteps" min="1" max="60" step="1" value="${(savedCreateGen&&savedCreateGen.steps)||20}">
            <div class="hint" style="margin-top:4px;">${esc(t("ig_steps_hint"))}</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="cfg">${igSectionHead("cfg", t("ig_cfg"))}
        <div class="ig-sec-body">
          <div class="field" style="margin:0;">
            <label>${esc(t("ig_cfg"))} <span class="hint" id="igCfgVal">${(savedCreateGen&&savedCreateGen.cfg)||7}</span></label>
            <input type="range" id="igCfg" min="1" max="20" step="0.5" value="${(savedCreateGen&&savedCreateGen.cfg)||7}">
            <div class="hint" style="margin-top:4px;">${esc(t("ig_cfg_hint"))}</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="reference" id="ig_ref_sec">${igSectionHead("reference", t("img_gen_reference"))}
        <div class="ig-sec-body"><div id="ig_ref" title="${esc(t("img_gen_reference_hint"))}"></div></div></div>
      <div class="field"><label>${esc(t("img_gen_positive"))}</label>
        <textarea id="ig_positive" class="ig-autosize" rows="1" placeholder="${esc(t("ig_positive_ph"))}">${esc((savedCreateGen&&savedCreateGen.positive)||"")}</textarea>
        <div class="hint" style="margin-top:4px;">${esc(t("ig_prompt_hint"))}</div>
        <div class="ig-anima-prompt-banner" id="ig_create_anima_prompt_banner" style="display:none;">${esc(t("ig_anima_prompt_hint"))}</div></div>
      <div class="field"><label>${esc(t("img_gen_negative"))}</label>
        <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("ig_negative_ph"))}">${esc((savedCreateGen&&savedCreateGen.negative)||"")}</textarea>
        <div class="hint" style="margin-top:4px;">${esc(t("ig_prompt_hint"))}</div></div>
      <div class="actions"><button class="btn primary" id="ig_go">${esc(t("ig_generate"))}</button></div>
    </aside>
    <aside class="ig-preview-pane">
      <div class="ig-panel-title">${esc(t("ig_preview_title"))}</div>
      <div class="ig-unsaved-warning">⚠ ${esc(t("ig_unsaved_warning"))}</div>
      <div id="igPreviewWrap" class="ig-preview-empty">
        <div class="ig-preview-box">
          <img id="igPreviewImg" alt="">
          <button type="button" class="ig-detail-download" id="igPreviewZoom" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
          <div id="igResultActions" style="display:none;">
            <button type="button" class="ig-detail-download" id="ig_upscale" style="right:140px;" title="${esc(t("ig_upscale"))}" aria-label="${esc(t("ig_upscale"))}">${SPARKLE_ICON_SVG}</button>
            <button type="button" class="ig-detail-download" id="ig_save" style="right:96px;" title="${esc(t("ig_save"))}" aria-label="${esc(t("ig_save"))}">${SAVE_ICON_SVG}</button>
            <button type="button" class="ig-detail-download" id="ig_discard" style="right:52px;" title="${esc(t("ig_discard"))}" aria-label="${esc(t("ig_discard"))}">${TRASH_ICON_SVG}</button>
          </div>
        </div>
      </div>
    </aside>
    <section class="ig-feed">
      <div class="section-heading" style="margin-bottom:16px;">${esc(t("ig_my_creations"))}</div>
      <div id="igSavedGrid">${masonry(saved)}</div>
    </section>
  </div>`;
  const applyCreateArch=name=>{
    const note=$("#ig_create_arch_note");
    // No Anima note here anymore either (see applyArchForCkpt above for why)
    // — the LoRA section already stays visible for Anima since that support
    // was fixed.
    if(note){ note.style.display="none"; note.textContent=""; }
    const promptBanner=$("#ig_create_anima_prompt_banner");
    if(promptBanner) promptBanner.style.display="none";
  };
  // Persist the checkpoint choice the moment it's picked, not only after a
  // successful generate — otherwise selecting a model and reloading before
  // ever clicking Generate silently reverts to whichever model was actually
  // last generated with, which reads as "my selection didn't save."
  const persistCreateFields=patch=>{
    let state={};
    try{ state=JSON.parse(localStorage.getItem("ig_create_gen_state")||"{}")||{}; }catch(e){}
    Object.assign(state, patch);
    try{ localStorage.setItem("ig_create_gen_state", JSON.stringify(state)); }catch(e){}
  };
  const persistCreateCkpt=name=>persistCreateFields({checkpoint:name});
  const savedCreateCkpt=savedCreateGen&&savedCreateGen.checkpoint&&checkpoints.includes(savedCreateGen.checkpoint)?savedCreateGen.checkpoint:undefined;
  const ckptSel=mountModelGrid($("#ig_ckpt"), checkpoints, {previews:_checkpointPreviews||{}, value:savedCreateCkpt,
    onChange:name=>{ applyCreateArch(name); persistCreateCkpt(name); }});
  applyCreateArch(ckptSel.value);
  $("#igPreviewZoom").onclick=()=>{
    const src=$("#igPreviewImg").src;
    if(!src) return;
    openModal(`<img src="${esc(src)}" alt="" style="width:100%;border-radius:10px;display:block;">`, null, {stack:true});
  };
  const loraPicker=mountLoraGrid($("#ig_lora"), loras, {previews:_loraPreviews||{}, value:savedCreateGen&&savedCreateGen.loras});
  const aspectRes=mountAspectResolution($("#ig_aspectres"));
  const samplerPickers=await mountSamplerPickers($("#ig_sampler"), {
    savedSampler:savedCreateGen&&savedCreateGen.sampler, savedScheduler:savedCreateGen&&savedCreateGen.scheduler,
    onChange:({sampler,scheduler})=>persistCreateFields({sampler, scheduler})});
  const refPicker=mountReferenceImagePicker($("#ig_ref"));
  wireIgSections(body);
  const stepsInput=$("#igSteps");
  const getSteps=()=>parseInt(stepsInput.value,10)||20;
  stepsInput.oninput=e=>{ $("#igStepsVal").textContent=e.target.value; persistCreateFields({steps:parseInt(e.target.value,10)}); };
  const cfgInput=$("#igCfg");
  const getCfg=()=>parseFloat(cfgInput.value)||7;
  cfgInput.oninput=e=>{ $("#igCfgVal").textContent=e.target.value; persistCreateFields({cfg:parseFloat(e.target.value)}); };
  [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta));
    ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0));
    autosize(ta);
  });
  let lastImage=null, genAbort=null, lastWasImg2Img=false;
  const resetGoBtn=()=>{ const b=$("#ig_go"); b.disabled=false; b.classList.remove("stop"); b.textContent=t("ig_generate"); b.onclick=runGenerate; };
  const stopGenerate=()=>{
    if(genAbort){ try{ genAbort.abort(); }catch(e){} genAbort=null; }
    fetch(API+"/api/imagegen/standalone/stream/stop",{method:"POST"}).catch(()=>{});
    if(!lastImage){ $("#igPreviewImg").src=""; $("#igPreviewWrap").classList.add("ig-preview-empty"); }
    resetGoBtn();
  };
  const runGenerate=async()=>{
    const positive=$("#ig_positive").value.trim();
    if(!positive){ toast(t("ig_positive_ph")); return; }
    genAbort=new AbortController();
    const goBtn=$("#ig_go"); goBtn.classList.add("stop"); goBtn.textContent=t("ig_stop"); goBtn.onclick=stopGenerate;
    $("#igResultActions").style.display="none";
    const dims=aspectRes.getSize();
    // Anima is a different ComfyUI graph entirely (UNETLoader, not
    // CheckpointLoaderSimple) — sending it through as a plain "sdxl" request
    // (the default) makes ComfyUI reject it outright, since a UNet-only file
    // can't load as a full checkpoint. LoRAs now work for Anima too (fixed),
    // same as reference images (img2img).
    const anima=isAnimaModel(ckptSel.value);
    const body2={positive, negative:$("#ig_negative").value.trim(),
      checkpoint:ckptSel.value, architecture:anima?"anima":"sdxl",
      loras:loraPicker.getSelected(),
      reference_image:refPicker.getDataUrl(), denoise:refPicker.getDenoise(),
      width:dims.width, height:dims.height,
      sampler:anima?ANIMA_DEFAULT_SAMPLER:samplerPickers.sampler,
      scheduler:anima?ANIMA_DEFAULT_SCHEDULER:samplerPickers.scheduler,
      steps:getSteps(), cfg:getCfg()};
    try{ localStorage.setItem("ig_create_gen_state", JSON.stringify({
      checkpoint:body2.checkpoint, positive:body2.positive, negative:body2.negative, steps:body2.steps, cfg:getCfg(), loras:body2.loras
    })); }catch(e){}
    recordCheckpointUsage(body2.checkpoint);
    (body2.loras||[]).forEach(l=>_recordPickerUsage("ig_lora_usage", l.name));
    _recordPickerUsage("ig_sampler_usage", body2.sampler);
    _recordPickerUsage("ig_scheduler_usage", body2.scheduler);
    try{
      const res=await fetch(API+"/api/imagegen/standalone/stream",{method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify(body2), signal:genAbort.signal});
      if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
      await sseEvents(res, ev=>{
        if(ev.type==="preview"||ev.type==="done"){ $("#igPreviewWrap").classList.remove("ig-preview-empty"); $("#igPreviewImg").src=ev.image; }
        if(ev.type==="done"){ lastImage=ev.image; lastWasImg2Img=!!body2.reference_image; $("#igResultActions").style.display=""; }
        if(ev.type==="error"){ errorToast("Image generation failed: "+ev.message); }
      });
    }catch(e){ if(e.name!=="AbortError") errorToast("Image generation failed: "+e.message); }
    genAbort=null;
    resetGoBtn();
  };
  $("#ig_go").onclick=runGenerate;
  $("#ig_discard").onclick=()=>{
    lastImage=null; $("#igPreviewImg").src=""; $("#igResultActions").style.display="none";
    $("#igPreviewWrap").classList.add("ig-preview-empty");
  };
  $("#ig_upscale").onclick=async()=>{
    if(!lastImage) return;
    const btn=$("#ig_upscale");
    const icon=btn.innerHTML;
    btn.disabled=true; btn.textContent="…";
    try{
      const res=await api("/api/imagegen/upscale", j("POST",{image:lastImage}));
      lastImage=res.image;
      $("#igPreviewImg").src=lastImage;
    }catch(e){ errorToast(t("ig_upscale_failed")+": "+e.message); }
    btn.disabled=false; btn.innerHTML=icon;
  };
  // Classification runs as a background task (~1-2s) after the save request
  // already returned, so the grid's initial render always shows classified:
  // false / "Rating…" — poll briefly afterward and re-render once it flips,
  // instead of leaving the Share button stuck disabled until a full reload.
  const pollUntilClassified=async(iid, attemptsLeft=8)=>{
    if(attemptsLeft<=0) return;
    await new Promise(r=>setTimeout(r,1000));
    const refreshed=await api("/api/imagegen/standalone").catch(()=>null);
    if(!refreshed) return;
    const still=refreshed.find(s=>s.id===iid);
    if(!still) return;
    savedById.set(iid, still);
    if(still.classified){
      // Only swap the one card that actually changed, not the whole grid —
      // replacing everything every second was disruptive to scroll position
      // and felt like the page was lagging while this quietly polled.
      const card=$(`.ig-mcard[data-iid="${iid}"]`);
      if(card) card.replaceWith(el(igMasonryCard(still,{owner:true})));
      return;
    }
    pollUntilClassified(iid, attemptsLeft-1);
  };
  $("#ig_save").onclick=async()=>{
    if(!lastImage) return;
    try{
      const rec=await api("/api/imagegen/standalone/save", j("POST",{image:lastImage,
        positive:$("#ig_positive").value.trim(), negative:$("#ig_negative").value.trim(),
        checkpoint:ckptSel.value, loras:loraPicker.getSelected(),
        sampler:samplerPickers.sampler, scheduler:samplerPickers.scheduler, steps:getSteps(),
        is_img2img:lastWasImg2Img}));
      toast(t("ig_saved_toast"));
      // The save response already IS the full record — render it straight
      // away instead of waiting on a second round-trip just to re-fetch the
      // same list, which is what made this feel slow to respond.
      saved.unshift(rec);
      savedById.set(rec.id, rec);
      $("#igSavedGrid").innerHTML=masonry(saved);
      if(rec && rec.id) pollUntilClassified(rec.id);
    }catch(e){ errorToast(t("ig_save_failed")+": "+e.message); }
  };
  $("#igSavedGrid").addEventListener("click", e=>{
    const card=e.target.closest(".ig-mcard"); if(!card) return;
    const iid=card.dataset.iid; const s=savedById.get(iid);
    if(e.target.closest("[data-act='ig-view']")){
      if(s) imageDetailModal({id:s.id, image:s.image, image_positive:s.positive, image_negative:s.negative,
        image_ts:s.created, checkpoint:s.checkpoint, loras:s.loras, is_explicit:s.is_explicit, human_reviewed:s.human_reviewed,
        sampler:s.sampler, scheduler:s.scheduler, steps:s.steps, is_img2img:s.is_img2img}, {ownerId:ME?ME.id:null, shareable:!!s.is_public, reportable:true});
      return;
    }
    if(e.target.closest("[data-act='ig-share']")){
      if(!s) return;
      if(s.is_public){
        api("/api/imagegen/standalone/"+iid+"/unshare",{method:"POST"}).then(r=>{
          s.is_public=false; s.is_explicit=false; toast(t("ig_unshared_toast"));
          card.replaceWith(el(igMasonryCard(s,{owner:true})));
        }).catch(err=>errorToast(err.message));
      } else {
        shareImageModal(iid, s.is_explicit, res=>{ s.is_public=true; s.is_explicit=res.is_explicit;
          card.replaceWith(el(igMasonryCard(s,{owner:true}))); });
      }
      return;
    }
    const btn=e.target.closest("[data-act='ig-saved-del']"); if(!btn) return;
    (async()=>{
      if(!(await confirmAction(btn, t("gallery_delete_confirm_msg")))) return;
      try{ await api("/api/imagegen/standalone/"+iid,{method:"DELETE"}); card.remove(); }
      catch(err){ errorToast(t("gallery_delete_failed")+": "+err.message); }
    })();
  });
}

function shareImageModal(iid, alreadyExplicit, onShared){
  // The AI classification is authoritative and can never be downgraded here
  // (enforced server-side too) — an already-NSFW image shares as NSFW no
  // matter what, so there's nothing to toggle; only offer the checkbox when
  // the classifier called it SFW, letting the creator self-flag something it
  // may have missed. Disputing a wrong NSFW call goes through "Lodge a
  // report", not this modal.
  const matureField=alreadyExplicit
    ? `<p class="hint" style="margin:8px 0 14px;">${esc(t("ig_share_already_nsfw"))}</p>`
    : `<label class="switch"><input type="checkbox" id="ig_share_mature"> ${esc(t("ig_share_mature"))}</label>`;
  openModal(`<h3>${esc(t("ig_share_title"))}</h3>
    <p class="hint" style="margin:8px 0 14px;">${esc(t("ig_share_body"))}</p>
    ${matureField}
    <div class="modal-foot"><button class="btn" id="ig_share_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ig_share_go">${esc(t("ig_share_confirm"))}</button></div>`);
  $("#ig_share_cancel").onclick=closeModal;
  $("#ig_share_go").onclick=async()=>{
    const matureEl=$("#ig_share_mature");
    const is_explicit=matureEl?matureEl.checked:false;
    try{
      const rec=await api("/api/imagegen/standalone/"+iid+"/share", j("POST",{is_explicit}));
      closeModal(); toast(t("ig_shared_toast")); onShared(rec);
    }catch(e){ errorToast(e.message); }
  };
}

async function renderChatGalleryTab(body){
  const images=await api("/api/me/images").catch(()=>[]);
  const bySession=new Map();
  images.forEach(img=>{
    if(!bySession.has(img.sid)) bySession.set(img.sid, []);
    bySession.get(img.sid).push(img);
  });
  const entryHTML=(sid, imgs)=>{
    const first=imgs[0];
    return `<div class="codex-entry">
      <div class="codex-entry-head">
        ${avatar({avatar:first.char_avatar, name:first.char_name, is_explicit:first.is_explicit, char_owner_id:first.char_owner_id}, "codex-entry-ava")}
        <div class="codex-entry-title">
          <a href="/chat/${esc(sid)}">${esc(first.char_name||t("gallery_open_chat"))}</a>
          <div class="codex-entry-sub">${esc(first.session_title||"")}</div>
        </div>
        <span class="codex-entry-count">${imgs.length}</span>
      </div>
      <div class="ig-chatgallery-grid">${imgs.map(img=>`
        <div class="ig-mcard" data-mid="${esc(img.mid)}">
          <div class="ig-mthumb" data-act="gallery-view"><img class="${nsfwCls(img).trim()}" src="${esc(mediaURL(img.image))}" alt="">${ratingBadge(img)}</div>
          ${img.scene?`<div class="gallery-scene" data-act="gallery-view">${esc(img.scene)}</div>`:""}
          <div class="ig-mcard-tools"><button class="tool danger" data-act="gallery-del">${esc(t("tool_delete"))}</button></div>
        </div>`).join("")}</div>
    </div>`;
  };
  const imagesById=new Map(images.map(img=>[img.mid, img]));
  body.innerHTML=bySession.size
    ? `<div class="codex" id="galleryGrid">${[...bySession.entries()].map(([sid,imgs])=>entryHTML(sid,imgs)).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("gallery_empty"))}</div></div>`;
  $("#galleryGrid")?.addEventListener("click", e=>{
    const viewEl=e.target.closest("[data-act='gallery-view']");
    if(viewEl){ const mid=viewEl.closest(".ig-mcard").dataset.mid; const img=imagesById.get(mid); if(img) imageDetailModal(img); return; }
    const btn=e.target.closest("[data-act='gallery-del']"); if(!btn) return;
    const card=btn.closest(".ig-mcard"); const mid=card.dataset.mid;
    if(btn.dataset.confirming){ return; }
    btn.dataset.confirming="1"; btn.textContent=t("gallery_delete_confirm");
    const timer=setTimeout(()=>{ delete btn.dataset.confirming; btn.textContent=t("tool_delete"); }, 3000);
    btn.onclick=async()=>{
      clearTimeout(timer);
      try{ await api("/api/me/images/"+mid, {method:"DELETE"}); card.remove(); toast(t("gallery_deleted"));
        if(!card.closest(".ig-chatgallery-grid").children.length) renderChatGalleryTab(body); }
      catch(err){ errorToast(t("gallery_delete_failed")+": "+err.message); }
    };
  });
}

async function renderCommunityTab(body){
  const imgs=await api("/api/imagegen/community").catch(()=>[]);
  const byId=new Map(imgs.map(s=>[s.id,s]));
  body.innerHTML=imgs.length
    ? `<div class="ig-masonry" id="igCommunityGrid">${imgs.map(s=>igMasonryCard(s,{community:true, ownerInfo:s})).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("ig_community_empty"))}</div></div>`;
  $("#igCommunityGrid")?.addEventListener("click", e=>{
    const card=e.target.closest(".ig-mcard"); if(!card) return;
    if(!e.target.closest("[data-act='ig-view']")) return;
    const s=byId.get(card.dataset.iid); if(!s) return;
    if(!nsfwCanShow({is_explicit:s.is_explicit})) return;
    imageDetailModal({id:s.id, image:s.image, image_positive:s.positive, image_negative:s.negative,
      image_ts:s.created, checkpoint:s.checkpoint, loras:s.loras, is_explicit:s.is_explicit, human_reviewed:s.human_reviewed,
      sampler:s.sampler, scheduler:s.scheduler, steps:s.steps, is_img2img:s.is_img2img},
      {owner:{name:s.owner_display_name||s.owner_username, username:s.owner_username, avatar:s.owner_avatar}, ownerId:s.user_id, shareable:true, reportable:true});
  });
}

function imageDetailModal(img, opts={}){
  const ts = img.image_ts || img.ts;
  const when = ts ? new Date(ts*1000).toLocaleString() : "";
  const tagRow=(tags, cls, label)=>{
    const list=(tags||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!list.length) return "";
    return `<div class="lore-entry-label">${esc(label)}</div>
      <div class="ig-tags-row ig-tags-row-copy" data-tags="${esc(tags)}">
        <span class="ig-tags-label ${cls==='pos'?'ig-tags-pos':'ig-tags-neg'}">${cls==='pos'?'+':'−'}</span>
        ${list.map(tg=>`<span class="ig-tag ${cls==='pos'?'ig-tag-pos':'ig-tag-neg'}">${esc(tg)}</span>`).join("")}
        <button type="button" class="tool" data-act="copy-tags">${esc(t("gallery_copy_tags"))}</button>
      </div>`;
  };
  const ownerRow=opts.owner
    ? (opts.owner.username
        ? `<a href="/u/${esc(encodeURIComponent(opts.owner.username))}" class="ig-detail-owner" data-owner-link>${avatar({avatar:opts.owner.avatar, name:opts.owner.name}, "ig-owner-ava")}<span>${esc(t("ig_community_by"))} ${esc(opts.owner.name||"")}</span></a>`
        : `<div class="ig-detail-owner">${avatar({avatar:opts.owner.avatar, name:opts.owner.name}, "ig-owner-ava")}<span>${esc(t("ig_community_by"))} ${esc(opts.owner.name||"")}</span></div>`)
    : "";
  const loraList=(img.loras||[]).filter(l=>l && l.name);
  const genInfoRow=(img.checkpoint || loraList.length || img.sampler || img.scheduler) ? `
    <div class="ig-gen-info">
      ${img.checkpoint?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_model_label"))}</span> ${esc(img.checkpoint)}</div>`:""}
      ${img.id?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_type_label"))}</span> ${esc(img.is_img2img?t("ig_gen_type_img2img"):t("ig_gen_type_txt2img"))}</div>`:""}
      ${loraList.length?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_loras_label"))}</span> ${esc(loraList.map(l=>`${l.name} (${l.strength})`).join(", "))}</div>`:""}
      ${img.sampler?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_sampler_label"))}</span> ${esc(img.sampler)}</div>`:""}
      ${img.scheduler?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_scheduler_label"))}</span> ${esc(img.scheduler)}</div>`:""}
      ${img.steps?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_steps_label"))}</span> ${esc(img.steps)}</div>`:""}
    </div>` : "";
  openModal(`
    <button class="modal-close" id="idClose">${esc(t("btn_close"))}</button>
    <div class="lore-entry-modal">
      <div class="lore-entry-img" style="position:relative;">
        <img src="${esc(mediaURL(img.image))}" alt="">
        <button type="button" class="ig-detail-download" id="idDownload" title="${esc(t("gallery_download"))}" aria-label="${esc(t("gallery_download"))}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        ${(opts.shareable && img.id)?`<button type="button" class="ig-detail-download" id="idShare" style="right:52px;" title="${esc(t("ig_copy_link"))}" aria-label="${esc(t("ig_copy_link"))}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </button>`:""}
        <button type="button" class="ig-detail-download" id="idZoom" style="right:${(opts.shareable && img.id)?96:52}px;" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
      </div>
      <div class="lore-entry-body">
        <div class="lore-entry-eyebrow">${esc(when)}</div>
        ${ownerRow}
        <div class="rating-detail-row">
          ${ratingBadge(img)}
          <span class="rating-detail-text">${esc(t("rating_label"))}: ${img.is_explicit?"NSFW":"SFW"} <span class="rating-detail-disc">(${esc(img.human_reviewed?t("rating_line_human"):t("rating_line_ai"))})</span></span>
          ${(opts.reportable&&img.id)?`<button type="button" class="tool rating-report-btn" id="idReport">${esc(t("report_open"))}</button>`:""}
        </div>
        ${(img.scene_full||img.scene) ? `
        <div class="lore-entry-label">${esc(t("gallery_scene_label"))}</div>
        <div class="lore-entry-text md" style="font-style:italic;">${md(img.scene_full||img.scene||"")}</div>` : ""}
        ${(img.image_positive||img.image_negative) ? `
          ${tagRow(img.image_positive, "pos", t("gallery_positive_label"))}
          ${tagRow(img.image_negative, "neg", t("gallery_negative_label"))}`
        : `<div class="hint" style="margin-top:8px;">${esc(t("gallery_tags_unrecorded"))}</div>`}
        ${genInfoRow}
      </div>
    </div>
    ${img.id?`<div id="idComments" class="cmt-section"><div class="hint">Loading…</div></div>`:""}`, "modal-wide");
  $("#idClose").onclick=closeModal;
  if(opts.reportable && img.id && $("#idReport")) $("#idReport").onclick=()=>reportRatingModal(img);
  $(".modal")?.querySelector("[data-owner-link]")?.addEventListener("click", e=>{
    e.preventDefault();
    closeModal();
    navigate(e.currentTarget.getAttribute("href"));
  });
  if(img.id){
    const cbox=$("#idComments");
    if(cbox) renderComments("image", img.id, cbox, {ownerId:opts.ownerId});
  }
  $("#idDownload").onclick=async()=>{
    try{
      const url=mediaURL(img.image);
      const blob=await (await fetch(url)).blob();
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=(url.split("/").pop()||"image").split("?")[0];
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    }catch(e){ errorToast("Download failed: "+e.message); }
  };
  $("#idZoom").onclick=()=>{
    // Deliberately NOT stacked — a stacked layer kept the original modal in
    // the DOM underneath, and despite a fully opaque covering background
    // (confirmed correct via computed styles) its rating badge still
    // visibly painted through in real testing on both Firefox and Chromium.
    // Removing the original modal from the DOM entirely instead of trying to
    // cover it sidesteps whatever compositing quirk was causing that.
    openModal(`<img src="${esc(mediaURL(img.image))}" alt="" style="width:100%;border-radius:10px;display:block;">`);
    // Since this replaced (not stacked on) the detail modal, closing it via
    // the normal backdrop-click/Escape path would otherwise just close
    // everything — reopen the detail view instead so "closing zoom" reads as
    // "going back", not "losing your place".
    const layer=$(".modal-layer");
    if(layer) layer.onclick=e=>{ if(e.target===layer) imageDetailModal(img, opts); };
  };
  if(opts.shareable && img.id && $("#idShare")) $("#idShare").onclick=()=>{
    const url=`${location.origin}/i/${encodeURIComponent(img.id)}`;
    navigator.clipboard?.writeText(url).then(()=>toast(t("ig_link_copied"))).catch(()=>{});
  };
  $(".modal").querySelectorAll("[data-act='copy-tags']").forEach(b=>b.onclick=()=>{
    const tags=b.closest(".ig-tags-row").dataset.tags;
    navigator.clipboard?.writeText(tags).then(()=>toast(t("gallery_tags_copied"))).catch(()=>{});
  });
}
function reportRatingModal(img){
  openModal(`<h3>${esc(t("report_title"))}</h3>
    <p class="hint" style="margin:8px 0 14px;">${esc(t("report_intro"))}</p>
    <div class="field"><label>${esc(t("report_note_label"))}</label>
      <textarea id="rrNote" rows="3" placeholder="${esc(t("report_note_ph"))}"></textarea></div>
    <div class="modal-foot" style="gap:8px;">
      <button class="btn" id="rrCancel">${esc(t("btn_cancel"))}</button>
      <button class="btn" id="rrSfw">${esc(t("report_as_sfw"))}</button>
      <button class="btn primary" id="rrNsfw">${esc(t("report_as_nsfw"))}</button>
    </div>`);
  $("#rrCancel").onclick=closeModal;
  const submit=async claimed=>{
    const note=($("#rrNote")?.value||"").trim();
    try{
      await api("/api/imagegen/standalone/"+encodeURIComponent(img.id)+"/report", j("POST",{claimed_explicit:claimed, note}));
      closeModal(); toast(t("report_sent"));
    }catch(e){ errorToast(t("report_failed")+": "+e.message); }
  };
  $("#rrNsfw").onclick=()=>submit(true);
  $("#rrSfw").onclick=()=>submit(false);
}
function adminReviewImageModal(rep, onResolved){
  openModal(`<button class="modal-close" id="airClose">${esc(t("btn_close"))}</button>
    <div class="air-modal">
      <div class="air-img"><img src="${esc(mediaURL(rep.image||""))}" alt=""></div>
      <div class="field" style="width:100%;margin:12px 0;"><label>${esc(t("adm_review_note_label"))}</label>
        <textarea id="airNote" rows="2" placeholder="${esc(t("adm_review_note_ph"))}"></textarea></div>
      <div class="air-buttons">
        <button class="btn" id="airSfw">SFW</button>
        <button class="btn primary" id="airNsfw">NSFW</button>
      </div>
    </div>`, "modal-wide");
  $("#airClose").onclick=closeModal;
  const resolve=async is_explicit=>{
    const admin_note=($("#airNote")?.value||"").trim();
    try{
      await api("/api/admin/image-reports/"+encodeURIComponent(rep.id)+"/resolve", j("POST",{is_explicit, admin_note}));
      closeModal(); toast(t("adm_review_resolved")); onResolved&&onResolved();
    }catch(e){ errorToast(t("adm_review_failed")+": "+e.message); }
  };
  $("#airNsfw").onclick=()=>resolve(true);
  $("#airSfw").onclick=()=>resolve(false);
}
// Same review-modal pattern as adminReviewImageModal (full image + a clear
// two-button verdict) applied to a pending emoji/sticker instead of a
// standalone-image rating report — shows what was actually uploaded (image,
// uploader, requested shortcode/kind) so approving isn't a blind click.
function openEmojiReviewModal(e, onResolved){
  openModal(`<button class="modal-close" id="eurClose">${esc(t("btn_close"))}</button>
    <div class="air-modal">
      <div class="air-img"><img src="${esc(mediaURL(e.image||""))}" alt=""></div>
      <div class="field" style="width:100%;margin:12px 0;">
        <label>Uploaded by</label>
        <div>${esc(e.uploader_username||e.uploader_id)}</div>
      </div>
      <div class="field" style="width:100%;margin:0 0 12px;">
        <label>Requested as</label>
        <div>:${esc(e.shortcode)}: <span class="mr-type-tag">${esc(e.kind)}</span></div>
      </div>
      <div class="air-buttons">
        <button class="btn danger" id="eurDisapprove">Disapprove</button>
        <button class="btn primary" id="eurApprove">Approve</button>
      </div>
    </div>`, "modal-wide");
  $("#eurClose").onclick=closeModal;
  $("#eurApprove").onclick=async()=>{
    try{
      await api("/api/admin/emojis/"+encodeURIComponent(e.id)+"/approve",{method:"POST"});
      closeModal(); toast("Approved."); onResolved&&onResolved();
    }catch(err){ errorToast("Failed: "+err.message); }
  };
  $("#eurDisapprove").onclick=async()=>{
    try{
      await api("/api/emojis/"+encodeURIComponent(e.id),{method:"DELETE"});
      closeModal(); toast("Disapproved and deleted."); onResolved&&onResolved();
    }catch(err){ errorToast("Failed: "+err.message); }
  };
}
async function viewSharedImage(main, iid){
  let rec;
  try{ rec=await api("/api/imagegen/standalone/"+encodeURIComponent(iid||"")); }
  catch(e){
    return errorPage(main, {code:"404", title:"Image not available",
      message:"This image is private or no longer exists."});
  }
  main.innerHTML=`<div class="wrap shared-img-wrap">
    <div class="page-eyebrow">${esc(t("ig_shared_eyebrow"))}</div>
    <div class="shared-img-card">
      <img class="shared-img-pic" src="${esc(mediaURL(rec.image))}" alt="">
      <div class="shared-img-foot">
        ${avatar({avatar:rec.owner_avatar, name:rec.owner_display_name}, "ig-owner-ava")}
        <span>${esc(t("ig_community_by"))} ${esc(rec.owner_display_name||rec.owner_username||"")}</span>
        <a class="btn primary shared-img-view" href="/images">${esc(t("ig_view_on_brand"))}</a>
      </div>
    </div>
  </div>`;
}
async function viewPersonas(main){
  let tab="all";
  const render=async()=>{
    const [ps, drafts]=await Promise.all([api("/api/personas"), api("/api/personas/drafts")]);
    const q=($("#q")?.value||"").trim().toLowerCase();
    const filt=list=>q?list.filter(p=>p.name.toLowerCase().includes(q)||(p.description||"").toLowerCase().includes(q)):list;
    const rows=filt(tab==="drafts"?drafts:ps);
    const rowHTML=p=>`<div class="lore-entry"><div class="top"><b style="font-family:var(--sans);font-size:16px;color:var(--ink)">${esc(p.name)}</b>${p.is_default?'<span class="badge always">default</span>':""}${p.is_draft?'<span class="badge">draft</span>':""}</div>
          <div class="c">${esc(p.description||"—")}</div>
          <div class="row-tools"><button class="tool" data-edit="${p.id}">edit</button><button class="tool danger" data-del="${p.id}">delete</button></div></div>`;
    main.innerHTML=`<div class="wrap">
      <div class="page-eyebrow">${esc(t("personas_eyebrow"))}</div><h1 class="page">${esc(t("personas_title"))}</h1>
      <div class="page-sub">${esc(t("personas_sub"))}</div>
      <div class="toolbar">
        <div class="search"><span class="ic">⌕</span><input id="q" placeholder="${esc(t("search_placeholder"))}" value="${esc(q)}"></div>
        <button class="btn primary" id="addP">+ ${esc(t("btn_new_persona"))}</button>
      </div>
      <div class="seg" id="pTabs" style="margin:12px 0">
        <button type="button" class="seg-btn ${tab==="all"?"on":""}" data-tab="all"><b>${esc(t("lib_tab_all"))} (${ps.length})</b></button>
        <button type="button" class="seg-btn ${tab==="drafts"?"on":""}" data-tab="drafts"><b>${esc(t("lib_tab_pending"))} (${drafts.length})</b></button>
      </div>
      <div id="plist">${
        rows.length? rows.map(rowHTML).join("")
        : `<div class="empty"><div class="big">${q?esc(t("empty_search")):tab==="drafts"?esc(t("lib_no_drafts")):esc(t("empty_personas"))}</div>${(q||tab==="drafts")?"":esc(t("empty_personas_hint"))}</div>`
      }</div></div>`;
    localizeContent([...main.querySelectorAll("#plist .lore-entry")].map((el,i)=>({
      el:el.querySelector(".c"), text:rows[i]?.description||""})));
    main.querySelectorAll("#pTabs .seg-btn").forEach(b=>b.onclick=()=>{ tab=b.dataset.tab; render(); });
    $("#addP").onclick=()=>personaModal(null,render);
    let qT; $("#q").addEventListener("input",()=>{clearTimeout(qT);qT=setTimeout(render,200);});
    $("#q").focus(); $("#q").selectionStart=$("#q").selectionEnd=$("#q").value.length;
    main.querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{ personaModal(rows.find(x=>x.id===b.dataset.edit),render); });
    main.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{ if(await confirmAction(b, "Delete this persona?")){ await api("/api/personas/"+b.dataset.del,{method:"DELETE"}); render(); }});
  };
  render();
}
function personaModal(p, onSave){
  const e=p||{name:"",description:"",is_default:false};
  openModal(`<h3>${esc(p?t("pm_edit"):t("pm_new"))}</h3>
    <div class="field"><label>${esc(t("ed_name"))}</label><input type="text" id="p_name" value="${esc(e.name)}" placeholder="e.g. Alex"></div>
    <div class="field"><label>${esc(t("pm_desc"))} <span class="hint">${esc(t("pm_desc_hint"))}</span></label>
      <div class="desc-expand-wrap">
        <textarea id="p_desc" style="min-height:110px" placeholder="${esc(t("pm_desc_ph"))}">${esc(e.description)}</textarea>
        <button type="button" class="ai-expand-btn" id="p_expand" title="${esc(t("pm_expand_title"))}" aria-label="${esc(t("pm_expand_title"))}">${SPARKLE_SVG}</button>
      </div>
      <details class="ai-expand-example"><summary>${esc(t("pm_expand_example_summary"))}</summary>
        <div class="hint" style="margin-top:6px"><b>${esc(t("pm_expand_example_in_label"))}</b> ${esc(t("pm_expand_example_in"))}<br><b>${esc(t("pm_expand_example_out_label"))}</b> ${esc(t("pm_expand_example_out"))}</div>
      </details></div>
    <label class="switch"><input type="checkbox" id="p_def" ${e.is_default?"checked":""}> ${esc(t("pm_default"))}</label>
    <div class="modal-foot"><button class="btn" id="p_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="p_save">${esc(t("btn_save"))}</button></div>`);
  $("#p_expand").onclick=async()=>{
    const ta=$("#p_desc"); const src=ta.value.trim();
    if(!src){ toast(t("pm_expand_empty")); return; }
    const btn=$("#p_expand"); btn.disabled=true; btn.classList.add("loading");
    try{
      const r=await api("/api/personas/expand-description",{method:"POST",body:JSON.stringify({text:src})});
      ta.value=r.description||src;
      ta.dispatchEvent(new Event("input"));
      toast(t("pm_expand_done"));
    }catch(e){ errorToast(t("pm_expand_fail")+": "+e.message); }
    finally{ btn.disabled=false; btn.classList.remove("loading"); }
  };
  // Autosave (new-persona flow only): a debounced draft save so work isn't lost
  // if the tab closes or the connection drops before a real Save — shows up in
  // the Personas "Pending" tab, and only becomes a normal persona once the user
  // clicks Save (which clears is_draft). Editing an existing persona never
  // autosaves. Editing a draft finalizes it on Save like any other persona.
  let draftPid=p?.id||null;
  const collectBody=()=>({name:$("#p_name").value.trim()||"You", description:$("#p_desc").value, is_default:$("#p_def").checked});
  const hasContent=()=>!!($("#p_desc").value.trim() || ($("#p_name").value.trim() && $("#p_name").value.trim()!=="You"));
  let autosaveT;
  const doAutosave=async()=>{
    if(p || !hasContent()) return;
    const body={...collectBody(), is_draft:true};
    try{
      if(draftPid) await api("/api/personas/"+draftPid, j("PUT",body));
      else{ const np=await api("/api/personas", j("POST",body)); draftPid=np.id; }
    }catch(e){ /* best-effort */ }
  };
  if(!p){
    const schedule=()=>{ clearTimeout(autosaveT); autosaveT=setTimeout(doAutosave, 3000); };
    ["p_name","p_desc"].forEach(id=>$("#"+id).addEventListener("input", schedule));
  }
  $("#p_cancel").onclick=()=>{
    clearTimeout(autosaveT);
    if(!p && draftPid) api("/api/personas/"+draftPid, {method:"DELETE"}).catch(()=>{});
    closeModal();
  };
  $("#p_save").onclick=async()=>{
    clearTimeout(autosaveT);
    const body={...collectBody(), is_draft:false};
    if(p) await api("/api/personas/"+p.id, j("PUT",body));
    else if(draftPid) await api("/api/personas/"+draftPid, j("PUT",body));
    else await api("/api/personas", j("POST",body));
    closeModal(); toast("Saved."); onSave();
  };
}
