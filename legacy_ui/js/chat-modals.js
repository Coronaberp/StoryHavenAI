"use strict";
/* ============================ CHAT MODALS (memory, char-state, response style, language, glossary, author's note) ============================ */
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

function _customStyles(){
  try{ return JSON.parse(localStorage.getItem("storyhavenai_styles")||localStorage.getItem("personae_styles")||"[]"); }
  catch{ return []; }
}
function _saveCustomStyles(arr){ localStorage.setItem("storyhavenai_styles", JSON.stringify(arr)); }

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
