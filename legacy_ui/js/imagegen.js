"use strict";
/* ============================ IMAGE GENERATION ============================ */
// The Images page's Generate tab: form + submission flow, the shared masonry
// card/collapsible-section helpers (igMasonryCard/igSectionHead/wireIgSections)
// reused by the gallery/community tabs, and the admin quick-gen picker modal.
// Gallery/community feed rendering lives in imagegen-feed.js; standalone image
// detail/share/report/admin-review modals live in imagegen-detail.js.
//
// Reusable "generate instead of upload" modal — same generation UI as the
// standalone Image Gen page, but "Use this image" hands the final PNG back
// as a Blob instead of saving to the gallery, so callers can feed it straight
// into their existing upload flow (openCropper, FormData, etc.) exactly as if
// the user had picked a file, for anywhere an avatar/banner/pfp is uploaded.
async function openImageGenPickerModal(onBlob, opts={}){
  const {checkpoints, loras}=await getImagegenOptions();
  if(!checkpoints.length){ toast(t("img_gen_no_checkpoints")); return; }
  // Two independent locks. A locked checkpoint (setting a model's own preview
  // image) pins the model and suppresses LoRAs so the output shows that
  // checkpoint's native look, unskewed by any selection. A locked LoRA
  // (setting a LoRA's own preview image) only pins the LoRA — the admin still
  // picks whichever checkpoint to preview it against, same as a normal
  // generation, since a LoRA has no look of its own without a base model.
  const lockLora=opts.lockLora||null;
  const lockCkpt=opts.lockCheckpoint||null;
  // A locked sampler/scheduler pins that ONE algorithm axis (the point of the
  // preview: "a sample generated USING this sampler/scheduler") while the admin
  // still picks checkpoint/LoRA/prompt freely, since a sampler has no look of
  // its own without a full generation around it.
  const lockSampler=opts.lockSampler||null;
  const lockScheduler=opts.lockScheduler||null;
  const hideLora=opts.hideLoraPicker||!!lockCkpt||!!lockLora;
  // Only the free-form quick-generate use (no lock, no caller-supplied prompt)
  // remembers what was last generated with — the locked model/LoRA/sampler/
  // scheduler preview-setting flows always start fresh, since "prefill with
  // whatever I last generated" would fight the very thing they're locked to.
  const isGeneral=!lockCkpt && !lockLora && !lockSampler && !lockScheduler && !opts.positive && !opts.negative;
  let savedGen=null;
  if(isGeneral){ try{ savedGen=JSON.parse(localStorage.getItem("ig_admin_gen_state")||"null"); }catch(e){} }
  const lockedRow=(labelKey, name, previews)=>`<div class="field"><label>${esc(t(labelKey))}</label>
        <div class="ig-locked-ckpt"><span class="ig-tile-thumb ava mono sm">${esc((modelLabel(name,previews||{})||"?")[0].toUpperCase())}</span><span>${esc(modelLabel(name,previews||{}))}</span></div></div>`;
  const samplerField=lockSampler?lockedRow("ig_sampler", lockSampler, _samplerPreviews):"";
  const schedulerField=lockScheduler?lockedRow("ig_scheduler", lockScheduler, _schedulerPreviews):"";
  const ckptField=lockCkpt
    ? `<div class="field"><label>${esc(t("img_gen_checkpoint"))}</label>
        <div class="ig-locked-ckpt"><span class="ig-tile-thumb ava mono sm">${esc((modelLabel(lockCkpt,_checkpointPreviews||{})||"?")[0].toUpperCase())}</span><span>${esc(modelLabel(lockCkpt,_checkpointPreviews||{}))}</span></div></div>`
    : `<div class="field"><label>${esc(t("img_gen_checkpoint"))}</label><div id="ig_ckpt"></div></div>`;
  const loraField=hideLora
    ? (lockLora ? `<div class="field"><label>${esc(t("img_gen_lora"))}</label>
        <div class="ig-locked-ckpt"><span class="ig-tile-thumb ava mono sm">${esc((modelLabel(lockLora,_loraPreviews||{})||"?")[0].toUpperCase())}</span><span>${esc(modelLabel(lockLora,_loraPreviews||{}))}</span></div></div>` : "")
    : `<div class="field" id="ig_lora_field"><label>${esc(t("img_gen_lora"))}</label><div id="ig_lora"></div></div>`;
  openModal(`
    <div class="img-gen-head"><span class="img-gen-icon">🎨</span><h3>${esc(t("ig_picker_title"))}</h3></div>
    <div class="field-group">
      ${ckptField}
      ${loraField}
      ${samplerField}
      ${schedulerField}
    </div>
    <button type="button" class="ig-show-more" id="ig_upscaler_req_btn">${esc(t("ig_upscaler_request_link"))}</button>
    <div class="field" id="ig_ref_field"><label>${esc(t("img_gen_reference"))} <span class="hint">${esc(t("img_gen_reference_hint"))}</span></label>
      <div id="ig_ref"></div></div>
    <div class="hint" id="ig_arch_note" style="display:none;margin:-6px 0 14px;"></div>
    <div class="field"><label>${esc(t("img_gen_positive"))}</label>
      <textarea id="ig_positive" class="ig-autosize" rows="2" placeholder="${esc(t("ig_positive_ph"))}">${esc(opts.positive||(savedGen&&savedGen.positive)||IG_ADMIN_DEFAULT_POSITIVE)}</textarea>
      <div class="ig-anima-prompt-banner" id="ig_anima_prompt_banner" style="display:none;">${esc(t("ig_anima_prompt_hint"))}</div></div>
    <div class="field"><label>${esc(t("img_gen_negative"))}</label>
      <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("ig_negative_ph"))}">${esc(opts.negative||(savedGen&&savedGen.negative)||IG_ADMIN_DEFAULT_NEGATIVE)}</textarea></div>
    <div class="field" style="margin:0;">
      <label>${esc(t("ig_steps"))} <span class="hint" id="ig_steps_val">${(savedGen&&savedGen.steps)||IG_ADMIN_DEFAULT_STEPS}</span></label>
      <input type="range" id="ig_steps_in" min="1" max="60" step="1" value="${(savedGen&&savedGen.steps)||IG_ADMIN_DEFAULT_STEPS}">
      <div class="hint" style="margin-top:4px;" id="ig_steps_hint"></div>
    </div>
    <div class="modal-foot"><button class="btn" id="ig_pick_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ig_go">${esc(t("ig_generate"))}</button></div>
    <div id="igPreviewWrap" style="display:none;margin:20px 0;">
      <div class="ig-preview-box"><img id="igPreviewImg" alt=""></div>
      <div class="actions" id="igResultActions" style="display:none;">
        <button class="btn primary" id="ig_use">${esc(t("ig_use_image"))}</button>
        <button class="btn" id="ig_details">${esc(t("ig_details_btn"))}</button>
      </div>
    </div>`, null, {stack:true});
  $("#ig_pick_cancel").onclick=closeModal;
  $("#ig_upscaler_req_btn").onclick=()=>openUpscalerRequestModal();
  // The steps field auto-updates to a checkpoint's own saved override (Admin
  // → model edit → Default steps) whenever the checkpoint selection changes,
  // but only if the admin hasn't already hand-typed a different value here —
  // an explicit in-modal edit always wins over the stored per-model default.
  let stepsTouched=false;
  const applyStepsForCkpt=name=>{
    const override=(_checkpointPreviews||{})[name]?.default_steps;
    const hint=$("#ig_steps_hint"), input=$("#ig_steps_in"), val=$("#ig_steps_val");
    const animaDefault=isAnimaModel(name)?30:((savedGen&&savedGen.steps)||IG_ADMIN_DEFAULT_STEPS);
    if(override!=null){
      hint.textContent=t("ig_steps_model_default").replace("{n}",override);
      if(!stepsTouched){ input.value=override; val.textContent=override; }
    }else{
      hint.textContent="";
      if(!stepsTouched){ input.value=animaDefault; val.textContent=animaDefault; }
    }
  };
  // Each architecture needs its own field visibility: Anima has a real,
  // tested workflow (see imagegen.ANIMA_WORKFLOW) but doesn't support LoRAs
  // or a reference image, so those fields hide and a note explains the
  // recommended-defaults switch. Flux V2 is UI-only right now — no model
  // file exists to build/test a real workflow against yet (see
  // imagegen.py's ANIMA_WORKFLOW comment for why guessing at an untested
  // graph is worse than not building one) — so its fields hide too, plus a
  // clearer "not generatable yet" note, and runGenerate refuses to submit.
  const applyArchForCkpt=name=>{
    const cat=modelCategory(name,_checkpointPreviews||{});
    const loraField=$("#ig_lora_field"), refField=$("#ig_ref_field"), note=$("#ig_arch_note");
    // Anima LoRA support is fixed now — only Flux V2 (no real workflow to
    // test against yet, see below) still hides the LoRA field. The old
    // Anima note is gone entirely per explicit correction — its claim was
    // wrong. The sampler/scheduler/cfg values ARE still force-set to
    // ANIMA_DEFAULT_* below regardless of what's picked in the UI (unrelated
    // to this note removal, left as-is) — just nothing on screen claims it.
    if(loraField) loraField.style.display=cat==="flux_v2"?"none":"";
    if(refField) refField.style.display=cat==="flux_v2"?"none":"";
    if(note){
      note.style.display=cat==="flux_v2"?"":"none";
      note.textContent=cat==="flux_v2"?t("ig_flux_v2_note"):"";
    }
    const promptBanner=$("#ig_anima_prompt_banner");
    if(promptBanner) promptBanner.style.display="none";
  };
  const savedCkpt=savedGen&&savedGen.checkpoint&&checkpoints.includes(savedGen.checkpoint)?savedGen.checkpoint:null;
  const ckptSel=lockCkpt ? {value:lockCkpt}
    : mountCheckpointButton($("#ig_ckpt"), checkpoints,
        {previews:_checkpointPreviews||{}, value:savedCkpt||(checkpoints.includes(IG_ADMIN_DEFAULT_CHECKPOINT)?IG_ADMIN_DEFAULT_CHECKPOINT:undefined),
         onChange:v=>{ applyStepsForCkpt(v); applyArchForCkpt(v); }});
  applyStepsForCkpt(ckptSel.value);
  applyArchForCkpt(ckptSel.value);
  $("#ig_steps_in").addEventListener("input",e=>{ stepsTouched=true; $("#ig_steps_val").textContent=e.target.value; });
  const savedLoras=(savedGen&&savedGen.loras)||undefined;
  const loraPicker=lockLora ? {getSelected:()=>[{name:lockLora,strength:1.0}]}
    : hideLora ? {getSelected:()=>[]} : mountLoraButton($("#ig_lora"), loras, {previews:_loraPreviews||{}, value:savedLoras});
  const refPicker=mountReferenceImagePicker($("#ig_ref"));
  [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta));
    ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0));
    autosize(ta);
  });

  let lastImage=null, genAbort=null, lastGenBody=null;
  const resetGoBtn=()=>{ const b=$("#ig_go"); b.disabled=false; b.classList.remove("stop"); b.textContent=t("ig_generate"); b.onclick=runGenerate; };
  const stopGenerate=()=>{
    if(genAbort){ try{ genAbort.abort(); }catch(e){} genAbort=null; }
    fetch(API+"/api/imagegen/standalone/stream/stop",{method:"POST"}).catch(()=>{});
    resetGoBtn();
  };
  const runGenerate=async()=>{
    const positive=$("#ig_positive").value.trim();
    if(!positive){ toast(t("ig_positive_ph")); return; }
    if(modelCategory(ckptSel.value,_checkpointPreviews||{})==="flux_v2"){ toast(t("ig_flux_v2_note")); return; }
    genAbort=new AbortController();
    const goBtn=$("#ig_go"); goBtn.classList.add("stop"); goBtn.textContent=t("ig_stop"); goBtn.onclick=stopGenerate;
    $("#igResultActions").style.display="none";
    $("#igPreviewWrap").style.display="";
    const anima=isAnimaModel(ckptSel.value);
    const body={positive, negative:$("#ig_negative").value.trim(), checkpoint:ckptSel.value,
      architecture:anima?"anima":"sdxl",
      // Anima LoRA support is fixed now — no longer force-emptied.
      loras:loraPicker.getSelected(),
      reference_image:refPicker.getDataUrl(), denoise:refPicker.getDenoise()};
    body.steps=parseInt($("#ig_steps_in").value,10)||IG_ADMIN_DEFAULT_STEPS;
    body.cfg=anima?ANIMA_DEFAULT_CFG:IG_ADMIN_DEFAULT_CFG;
    body.sampler=anima?ANIMA_DEFAULT_SAMPLER:(lockSampler||IG_ADMIN_DEFAULT_SAMPLER);
    body.scheduler=anima?ANIMA_DEFAULT_SCHEDULER:(lockScheduler||IG_ADMIN_DEFAULT_SCHEDULER);
    if(isGeneral){
      try{ localStorage.setItem("ig_admin_gen_state", JSON.stringify({
        checkpoint:body.checkpoint, positive:body.positive, negative:body.negative, steps:body.steps, loras:body.loras
      })); }catch(e){}
    }
    try{
      const res=await fetch(API+"/api/imagegen/standalone/stream",{method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:genAbort.signal});
      if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
      await sseEvents(res, ev=>{
        if(ev.type==="preview"||ev.type==="done"){ $("#igPreviewImg").src=ev.image; }
        if(ev.type==="done"){ lastImage=ev.image; lastGenBody=body; $("#igResultActions").style.display=""; }
        if(ev.type==="error"){ errorToast("Image generation failed: "+ev.message); }
      });
    }catch(e){ if(e.name!=="AbortError") errorToast("Image generation failed: "+e.message); }
    genAbort=null;
    resetGoBtn();
  };
  $("#ig_go").onclick=runGenerate;
  $("#ig_details").onclick=()=>{
    if(!lastGenBody) return;
    const b=lastGenBody;
    const rows=[
      [t("ig_details_checkpoint"), b.checkpoint],
      [t("ig_details_architecture"), b.architecture],
      [t("ig_details_loras"), (b.loras&&b.loras.length)?b.loras.map(l=>`${l.name} (${l.strength})`).join(", "):"—"],
      [t("ig_details_sampler"), b.sampler], [t("ig_details_scheduler"), b.scheduler],
      [t("ig_details_steps"), b.steps], [t("ig_details_cfg"), b.cfg],
      [t("ig_details_denoise"), b.reference_image?b.denoise:"—"],
    ];
    openModal(`<h3>${esc(t("ig_details_title"))}</h3>
      <div class="field"><label>${esc(t("img_gen_positive"))}</label>
        <textarea readonly rows="3" style="resize:vertical;">${esc(b.positive)}</textarea></div>
      <div class="field"><label>${esc(t("img_gen_negative"))}</label>
        <textarea readonly rows="2" style="resize:vertical;">${esc(b.negative||"")}</textarea></div>
      <table class="ig-details-table">${rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join("")}</table>
      <div class="modal-foot"><button class="btn primary" id="ig_details_close">${esc(t("btn_close"))}</button></div>`,
      null, {stack:true});
    document.getElementById("ig_details_close").onclick=closeModal;
  };
  $("#ig_use").onclick=async()=>{
    if(!lastImage) return;
    const useBtn=$("#ig_use"); useBtn.disabled=true;
    try{
      const blob=await (await fetch(lastImage)).blob();
      closeModal();
      onBlob(blob);
    }catch(e){ errorToast("Could not use that image: "+e.message); useBtn.disabled=false; }
  };
}
async function viewImages(main, initialTab){
  const {checkpoints, loras}=await getImagegenOptions();
  let tab=initialTab||"generate";
  if(tab==="training" && !(ME && ME.is_admin)) tab="generate";
  // Set by the top-right "Past jobs" picker (Train LoRA tab only) — read once
  // by renderTrainingTab on its next render, then cleared, so picking a job
  // there loads the Test panel already filled in without a page tab of its
  // own (see TEST_LORA_DEFAULT_POSITIVE etc.).
  let presetTestEntry=null;
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("nav_images"))}</div><h1 class="page">${esc(t("images_title"))}</h1>
    <div class="page-sub">${esc(t("images_sub"))}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 22px;flex-wrap:wrap;">
      <div class="seg lib-tabs images-tabs" id="imagesTabs">
        <button type="button" class="seg-btn" data-tab="generate"><b>${esc(t("images_tab_generate"))}</b></button>
        <button type="button" class="seg-btn" data-tab="gallery"><b>${esc(t("images_tab_gallery"))}</b></button>
        <button type="button" class="seg-btn" data-tab="community"><b>${esc(t("images_tab_community"))}</b></button>
        ${ME && ME.is_admin ? `<button type="button" class="seg-btn" data-tab="training"><b>${esc(t("images_tab_training"))}</b></button>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <button type="button" class="btn" id="imagesMyCreationsBtn">${GALLERY_ICON_SVG}${esc(t("ig_my_creations"))}</button>
        ${ME && ME.is_admin ? `<button type="button" class="btn" id="imagesPastJobsBtn" style="display:none;">${HISTORY_ICON_SVG}Past jobs</button>` : ""}
      </div>
    </div>
    <div id="imagesBody"></div>
  </div>`;
  const body=$("#imagesBody");
  const setActive=()=>{
    main.querySelectorAll("#imagesTabs .seg-btn").forEach(b=>b.classList.toggle("on", b.dataset.tab===tab));
    const pj=$("#imagesPastJobsBtn"); if(pj) pj.style.display=(tab==="training")?"":"none";
  };
  // Real per-tab URL (/images/generate, /images/gallery, /images/community)
  // so refreshing or sharing a link lands back on the same tab instead of
  // always bouncing to Generate — replaceState, not pushState, so switching
  // tabs doesn't spam browser history with one entry per click.
  const syncUrl=()=>{
    const path="/images/"+tab;
    if(location.pathname!==path) history.replaceState(null,"",path+location.search);
  };
  const render=()=>{
    setActive();
    syncUrl();
    if(tab==="generate") return renderGenerateTab(body, checkpoints, loras);
    if(tab==="gallery") return renderChatGalleryTab(body);
    if(tab==="training"){ const preset=presetTestEntry; presetTestEntry=null; return renderTrainingTab(body, preset); }
    return renderCommunityTab(body);
  };
  main.querySelectorAll("#imagesTabs .seg-btn").forEach(b=>b.onclick=()=>{ tab=b.dataset.tab; render(); });
  const pastJobsBtn=$("#imagesPastJobsBtn");
  if(pastJobsBtn) pastJobsBtn.onclick=()=>openPastJobsModal(entry=>{ presetTestEntry=entry; render(); });
  $("#imagesMyCreationsBtn").onclick=openMyCreationsModal;
  render();
}

