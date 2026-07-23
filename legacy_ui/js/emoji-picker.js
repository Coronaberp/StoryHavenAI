"use strict";
/* ============================ EMOJI/STICKER PICKER ============================
   Generic popover + crop/upload widgets shared by anything that lets a user pick
   a reaction, a composer emoji, or a custom emoji/sticker — currently only used
   by comments.js's composer and reaction-add button, but kept independent of
   comment rendering/CRUD since none of this touches comment state. */
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
