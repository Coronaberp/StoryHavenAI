"use strict";
/* ============================ CHAT (core view + message list) ============================ */
class ChatStateManager{
  constructor(){ this._s=null; }
  set(state){ this.clear(); this._s=state; return state; }
  current(){ return this._s; }
  isActive(sid){ return !!this._s && this._s.sid===sid; }
  clear(){
    const s=this._s;
    this._s=null;
    if(s && s.abort){ try{ s.abort.abort(); }catch(e){} }
  }
}
const ChatState=new ChatStateManager();
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
