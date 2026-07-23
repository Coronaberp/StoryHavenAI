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
    main.innerHTML=`<div class="wrap wrap-wide"><div id="pfCustom" class="pf-custom${pfNb}"></div></div>`;
    mountSandboxedHTML($("#pfCustom"), substituteProfileTemplate(p.profile_html, p, null, own), {onReady:doc=>{
      wireProfileTemplateButtons(doc, {
        onEdit: own ? ()=>openProfileEditor(p, ()=>viewProfile(main, username)) : null,
        blockedUsername: p.username, blockedByViewer: p.blocked_by_viewer,
        onBlockToggle: ()=>viewProfile(main, username),
      });
      wireCardCommentsButtons(doc, "user", p.username, {ownerId:p.id});
      wireCardReportButtons(doc, "profile", t("report_flag_profile").replace("{name}", p.display_name||p.username), p.id, mediaURL(p.avatar||p.banner_img||""));
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
  const reportLabel=t("report_flag_profile").replace("{name}", p.display_name||p.username);
  main.innerHTML=`
    <div class="pf-banner-wrap" style="position:relative;">
      <div class="pf-banner-full${pfNb}" style="${banner}"></div>
      ${(!own && p.banner_img)?reportImageBtnHTML("banner", reportLabel, p.id, mediaURL(p.banner_img)).replace("class=\"tool report-flag-btn\"", "class=\"tool report-flag-btn report-flag-overlay\""):""}
    </div>
    <div class="wrap wrap-wide">
    <div class="pf-card pf-glass">
      <div class="pf-body">
        <div class="pf-head">
          <div class="pf-ava-wrap" style="position:relative;background-image:linear-gradient(var(--surface),var(--surface)),linear-gradient(150deg, ${esc(c1)} 0%, ${esc(c2)} 100%);">${avaHTML}${(!own && p.avatar)?reportImageBtnHTML("avatar", reportLabel, p.id, mediaURL(p.avatar)).replace("class=\"tool report-flag-btn\"", "class=\"tool report-flag-btn report-flag-overlay report-flag-overlay-sm\""):""}</div>
          <div class="pf-id">
            <div class="pf-name-row">
              <span class="pf-name">${esc(p.display_name||p.username)}</span>
              ${(p.title_status==="approved"&&p.title)?`<span class="pf-badge pf-badge-title">${esc(p.title)}</span>`:(p.is_admin?`<span class="pf-badge">${p.role==="dev"?"Dev":esc(t("pf_admin"))}</span>`:"")}
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
  wireReportImageButtons(main);
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
    ${p.is_explicit?`<div class="field-group" style="border-color:var(--warn);">
      <div class="field-group-label" style="color:var(--warn);">${esc(t("pf_flagged_label"))}</div>
      <p class="hint">${esc(t("pf_flagged_hint"))}</p>
      <button type="button" class="btn" id="pf_request_review">🚩 ${esc(t("pf_request_review"))}</button>
    </div>`:""}
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
      <summary>${esc(t("pf_html_summary"))}
        <button type="button" class="tool pf-html-copy-instructions" id="pf_html_copy_instr" title="${esc(t("pf_html_copy_instructions"))}" aria-label="${esc(t("pf_html_copy_instructions"))}">${COPY_ICON_SVG}</button>
      </summary>
      <div id="pf_html_instructions">
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
      <p class="hint"><b>${esc(t("pf_html_report_label"))}</b> ${esc(t("pf_html_report_hint"))}</p>
      <p class="hint" style="color:var(--warn,#e0a800);"><b>${esc(t("pf_html_height_label"))}</b> ${esc(t("pf_html_height_hint"))}</p>
      <p class="hint"><b>${esc(t("pf_html_vars_label"))}</b> ${esc(t("pf_html_vars_hint"))}</p>
      <p class="hint">${esc(t("pf_html_example"))} <code>&lt;style&gt;body{display:grid;grid-template-columns:200px 1fr;gap:24px;padding:24px}&lt;/style&gt; &lt;h1&gt;{{display_name}}&lt;/h1&gt;&lt;p&gt;{{bio}}&lt;/p&gt;{{share}} {{edit}} {{comments}} {{block}} {{report}}&lt;h2&gt;Cast&lt;/h2&gt;{{characters}}</code></p>
      </div>
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
  $("#pf_html_copy_instr").onclick=e=>{
    e.preventDefault(); e.stopPropagation();
    const text=copyInstructionsText($("#pf_html_instructions"));
    navigator.clipboard?.writeText(text).then(()=>toast(t("pf_html_instructions_copied"))).catch(()=>{});
  };
  if($("#pf_request_review")) $("#pf_request_review").onclick=async e=>{
    try{
      await api("/api/report-image", j("POST", {kind:"profile", label:t("report_flag_profile").replace("{name}", p.display_name||p.username), target_id:p.id, image:mediaURL(p.avatar||p.banner_img||""), note:t("pf_request_review_note")}));
      e.target.disabled=true; toast(t("report_sent"));
    }catch(err){ errorToast(t("report_failed")+": "+err.message); }
  };
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
    if(htmlIn.trim() && !htmlIn.includes("{{report}}")){
      toast(t("pf_html_report_required")); return;
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
