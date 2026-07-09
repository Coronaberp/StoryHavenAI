"use strict";
/* ============================ COMMENTS ============================ */
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
// Reaction set must match the server's REACTION_EMOJI allowlist exactly —
// the server rejects anything else, so offering more here would just be
// silently-failing buttons.
const _REACTION_EMOJI=["👍","👎","❤️","😂","😮","😢","😡","🎉","🔥","👀"];
// The composer's own emoji button isn't restricted the same way — it just
// inserts plain text into the message, no structured allowlist needed since
// it's not becoming a stored/counted pill server-side.
// 🤔 dropped — it rendered as a fully blank cell (not even a tofu fallback
// box) in at least one real browser/font environment, leaving an unexplained
// gap in the grid with nothing to click.
const _COMPOSER_EMOJI=["😀","😂","😍","🥹","😢","😡","👍","👎","🎉","🔥","💯","🙏","👀","😎","😴","😭","❤️","💀","✨","👏","🥳","😅","😏","🫡"];
function openEmojiPopover(anchor, emojiList, onPick, opts){
  document.querySelectorAll(".emoji-pop").forEach(p=>p.remove());
  const allowSuper=opts&&opts.allowSuper;
  let superMode=false;
  const pop=document.createElement("div");
  pop.className="emoji-pop";
  if(allowSuper) pop.classList.add("has-super");
  pop.innerHTML=(allowSuper?`<button type="button" class="emoji-pop-super" id="epSuperToggle" title="React with a Super Reaction">⭐ Super Reaction</button>`:"")
    +emojiList.map(e=>`<button type="button" class="emoji-pop-item" data-e="${e}">${e}</button>`).join("");
  document.body.appendChild(pop);
  const r=anchor.getBoundingClientRect();
  pop.style.left=Math.max(8,Math.min(r.left, window.innerWidth-pop.offsetWidth-8))+"px";
  pop.style.top=Math.min(r.bottom+6, window.innerHeight-pop.offsetHeight-8)+"px";
  const superBtn=pop.querySelector("#epSuperToggle");
  if(superBtn) superBtn.onclick=e=>{ e.stopPropagation(); superMode=!superMode; superBtn.classList.toggle("on",superMode); };
  pop.querySelectorAll(".emoji-pop-item").forEach(b=>b.onclick=e=>{ e.stopPropagation(); onPick(b.dataset.e, superMode); pop.remove(); });
  setTimeout(()=>{
    const onOutside=e=>{ if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener("mousedown",onOutside); } };
    document.addEventListener("mousedown",onOutside);
  },0);
}
// Square crop tool for emoji/sticker uploads — drag to pan, slider to zoom,
// confirm to bake the visible crop into a square PNG blob. Skipped entirely
// for animated GIFs (a canvas snapshot would flatten the animation away) —
// those upload as-is, still subject to the same server-side size/dimension
// caps. Appended straight to <body> like the other popovers, so it needs the
// same z-index-above-modals treatment (see the .emoji-pop comment).
// Flood-fills a flat white or black background to transparent, starting from
// every border pixel (not just the four corners — a corner can land on real
// content by chance depending on how the user cropped/framed the image).
// Only acts when the border reads as clearly near-white or near-black on
// average; a colorful/photographic background is left untouched rather than
// guessing wrong and eating part of the actual sticker art. Returns true if
// anything was actually made transparent.
function _floodFillTransparentBg(ctx, w, h, tolerance=32){
  const imgData=ctx.getImageData(0,0,w,h);
  const data=imgData.data;
  let rSum=0,gSum=0,bSum=0,n=0;
  for(let x=0;x<w;x++) for(const y of [0,h-1]){ const i=(y*w+x)*4; rSum+=data[i];gSum+=data[i+1];bSum+=data[i+2]; n++; }
  for(let y=0;y<h;y++) for(const x of [0,w-1]){ const i=(y*w+x)*4; rSum+=data[i];gSum+=data[i+1];bSum+=data[i+2]; n++; }
  const avgR=rSum/n, avgG=gSum/n, avgB=bSum/n;
  const luminance=0.299*avgR+0.587*avgG+0.114*avgB;
  if(luminance<=235 && luminance>=20) return false; // border isn't clearly white or black — leave it alone
  const target=luminance>235 ? [255,255,255] : [0,0,0];
  const tolSq=tolerance*tolerance*3;
  const visited=new Uint8Array(w*h);
  const stack=[];
  const consider=(x,y)=>{
    if(x<0||y<0||x>=w||y>=h) return;
    const p=y*w+x;
    if(visited[p]) return;
    visited[p]=1;
    const i=p*4;
    const dr=data[i]-target[0], dg=data[i+1]-target[1], db=data[i+2]-target[2];
    if(dr*dr+dg*dg+db*db<=tolSq) stack.push(p);
  };
  for(let x=0;x<w;x++){ consider(x,0); consider(x,h-1); }
  for(let y=0;y<h;y++){ consider(0,y); consider(w-1,y); }
  let touched=false;
  const cutPixels=[];
  while(stack.length){
    const p=stack.pop();
    const x=p%w, y=(p-x)/w;
    data[p*4+3]=0;
    touched=true;
    cutPixels.push(x,y);
    consider(x+1,y); consider(x-1,y); consider(x,y+1); consider(x,y-1);
  }
  // Edge cleanup: a hard 0/255 alpha cutoff leaves the original anti-aliased
  // boundary pixels behind — a thin ring around the subject that's a blend
  // of the art and the removed background color, which reads as a soft
  // white/black "blur" halo once the sticker sits over a dark chat/page
  // background instead of its original flat backdrop. One dilation pass
  // fades any opaque pixel touching newly-transparent ones proportionally to
  // how close its own color still is to the background, instead of leaving
  // that fringe fully opaque.
  if(touched){
    const softTolSq=(tolerance*2.2)**2*3;
    for(let k=0;k<cutPixels.length;k+=2){
      const cx=cutPixels[k], cy=cutPixels[k+1];
      for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const ni=(ny*w+nx)*4;
        if(data[ni+3]===0) continue;
        const dr=data[ni]-target[0], dg=data[ni+1]-target[1], db=data[ni+2]-target[2];
        const distSq=dr*dr+dg*dg+db*db;
        if(distSq<softTolSq) data[ni+3]=Math.min(data[ni+3], Math.round(255*(distSq/softTolSq)));
      }
    }
    ctx.putImageData(imgData,0,0);
  }
  return touched;
}
function openImageCropModal(file, onCropped, onCancel, opts={}){
  const VIEW=240;
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    let scale=Math.max(VIEW/img.naturalWidth, VIEW/img.naturalHeight);
    const minScale=scale;
    let offX=(VIEW-img.naturalWidth*scale)/2, offY=(VIEW-img.naturalHeight*scale)/2;
    const overlay=document.createElement("div");
    overlay.className="crop-modal-overlay";
    overlay.innerHTML=`
      <div class="crop-modal">
        <div class="crop-modal-title">Crop image</div>
        <div class="crop-stage" style="width:${VIEW}px;height:${VIEW}px;">
          <canvas width="${VIEW}" height="${VIEW}"></canvas>
        </div>
        <input type="range" class="crop-zoom" min="${minScale}" max="${minScale*4}" step="${minScale/100}" value="${scale}">
        ${opts.removeBg?`<label class="crop-bg-toggle"><input type="checkbox" id="cropRemoveBg" checked> Make flat white/black background transparent</label>`:""}
        <div class="crop-modal-actions">
          <button type="button" class="btn" id="cropCancel">Cancel</button>
          <button type="button" class="btn primary" id="cropConfirm">Use this crop</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const canvas=overlay.querySelector("canvas"), ctx=canvas.getContext("2d");
    const zoomSlider=overlay.querySelector(".crop-zoom");
    const clampOffset=()=>{
      const w=img.naturalWidth*scale, h=img.naturalHeight*scale;
      offX=Math.min(0, Math.max(VIEW-w, offX));
      offY=Math.min(0, Math.max(VIEW-h, offY));
    };
    const draw=()=>{
      clampOffset();
      ctx.clearRect(0,0,VIEW,VIEW);
      ctx.drawImage(img, offX, offY, img.naturalWidth*scale, img.naturalHeight*scale);
    };
    draw();
    let dragging=false, lastX=0, lastY=0;
    canvas.onpointerdown=e=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; canvas.setPointerCapture(e.pointerId); };
    canvas.onpointermove=e=>{
      if(!dragging) return;
      offX+=e.clientX-lastX; offY+=e.clientY-lastY;
      lastX=e.clientX; lastY=e.clientY;
      draw();
    };
    canvas.onpointerup=()=>{ dragging=false; };
    zoomSlider.oninput=()=>{
      const newScale=parseFloat(zoomSlider.value);
      const cx=VIEW/2, cy=VIEW/2;
      offX=cx-(cx-offX)*(newScale/scale);
      offY=cy-(cy-offY)*(newScale/scale);
      scale=newScale;
      draw();
    };
    const cleanup=()=>{ overlay.remove(); URL.revokeObjectURL(url); };
    overlay.querySelector("#cropCancel").onclick=()=>{ cleanup(); if(onCancel) onCancel(); };
    overlay.querySelector("#cropConfirm").onclick=()=>{
      // Export at a much higher resolution than the small interactive VIEW
      // canvas (240px, sized for smooth dragging/zooming, not output quality)
      // — exporting directly from that canvas threw away most of the detail
      // of any higher-res source (e.g. a ~1024px AI-generated image), then
      // WebP re-compression on top of that made it visibly blocky. This
      // redraws the same crop selection (same offX/offY/scale, just scaled
      // up) onto a separate offscreen canvas sampled from the original
      // full-resolution image, capped so a huge source doesn't produce a
      // needlessly huge export.
      const EXPORT=Math.min(1024, Math.max(img.naturalWidth, img.naturalHeight));
      const k=EXPORT/VIEW;
      const outCanvas=document.createElement("canvas");
      outCanvas.width=EXPORT; outCanvas.height=EXPORT;
      const outCtx=outCanvas.getContext("2d");
      outCtx.imageSmoothingEnabled=true; outCtx.imageSmoothingQuality="high";
      outCtx.drawImage(img, offX*k, offY*k, img.naturalWidth*scale*k, img.naturalHeight*scale*k);
      const removeBgToggle=overlay.querySelector("#cropRemoveBg");
      if(removeBgToggle && removeBgToggle.checked) _floodFillTransparentBg(outCtx, EXPORT, EXPORT);
      outCanvas.toBlob(blob=>{ cleanup(); onCropped(blob); }, "image/png");
    };
  };
  img.onerror=()=>{ URL.revokeObjectURL(url); toast("Couldn't load that image."); if(onCancel) onCancel(); };
  img.src=url;
}
// Richer composer picker: built-in unicode emoji + everyone's custom
// emoji/stickers, plus a small upload form (any signed-in user may add one —
// see routers/emojis.py). onPickText gets called for a unicode emoji or a
// custom :shortcode: emoji; onPickSticker gets the sticker's row so the
// caller can attach it like a normal upload without re-uploading anything.
const _EMOJI_MAX_UPLOAD_BYTES=5*1024*1024;
// Hides `pop` (not removed — window._emojiPopGenerating tells closeModal()'s
// "clear any leftover .emoji-pop" cleanup to stand down, see modal-settings.js)
// for as long as the modal openFn() opens stays open, including any further
// modal it stacks on top of itself (e.g. the upload modal opening the
// AI-generate picker) — restored via a MutationObserver on that first modal
// layer specifically, since it only leaves the DOM once the whole chain
// closes back down to the popover, not on each intermediate modal's close.
// openFn must call openModal() synchronously (before any `await`) so the
// layer already exists by the time this queries for it.
function _withEmojiPopHidden(pop, openFn, onRestore){
  window._emojiPopGenerating=true;
  pop.style.visibility="hidden";
  openFn();
  const restore=()=>{ window._emojiPopGenerating=false; pop.style.visibility=""; if(onRestore) onRestore(); };
  const layer=document.querySelector(".modal-layer:last-of-type");
  if(!layer){ restore(); return; }
  const obs=new MutationObserver(()=>{
    if(!document.body.contains(layer)){ restore(); obs.disconnect(); }
  });
  obs.observe(document.getElementById("scrim")||document.body, {childList:true});
}
// Its own modal rather than a collapsible section inside the emoji/sticker
// popover — that cramped the actual grid, and now "Upload" reads as a real
// step in the flow (browse → Upload → pick/generate+crop+name → back to the
// grid with it already there) instead of a form squeezed under it.
function openEmojiUploadModal(kind, onAdded){
  let pendingBlob=null, pendingName="";
  openModal(`
    <h3>Upload ${kind==="sticker"?"sticker":"emoji"}</h3>
    <div class="field"><label>Shortcode</label>
      <input type="text" id="euShortcode" placeholder="e.g. pepega" maxlength="32"></div>
    <input type="file" id="euFile" accept="image/*" hidden>
    <div class="emoji-pop-file-row">
      <label for="euFile" class="emoji-pop-file-label" id="euFileLabel">Choose image…</label>
      <button type="button" class="btn" id="euGenerate" title="Generate with AI">🎨 Generate</button>
    </div>
    <div class="modal-foot"><button class="btn" id="euCancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="euAdd">Add</button></div>
  `, null, {stack:true});
  const fileInput=$("#euFile"), fileLabel=$("#euFileLabel");
  $("#euCancel").onclick=closeModal;
  fileInput.onchange=e=>{
    const f=e.target.files[0];
    if(!f) return;
    if(f.size>_EMOJI_MAX_UPLOAD_BYTES){
      toast(`That file is too large (max ${_EMOJI_MAX_UPLOAD_BYTES/(1024*1024)}MB).`);
      fileInput.value=""; return;
    }
    pendingName=f.name;
    // Animated GIFs skip cropping — a canvas snapshot would flatten the
    // animation to one frame — everything else gets a square crop step.
    if(f.type==="image/gif"){
      pendingBlob=f;
      fileLabel.textContent=f.name+" (animated, uncropped)";
      return;
    }
    openImageCropModal(f, blob=>{
      pendingBlob=blob;
      fileLabel.textContent=f.name+" (cropped)";
    }, ()=>{ fileInput.value=""; pendingBlob=null; fileLabel.textContent="Choose image…"; }, {removeBg:true});
  };
  $("#euGenerate").onclick=async()=>{
    // {stack:true} inside openImageGenPickerModal means this stacks on top of
    // THIS modal rather than replacing it — closing it (Use/Cancel/backdrop)
    // returns here, not to the emoji/sticker popover two levels up.
    await openImageGenPickerModal(blob=>{
      openImageCropModal(blob, croppedBlob=>{
        pendingBlob=croppedBlob;
        pendingName="generated.png";
        fileLabel.textContent="Generated image (cropped)";
      }, undefined, {removeBg:true});
    });
  };
  $("#euAdd").onclick=async()=>{
    const shortcode=$("#euShortcode").value.trim().toLowerCase();
    if(!shortcode || !pendingBlob){ toast("Pick a file and a shortcode."); return; }
    const fd=new FormData(); fd.append("shortcode",shortcode); fd.append("kind",kind);
    fd.append("file",pendingBlob,pendingName||"upload.png");
    try{
      await api("/api/emojis",{method:"POST",body:fd});
      closeModal();
      toast("Added.");
      await onAdded();
    }catch(err){ errorToast(err.message||"Upload failed"); }
  };
}
function openComposerEmojiPopover(anchor, onPickText, onPickSticker){
  document.querySelectorAll(".emoji-pop").forEach(p=>p.remove());
  let tab="emoji";
  const pop=document.createElement("div");
  pop.className="emoji-pop emoji-pop-rich";
  document.body.appendChild(pop);
  // Anchor to the whole composer row, not just the small emoji button — the
  // button sits inline with the text input and Post button at the same
  // height, so "below the button" put the popover overlapping the input row
  // itself instead of clearly below the composer the way it reads visually.
  const anchorEl=anchor.closest(".cmt-composer-row") || anchor;
  const position=()=>{
    const r=anchorEl.getBoundingClientRect();
    // Match the composer's own width instead of a fixed 260px.
    pop.style.width = r.width+"px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth-r.width-8))+"px";
    const spaceBelow = window.innerHeight - r.bottom - 14;
    const spaceAbove = r.top - 14;
    // Below the composer by default (reads as "attached to what you clicked"),
    // but flipped above it when there genuinely isn't room below — a
    // composer sitting near the bottom of a long scrolled page (a forum
    // thread, a deep comment section) otherwise had this render mostly
    // off-screen with no way to reach the content past the fold.
    // .emoji-pop-rich's own overflow-y:auto still makes the whole popover
    // scrollable as a unit if even the *better* side doesn't fully fit.
    const useAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    if(useAbove){
      pop.style.maxHeight = Math.max(120, spaceAbove)+"px";
      pop.style.top = "auto";
      pop.style.bottom = (window.innerHeight - r.top + 6)+"px";
    } else {
      pop.style.maxHeight = Math.max(120, spaceBelow)+"px";
      pop.style.bottom = "auto";
      pop.style.top = (r.bottom+6)+"px";
    }
  };
  const render=()=>{
    const customOfKind=_customEmojis.filter(e=>e.kind===tab);
    const grid=tab==="emoji"
      ? _COMPOSER_EMOJI.map(e=>`<button type="button" class="emoji-pop-item" data-e="${e}">${e}</button>`).join("")
        + customOfKind.map(e=>`<button type="button" class="emoji-pop-item emoji-pop-custom" data-code="${esc(e.shortcode)}" title=":${esc(e.shortcode)}:"><img class="${nsfwCls(e).trim()}" src="${esc(mediaURL(e.image))}" alt=":${esc(e.shortcode)}:"></button>`).join("")
      : customOfKind.map(e=>`<button type="button" class="emoji-pop-item emoji-pop-sticker" data-sticker="${esc(e.id)}" title=":${esc(e.shortcode)}:"><img class="${nsfwCls(e).trim()}" src="${esc(mediaURL(e.image))}" alt=":${esc(e.shortcode)}:"></button>`).join("")
        || `<div class="emoji-pop-empty">No stickers yet — upload one below.</div>`;
    pop.innerHTML = `
      <div class="emoji-pop-tabs">
        <button type="button" class="emoji-pop-tab${tab==="emoji"?" on":""}" data-tab="emoji">Emoji</button>
        <button type="button" class="emoji-pop-tab${tab==="sticker"?" on":""}" data-tab="sticker">Stickers</button>
      </div>
      <div class="emoji-pop-grid${tab==="sticker"?" stickers":""}">${grid}</div>
      <button type="button" class="emoji-pop-upload-btn" id="epUploadToggle">+ Upload ${tab==="emoji"?"emoji":"sticker"}</button>`;
    pop.querySelectorAll(".emoji-pop-tab").forEach(b=>b.onclick=e=>{ e.stopPropagation(); tab=b.dataset.tab; render(); position(); });
    pop.querySelectorAll(".emoji-pop-item[data-e]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); onPickText(b.dataset.e); pop.remove(); });
    pop.querySelectorAll(".emoji-pop-item[data-code]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); onPickText(":"+b.dataset.code+":"); pop.remove(); });
    pop.querySelectorAll(".emoji-pop-item[data-sticker]").forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      const sticker=_customEmojis.find(x=>x.id===b.dataset.sticker);
      if(sticker){ onPickSticker(sticker); pop.remove(); }
    });
    // Upload/generate moved out to its own modal (openEmojiUploadModal) —
    // it was a cramped collapsible section stealing space from the emoji/
    // sticker grid it sat inside. Flow is now: browse the popover → Upload →
    // a real modal to pick/generate+crop+name it → back to the popover with
    // the new item already in the grid → pick it to actually use it.
    pop.querySelector("#epUploadToggle").onclick=e=>{
      e.stopPropagation();
      _withEmojiPopHidden(pop, ()=>openEmojiUploadModal(tab, async()=>{
        await _loadCustomEmojis();
        render();
      }), position);
    };
  };
  render(); position();
  setTimeout(()=>{
    // _emojiPopGenerating (see _withEmojiPopHidden) means this popover is
    // hidden-not-removed behind the upload/generate modal flow right now —
    // every click and scroll happening in there is technically "outside"
    // this popover's own DOM subtree, so without this guard, interacting
    // with that modal at all would immediately delete the hidden popover
    // instead of leaving it to be restored when the modal flow finishes.
    const onOutside=e=>{ if(!window._emojiPopGenerating && !pop.contains(e.target)){ close(); } };
    document.addEventListener("mousedown",onOutside);
    // position:fixed is computed once, relative to the viewport, at open
    // time — it doesn't track the anchor as the PAGE scrolls, so a page
    // scroll leaves the popover visually stranded away from the button that
    // opened it. capture:true is needed to see scrolls from nested scroll
    // containers on the page too (not just window-level) — but that means it
    // also sees scrolling *inside the popover's own* emoji grid/upload form
    // (see .emoji-pop-rich's overflow-y:auto), which must NOT close it —
    // only close for a scroll whose target isn't part of this popover.
    const onScroll=e=>{ if(!window._emojiPopGenerating && !pop.contains(e.target)) close(); };
    window.addEventListener("scroll",onScroll,{capture:true,passive:true});
    function close(){
      pop.remove();
      document.removeEventListener("mousedown",onOutside);
      window.removeEventListener("scroll",onScroll,{capture:true});
    }
  },0);
}
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
          <input type="text" class="cmt-input" id="cmtNewInput" placeholder="Share your thoughts..." maxlength="2000">
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
    input.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); doPost(); } };
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
    form.innerHTML=`<input type="text" class="cmt-input" placeholder="Write a reply..." maxlength="2000"><button class="btn primary cmt-post">Reply</button>`;
    const inp=form.querySelector("input"), b=form.querySelector("button");
    attachMentionAutocomplete(inp);
    const send=async()=>{ const content=inp.value.trim(); if(!content) return; b.disabled=true;
      try{ await api("/api/comments", j("POST",{target_type:targetType,target_id:targetId,content,parent_id:id})); await reload(); }
      catch(e){ errorToast(e.message); b.disabled=false; } };
    b.onclick=send; inp.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); send(); } };
    inp.focus();
  });
  container.querySelectorAll("[data-edit]").forEach(btn=>btn.onclick=()=>{
    if(!ME){ toast("Sign in to comment."); return; }
    const cmt=btn.closest(".cmt"), body=cmt&&cmt.querySelector(".cmt-body");
    if(!body || body.querySelector(".cmt-editbox")) return;
    const id=btn.dataset.edit, orig=body.textContent;
    body.dataset.prev=body.innerHTML;
    body.innerHTML=`<div class="cmt-editbox"><textarea class="cmt-input cmt-edit-ta" maxlength="2000"></textarea>`+
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
