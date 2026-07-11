"use strict";
/* ============================ COMMENTS ============================ */
function autoGrowTextarea(ta){
  if(!ta) return;
  const grow=()=>{ ta.style.height="auto"; ta.style.height=Math.min(ta.scrollHeight,160)+"px"; };
  ta.addEventListener("input",grow);
  grow();
}
function timeAgo(ts){
  if(!ts) return "";
  let s=Math.floor(Date.now()/1000-Number(ts));
  if(s<1) s=1;
  const units=[["y",31536000],["mo",2592000],["d",86400],["h",3600],["m",60]];
  for(const [label,secs] of units){ if(s>=secs) return Math.floor(s/secs)+label+" ago"; }
  return s+"s ago";
}
function cmtAva(avatarUrl, name){
  const a=mediaURL(avatarUrl);
  return a?`<img class="cmt-ava" src="${esc(a)}" alt="">`
          :`<div class="cmt-ava mono">${esc((name||"?")[0].toUpperCase())}</div>`;
}
const _MENTION_RE_JS = /(?<!\w)@([A-Za-z0-9_-]{2,32})/g;
function renderCmtBody(content){
  // Full markdown now (not just @mentions + escaping) — mainly so a fenced
  // code block (```python ... ```) renders as an inert, monospaced, labeled
  // code block via marked.js's normal handling, exactly like a chat message
  // already does via md(). It never executes: <pre><code> is just text
  // content in the DOM, and DOMPurify sanitizes the final HTML regardless
  // of what the commenter typed.
  content = String(content ?? "");
  _MENTION_RE_JS.lastIndex = 0;
  let out="", last=0, m;
  while((m=_MENTION_RE_JS.exec(content))){
    out += content.slice(last, m.index);
    const uname = m[1];
    const href = "/u/" + encodeURIComponent(uname.toLowerCase()==="dev" ? "zukaarimoto" : uname);
    out += `<a class="mention" href="${esc(href)}">@${esc(uname)}</a>`;
    last = m.index + m[0].length;
  }
  out += content.slice(last);
  out = out.replace(/:([a-z0-9_]{2,32}):/g, (whole, code)=>{
    const emo=_customEmojiByShortcode(code);
    if(!emo||emo.kind!=="emoji") return whole;
    return `<img class="cmt-custom-emoji${nsfwCls(emo)}" src="${esc(mediaURL(emo.image))}" alt=":${esc(code)}:" title=":${esc(code)}:">`;
  });
  return md(out);
}
// Discord-style link preview — purely client-side (the browser fetches the
// image directly; the server never touches the URL at all). Restricted to
// direct image/gif file links or an admin-curated host allowlist (see
// _loadEmbedLinkHosts) rather than embedding literally any link, since an
// unrestricted "preview any URL" feature is itself a tracking/IP-logging
// vector for whoever posts the link.
const _URL_RE_JS = /https?:\/\/[^\s<>"']+/gi;
function _findEmbeddableImageUrl(content){
  const matches = String(content||"").match(_URL_RE_JS) || [];
  for(const raw of matches){
    let u;
    try{ u=new URL(raw); }catch(e){ continue; }
    const path=u.pathname.toLowerCase();
    if(/\.(gif|png|jpe?g|webp)$/.test(path)) return raw;
    if(_embedLinkHosts.some(h=>u.hostname===h||u.hostname.endsWith("."+h))) return raw;
  }
  return null;
}
function attachMentionAutocomplete(el){
  let dd=null, items=[], activeIdx=-1, ctxStart=-1, ctxEnd=-1, debounceT=null, reqSeq=0;
  function closeDD(){
    if(dd){ dd.remove(); dd=null; }
    items=[]; activeIdx=-1; ctxStart=-1; ctxEnd=-1;
  }
  function currentContext(){
    const pos=el.selectionStart;
    if(pos==null) return null;
    const upto=el.value.slice(0,pos);
    const m=upto.match(/(?:^|[^\w])@([A-Za-z0-9_-]*)$/);
    if(!m) return null;
    return {query:m[1], start:pos-m[1].length-1, end:pos};
  }
  function positionDD(){
    if(!dd) return;
    const r=el.getBoundingClientRect();
    dd.style.left=r.left+"px";
    dd.style.top=(r.bottom+4)+"px";
    dd.style.minWidth=Math.min(Math.max(r.width,220),320)+"px";
  }
  function renderDD(){
    if(!items.length){ closeDD(); return; }
    if(!dd){ dd=document.createElement("div"); dd.className="mention-dd"; document.body.appendChild(dd); }
    dd.innerHTML=items.map((u,i)=>{
      const ava=mediaURL(u.avatar);
      const label=u._mentionAs||u.username;
      const avaHtml=ava?`<img class="mention-dd-ava" src="${esc(ava)}" alt="">`
        :`<div class="mention-dd-ava mono">${esc((u.display_name||label||"?")[0].toUpperCase())}</div>`;
      return `<div class="mention-dd-item${i===activeIdx?" active":""}" data-idx="${i}">${avaHtml}
        <span class="mention-dd-name"><span class="mention-dd-user">@${esc(label)}</span>
        ${u.display_name?`<span class="mention-dd-disp">${esc(u.display_name)}</span>`:""}</span></div>`;
    }).join("");
    positionDD();
    dd.querySelectorAll(".mention-dd-item").forEach(it=>{
      it.addEventListener("mousedown", e=>{ e.preventDefault(); select(parseInt(it.dataset.idx,10)); });
    });
  }
  function select(idx){
    const u=items[idx]; if(!u) return;
    const ctx=currentContext();
    const start = ctx ? ctx.start : ctxStart, end = ctx ? ctx.end : ctxEnd;
    if(start<0){ closeDD(); return; }
    const label=u._mentionAs||u.username;
    const text=el.value;
    const insert="@"+label+" ";
    el.value=text.slice(0,start)+insert+text.slice(end);
    const newPos=start+insert.length;
    el.focus();
    el.setSelectionRange(newPos,newPos);
    el.dispatchEvent(new Event("input", {bubbles:true}));
    closeDD();
  }
  async function fetchAndShow(query){
    const seq=++reqSeq;
    const wantsDev = "dev".includes(query.toLowerCase());
    const tasks=[api("/api/users?q="+encodeURIComponent(query)).catch(()=>[])];
    if(wantsDev) tasks.push(api("/api/users?q=zukaarimoto").catch(()=>[]));
    const [normal, devRes] = await Promise.all(tasks);
    if(seq!==reqSeq) return;
    let list=(normal||[]).slice();
    if(wantsDev){
      const zuka=(devRes||[]).find(u=>u.username==="zukaarimoto");
      if(zuka){
        list=list.filter(u=>u.username!=="zukaarimoto");
        list.unshift(Object.assign({}, zuka, {_mentionAs:"dev"}));
      }
    }
    items=list.slice(0,8);
    activeIdx=items.length?0:-1;
    renderDD();
  }
  el.addEventListener("input", ()=>{
    const ctx=currentContext();
    if(!ctx){ closeDD(); return; }
    ctxStart=ctx.start; ctxEnd=ctx.end;
    clearTimeout(debounceT);
    debounceT=setTimeout(()=>fetchAndShow(ctx.query), 200);
  });
  el.addEventListener("keydown", e=>{
    if(!dd || !items.length) return;
    if(e.key==="ArrowDown"){ e.preventDefault(); e.stopImmediatePropagation(); activeIdx=(activeIdx+1)%items.length; renderDD(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); e.stopImmediatePropagation(); activeIdx=(activeIdx-1+items.length)%items.length; renderDD(); }
    else if(e.key==="Enter"||e.key==="Tab"){ e.preventDefault(); e.stopImmediatePropagation(); select(activeIdx); }
    else if(e.key==="Escape"){ e.stopImmediatePropagation(); closeDD(); }
  });
  el.addEventListener("blur", ()=>{ setTimeout(closeDD, 150); });
}
// Text/code attachments fetch their content lazily (after the comment node
// is actually in the DOM — see wireComments' textAttach loader below) rather
// than inline here, since the content isn't available synchronously; the
// dedicated route always serves it as text/plain regardless of extension
// (see routers/comments.py get_comment_attachment_text), so this can never
// render as anything other than inert text no matter what was uploaded.
function renderCmtAttachment(c){
  const kind=c.attachment_kind||"image";
  if(kind==="video") return `<div class="cmt-attach"><video src="${esc(mediaURL(c.image))}" controls preload="metadata"></video></div>`;
  if(kind==="text") return `<div class="cmt-attach cmt-attach-text" data-textfile="${esc(c.image)}"><pre><code>Loading…</code></pre></div>`;
  // A sticker is meant to read as a Discord-style borderless image (often
  // with its own transparent background already baked in), not a photo —
  // the generic .cmt-attach card chrome (background/border/padding) around
  // it looked like a mistake, framing the sticker in its own little box.
  const isSticker=_customEmojis.some(e=>e.kind==="sticker" && e.image===c.image);
  return `<div class="cmt-attach${isSticker?" cmt-attach-sticker":""}"><img class="${nsfwCls({is_explicit:c.image_is_explicit}).trim()}" src="${esc(mediaURL(c.image))}" alt="" loading="lazy"></div>`;
}
// Reaction/emoji/sticker popover UI, crop tool, and upload modal live in
// emoji-picker.js (openEmojiPopover, openComposerEmojiPopover, etc.) — none of
// that touches comment thread state, it's just called from the composer and
// reaction-add button below.
function renderCmtReactions(c){
  const reactions=c.reactions||{}, mine=new Set(c.my_reactions||[]), supers=c.reaction_supers||{};
  const pills=Object.entries(reactions).filter(([,n])=>n>0).map(([emo,n])=>
    `<button type="button" class="cmt-reaction${mine.has(emo)?" on":""}${supers[emo]?" super":""}" data-react="${esc(c.id)}" data-emoji="${esc(emo)}">${emo} <span>${n}</span></button>`
  ).join("");
  return `<div class="cmt-reactions">${pills}<button type="button" class="cmt-reaction-add" data-react-add="${esc(c.id)}" title="Add reaction">+</button></div>`;
}
function renderCommentNode(c, ctx, isReply){
  const uhref="/u/"+encodeURIComponent(c.author_username);
  const ownerCanDeleteOthers = (ctx.targetType==="character"||ctx.targetType==="image"||ctx.targetType==="thread") && ME && ctx.ownerId===ME.id;
  const canDelete = ME && (ME.id===c.author_id || ME.is_admin || ownerCanDeleteOthers);
  const canEdit = ME && ME.id===c.author_id;
  const liked=!!c.liked_by_me;
  return `<div class="cmt${isReply?" cmt-reply":""}" data-cmt="${esc(c.id)}">
    <a class="cmt-ava-link" href="${esc(uhref)}">${cmtAva(c.author_avatar, c.author_display_name||c.author_username)}</a>
    <div class="cmt-main">
      <div class="cmt-head">
        <a class="cmt-name" href="${esc(uhref)}">${esc(c.author_display_name||c.author_username)}</a>
        <span class="cmt-handle">@${esc(c.author_username)}</span>
        <span class="cmt-dot">·</span>
        <span class="cmt-time">${esc(timeAgo(c.created))}</span>
        ${c.edited_at?`<span class="cmt-edited" title="${esc(new Date(c.edited_at*1000).toLocaleString())}">(edited)</span>`:""}
        ${canEdit?`<button class="cmt-edit" data-edit="${esc(c.id)}" title="Edit" aria-label="Edit">${EDIT_ICON_SVG}</button>`:""}
        ${canDelete?`<button class="cmt-del" data-del="${esc(c.id)}" title="Delete">✕</button>`:""}
      </div>
      <div class="cmt-body">${renderCmtBody(c.content)}</div>
      ${c.image?renderCmtAttachment(c):""}
      ${(!c.image && _findEmbeddableImageUrl(c.content))?`<div class="cmt-embed"><img src="${esc(_findEmbeddableImageUrl(c.content))}" alt="" loading="lazy" onerror="this.closest('.cmt-embed').remove()"></div>`:""}
      <div class="cmt-actions">
        <button class="cmt-like${liked?" on":""}" data-like="${esc(c.id)}"><span class="cmt-heart">${liked?"♥":"♡"}</span> <span class="cmt-like-n">${c.like_count||0}</span></button>
        ${!isReply?`<button class="cmt-replybtn" data-reply="${esc(c.id)}">💬 <span>${c.reply_count||0}</span></button>`:""}
        ${(!isReply && c.reply_count)?`<button class="cmt-showreplies" data-show="${esc(c.id)}">Show replies ⌄</button>`:""}
      </div>
      ${renderCmtReactions(c)}
      ${!isReply?`<div class="cmt-replyform" data-replyform="${esc(c.id)}" style="display:none"></div>`:""}
      ${!isReply?`<div class="cmt-replies" data-replies="${esc(c.id)}" style="display:none">${(c.replies||[]).map(r=>renderCommentNode(r,ctx,true)).join("")}</div>`:""}
    </div>
  </div>`;
}
function openCommentsModal(targetType, targetId, ctx){
  openModal(`<div id="cmtModalBody"><div class="hint">Loading…</div></div>`, "modal-wide");
  renderComments(targetType, targetId, document.getElementById("cmtModalBody"), ctx);
}
async function updateCommentBtn(btn, targetType, targetId){
  if(!btn) return;
  try{
    const list=await api(`/api/comments?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`);
    const n=list.reduce((a,c)=>a+1+(c.replies?c.replies.length:0),0);
    btn.innerHTML=`💬 Comments${n?` (${n})`:""}`;
  }catch(e){}
}
async function renderComments(targetType, targetId, container, ctx){
  ctx = ctx || {};
  ctx.targetType = targetType;
  container.classList.add("cmt-section");
  let list=[], loadFailed=false;
  try{ list = await api(`/api/comments?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`); }
  catch(e){ list=[]; loadFailed=true; }
  const count = list.reduce((n,c)=>n+1+(c.replies?c.replies.length:0),0);
  const composer = ME ? `<div class="cmt-composer">
      ${cmtAva(ME.avatar, ME.username)}
      <div class="cmt-composer-main">
        <div class="cmt-composer-row">
          <button type="button" class="cmt-attach-btn" id="cmtAttachBtn" title="Attach image" aria-label="Attach image">${UPLOAD_ICON_SVG}</button>
          <input type="file" id="cmtAttachFile" accept="image/*,video/mp4,video/webm,video/quicktime,.txt,.md,.py,.js,.ts,.jsx,.tsx,.java,.c,.h,.cpp,.hpp,.cs,.go,.rs,.rb,.php,.html,.css,.json,.yaml,.yml,.sh,.sql,.xml,.swift,.kt" hidden>
          <button type="button" class="cmt-attach-btn" id="cmtGifBtn" title="Add a GIF link" aria-label="Add a GIF link">GIF</button>
          <button type="button" class="cmt-attach-btn" id="cmtEmojiBtn" title="Emoji" aria-label="Emoji">🙂</button>
          <textarea class="cmt-input cmt-new-ta" id="cmtNewInput" placeholder="Share your thoughts..." rows="1"></textarea>
          <button class="btn primary cmt-post" id="cmtNewPost">Post</button>
        </div>
        <div id="cmtAttachPreview" class="cmt-attach-preview" style="display:none;"></div>
      </div>
    </div>` : `<div class="cmt-signin">Sign in to comment.</div>`;
  container.innerHTML = `
    <div class="cmt-heading">Comments <span class="cmt-count">${count}</span></div>
    ${composer}
    <div class="cmt-list">${loadFailed
      ? `<div class="cmt-empty">Couldn't load comments — try again. <button type="button" class="btn" id="cmtRetryBtn">Retry</button></div>`
      : (list.map(c=>renderCommentNode(c,ctx,false)).join("")||`<div class="cmt-empty">No comments yet. Be the first.</div>`)}</div>`;
  wireComments(container, targetType, targetId, ctx);
  if(loadFailed){ const rb=container.querySelector("#cmtRetryBtn"); if(rb) rb.onclick=()=>renderComments(targetType, targetId, container, ctx); }
}
function wireComments(container, targetType, targetId, ctx){
  const reload=()=>renderComments(targetType, targetId, container, ctx);
  container.querySelectorAll("[data-textfile]").forEach(async box=>{
    const fname=box.dataset.textfile;
    const ext=(fname.split(".").pop()||"").toLowerCase();
    try{
      const res=await fetch(API+"/api/comments/attachment-text/"+encodeURIComponent(fname));
      const txt=await res.text();
      box.innerHTML=`<pre><code class="language-${esc(ext)}">${esc(txt.slice(0,20000))}</code></pre>`;
    }catch(e){ box.innerHTML=`<pre><code>(failed to load attachment)</code></pre>`; }
  });
  const post=container.querySelector("#cmtNewPost");
  if(post){
    const input=container.querySelector("#cmtNewInput");
    attachMentionAutocomplete(input);
    let attachedImage="", attachedKind="";
    const attachBtn=container.querySelector("#cmtAttachBtn");
    const attachFile=container.querySelector("#cmtAttachFile");
    const attachPreview=container.querySelector("#cmtAttachPreview");
    const clearAttach=()=>{ attachedImage=""; attachedKind=""; attachPreview.style.display="none"; attachPreview.innerHTML=""; attachFile.value=""; };
    const showAttachPreview=(name)=>{
      attachPreview.style.display="";
      const previewInner=attachedKind==="image"?`<img src="${esc(mediaURL(attachedImage))}" alt="">`
        :attachedKind==="video"?`<video src="${esc(mediaURL(attachedImage))}" muted></video>`
        :`<div class="cmt-attach-preview-file">📄 ${esc(name||attachedImage)}</div>`;
      attachPreview.innerHTML=`${previewInner}<button type="button" class="tool" id="cmtAttachClear">✕</button>`;
      attachPreview.querySelector("#cmtAttachClear").onclick=clearAttach;
    };
    if(attachBtn) attachBtn.onclick=()=>attachFile.click();
    if(attachFile) attachFile.onchange=async()=>{
      const f=attachFile.files[0]; if(!f) return;
      attachBtn.disabled=true;
      const fd=new FormData(); fd.append("file",f);
      try{
        const r=await api("/api/comments/upload-image",{method:"POST",body:fd});
        attachedImage=r.image; attachedKind=r.attachment_kind||"image";
        showAttachPreview(f.name);
      }catch(e){ errorToast("Upload failed: "+e.message); }
      attachBtn.disabled=false;
    };
    const insertAtCursor=text=>{
      const start=input.selectionStart??input.value.length, end=input.selectionEnd??input.value.length;
      input.value=input.value.slice(0,start)+text+input.value.slice(end);
      const pos=start+text.length; input.setSelectionRange(pos,pos); input.focus();
    };
    const emojiBtn=container.querySelector("#cmtEmojiBtn");
    if(emojiBtn) emojiBtn.onclick=e=>{
      e.stopPropagation();
      openComposerEmojiPopover(emojiBtn, text=>insertAtCursor(text), async sticker=>{
        // Discord-style: a sticker click sends immediately as its own comment
        // — it doesn't wait for the Post button, and doesn't touch whatever's
        // currently typed in the box (that stays a draft, same as Discord
        // leaves your message box alone after a sticker send).
        try{
          await api("/api/comments", j("POST",{target_type:targetType,target_id:targetId,
            content:"", image:sticker.image, attachment_kind:"image"}));
          await reload();
        }catch(e){ errorToast(e.message||"Failed"); }
      });
    };
    const gifBtn=container.querySelector("#cmtGifBtn");
    if(gifBtn) gifBtn.onclick=e=>{
      e.stopPropagation();
      document.querySelectorAll(".gif-pop").forEach(p=>p.remove());
      const pop=document.createElement("div");
      pop.className="gif-pop";
      pop.innerHTML=`<input type="text" placeholder="Paste a GIF link (tenor.com, giphy.com, or a direct .gif link)…" id="gifPopInput">
        <button type="button" class="btn primary" id="gifPopInsert">Insert</button>`;
      document.body.appendChild(pop);
      const r=gifBtn.getBoundingClientRect();
      pop.style.left=Math.max(8,r.left)+"px"; pop.style.top=(r.bottom+6)+"px";
      const gifInput=pop.querySelector("#gifPopInput"); gifInput.focus();
      const doInsert=()=>{
        const url=gifInput.value.trim();
        if(!url){ pop.remove(); return; }
        let u; try{ u=new URL(url); }catch(err){ toast("That doesn't look like a valid URL."); return; }
        const path=u.pathname.toLowerCase();
        const isDirectGif=/\.(gif|webp)$/.test(path);
        const hostAllowed=_embedLinkHosts.some(h=>u.hostname===h||u.hostname.endsWith("."+h));
        if(!isDirectGif && !hostAllowed){ toast("That link isn't from an allowed GIF host or a direct .gif file."); return; }
        insertAtCursor((input.value&&!input.value.endsWith(" ")?" ":"")+url+" ");
        pop.remove();
      };
      pop.querySelector("#gifPopInsert").onclick=doInsert;
      gifInput.onkeydown=e2=>{ if(e2.key==="Enter"){ e2.preventDefault(); doInsert(); } };
      setTimeout(()=>{
        const onOutside=e2=>{ if(!pop.contains(e2.target)){ pop.remove(); document.removeEventListener("mousedown",onOutside); } };
        document.addEventListener("mousedown",onOutside);
      },0);
    };
    const doPost=async()=>{
      const content=input.value.trim(); if(!content && !attachedImage) return;
      post.disabled=true;
      try{
        await api("/api/comments", j("POST",{target_type:targetType,target_id:targetId,content,image:attachedImage,attachment_kind:attachedKind}));
        clearAttach(); await reload();
      }
      catch(e){ errorToast(e.message||"Failed"); post.disabled=false; }
    };
    post.onclick=doPost;
    input.onkeydown=e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); doPost(); } };
    autoGrowTextarea(input);
  }
  container.querySelectorAll("[data-like]").forEach(btn=>btn.onclick=async()=>{
    if(!ME){ toast("Sign in to comment."); return; }
    const id=btn.dataset.like, on=btn.classList.contains("on");
    const nEl=btn.querySelector(".cmt-like-n"), heart=btn.querySelector(".cmt-heart");
    const bump=d=>{ nEl.textContent=Math.max(0,(parseInt(nEl.textContent)||0)+d); };
    btn.classList.toggle("on"); heart.textContent=on?"♡":"♥"; bump(on?-1:1);
    try{ await api("/api/comments/"+id+"/like",{method:on?"DELETE":"POST"}); }
    catch(e){ btn.classList.toggle("on"); heart.textContent=on?"♥":"♡"; bump(on?1:-1); errorToast(e.message); }
  });
  const reactOnComment=async(cid, emoji, remove, isSuper)=>{
    if(!ME){ toast("Sign in to react."); return; }
    try{
      await api("/api/comments/"+cid+"/react", {method:remove?"DELETE":"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify({emoji, super:!!isSuper})});
      await reload();
    }
    catch(e){ errorToast(e.message||"Failed"); }
  };
  container.querySelectorAll("[data-react]").forEach(btn=>btn.onclick=()=>{
    reactOnComment(btn.dataset.react, btn.dataset.emoji, btn.classList.contains("on"));
  });
  container.querySelectorAll("[data-react-add]").forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    openEmojiPopover(btn, _REACTION_EMOJI, (emo,isSuper)=>reactOnComment(btn.dataset.reactAdd, emo, false, isSuper), {allowSuper:true});
  });
  container.querySelectorAll("[data-show]").forEach(btn=>btn.onclick=()=>{
    const box=container.querySelector(`[data-replies="${CSS.escape(btn.dataset.show)}"]`);
    if(!box) return;
    const showing=box.style.display!=="none";
    box.style.display=showing?"none":"block";
    btn.textContent=showing?"Show replies ⌄":"Hide replies ⌃";
  });
  container.querySelectorAll("[data-reply]").forEach(btn=>btn.onclick=()=>{
    if(!ME){ toast("Sign in to comment."); return; }
    const id=btn.dataset.reply, form=container.querySelector(`[data-replyform="${CSS.escape(id)}"]`);
    if(!form) return;
    if(form.style.display!=="none"){ form.style.display="none"; form.innerHTML=""; return; }
    form.style.display="block";
    form.innerHTML=`<textarea class="cmt-input cmt-new-ta" placeholder="Write a reply..." rows="1"></textarea><button class="btn primary cmt-post">Reply</button>`;
    const inp=form.querySelector("textarea"), b=form.querySelector("button");
    attachMentionAutocomplete(inp);
    autoGrowTextarea(inp);
    const send=async()=>{ const content=inp.value.trim(); if(!content) return; b.disabled=true;
      try{ await api("/api/comments", j("POST",{target_type:targetType,target_id:targetId,content,parent_id:id})); await reload(); }
      catch(e){ errorToast(e.message); b.disabled=false; } };
    b.onclick=send; inp.onkeydown=e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } };
    inp.focus();
  });
  container.querySelectorAll("[data-edit]").forEach(btn=>btn.onclick=()=>{
    if(!ME){ toast("Sign in to comment."); return; }
    const cmt=btn.closest(".cmt"), body=cmt&&cmt.querySelector(".cmt-body");
    if(!body || body.querySelector(".cmt-editbox")) return;
    const id=btn.dataset.edit, orig=body.textContent;
    body.dataset.prev=body.innerHTML;
    body.innerHTML=`<div class="cmt-editbox"><textarea class="cmt-input cmt-edit-ta"></textarea>`+
      `<div class="cmt-edit-actions"><button class="btn primary cmt-edit-save">Save</button>`+
      `<button class="btn cmt-edit-cancel">Cancel</button></div></div>`;
    const ta=body.querySelector("textarea");
    ta.value=orig; ta.focus();
    attachMentionAutocomplete(ta);
    body.querySelector(".cmt-edit-cancel").onclick=()=>{ body.innerHTML=body.dataset.prev; };
    body.querySelector(".cmt-edit-save").onclick=async()=>{
      const content=ta.value.trim(); if(!content) return;
      const save=body.querySelector(".cmt-edit-save"); save.disabled=true;
      try{ await api("/api/comments/"+id, j("PUT",{content})); await reload(); }
      catch(e){ errorToast(e.message||"Failed"); save.disabled=false; }
    };
  });
  container.querySelectorAll("[data-del]").forEach(btn=>btn.onclick=async()=>{
    if(!(await confirmAction(btn, "Delete this comment?"))) return;
    try{ await api("/api/comments/"+btn.dataset.del,{method:"DELETE"}); await reload(); }
    catch(e){ errorToast(e.message); }
  });
}
