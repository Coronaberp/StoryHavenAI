"use strict";
/* ============================ MODAL + SETTINGS ============================ */
let _modalStack=[];
function openModal(html, extraClass, opts){
  const s=$("#scrim");
  if(!(opts&&opts.stack)){ _modalStack=[]; s.innerHTML=""; }
  const layer=document.createElement("div");
  layer.className="modal-layer";
  layer.innerHTML=`<div class="modal${extraClass?" "+extraClass:""}">${html}</div>`;
  layer.onclick=e=>{ if(e.target===layer) closeModal(); };
  s.appendChild(layer);
  _modalStack.push(layer);
  s.classList.add("open");
  // CSS :has() (used to hide the page behind an open modal) has spotty/late
  // support (e.g. older Firefox) — an explicit class on <body> works
  // everywhere regardless of :has() support.
  document.body.classList.add("modal-open");
}
async function openAdminNotesModal(u, onChange){
  if(!u) return;
  openModal(`
    <h3>Notes · ${esc(u.username)}</h3>
    <div class="field">
      <label>Identity label <span style="color:var(--sec);font-weight:400;">(shown as a pill on the user row)</span></label>
      <div style="display:flex;gap:8px;">
        <input type="text" id="an_ident" maxlength="40" placeholder="e.g. Steve (Discord)" value="${esc(u.identity_label||"")}" style="flex:1;">
        <button class="btn" id="an_ident_save">Save</button>
      </div>
    </div>
    <div class="field">
      <label>Add a note</label>
      <textarea id="an_note" rows="2" placeholder="Internal note about this user…"></textarea>
      <div class="modal-foot" style="margin-top:6px;"><button class="btn primary" id="an_add">Add note</button></div>
    </div>
    <div id="an_list" style="max-height:320px;overflow:auto;margin-top:8px;">Loading…</div>
    <div class="modal-foot"><button class="btn" id="an_close">Close</button></div>`, "modal-wide");
  document.getElementById("an_close").onclick=closeModal;
  const refreshList=async()=>{
    const box=document.getElementById("an_list");
    try{
      const notes=await api("/api/admin/users/"+u.id+"/notes");
      if(!notes.length){ box.innerHTML=`<div class="adash-empty">No notes yet.</div>`; return; }
      box.innerHTML=notes.map(n=>`
        <div class="adash-rowcard" style="align-items:flex-start;">
          <div class="adash-rowmain"><div>
            <div class="adash-rowsub mono">${esc(n.author_username)} · ${esc(new Date(n.created*1000).toLocaleString())}</div>
            <div style="white-space:pre-wrap;margin-top:4px;">${esc(n.note)}</div>
          </div></div>
          <div class="adash-rowactions"><button class="btn danger" data-delnote="${esc(n.id)}" title="Delete note">✕</button></div>
        </div>`).join("");
      box.querySelectorAll("[data-delnote]").forEach(b=>b.onclick=async()=>{
        try{ await api("/api/admin/notes/"+b.dataset.delnote,{method:"DELETE"}); refreshList(); }
        catch(e){ errorToast("Failed: "+e.message); }
      });
    }catch(e){ box.innerHTML=`<div class="adash-empty">Failed to load notes.</div>`; }
  };
  document.getElementById("an_add").onclick=async()=>{
    const note=document.getElementById("an_note").value.trim();
    if(!note){ toast("Note is required."); return; }
    try{ await api("/api/admin/users/"+u.id+"/notes", j("POST",{note})); document.getElementById("an_note").value=""; refreshList(); }
    catch(e){ errorToast("Failed: "+e.message); }
  };
  document.getElementById("an_ident_save").onclick=async()=>{
    const label=document.getElementById("an_ident").value.trim();
    try{
      await api("/api/admin/users/"+u.id+"/identity", j("PUT",{label:label||null}));
      u.identity_label=label||null;
      toast("Identity label saved.");
      if(onChange) onChange();
    }catch(e){ errorToast("Failed: "+e.message); }
  };
  refreshList();
}

function closeModal(){
  if(_complianceLock) return;
  const s=$("#scrim");
  const layer=_modalStack.pop();
  if(layer&&layer.parentNode) layer.remove(); else s.innerHTML="";
  if(!_modalStack.length){
    s.classList.remove("open"); s.innerHTML=""; document.body.classList.remove("modal-open");
    // .emoji-pop/.mention-dd/.gif-pop are appended straight to <body> (see the
    // comment on .emoji-pop in overlay.css — they need to render above the
    // modal system's own z-index, so they can't live inside .modal-layer).
    // That means they're never a child of the layer just removed above, so
    // closing the modal they were opened from left them orphaned on screen
    // with no way left to dismiss them. Clear them out whenever the modal
    // stack fully empties. Exception: a generate-image flow launched FROM an
    // .emoji-pop (see comments.js's #epGenerate) opens its own modal on this
    // same stack — closing it would otherwise immediately yank the popover
    // that started it right out from under the user.
    if(!window._emojiPopGenerating){
      document.querySelectorAll(".emoji-pop, .mention-dd, .gif-pop").forEach(p=>p.remove());
    }
  }
}

/* ===================== CUSTOM-CARD COMPLIANCE =====================
   Custom presentation_html/profile_html renders inside a sandboxed
   <iframe srcdoc>, so its CSS is fully scoped to that iframe document and
   cannot reach the parent page's mandatory action buttons. Only the
   card's OWNER is ever shown the enforcement modal. */
function cardComplianceReasons(rawHtml, doc, targetType){
  const raw=(rawHtml||"");
  const reasons=[];
  const badUrl=findExternalCardLink(raw);
  if(badUrl)
    reasons.push(t("compliance_reason_external_link").replace("{url}", badUrl));
  /* {{comments}} is only required for profiles — profile_html can be a full-
     page takeover with no guaranteed persistent header, so it's the only
     place the Comments button could actually disappear. A character's custom
     presentation_html only ever replaces the lower doss-main/lore section;
     the header row above it (with its own always-present #cmtBtn, alongside
     Start/Preview/Share/Edit/Export/Delete) is structurally untouched. */
  if(targetType!=="character" && raw.trim() && !raw.includes("{{comments}}"))
    reasons.push(t("compliance_reason_missing_comments"));
  /* {{block}} is only required for profiles, same reasoning as {{comments}}
     above — a character page's persistent header row has no block affordance
     at all (blocking blocks the CREATOR, which only makes sense from their
     profile), so this only applies to profile_html. */
  if(targetType!=="character" && raw.trim() && !raw.includes("{{block}}"))
    reasons.push(t("compliance_reason_missing_block"));
  /* The sandboxed frame auto-sizes to its content's scrollHeight after load —
     forcing html/body to height:100% traps the whole page inside the frame's
     tiny pre-resize starting height, silently clipping everything past the
     fold. Confirmed real-world bug, not theoretical — flag existing saves
     written before this check existed. */
  if(raw.trim() && /\b(?:html|body)\s*\{[^}]*height\s*:\s*100%/i.test(raw))
    reasons.push(t("compliance_reason_forced_height"));
  return reasons;
}
let _complianceLock=false;
/* Set once the global (or the profile page's own local) compliance modal has
   fired for this page load, so the two checks — the global one that runs
   once at boot regardless of what page you're on, and viewProfile's own
   local one when you happen to be on your own profile page — never stack a
   second openModal() on top of the first. */
