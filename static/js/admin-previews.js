"use strict";
/* ============================ ADMIN: model/LoRA/sampler/scheduler/upscaler previews ============================ */

// File-deletable kinds only (checkpoints/LoRAs/upscalers are real files on
// disk; samplers/schedulers are built into ComfyUI itself, nothing to
// delete) — gates whether the corner bin icon appears at all.
const _admDeletableKinds=new Set(["ckpt","lora","upsc"]);

// Shared row builder: a name, an optional preview image, and optional
// admin-set display_name/description — same {name: {image, display_name,
// description}} shape for both checkpoints and LoRAs (checkpoint_previews /
// lora_previews tables). kind is "ckpt" or "lora", used for the data-*
// action attribute names the click handlers below key off of.
// Persists each section's typed filter query across re-renders — render()
// fully rebuilds main.innerHTML on every poll/action (see admin-core.js),
// which would otherwise silently clear whatever an admin was mid-typing.
const _previewFilterQuery={ckpt:"", lora:"", upsc:"", samp:"", sched:""};

function _admPreviewGrid(names, previewMap, kind, emptyMsg, builtinDesc){
  return names.length?`<div class="adash-preview-grid">
      ${names.map(name=>{
        const meta=previewMap[name]||{};
        const label=meta.display_name||name;
        const img=meta.image;
        const desc=meta.description||(builtinDesc?builtinDesc(name):"");
        // Precomputed once per card, not re-derived from DOM text on every
        // keystroke — combines every field a name/tag search should match.
        const searchText=[name, label, desc, ...(meta.keywords||[])].join(" ").toLowerCase();
        // The arch badge always reflects the admin-defined category
        // instead of the free-text description — that field can hold
        // whatever a checkpoint's own README/source called itself (e.g.
        // "PixAI DiT.2"), which isn't the same thing as its actual base
        // architecture and shouldn't be presented as if it were one.
        // Applies to both checkpoints and LoRAs — a LoRA can carry more
        // than one compatible-architecture pill.
        const archCats=(kind==="ckpt"||kind==="lora")?modelCategories(name,previewMap):[];
        const archBadge=archCats.length?`<span class="adash-preview-arch-row">${archCats.map(c=>`<span class="adash-preview-arch">${esc(modelCategoryLabel(c))}</span>`).join("")}</span>`:"";
        // Clicking the thumbnail is equivalent to the row's Zoom button
        // below. The generate/regenerate action lives inside the zoom
        // modal itself (see _admOpenZoomModal), not out here on the card.
        const thumb=img?`<div class="adash-preview-thumb" data-${kind}-zoom="${esc(name)}" style="background-image:url('${esc(mediaURL(img))}');cursor:zoom-in;">${archBadge}</div>`
                     :`<div class="adash-preview-thumb ava mono" data-${kind}-zoom="${esc(name)}" style="cursor:zoom-in;">${esc((label||"?")[0].toUpperCase())}${archBadge}</div>`;
        const unpublished=kind==="lora" && meta.is_published===false;
        const publishRow=unpublished?`<div class="adash-preview-publish">
          <span class="hint">Unpublished — hidden from users</span>
          <button type="button" class="btn primary" data-lora-publish="${esc(name)}" style="padding:4px 10px;font-size:12px;">Publish</button>
        </div>`:"";
        const keywordsRow=(kind==="lora" && (meta.keywords||[]).length)
          ?`<div class="adash-preview-keywords">${meta.keywords.map(k=>`<span class="tag">${esc(k)}</span>`).join("")}</div>`:"";
        return `<div class="adash-preview-card" data-search="${esc(searchText)}">
          ${thumb}
          <div class="adash-preview-name" title="${esc(name)}">${esc(label)}</div>
          <div class="adash-preview-meta">${desc?esc(desc):(img?"":esc(t("adm_preview_none")))}</div>
          ${keywordsRow}
          <div class="adash-preview-actions">
            <button class="tool" data-${kind}-zoom="${esc(name)}" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
            <button class="tool" data-${kind}-edit="${esc(name)}" title="${esc(t("adm_preview_edit"))}" aria-label="${esc(t("adm_preview_edit"))}">${EDIT_ICON_SVG}</button>
            ${_admDeletableKinds.has(kind)?`<button class="tool danger" data-${kind}-delfile="${esc(name)}" title="Delete file" aria-label="Delete file">${TRASH_ICON_SVG}</button>`:""}
          </div>
          ${publishRow}
        </div>`;
      }).join("")}
    </div>`:`<div class="adash-empty">${esc(emptyMsg)}</div>`;
}