// The "My Creations" button (top right of the Images page, every tab) —
// opens the same masonry grid/tools (view, share, delete) as the Generate
// tab's own "My Creations" section, so it's reachable without switching
// tabs (most useful from Train LoRA, which has no feed of its own).
async function openMyCreationsModal(){
  openModal(`
    <button class="modal-close" id="mc_close">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_my_creations"))}</h3>
    <div id="mc_grid" class="hint">${esc(t("loading"))}</div>`, "modal-wide");
  $("#mc_close").onclick=closeModal;
  const saved=await api("/api/imagegen/standalone").catch(()=>[]);
  const savedById=new Map(saved.map(s=>[s.id,s]));
  const grid=$("#mc_grid"); if(!grid) return;
  const draw=()=>{
    grid.innerHTML=saved.length?`<div class="ig-creations-grid">${saved.map(s=>igMasonryCard(s,{owner:true})).join("")}</div>`
      : `<div class="empty"><div class="big">${esc(t("ig_saved_empty"))}</div></div>`;
  };
  draw();
  grid.addEventListener("click", e=>{
    const card=e.target.closest(".ig-mcard"); if(!card) return;
    const iid=card.dataset.iid; const s=savedById.get(iid);
    if(e.target.closest("[data-act='ig-view']")){
      if(s) imageDetailModal({id:s.id, image:s.image, image_positive:s.positive, image_negative:s.negative,
        image_ts:s.created, checkpoint:s.checkpoint, loras:s.loras, is_explicit:s.is_explicit, human_reviewed:s.human_reviewed,
        sampler:s.sampler, scheduler:s.scheduler, steps:s.steps, is_img2img:s.is_img2img,
        cfg:s.cfg, upscaler:s.upscaler}, {ownerId:ME?ME.id:null, shareable:!!s.is_public, reportable:true, stack:true});
      return;
    }
    if(e.target.closest("[data-act='ig-share']")){
      if(!s) return;
      if(s.is_public){
        api("/api/imagegen/standalone/"+iid+"/unshare",{method:"POST"}).then(()=>{
          s.is_public=false; s.is_explicit=false; toast(t("ig_unshared_toast"));
          card.replaceWith(el(igMasonryCard(s,{owner:true})));
        }).catch(err=>errorToast(err.message));
      } else {
        shareImageModal(iid, s.is_explicit, res=>{ s.is_public=true; s.is_explicit=res.is_explicit;
          card.replaceWith(el(igMasonryCard(s,{owner:true}))); });
      }
      return;
    }
    const btn=e.target.closest("[data-act='ig-saved-del']"); if(!btn) return;
    (async()=>{
      if(!(await confirmAction(btn, t("gallery_delete_confirm_msg")))) return;
      try{ await api("/api/imagegen/standalone/"+iid,{method:"DELETE"}); card.remove(); }
      catch(err){ errorToast(t("gallery_delete_failed")+": "+err.message); }
    })();
  });
}

