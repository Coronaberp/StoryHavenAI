"use strict";
/* ============================ MODAL CORE (stack, admin notes, cropper) ============================ */
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