// Collapsible sections — five full preview grids stacked on one page
// read as cluttered, especially once an admin only cares about one of
// them. The chevron toggle lives in .adash-panel-head itself (not a
// separate header replacing it, like .ig-sec elsewhere uses) so the
// "+ Add" button stays reachable without expanding the grid underneath.
function _admPreviewSection(key, eyebrow, title, sub, addBtnHTML, bodyHTML){
  return `
    <div class="adash-collapse" data-collapse-key="${esc(key)}" style="margin-top:32px;">
      <div class="adash-panel-head">
        <button type="button" class="adash-collapse-toggle" data-collapse-toggle aria-expanded="true">
          <svg class="adash-collapse-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          <div><div class="adash-eyebrow">${esc(eyebrow)}</div><h2 class="adash-h2">${esc(title)}</h2><div class="adash-sub">${esc(sub)}</div></div>
        </button>
        ${addBtnHTML||""}
      </div>
      <div class="adash-collapse-body">${bodyHTML}</div>
    </div>`;
}

// A filter box above each grid — matches name/display-name/description/
// keywords (see _admPreviewGrid's data-search attribute), not just name, so
// "suspension" finds a LoRA tagged with that keyword even if it's not in
// the title. Value/placement kept in sync with _previewFilterQuery so a
// re-render (e.g. after uploading a preview image) doesn't reset it.
function _previewSearchBox(kind, placeholder){
  return `<div class="field" style="margin:0 0 14px;">
    <input type="text" class="adash-preview-filter" data-filter-kind="${esc(kind)}"
      placeholder="${esc(placeholder)}" value="${esc(_previewFilterQuery[kind]||"")}" autocomplete="off">
  </div>`;
}

// Re-fetches every category's data (checkpoints/LoRAs/upscalers/samplers/
// schedulers all come from the same render() call anyway — see admin-core.js
// — so a per-category refresh button just re-runs the same full render()
// rather than duplicating a partial-fetch path) without waiting for the
// 20s background poll or a full page reload.
function _previewRefreshBtn(kind){
  return `<button type="button" class="tool" data-refresh-kind="${esc(kind)}" title="Refresh" aria-label="Refresh">${REGEN_ICON_SVG}</button>`;
}

// Groups the refresh icon + "+ Add" button into ONE flex child of
// .adash-panel-head — that header uses justify-content:space-between across
// its direct children (title block vs. actions), so two separate top-level
// buttons there get spread apart by space-between too, not just the title
// vs. actions gap. Wrapping them keeps space-between doing only the one job
// it's meant for.
function _previewHeaderActions(refreshKind, addBtnHTML){
  return `<div style="display:flex;align-items:center;gap:8px;">${_previewRefreshBtn(refreshKind)}${addBtnHTML||""}</div>`;
}

