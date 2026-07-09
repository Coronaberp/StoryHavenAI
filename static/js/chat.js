"use strict";
/* ============================ CHAT ============================ */
const ChatState={
  _s:null,
  set(state){ this.clear(); this._s=state; return state; },
  current(){ return this._s; },
  isActive(sid){ return !!this._s && this._s.sid===sid; },
  clear(){
    const s=this._s;
    this._s=null;
    if(s && s.abort){ try{ s.abort.abort(); }catch(e){} }
  },
};
async function viewChat(main, sid){
  ChatState.clear();
  const s=await api("/api/sessions/"+sid);
  const c=await api("/api/characters/"+s.char_id);
  const mode=c.mode||"character";
  const cs=ChatState.set({sid, c, mode, user_name: s.user_name || "You", language: s.language||"", authorNote: s.author_note||"", generating:false, abort:null, muted:true});
  const assets=c.assets||{};
  const hasStage = !!(assets.stage||assets.sprites||assets.music);
  const musicBtn = !!assets.music;
  main.innerHTML=`<div class="chat-shell ${hasStage?'has-stage':''}">
    <div class="stage" id="stage">
      <div class="stage-bg" id="stageBg"></div>
      <img class="stage-sprite" id="stageSprite" alt="">
    </div>
    ${hasStage?`<button class="stage-toggle" id="stageToggle" title="${esc(t("title_stage"))}">🖼</button>`:""}
    <audio id="stageAudio" loop></audio>
    <div class="chat-top">
      <a class="btn" href="/c/${c.id}" style="padding:7px 11px;">←</a>
      ${avatar(c)}
      <div class="who"><a class="n" id="chatCharName" href="/c/${c.id}">${esc(c.name)}</a><div class="s">${esc(t("chatting_as"))} ${esc(s.user_name||"You")}</div></div>
      <span class="mode-badge ${mode==="rpg"?"rpg":""}">${mode==="rpg"?"RPG":"Character"}</span>
      <div class="chat-top-actions">
        <button class="btn" id="thinkToggle" style="padding:7px 11px;" title="${esc(t("title_think"))}"></button>
      </div>
      <div style="position:relative;flex:none;">
        <button class="btn" id="chatMore" style="padding:7px 11px;" title="${esc(t("title_more"))}">⋯</button>
        <div id="chatMoreMenu" class="chat-more-menu" hidden>
          ${musicBtn?`<button id="musicBtn" class="chat-more-item">🔇 Mute music</button>`:""}
          <button id="memView" class="chat-more-item">◷ ${esc(t("mem_title"))}</button>
          <button id="charStateBtn" class="chat-more-item">👤 ${esc(t("title_char_state"))}</button>
          <button id="langBtn" class="chat-more-item">🌐 ${esc(t("reply_lang"))}</button>
          <button id="glossBtn" class="chat-more-item">📖 ${esc(t("glossary_title"))}</button>
          <button id="noteBtn" class="chat-more-item">📌 ${esc(t("authors_note"))}</button>
          <div class="chat-more-sep"></div>
          <button id="chatExport" class="chat-more-item">⬇ Export chat</button>
          <button id="chatDel" class="chat-more-item danger">🗑 Delete this chat</button>
        </div>
      </div>
    </div>
    <div class="chat-scroll" id="cscroll"><div class="thread" id="thread"></div><button id="scrollFab" title="${esc(t("title_scroll"))}">↓</button></div>
    <div class="composer"><div id="cmdPalette" class="cmd-palette" hidden></div>
    <div style="max-width:720px;margin:0 auto 6px;display:flex;align-items:center;gap:8px;">
      <button id="styleBtn" class="style-btn" title="${esc(t("style_title"))}">✦ ${esc(t("style_word"))}</button>
    </div>
    <div class="inner">
      <textarea id="cin" rows="1" placeholder="${esc(mode==="rpg"?t("ph_rpg"):t("ph_char"))}"></textarea>
      <button class="send" id="csend">↑</button>
    </div></div>
  </div>`;
  renderThread(s.messages);
  // greeting still translating in the background? show explicit progress + poll,
  // so a working setup can't be mistaken for a dead page
  const _greetPending = m => m.length===1 && m[0].role==="assistant" && !m[0].lang;
  if(_greetPending(s.messages)){
    const note=el(`<div class="think" style="margin:14px auto;max-width:720px;"><span class="pulse"></span><span>${esc(t("setting_up"))} <span style="color:var(--muted);font-size:12px;">${esc(t("setting_up_hint"))}</span></span></div>`);
    $("#thread").appendChild(note);
    let tries=0;
    const poll=async()=>{
      if(!ChatState.isActive(sid)) return;
      try{
        const fresh=await api("/api/sessions/"+sid);
        if(!_greetPending(fresh.messages)){ renderThread(fresh.messages); return; }
      }catch(e){}
      if(++tries<40) setTimeout(poll, 3000);
      else note.querySelector("span:last-child").textContent="⚠ still translating — it will appear on your next reload";
    };
    setTimeout(poll, 3000);
  }
  localizeContent([{el:$("#chatCharName"), text:c.name}]);
  applyScene(null);   // default background / sprite / music
  const stEl=$("#stageToggle");
  if(stEl){
    const shell=main.querySelector(".chat-shell");
    const hideKey="stageHidden:"+c.id;
    if(store.get(hideKey,"0")==="1") shell.classList.add("stage-hidden");
    stEl.onclick=()=>{ const hidden=shell.classList.toggle("stage-hidden"); store.set(hideKey, hidden?"1":"0"); };
  }
  const inp=$("#cin"), send=$("#csend");
  const _draftKey="draft:"+sid;
  // Restore draft
  const _draft=store.get(_draftKey,""); if(_draft){ inp.value=_draft; autosize(inp,170); }
  inp.addEventListener("input",()=>{ autosize(inp,170); updatePalette(inp.value); store.set(_draftKey, inp.value); });
  inp.addEventListener("keydown",e=>{
    const pal=$("#cmdPalette");
    if(pal&&!pal.hidden){
      if(e.key==="ArrowDown"){e.preventDefault();palNav(1);return;}
      if(e.key==="ArrowUp"){e.preventDefault();palNav(-1);return;}
      if(e.key==="Tab"){e.preventDefault();commitPalette();return;}
      if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();commitPalette();return;}
      if(e.key==="Escape"){hidePalette();return;}
    }
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();doSend();}
  });
  send.onclick=()=> cs.generating ? stopGen() : doSend();
  $("#memView").onclick=()=>openMemory(sid);
  $("#charStateBtn").onclick=()=>openCharState(sid, c.name);
  $("#chatExport").onclick=async()=>{ try{ const fresh=await api("/api/sessions/"+sid); exportChat(c,fresh); }catch(e){ errorToast("Export failed."); }};
  // Reply language
  const langBtn=$("#langBtn");
  const _updateLangBtn=()=>{ langBtn.classList.toggle("active", !!cs.language); langBtn.title=cs.language?`Reply language: ${cs.language}`:"Reply language"; };
  _updateLangBtn();
  langBtn.onclick=()=>openLanguageModal(sid, cs.language, lang=>{ cs.language=lang; _updateLangBtn(); });
  let _glossary={}; try{ _glossary=JSON.parse(s.glossary||"{}"); }catch(e){}
  const glossBtn=$("#glossBtn");
  const _updateGlossBtn=()=>glossBtn.classList.toggle("active", Object.keys(_glossary).length>0);
  _updateGlossBtn();
  glossBtn.onclick=()=>openGlossaryModal(sid, _glossary, gl=>{ _glossary=gl; _updateGlossBtn(); });
  // Author's Note (pinned reminder, re-sent on every turn)
  const noteBtn=$("#noteBtn");
  const _updateNoteBtn=()=>{ noteBtn.classList.toggle("active", !!cs.authorNote); };
  _updateNoteBtn();
  noteBtn.onclick=()=>openAuthorNoteModal(sid, cs.authorNote, note=>{ cs.authorNote=note; _updateNoteBtn(); });
  // Response style
  let _styleKey=s.style_key||"unspecified", _stylePrompt=s.style_prompt||"";
  function _updateStyleBtn(){
    const btn=$("#styleBtn"); if(!btn) return;
    const custom=_customStyles().find(x=>x.key===_styleKey);
    const found=custom||STYLES.find(x=>x.key===_styleKey);
    const label=custom?found.label:(found?t("style_"+found.key):t("style_word"));
    const active=_styleKey!=="unspecified";
    btn.innerHTML=`✦ ${esc(label)}`;
    btn.classList.toggle("active", active);
  }
  _updateStyleBtn();
  $("#styleBtn").onclick=()=>openStylePicker(sid, _styleKey, _stylePrompt, (key,prompt,label)=>{
    _styleKey=key; _stylePrompt=prompt; _updateStyleBtn();
    api(`/api/sessions/${sid}/style`,j("PUT",{key,prompt:prompt||null})).catch(()=>{});
  });
  // ⋯ more menu
  $("#chatMore").onclick=e=>{ e.stopPropagation(); const m=$("#chatMoreMenu"); const wasHidden=m.hidden; closeAllDropdowns(); m.hidden=!wasHidden; };
  document.addEventListener("click",()=>{ const m=$("#chatMoreMenu"); if(m) m.hidden=true; });
  $("#chatDel").onclick=async()=>{
    if(!(await confirmAction($("#chatDel"), "Delete this chat permanently?"))) return;
    try{ await api(`/api/sessions/${sid}`,{method:"DELETE"}); invalidateRecent(); navigate("/"); }catch(e){ errorToast("Delete failed."); }
  };
  // Scroll-to-bottom FAB
  const fab=$("#scrollFab"), sc=$("#cscroll");
  sc.addEventListener("scroll",()=>{ fab.classList.toggle("vis", sc.scrollHeight-sc.scrollTop-sc.clientHeight>200); });
  fab.onclick=()=>scrollDown(true);
  const mb=$("#musicBtn");
  if(mb) mb.onclick=()=>{ const au=$("#stageAudio"); cs.muted=!cs.muted; au.muted=cs.muted;
    mb.textContent=(cs.muted?"🔇":"🔊")+" "+(cs.muted?"Unmute music":"Mute music"); if(!cs.muted){ au.play().catch(()=>{}); } };
  const tt=$("#thinkToggle");
  const paintThink=()=>{ tt.textContent="🧠 "+t("think_word")+" "+(THINK?t("on_word"):t("off_word")); tt.style.color=THINK?"var(--accent)":"var(--muted)"; tt.style.borderColor=THINK?"var(--accent)":"var(--line-2)"; };
  tt.onclick=()=>{ THINK=!THINK; store.set("think",THINK?"1":"0"); paintThink(); toast("Thinking "+(THINK?"on":"off")); };
  paintThink();
  setTimeout(()=>{ scrollDown(true); inp.focus(); },50);
}