function igMasonryCard(s, {owner=false, community=false, ownerInfo=null}={}){
  // My Creations normally never blurs your own images (you already know what
  // you generated) — but Privacy Mode exists specifically to protect a
  // shared/public screen, and that has to override "it's just you looking at
  // your own stuff" too, or the whole point of the toggle falls apart the
  // moment someone opens their own gallery.
  const nb=(community||PRIVACY_MODE)?nsfwCls({is_explicit:s.is_explicit}):"";
  const shared=!!s.is_public;
  let tools="";
  if(owner){
    const shareWait=!shared && !s.classified;
    const shareTitle=shared?t("ig_unshare"):shareWait?t("ig_share_wait_label"):t("ig_share");
    tools=`<div class="ig-mcard-tools">
      <button class="tool ${shared?"":"primary"}" data-act="ig-share" ${shareWait?"disabled":""} title="${esc(shareWait?t("ig_share_wait"):shareTitle)}" aria-label="${esc(shareTitle)}">${SHARE_ICON_SVG}</button>
      <button class="tool danger" data-act="ig-saved-del" title="${esc(t("tool_delete"))}" aria-label="${esc(t("tool_delete"))}">${TRASH_ICON_SVG}</button>
    </div>`;
  } else if(community && ownerInfo){
    tools=`<div class="ig-mcard-owner">${avatar({avatar:ownerInfo.owner_avatar, name:ownerInfo.owner_display_name}, "ig-owner-ava")}<span>${esc(t("ig_community_by"))} ${esc(ownerInfo.owner_display_name||ownerInfo.owner_username||"")}</span></div>`;
  }
  const badge=(owner&&shared)?`<span class="ig-shared-badge">${esc(t("ig_shared_badge"))}</span>`:"";
  // The rating badge is only meaningful where it protects OTHER viewers from
  // unwanted content (the public Community feed) — in "My Creations" it's
  // just the owner looking at their own images, so it's noise, and worse, it
  // can show a stale pre-classification default badge for a few seconds
  // right after generating since classification runs in the background.
  return `<div class="ig-mcard" data-iid="${esc(s.id)}">
    <div class="ig-mthumb" data-act="ig-view"><img class="${nb.trim()}" src="${esc(mediaURL(s.image))}" alt="">${ratingBadge(s)}${badge}</div>
    ${tools}
  </div>`;
}

