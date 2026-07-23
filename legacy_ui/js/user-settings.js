"use strict";
/* ============================ USER SETTINGS MODAL ============================ */
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
    <h3 class="sec" style="margin-top:0;border-top:none;padding-top:0;">🌐 <span data-i18n="settings_language_heading">${esc(t("settings_language_heading"))}</span></h3>
    <div class="field" style="margin:0 0 12px"><label><span data-i18n="settings_iface_lang">${esc(t("settings_iface_lang"))}</span> <span class="hint" data-i18n="settings_iface_lang_hint">${esc(t("settings_iface_lang_hint"))}</span></label>
      <input type="text" id="u_iface_lang" list="ifaceLangList" value="${esc(uo.interface_language||"")}" placeholder="English" autocomplete="off">
      <datalist id="ifaceLangList">${worldLangOptions}</datalist></div>
    <h3 class="sec" id="nsfwSettingSection">🔞 <span>${esc(t("settings_nsfw_heading"))}</span></h3>
    <label class="switch switch-nsfw"><input type="checkbox" id="u_nsfw" ${ME&&ME.nsfw_allowed?"checked":""}> ${esc(t("settings_nsfw"))} <span class="hint">${esc(t("settings_nsfw_hint"))}</span></label>
    <h3 class="sec">${esc(t("ap_title"))}</h3>
    <div class="field"><label>${esc(t("ap_font"))} <span class="hint">${esc(t("ap_font_hint_pre"))}<a class="hint-link" href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">${esc(t("ap_font_hint_link"))}</a>${esc(t("ap_font_hint_post"))}</span></label>
      <input type="text" id="ap_font" value="${esc(a.font||"")}" placeholder="default"></div>
    ${themeModeTabs(THEME)}
    <div id="apModeFieldsWrap">${apModeFieldsHTML(THEME)}</div>
    ${colorField("ap_chatbg",t("ap_chatbg"),a.chatBg,"default")}
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
  attachColorAC($("#ap_chatbg"));

  // Which base's Text/Accent/App-background fields are currently shown —
  // independent of THEME (the live preview), since you can edit Dark's
  // fields while still looking at Light, or vice versa. Declared with `var`
  // (not `let`) and assigned before use below — `liveAppearance` closes over
  // it, and closures need the binding to already exist, not just be hoisted.
  var _apEditBase=THEME;
  const AP_FIELDS=["ap_font","ap_chatbg","ap_msgfont",
    "ap_narration_font","ap_dialogue_font","ap_thoughts_font","ap_voice_font","ap_bold_font"];
  const readFlags=cat=>{
    const grp=document.querySelector(`.style-toggle-group[data-category="${cat}"]`);
    if(!grp) return undefined;
    return [...grp.querySelectorAll(".style-toggle-btn.on")].map(b=>b.dataset.flag).join("");
  };
  const swatchVal=id=>$("#"+id)?.dataset.value;
  const liveAppearance=()=>{
    saveAppearance({ font:$("#ap_font")?.value.trim(),
      [_apEditBase+"Text"]:$("#ap_text")?.value.trim(), [_apEditBase+"Accent"]:$("#ap_accent")?.value.trim(),
      [_apEditBase+"AppBg"]:$("#ap_appbg")?.value.trim(), chatBg:$("#ap_chatbg")?.value.trim(),
      msgFont:$("#ap_msgfont")?.value.trim(),
      narrationColor:swatchVal("ap_narration"), narrationFont:$("#ap_narration_font")?.value.trim(), narrationFlags:readFlags("narration"),
      dialogueColor:swatchVal("ap_dialogue"), dialogueFont:$("#ap_dialogue_font")?.value.trim(), dialogueFlags:readFlags("dialogue"),
      thoughtColor:swatchVal("ap_thoughts"), thoughtFont:$("#ap_thoughts_font")?.value.trim(), thoughtFlags:readFlags("thought"),
      voiceColor:swatchVal("ap_voice"), voiceFont:$("#ap_voice_font")?.value.trim(), voiceFlags:readFlags("voice"),
      boldColor:swatchVal("ap_bold"), boldFont:$("#ap_bold_font")?.value.trim(), boldFlags:readFlags("bold") });
    refreshBothThemeModeTabs();
  };

  const wireApModeFields=()=>{
    ["ap_text","ap_accent","ap_appbg"].forEach(id=>{
      const el=$("#"+id); if(!el) return;
      attachColorAC(el);
      el.addEventListener("input",liveAppearance);
    });
    document.querySelectorAll(".ap-mode-swatch").forEach(sw=>{
      sw.addEventListener("click",()=>{
        const target=sw.dataset.for?document.getElementById(sw.dataset.for):null;
        const current=target?.value || "#E3BD6C";
        openColorPicker(sw, current, hex=>{
          sw.style.background=hex;
          if(target){ target.value=hex; target.dispatchEvent(new Event("input")); }
        });
      });
    });
    const browseBtn=$("#ap_browse_presets");
    if(browseBtn) browseBtn.onclick=()=>openThemePickerModal(_apEditBase, ()=>{
      renderApModeFields();
      refreshThemeModeTab(_apEditBase);
    });
  };
  const renderApModeFields=()=>{
    const wrap=$("#apModeFieldsWrap");
    if(wrap) wrap.innerHTML=apModeFieldsHTML(_apEditBase);
    wireApModeFields();
  };
  renderApModeFields();
  const refreshThemeModeTab=base=>{
    const tab=$("#themeModeTabs")?.querySelector(`.theme-mode-tab[data-base="${base}"]`);
    if(!tab) return;
    const custom=themeIsCustom(base);
    const dot=tab.querySelector(".theme-mode-tab-dot"), label=tab.querySelector("span:last-child");
    if(dot){
      dot.classList.toggle("custom", custom);
      dot.style.background=custom?"":(APPEARANCE[base+"Accent"]||"#E3BD6C");
    }
    if(label) label.textContent=`${t(base==="dark"?"ap_theme_pills_dark":"ap_theme_pills_light")} · ${custom?t("theme_preset_custom"):activePresetName(base)}`;
  };
  // Any device-local appearance field can flip a base into "Custom" (not
  // just its own color fields) — font/font-size/chat-background are global,
  // so a change to any of them has to refresh both tabs' labels, not just
  // whichever base is currently being edited.
  const refreshBothThemeModeTabs=()=>{ refreshThemeModeTab("light"); refreshThemeModeTab("dark"); };
  // These tabs now do double duty: picking one both switches the live app
  // theme (used to be a separate "THEME" seg control above, removed as
  // redundant) and switches which base's color fields are shown/edited below.
  $("#themeModeTabs").querySelectorAll(".theme-mode-tab").forEach(tab=>tab.onclick=()=>{
    const base=tab.dataset.base;
    applyTheme(base);
    _apEditBase=base;
    $("#themeModeTabs").querySelectorAll(".theme-mode-tab").forEach(x=>x.classList.toggle("on",x===tab));
    renderApModeFields();
  });

  AP_FIELDS.forEach(id=>{ const el=$("#"+id); if(el){ el.addEventListener("input",liveAppearance); el.addEventListener("change",liveAppearance); } });
  document.querySelectorAll(".style-toggle-btn").forEach(b=>b.onclick=()=>{ b.classList.toggle("on"); liveAppearance(); });
  document.querySelectorAll(".ap-swatch:not(.ap-mode-swatch)").forEach(sw=>{
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
  // "Reset appearance" clears the shared fields (font, size, chat background,
  // message-formatting) to blank, and snaps the *active tab's* colors back to
  // whichever named preset that tab currently matches (e.g. Amethyst Veil) if
  // it has manual tweaks layered on top of one — not all the way to blank
  // Aurum, and never touching the other base's own saved preset.
  const resetAppearance=()=>{
    const base=_apEditBase;
    const preset=activePresetForBase(base);
    const colorPatch=preset
      ? {[base+"Accent"]:preset.patch.accent, [base+"Text"]:base==="dark"?preset.patch.textDark:preset.patch.textLight, [base+"AppBg"]:preset.patch.appBg}
      : {[base+"Accent"]:"", [base+"Text"]:"", [base+"AppBg"]:""};
    const clearedKeys={ font:undefined, scale:undefined, chatBg:undefined, msgFont:undefined,
      narrationColor:undefined, narrationFont:undefined, narrationFlags:undefined,
      dialogueColor:undefined, dialogueFont:undefined, dialogueFlags:undefined,
      thoughtColor:undefined, thoughtFont:undefined, thoughtFlags:undefined,
      voiceColor:undefined, voiceFont:undefined, voiceFlags:undefined,
      boldColor:undefined, boldFont:undefined, boldFlags:undefined };
    APPEARANCE={...APPEARANCE, ...clearedKeys, ...colorPatch};
    Object.keys(APPEARANCE).forEach(k=>{ if(APPEARANCE[k]===undefined) delete APPEARANCE[k]; });
    store.set("appearance",JSON.stringify(APPEARANCE)); applyAppearance();
    AP_FIELDS.forEach(id=>{ const e=$("#"+id); if(e) e.value=""; });
    document.querySelectorAll(".style-toggle-group").forEach(g=>{
      const def=g.dataset.default||"";
      g.querySelectorAll(".style-toggle-btn").forEach(b=>b.classList.toggle("on", def.includes(b.dataset.flag)));
    });
    document.querySelectorAll(".ap-swatch[data-default]").forEach(sw=>{ sw.dataset.value=sw.dataset.default; sw.style.background=sw.dataset.default; });
    renderApModeFields();
    refreshBothThemeModeTabs();
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
