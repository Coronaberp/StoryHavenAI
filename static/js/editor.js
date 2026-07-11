"use strict";
/* ============================ EDITOR ============================ */
async function viewEditor(main, cid, importPrefill){
  const c = cid ? await api("/api/characters/"+cid)
                : importPrefill ? {name:importPrefill.name, persona:importPrefill.persona,
                    scenario:importPrefill.scenario, greeting:importPrefill.greeting,
                    dialogue:importPrefill.dialogue, system_prompt:importPrefill.system_prompt,
                    tags:importPrefill.tags||[], creator:"you", mode:importPrefill.mode||"character",
                    alt_greetings:importPrefill.alt_greetings||[], assets:importPrefill.assets||{},
                    is_explicit:importPrefill.is_explicit, presentation_html:importPrefill.presentation_html||""}
                : {name:"",persona:"",scenario:"",greeting:"",dialogue:"",tags:[],creator:"you",mode:"character"};
  const canGenerate = !cid || !!c.is_draft;
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(cid?t("ed_edit"):t("ed_new"))}</div>
    <h1 class="page">${cid?esc(c.name):esc(t("ed_create_title"))}</h1>
    <div class="page-sub">${esc(t("ed_sub"))}</div>
    ${cid?"":`<div class="dropzone" id="drop">
      <div class="t">${esc(t("ed_import_t"))}</div>
      <div class="s"><span class="browse">${esc(t("ed_import_s"))}</span></div>
      <input type="file" id="file" accept=".png,.json" hidden></div>`}
    <div class="field"><label>${esc(t("ed_mode"))} <span class="hint">${esc(t("ed_mode_hint"))}</span></label>
      <div class="seg" id="modeSeg">
        <button type="button" class="seg-btn ${(c.mode||'character')!=='rpg'?'on':''}" data-mode="character"><b>${esc(t("ed_mode_char"))}</b><span>${esc(t("ed_mode_char_hint"))}</span></button>
        <button type="button" class="seg-btn ${(c.mode||'character')==='rpg'?'on':''}" data-mode="rpg"><b>${esc(t("ed_mode_rpg"))}</b><span>${esc(t("ed_mode_rpg_hint"))}</span></button>
      </div>
    </div>
    ${c.is_explicit?`<div class="field-group" style="border-color:var(--warn);">
      <div class="field-group-label" style="color:var(--warn);">${esc(t("ed_flagged_label"))}</div>
      <p class="hint">${esc(t("ed_flagged_hint"))}</p>
      <button type="button" class="btn" id="ed_request_review">🚩 ${esc(t("pf_request_review"))}</button>
    </div>`:""}
    <div class="field"><label>${esc(t("ed_avatar"))} <span class="hint">${esc(t("ed_avatar_hint"))}</span></label>
      <div class="ava-edit" id="avaEdit">
        <div class="img-pick-box ava-edit-box" id="avaBox">
          ${c.avatar
            ? `${avatar(c,"ava-edit-img")}<button type="button" class="img-pick-x" id="avaClear" title="${esc(t("ed_remove"))}">✕</button>`
            : `<div class="img-pick-empty ava-edit-img" id="avaEmpty" title="${esc(t("ed_upload"))}">${UPLOAD_ICON_SVG}</div>`}
        </div>
        <div class="ava-edit-right">
          <div class="ava-edit-btns">
            <button type="button" class="btn" id="avaGen">🎨 ${esc(t("ig_generate"))}</button>
          </div>
          <div class="ava-url-row">
            <input type="text" id="avaUrl" placeholder="${esc(t("ed_ava_url_ph"))}" value="${esc(c.avatar&&c.avatar.startsWith('http')?c.avatar:'')}">
          </div>
        </div>
        <input type="file" id="avaFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </div>
    </div>
    <div class="field"><label>${esc(t("ed_banner"))} <span class="hint">${esc(t("ed_banner_hint"))}</span></label>
      <div class="banner-edit" id="bannerEdit"${((c.assets||{}).banner)?` style="background-image:url('${esc(mediaURL((c.assets||{}).banner))}')"`:""}>
        <div class="banner-empty" id="bannerEmpty"${((c.assets||{}).banner)?` style="display:none"`:""}>${UPLOAD_ICON_SVG}</div>
        <button type="button" class="img-pick-x" id="bannerClear" title="${esc(t("ed_remove"))}"${((c.assets||{}).banner)?"":` style="display:none"`}>✕</button>
      </div>
      <div class="ava-edit-right" style="margin-top:10px;">
        <div class="ava-edit-btns">
          <button type="button" class="btn" id="bannerGen">🎨 ${esc(t("ig_generate"))}</button>
        </div>
        <div class="ava-url-row">
          <input type="text" id="f_banner" placeholder="https://…/banner.jpg" value="${esc((c.assets||{}).banner||"")}">
        </div>
      </div>
      <input type="file" id="bannerFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </div>
    ${canGenerate?`
    <div class="seg" id="edSourceTabs" style="margin-bottom:16px;">
      <button type="button" class="seg-btn on" data-src="manual"><b>${esc(t("ed_src_manual"))}</b><span>${esc(t("ed_src_manual_hint"))}</span></button>
      <button type="button" class="seg-btn" data-src="generate"><b>${esc(t("ed_src_generate"))}</b><span>${esc(t("ed_src_generate_hint"))}</span></button>
    </div>
    <div class="field" id="generatePanel" style="display:none;">
      <label>${esc(t("ed_gen_label"))} <span class="hint">${esc(t("ed_gen_hint"))}</span></label>
      <textarea id="f_gen_desc" style="min-height:140px" placeholder="${esc(t("ed_gen_ph"))}"></textarea>
      <button type="button" class="btn primary" id="genBtn" style="margin-top:10px;">✨ ${esc(t("ed_gen_btn"))}</button>
    </div>`:""}
    <div id="manualFields">
    <div class="field"><label>${esc(t("ed_name"))} <span class="counter" id="nC"></span></label><input type="text" id="f_name" value="${esc(c.name)}"></div>
    <div class="field"><label>${esc(t("ed_description"))} <span class="hint">${esc(t("ed_description_hint"))}</span></label>
      <textarea id="f_description" style="min-height:80px">${esc(c.description||"")}</textarea></div>
    <div class="field"><label>${esc(t("ed_persona"))} <span class="hint">${esc(t("ed_persona_hint"))}</span><span class="counter" id="pC"></span></label>
      <textarea id="f_persona" style="min-height:160px">${esc(c.persona)}</textarea>${macroRow("f_persona")}</div>
    <div class="field"><label>${esc(t("ed_scenario"))} <span class="hint">${esc(t("ed_scenario_hint"))}</span></label>
      <textarea id="f_scenario">${esc(c.scenario)}</textarea>${macroRow("f_scenario")}</div>
    <div class="field"><label>${esc(t("ed_opening"))} <span class="hint">${esc(t("ed_opening_hint"))}</span></label>
      <textarea id="f_greeting" style="min-height:120px">${esc(c.greeting)}</textarea>${macroRow("f_greeting")}</div>
    <div class="field"><label>${esc(t("ed_dialogue"))} <span class="hint">${esc(t("ed_dialogue_hint"))}</span></label>
      <textarea id="f_dialogue" placeholder="{{user}}: Hello, how are you?&#10;{{char}}: *adjusts glasses* I'm well, thank you for asking.">${esc(c.dialogue)}</textarea>${macroRow("f_dialogue")}</div>
    <div class="field"><label>${esc(t("ed_tags"))} <span class="hint">${esc(t("ed_tags_hint"))}</span></label>
      <div class="tags-input" id="f_tags_pills"></div>
      <input type="hidden" id="f_tags" value="${esc((c.tags||[]).join(", "))}"></div>
    <div class="field"><label>${esc(t("ed_creator"))} <span class="hint">${esc(t("ed_creator_hint"))}</span></label><input type="text" id="f_creator" value="${esc(c.creator||"")}"></div>
    <div class="field"><label>${esc(t("ed_sysprompt"))} <span class="hint">${esc(t("ed_sysprompt_hint"))}</span></label>
      <textarea id="f_sysprompt" style="min-height:80px">${esc(c.system_prompt||"")}</textarea>${macroRow("f_sysprompt")}</div>
    <div class="field"><label>${esc(t("ed_altgreet"))} <span class="hint">${esc(t("ed_altgreet_hint"))}</span></label>
      <div id="altGreets">${(c.alt_greetings||[]).map(g=>`<div class="gl-row" style="margin-bottom:8px;"><textarea class="ag-t" style="flex:1;min-height:64px">${esc(g)}</textarea><button type="button" class="tool danger gl-x">✕</button></div>`).join("")}</div>
      <button type="button" class="btn" id="agAdd">+ ${esc(t("ed_add_greeting"))}</button></div>
    <label class="switch" style="margin-bottom:20px;"><input type="checkbox" id="f_community" ${c.is_public?"checked":""}> ${esc(t("ed_share"))}</label>
    <label class="switch" id="canBePersonaRow" style="margin-bottom:20px;${(c.mode||"character")==="rpg"?"display:none;":""}"><input type="checkbox" id="f_can_be_persona" ${c.can_be_persona?"checked":""}> ${esc(t("ed_can_be_persona"))}</label>
    <label class="switch" style="margin-bottom:20px;"><input type="checkbox" id="f_allow_download" ${c.allow_download?"checked":""}> ${esc(t("ed_allow_download"))}</label>
    <label class="switch" style="margin-bottom:20px;"><input type="checkbox" id="f_is_explicit" ${c.is_explicit?"checked":""}> ${esc(t("ed_is_explicit"))}</label>
    <details class="stage-editor"${(c.assets&&Object.keys(c.assets).length)?" open":""}>
      <summary>🎬 ${esc(t("stage_summary"))}</summary>
      <div class="stage-body">
        <div class="page-sub" style="font-size:13px;margin:0 0 16px;">${esc(t("stage_sub"))}</div>
        <div class="stage-grid">
          <div><label>${esc(t("stage_bg"))}</label><div class="media-field"><input type="text" id="a_bg" placeholder="https://…/room.jpg" value="${esc(((c.assets||{}).stage||{}).default||"")}"><button type="button" class="btn s-upload" data-target="a_bg" data-accept="image/*" title="Upload">⬆</button></div></div>
          <div><label>${esc(t("stage_music"))}</label><div class="media-field"><input type="text" id="a_music" placeholder="https://…/theme.mp3" value="${esc(((c.assets||{}).music||{}).default||"")}"><button type="button" class="btn s-upload" data-target="a_music" data-accept="audio/*" title="Upload">⬆</button></div></div>
          <div><label>${esc(t("stage_sprite"))}</label><div class="media-field"><input type="text" id="a_sprite" placeholder="https://…/neutral.png" value="${esc(((c.assets||{}).sprites||{}).default||"")}"><button type="button" class="btn s-upload" data-target="a_sprite" data-accept="image/*" title="Upload">⬆</button></div></div>
        </div>
        <label class="moods-label">${esc(t("stage_moods"))}</label>
        <div class="mood-head"><span>${esc(t("mood_col"))}</span><span>${esc(t("mood_bg"))}</span><span>${esc(t("mood_music"))}</span><span>${esc(t("mood_sprite"))}</span><span></span></div>
        <div id="moodRows"></div>
        <button type="button" class="btn" id="addMood" style="margin-top:6px;">+ ${esc(t("stage_add_mood"))}</button>
      </div>
    </details>
    <details class="stage-editor"${(c.presentation_html||"").trim()?" open":""}>
      <summary>🖌 ${esc(t("pres_summary"))}</summary>
      <div class="stage-body">
        <div class="page-sub" style="font-size:13px;margin:0 0 16px;">${esc(t("pres_sub"))}</div>
        <div class="pres-warning">${esc(t("pres_no_external_links"))}</div>
        <div class="pres-warning">${esc(t("pres_b64_warning"))}</div>
        <div class="pres-tip">${esc(t("pres_prompt_tip"))}</div>
        <div class="pres-split">
          <div class="pres-col">
            <div class="pres-col-label">${esc(t("pres_code_label"))}</div>
            <textarea id="f_presentation" placeholder="&lt;div class=&quot;my-card&quot;&gt;…&lt;/div&gt;&#10;&lt;style&gt;.my-card{…}&lt;/style&gt;">${esc(c.presentation_html||"")}</textarea>
          </div>
          <div class="pres-col">
            <div class="pres-col-label">${esc(t("pres_preview_label"))}</div>
            <div class="pres-preview" id="presPreview"></div>
          </div>
        </div>
      </div>
    </details>
    <div class="actions">
      <button class="btn primary" id="saveBtn">${esc(cid?t("ed_save"):t("ed_create"))}</button>
      ${cid?`<button type="button" class="btn" id="reimportBtn">⟳ ${esc(t("ed_reimport"))}</button>
      <input type="file" id="reimportFile" accept=".png,.json" hidden>`:""}
      <a class="btn" id="cancelBtn" href="${cid?("/c/"+c.id):"/"}">${esc(t("ed_cancel"))}</a>
    </div>
    </div>
  </div>`;

  const count=(id,c2)=>{ const f=$("#"+id); const u=()=>{$("#"+c2).textContent=f.value.length;}; f.addEventListener("input",u); u(); };
  count("f_name","nC"); count("f_persona","pC");
  wireMacros();

  const presEl=$("#f_presentation"), presPreview=$("#presPreview");
  const renderPresPreview=()=>{ mountSandboxedHTML(presPreview, substituteCharacterTemplate(presEl.value, {id:cid||"preview"}), {autoHeight:false}); };
  renderPresPreview();
  let _presT; presEl.addEventListener("input", ()=>{ clearTimeout(_presT); _presT=setTimeout(renderPresPreview,300); });

  // Avatar — curAvatar is merged into the save payload; upload goes to the server immediately
  // once the character has an id. Before that (a brand-new, unsaved character), there's nowhere
  // to attach the upload to yet — the cropped/generated blob is staged here instead and actually
  // uploaded right after the character's first save (see #saveBtn below).
  let curAvatar = c.avatar || "";
  let avaPos = (c.assets&&c.assets.avatar_pos)||"";
  let pendingAvatarBlob = null, pendingBannerBlob = null;
  // Lore parsed from an imported card — not created until the character itself
  // is actually saved (see #saveBtn below), same reasoning as the avatar/banner
  // blobs: nothing should be written anywhere until there's a real character to
  // attach it to, in case the user edits the prefilled fields and never saves.
  let pendingImportLore = (importPrefill && importPrefill.lore) || [];
  const wireAvaDrag=()=>{
    const img=$("#avaEdit").querySelector(".ava-edit-img");
    if(!img||img.tagName!=="IMG") return;
    img.style.cursor="move"; img.title=t("ed_ava_drag");
    if(avaPos) img.style.objectPosition=avaPos;
    let drag=false;
    const setPos=e=>{
      const r=img.getBoundingClientRect();
      const x=Math.max(0,Math.min(100,Math.round((e.clientX-r.left)/r.width*100)));
      const y=Math.max(0,Math.min(100,Math.round((e.clientY-r.top)/r.height*100)));
      avaPos=`${x}% ${y}%`; img.style.objectPosition=avaPos;
    };
    img.onpointerdown=e=>{ drag=true; img.setPointerCapture(e.pointerId); setPos(e); e.preventDefault(); };
    img.onpointermove=e=>{ if(drag) setPos(e); };
    img.onpointerup=img.onpointercancel=()=>{ drag=false; };
  };
  const wireAvaEmpty=()=>{ const e=$("#avaEmpty"); if(e) e.onclick=()=>$("#avaFile").click(); };
  // The avatar box toggles in place between an upload-icon empty state and the
  // filled image (draggable to reposition) with a ✕ badge to clear it.
  const renderAvaBox=(src)=>{
    $("#avaBox").innerHTML = src
      ? `<img class="ava ava-edit-img" src="${esc(src)}"${avaPos?` style="object-position:${esc(avaPos)}"`:""} alt=""><button type="button" class="img-pick-x" id="avaClear" title="${esc(t("ed_remove"))}">✕</button>`
      : `<div class="img-pick-empty ava-edit-img" id="avaEmpty" title="${esc(t("ed_upload"))}">${UPLOAD_ICON_SVG}</div>`;
    wireAvaDrag(); wireClear(); wireAvaEmpty();
  };
  const refreshAva=()=> renderAvaBox(curAvatar ? mediaURL(curAvatar) : "");
  const wireClear=()=>{ const b=$("#avaClear"); if(b) b.onclick=()=>{ curAvatar=""; pendingAvatarBlob=null; avaPos=""; $("#avaUrl").value=""; refreshAva(); }; };
  // URL input — live preview on input, applied on blur/enter
  const avaUrlEl=$("#avaUrl");
  const applyUrl=()=>{ const v=avaUrlEl.value.trim(); if(v!==curAvatar){ curAvatar=v; refreshAva(); } };
  avaUrlEl.addEventListener("blur", applyUrl);
  avaUrlEl.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); applyUrl(); } });
  // Also update preview live with small debounce
  let _avaT; avaUrlEl.addEventListener("input",()=>{ clearTimeout(_avaT); _avaT=setTimeout(()=>{ const v=avaUrlEl.value.trim(); if(v) renderAvaBox(v); },400); });
  wireAvaDrag(); wireAvaEmpty();
  const stageAvatarBlob=blob=>{
    // No cid yet — hold the blob and preview it locally; #saveBtn uploads it
    // for real right after the character is created.
    pendingAvatarBlob=blob;
    avaUrlEl.value="";
    renderAvaBox(URL.createObjectURL(blob));
    toast("Avatar will be saved when you create the character.");
  };
  if(importPrefill && importPrefill.avatar_data_url){
    fetch(importPrefill.avatar_data_url).then(r=>r.blob()).then(stageAvatarBlob).catch(()=>{});
  }
  $("#avaFile").onchange=async()=>{
    const f=$("#avaFile").files[0]; if(!f) return;
    if(f.type==="image/gif"){
      if(!cid){ stageAvatarBlob(f); $("#avaFile").value=""; return; }
      const fd=new FormData(); fd.append("file",f,f.name);
      try{ const r=await api(`/api/characters/${cid}/avatar`,{method:"POST",body:fd});
        curAvatar=r.avatar; avaUrlEl.value=""; refreshAva(); toast("Avatar updated."); }
      catch(e){ errorToast("Upload failed: "+e.message); }
      $("#avaFile").value="";
      return;
    }
    openCropper(URL.createObjectURL(f), "1", 512, 512, async blob=>{
      if(!cid){ stageAvatarBlob(blob); $("#avaFile").value=""; return; }
      const fd=new FormData(); fd.append("file",blob,"avatar.jpg");
      try{ const r=await api(`/api/characters/${cid}/avatar`,{method:"POST",body:fd});
        curAvatar=r.avatar; avaUrlEl.value=""; refreshAva(); toast("Avatar updated."); }
      catch(e){ errorToast("Upload failed: "+e.message); }
      $("#avaFile").value="";
    });
  };
  if($("#ed_request_review")) $("#ed_request_review").onclick=async e=>{
    try{
      await api("/api/report-image", j("POST", {kind:"character", label:t("report_flag_character").replace("{name}", c.name||""), target_id:cid||"", image:mediaURL(c.avatar||((c.assets||{}).banner)||""), note:t("ed_request_review_note")}));
      e.target.disabled=true; toast(t("report_sent"));
    }catch(err){ errorToast(t("report_failed")+": "+err.message); }
  };
  $("#avaGen").onclick=()=>{
    openImageGenPickerModal(genBlob=>{
      openCropper(URL.createObjectURL(genBlob), "1", 512, 512, async blob=>{
        if(!cid){ stageAvatarBlob(blob); return; }
        const fd=new FormData(); fd.append("file",blob,"avatar.jpg");
        try{ const r=await api(`/api/characters/${cid}/avatar`,{method:"POST",body:fd});
          curAvatar=r.avatar; avaUrlEl.value=""; refreshAva(); toast("Avatar updated."); }
        catch(e){ errorToast("Upload failed: "+e.message); }
      });
    }, {positive:(c.persona||"").slice(0,200)});
  };
  wireClear();

  // Banner — same crop-on-upload flow as the avatar; pasted URLs skip cropping.
  const bannerPreview=v=>{
    $("#bannerEdit").style.backgroundImage = v ? `url('${v}')` : "";
    const has=!!v;
    $("#bannerEmpty").style.display = has ? "none" : "";
    $("#bannerClear").style.display = has ? "" : "none";
  };
  const wireBannerClear=()=>{ const b=$("#bannerClear"); if(b) b.onclick=ev=>{ ev.stopPropagation(); $("#f_banner").value=""; bannerPreview(""); }; };
  wireBannerClear();
  $("#bannerEdit").onclick=e=>{ if(e.target.closest("#bannerClear")) return; $("#bannerFile").click(); };
  let _bnT; $("#f_banner").addEventListener("input",()=>{ clearTimeout(_bnT); _bnT=setTimeout(()=>bannerPreview($("#f_banner").value.trim()),400); });
  const stageBannerBlob=blob=>{
    pendingBannerBlob=blob;
    bannerPreview(URL.createObjectURL(blob));
    toast("Banner will be saved when you create the character.");
  };
  $("#bannerFile").onchange=()=>{
    const f=$("#bannerFile").files[0]; if(!f) return;
    openCropper(URL.createObjectURL(f), "3", 1200, 400, async blob=>{
      if(!cid){ stageBannerBlob(blob); $("#bannerFile").value=""; return; }
      const fd=new FormData(); fd.append("file",blob,"banner.jpg");
      try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd});
        $("#f_banner").value=r.url; bannerPreview(r.url);
        toast("Banner updated.");
      }catch(e){ errorToast("Upload failed: "+e.message); }
      $("#bannerFile").value="";
    });
  };
  $("#bannerGen").onclick=()=>{
    openImageGenPickerModal(genBlob=>{
      openCropper(URL.createObjectURL(genBlob), "3", 1200, 400, async blob=>{
        if(!cid){ stageBannerBlob(blob); return; }
        const fd=new FormData(); fd.append("file",blob,"banner.jpg");
        try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd});
          $("#f_banner").value=r.url; bannerPreview(r.url);
          toast("Banner updated.");
        }catch(e){ errorToast("Upload failed: "+e.message); }
      });
    }, {positive:(c.scenario||c.persona||"").slice(0,200)});
  };

  let charMode = c.mode || "character";
  const mseg=$("#modeSeg");
  mseg.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{ charMode=b.dataset.mode;
    mseg.querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
    $("#canBePersonaRow").style.display = charMode==="rpg" ? "none" : ""; });

  const setMode=m=>{ charMode = (m==="rpg") ? "rpg" : "character";
    mseg.querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x.dataset.mode===charMode));
    $("#canBePersonaRow").style.display = charMode==="rpg" ? "none" : ""; };

  const tagsWrap=$("#f_tags_pills"), tagsHidden=$("#f_tags");
  let tagList=(tagsHidden.value||"").split(",").map(s=>s.trim()).filter(Boolean);
  const syncTagsHidden=()=>{ tagsHidden.value=tagList.join(", "); };
  const renderTagPills=()=>{
    tagsWrap.innerHTML=tagList.map((tg,i)=>
      `<span class="tag-pill">${esc(tg)}<button type="button" class="tag-pill-x" data-i="${i}">✕</button></span>`).join("")
      +`<input type="text" class="tag-pill-input" id="tagPillInput" placeholder="${tagList.length?"":esc(t("ed_tags_hint"))}">`;
    tagsWrap.querySelectorAll(".tag-pill-x").forEach(b=>b.onclick=()=>{
      tagList.splice(parseInt(b.dataset.i,10),1); syncTagsHidden(); renderTagPills();
    });
    const inp=$("#tagPillInput");
    const commit=()=>{
      const v=inp.value.replace(/,/g,"").trim();
      if(v && !tagList.includes(v)) tagList.push(v);
      inp.value=""; syncTagsHidden();
    };
    inp.addEventListener("keydown", e=>{
      if(e.key==="Enter"||e.key===","){ e.preventDefault(); if(inp.value.trim()){ commit(); renderTagPills(); $("#tagPillInput").focus(); } }
      else if(e.key==="Backspace" && !inp.value && tagList.length){ tagList.pop(); syncTagsHidden(); renderTagPills(); $("#tagPillInput").focus(); }
    });
    inp.addEventListener("blur", ()=>{ if(inp.value.trim()){ commit(); renderTagPills(); } });
  };
  renderTagPills();
  const refreshTagPills=()=>{ tagList=(tagsHidden.value||"").split(",").map(s=>s.trim()).filter(Boolean); renderTagPills(); };

  const srcTabs=$("#edSourceTabs"), manualFields=$("#manualFields"), genPanel=$("#generatePanel");
  const showSource=s=>{
    if(!srcTabs) return;
    srcTabs.querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x.dataset.src===s));
    const gen = s==="generate";
    genPanel.style.display = gen ? "" : "none";
    manualFields.style.display = gen ? "none" : "";
  };
  if(srcTabs) srcTabs.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>showSource(b.dataset.src));
  $("#genBtn")?.addEventListener("click", async()=>{
    const desc=$("#f_gen_desc").value.trim();
    if(!desc){ toast(t("ed_gen_empty")); return; }
    const btn=$("#genBtn"); btn.disabled=true; const label=btn.textContent; btn.textContent="⏳ "+t("ed_gen_working");
    try{
      const g=await api("/api/characters/generate-from-description",{method:"POST",body:JSON.stringify({description:desc})});
      $("#f_name").value=g.name||"";
      $("#f_persona").value=g.persona||"";
      $("#f_scenario").value=g.scenario||"";
      $("#f_greeting").value=g.greeting||"";
      $("#f_dialogue").value=g.dialogue||"";
      $("#f_tags").value=(g.tags||[]).join(", ");
      refreshTagPills();
      setMode(g.mode);
      ["f_name","f_persona","f_scenario","f_greeting","f_dialogue"].forEach(id=>$("#"+id).dispatchEvent(new Event("input")));
      showSource("manual");
      await autosaveDraftNow();
      toast(t("ed_gen_done"));
    }catch(e){ errorToast(t("ed_gen_fail")+": "+e.message); }
    finally{ btn.disabled=false; btn.textContent=label; }
  });

  // Stage editor rows
  const A=c.assets||{};
  const sM=(A.stage||{}).moods||{}, muM=(A.music||{}).moods||{}, spM=(A.sprites||{}).moods||{};
  const mr=$("#moodRows");
  [...new Set([...Object.keys(sM),...Object.keys(muM),...Object.keys(spM)])].forEach(n=>
    mr.appendChild(el(moodRowHTML(n, sM[n]||"", muM[n]||"", spM[n]||""))));
  $("#addMood").onclick=()=>mr.appendChild(el(moodRowHTML()));
  mr.addEventListener("click",e=>{ if(e.target.classList.contains("m-del")) e.target.closest(".mood-row").remove(); });

  // Stage media uploads (backgrounds, music, sprites)
  const stageFile=el('<input type="file" hidden>'); document.body.appendChild(stageFile);
  let _stageCb=null;
  stageFile.onchange=async()=>{
    const f=stageFile.files[0]; if(!f||!_stageCb) return;
    if(!cid){ toast("Save the character first, then upload media."); return; }
    const fd=new FormData(); fd.append("file",f);
    try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd}); _stageCb(r.url); toast("Uploaded."); }
    catch(e){ errorToast("Upload failed: "+e.message); }
  };
  const triggerStage=(accept,cb)=>{ _stageCb=cb; stageFile.accept=accept; stageFile.value=""; stageFile.click(); };
  // Static default fields
  document.querySelectorAll(".s-upload[data-target]").forEach(btn=>
    btn.onclick=()=>triggerStage(btn.dataset.accept, url=>{ const inp=$("#"+btn.dataset.target); if(inp) inp.value=url; }));
  // Mood row fields (event delegation)
  mr.addEventListener("click",e=>{
    const btn=e.target.closest(".s-upload[data-cls]"); if(!btn) return;
    const inp=btn.closest(".media-field").querySelector("input");
    triggerStage(btn.dataset.accept, url=>{ inp.value=url; });
  });
  const collectAssets=()=>{
    const bg={},mu={},sp={};
    mr.querySelectorAll(".mood-row").forEach(r=>{
      const n=r.querySelector(".m-name").value.trim().toLowerCase(); if(!n) return;
      const b=r.querySelector(".m-bg").value.trim(), m=r.querySelector(".m-music").value.trim(), s=r.querySelector(".m-sprite").value.trim();
      if(b)bg[n]=b; if(m)mu[n]=m; if(s)sp[n]=s;
    });
    const a={}, dbg=$("#a_bg").value.trim(), dmu=$("#a_music").value.trim(), dsp=$("#a_sprite").value.trim();
    if(dbg||Object.keys(bg).length) a.stage={default:dbg,moods:bg};
    if(dmu||Object.keys(mu).length) a.music={default:dmu,moods:mu};
    if(dsp||Object.keys(sp).length) a.sprites={default:dsp,moods:sp};
    const banner=$("#f_banner").value.trim();
    if(banner) a.banner=banner;
    return a;
  };

  if(!cid){
    const drop=$("#drop"), file=$("#file");
    drop.onclick=()=>file.click();
    file.onchange=()=>doImport(main, file.files[0]);
    ["dragover","dragenter"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("over");}));
    ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("over");}));
    drop.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) doImport(main, f); });
  }

  $("#altGreets").addEventListener("click",e=>{ const x=e.target.closest(".gl-x"); if(x) x.closest(".gl-row").remove(); });
  $("#agAdd").onclick=()=>{ $("#altGreets").insertAdjacentHTML("beforeend",
    `<div class="gl-row" style="margin-bottom:8px;"><textarea class="ag-t" style="flex:1;min-height:64px"></textarea><button type="button" class="tool danger gl-x">✕</button></div>`); };
  if(cid && $("#reimportBtn")){
    $("#reimportBtn").onclick=()=>$("#reimportFile").click();
    $("#reimportFile").onchange=async()=>{
      const f=$("#reimportFile").files[0]; if(!f) return;
      const fd=new FormData(); fd.append("file",f);
      try{
        await api(`/api/characters/${cid}/reimport`,{method:"POST",body:fd});
        toast(t("ed_reimport_done"));
        viewEditor($("#main"), cid);   // re-render with the refreshed fields
      }catch(e){ errorToast("Reimport failed: "+e.message); }
    };
  }
  // Autosave (new-character flow only): a debounced draft save so work isn't
  // lost if the tab closes before a real Save — shows up under Library's
  // "Pending" tab, and only becomes a real, normal character once the user
  // actually clicks Save (which explicitly clears is_draft). Only text fields
  // are autosaved; avatar/banner/lore stay client-side-staged exactly as
  // before and are attached at the same point they always were.
  let draftCid = null;
  const collectTextBody=()=>({
    name:$("#f_name").value.trim()||"Unnamed", description:$("#f_description").value,
    persona:$("#f_persona").value,
    scenario:$("#f_scenario").value, greeting:$("#f_greeting").value, dialogue:$("#f_dialogue").value,
    tags:$("#f_tags").value.split(",").map(s=>s.trim()).filter(Boolean),
    creator:$("#f_creator").value.trim()||c.creator||"you",
    system_prompt:$("#f_sysprompt").value,
    alt_greetings:[...document.querySelectorAll("#altGreets .ag-t")].map(t2=>t2.value.trim()).filter(Boolean),
    mode:charMode,
  });
  const hasDraftableContent=()=>{
    const b=collectTextBody();
    return !!(b.persona.trim()||b.scenario.trim()||b.greeting.trim()||b.dialogue.trim()
      || (b.name && b.name!=="Unnamed"));
  };
  let autosaveT;
  const doAutosave=async()=>{
    if(cid || !hasDraftableContent()) return;
    const body={...collectTextBody(), is_draft:true};
    try{
      if(draftCid) await api("/api/characters/"+draftCid, j("PUT",body));
      else{ const nc=await api("/api/characters", j("POST",body)); draftCid=nc.id; }
    }catch(e){ /* autosave is best-effort — a failed draft save shouldn't interrupt editing */ }
  };
  const autosaveDraft=()=>{
    clearTimeout(autosaveT);
    autosaveT=setTimeout(doAutosave, 3000);
  };
  // Bypasses the debounce entirely — used right after AI-generation fills the
  // form, so the generated draft is guaranteed to exist the instant generation
  // finishes rather than depending on the user typing/waiting afterward.
  const autosaveDraftNow=()=>{ clearTimeout(autosaveT); return doAutosave(); };
  if(!cid) main.addEventListener("input", autosaveDraft);
  /* Autosave silently creates a real (draft) character behind the scenes
     while a NEW character is being composed — Cancel is just a plain <a
     href> link, so clicking it navigated away but left that orphaned draft
     sitting in the owner's Library "Pending" tab forever, which is exactly
     what "Cancel doesn't work" looks like from the user's side even though
     the link itself did navigate. Only applies to the create-new flow
     (draftCid only ever gets set when !cid) — cancelling an edit of an
     already-existing character must never delete anything. */
  $("#cancelBtn")?.addEventListener("click", ()=>{
    clearTimeout(autosaveT);
    if(!cid && draftCid) api("/api/characters/"+draftCid, {method:"DELETE"}).catch(()=>{});
  });

  $("#saveBtn").onclick=async()=>{
    const presHtml=$("#f_presentation")?.value || "";
    if(presHtml.trim()){
      const badUrl=findExternalCardLink(presHtml);
      if(badUrl){ toast(t("pres_external_link_found").replace("{url}", badUrl)); return; }
    }
    const body={ ...collectTextBody(),
      assets:{...collectAssets(), ...(avaPos?{avatar_pos:avaPos}:{})}, avatar:curAvatar,
      is_public: !!$("#f_community")?.checked,
      can_be_persona: charMode!=="rpg" && !!$("#f_can_be_persona")?.checked,
      allow_download: !!$("#f_allow_download")?.checked,
      is_explicit: !!$("#f_is_explicit")?.checked,
      presentation_html: presHtml,
      is_draft: false };
    try{
      if(cid){ await api("/api/characters/"+cid, j("PUT",body)); toast("Saved."); navigate("/c/"+cid); }
      else{
        clearTimeout(autosaveT);
        let nc;
        if(draftCid){ await api("/api/characters/"+draftCid, j("PUT",body)); nc={id:draftCid}; }
        else{ nc=await api("/api/characters", j("POST",body)); }
        // Avatar/banner picked or generated before the character existed couldn't be
        // uploaded yet (nowhere to attach them to) — do it now that a real id exists.
        if(pendingAvatarBlob){
          const fd=new FormData(); fd.append("file",pendingAvatarBlob,"avatar.jpg");
          try{ await api(`/api/characters/${nc.id}/avatar`,{method:"POST",body:fd}); }
          catch(e){ errorToast("Avatar upload failed: "+e.message); }
        }
        if(pendingBannerBlob){
          const fd=new FormData(); fd.append("file",pendingBannerBlob,"banner.jpg");
          try{
            const r=await api(`/api/characters/${nc.id}/media`,{method:"POST",body:fd});
            await api(`/api/characters/${nc.id}`, j("PUT",{...body, assets:{...body.assets, banner:r.url}}));
          }catch(e){ errorToast("Banner upload failed: "+e.message); }
        }
        if(pendingImportLore.length){
          let loreOk=0;
          for(const le of pendingImportLore){
            try{
              await api(`/api/characters/${nc.id}/lore`, j("POST",{
                keys:le.keys||[], content:le.content, always:!!le.always,
                category:le.category||"", name:le.name||"",
                appearance_tags:le.appearance_tags||"", appearance_tags_negative:le.appearance_tags_negative||"",
                image_data:le.image_data||null,
                hidden:true, // imported lore always starts hidden, regardless of the source card
              }));
              loreOk++;
            }catch(e){ /* one bad entry shouldn't block the rest */ }
          }
          if(loreOk) toast(`Created with ${loreOk} imported lore ${loreOk===1?"entry":"entries"}.`);
        }
        toast("Created."); navigate("/c/"+nc.id);
      }
    }catch(e){ errorToast("Save failed: "+e.message); }
  };
}
function moodRowHTML(mood="",bg="",music="",sprite=""){
  return `<div class="mood-row">
    <input type="text" class="m-name" placeholder="happy" value="${esc(mood)}">
    <div class="media-field"><input type="text" class="m-bg" placeholder="background url" value="${esc(bg)}"><button type="button" class="btn s-upload" data-cls="m-bg" data-accept="image/*" title="Upload">⬆</button></div>
    <div class="media-field"><input type="text" class="m-music" placeholder="music url" value="${esc(music)}"><button type="button" class="btn s-upload" data-cls="m-music" data-accept="audio/*" title="Upload">⬆</button></div>
    <div class="media-field"><input type="text" class="m-sprite" placeholder="sprite url" value="${esc(sprite)}"><button type="button" class="btn s-upload" data-cls="m-sprite" data-accept="image/*" title="Upload">⬆</button></div>
    <button type="button" class="tool danger m-del" title="remove">✕</button>
  </div>`;
}
function macroRow(target){ return `<div class="macro-row"><button class="chip" data-ins="{{user}}" data-t="${target}">+ {{user}}</button><button class="chip" data-ins="{{char}}" data-t="${target}">+ {{char}}</button></div>`; }
function wireMacros(){
  document.querySelectorAll(".chip[data-ins]").forEach(b=>b.onclick=()=>{
    const ta=$("#"+b.dataset.t); const s=ta.selectionStart??ta.value.length;
    ta.value=ta.value.slice(0,s)+b.dataset.ins+ta.value.slice(ta.selectionEnd??s); ta.focus();
  });
}
async function doImport(main, f){
  if(!f) return; toast("Reading card…");
  const fd=new FormData(); fd.append("file",f);
  try{
    const prefill=await api("/api/characters/import",{method:"POST",body:fd});
    toast("Card parsed — review the fields below and save when ready."
      + (prefill.lore&&prefill.lore.length ? ` (+${prefill.lore.length} lore entries staged)` : ""));
    viewEditor(main, null, prefill);
  }catch(e){ errorToast("Import failed: "+e.message); }
}