function igSectionHead(key, label){
  return `<button type="button" class="ig-sec-head" data-sec="${esc(key)}">
    <span>${esc(label)}</span>
    <svg class="ig-sec-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
  </button>`;
}
function wireIgSections(root){
  root.querySelectorAll(".ig-sec").forEach(sec=>{
    const key=sec.dataset.key;
    const def=sec.dataset.default==="open"?"false":"true";
    const collapsed=store.get("igsec:"+key, def)==="true";
    sec.classList.toggle("collapsed", collapsed);
    const head=sec.querySelector(".ig-sec-head");
    if(!head) return;
    head.setAttribute("aria-expanded", collapsed?"false":"true");
    head.onclick=()=>{
      const c=sec.classList.toggle("collapsed");
      store.set("igsec:"+key, c?"true":"false");
      head.setAttribute("aria-expanded", c?"false":"true");
    };
  });
}
async function renderGenerateTab(body, checkpoints, loras){
  let savedCreateGen=null;
  try{ savedCreateGen=JSON.parse(localStorage.getItem("ig_create_gen_state")||"null"); }catch(e){}
  const saved=await api("/api/imagegen/standalone").catch(()=>[]);
  let savedById=new Map(saved.map(s=>[s.id,s]));
  const masonry=list=>list.length?`<div class="ig-creations-grid">${list.map(s=>igMasonryCard(s,{owner:true})).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("ig_saved_empty"))}</div></div>`;
  body.innerHTML=`<div class="ig-layout">
    <aside class="ig-panel">
      <div class="ig-panel-title">${esc(t("ig_panel_title"))}</div>
      <div class="ig-sec" data-key="model">${igSectionHead("model", t("ig_model"))}
        <div class="ig-sec-body"><div id="ig_ckpt"></div></div></div>
      <div class="hint" id="ig_create_arch_note" style="display:none;margin:-8px 0 14px;"></div>
      <div class="ig-sec" data-key="lora" id="ig_lora_sec">${igSectionHead("lora", t("ig_lora_section"))}
        <div class="ig-sec-body"><div id="ig_lora"></div></div></div>
      <div id="ig_aspectres"></div>
      <div class="ig-sec" data-key="sampler">${igSectionHead("sampler", t("ig_sampler_section"))}
        <div class="ig-sec-body"><div id="ig_sampler"></div></div></div>
      <div class="ig-sec" data-key="steps">${igSectionHead("steps", t("ig_steps"))}
        <div class="ig-sec-body">
          <div class="field" style="margin:0;">
            <label>${esc(t("ig_steps"))} <span class="hint" id="igStepsVal">${(savedCreateGen&&savedCreateGen.steps)||20}</span></label>
            <input type="range" id="igSteps" min="1" max="60" step="1" value="${(savedCreateGen&&savedCreateGen.steps)||20}">
            <div class="hint" style="margin-top:4px;">${esc(t("ig_steps_hint"))}</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="cfg">${igSectionHead("cfg", t("ig_cfg"))}
        <div class="ig-sec-body">
          <div class="field" style="margin:0;">
            <label>${esc(t("ig_cfg"))} <span class="hint" id="igCfgVal">${(savedCreateGen&&savedCreateGen.cfg)||7}</span></label>
            <input type="range" id="igCfg" min="1" max="20" step="0.5" value="${(savedCreateGen&&savedCreateGen.cfg)||7}">
            <div class="hint" style="margin-top:4px;">${esc(t("ig_cfg_hint"))}</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="reference" id="ig_ref_sec">${igSectionHead("reference", t("img_gen_reference"))}
        <div class="ig-sec-body"><div id="ig_ref" title="${esc(t("img_gen_reference_hint"))}"></div></div></div>
      <div class="field"><label>${esc(t("img_gen_positive"))}</label>
        <textarea id="ig_positive" class="ig-autosize" rows="1" placeholder="${esc(t("ig_positive_ph"))}">${esc((savedCreateGen&&savedCreateGen.positive)||"")}</textarea>
        <div class="hint" style="margin-top:4px;">${esc(t("ig_prompt_hint"))}</div>
        <div class="ig-anima-prompt-banner" id="ig_create_anima_prompt_banner" style="display:none;">${esc(t("ig_anima_prompt_hint"))}</div></div>
      <div class="field"><label>${esc(t("img_gen_negative"))}</label>
        <textarea id="ig_negative" class="ig-autosize" rows="1" placeholder="${esc(t("ig_negative_ph"))}">${esc((savedCreateGen&&savedCreateGen.negative)||"")}</textarea>
        <div class="hint" style="margin-top:4px;">${esc(t("ig_prompt_hint"))}</div></div>
      <div class="actions"><button class="btn primary" id="ig_go">${esc(t("ig_generate"))}</button></div>
    </aside>
    <aside class="ig-preview-pane">
      <div class="ig-panel-title">${esc(t("ig_preview_title"))}</div>
      <div class="ig-unsaved-warning">⚠ ${esc(t("ig_unsaved_warning"))}</div>
      <div id="igPreviewWrap" class="ig-preview-empty">
        <div class="ig-preview-box">
          <img id="igPreviewImg" alt="">
          <div class="ig-status-pill" id="igStatusPill" style="display:none;"></div>
          <button type="button" class="ig-detail-download" id="igPreviewZoom" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
          <div id="igResultActions" style="display:none;">
            <button type="button" class="ig-detail-download" id="ig_upscale" style="right:140px;" title="${esc(t("ig_upscale"))}" aria-label="${esc(t("ig_upscale"))}">${SPARKLE_ICON_SVG}</button>
            <button type="button" class="ig-detail-download" id="ig_save" style="right:96px;" title="${esc(t("ig_save"))}" aria-label="${esc(t("ig_save"))}">${SAVE_ICON_SVG}</button>
            <button type="button" class="ig-detail-download" id="ig_discard" style="right:52px;" title="${esc(t("ig_discard"))}" aria-label="${esc(t("ig_discard"))}">${TRASH_ICON_SVG}</button>
          </div>
        </div>
      </div>
    </aside>
    <section class="ig-feed">
      <div class="section-heading" style="margin-bottom:16px;">${esc(t("ig_my_creations"))}</div>
      <div id="igSavedGrid">${masonry(saved)}</div>
    </section>
  </div>`;
  const applyCreateArch=name=>{
    const note=$("#ig_create_arch_note");
    // No Anima note here anymore either (see applyArchForCkpt above for why)
    // — the LoRA section already stays visible for Anima since that support
    // was fixed.
    if(note){ note.style.display="none"; note.textContent=""; }
    const promptBanner=$("#ig_create_anima_prompt_banner");
    if(promptBanner) promptBanner.style.display="none";
  };
  // Persist the checkpoint choice the moment it's picked, not only after a
  // successful generate — otherwise selecting a model and reloading before
  // ever clicking Generate silently reverts to whichever model was actually
  // last generated with, which reads as "my selection didn't save."
  const persistCreateFields=patch=>{
    let state={};
    try{ state=JSON.parse(localStorage.getItem("ig_create_gen_state")||"{}")||{}; }catch(e){}
    Object.assign(state, patch);
    try{ localStorage.setItem("ig_create_gen_state", JSON.stringify(state)); }catch(e){}
  };
  const persistCreateCkpt=name=>persistCreateFields({checkpoint:name});
  const savedCreateCkpt=savedCreateGen&&savedCreateGen.checkpoint&&checkpoints.includes(savedCreateGen.checkpoint)?savedCreateGen.checkpoint:undefined;
  const ckptSel=mountModelGrid($("#ig_ckpt"), checkpoints, {previews:_checkpointPreviews||{}, value:savedCreateCkpt,
    onChange:name=>{ applyCreateArch(name); persistCreateCkpt(name); }});
  applyCreateArch(ckptSel.value);
  $("#igPreviewZoom").onclick=()=>{
    const src=$("#igPreviewImg").src;
    if(!src) return;
    openModal(`<img src="${esc(src)}" alt="" style="width:100%;border-radius:10px;display:block;">`, null, {stack:true});
    _wireZoomPan($(".modal img"));
  };
  const loraPicker=mountLoraGrid($("#ig_lora"), loras, {previews:_loraPreviews||{}, value:savedCreateGen&&savedCreateGen.loras});
  const aspectRes=mountAspectResolution($("#ig_aspectres"));
  const samplerPickers=await mountSamplerPickers($("#ig_sampler"), {
    savedSampler:savedCreateGen&&savedCreateGen.sampler, savedScheduler:savedCreateGen&&savedCreateGen.scheduler,
    onChange:({sampler,scheduler})=>persistCreateFields({sampler, scheduler})});
  const refPicker=mountReferenceImagePicker($("#ig_ref"));
  wireIgSections(body);
  const stepsInput=$("#igSteps");
  const getSteps=()=>parseInt(stepsInput.value,10)||20;
  stepsInput.oninput=e=>{ $("#igStepsVal").textContent=e.target.value; persistCreateFields({steps:parseInt(e.target.value,10)}); };
  const cfgInput=$("#igCfg");
  const getCfg=()=>parseFloat(cfgInput.value)||7;
  cfgInput.oninput=e=>{ $("#igCfgVal").textContent=e.target.value; persistCreateFields({cfg:parseFloat(e.target.value)}); };
  [$("#ig_positive"), $("#ig_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta));
    ta.addEventListener("paste",()=>setTimeout(()=>autosize(ta),0));
    autosize(ta);
  });
  let lastImage=null, genAbort=null, lastWasImg2Img=false, lastCfg=7.0, lastUpscaler="", statusPillTimer=null;
  const showStatusPill=baseTextRaw=>{
    const pill=$("#igStatusPill"); if(!pill) return;
    clearInterval(statusPillTimer);
    // baseTextRaw ("Generating…") already ends in a literal ellipsis
    // character — stripping it before animating is what keeps the cycle at
    // 1/2/3 dots instead of stacking 0-3 more ASCII periods on top of it
    // (which read as anywhere from 3 to 6 dots).
    const baseText=baseTextRaw.replace(/[.…]+$/,"");
    let dots=0;
    pill.style.display="";
    pill.textContent=baseText+".";
    statusPillTimer=setInterval(()=>{ dots=dots%3+1; pill.textContent=baseText+".".repeat(dots); },450);
  };
  const hideStatusPill=()=>{
    clearInterval(statusPillTimer); statusPillTimer=null;
    const pill=$("#igStatusPill"); if(pill){ pill.style.display="none"; pill.textContent=""; }
  };
  const resetGoBtn=()=>{ const b=$("#ig_go"); b.disabled=false; b.classList.remove("stop"); b.textContent=t("ig_generate"); b.onclick=runGenerate; };
  const stopGenerate=()=>{
    if(genAbort){ try{ genAbort.abort(); }catch(e){} genAbort=null; }
    fetch(API+"/api/imagegen/standalone/stream/stop",{method:"POST"}).catch(()=>{});
    if(!lastImage){ $("#igPreviewImg").src=""; $("#igPreviewWrap").classList.add("ig-preview-empty"); }
    hideStatusPill();
    resetGoBtn();
  };
  const runGenerate=async()=>{
    const positive=$("#ig_positive").value.trim();
    if(!positive){ toast(t("ig_positive_ph")); return; }
    genAbort=new AbortController();
    const goBtn=$("#ig_go"); goBtn.classList.add("stop"); goBtn.textContent=t("ig_stop"); goBtn.onclick=stopGenerate;
    $("#igResultActions").style.display="none";
    showStatusPill(t("ig_generating"));
    const dims=aspectRes.getSize();
    // Anima is a different ComfyUI graph entirely (UNETLoader, not
    // CheckpointLoaderSimple) — sending it through as a plain "sdxl" request
    // (the default) makes ComfyUI reject it outright, since a UNet-only file
    // can't load as a full checkpoint. LoRAs now work for Anima too (fixed),
    // same as reference images (img2img).
    const anima=isAnimaModel(ckptSel.value);
    const body2={positive, negative:$("#ig_negative").value.trim(),
      checkpoint:ckptSel.value, architecture:anima?"anima":"sdxl",
      loras:loraPicker.getSelected(),
      reference_image:refPicker.getDataUrl(), denoise:refPicker.getDenoise(),
      width:dims.width, height:dims.height,
      sampler:anima?ANIMA_DEFAULT_SAMPLER:samplerPickers.sampler,
      scheduler:anima?ANIMA_DEFAULT_SCHEDULER:samplerPickers.scheduler,
      steps:getSteps(), cfg:getCfg()};
    try{ localStorage.setItem("ig_create_gen_state", JSON.stringify({
      checkpoint:body2.checkpoint, positive:body2.positive, negative:body2.negative, steps:body2.steps, cfg:getCfg(), loras:body2.loras
    })); }catch(e){}
    recordCheckpointUsage(body2.checkpoint);
    (body2.loras||[]).forEach(l=>_recordPickerUsage("ig_lora_usage", l.name));
    _recordPickerUsage("ig_sampler_usage", body2.sampler);
    _recordPickerUsage("ig_scheduler_usage", body2.scheduler);
    try{
      const res=await fetch(API+"/api/imagegen/standalone/stream",{method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify(body2), signal:genAbort.signal});
      if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
      await sseEvents(res, ev=>{
        if(ev.type==="preview"||ev.type==="done"){ $("#igPreviewWrap").classList.remove("ig-preview-empty"); $("#igPreviewImg").src=ev.image; }
        if(ev.type==="done"){ lastImage=ev.image; lastWasImg2Img=!!body2.reference_image; lastCfg=body2.cfg; lastUpscaler=""; $("#igResultActions").style.display=""; $("#ig_upscale").style.display=""; }
        if(ev.type==="error"){ errorToast("Image generation failed: "+ev.message); }
      });
    }catch(e){ if(e.name!=="AbortError") errorToast("Image generation failed: "+e.message); }
    hideStatusPill();
    genAbort=null;
    resetGoBtn();
  };
  $("#ig_go").onclick=runGenerate;
  $("#ig_discard").onclick=()=>{
    lastImage=null; lastUpscaler=""; $("#igPreviewImg").src=""; $("#igResultActions").style.display="none";
    $("#ig_upscale").style.display="";
    $("#igPreviewWrap").classList.add("ig-preview-empty");
  };
  $("#ig_upscale").onclick=async()=>{
    if(!lastImage) return;
    const btn=$("#ig_upscale");
    btn.disabled=true;
    let upscalers=[], previews={};
    try{
      [upscalers, previews]=await Promise.all([
        api("/api/imagegen/upscalers").catch(()=>[]),
        api("/api/imagegen/upscaler-previews").catch(()=>({}))]);
    }catch(e){}
    btn.disabled=false;
    if(!upscalers.length){ errorToast(t("ig_no_upscalers")); return; }
    const savedUpscaler=store.get("ig_last_upscaler","");
    const runUpscale=async(upscaler)=>{
      // Hidden the moment upscaling starts, not just disabled — there's no
      // point re-upscaling an already-upscaled image, so once this succeeds
      // the button stays gone for good (until a fresh generate brings it
      // back). Restored on failure so a retry is still possible.
      btn.style.display="none";
      const actions=$("#igResultActions");
      showStatusPill(t("ig_upscaling"));
      if(actions) actions.classList.add("ig-upscaling");
      try{
        const res=await fetch(API+"/api/imagegen/upscale/stream",{method:"POST",
          headers:{"Content-Type":"application/json"}, body:JSON.stringify({image:lastImage, upscaler})});
        if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
        let streamErr=null;
        await sseEvents(res, ev=>{
          // A plain upscale-model pass has no denoising steps of its own, so
          // ComfyUI may never actually send a "preview" event here — but if
          // it does (some upscale models process in tiles), it swaps into
          // the live preview immediately instead of the client sitting on
          // the stale pre-upscale image until "done".
          if(ev.type==="preview"||ev.type==="done"){ $("#igPreviewImg").src=ev.image; }
          if(ev.type==="done"){ lastImage=ev.image; lastUpscaler=previews[upscaler]?.display_name||upscaler; store.set("ig_last_upscaler", upscaler); }
          if(ev.type==="error"){ streamErr=ev.message; }
        });
        if(streamErr) throw new Error(streamErr);
      }catch(e){
        errorToast(t("ig_upscale_failed")+": "+e.message);
        btn.style.display="";
        $("#igPreviewImg").src=lastImage; // revert in case a preview frame arrived before the error
      }
      hideStatusPill();
      if(actions) actions.classList.remove("ig-upscaling");
    };
    openChoicePickerModal(upscalers, previews, upscalers.includes(savedUpscaler)?savedUpscaler:upscalers[0], runUpscale, {
      title:t("ig_upscaler_picker_title"), searchPh:t("ig_upscaler_search_ph"), useLabel:t("ig_use_this_upscaler"),
      emptyMsg:t("ig_upscaler_search_empty"), pickHint:t("ig_upscaler_pick_hint")});
  };
  // Classification runs as a background task (~1-2s) after the save request
  // already returned, so the grid's initial render always shows classified:
  // false / "Rating…" — poll briefly afterward and re-render once it flips,
  // instead of leaving the Share button stuck disabled until a full reload.
  const pollUntilClassified=async(iid, attemptsLeft=8)=>{
    if(attemptsLeft<=0) return;
    await new Promise(r=>setTimeout(r,1000));
    const refreshed=await api("/api/imagegen/standalone").catch(()=>null);
    if(!refreshed) return;
    const still=refreshed.find(s=>s.id===iid);
    if(!still) return;
    savedById.set(iid, still);
    if(still.classified){
      // Only swap the one card that actually changed, not the whole grid —
      // replacing everything every second was disruptive to scroll position
      // and felt like the page was lagging while this quietly polled.
      const card=$(`.ig-mcard[data-iid="${iid}"]`);
      if(card) card.replaceWith(el(igMasonryCard(still,{owner:true})));
      return;
    }
    pollUntilClassified(iid, attemptsLeft-1);
  };
  $("#ig_save").onclick=async()=>{
    if(!lastImage) return;
    try{
      const rec=await api("/api/imagegen/standalone/save", j("POST",{image:lastImage,
        positive:$("#ig_positive").value.trim(), negative:$("#ig_negative").value.trim(),
        checkpoint:ckptSel.value, loras:loraPicker.getSelected(),
        sampler:samplerPickers.sampler, scheduler:samplerPickers.scheduler, steps:getSteps(),
        is_img2img:lastWasImg2Img, cfg:lastCfg, upscaler:lastUpscaler}));
      toast(t("ig_saved_toast"));
      // The save response already IS the full record — render it straight
      // away instead of waiting on a second round-trip just to re-fetch the
      // same list, which is what made this feel slow to respond.
      saved.unshift(rec);
      savedById.set(rec.id, rec);
      $("#igSavedGrid").innerHTML=masonry(saved);
      if(rec && rec.id) pollUntilClassified(rec.id);
    }catch(e){ errorToast(t("ig_save_failed")+": "+e.message); }
  };
  $("#igSavedGrid").addEventListener("click", e=>{
    const card=e.target.closest(".ig-mcard"); if(!card) return;
    const iid=card.dataset.iid; const s=savedById.get(iid);
    if(e.target.closest("[data-act='ig-view']")){
      if(s) imageDetailModal({id:s.id, image:s.image, image_positive:s.positive, image_negative:s.negative,
        image_ts:s.created, checkpoint:s.checkpoint, loras:s.loras, is_explicit:s.is_explicit, human_reviewed:s.human_reviewed,
        sampler:s.sampler, scheduler:s.scheduler, steps:s.steps, is_img2img:s.is_img2img,
        cfg:s.cfg, upscaler:s.upscaler}, {ownerId:ME?ME.id:null, shareable:!!s.is_public, reportable:true});
      return;
    }
    if(e.target.closest("[data-act='ig-share']")){
      if(!s) return;
      if(s.is_public){
        api("/api/imagegen/standalone/"+iid+"/unshare",{method:"POST"}).then(r=>{
          s.is_public=false; s.is_explicit=false; toast(t("ig_unshared_toast"));
          card.replaceWith(el(igMasonryCard(s,{owner:true})));
        }).catch(err=>errorToast(err.message));
      } else {
        shareImageModal(iid, s.is_explicit, res=>{ s.is_public=true; s.is_explicit=res.is_explicit;
          card.replaceWith(el(igMasonryCard(s,{owner:true}))); });
      }
      return;
    }
    const btn=e.target.closest("[data-act='ig-saved-del']"); if(!btn) return;
    (async()=>{
      if(!(await confirmAction(btn, t("gallery_delete_confirm_msg")))) return;
      try{ await api("/api/imagegen/standalone/"+iid,{method:"DELETE"}); card.remove(); }
      catch(err){ errorToast(t("gallery_delete_failed")+": "+err.message); }
    })();
  });
}