function _admPreviewsPanelHTML({checkpoints, loraList, samplerList, schedulerList, upscalerList, previews, loraPreviews, samplerPreviews, schedulerPreviews, upscalerPreviews}){
  return `
    ${_admPreviewSection("ckpt", t("adm_nav_previews"), t("adm_previews_title"), t("adm_previews_sub"),
      _previewHeaderActions("ckpt", `<button type="button" class="btn primary" id="previewsAddModel">+ Add model</button>`),
      _previewSearchBox("ckpt", "Filter by name or description…") +
      _admPreviewGrid(checkpoints, previews, "ckpt", t("img_gen_no_checkpoints")))}
    ${_admPreviewSection("lora", t("adm_nav_lora_previews"), t("adm_lora_previews_title"), t("adm_lora_previews_sub"),
      _previewHeaderActions("lora", `<button type="button" class="btn primary" id="previewsAddLora">+ Add LoRA</button>`),
      _previewSearchBox("lora", "Filter by name, description, or tag…") +
      _admPreviewGrid(loraList, loraPreviews, "lora", t("adm_no_loras")))}
    ${_admPreviewSection("upscaler", "Upscalers", "Upscaler reference images", "Curate one representative sample image per upscaler — same as models and LoRAs above.",
      _previewHeaderActions("upsc", `<button type="button" class="btn primary" id="previewsAddUpscaler">+ Request upscaler</button>`),
      _previewSearchBox("upsc", "Filter by name or description…") +
      _admPreviewGrid(upscalerList, upscalerPreviews, "upsc", "No upscalers installed yet — request one above."))}
    ${_admPreviewSection("samp", t("adm_nav_sampler_previews"), t("adm_sampler_previews_title"), t("adm_sampler_previews_sub"),
      _previewHeaderActions("samp"), _previewSearchBox("samp", "Filter by name or description…") +
      _admPreviewGrid(samplerList, samplerPreviews, "samp", t("adm_no_samplers"), samplerDesc))}
    ${_admPreviewSection("sched", t("adm_nav_scheduler_previews"), t("adm_scheduler_previews_title"), t("adm_scheduler_previews_sub"),
      _previewHeaderActions("sched"), _previewSearchBox("sched", "Filter by name or description…") +
      _admPreviewGrid(schedulerList, schedulerPreviews, "sched", t("adm_no_schedulers"), schedulerDesc))}`;
}