let _complianceShownThisLoad=false;
/* Global, once-per-page-load check: if the signed-in user's OWN profile_html
   is non-compliant, the enforcement modal must appear and block them no
   matter what page of the app they're on — not only when they happen to
   navigate to their own /u/{username}. Runs off-screen (never inserted into
   the visible page) purely to get a real rendered height via the same
   mountSandboxedHTML/cardComplianceReasons pipeline every other compliance
   check uses, then discards the scratch iframe either way. */
async function checkOwnProfileComplianceGlobally(){
  if(_complianceShownThisLoad || !ME) return;
  let p;
  try{ p=await api("/api/users/"+encodeURIComponent(ME.username)); }
  catch(e){ return; }
  if(!p.profile_html || !p.profile_html.trim()) return;
  const scratch=document.createElement("div");
  scratch.style.cssText="position:fixed;left:-99999px;top:-99999px;width:1200px;visibility:hidden;pointer-events:none;";
  document.body.appendChild(scratch);
  mountSandboxedHTML(scratch, substituteProfileTemplate(p.profile_html, p, null, true), {onReady:doc=>{
    scratch.remove();
    if(_complianceShownThisLoad) return;
    const reasons=cardComplianceReasons(p.profile_html, doc, "user");
    if(!reasons.length) return;
    _complianceShownThisLoad=true;
    openComplianceModal({
      html: p.profile_html,
      filename: `${(p.username||"profile").replace(/[^a-z0-9]+/gi,"-")}-profile.html`,
      reasons,
      onEdit: ()=>{ navigate("/u/"+p.username); openProfileEditor(p, ()=>{}); },
      onClear: async()=>{
        await api("/api/me/profile", j("PUT", {profile_html:""}));
      },
    });
  }});
}
function complianceDownload(html, filename){
  const blob=new Blob([html||""],{type:"text/html"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
/* Non-dismissible enforcement modal: no close/X, Escape is neutralised via
   _complianceLock (closeModal early-returns), and backdrop clicks are
   swallowed. Only Edit (navigate away to fix) or Leave→confirm→delete exit. */
function openComplianceModal({html, filename, reasons, onEdit, onClear}){
  _complianceLock=true;
  const s=$("#scrim");
  const bullets=(reasons&&reasons.length?reasons:[t("compliance_reason_generic")])
    .map(r=>`<li>${esc(r)}</li>`).join("");
  const showNotice=()=>{
    s.innerHTML=`<div class="modal compliance-modal">
      <h3>⚠ ${esc(t("compliance_title"))}</h3>
      <p>${esc(t("compliance_body"))}</p>
      <ul class="compliance-reasons">${bullets}</ul>
      <p class="compliance-halt">${esc(t("compliance_halt"))}</p>
      <div class="modal-actions">
        <button class="btn primary" id="cmpEdit">✎ ${esc(t("compliance_edit"))}</button>
        <button class="btn danger" id="cmpLeave">${esc(t("compliance_leave"))}</button>
        <button class="btn" id="cmpLogout">⎋ ${esc(t("sign_out"))}</button>
      </div>
    </div>`;
    $("#cmpEdit").onclick=()=>{ _complianceLock=false; closeModal(); onEdit(); };
    $("#cmpLeave").onclick=showConfirm;
    $("#cmpLogout").onclick=()=>{ _complianceLock=false; closeModal(); _doLogout(); };
  };
  const showConfirm=()=>{
    s.innerHTML=`<div class="modal compliance-modal">
      <h3>${esc(t("compliance_leave_title"))}</h3>
      <p>${esc(t("compliance_leave_body"))}</p>
      <div class="modal-actions">
        <button class="btn" id="cmpDownload">⤓ ${esc(t("compliance_download"))}</button>
        <button class="btn" id="cmpBack">${esc(t("compliance_back"))}</button>
        <button class="btn danger" id="cmpConfirm">${esc(t("compliance_confirm_leave"))}</button>
      </div>
    </div>`;
    $("#cmpDownload").onclick=()=>complianceDownload(html, filename);
    $("#cmpBack").onclick=showNotice;
    $("#cmpConfirm").onclick=async()=>{
      const b=$("#cmpConfirm"); b.disabled=true;
      try{ await onClear(); _complianceLock=false; closeModal(); }
      catch(e){ b.disabled=false; errorToast(e.message||"Failed to clear."); }
    };
  };
  showNotice();
  s.classList.add("open");
  s.onclick=e=>{ /* non-dismissible — swallow backdrop clicks */ };
}

/* ---------- lightweight pan/zoom cropper (no external deps) ----------
   Used for local file uploads (avatar/banner) only — canvas.toBlob on a
   remote URL would need CORS and can silently taint the canvas, so pasted
   URLs skip cropping and go straight to the field. */
function openCropper(objectUrl, aspect, outW, outH, onDone){
  // Stacked, not a fresh modal — the caller may already have a modal open
  // (e.g. the admin's checkpoint/lora reference-image flow inside
  // openImageGenPickerModal). Without {stack:true}, openModal() wipes the
  // entire existing modal stack before showing the cropper, so clicking
  // Apply/Cancel here closes down to nothing instead of back to the caller's
  // still-open modal underneath.
  openModal(`<h3>${esc(t("crop_title"))}</h3>
    <div class="crop-wrap" style="aspect-ratio:${aspect};"><img id="cropImg" src="${esc(objectUrl)}" draggable="false" alt=""></div>
    <div class="field" style="margin-top:14px;"><label>${esc(t("crop_zoom"))}</label>
      <input type="range" id="cropZoom" min="1" max="3" step="0.01" value="1"></div>
    <div class="modal-foot">
      <button type="button" class="btn" id="cropCancel">${esc(t("btn_cancel"))}</button>
      <button type="button" class="btn primary" id="cropApply">${esc(t("crop_apply"))}</button>
    </div>`, null, {stack:true});
  const wrap=$(".crop-wrap"), img=$("#cropImg"), zoomEl=$("#cropZoom");
  let scale=1, tx=0, ty=0, natW=0, natH=0, baseScale=1, drag=false, sx=0, sy=0, stx=0, sty=0, ready=false;
  const clampPan=()=>{
    const ww=wrap.clientWidth, wh=wrap.clientHeight;
    const dw=natW*baseScale*scale, dh=natH*baseScale*scale;
    const maxX=Math.max(0,(dw-ww)/2), maxY=Math.max(0,(dh-wh)/2);
    tx=Math.max(-maxX,Math.min(maxX,tx)); ty=Math.max(-maxY,Math.min(maxY,ty));
  };
  const render=()=>{ clampPan(); img.style.transform=`translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${scale})`; };
  // #cropApply is wired below regardless of whether the image has actually
  // finished loading — without this guard, clicking Apply before setup() has
  // populated real natW/natH/baseScale (still their 0/1 initial values) ran
  // the crop math on degenerate numbers, producing garbage/noise output
  // instead of a real crop (confirmed: a user hit this on a slow-loading
  // image and got a corrupted profile picture out of it).
  const applyBtn=$("#cropApply");
  applyBtn.disabled=true;
  const setup=()=>{
    natW=img.naturalWidth; natH=img.naturalHeight;
    const ww=wrap.clientWidth, wh=wrap.clientHeight;
    baseScale=Math.max(ww/natW, wh/natH);
    img.style.width=natW*baseScale+"px"; img.style.height=natH*baseScale+"px";
    render();
    ready=true;
    applyBtn.disabled=false;
  };
  if(img.complete && img.naturalWidth) setup(); else img.onload=setup;
  img.onpointerdown=e=>{ drag=true; img.setPointerCapture(e.pointerId); sx=e.clientX; sy=e.clientY; stx=tx; sty=ty; img.style.cursor="grabbing"; };
  img.onpointermove=e=>{ if(!drag) return; tx=stx+(e.clientX-sx); ty=sty+(e.clientY-sy); render(); };
  img.onpointerup=img.onpointercancel=()=>{ drag=false; img.style.cursor="grab"; };
  zoomEl.oninput=()=>{ scale=parseFloat(zoomEl.value); render(); };
  $("#cropCancel").onclick=()=>{ URL.revokeObjectURL(objectUrl); closeModal(); };
  $("#cropApply").onclick=()=>{
    if(!ready) return; // guards the disabled-button gap itself (e.g. a stray Enter keypress)
    const ww=wrap.clientWidth, wh=wrap.clientHeight;
    const dw=natW*baseScale*scale, dh=natH*baseScale*scale;
    const left=(ww-dw)/2+tx, top=(wh-dh)/2+ty;
    const srcScale=1/(baseScale*scale);
    const sxCrop=(0-left)*srcScale, syCrop=(0-top)*srcScale, swCrop=ww*srcScale, shCrop=wh*srcScale;
    const canvas=document.createElement("canvas");
    canvas.width=outW; canvas.height=outH;
    canvas.getContext("2d").drawImage(img, sxCrop, syCrop, swCrop, shCrop, 0, 0, outW, outH);
    canvas.toBlob(blob=>{ URL.revokeObjectURL(objectUrl); closeModal(); onDone(blob); }, "image/jpeg", 0.92);
  };
}

$("#settingsBtn").onclick=async()=>{
  const prevTheme=THEME;
  const isAdmin=ME&&ME.is_admin;
  let userSt={overrides:{},defaults:{}};
  try{ userSt=await api("/api/me/settings"); }catch(e){ toast("Couldn't load your settings — showing defaults."); }
  const uo=userSt.overrides||{}, ud=userSt.defaults||{};
  const a=APPEARANCE||{};
  const f=(id,label,val,hint="")=>`<div class="field" style="margin:0 0 12px"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label><input type="text" id="${id}" value="${esc(val??"")}"></div>`;
  const row=(...items)=>`<div style="display:grid;grid-template-columns:repeat(${items.length},1fr);gap:10px">${items.join("")}</div>`;
  const sf=(id,label,val,{min=0,max=1,step=0.01,hint="",fallback=0}={})=>{
    const has=val!==""&&val!==null&&val!==undefined;
    const rangeVal=has?val:fallback;
    return `<div class="field slider-field"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label>
      <div class="slider-row">
        <input type="range" class="sf-range" data-target="${id}" min="${min}" max="${max}" step="${step}" value="${rangeVal}">
        <input type="number" id="${id}" class="sf-num" min="${min}" max="${max}" step="${step}" value="${has?esc(val):""}" placeholder="${has?"":rangeVal}">
      </div></div>`;
  };
  const sliderGrid=(...items)=>`<div class="slider-grid">${items.join("")}</div>`;
  const colorField=(id,label,val,placeholder)=>{
    const isHex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val||"");
    return `<div class="field ap-color-field" style="margin:0 0 12px">
      <label>${label}</label>
      <div class="ap-color-controls">
        <input type="text" id="${id}" value="${esc(val||"")}" placeholder="${placeholder}">
        <button type="button" class="ap-swatch ap-color-picker" data-for="${id}" style="background:${isHex?esc(val):"#E3BD6C"}"></button>
      </div>
    </div>`;
  };
  const styleToggles=(cat,flagsVal,defaults)=>{
    const flags=flagsVal!==undefined&&flagsVal!==null?flagsVal:defaults;
    const btn=(letter,label,title)=>`<button type="button" class="style-toggle-btn${flags.includes(letter)?" on":""}" data-flag="${letter}" title="${title}">${label}</button>`;
    return `<div class="style-toggle-group" data-category="${cat}" data-default="${esc(defaults)}">
      ${btn("i","I","Italic")}${btn("b","B","Bold")}${btn("u","U","Underline")}${btn("s","S","Strikethrough")}
    </div>`;
  };
  const styleRow=(fontId,colorId,label,fontVal,colorVal,colorDflt,cat,catFlags,catDefaults)=>`<div class="field ap-style-row" style="margin:0 0 14px">
    <label>${label}</label>
    <div class="ap-style-controls">
      <input type="text" class="ap-style-font" id="${fontId}" value="${esc(fontVal||"")}" placeholder="default">
      ${styleToggles(cat,catFlags,catDefaults)}
      <button type="button" class="ap-swatch" id="${colorId}" data-default="${esc(colorDflt)}" data-value="${esc(colorVal||colorDflt)}" style="background:${esc(colorVal||colorDflt)}"></button>
    </div>
  </div>`;
  const hasOwnEndpoint=!!uo.base_url;

  const kobold="http://koboldcpp:5001/v1";
  const worldLangOptions=worldLanguages().map(n=>`<option value="${esc(n)}">`).join("");

  const generalTab=`
    <div style="margin:0 0 20px"><button class="btn" id="pw_open_modal_btn" type="button">🔒 ${esc(t("settings_password_heading"))}</button></div>
    <div class="field"><label data-i18n="settings_theme">${esc(t("settings_theme"))}</label>
      <div class="seg" id="themeSeg">
        <button class="seg-btn ${THEME!=="dark"?"on":""}" data-theme="light"><b data-i18n="theme_light">${esc(t("theme_light"))}</b><span data-i18n="theme_light_hint">${esc(t("theme_light_hint"))}</span></button>
        <button class="seg-btn ${THEME==="dark"?"on":""}" data-theme="dark"><b data-i18n="theme_dark">${esc(t("theme_dark"))}</b><span data-i18n="theme_dark_hint">${esc(t("theme_dark_hint"))}</span></button>
      </div>
    </div>
    <h3 class="sec" style="margin-top:0;border-top:none;padding-top:0;">🌐 <span data-i18n="settings_language_heading">${esc(t("settings_language_heading"))}</span></h3>
    <div class="field" style="margin:0 0 12px"><label><span data-i18n="settings_iface_lang">${esc(t("settings_iface_lang"))}</span> <span class="hint" data-i18n="settings_iface_lang_hint">${esc(t("settings_iface_lang_hint"))}</span></label>
      <input type="text" id="u_iface_lang" list="ifaceLangList" value="${esc(uo.interface_language||"")}" placeholder="English" autocomplete="off">
      <datalist id="ifaceLangList">${worldLangOptions}</datalist></div>
    <h3 class="sec" id="nsfwSettingSection">🔞 <span>${esc(t("settings_nsfw_heading"))}</span></h3>
    <label class="switch switch-nsfw"><input type="checkbox" id="u_nsfw" ${ME&&ME.nsfw_allowed?"checked":""}> ${esc(t("settings_nsfw"))} <span class="hint">${esc(t("settings_nsfw_hint"))}</span></label>
    <h3 class="sec">${esc(t("ap_title"))}</h3>
    <div class="field"><label>${esc(t("ap_font"))} <span class="hint">${esc(t("ap_font_hint_pre"))}<a class="hint-link" href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">${esc(t("ap_font_hint_link"))}</a>${esc(t("ap_font_hint_post"))}</span></label>
      <input type="text" id="ap_font" value="${esc(a.font||"")}" placeholder="default"></div>
    ${row(colorField("ap_text",t("ap_text"),a.text,"default"), colorField("ap_accent",t("ap_accent"),a.accent,"default"),
          `<div class="field" style="margin:0 0 12px"><label>${esc(t("ap_size"))}</label><input type="text" id="ap_scale" value="${esc(a.scale||"")}" placeholder="16"></div>`)}
    ${row(colorField("ap_appbg",t("ap_appbg"),a.appBg,"default"), colorField("ap_chatbg",t("ap_chatbg"),a.chatBg,"default"))}
    <div style="margin-top:10px;margin-bottom:20px;"><button class="btn" id="ap_reset" type="button">${esc(t("ap_reset"))}</button></div>
    <h3 class="sec">${esc(t("ap_md_title"))}</h3>
    <div class="ap-md-layout">
      <div class="ap-md-controls">
        <div class="field" style="margin:0 0 16px"><label>${esc(t("ap_msgfont"))}</label>
          <input type="text" id="ap_msgfont" value="${esc(a.msgFont||"")}" placeholder="Aptos">
          <span class="hint">${esc(t("ap_msgfont_hint_pre"))}<a class="hint-link" href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">${esc(t("ap_msgfont_hint_link"))}</a>${esc(t("ap_msgfont_hint_post"))}</span></div>
        ${styleRow("ap_narration_font","ap_narration",t("ap_narration"),a.narrationFont,a.narrationColor,"#E3BD6C","narration",a.narrationFlags,"i")}
        ${styleRow("ap_dialogue_font","ap_dialogue",t("ap_dialogue"),a.dialogueFont,a.dialogueColor,"#E3BD6C","dialogue",a.dialogueFlags,"")}
        ${styleRow("ap_thoughts_font","ap_thoughts",t("ap_thoughts"),a.thoughtFont,a.thoughtColor,"#E3BD6C","thought",a.thoughtFlags,"")}
        ${styleRow("ap_voice_font","ap_voice",t("ap_voice"),a.voiceFont,a.voiceColor,"#E3BD6C","voice",a.voiceFlags,"ib")}
        ${styleRow("ap_bold_font","ap_bold",t("ap_bold"),a.boldFont,a.boldColor,"#E3BD6C","bold",a.boldFlags,"b")}
        <div style="margin-top:6px;"><button class="btn" id="ap_md_reset" type="button">${esc(t("ap_md_reset"))}</button></div>
      </div>
      <div class="ap-md-preview">
        <div class="ap-preview-label">${esc(t("ap_preview"))}</div>
        <div class="ap-preview-card md" id="apPreview">${md(AP_PREVIEW_TEXT)}</div>
      </div>
    </div>`;

  const modelTab=`
    <h3 class="sec" style="margin-top:0;border-top:none;padding-top:0;" data-i18n="settings_llm_endpoint">${esc(t("settings_llm_endpoint"))}</h3>
    <label class="switch" style="margin-bottom:14px;"><input type="checkbox" id="u_use_own" ${hasOwnEndpoint?"checked":""}> <span data-i18n="settings_use_own_endpoint">${esc(t("settings_use_own_endpoint"))}</span></label>
    <div id="u_own_fields" style="display:${hasOwnEndpoint?"block":"none"}">
      <div class="ep-group">
        <div class="ep-group-head">${esc(t("set_chat"))}</div>
        <div class="field"><label>${esc(t("set_base_url"))}</label>
          <input type="text" id="u_base" value="${esc(uo.base_url||"")}" placeholder="${esc(ud.base_url||kobold)}"></div>
        <div class="field"><label>${esc(t("set_api_key"))} <span class="hint">${esc(t("set_optional"))}</span></label>
          <input type="password" id="u_key" value="" placeholder="${uo.has_api_key?t("set_keep"):t("set_none")}"></div>
        <div class="field"><label>${esc(t("set_model"))}</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="u_chat" value="${esc(uo.chat_model||"")}" placeholder="${esc(ud.chat_model||"")}" style="flex:1">
            <button class="btn" id="u_fetch" type="button">${esc(t("set_fetch"))}</button></div>
          <div id="u_model_list" style="display:none;margin-top:6px;display:none;flex-wrap:wrap;gap:6px;"></div></div>
      </div>
      <p class="hint" style="margin:4px 0 0;">${esc(t("set_embed_shared_hint"))}</p>
    </div>
    <div class="settings-row">
      <div class="field" style="margin:0"><label><span data-i18n="settings_past_messages">${esc(t("settings_past_messages"))}</span> <span class="hint" data-i18n="settings_past_messages_hint">${esc(t("settings_past_messages_hint"))}</span></label>
        <input type="text" id="u_hist" value="${uo.history_turns??""}" placeholder="${ud.history_turns||16}"></div>
      <div class="field" style="margin:0"><label><span data-i18n="settings_max_tokens">${esc(t("settings_max_tokens"))}</span> <span class="hint" data-i18n="settings_max_tokens_hint">${esc(t("settings_max_tokens_hint"))}</span></label>
        <input type="text" id="u_max" value="${uo.max_tokens??""}" placeholder="${ud.max_tokens||4096}"></div>
    </div>
    <label class="switch" style="margin-bottom:10px;margin-top:12px;"><input type="checkbox" id="u_think" ${(uo.enable_thinking!==undefined?uo.enable_thinking:ud.enable_thinking)?"checked":""}> <span data-i18n="settings_thinking_default">${esc(t("settings_thinking_default"))}</span></label>
    <label class="switch" style="margin-bottom:16px;"><input type="checkbox" id="u_scene" ${(uo.scene_style!==undefined?uo.scene_style:ud.scene_style)?"checked":""}> ${esc(t("settings_scene"))} <span class="hint">${esc(t("settings_scene_hint"))}</span></label>`;

  const advancedTab=`
    <div style="font-size:12px;margin:0 0 14px;color:var(--muted);">${esc(t("set_inherit"))}</div>
    ${sliderGrid(
      sf("u_temp",t("samp_temp"),uo.temperature??"",{min:0,max:2,step:0.01,fallback:ud.temperature??0.85}),
      sf("u_topp","Top-p",uo.top_p??"",{min:0,max:1,step:0.01,fallback:ud.top_p??0.9}),
      sf("u_topk","Top-k",uo.top_k??"",{min:0,max:100,step:1,fallback:ud.top_k??0}),
      sf("u_minp","Min-p",uo.min_p??"",{min:0,max:1,step:0.01,fallback:ud.min_p??0}),
      sf("u_topa","Top-a",uo.top_a??"",{min:0,max:1,step:0.01,fallback:ud.top_a??0}),
      sf("u_typ","Typical-p",uo.typical_p??"",{min:0,max:1,step:0.01,fallback:ud.typical_p??1}),
      sf("u_rep",t("samp_rep"),uo.repetition_penalty??"",{min:0.5,max:2,step:0.01,fallback:ud.repetition_penalty??1}),
      sf("u_freq",t("samp_freq"),uo.frequency_penalty??"",{min:0,max:2,step:0.01,fallback:ud.frequency_penalty??0}),
      sf("u_pres",t("samp_pres"),uo.presence_penalty??"",{min:0,max:2,step:0.01,fallback:ud.presence_penalty??0}),
    )}
    ${row(f("u_seed",t("samp_seed"),uo.seed??"",t("samp_seed_hint")))}
    <div class="field" style="margin:0 0 16px"><label>${esc(t("samp_stop"))} <span class="hint">${esc(t("samp_stop_hint"))}</span></label><textarea id="u_stop" style="min-height:52px;font-family:var(--mono);font-size:12.5px">${esc((uo.stop||[]).join("\n"))}</textarea></div>
    <h3 class="sec" data-i18n="settings_prompt_injection">${esc(t("settings_prompt_injection"))}</h3>
    <div class="field"><label>${esc(t("set_suffix"))} <span class="hint">${esc(t("set_suffix_hint"))}</span></label>
      <textarea id="u_suffix" style="min-height:68px">${esc(uo.system_suffix||"")}</textarea></div>
    <div class="field" style="margin:0"><label>${esc(t("set_posthist"))} <span class="hint">${esc(t("set_posthist_hint"))}</span></label>
      <textarea id="u_posthist" style="min-height:68px">${esc(uo.post_history||"")}</textarea></div>`;


  openModal(`<h3 data-i18n="settings_title">${esc(t("settings_title"))}</h3>
    <div class="set-tabs" id="setTabs">
      <button type="button" class="set-tab on" data-tab="general">${esc(t("settings_tab_general"))}</button>
      <button type="button" class="set-tab" data-tab="model">${esc(t("settings_tab_model"))}</button>
      <button type="button" class="set-tab" data-tab="advanced">${esc(t("settings_tab_advanced"))}</button>
    </div>
    <div class="set-panel" data-panel="general">${generalTab}</div>
    <div class="set-panel" data-panel="model" style="display:none">${modelTab}</div>
    <div class="set-panel" data-panel="advanced" style="display:none">${advancedTab}</div>
    <div class="modal-foot" id="footUser" style="margin-top:16px;">
      <button class="btn primary" id="u_save" data-i18n="btn_save_settings">${esc(t("btn_save_settings"))}</button>
      <button class="btn danger" id="u_reset" data-i18n="btn_reset_defaults">${esc(t("btn_reset_defaults"))}</button>
      <button class="btn" id="s_cancel" style="margin-left:auto;" data-i18n="btn_close">${esc(t("btn_close"))}</button>
    </div>`, "modal-wide");

  $("#setTabs").querySelectorAll(".set-tab").forEach(b=>b.onclick=()=>{
    $("#setTabs").querySelectorAll(".set-tab").forEach(x=>x.classList.toggle("on",x===b));
    document.querySelectorAll(".set-panel").forEach(p=>p.style.display=p.dataset.panel===b.dataset.tab?"block":"none");
  });

  const nsfwToggle=$("#u_nsfw");
  if(nsfwToggle) nsfwToggle.onclick=async()=>{
    const anchor=nsfwToggle.closest("label")||nsfwToggle;
    if(!nsfwToggle.checked){
      try{ await api("/api/me/nsfw", j("PUT",{allowed:false})); if(ME) ME.nsfw_allowed=false; toast(t("nsfw_disabled_toast")); }
      catch(err){ nsfwToggle.checked=true; errorToast(t("nsfw_update_failed")+": "+err.message); }
      return;
    }
    nsfwToggle.checked=false;
    const ok = await confirmAction(anchor, t("nsfw_c1"), t("nsfw_c1_go"))
      && await confirmAction(anchor, t("nsfw_c2"), t("nsfw_c2_go"))
      && await confirmAction(anchor, t("nsfw_c3"), t("nsfw_c3_go"))
      && await confirmAction(anchor, t("nsfw_c4"), t("nsfw_c4_go"));
    if(!ok){ nsfwToggle.checked=false; return; }
    try{ await api("/api/me/nsfw", j("PUT",{allowed:true})); if(ME) ME.nsfw_allowed=true;
      nsfwToggle.checked=true;
      document.querySelectorAll(".nsfw-blur").forEach(el=>el.classList.remove("nsfw-blur"));
      toast(t("nsfw_enabled_toast")); }
    catch(err){ nsfwToggle.checked=false; errorToast(t("nsfw_update_failed")+": "+err.message); }
  };
  if(_settingsFocusNsfw){ _settingsFocusNsfw=false;
    setTimeout(()=>{ const sec=$("#nsfwSettingSection"); if(sec){ sec.scrollIntoView({behavior:"smooth",block:"center"}); const cb=$("#u_nsfw"); if(cb) cb.focus(); } },60); }

  document.querySelectorAll(".sf-range").forEach(r=>{
    const numEl=document.getElementById(r.dataset.target);
    if(!numEl) return;
    r.addEventListener("input",()=>{ numEl.value=r.value; numEl.dispatchEvent(new Event("input")); });
    numEl.addEventListener("input",()=>{ const v=parseFloat(numEl.value); if(!isNaN(v)) r.value=v; });
  });

  attachLangAC($("#u_iface_lang")); attachLangAC($("#s_deflang"));
  ["ap_font","ap_msgfont","ap_narration_font","ap_dialogue_font","ap_thoughts_font","ap_voice_font","ap_bold_font"]
    .forEach(id=>attachFontAC($("#"+id)));
  ["ap_text","ap_accent","ap_appbg","ap_chatbg"].forEach(id=>attachColorAC($("#"+id)));
  $("#themeSeg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{ applyTheme(b.dataset.theme);
    $("#themeSeg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b)); });

  const AP_FIELDS=["ap_font","ap_text","ap_accent","ap_scale","ap_appbg","ap_chatbg","ap_msgfont",
    "ap_narration_font","ap_dialogue_font","ap_thoughts_font","ap_voice_font","ap_bold_font"];
  const readFlags=cat=>{
    const grp=document.querySelector(`.style-toggle-group[data-category="${cat}"]`);
    if(!grp) return undefined;
    return [...grp.querySelectorAll(".style-toggle-btn.on")].map(b=>b.dataset.flag).join("");
  };
  const swatchVal=id=>$("#"+id)?.dataset.value;
  const liveAppearance=()=>saveAppearance({ font:$("#ap_font")?.value.trim(), text:$("#ap_text")?.value.trim(),
    accent:$("#ap_accent")?.value.trim(), scale:$("#ap_scale")?.value.trim(),
    appBg:$("#ap_appbg")?.value.trim(), chatBg:$("#ap_chatbg")?.value.trim(),
    msgFont:$("#ap_msgfont")?.value.trim(),
    narrationColor:swatchVal("ap_narration"), narrationFont:$("#ap_narration_font")?.value.trim(), narrationFlags:readFlags("narration"),
    dialogueColor:swatchVal("ap_dialogue"), dialogueFont:$("#ap_dialogue_font")?.value.trim(), dialogueFlags:readFlags("dialogue"),
    thoughtColor:swatchVal("ap_thoughts"), thoughtFont:$("#ap_thoughts_font")?.value.trim(), thoughtFlags:readFlags("thought"),
    voiceColor:swatchVal("ap_voice"), voiceFont:$("#ap_voice_font")?.value.trim(), voiceFlags:readFlags("voice"),
    boldColor:swatchVal("ap_bold"), boldFont:$("#ap_bold_font")?.value.trim(), boldFlags:readFlags("bold") });
  AP_FIELDS.forEach(id=>{ const el=$("#"+id); if(el) el.addEventListener("input",liveAppearance); });
  document.querySelectorAll(".style-toggle-btn").forEach(b=>b.onclick=()=>{ b.classList.toggle("on"); liveAppearance(); });
  document.querySelectorAll(".ap-swatch").forEach(sw=>{
    sw.addEventListener("click",()=>{
      const target=sw.dataset.for?document.getElementById(sw.dataset.for):null;
      const current=sw.dataset.value || target?.value || sw.dataset.default || "#E3BD6C";
      openColorPicker(sw, current, hex=>{
        sw.style.background=hex;
        if(target){ target.value=hex; target.dispatchEvent(new Event("input")); }
        else { sw.dataset.value=hex; liveAppearance(); }
      });
    });
  });
  const resetAppearance=()=>{
    APPEARANCE={}; store.set("appearance","{}"); applyAppearance();
    AP_FIELDS.forEach(id=>{ const e=$("#"+id); if(e) e.value=""; });
    document.querySelectorAll(".style-toggle-group").forEach(g=>{
      const def=g.dataset.default||"";
      g.querySelectorAll(".style-toggle-btn").forEach(b=>b.classList.toggle("on", def.includes(b.dataset.flag)));
    });
    document.querySelectorAll(".ap-swatch[data-default]").forEach(sw=>{ sw.dataset.value=sw.dataset.default; sw.style.background=sw.dataset.default; });
    document.querySelectorAll(".ap-color-picker").forEach(sw=>{ sw.style.background="#E3BD6C"; });
  };
  $("#ap_reset").onclick=resetAppearance;

  const MD_FIELDS=["ap_msgfont","ap_narration_font","ap_dialogue_font","ap_thoughts_font","ap_voice_font","ap_bold_font"];
  $("#ap_md_reset").onclick=()=>{
    MD_FIELDS.forEach(id=>{ const e=$("#"+id); if(e) e.value=""; });
    ["narration","dialogue","thoughts","voice","bold"].forEach(cat=>{
      const g=document.querySelector(`.style-toggle-group[data-category="${cat==="thoughts"?"thought":cat}"]`);
      if(g){ const def=g.dataset.default||""; g.querySelectorAll(".style-toggle-btn").forEach(b=>b.classList.toggle("on", def.includes(b.dataset.flag))); }
    });
    document.querySelectorAll(".ap-md-controls .ap-swatch[data-default]").forEach(sw=>{ sw.dataset.value=sw.dataset.default; sw.style.background=sw.dataset.default; });
    liveAppearance();
  };

  $("#pw_open_modal_btn").onclick=()=>{
    openModal(`<h3>🔒 ${esc(t("settings_password_heading"))}</h3>
      <div class="field" style="margin:0 0 12px"><label>${esc(t("settings_password_current"))}</label>
        <input type="password" id="pw_old" autocomplete="current-password"></div>
      <div class="field" style="margin:0 0 12px"><label>${esc(t("settings_password_new"))} <span class="hint">${esc(t("settings_password_new_hint"))}</span></label>
        <input type="password" id="pw_new" autocomplete="new-password"></div>
      <div class="field" style="margin:0 0 12px"><label>${esc(t("settings_password_confirm"))}</label>
        <input type="password" id="pw_confirm" autocomplete="new-password"></div>
      <div class="modal-foot">
        <button type="button" class="btn" id="pw_cancel">${esc(t("btn_cancel"))}</button>
        <button type="button" class="btn primary" id="pw_change_btn">${esc(t("settings_password_change_btn"))}</button>
      </div>`, null, {stack:true});
    $("#pw_cancel").onclick=closeModal;
    $("#pw_change_btn").onclick=async()=>{
      const oldPw=$("#pw_old").value, newPw=$("#pw_new").value, confirmPw=$("#pw_confirm").value;
      if(!oldPw || !newPw) return;
      if(newPw!==confirmPw){ toast(t("settings_password_mismatch")); return; }
      try{
        await api("/api/auth/password", j("PUT",{old_password:oldPw, new_password:newPw}));
        toast(t("settings_password_changed"));
        closeModal();
      }catch(e){ errorToast(e.message); }
    };
  };

  // Toggle own endpoint visibility
  const useOwn=$("#u_use_own"), ownFields=$("#u_own_fields");
  if(useOwn&&ownFields) useOwn.onchange=()=>{ ownFields.style.display=useOwn.checked?"block":"none"; };

  const fillModelList=(listId, inputId, models, hint)=>{
    const el=$("#"+listId);
    if(!el) return;
    const hintHtml=hint?`<span style="font-size:11px;color:var(--muted);align-self:center;">${esc(hint)}</span>`:"";
    el.innerHTML=`<button class="model-pill-close" type="button" title="Dismiss">×</button>${hintHtml}`
      +models.map(m=>`<button class="model-pill" type="button">${esc(m)}</button>`).join("");
    el.style.display="flex";
    el.querySelector(".model-pill-close").onclick=()=>{ el.style.display="none"; };
    el.querySelectorAll(".model-pill").forEach(p=>p.onclick=()=>{
      const inp=$("#"+inputId); if(inp){ inp.value=p.textContent; inp.dispatchEvent(new Event("input")); }
      el.style.display="none";
    });
  };

  // Fetch models for user's own endpoint
  const uFetch=$("#u_fetch");
  if(uFetch) uFetch.onclick=async()=>{
    uFetch.textContent="…";
    try{
      const base=$("#u_base")?.value.trim()||ud.base_url||"";
      const key=$("#u_key")?.value.trim()||"";
      const params=new URLSearchParams(); if(base) params.set("base_url",base); if(key) params.set("api_key",key);
      const {models}=await api("/api/models"+(params.toString()?"?"+params:""));
      if(models?.length) fillModelList("u_model_list","u_chat",models);
      else toast("No models returned");
    }catch(e){ errorToast("Fetch failed: "+e.message); }
    uFetch.textContent="Fetch";
  };

  // Per-user save
  $("#u_save").onclick=async()=>{
    const numOrNull=id=>{ const v=parseFloat($("#"+id)?.value??""); return isNaN(v)?null:v; };
    const intOrNull=id=>{ const v=parseInt($("#"+id)?.value??""  ,10); return isNaN(v)?null:v; };
    const body={
      history_turns:intOrNull("u_hist"), max_tokens:intOrNull("u_max"),
      enable_thinking:!!($("#u_think")?.checked),
      scene_style:!!($("#u_scene")?.checked),
      temperature:numOrNull("u_temp"), top_p:numOrNull("u_topp"), top_k:intOrNull("u_topk"),
      min_p:numOrNull("u_minp"), top_a:numOrNull("u_topa"), typical_p:numOrNull("u_typ"),
      repetition_penalty:numOrNull("u_rep"), frequency_penalty:numOrNull("u_freq"),
      presence_penalty:numOrNull("u_pres"), seed:intOrNull("u_seed"),
      stop:(()=>{ const v=($("#u_stop")?.value||"").split("\n").map(s=>s.trim()).filter(Boolean); return v.length?v:null; })(),
      system_suffix:$("#u_suffix")?.value.trim()||null,
      post_history:$("#u_posthist")?.value.trim()||null,
      interface_language:$("#u_iface_lang")?.value.trim()||null,
    };
    if($("#u_use_own")?.checked){
      body.base_url=$("#u_base")?.value.trim()||null;
      body.chat_model=$("#u_chat")?.value.trim()||null;
      const k=$("#u_key")?.value; if(k) body.api_key=k;
    } else {
      body.base_url=null; body.chat_model=null;
      body.api_key=null;
    }
    try{
      await api("/api/me/settings",j("PUT",body));
      document.querySelectorAll("#s_model_list,#u_model_list").forEach(el=>el.style.display="none");
      closeModal();
      const _newLang=await effectiveUiLang(body.interface_language||"");
      if(_newLang.toLowerCase()!==(store.get("iface_lang","")||"english").toLowerCase()
         && !(_newLang.toLowerCase()==="english" && !store.get("iface_lang",""))){
        // language changed: hard-reload so every view, cached content string, and
        // chrome re-renders in the new language — no half-translated UI
        store.set("iface_lang", _newLang.toLowerCase()==="english"?"":_newLang);
        location.reload(); return;
      }
      toast("Settings saved.");
      loadUiTranslations(_newLang);
    }catch(e){ errorToast("Save failed: "+e.message); }
  };

  // Per-user reset
  $("#u_reset").onclick=()=>{
    confirmPopover($("#u_reset"), "Reset all your personal settings (including appearance and message formatting) to defaults?", t("btn_reset_defaults"), async()=>{
      try{
        await api("/api/me/settings",{method:"DELETE"}); resetAppearance(); closeModal();
        const _newLang=await effectiveUiLang("");
        if(_newLang.toLowerCase()!==(store.get("iface_lang","")||"english").toLowerCase()){
          store.set("iface_lang", _newLang.toLowerCase()==="english"?"":_newLang);
          location.reload(); return;
        }
        toast("Settings reset to defaults."); loadUiTranslations(_newLang);
      }
      catch(e){ errorToast("Reset failed: "+e.message); }
    });
  };

  $("#s_cancel").onclick=()=>{ applyTheme(prevTheme); closeModal(); };
};
$("#themeBtn").onclick=toggleTheme;
$("#privacyBtn").onclick=togglePrivacyMode;
$("#logoutBtn").onclick=_doLogout;
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });

/* ============================ LIVE UPDATE CHECK ============================
   A SPA tab never re-fetches the js/css bundle on its own — client-side routing
   only swaps #main's innerHTML, it doesn't reload <script>/<link> tags. So even
   with no-cache headers on those files (see server.py), a tab left open across
   a deploy keeps running the JS it loaded at page-open time. This polls a tiny
   fingerprint of the served static files and offers a one-click reload the
   moment they change, instead of relying on the user to remember to hard-refresh. */
let _siteVersion=null;
async function _fetchVersionInfo(){
  try{ const r=await fetch("/version",{cache:"no-store"}); if(r.ok) return await r.json(); }
  catch(e){ /* offline or mid-deploy — just try again next tick */ }
  return null;
}
async function _fetchVersion(){
  const info=await _fetchVersionInfo();
  return info?info.v:null;
}
function _showUpdateBanner(){
  if($("#updateBanner")) return;
  // Auto-reloads instead of waiting on a click — nothing of the user's is
  // actually at risk: chat drafts (see the "draft:"+sid persistence above),
  // Create-panel state, and similar in-progress work are all already
  // continuously saved to localStorage as the user types/selects, which
  // survives a reload the same as any other page load. Still gives visible
  // notice + a countdown rather than yanking the page out from under them
  // with zero warning.
  let secs=15;
  const b=el(`<div id="updateBanner" class="update-banner">A new version is available — reloading in <span id="updateBannerSecs">${secs}</span>s.<button type="button" id="updateReload">Reload now</button></div>`);
  document.body.appendChild(b);
  $("#updateReload").onclick=()=>location.reload();
  const timer=setInterval(()=>{
    secs--;
    const s=$("#updateBannerSecs"); if(s) s.textContent=secs;
    if(secs<=0){ clearInterval(timer); location.reload(); }
  },1000);
}
async function startVersionWatch(){
  const info=await _fetchVersionInfo();
  _siteVersion=info?info.v:null;
  const tag=$("#railAppVersion");
  if(tag && info?.app_version) tag.textContent="v"+info.app_version;
  const check=async()=>{
    const v=await _fetchVersion();
    if(v && _siteVersion && v!==_siteVersion) _showUpdateBanner();
  };
  setInterval(check, 60000);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") check(); });
}

/* ============================ NOTIFICATIONS ============================
   Discord-style bell + dropdown panel in the rail foot. The unread count is
   polled on the same 60s cadence as the version watcher and refreshed on every
   SPA navigation; the panel itself is only fetched when opened. */
// Every notification `type` written anywhere in the backend collapses into
// one of these buckets — add new types here as they're introduced, or they
// silently fall under "All" only (still visible, just not filterable).
const _NOTIF_ICON_SHIELD='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
const _NOTIF_ICON_CHAT='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const _NOTIF_ICON_TROPHY='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4a1 1 0 0 0-1 1c0 3 2 5 4 5M17 5h3a1 1 0 0 1 1 1c0 3-2 5-4 5"/></svg>';
function notifCategory(type){
  if((type||"").startsWith("admin_")) return "admin";
  if(type==="comment"||type==="mention") return "comments";
  if(type==="milestone") return "milestones";
  return "";
}
const NOTIF_FILTERS=[
  {key:"all", labelKey:"notif_filter_all", icon:""},
  {key:"admin", labelKey:"notif_filter_admin", icon:_NOTIF_ICON_SHIELD},
  {key:"comments", labelKey:"notif_filter_comments", icon:_NOTIF_ICON_CHAT},
  {key:"milestones", labelKey:"notif_filter_milestones", icon:_NOTIF_ICON_TROPHY},
];
function setNotifBadge(n){
  const b=$("#notifBadge"); if(!b) return;
  if(n>0){ b.textContent=n>99?"99+":String(n); b.hidden=false; }
  else{ b.hidden=true; }
}
async function refreshNotifCount(){
  if(!ME) return;
  try{ const {count}=await api("/api/notifications/unread-count"); setNotifBadge(count); }
  catch(e){ /* transient — retry next tick */ }
}
function closeNotifPanel(){ $("#notifPanel")?.remove(); }
async function openNotifPanel(){
  closeNotifPanel();
  let activeFilter=store.get("notifFilter","all");
  if(!NOTIF_FILTERS.some(f=>f.key===activeFilter)) activeFilter="all";
  const panel=el(`<div id="notifPanel" class="notif-panel" role="dialog" aria-label="${esc(t("notif_title"))}">
    <div class="notif-head">
      <span>${esc(t("notif_title"))}</span>
      <div class="notif-head-actions">
        <button type="button" class="notif-markall" id="notifMarkAll">${esc(t("notif_mark_all_read"))}</button>
        <button type="button" class="notif-markall" id="notifClearAll">${esc(t("notif_clear_all"))}</button>
      </div>
    </div>
    <div class="notif-filters" id="notifFilters">${NOTIF_FILTERS.map(f=>
      `<button type="button" class="notif-filter-pill${f.key===activeFilter?" on":""}" data-f="${f.key}" title="${esc(t(f.labelKey))}" aria-label="${esc(t(f.labelKey))}">${f.icon}${f.icon?"":esc(t(f.labelKey))}</button>`
    ).join("")}</div>
    <div class="notif-list" id="notifList"><div class="notif-empty">…</div></div>
  </div>`);
  document.body.appendChild(panel);
  const btn=$("#notifBtn");
  if(btn){
    const r=btn.getBoundingClientRect();
    panel.style.left=Math.round(r.left)+"px";
    panel.style.bottom=Math.round(window.innerHeight-r.top+8)+"px";
  }
  $("#notifMarkAll").onclick=async()=>{
    try{ await api("/api/notifications/read-all", {method:"POST"}); }catch(e){}
    setNotifBadge(0); openNotifPanel();
  };
  $("#notifClearAll").onclick=async()=>{
    if(!(await confirmAction($("#notifClearAll"), t("notif_clear_all_confirm")))) return;
    try{ await api("/api/notifications", {method:"DELETE"}); }catch(e){}
    setNotifBadge(0); openNotifPanel();
  };
  let items=[], loadFailed=false;
  try{ items=await api("/api/notifications"); }catch(e){ items=[]; loadFailed=true; }
  const list=$("#notifList"); if(!list) return;
  const paintList=()=>{
    if(loadFailed){ list.innerHTML=`<div class="notif-empty">${esc(t("notif_load_error"))} <button type="button" class="btn" id="notifRetryBtn">${esc(t("btn_retry"))}</button></div>`; const rb=$("#notifRetryBtn"); if(rb) rb.onclick=openNotifPanel; return; }
    const shown=activeFilter==="all" ? items : items.filter(n=>notifCategory(n.type)===activeFilter);
    if(!shown.length){ list.innerHTML=`<div class="notif-empty">${esc(t("notif_empty"))}</div>`; return; }
    list.innerHTML=shown.map(n=>`
      <button type="button" class="notif-item${n.read?"":" unread"}" data-id="${esc(n.id)}" data-link="${esc(n.link||"")}">
        <span class="notif-dot"></span>
        <span class="notif-body">
          <span class="notif-item-title">${esc(n.title||"")}</span>
          ${n.body?`<span class="notif-item-text">${esc(n.body)}</span>`:""}
          <span class="notif-item-time">${esc(timeAgo(n.created))}</span>
        </span>
      </button>`).join("");
    list.querySelectorAll(".notif-item").forEach(it=>{
      it.onclick=async()=>{
        const id=it.dataset.id, link=it.dataset.link;
        if(it.classList.contains("unread")){
          it.classList.remove("unread");
          try{ await api(`/api/notifications/${id}/read`, {method:"POST"}); }catch(e){}
          refreshNotifCount();
        }
        closeNotifPanel();
        if(link) navigate(link);
      };
    });
  };
  $("#notifFilters").querySelectorAll(".notif-filter-pill").forEach(p=>p.onclick=()=>{
    activeFilter=p.dataset.f; store.set("notifFilter",activeFilter);
    $("#notifFilters").querySelectorAll(".notif-filter-pill").forEach(x=>x.classList.toggle("on",x===p));
    paintList();
  });
  if(!items.length){ list.innerHTML=`<div class="notif-empty">${esc(t("notif_empty"))}</div>`; return; }
  paintList();
}
$("#notifBtn")?.addEventListener("click", (e)=>{
  e.preventDefault(); e.stopPropagation();
  if($("#notifPanel")) closeNotifPanel(); else openNotifPanel();
});
document.addEventListener("click", (e)=>{
  const p=$("#notifPanel"); if(!p) return;
  if(!p.contains(e.target) && !e.target.closest("#notifBtn")) closeNotifPanel();
});
