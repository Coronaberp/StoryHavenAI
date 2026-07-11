"use strict";
/* ====================== IMAGE GENERATION: DETAIL/SHARE/REPORT MODALS ====================== */
// Split out of imagegen.js — standalone image detail view, share modal, NSFW rating report,
// and the admin review modals (image reports, generic content reports, pending emojis).

// Click to zoom in (centered on click point), click again to zoom back out,
// drag to pan while zoomed, ctrl+scroll to zoom incrementally centered on the
// cursor. Applied to every full-image view inside a modal (see call sites
// below) so the same interaction works consistently everywhere an image is
// shown, not just one view. window-level move/up listeners self-remove once
// `img` leaves the DOM (modal closed) — same self-clearing pattern as
// TrainingJobWatcher's poller, so repeatedly opening/closing image modals
// never accumulates listeners.
function _wireZoomPan(img){
  if(!img) return;
  const parent=img.parentElement;
  if(parent){ parent.style.overflow="hidden"; parent.style.position=parent.style.position||"relative"; }
  const minScale=1, clickScale=2.5, maxScale=10;
  let scale=1, tx=0, ty=0, dragging=false, moved=false;
  let startX=0, startY=0, startTx=0, startTy=0;
  img.style.willChange="transform";
  img.style.cursor="zoom-in";

  // Bottom zoom slider (2x-10x), same input[type=range] + accent-color
  // convention as every other slider in the app (base.css) — shown only
  // while actually zoomed in, hidden at 1x so it never crowds a not-yet-
  // zoomed image.
  const slider=document.createElement("input");
  slider.type="range"; slider.min=String(clickScale); slider.max=String(maxScale); slider.step="0.1";
  slider.value=String(clickScale);
  slider.className="ig-zoom-slider";
  slider.style.cssText="position:absolute;left:12px;right:12px;bottom:12px;width:calc(100% - 24px);display:none;z-index:2;accent-color:var(--accent);";
  slider.addEventListener("click", e=>e.stopPropagation());
  slider.addEventListener("mousedown", e=>e.stopPropagation());
  if(parent) parent.appendChild(slider);

  const syncSlider=()=>{
    if(!slider.isConnected) return;
    slider.style.display=scale>minScale?"":"none";
    if(document.activeElement!==slider) slider.value=String(scale);
  };
  const apply=(animate)=>{
    img.style.transition=animate?"transform .15s ease":"none";
    img.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;
    syncSlider();
  };
  const clampPan=()=>{
    const rect=img.getBoundingClientRect();
    const baseW=rect.width/scale, baseH=rect.height/scale;
    const maxX=Math.max(0,(baseW*scale-baseW)/2), maxY=Math.max(0,(baseH*scale-baseH)/2);
    tx=Math.min(maxX,Math.max(-maxX,tx));
    ty=Math.min(maxY,Math.max(-maxY,ty));
  };
  const zoomAt=(clientX, clientY, factor)=>{
    const rect=img.getBoundingClientRect();
    const originX=clientX-(rect.left+rect.width/2), originY=clientY-(rect.top+rect.height/2);
    const newScale=Math.min(maxScale, Math.max(minScale, scale*factor));
    if(newScale===scale) return;
    const dScale=newScale/scale;
    tx=(tx-originX)*dScale+originX;
    ty=(ty-originY)*dScale+originY;
    scale=newScale;
    if(scale===minScale){ tx=0; ty=0; }
    clampPan();
    img.style.cursor=scale>minScale?"grab":"zoom-in";
    apply(true);
  };
  slider.addEventListener("input", ()=>{
    const newScale=Math.min(maxScale, Math.max(minScale, parseFloat(slider.value)||minScale));
    const dScale=newScale/scale;
    scale=newScale;
    tx*=dScale; ty*=dScale;
    clampPan();
    img.style.cursor="grab";
    apply(false);
  });
  img.addEventListener("click", e=>{
    if(moved){ moved=false; return; }
    if(scale>minScale){ scale=minScale; tx=0; ty=0; img.style.cursor="zoom-in"; apply(true); return; }
    zoomAt(e.clientX, e.clientY, clickScale);
  });
  const beginDrag=(clientX,clientY)=>{
    if(scale<=minScale) return;
    dragging=true; moved=false;
    startX=clientX; startY=clientY; startTx=tx; startTy=ty;
    img.style.cursor="grabbing";
  };
  img.addEventListener("mousedown", e=>{ beginDrag(e.clientX,e.clientY); if(dragging) e.preventDefault(); });
  img.addEventListener("touchstart", e=>{
    if(e.touches.length!==1) return;
    beginDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, {passive:true});
  // A drag that ends outside the image (e.g. over the modal's backdrop while
  // panning) can still produce a synthetic "click" whose target is the
  // nearest common ancestor of the mousedown/mouseup points — often the
  // modal-layer backdrop itself, which openModal's own backdrop-click-to-
  // close handler then treats as "clicked outside, close" even though the
  // interaction genuinely started (and was meant to stay) inside the image.
  // Swallowing exactly the next click in the capture phase (before it can
  // reach that bubble-phase close handler) neutralizes just that one
  // synthetic event without touching any other click anywhere.
  const suppressNextClick=()=>{
    const kill=e=>{ e.stopPropagation(); };
    document.addEventListener("click", kill, {capture:true, once:true});
  };
  const removeAll=()=>{
    window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp);
    window.removeEventListener("touchmove",onTouchMove); window.removeEventListener("touchend",onUp);
  };
  const onMove=e=>{
    if(!img.isConnected){ removeAll(); return; }
    if(!dragging) return;
    const dx=e.clientX-startX, dy=e.clientY-startY;
    if(Math.abs(dx)>3||Math.abs(dy)>3) moved=true;
    tx=startTx+dx; ty=startTy+dy;
    clampPan();
    apply(false);
  };
  const onTouchMove=e=>{
    if(!img.isConnected){ removeAll(); return; }
    if(!dragging||e.touches.length!==1) return;
    e.preventDefault();
    const dx=e.touches[0].clientX-startX, dy=e.touches[0].clientY-startY;
    if(Math.abs(dx)>3||Math.abs(dy)>3) moved=true;
    tx=startTx+dx; ty=startTy+dy;
    clampPan();
    apply(false);
  };
  const onUp=()=>{
    if(!img.isConnected){ removeAll(); return; }
    if(!dragging) return;
    dragging=false;
    img.style.cursor=scale>minScale?"grab":"zoom-in";
    if(moved) suppressNextClick();
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchmove", onTouchMove, {passive:false});
  window.addEventListener("touchend", onUp);
  img.addEventListener("wheel", e=>{
    if(!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY<0?1.15:1/1.15);
  }, {passive:false});
}
function imageDetailModal(img, opts={}){
  const ts = img.image_ts || img.ts;
  const when = ts ? new Date(ts*1000).toLocaleString() : "";
  const tagRow=(tags, cls, label)=>{
    const list=(tags||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!list.length) return "";
    return `<div class="lore-entry-label">${esc(label)}</div>
      <div class="ig-tags-row ig-tags-row-copy" data-tags="${esc(tags)}">
        <span class="ig-tags-label ${cls==='pos'?'ig-tags-pos':'ig-tags-neg'}">${cls==='pos'?'+':'−'}</span>
        ${list.map(tg=>`<span class="ig-tag ${cls==='pos'?'ig-tag-pos':'ig-tag-neg'}">${esc(tg)}</span>`).join("")}
        <button type="button" class="tool" data-act="copy-tags">${esc(t("gallery_copy_tags"))}</button>
      </div>`;
  };
  const ownerRow=opts.owner
    ? (opts.owner.username
        ? `<a href="/u/${esc(encodeURIComponent(opts.owner.username))}" class="ig-detail-owner" data-owner-link>${avatar({avatar:opts.owner.avatar, name:opts.owner.name}, "ig-owner-ava")}<span>${esc(t("ig_community_by"))} ${esc(opts.owner.name||"")}</span></a>`
        : `<div class="ig-detail-owner">${avatar({avatar:opts.owner.avatar, name:opts.owner.name}, "ig-owner-ava")}<span>${esc(t("ig_community_by"))} ${esc(opts.owner.name||"")}</span></div>`)
    : "";
  const loraList=(img.loras||[]).filter(l=>l && l.name);
  // Only Test LoRA's own output files — a training job's "latest" (its raw
  // job id filename) or one of its manually requested checkpoint snapshots
  // (see lora_training.py's _lora_filename_slug/_iso8601_compact) — get
  // redacted once an image is shared. A real, curated/published LoRA (e.g.
  // "bondage_suspension.safetensors") is meant to be visible and should
  // always show its real name, shared or not.
  const _isTestLoraFile=name=>/^lt[0-9a-f]{12}\.safetensors$/i.test(name)||/_\d{8}T\d{6}Z\.safetensors$/.test(name);
  const genInfoRow=(img.checkpoint || loraList.length || img.sampler || img.scheduler) ? `
    <div class="ig-gen-info">
      ${img.checkpoint?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_model_label"))}</span> ${esc(img.checkpoint)}</div>`:""}
      ${img.id?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_type_label"))}</span> ${esc(img.is_img2img?t("ig_gen_type_img2img"):t("ig_gen_type_txt2img"))}</div>`:""}
      ${loraList.length?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_loras_label"))}</span> ${
        esc(loraList.map(l=>(opts.shareable&&_isTestLoraFile(l.name))?t("ig_gen_loras_redacted"):`${l.name} (${l.strength})`).join(", "))
      }</div>`:""}
      ${img.sampler?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_sampler_label"))}</span> ${esc(img.sampler)}</div>`:""}
      ${img.scheduler?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_scheduler_label"))}</span> ${esc(img.scheduler)}</div>`:""}
      ${img.steps?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_steps_label"))}</span> ${esc(img.steps)}</div>`:""}
      ${img.cfg?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_cfg_label"))}</span> ${esc(img.cfg)}</div>`:""}
      ${img.upscaler?`<div class="ig-gen-info-row"><span class="ig-gen-info-label">${esc(t("ig_gen_upscaled_label"))}</span> ${esc(img.upscaler)}</div>`:""}
    </div>` : "";
  openModal(`
    <button class="modal-close" id="idClose">${esc(t("btn_close"))}</button>
    <div class="lore-entry-modal">
      <div class="lore-entry-img" style="position:relative;">
        <img src="${esc(mediaURL(img.image))}" alt="">
        <button type="button" class="ig-detail-download" id="idDownload" title="${esc(t("gallery_download"))}" aria-label="${esc(t("gallery_download"))}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        ${(opts.shareable && img.id)?`<button type="button" class="ig-detail-download" id="idShare" style="right:52px;" title="${esc(t("ig_copy_link"))}" aria-label="${esc(t("ig_copy_link"))}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </button>`:""}
        <button type="button" class="ig-detail-download" id="idZoom" style="right:${(opts.shareable && img.id)?96:52}px;" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
      </div>
      <div class="lore-entry-body">
        <div class="lore-entry-eyebrow">${esc(when)}</div>
        ${ownerRow}
        <div class="rating-detail-row">
          ${ratingBadge(img)}
          <span class="rating-detail-text">${esc(t("rating_label"))}: ${img.is_explicit?"NSFW":"SFW"} <span class="rating-detail-disc">(${esc(img.human_reviewed?t("rating_line_human"):t("rating_line_ai"))})</span></span>
          ${(opts.reportable&&img.id)?`<button type="button" class="tool rating-report-btn" id="idReport">${esc(t("report_open"))}</button>`:""}
        </div>
        ${(img.scene_full||img.scene) ? `
        <div class="lore-entry-label">${esc(t("gallery_scene_label"))}</div>
        <div class="lore-entry-text md" style="font-style:italic;">${md(img.scene_full||img.scene||"")}</div>` : ""}
        ${(img.image_positive||img.image_negative) ? `
          ${tagRow(img.image_positive, "pos", t("gallery_positive_label"))}
          ${tagRow(img.image_negative, "neg", t("gallery_negative_label"))}`
        : `<div class="hint" style="margin-top:8px;">${esc(t("gallery_tags_unrecorded"))}</div>`}
        ${genInfoRow}
      </div>
    </div>
    ${img.id?`<div id="idComments" class="cmt-section"><div class="hint">Loading…</div></div>`:""}`, "modal-wide", {stack:!!opts.stack});
  $("#idClose").onclick=closeModal;
  _wireZoomPan($(".lore-entry-img img"));
  if(opts.reportable && img.id && $("#idReport")) $("#idReport").onclick=()=>reportRatingModal(img);
  $(".modal")?.querySelector("[data-owner-link]")?.addEventListener("click", e=>{
    e.preventDefault();
    closeModal();
    navigate(e.currentTarget.getAttribute("href"));
  });
  if(img.id){
    const cbox=$("#idComments");
    if(cbox) renderComments("image", img.id, cbox, {ownerId:opts.ownerId});
  }
  $("#idDownload").onclick=async()=>{
    try{
      const url=mediaURL(img.image);
      const blob=await (await fetch(url)).blob();
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=(url.split("/").pop()||"image").split("?")[0];
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    }catch(e){ errorToast("Download failed: "+e.message); }
  };
  $("#idZoom").onclick=()=>{
    // Deliberately NOT stacked — a stacked layer kept the original modal in
    // the DOM underneath, and despite a fully opaque covering background
    // (confirmed correct via computed styles) its rating badge still
    // visibly painted through in real testing on both Firefox and Chromium.
    // Removing the original modal from the DOM entirely instead of trying to
    // cover it sidesteps whatever compositing quirk was causing that.
    openModal(`<img src="${esc(mediaURL(img.image))}" alt="" style="width:100%;border-radius:10px;display:block;">`);
    _wireZoomPan($(".modal img"));
    // Since this replaced (not stacked on) the detail modal, closing it via
    // the normal backdrop-click/Escape path would otherwise just close
    // everything — reopen the detail view instead so "closing zoom" reads as
    // "going back", not "losing your place". A click on the image itself now
    // means "zoom in" (see _wireZoomPan), so only a click on the actual
    // backdrop (outside the image) navigates back — that's already what
    // layer.onclick's e.target===layer check does.
    const layer=$(".modal-layer");
    if(layer) layer.onclick=e=>{ if(e.target===layer) imageDetailModal(img, opts); };
  };
  if(opts.shareable && img.id && $("#idShare")) $("#idShare").onclick=()=>{
    const url=`${location.origin}/i/${encodeURIComponent(img.id)}`;
    navigator.clipboard?.writeText(url).then(()=>toast(t("ig_link_copied"))).catch(()=>{});
  };
  $(".modal").querySelectorAll("[data-act='copy-tags']").forEach(b=>b.onclick=()=>{
    const tags=b.closest(".ig-tags-row").dataset.tags;
    navigator.clipboard?.writeText(tags).then(()=>toast(t("gallery_tags_copied"))).catch(()=>{});
  });
}
function reportRatingModal(img){
  openModal(`<h3>${esc(t("report_title"))}</h3>
    <p class="hint" style="margin:8px 0 14px;">${esc(t("report_intro"))}</p>
    <div class="field"><label>${esc(t("report_note_label"))}</label>
      <textarea id="rrNote" rows="3" placeholder="${esc(t("report_note_ph"))}"></textarea></div>
    <div class="modal-foot" style="gap:8px;">
      <button class="btn" id="rrCancel">${esc(t("btn_cancel"))}</button>
      <button class="btn" id="rrSfw">${esc(t("report_as_sfw"))}</button>
      <button class="btn primary" id="rrNsfw">${esc(t("report_as_nsfw"))}</button>
    </div>`);
  $("#rrCancel").onclick=closeModal;
  const submit=async claimed=>{
    const note=($("#rrNote")?.value||"").trim();
    try{
      await api("/api/imagegen/standalone/"+encodeURIComponent(img.id)+"/report", j("POST",{claimed_explicit:claimed, note}));
      closeModal(); toast(t("report_sent"));
    }catch(e){ errorToast(t("report_failed")+": "+e.message); }
  };
  $("#rrNsfw").onclick=()=>submit(true);
  $("#rrSfw").onclick=()=>submit(false);
}
function adminReviewImageModal(rep, onResolved){
  openModal(`<button class="modal-close" id="airClose">${esc(t("btn_close"))}</button>
    <div class="air-modal">
      <div class="air-img"><img src="${esc(mediaURL(rep.image||""))}" alt=""></div>
      <div class="field" style="width:100%;margin:12px 0;"><label>${esc(t("adm_review_note_label"))}</label>
        <textarea id="airNote" rows="2" placeholder="${esc(t("adm_review_note_ph"))}"></textarea></div>
      <div class="air-buttons">
        <button class="btn" id="airSfw">SFW</button>
        <button class="btn primary" id="airNsfw">NSFW</button>
      </div>
    </div>`, "modal-wide");
  $("#airClose").onclick=closeModal;
  _wireZoomPan($(".air-img img"));
  const resolve=async is_explicit=>{
    const admin_note=($("#airNote")?.value||"").trim();
    try{
      await api("/api/admin/image-reports/"+encodeURIComponent(rep.id)+"/resolve", j("POST",{is_explicit, admin_note}));
      closeModal(); toast(t("adm_review_resolved")); onResolved&&onResolved();
    }catch(e){ errorToast(t("adm_review_failed")+": "+e.message); }
  };
  $("#airNsfw").onclick=()=>resolve(true);
  $("#airSfw").onclick=()=>resolve(false);
}
// Same pattern as adminReviewImageModal, for the generic content_reports
// queue (avatar/banner/profile/character/lore) instead of standalone
// generated images — shows the actual reported image and resolves SFW/NSFW
// directly against whichever row the report's kind+target_id point at (see
// _CONTENT_REPORT_SETTERS in routers/admin.py).
function adminReviewContentModal(rep, onResolved){
  openModal(`<button class="modal-close" id="acrClose">${esc(t("btn_close"))}</button>
    <div class="air-modal">
      <div style="font-weight:600;margin-bottom:10px;">${esc(rep.label||rep.kind)}</div>
      ${rep.image?`<div class="air-img"><img src="${esc(mediaURL(rep.image))}" alt=""></div>`
        :`<div class="hint">${esc(t("adm_content_no_image"))}</div>`}
      ${rep.note?`<div class="hint" style="margin-top:10px;">${esc(t("adm_review_reported"))}: ${esc(rep.note)}</div>`:""}
      <div class="air-buttons" style="margin-top:14px;">
        <button class="btn" id="acrSfw">SFW</button>
        <button class="btn primary" id="acrNsfw">NSFW</button>
      </div>
    </div>`, "modal-wide");
  $("#acrClose").onclick=closeModal;
  _wireZoomPan($(".air-img img"));
  const resolve=async is_explicit=>{
    try{
      await api("/api/admin/content-reports/"+encodeURIComponent(rep.id)+"/resolve", j("POST",{is_explicit}));
      closeModal(); toast(t("adm_review_resolved")); onResolved&&onResolved();
    }catch(e){ errorToast(t("adm_review_failed")+": "+e.message); }
  };
  $("#acrNsfw").onclick=()=>resolve(true);
  $("#acrSfw").onclick=()=>resolve(false);
}
// Same review-modal pattern as adminReviewImageModal (full image + a clear
// two-button verdict) applied to a pending emoji/sticker instead of a
// standalone-image rating report — shows what was actually uploaded (image,
// uploader, requested shortcode/kind) so approving isn't a blind click.
function openEmojiReviewModal(e, onResolved){
  openModal(`<button class="modal-close" id="eurClose">${esc(t("btn_close"))}</button>
    <div class="air-modal">
      <div class="air-img"><img src="${esc(mediaURL(e.image||""))}" alt=""></div>
      <div class="field" style="width:100%;margin:12px 0;">
        <label>Uploaded by</label>
        <div>${esc(e.uploader_username||e.uploader_id)}</div>
      </div>
      <div class="field" style="width:100%;margin:0 0 12px;">
        <label>Requested as</label>
        <div>:${esc(e.shortcode)}: <span class="mr-type-tag">${esc(e.kind)}</span></div>
      </div>
      <div class="air-buttons">
        <button class="btn danger" id="eurDisapprove">Disapprove</button>
        <button class="btn primary" id="eurApprove">Approve</button>
      </div>
    </div>`, "modal-wide");
  $("#eurClose").onclick=closeModal;
  _wireZoomPan($(".air-img img"));
  $("#eurApprove").onclick=async()=>{
    try{
      await api("/api/admin/emojis/"+encodeURIComponent(e.id)+"/approve",{method:"POST"});
      closeModal(); toast("Approved."); onResolved&&onResolved();
    }catch(err){ errorToast("Failed: "+err.message); }
  };
  $("#eurDisapprove").onclick=async()=>{
    try{
      await api("/api/emojis/"+encodeURIComponent(e.id),{method:"DELETE"});
      closeModal(); toast("Disapproved and deleted."); onResolved&&onResolved();
    }catch(err){ errorToast("Failed: "+err.message); }
  };
}
async function viewSharedImage(main, iid){
  let rec;
  try{ rec=await api("/api/imagegen/standalone/"+encodeURIComponent(iid||"")); }
  catch(e){
    return errorPage(main, {code:"404", title:"Image not available",
      message:"This image is private or no longer exists."});
  }
  main.innerHTML=`<div class="wrap shared-img-wrap">
    <div class="page-eyebrow">${esc(t("ig_shared_eyebrow"))}</div>
    <div class="shared-img-card">
      <img class="shared-img-pic" src="${esc(mediaURL(rec.image))}" alt="">
      <div class="shared-img-foot">
        ${avatar({avatar:rec.owner_avatar, name:rec.owner_display_name}, "ig-owner-ava")}
        <span>${esc(t("ig_community_by"))} ${esc(rec.owner_display_name||rec.owner_username||"")}</span>
        <a class="btn primary shared-img-view" href="/images">${esc(t("ig_view_on_brand"))}</a>
      </div>
    </div>
  </div>`;
}