function shareImageModal(iid, alreadyExplicit, onShared){
  // The AI classification is authoritative and can never be downgraded here
  // (enforced server-side too) — an already-NSFW image shares as NSFW no
  // matter what, so there's nothing to toggle; only offer the checkbox when
  // the classifier called it SFW, letting the creator self-flag something it
  // may have missed. Disputing a wrong NSFW call goes through "Lodge a
  // report", not this modal.
  const matureField=alreadyExplicit
    ? `<p class="hint" style="margin:8px 0 14px;">${esc(t("ig_share_already_nsfw"))}</p>`
    : `<label class="switch"><input type="checkbox" id="ig_share_mature"> ${esc(t("ig_share_mature"))}</label>`;
  openModal(`<h3>${esc(t("ig_share_title"))}</h3>
    <p class="hint" style="margin:8px 0 14px;">${esc(t("ig_share_body"))}</p>
    ${matureField}
    <div class="modal-foot"><button class="btn" id="ig_share_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ig_share_go">${esc(t("ig_share_confirm"))}</button></div>`);
  $("#ig_share_cancel").onclick=closeModal;
  $("#ig_share_go").onclick=async()=>{
    const matureEl=$("#ig_share_mature");
    const is_explicit=matureEl?matureEl.checked:false;
    try{
      const rec=await api("/api/imagegen/standalone/"+iid+"/share", j("POST",{is_explicit}));
      closeModal(); toast(t("ig_shared_toast")); onShared(rec);
    }catch(e){ errorToast(e.message); }
  };
}