function _admWirePreviews(main, {previews, loraPreviews, samplerPreviews, schedulerPreviews, upscalerPreviews}, render){
  // Straight to the request form (openModelRequestModal, same standalone
  // no-tabs layout as openUpscalerRequestModal) — an admin clicking
  // "+ Add model/LoRA" already knows it's not installed yet, so making them
  // click past a browse-what's-already-there grid first (the picker
  // modal's default "Models" tab) was pointless friction.
  const previewsAddModelBtn=document.getElementById("previewsAddModel");
  if(previewsAddModelBtn) previewsAddModelBtn.onclick=()=>{ openModelRequestModal("checkpoint"); };
  const previewsAddLoraBtn=document.getElementById("previewsAddLora");
  if(previewsAddLoraBtn) previewsAddLoraBtn.onclick=()=>{ openModelRequestModal("lora"); };
  const previewsAddUpscalerBtn=document.getElementById("previewsAddUpscaler");
  if(previewsAddUpscalerBtn) previewsAddUpscalerBtn.onclick=()=>{ openUpscalerRequestModal(); };

  main.querySelectorAll("[data-refresh-kind]").forEach(b=>b.onclick=async()=>{
    b.disabled=true; b.classList.add("spinning");
    _imagegenCheckpoints=null; _checkpointPreviews=null; _loraPreviews=null; _upscalerPreviews=null;
    try{ await render(); }
    catch(e){ errorToast("Refresh failed: "+e.message); }
    // render() rebuilds main.innerHTML entirely, so this exact button no
    // longer exists after a successful refresh — nothing left to re-enable.
  });

  const applyPreviewFilter=(kind, query)=>{
    const grid=main.querySelector(`[data-collapse-key="${kind}"] .adash-preview-grid`);
    if(!grid) return;
    const q=query.trim().toLowerCase();
    let anyVisible=false;
    grid.querySelectorAll(".adash-preview-card").forEach(card=>{
      const matches=!q||(card.dataset.search||"").includes(q);
      card.style.display=matches?"":"none";
      if(matches) anyVisible=true;
    });
    let noMatch=grid.parentElement.querySelector(".adash-preview-no-match");
    if(q && !anyVisible){
      if(!noMatch){
        noMatch=document.createElement("div");
        noMatch.className="adash-empty adash-preview-no-match";
        noMatch.textContent="No matches for that filter.";
        grid.after(noMatch);
      }
      noMatch.style.display="";
    }else if(noMatch){
      noMatch.style.display="none";
    }
  };
  main.querySelectorAll(".adash-preview-filter").forEach(input=>{
    const kind=input.dataset.filterKind;
    applyPreviewFilter(kind, input.value);
    input.addEventListener("input", ()=>{
      _previewFilterQuery[kind]=input.value;
      applyPreviewFilter(kind, input.value);
    });
  });

  // Per-kind: preview-PUT route, the cache var(s) to invalidate after a
  // successful save, and the picker flow to run (upscalers post-process an
  // uploaded source image through the real upscaler rather than just
  // generating one — same distinction the old per-kind handlers made).
  const _previewKindConfig={
    ckpt:{route:"/api/admin/checkpoint-previews/", invalidate:()=>{ _imagegenCheckpoints=null; _checkpointPreviews=null; },
         pick:(name,cb)=>openImageGenPickerModal(cb, {lockCheckpoint:name, hideLoraPicker:true})},
    lora:{route:"/api/admin/lora-previews/", invalidate:()=>{ _imagegenCheckpoints=null; _loraPreviews=null; },
         pick:(name,cb)=>openImageGenPickerModal(cb, {lockLora:name})},
    samp:{route:"/api/admin/sampler-previews/", invalidate:()=>{ _samplerPreviews=null; },
         pick:(name,cb)=>openImageGenPickerModal(cb, {lockSampler:name})},
    sched:{route:"/api/admin/scheduler-previews/", invalidate:()=>{ _schedulerPreviews=null; },
         pick:(name,cb)=>openImageGenPickerModal(cb, {lockScheduler:name})},
    upsc:{route:"/api/admin/upscaler-previews/", invalidate:()=>{ _upscalerPreviews=null; },
         pick:(name,cb)=>openUpscalerPreviewModal(name, cb)},
  };
  const _previewMapForKind={ckpt:previews, lora:loraPreviews, samp:samplerPreviews, sched:schedulerPreviews, upsc:upscalerPreviews};

  // Zoom view: the big image (or, if none set yet, an empty placeholder)
  // with the generate/regenerate action overlaid on it — this is the one
  // and only place that action lives now, not a separate card button.
  const openZoomModal=(kind, name, meta)=>{
    const cfg=_previewKindConfig[kind];
    const img=meta.image;
    const doGenerate=()=>cfg.pick(name, async blob=>{
      const fd=new FormData(); fd.append("file", blob, "preview.jpg");
      try{
        await api(cfg.route+encodeURIComponent(name),{method:"PUT",body:fd});
        cfg.invalidate();
        closeModal(); toast(t("adm_preview_saved")); render();
      }catch(e){ errorToast("Upload failed: "+e.message); }
    });
    openModal(img
      ? `<div style="position:relative;"><img src="${esc(mediaURL(img))}" alt="" style="width:100%;border-radius:10px;display:block;">
           <div class="adash-preview-overlay adash-preview-overlay-lg">
             <button type="button" class="tool" id="zoomRegen" title="${esc(t("adm_preview_replace"))}" aria-label="${esc(t("adm_preview_replace"))}">${SPARKLE_ICON_SVG}</button>
             <button type="button" class="tool danger" id="zoomClearImg" title="${esc(t("adm_preview_clear"))}" aria-label="${esc(t("adm_preview_clear"))}">${TRASH_ICON_SVG}</button>
           </div>
         </div>`
      : `<div class="img-pick-empty" id="zoomGenerate" style="aspect-ratio:1;width:100%;flex-direction:column;gap:8px;">${SPARKLE_ICON_SVG}<span class="hint">${esc(t("adm_preview_set"))}</span></div>`,
      null, {stack:true});
    if(img) _wireZoomPan(document.querySelector(".modal img"));
    const regenBtn=document.getElementById("zoomRegen")||document.getElementById("zoomGenerate");
    if(regenBtn) regenBtn.onclick=doGenerate;
    const clearImgBtn=document.getElementById("zoomClearImg");
    if(clearImgBtn) clearImgBtn.onclick=async()=>{
      // Clears just the curated preview image (this LoRA/checkpoint/etc.
      // itself is untouched) — the outside card's bin icon is the separate,
      // far more destructive "delete the real model file" action.
      if(!(await confirmAction(clearImgBtn, t("adm_preview_clear")+"?"))) return;
      try{
        await api(cfg.route+encodeURIComponent(name),{method:"DELETE"});
        cfg.invalidate();
        closeModal(); toast(t("adm_preview_cleared")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    };
  };
  Object.keys(_previewKindConfig).forEach(kind=>{
    main.querySelectorAll(`[data-${kind}-zoom]`).forEach(el=>el.onclick=e=>{
      e.stopPropagation();
      const name=el.getAttribute(`data-${kind}-zoom`);
      openZoomModal(kind, name, _previewMapForKind[kind][name]||{});
    });
  });

  // Destructive: permanently deletes the real model file from ComfyUI's
  // models volume, not just the admin-curated preview image (see
  // backend DELETE /api/admin/models/{kind}/{name}).
  const _deletableKindKeys={ckpt:"ckptDelfile", lora:"loraDelfile", upsc:"upscDelfile"};
  Object.entries(_deletableKindKeys).forEach(([kind, dataKey])=>{
    main.querySelectorAll(`[data-${kind}-delfile]`).forEach(b=>b.onclick=async e=>{
      e.stopPropagation();
      const name=b.dataset[dataKey];
      if(!(await confirmAction(b, `Permanently delete this file from disk? This cannot be undone.`))) return;
      try{
        await api(`/api/admin/models/${kind}/${encodeURIComponent(name)}`,{method:"DELETE"});
        _imagegenCheckpoints=null; _checkpointPreviews=null; _loraPreviews=null; _upscalerPreviews=null;
        toast("Deleted."); render();
      }catch(e){ errorToast("Delete failed: "+e.message); }
    });
  });
  main.querySelectorAll("[data-lora-publish]").forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    const name=b.dataset.loraPublish;
    try{
      await api("/api/admin/lora-previews/"+encodeURIComponent(name)+"/publish", j("PUT",{published:true}));
      _loraPreviews=null;
      toast("Published — now visible to all users."); render();
    }catch(e){ errorToast("Publish failed: "+e.message); }
  });

  // ---- Model / LoRA metadata (display name + description) ----
  const openEditMetaModal=async(kind, name, currentMeta)=>{
    const routeBase = kind==="ckpt" ? "/api/admin/checkpoint-previews/"
      : kind==="lora" ? "/api/admin/lora-previews/"
      : kind==="samp" ? "/api/admin/sampler-previews/"
      : kind==="upsc" ? "/api/admin/upscaler-previews/"
      : "/api/admin/scheduler-previews/";
    const isAnimaCkpt = kind==="ckpt" && isAnimaModel(name);
    const {clipModels, vaeModels} = isAnimaCkpt ? await getAnimaEncoderOptions() : {clipModels:[], vaeModels:[]};
    const animaCsItems=list=>[{value:"", label:t("adm_edit_meta_anima_default")}, ...list.map(m=>({value:m, label:m}))];
    openModal(`<h3>${esc(t("adm_edit_meta_title"))}</h3>
      <p class="hint" style="margin:0 0 14px;word-break:break-all;">${esc(name)}</p>
      <div class="field"><label>${esc(t("adm_edit_meta_name"))}</label>
        <input type="text" id="mm_name" value="${esc(currentMeta.display_name||"")}" placeholder="${esc(t("adm_edit_meta_name_ph"))}"></div>
      ${kind==="ckpt"?`<div class="field"><label>${esc(t("adm_edit_meta_type"))}</label>
        <input type="text" id="mm_type" value="${esc(currentMeta.model_type||"")}" placeholder="${esc(t("adm_edit_meta_type_ph"))}"></div>`:""}
      ${kind==="ckpt"?`<div class="field"><label>${esc(t("adm_edit_meta_steps"))} <span class="hint">${esc(t("adm_edit_meta_steps_hint"))}</span></label>
        <label class="switch" style="margin-bottom:8px;"><input type="checkbox" id="mm_steps_on" ${currentMeta.default_steps!=null?"checked":""}> ${esc(t("adm_edit_meta_steps_toggle"))}</label>
        <div id="mm_steps_row" style="display:${currentMeta.default_steps!=null?"":"none"};">
          <span class="hint" id="mm_steps_val">${currentMeta.default_steps!=null?currentMeta.default_steps:20}</span>
          <input type="range" id="mm_steps" min="1" max="60" step="1" value="${currentMeta.default_steps!=null?currentMeta.default_steps:20}">
        </div></div>`:""}
      ${kind==="lora"?`<div class="field"><label>${esc(t("adm_edit_meta_category"))} <span class="hint">${esc(t("adm_edit_meta_category_multi_hint"))}</span></label>
        <div class="seg ig-mp-category-tabs" id="mmCategoryPills">
          ${MODEL_CATEGORY_TABS.map(c=>`<button type="button" class="seg-btn${(currentMeta.model_category||[]).includes(c)?" on":""}" data-c="${c}">${esc(modelCategoryLabel(c))}</button>`).join("")}
        </div></div>`:""}
      ${kind==="lora"?`<div class="field"><label>Keywords <span class="hint">Prompt words that actually trigger this LoRA's trained concept (e.g. a character's trigger word, or known activation tags) — shown to whoever picks it so they know what to type. Comma-separated.</span></label>
        <textarea id="mm_keywords" style="min-height:64px" placeholder="e.g. sks, neon cyberpunk, red hair">${esc((currentMeta.keywords||[]).join(", "))}</textarea>
        <div id="mmKeywordsPreview" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">
          ${(currentMeta.keywords||[]).map(k=>`<span class="tag">${esc(k)}</span>`).join("")}
        </div></div>`:""}
      ${isAnimaCkpt?`<div class="field"><label>${esc(t("adm_edit_meta_anima_clip"))}</label>
        <div id="mm_anima_clip"></div></div>
      <div class="field"><label>${esc(t("adm_edit_meta_anima_vae"))}</label>
        <div id="mm_anima_vae"></div>
        <span class="hint">${esc(t("adm_edit_meta_anima_hint"))}</span></div>`:""}
      <div class="field"><label>${esc(t("adm_edit_meta_desc"))}</label>
        <textarea id="mm_desc" style="min-height:64px" placeholder="${esc(t("adm_edit_meta_desc_ph"))}">${esc(currentMeta.description||"")}</textarea></div>
      <div class="modal-foot"><button class="btn" id="mm_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="mm_save">${esc(t("btn_save"))}</button></div>`);
    document.getElementById("mm_cancel").onclick=closeModal;
    let animaClipCs=null, animaVaeCs=null;
    if(isAnimaCkpt){
      animaClipCs=mountCustomSelect(document.getElementById("mm_anima_clip"), animaCsItems(clipModels),
        {value:currentMeta.anima_clip_name||"", placeholder:t("adm_edit_meta_anima_default")});
      animaVaeCs=mountCustomSelect(document.getElementById("mm_anima_vae"), animaCsItems(vaeModels),
        {value:currentMeta.anima_vae_name||"", placeholder:t("adm_edit_meta_anima_default")});
    }
    const stepsOnEl=document.getElementById("mm_steps_on"), stepsRowEl=document.getElementById("mm_steps_row");
    if(stepsOnEl){
      stepsOnEl.onchange=()=>{ stepsRowEl.style.display=stepsOnEl.checked?"":"none"; };
      document.getElementById("mm_steps").oninput=e=>{ document.getElementById("mm_steps_val").textContent=e.target.value; };
    }
    const categoryPills=new Set(kind==="lora"?(currentMeta.model_category||[]):[]);
    const pillsEl=document.getElementById("mmCategoryPills");
    if(pillsEl) pillsEl.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
      const c=b.dataset.c;
      if(categoryPills.has(c)) categoryPills.delete(c); else categoryPills.add(c);
      b.classList.toggle("on", categoryPills.has(c));
    });
    const keywordsInput=document.getElementById("mm_keywords"), keywordsPreview=document.getElementById("mmKeywordsPreview");
    if(keywordsInput) keywordsInput.oninput=()=>{
      const kws=keywordsInput.value.split(",").map(s=>s.trim()).filter(Boolean);
      keywordsPreview.innerHTML=kws.map(k=>`<span class="tag">${esc(k)}</span>`).join("");
    };
    document.getElementById("mm_save").onclick=async()=>{
      const display_name=document.getElementById("mm_name").value.trim()||null;
      const description=document.getElementById("mm_desc").value.trim()||null;
      const typeEl=document.getElementById("mm_type");
      const model_type=typeEl?(typeEl.value.trim()||null):null;
      const stepsEl=document.getElementById("mm_steps");
      const default_steps=(stepsEl&&stepsOnEl&&stepsOnEl.checked)?parseInt(stepsEl.value,10):null;
      const body={display_name, description, model_type, default_steps};
      // model_category is LoRA-only — omitted entirely for checkpoints so
      // the backend leaves whatever's already stored untouched instead of
      // overwriting it to null on every unrelated-field save.
      if(kind==="lora"){
        body.model_category=[...categoryPills];
        body.keywords=keywordsInput.value.split(",").map(s=>s.trim()).filter(Boolean);
      }
      if(isAnimaCkpt){
        body.anima_clip_name=animaClipCs.value||null;
        body.anima_vae_name=animaVaeCs.value||null;
      }
      try{
        await api(routeBase+encodeURIComponent(name)+"/meta", j("PUT",body));
        _imagegenCheckpoints=null; _checkpointPreviews=null; _loraPreviews=null;
        _samplerPreviews=null; _schedulerPreviews=null;
        closeModal(); toast(t("adm_edit_meta_saved")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    };
  };
  main.querySelectorAll("[data-ckpt-edit]").forEach(b=>b.onclick=()=>{
    const name=b.dataset.ckptEdit;
    openEditMetaModal("ckpt", name, previews[name]||{});
  });
  main.querySelectorAll("[data-lora-edit]").forEach(b=>b.onclick=()=>{
    const name=b.dataset.loraEdit;
    openEditMetaModal("lora", name, loraPreviews[name]||{});
  });
  main.querySelectorAll("[data-samp-edit]").forEach(b=>b.onclick=()=>{
    const name=b.dataset.sampEdit;
    openEditMetaModal("samp", name, samplerPreviews[name]||{});
  });
  main.querySelectorAll("[data-sched-edit]").forEach(b=>b.onclick=()=>{
    const name=b.dataset.schedEdit;
    openEditMetaModal("sched", name, schedulerPreviews[name]||{});
  });
  main.querySelectorAll("[data-upsc-edit]").forEach(b=>b.onclick=()=>{
    const name=b.dataset.upscEdit;
    openEditMetaModal("upsc", name, upscalerPreviews[name]||{});
  });
}
