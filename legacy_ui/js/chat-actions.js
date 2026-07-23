"use strict";
/* ============================ CHAT ACTIONS (send/regen/continue/roll SSE, slash commands) ============================ */
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