function pick(section, mood){
  // section = assets.stage / .music / .sprites ; returns mood url or default
  if(!section) return "";
  const m=(section.moods||{});
  if(mood && m[mood]) return m[mood];
  return section.default || "";
}
function applyScene(mood){
  const cs=ChatState.current(); const c=cs&&cs.c; if(!c) return;
  const a=c.assets||{};
  const bgEl=$("#stageBg"), spEl=$("#stageSprite"), au=$("#stageAudio");
  if(bgEl){ const url=pick(a.stage, mood); if(url){ bgEl.style.backgroundImage=`url("${url}")`; bgEl.classList.add("on"); } else { bgEl.classList.remove("on"); } }
  if(spEl){ const url=pick(a.sprites, mood); if(url){ spEl.src=url; spEl.classList.add("on"); } else { spEl.classList.remove("on"); spEl.removeAttribute("src"); } }
  if(au){ const url=pick(a.music, mood); if(url){ if(au.dataset.src!==url){ au.dataset.src=url; au.src=url; } au.muted=cs.muted; if(!cs.muted){ au.play().catch(()=>{}); } } }
}

function exportChat(c, s){
  const lines=[`# ${c.name}`,`Session: ${s.title||s.id}`,`Exported: ${new Date().toLocaleString()}`,"",...s.messages.map(m=>{
    const {body}=splitThink(m.content||"");
    const who=m.role==="assistant"?c.name:(s.user_name||"You");
    return `**${who}**\n${body}\n`;
  })];
  const blob=new Blob([lines.join("\n")],{type:"text/markdown"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`${c.name.replace(/[^a-z0-9]+/gi,"-")}-${s.id.slice(0,8)}.md`;
  a.click(); URL.revokeObjectURL(a.href);
}

async function openCharState(sid, charName){
  openModal(`<h3>${esc(charName)} — ${esc(t("right_now"))}</h3><div id="csBody" style="color:var(--muted)">${esc(t("loading"))}</div>`);
  const foot=`<div class="modal-foot"><button class="btn" id="csClose">Close</button></div>`;
  try{
    const st=await api(`/api/sessions/${sid}/state`);
    const rows=[];
    if(st.doing) rows.push(`<div class="section" style="margin:0 0 16px;"><h4>${esc(t("cs_doing"))}</h4><div class="prose-block" style="font-size:14.5px;">${esc(st.doing)}</div></div>`);
    if(st.location) rows.push(`<div class="section" style="margin:0 0 16px;"><h4>${esc(t("cs_location"))}</h4><div class="prose-block" style="font-size:14.5px;">${esc(st.location)}</div></div>`);
    if(st.known_names&&st.known_names.length) rows.push(`<div class="section" style="margin:0;"><h4>${esc(t("cs_established"))} (${st.known_names.length})</h4><div class="meta">${st.known_names.map(n=>`<span class="tag">${esc(n)}</span>`).join("")}</div></div>`);
    $("#csBody").innerHTML = rows.length
      ? rows.join("")+foot
      : `<div style="color:var(--muted);padding:6px 0 16px;">${esc(t("cs_nothing"))}</div>`+foot;
  }catch(e){
    $("#csBody").innerHTML = `<div style="color:var(--warn);padding:6px 0 16px;">Couldn't load character state: ${esc(e.message)}</div>`+foot;
  }
  const close=$("#csClose"); if(close) close.onclick=closeModal;
}
async function openMemory(sid){
  openModal(`<h3>${esc(t("mem_title"))}</h3><div id="memBody" style="color:var(--muted)">${esc(t("loading"))}</div>`);
  const render=async()=>{
    const mem=await api(`/api/sessions/${sid}/memory?k=50`);
    if(mem.length){
      $("#memBody").innerHTML=
        `<div style="margin-bottom:12px;color:var(--sec);font-size:13.5px;">${mem.length} ${esc(t("mem_intro"))}</div>`
        +mem.map(m=>`<div class="lore-entry mem-entry" data-mid="${esc(m.id)}"><div class="c">${esc(m.text)}</div><button class="tool danger mem-del" title="${esc(t("del_memory"))}">✕</button></div>`).join("")
        +`<div class="modal-foot"><button class="btn danger" id="clearMem">${esc(t("clear_all"))}</button><button class="btn" id="memClose">${esc(t("btn_close"))}</button></div>`;
      $("#memBody").querySelectorAll(".mem-del").forEach(b=>b.onclick=async()=>{
        const mid=b.closest(".mem-entry").dataset.mid;
        await api(`/api/sessions/${sid}/memory/${mid}`,{method:"DELETE"});
        b.closest(".mem-entry").remove();
        const rem=$("#memBody").querySelectorAll(".mem-entry").length;
        if(!rem) render();
      });
    } else {
      $("#memBody").innerHTML=`<div style="color:var(--muted);padding:6px 0 16px;">${esc(t("no_memories"))}</div><div class="modal-foot"><button class="btn" id="memClose">Close</button></div>`;
    }
    const close=$("#memClose"); if(close) close.onclick=closeModal;
    const cm=$("#clearMem"); if(cm) cm.onclick=async()=>{ if(!(await confirmAction(cm, "Clear memory for this chat? Other chats are unaffected.")))return;
      await api(`/api/sessions/${sid}/memory`,{method:"DELETE"}); toast("Memory cleared."); render(); };
  };
  render();
}
// ── Response Styles ──────────────────────────────────────────────────────────
const STYLES=[
  { key:"unspecified", emoji:"☰",  grad:"linear-gradient(150deg,#4a4462,#26223a)",  label:"Unspecified",
    desc:"Creator's intended voice / system default", prompt:"" },
  { key:"roleplay",    emoji:"🎮", grad:"linear-gradient(150deg,#6c56e0,#3a2f8f)",  label:"Roleplay",
    desc:"Narrative-driven and immersive storytelling",
    prompt:"Write in a rich, immersive narrative style. Use vivid prose descriptions, advance the scene organically, and maintain deep character voice throughout." },
  { key:"lust",        emoji:"😍", grad:"linear-gradient(150deg,#dd4e8c,#8a2f5e)",  label:"Lust",
    desc:"Flirtatious, suggestive, and NSFW",
    prompt:"Respond in an explicit, sensual, NSFW manner. Be bold about physical desire, use evocative sensory language, and don't shy away from graphic detail." },
  { key:"romance",     emoji:"❤️", grad:"linear-gradient(150deg,#d1546a,#7a2334)",  label:"Romance",
    desc:"Warm, intimate, and affectionate",
    prompt:"Respond with tenderness, emotional warmth, and romantic intimacy. Focus on feelings, connection, vulnerability, and the small moments between characters." },
  { key:"casual",      emoji:"🤙", grad:"linear-gradient(150deg,#d6a53f,#8f6a2f)",  label:"Casual",
    desc:"Short, relaxed, and straight to the point",
    prompt:"Keep responses short and casual. Skip flowery prose — just natural, snappy dialogue and minimal action beats." },
];
const CUSTOM_GRADS=["linear-gradient(150deg,#9b72e8,#5e3fa6)","linear-gradient(150deg,#e3bd6c,#a8791c)","linear-gradient(150deg,#6c9be0,#2f5e8f)","linear-gradient(150deg,#5ec9a8,#2f7a5e)"];

function _customStyles(){ try{ return JSON.parse(localStorage.getItem("personae_styles")||"[]"); }catch{ return []; } }
function _saveCustomStyles(arr){ localStorage.setItem("personae_styles", JSON.stringify(arr)); }

const COMMON_LANGUAGES=["Spanish","French","German","Japanese","Korean","Portuguese","Italian","Russian","Mandarin Chinese","Arabic"];
function openLanguageModal(sid, current, onApply){
  openModal(`<h3>${esc(t("reply_lang"))}</h3>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted);">${esc(t("lang_p"))}</p>
    <div class="field"><label>${esc(t("lang_label"))}</label><input type="text" id="lang_input" value="${esc(current||"")}" placeholder="${esc(t("lang_ph"))}"></div>
    <div class="macro-row" style="flex-wrap:wrap;margin:-8px 0 18px;">
      ${COMMON_LANGUAGES.map(l=>`<button type="button" class="chip" data-lang="${esc(l)}">${esc(l)}</button>`).join("")}
    </div>
    <div class="modal-foot">
      <button class="btn" id="lang_clear">${esc(t("btn_clear"))}</button>
      <button class="btn" id="lang_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="lang_save">${esc(t("btn_save"))}</button>
    </div>`);
  const inp=$("#lang_input");
  document.querySelectorAll("[data-lang]").forEach(b=>b.onclick=()=>{ inp.value=b.dataset.lang; inp.focus(); });
  $("#lang_cancel").onclick=closeModal;
  const apply=async(lang)=>{
    try{
      await api(`/api/sessions/${sid}/language`, j("PUT",{language:lang||null}));
      closeModal();
      location.reload(); return;
    }catch(e){ errorToast("Failed: "+e.message); }
  };
  $("#lang_clear").onclick=()=>apply("");
  $("#lang_save").onclick=()=>apply(inp.value.trim());
}
function openGlossaryModal(sid, current, onApply){
  const rowHTML=(k="",v="")=>`<div class="gl-row" style="display:flex;gap:8px;margin-bottom:8px;">
    <input class="gl-k" placeholder="${esc(t("glossary_term"))}" value="${esc(k)}" style="flex:1">
    <input class="gl-v" placeholder="${esc(t("glossary_rendering"))}" value="${esc(v)}" style="flex:1">
    <button type="button" class="tool danger gl-x">✕</button></div>`;
  const entries=Object.entries(current||{});
  openModal(`<h3>📖 ${esc(t("glossary_title"))}</h3>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted);">${esc(t("glossary_sub"))}</p>
    <div id="glRows">${entries.length?entries.map(([k,v])=>rowHTML(k,v)).join(""):rowHTML()}</div>
    <button type="button" class="btn" id="gl_add" style="margin-bottom:16px;">+ ${esc(t("glossary_add"))}</button>
    <div class="modal-foot">
      <button class="btn" id="gl_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="gl_save">${esc(t("btn_save"))}</button>
    </div>`);
  const rows=$("#glRows");
  rows.addEventListener("click",e=>{ const x=e.target.closest(".gl-x"); if(x) x.closest(".gl-row").remove(); });
  $("#gl_add").onclick=()=>{ rows.insertAdjacentHTML("beforeend", rowHTML()); rows.lastElementChild.querySelector(".gl-k").focus(); };
  $("#gl_cancel").onclick=closeModal;
  $("#gl_save").onclick=async()=>{
    const gl={};
    rows.querySelectorAll(".gl-row").forEach(r=>{
      const k=r.querySelector(".gl-k").value.trim(), v=r.querySelector(".gl-v").value.trim();
      if(k&&v) gl[k]=v;
    });
    try{
      await api(`/api/sessions/${sid}/glossary`, j("PUT",{glossary:gl}));
      closeModal();
      location.reload(); return;
    }catch(e){ errorToast("Failed: "+e.message); }
  };
}
function openAuthorNoteModal(sid, current, onApply){
  openModal(`<h3>${esc(t("authors_note"))}</h3>
    <p style="margin:0 0 16px;font-size:13px;color:var(--muted);">${esc(t("note_p"))}</p>
    <div class="field"><label>${esc(t("note_label"))}</label><textarea id="note_input" rows="5" placeholder="${esc(t("note_ph"))}">${esc(current||"")}</textarea></div>
    <div class="modal-foot">
      <button class="btn" id="note_clear">${esc(t("btn_clear"))}</button>
      <button class="btn" id="note_cancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="note_save">${esc(t("btn_save"))}</button>
    </div>`);
  const inp=$("#note_input");
  $("#note_cancel").onclick=closeModal;
  const apply=async(note)=>{
    try{
      await api(`/api/sessions/${sid}/note`, j("PUT",{note:note||null}));
      onApply(note); closeModal();
      toast(note?"Author's Note pinned.":"Author's Note cleared.");
    }catch(e){ errorToast("Failed: "+e.message); }
  };
  $("#note_clear").onclick=()=>apply("");
  $("#note_save").onclick=()=>apply(inp.value.trim());
}
function openStylePicker(sid, currentKey, currentPrompt, onApply){
  function cardHTML(item, isCustom, activeKey){
    const key=item.key, emoji=isCustom?(item.emoji||"✏️"):item.emoji;
    const label=isCustom?esc(item.label):esc(t("style_"+item.key)), desc=isCustom?esc(item.desc||""):esc(t("style_"+item.key+"_desc"));
    const grad=isCustom?CUSTOM_GRADS[Math.abs([...key].reduce((h,c)=>h+c.charCodeAt(0),0))%CUSTOM_GRADS.length]:item.grad;
    const active=activeKey===key;
    const prompt=item.prompt||"";
    return `
      <div class="style-card${active?" active":""}" data-skey="${key}" ${isCustom?'data-custom="1"':""} style="background:${grad}">
        ${active?'<span class="sc-check">✓</span>':''}
        ${isCustom?`<button class="sc-edit" title="${esc(t("tool_edit"))}" onclick="event.stopPropagation();_editCustomStyle('${key}')">✏</button>
          <button class="sc-del" title="${esc(t("tool_delete"))}" onclick="event.stopPropagation();_deleteCustomStyle('${key}')">✕</button>`:''}
        <div class="sc-icon">${emoji}</div>
        <div class="sc-name">${label}</div>
        <div class="sc-desc">${desc}</div>
        ${prompt?`
          <button class="sc-info" title="${esc(t("title_see_instr"))}" onclick="event.stopPropagation();this.closest('.style-card').classList.toggle('flipped')">ⓘ</button>
          <div class="sc-back" onclick="event.stopPropagation()">
            <button class="sc-back-close" onclick="this.closest('.style-card').classList.remove('flipped')">×</button>
            <span class="sc-back-label">${esc(t("style_sent"))}</span>
            <div class="sc-back-text">${esc(prompt)}</div>
          </div>`:''}
      </div>`;
  }
  function render(){
    const custom=_customStyles();
    const activeKey=currentKey||"unspecified";
    openModal(`
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:14px;">
        <div><h3 style="margin:0 0 4px">${esc(t("style_title"))}</h3><p style="margin:0;font-size:13px;color:var(--muted)">${esc(t("style_sub"))}</p></div>
        <button onclick="closeModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1;padding:0">×</button>
      </div>
      <div class="style-grid">
        ${STYLES.map(s=>cardHTML(s,false,activeKey)).join("")}
        ${custom.length?`<div class="style-section-label">${esc(t("style_yours"))}</div>`:""}
        ${custom.map(c=>cardHTML(c,true,activeKey)).join("")}
        <div class="style-card sc-new" data-new="1"><div class="sc-plus">+</div><div class="sc-name">${esc(t("style_create"))}</div></div>
      </div>
    `);
    document.querySelectorAll(".style-card[data-skey]").forEach(card=>{
      card.onclick=()=>{
        const key=card.dataset.skey;
        const isCustom=card.dataset.custom==="1";
        let prompt="", label="Style";
        if(isCustom){
          const c=_customStyles().find(x=>x.key===key);
          if(c){ prompt=c.prompt||""; label=c.label; }
        } else {
          const s=STYLES.find(x=>x.key===key);
          if(s){ prompt=s.prompt; label=s.label; }
        }
        currentKey=key; currentPrompt=prompt;
        onApply(key, prompt, label);
        closeModal();
      };
    });
    const newCard=document.querySelector(".style-card[data-new]");
    if(newCard) newCard.onclick=()=>_editCustomStyle(null);
  }
  window._editCustomStyle=function(key){
    const all=_customStyles();
    const existing=key?all.find(c=>c.key===key):null;
    openModal(`
      <h3>${esc(existing?t("cs_edit"):t("cs_new"))}</h3>
      <div class="field"><label>${esc(t("ed_name"))}</label>
        <input type="text" id="csName" value="${esc(existing?.label||"")}" placeholder="${esc(t("cs_name_ph"))}"></div>
      <div class="field"><label>${esc(t("cs_desc"))} <span class="hint">${esc(t("cs_desc_hint"))}</span></label>
        <input type="text" id="csDesc" value="${esc(existing?.desc||"")}" placeholder="${esc(t("cs_desc_ph"))}"></div>
      <div class="field" style="margin-bottom:20px;"><label>${esc(t("cs_instr"))} <span class="hint">${esc(t("cs_instr_hint"))}</span></label>
        <textarea id="csPrompt" style="min-height:100px">${esc(existing?.prompt||"")}</textarea></div>
      <div class="modal-foot">
        <button class="btn" onclick="_styleBack()">← ${esc(t("btn_back"))}</button>
        <button class="btn primary" onclick="_saveCustomStyleForm('${existing?.key||""}')">${esc(t("btn_save"))}</button>
      </div>
    `);
  };
  window._styleBack=function(){ render(); };
  window._saveCustomStyleForm=function(existingKey){
    const name=$("#csName")?.value.trim();
    const desc=$("#csDesc")?.value.trim();
    const prompt=$("#csPrompt")?.value.trim();
    if(!name){ toast("Name required"); return; }
    const all=_customStyles();
    if(existingKey){
      const idx=all.findIndex(c=>c.key===existingKey);
      if(idx>=0) all[idx]={...all[idx],label:name,desc,prompt};
    } else {
      all.push({key:"custom_"+Date.now(),emoji:"✏️",label:name,desc,prompt});
    }
    _saveCustomStyles(all);
    render();
  };
  window._deleteCustomStyle=async function(key){
    if(!(await confirmAction(null, "Delete this style?"))) return;
    _saveCustomStyles(_customStyles().filter(c=>c.key!==key));
    if(currentKey===key){ currentKey="unspecified"; currentPrompt=""; onApply("unspecified","","Style"); }
    render();
  };
  render();
}

const THREAD_PAGE=40;
function renderThread(messages, from=0){
  const threadEl=$("#thread");
  const start=Math.max(0, messages.length - THREAD_PAGE - from);
  const showing=messages.slice(start);
  const hidden=start; // messages not yet rendered
  threadEl.innerHTML= hidden>0
    ? `<div id="loadMore" style="text-align:center;padding:14px 0 4px"><button class="btn" id="loadMoreBtn">↑ ${Math.min(THREAD_PAGE,hidden)} ${esc(t("load_earlier"))}</button></div>`
    : "";
  const lastAssistant=[...messages].reverse().find(m=>m.role==="assistant");
  let pending=null; // a directive-classified user message, held until the reply it triggered renders
  showing.forEach(m=>{
    if(m.role==="user"){
      const cls=classifyDirective(m.content);
      if(cls){ pending={cls,text:m.content}; return; }
      pending=null;
      threadEl.appendChild(turnEl(m));
      return;
    }
    const d=pending; pending=null;
    threadEl.appendChild(turnEl(m, d, lastAssistant && m.id===lastAssistant.id));
  });
  if(pending) threadEl.appendChild(el(`<div class="turn cmd-standalone">${directiveHTML(pending.cls,pending.text)}</div>`));
  const btn=$("#loadMoreBtn");
  if(btn) btn.onclick=()=>{ const first=threadEl.children[1]; renderThread(messages, from+THREAD_PAGE); first?.scrollIntoView({block:"start"}); };
}
/* commands (/ooc /note /scene /time /as /roll) render as a collapsible note
   attached to the reply they triggered, instead of a full chat bubble */
function classifyDirective(content){
  const s=String(content||"").trim();
  if(/^\(OOC:/i.test(s)) return {icon:"💬",label:t("dir_ooc")};
  if(/^\*\[Scene:/i.test(s)) return {icon:"🎬",label:t("dir_scene")};
  if(/^\*\[Author's Note:/i.test(s)) return {icon:"📝",label:t("dir_note")};
  if(/^\*\[Time skip/i.test(s)) return {icon:"⏭",label:t("dir_time")};
  if(/^\[[^\]]+ says\]:/i.test(s)) return {icon:"🎭",label:t("dir_spoke")};
  if(s.startsWith("🎲")) return {icon:"🎲",label:t("dir_dice")};
  return null;
}
function directiveHTML(cls, text){
  return `<details class="cmd-note"><summary>${cls.icon} ${esc(cls.label)}</summary><div class="cmd-note-body">${md(text)}</div></details>`;
}
function stripMood(text){ return String(text||"").replace(/\[mood:\s*[a-z0-9 _\-]+\]/ig,"").replace(/[ \t]+\n/g,"\n").trim(); }
function splitThink(content){
  const m=String(content||"").match(/<think>([\s\S]*?)<\/think>/);
  const think=m?m[1].trim():null;
  const body=stripMood(String(content||"").replace(/<think>[\s\S]*?<\/think>/,"")).trim();
  return {think, body};
}
const NON_LATIN=/[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿऀ-ॿ]/;
function myLanguage(){
  try{
    const code=(navigator.language||"en").split("-")[0];
    return new Intl.DisplayNames(["en"],{type:"language"}).of(code) || "English";
  }catch(e){ return "English"; }
}

/* ── Slash command palette ── */
const CMDS=[
  {cmd:"/ooc",     args:"<message>",      dk:"cmd_ooc"},
  {cmd:"/note",    args:"<text>",         dk:"cmd_note"},
  {cmd:"/scene",   args:"<description>",  dk:"cmd_scene"},
  {cmd:"/time",    args:"<skip>",         dk:"cmd_time"},
  {cmd:"/as",      args:"<name> <text>",  dk:"cmd_as"},
  {cmd:"/recap",   args:"",               dk:"cmd_recap"},
  {cmd:"/roll",    args:"[dice]",         dk:"cmd_roll"},
  {cmd:"/regen",   args:"",               dk:"cmd_regen"},
  {cmd:"/continue",args:"[direction]",    dk:"cmd_continue"},
  {cmd:"/think",   args:"",               dk:"cmd_think"},
  {cmd:"/memory",  args:"",               dk:"cmd_memory"},
  {cmd:"/search",  args:"<query>",        dk:"cmd_search"},
  {cmd:"/clear",   args:"",               dk:"cmd_clear"},
  {cmd:"/export",  args:"",               dk:"cmd_export"},
  {cmd:"/mood",    args:"<name>",         dk:"cmd_mood"},
  {cmd:"/language",args:"<name>",         dk:"cmd_language"},
  {cmd:"/help",    args:"",               dk:"cmd_help"},
];
function _cmdScore(c,q){
  const name=c.cmd.slice(1), full=(name+" "+c.args+" "+t(c.dk)).toLowerCase(); q=q.toLowerCase();
  if(name===q) return 1000;
  if(name.startsWith(q)) return 800;
  if(name.includes(q)) return 500;
  const words=q.split(/\s+/).filter(Boolean);
  if(words.length&&words.every(w=>full.includes(w))) return 300;
  if(words.some(w=>full.includes(w)||name.startsWith(w))) return 100;
  let i=0,j=0; while(i<q.length&&j<name.length){if(q[i]===name[j])i++;j++;}
  return i===q.length&&q.length>1?40:0;
}
let _palSel=0,_palItems=[];
function updatePalette(val){
  const pal=$("#cmdPalette"); if(!pal) return;
  const first=val.split("\n")[0];
  if(!first.startsWith("/")){pal.hidden=true;return;}
  const after=first.slice(1); // everything after /
  // Hide once the user has typed the command + space (they're now typing args)
  if(/\S+\s/.test(after)){pal.hidden=true;return;}
  _palItems=CMDS.map(c=>({...c,_s:_cmdScore(c,after)})).filter(c=>c._s>0).sort((a,b)=>b._s-a._s);
  if(!_palItems.length){pal.hidden=true;return;}
  _palSel=0;
  pal.innerHTML=_palItems.map((c,i)=>
    `<div class="cmd-item${i===0?" sel":""}" data-i="${i}"><span class="cmd-name">${esc(c.cmd)}</span><span class="cmd-args">${esc(c.args)}</span><span class="cmd-desc">${esc(t(c.dk))}</span></div>`
  ).join("");
  pal.hidden=false;
  pal.querySelectorAll(".cmd-item").forEach(item=>item.onclick=()=>{_palSel=+item.dataset.i;commitPalette();});
}
function palNav(dir){
  const pal=$("#cmdPalette"); if(!pal||pal.hidden||!_palItems.length) return;
  _palSel=(_palSel+dir+_palItems.length)%_palItems.length;
  pal.querySelectorAll(".cmd-item").forEach((el,i)=>el.classList.toggle("sel",i===_palSel));
  pal.querySelectorAll(".cmd-item")[_palSel]?.scrollIntoView({block:"nearest"});
}
function commitPalette(){
  const c=_palItems[_palSel]; if(!c) return;
  hidePalette();
  const inp=$("#cin"); if(!inp) return;
  if(c.args){
    inp.value=c.cmd+" "; inp.focus();
    // trigger auto-resize
    autosize(inp,170);
  } else {
    inp.value=""; inp.style.height="auto";
    _execSlashCmd(c.cmd,"");
  }
}
function hidePalette(){const pal=$("#cmdPalette");if(pal)pal.hidden=true;_palItems=[];}
/* every /command that produces displayable output shares this one collapsible
   card, appended inline in the thread — never a modal, never a full bubble */
function appendCmdNote(icon, label, openByDefault=true){
  const card=el(`<div class="turn cmd-standalone"><details class="cmd-note"${openByDefault?" open":""}><summary>${icon} ${esc(label)}</summary><div class="cmd-note-body">${esc(t("loading"))}</div></details></div>`);
  $("#thread").appendChild(card); scrollDown(true);
  return card.querySelector(".cmd-note-body");
}
function showHelpNote(){
  const body=appendCmdNote("❔",t("note_slash"));
  body.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px;">
    <tbody>${CMDS.map(c=>`<tr><td style="padding:4px 10px 4px 0;font-family:var(--mono);color:var(--accent);white-space:nowrap;vertical-align:top;">${esc(c.cmd)}${c.args?` <span style="color:var(--muted)">${esc(c.args)}</span>`:""}</td><td style="padding:4px 0;color:var(--muted);">${esc(t(c.dk))}</td></tr>`).join("")}</tbody>
  </table>`;
}
async function showMemoryNote(sid){
  const body=appendCmdNote("◷",t("note_memory"));
  try{
    const mem=await api(`/api/sessions/${sid}/memory?k=50`);
    body.innerHTML = mem.length
      ? `<div style="margin-bottom:8px;">${mem.length} ${esc(t("mem_list_head"))}</div><ul style="margin:0;padding-left:18px;">${mem.map(m=>`<li style="margin:3px 0;">${esc(m.text)}</li>`).join("")}</ul>`
      : esc(t("no_memories"));
  }catch(e){ body.innerHTML = `<span style="color:var(--warn)">Couldn't load memory: ${esc(e.message)}</span>`; }
  scrollDown();
}
async function showSearchNote(sid, query){
  const body=appendCmdNote("⌕",t("note_search")+" "+query);
  try{
    const mem=await api(`/api/sessions/${sid}/memory?q=${encodeURIComponent(query)}&k=20`);
    body.innerHTML = mem.length
      ? `<div style="margin-bottom:8px;">${mem.length} ${esc(t("search_results_head"))}</div><ul style="margin:0;padding-left:18px;">${mem.map(m=>`<li style="margin:3px 0;">${esc(m.text)}</li>`).join("")}</ul>`
      : esc(t("no_matches"));
  }catch(e){ body.innerHTML = `<span style="color:var(--warn)">${esc(t("search_failed"))} ${esc(e.message)}</span>`; }
  scrollDown();
}
async function _execSlashCmd(cmd,args){
  const cs=ChatState.current();
  const sid=cs&&cs.sid;
  if(!sid) return;
  switch(cmd){
    case "/think":{
      THINK=!THINK; store.set("think",THINK?"1":"0");
      const tt=$("#thinkToggle");
      if(tt){tt.textContent="🧠 "+t("think_word")+" "+(THINK?t("on_word"):t("off_word"));tt.style.color=THINK?"var(--accent)":"var(--muted)";tt.style.borderColor=THINK?"var(--accent)":"var(--line-2)";}
      toast("Thinking "+(THINK?"on":"off")); break;}
    case "/memory": showMemoryNote(sid); break;
    case "/search": if(args) showSearchNote(sid,args); else showMemoryNote(sid); break;
    case "/export":
      try{const s=await api("/api/sessions/"+sid); exportChat(cs.c,s);}catch(e){errorToast("Export failed.");} break;
    case "/regen": regen(); break;
    case "/continue": await continueMessage(args); break;
    case "/clear":
      if(!(await confirmAction(null, "Clear all memories from this chat?"))) break;
      try{await api(`/api/sessions/${sid}/memory`,{method:"DELETE"});toast("Memory cleared.");}
      catch(e){errorToast("Failed: "+e.message);} break;
    case "/recap": showRecap(sid); break;
    case "/mood": if(args)applyScene(args.trim()); break;
    case "/language":{
      const lang=args.trim();
      const body=appendCmdNote("🌐",t("note_language"));
      try{
        await api(`/api/sessions/${sid}/language`, j("PUT",{language:lang||null}));
        cs.language=lang;
        const btn=$("#langBtn");
        if(btn){ btn.classList.toggle("active", !!lang); btn.title=lang?`Reply language: ${lang}`:"Reply language"; }
        body.innerHTML = lang ? `Now replying in <b>${esc(lang)}</b>.` : "Language reset to the default (English).";
      }catch(e){ body.innerHTML = `<span style="color:var(--warn)">Couldn't set language: ${esc(e.message)}</span>`; }
      break;}
    case "/help": showHelpNote(); break;
  }
}
async function showRecap(sid){
  const body=appendCmdNote("📖",t("note_recap"));
  try{
    const r=await api(`/api/sessions/${sid}/summarize`,{method:"POST"});
    body.innerHTML = r.summary ? md(r.summary) : "Nothing to recap yet — the story hasn't started.";
  }catch(e){
    body.innerHTML = `<span style="color:var(--warn)">Couldn't generate a recap: ${esc(e.message)}</span>`;
  }
  scrollDown();
}
function thinkBlock(text, open){
  if(!text) return "";
  const transBtn=NON_LATIN.test(text)?`<button class="think-trans" onclick="translateThinkEl(this)" title="${esc(t("title_translate_to"))} ${esc(myLanguage())}">🌐 ${esc(t("tool_translate"))}</button>`:"";
  return `<details class="think"${open?" open":""}><summary>💭 ${esc(t("thought_process"))}${transBtn}</summary><div class="think-body">${md(text)}</div></details>`;
}
async function translateThinkEl(btn){
  btn.disabled=true; btn.textContent="…";
  const det=btn.closest(".think"), body=det.querySelector(".think-body");
  try{
    const lang=myLanguage();
    const d=await api("/api/translate", j("POST",{text:body.innerText, target:lang, sid:(ChatState.current()||{}).sid}));
    if(d.translated){ body.innerHTML=md(d.translated); btn.textContent="✓"; btn.title=`Translated to ${lang}`; }
    else { btn.disabled=false; btn.textContent="🌐 "+t("tool_translate"); toast("Translation came back empty — try again."); }
  }catch(e){ btn.disabled=false; btn.textContent="🌐 "+t("tool_translate"); }
}
function turnEl(m, directive, isLast){
  const cs = ChatState.current();
  const c = cs.c;
  if(m.role === "assistant"){
    const {think, body} = splitThink(m.content);
    // Only render thinkBlock if THINK is enabled
    const showThink = THINK && think;
    const bodyIsOOC = /^\(OOC:/i.test(body.trim());
    // Regenerate/continue rewrite the trailing turn server-side (db.pop_trailing_assistant),
    // so they only make sense on the newest reply — offering them on older ones would silently
    // discard every message that came after, which looks like data loss to the user.
    const canRegen = isLast!==false;
    const e = el(`<div class="turn ai${bodyIsOOC?" ooc":""}" data-id="${m.id}" data-raw="${esc(m.content||"")}">
      <div class="name">${esc(c.name)}${bodyIsOOC?' <span class="ooc-tag">OOC</span>':""}</div>
      ${directive ? directiveHTML(directive.cls, directive.text) : ""}
      ${showThink ? thinkBlock(think, false) : ""}
      <div class="md">${md(body)}</div>
      ${m.image?`<details class="cmd-note msg-image-note" open><summary>🎨 ${esc(t("dir_image"))}</summary><div class="cmd-note-body"><img class="${nsfwCls(c).trim()}" src="${esc(mediaURL(m.image))}" alt=""></div></details>`:""}
      <div class="tools">
        <button class="tool" data-act="copy">${esc(t("tool_copy"))}</button>
        <button class="tool" data-act="translate">${esc(t("tool_translate"))}</button>
        ${canRegen ? `<button class="tool" data-act="regen">${esc(t("tool_regenerate"))}</button>` : ""}
        <button class="tool" data-act="edit">${esc(t("tool_edit"))}</button>
        ${canRegen ? `<button class="tool" data-act="continue">${esc(t("tool_continue"))}</button>
        <button class="tool" data-act="cont_dir">${esc(t("tool_continue_with"))}</button>` : ""}
        <button class="tool" data-act="image">${esc(m.image?t("tool_image_regen"):t("tool_image"))}</button>
        <button class="tool danger" data-act="del">${esc(t("tool_delete"))}</button>
      </div></div>`);
    wireTools(e, m); return e;
  }
  const e=el(`<div class="turn you" data-id="${m.id}" data-raw="${esc(m.content||"")}">
    <div class="you-label">${esc(cs.user_name||"You")}</div>
    <div>
      <div class="bubble">
        <div class="md">${md(m.content)}</div>
      </div>
      <div class="tools">
        <button class="tool" data-act="copy">${esc(t("tool_copy"))}</button>
        <button class="tool" data-act="translate">${esc(t("tool_translate"))}</button>
        <button class="tool" data-act="edit">${esc(t("tool_edit"))}</button>
        <button class="tool danger" data-act="del">${esc(t("tool_delete"))}</button>
      </div>
    </div>
  </div>`);
  wireTools(e,m); return e;
}
function recallHTML(meta){
  if(!meta||(!meta.lore?.length&&!meta.memory?.length)) return "";
  const block=(title,arr)=> arr&&arr.length?`<b>${title}</b><ul>${arr.map(x=>`<li>${esc(x.replace(/^- /,""))}</li>`).join("")}</ul>`:"";
  return `<details class="recall"><summary>▸ ${esc(t("drew_on"))} (${(meta.lore?.length||0)+(meta.memory?.length||0)})</summary><div class="body">${block(esc(t("recall_lore")),meta.lore)}${block(esc(t("recall_memory")),meta.memory)}</div></details>`;
}
function wireTools(e,m){ e.querySelectorAll(".tool").forEach(b=>b.onclick=()=>msgAction(b.dataset.act,m.id)); }
async function msgAction(act, mid){
  const cs=ChatState.current(); if(!cs||cs.generating) return;
  const {sid} = cs;

  if(act === "copy"){
    const node=[...$("#thread").children].find(x=>x.dataset.id===mid);
    const text=node?.querySelector(".md")?.innerText||"";
    navigator.clipboard.writeText(text).then(()=>toast("Copied.")).catch(()=>errorToast("Copy failed."));
    return;
  } else if(act === "translate"){
    const node=[...$("#thread").children].find(x=>x.dataset.id===mid); if(!node) return;
    const mdEl=node.querySelector(".md"); const btn=node.querySelector('[data-act="translate"]');
    if(!mdEl||!btn) return;
    btn.disabled=true; const label=btn.textContent; btn.textContent="…";
    try{
      const lang=myLanguage();
      const d=await api("/api/translate", j("POST",{text:mdEl.innerText, target:lang, sid:cs.sid}));
      if(d.translated){ mdEl.innerHTML=md(d.translated); btn.textContent="✓ translated"; btn.title=`Translated to ${lang}`; }
      else { btn.disabled=false; btn.textContent=label; toast("Translation came back empty — try again."); }
    }catch(e){ btn.disabled=false; btn.textContent=label; errorToast("Translate failed: "+e.message); }
    return;
  } else if(act === "del"){
    await api(`/api/sessions/${sid}/messages/${mid}`, {method: "DELETE"});
    invalidateRecent(); loadRecent(true);
    reload();
  } else if(act === "edit"){
    const node=[...$("#thread").children].find(x=>x.dataset.id===mid); if(!node) return;
    const mdEl=node.querySelector(".md");
    const toolsEl=node.querySelector(".tools");
    const raw=node.dataset.raw||mdEl.innerText||"";
    const ta=document.createElement("textarea");
    ta.className="inline-edit-ta"; ta.value=raw; ta.rows=Math.max(3,raw.split("\n").length);
    const bar=el(`<div class="inline-edit-bar"><button class="btn primary" id="ied_save">${esc(t("btn_save"))}</button><button class="btn" id="ied_cancel">${esc(t("btn_cancel"))}</button></div>`);
    mdEl.replaceWith(ta); toolsEl.replaceWith(bar); ta.focus();
    const restore=()=>{ ta.replaceWith(mdEl); bar.replaceWith(toolsEl); };
    bar.querySelector("#ied_cancel").onclick=restore;
    bar.querySelector("#ied_save").onclick=async()=>{
      const next=ta.value;
      await api(`/api/sessions/${sid}/messages/${mid}`,j("PATCH",{content:next}));
      invalidateRecent(); loadRecent(true);
      reload();
    };
    ta.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); restore(); }
      if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); bar.querySelector("#ied_save").click(); } });
  } else if(act === "image"){
    const openImageGenModal=async()=>{
      const {checkpoints, loras}=await getImagegenOptions();
      if(!checkpoints.length){ toast("No ComfyUI checkpoints found — check the Image generation settings."); return; }
      openModal(`
        <div class="img-gen-head"><span class="img-gen-icon">🎨</span><h3>${esc(t("img_gen_title"))}</h3></div>
        <div class="field-group">
          <div class="field"><label>${esc(t("img_gen_checkpoint"))}</label>
            <div id="ig_ckpt"></div></div>
          <div class="field"><label>${esc(t("img_gen_lora"))}</label>
            <div id="ig_lora"></div></div>
        </div>
        <button type="button" class="ig-show-more" id="ig_upscaler_req_btn">${esc(t("ig_upscaler_request_link"))}</button>
        <div class="field"><label>${esc(t("img_gen_reference"))} <span class="hint">${esc(t("img_gen_reference_hint"))}</span></label>
          <div id="ig_ref"></div></div>
        <div class="field"><label>${esc(t("img_gen_positive"))}</label>
          <textarea id="ig_positive" class="ig-autosize" rows="1" placeholder="${esc(t("img_gen_prompt_loading"))}"></textarea></div>
        <div class="field"><label>${esc(t("img_gen_negative"))}</label>
          <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("img_gen_prompt_loading"))}"></textarea></div>
        <div class="modal-foot"><button class="btn" id="ig_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ig_go">${esc(t("img_gen_generate"))}</button></div>`);
      $("#ig_cancel").onclick=closeModal;
      $("#ig_upscaler_req_btn").onclick=()=>openUpscalerRequestModal();
      const ckptSel=mountCheckpointButton($("#ig_ckpt"), checkpoints, {previews:_checkpointPreviews||{}});
      const loraPicker=mountLoraButton($("#ig_lora"), loras, {previews:_loraPreviews||{}});
      const refPicker=mountReferenceImagePicker($("#ig_ref"));
      [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{ ta.addEventListener("input",()=>autosize(ta)); ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0)); });
      $("#ig_positive").disabled=$("#ig_negative").disabled=true;
      api(`/api/sessions/${sid}/messages/${mid}/image-prompt`,{method:"POST"}).then(r=>{
        $("#ig_positive").value=r.positive; $("#ig_negative").value=r.negative;
        $("#ig_positive").disabled=$("#ig_negative").disabled=false;
        autosize($("#ig_positive")); autosize($("#ig_negative"));
      }).catch(e=>{
        $("#ig_positive").placeholder=$("#ig_negative").placeholder=t("img_gen_prompt_failed");
        $("#ig_positive").disabled=$("#ig_negative").disabled=false;
      });
      $("#ig_go").onclick=()=>{
        const body={checkpoint:ckptSel.value, loras:loraPicker.getSelected(),
          reference_image:refPicker.getDataUrl(), denoise:refPicker.getDenoise(),
          positive:$("#ig_positive").value.trim()||null, negative:$("#ig_negative").value.trim()||null};
        closeModal();
        const imgNode=[...$("#thread").children].find(x=>x.dataset.id===mid);
        const existing=imgNode?.querySelector(".msg-image-note .cmd-note-body");
        const noteBody = existing || appendCmdNote("🎨", t("dir_image_generating"));
        if(existing){
          existing.closest("details").querySelector("summary").innerHTML=`🎨 ${esc(t("dir_image_generating"))}`;
          existing.textContent=t("loading");
        }
        api(`/api/sessions/${sid}/messages/${mid}/image`, j("POST",body)).then(r=>{
          noteBody.closest("details").querySelector("summary").innerHTML=`🎨 ${esc(t("dir_image"))}`;
          noteBody.innerHTML=`<img class="${nsfwCls(ChatState.current().c).trim()}" src="${esc(mediaURL(r.image))}" alt="">`;
        }).catch(e=>{
          noteBody.closest("details").querySelector("summary").innerHTML=`🎨 ${esc(t("img_gen_failed"))}`;
          noteBody.textContent=e.message;
        });
      };
    };
    const imgNode=[...$("#thread").children].find(x=>x.dataset.id===mid);
    const imgTools=imgNode?.querySelector(".tools");
    const imgBtn=imgTools?.querySelector("[data-act='image']");
    if(!imgNode?.querySelector(".msg-image-note") || !imgBtn){ openImageGenModal(); return; }
    if(imgBtn.dataset.confirming){ return; }
    imgBtn.dataset.confirming="1";
    imgBtn.textContent=t("tool_image_confirm"); imgBtn.style.color="var(--warn)";
    const cancelBtn=el(`<button class="tool">${esc(t("btn_cancel"))}</button>`);
    imgTools.appendChild(cancelBtn);
    const restore=()=>{
      delete imgBtn.dataset.confirming;
      imgBtn.textContent=t("tool_image_regen"); imgBtn.style.color="";
      cancelBtn.remove(); clearTimeout(timer);
    };
    const timer=setTimeout(restore, 3000);
    cancelBtn.onclick=restore;
    imgBtn.onclick=()=>{ restore(); openImageGenModal(); };
    return;
  } else if(act === "regen"){
    const regenNode=[...$("#thread").children].find(x=>x.dataset.id===mid);
    const regenTools=regenNode?.querySelector(".tools");
    const regenBtn=regenTools?.querySelector("[data-act='regen']");
    if(!regenBtn){ regen(); return; }
    if(regenBtn.dataset.confirming){ return; } // already waiting — ignore extra clicks
    regenBtn.dataset.confirming="1";
    regenBtn.textContent="confirm ↺"; regenBtn.style.color="var(--warn)";
    const cancelBtn=el(`<button class="tool">cancel</button>`);
    regenTools.appendChild(cancelBtn);
    const restore=()=>{
      delete regenBtn.dataset.confirming;
      regenBtn.textContent="regenerate"; regenBtn.style.color="";
      regenBtn.onclick=()=>msgAction("regen",mid);
      cancelBtn.remove(); clearTimeout(timer);
    };
    const timer=setTimeout(restore, 3000);
    cancelBtn.onclick=restore;
    regenBtn.onclick=()=>{ restore(); regen(); };
  } else if(act === "continue" || act === "cont_dir"){
    if(act === "cont_dir"){
      const node=[...document.querySelectorAll(".turn.ai")].pop(); if(!node) return;
      const toolsEl=node.querySelector(".tools");
      const bar=el(`<div class="inline-edit-bar"><input class="inline-dir-input" placeholder="${esc(t("steer_ph"))}" style="flex:1"><button class="btn primary" id="icd_go">${esc(t("btn_go"))}</button><button class="btn" id="icd_cancel">${esc(t("btn_cancel"))}</button></div>`);
      toolsEl.replaceWith(bar); const inp=bar.querySelector("input"); inp.focus();
      const restore=()=>bar.replaceWith(toolsEl);
      bar.querySelector("#icd_cancel").onclick=restore;
      const go=()=>{ restore(); continueMessage(inp.value.trim()); };
      bar.querySelector("#icd_go").onclick=go;
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); go(); } if(e.key==="Escape"){ e.preventDefault(); restore(); } });
    } else {
      await continueMessage("");
    }
  }
}

async function continueMessage(content) {
  const cs=ChatState.current(); if(!cs) return;
  const lastAiNode = [...document.querySelectorAll(".turn.ai")].pop();
  if (!lastAiNode) return;
  await streamReply(`/api/sessions/${cs.sid}/continue`,
                    j("POST", {content: content, think: THINK}),
                    lastAiNode);
}
async function reload(){ const cs=ChatState.current(); if(!cs) return; const s=await api("/api/sessions/"+cs.sid); if(!ChatState.isActive(cs.sid)) return; renderThread(s.messages); }
function scrollDown(force){ const sc=$("#cscroll"); if(!sc) return; if(force||sc.scrollHeight-sc.scrollTop-sc.clientHeight<140) sc.scrollTop=sc.scrollHeight; }
function setGen(on){ const cs=ChatState.current(); if(cs) cs.generating=on; const b=$("#csend"); if(!b) return; b.classList.toggle("stop",on); b.textContent=on?"■":"↑"; }
function stopGen(){ const cs=ChatState.current(); if(cs&&cs.abort) cs.abort.abort(); }
async function doSend(){
  const cs=ChatState.current(); if(!cs) return;
  const inp=$("#cin"); let text=inp.value.trim(); if(!text||cs.generating) return;
  inp.value=""; inp.style.height="auto"; hidePalette();
  store.set("draft:"+cs.sid,"");
  if(text.startsWith("/")){
    const sp=text.indexOf(" "); const cmd=(sp===-1?text:text.slice(0,sp)).toLowerCase();
    const args=sp===-1?"":text.slice(sp+1).trim();
    switch(cmd){
      case "/ooc":   text="(OOC: "+(args||"…")+")"; break;
      case "/note":  text=`*[Author's Note: ${args}]*`; break;
      case "/scene": text=`*[Scene: ${args}]*`; break;
      case "/time":  text=`*[Time skip — ${args}]*`; break;
      case "/as":{const ns=args.indexOf(" ");const name=ns===-1?args:args.slice(0,ns);const said=ns===-1?"…":args.slice(ns+1).trim(); text=`[${name} says]: "${said}"`; break;}
      case "/roll":
        await streamReply(`/api/sessions/${cs.sid}/roll`,j("POST",{expr:args||"1d20",think:THINK}),
                          null,{cls:{icon:"🎲",label:t("dir_dice")},text:"🎲 "+(args||"1d20")});
        return;
      default: await _execSlashCmd(cmd,args); return;
    }
  }
  const cls=classifyDirective(text);
  if(!cls){ $("#thread").appendChild(turnEl({id:"tmp"+Date.now(),role:"user",content:text})); scrollDown(true); }
  await streamReply(`/api/sessions/${cs.sid}/chat`, j("POST",{content:text, think:THINK}), null, cls?{cls,text}:null);
}
async function regen(){
  const cs=ChatState.current(); if(!cs||cs.generating) return;
  let n=$("#thread").lastElementChild;
  while(n && n.classList.contains("ai")){ const p=n.previousElementSibling; n.remove(); n=p; }
  await streamReply(`/api/sessions/${cs.sid}/regenerate`, j("POST",{think:THINK}));
}
function finalizeStreamedTurn(aiNode, doneMsg, userMid, directive, meta){
  const finalNode = turnEl(doneMsg, directive, true);
  if(meta){ const rEl=el(recallHTML(meta)); if(rEl) finalNode.appendChild(rEl); }
  aiNode.replaceWith(finalNode);
  // the previously-last reply is no longer the tail: drop its regenerate/continue
  // actions (which only make sense on the newest turn), matching turnEl(isLast:false).
  $("#thread").querySelectorAll(".turn.ai").forEach(node=>{
    if(node===finalNode) return;
    node.querySelectorAll('[data-act="regen"],[data-act="continue"],[data-act="cont_dir"]').forEach(b=>b.remove());
  });
  // promote the optimistic user bubble to its persisted id so edit/delete target it
  if(userMid){
    const tmp=[...$("#thread").children].find(x=>x.dataset && String(x.dataset.id||"").startsWith("tmp"));
    if(tmp){ tmp.dataset.id=userMid; wireTools(tmp,{id:userMid}); }
  }
  return finalNode;
}
async function streamReply(path, opts, targetNode = null, directive = null) {
  const cs=ChatState.current(); if(!cs) return;
  setGen(true);

  // If targetNode is provided, use it. Otherwise, create new.
  const aiNode = targetNode || el(`<div class="turn ai"><div class="name">${esc(cs.c.name)}</div>${directive?directiveHTML(directive.cls,directive.text):""}<div class="md"><span class="cursor"></span></div></div>`);

  if (!targetNode) {
    $("#thread").appendChild(aiNode);
  }

  scrollDown(true);
  const mdEl = aiNode.querySelector(".md");

  // Clear cursor if updating existing content
  if (targetNode) mdEl.innerHTML = md(mdEl.innerText) + '<span class="cursor"></span>';

  cs.abort = new AbortController();
  // The model's canon generation happens in Chinese and is never sent to the client —
  // the backend buffers it, translates it, and streams *that*. So instead of a live
  // token-by-token thinking bubble, show a single Gemini-style status placeholder
  // until the first translated delta arrives; the real (translated) thought process,
  // if any, is attached afterward from the final `done` message, same as reload does.
  let acc="", meta=null, statusEl=null, thinkAcc="", thinkEl=null, doneMsg=null, userMid=null;
  const STATUS_LABEL={generating:t("status_generating"), translating:t("status_translating")};
  const setStatus=(phase)=>{
    if(!statusEl){ statusEl=el(`<div class="think"><span class="pulse"></span><span class="status-label"></span></div>`);
      aiNode.insertBefore(statusEl, mdEl); }
    statusEl.querySelector(".status-label").textContent=STATUS_LABEL[phase]||phase;
  };
  try{
    const res=await fetch(API+path,{...opts, headers:{"Content-Type":"application/json", ...(opts.headers||{})}, signal:cs.abort.signal});
    if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
    await sseEvents(res, ev=>{
        if(ev.type==="meta"){ meta=(ev.lore?.length||ev.memory?.length)?ev:null; userMid=ev.user_mid||null;
          if(ev.retrieve_error && !cs.warnedRetrieve){ cs.warnedRetrieve=true;
            errorToast("⚠ Memory/lore lookup failed — check the embedding backend in Settings."); } }
        else if(ev.type==="status"){ setStatus(ev.phase); }
        else if(ev.type==="thinking"){
          if(statusEl){ statusEl.remove(); statusEl=null; }
          if(!thinkEl){
            thinkEl=el(`<details class="think" open><summary>💭 ${esc(t("thought_process"))}</summary><div class="think-body"></div></details>`);
            aiNode.insertBefore(thinkEl, mdEl);
          }
          thinkAcc+=ev.content;
          thinkEl.querySelector(".think-body").innerHTML=md(thinkAcc);
          scrollDown();
        }
        else if(ev.type==="delta"){ if(statusEl){ statusEl.remove(); statusEl=null; } acc+=ev.content; mdEl.innerHTML=md(stripMood(acc))+'<span class="cursor"></span>'; scrollDown(); }
        else if(ev.type==="error"){ acc+="\n\n*— "+ev.message+"*"; }
        else if(ev.type==="done"){
          doneMsg=ev.message||null;
          if(typeof applyScene==="function" && cs.c && cs.c.assets) applyScene(ev.mood||null);
          if(ev.memory_error) toast("⚠ This turn wasn't saved to memory — check the embedding backend in Settings.");
          // thinking (already translated) is rendered from message.content by
          // turnEl (finalizeStreamedTurn) once the stream ends, same splitThink/
          // thinkBlock path used for history — no need to do it here too.
        }
    });
    if(statusEl){ statusEl.remove(); statusEl=null; }
    mdEl.innerHTML=md(stripMood(acc)||"*"+t("no_response")+"*");
  }catch(err){
    if(err.name==="AbortError") mdEl.innerHTML=md(acc||"*"+t("stopped")+"*");
    else mdEl.innerHTML=md(acc)+`<p style="color:var(--warn)">${esc(t("backend_unreachable"))} (${esc(err.message)}).</p>`;
  }finally {
    cs.abort = null;
    if(doneMsg) invalidateRecent();
    // Navigated away mid-stream: the chat DOM is gone and this state is stale — don't
    // touch #thread / #csend. ChatState.clear() already aborted us into the catch above.
    if(ChatState.isActive(cs.sid)){
      setGen(false);
      // Only NEW turns are appended incrementally (from the persisted `done` message);
      // if the stream was aborted/errored with no `done`, fall back to a full reload.
      if(doneMsg) finalizeStreamedTurn(aiNode, doneMsg, userMid, directive, meta);
      else await reload();
      scrollDown();
      // Auto-name the session on first reply
      const _sid=cs.sid;
      const _cur=document.querySelector(`.session-row[data-id="${_sid}"] .t`);
      if(_sid && acc && ["Chat", trNow("Chat")].includes((_cur?.textContent||"").trim())){
        const _title=acc.replace(/<[^>]+>|\(OOC:[^)]*\)|[*_`#>\[\]()~]/g,"").trim()
                        .split(/[.!?\n]/)[0].trim().slice(0,60).replace(/\s+\S{0,15}$/,"").trim()||"Chat";
        if(_title!=="Chat") api(`/api/sessions/${_sid}`,j("PATCH",{title:_title})).then(()=>{ invalidateRecent(); if(_cur) _cur.textContent=_title; }).catch(()=>{});
      }
      loadRecent(true);
    }
  }
}