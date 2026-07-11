"use strict";

let _imagegenCheckpoints=null, _imagegenLoras=null, _checkpointPreviews=null, _loraPreviews=null;
let _samplerPreviews=null, _schedulerPreviews=null, _samplerData=null, _upscalerPreviews=null;
// Anima is a second, unrelated base-model architecture (see imagegen.py's
// ANIMA_WORKFLOW) — its models come from a separate ComfyUI list (UNETLoader,
// not CheckpointLoaderSimple) but are folded into the same checkpoint picker
// so there's one place to pick a model; _animaUnetSet is how callers tell
// which architecture a given selection needs (LoRAs/reference-image aren't
// supported for it yet, and it needs its own sampler/scheduler/cfg defaults).
let _animaUnetSet=null;
function isAnimaModel(name){ return !!(_animaUnetSet && _animaUnetSet.has(name)); }
// Anima CLIP text-encoder/VAE override pickers (edit-meta modal) — cached
// for the page lifetime like getImagegenOptions(), separate cache since
// they're only ever needed inside that modal, not the main picker flow.
let _animaClipModels=null, _animaVaeModels=null;
async function getAnimaEncoderOptions(){
  if(_animaClipModels && _animaVaeModels) return {clipModels:_animaClipModels, vaeModels:_animaVaeModels};
  const [clipModels, vaeModels]=await Promise.all([
    api("/api/imagegen/clip-models").catch(()=>[]),
    api("/api/imagegen/vaes").catch(()=>[]),
  ]);
  _animaClipModels=clipModels; _animaVaeModels=vaeModels;
  return {clipModels, vaeModels};
}
async function getImagegenOptions(){
  if(_imagegenCheckpoints) return {checkpoints:_imagegenCheckpoints, loras:_imagegenLoras,
    previews:_checkpointPreviews||{}, loraPreviews:_loraPreviews||{}};
  const [checkpoints, animaUnets, loras, previews, loraPreviews]=await Promise.all([
    api("/api/imagegen/checkpoints").catch(()=>[]),
    api("/api/imagegen/anima-unets").catch(()=>[]),
    api("/api/imagegen/loras").catch(()=>[]),
    api("/api/imagegen/checkpoint-previews").catch(()=>({})),
    api("/api/imagegen/lora-previews").catch(()=>({})),
  ]);
  _animaUnetSet=new Set(animaUnets);
  _imagegenCheckpoints=[...checkpoints, ...animaUnets]; _imagegenLoras=loras;
  _checkpointPreviews=previews; _loraPreviews=loraPreviews;
  return {checkpoints:_imagegenCheckpoints, loras, previews, loraPreviews};
}
// getImagegenOptions() caches for the lifetime of the page, but the model/
// LoRA picker modals hold their own `previews` object via a closure captured
// whenever their parent panel first mounted — an admin updating a preview
// image elsewhere doesn't reach that already-resolved closure, so the picker
// modal kept showing stale previews until a full page reload. Called right
// before each picker modal opens so it always reflects the latest state.
async function refreshImagegenOptions(){
  _imagegenCheckpoints=null; _imagegenLoras=null; _checkpointPreviews=null; _loraPreviews=null;
  return getImagegenOptions();
}
// previews maps are {name: {image, display_name, description}} — a friendly
// name/description an admin curated, independent of whether a preview image
// is set. Falls back to the raw filename everywhere one isn't set.
function modelLabel(name, previews){ return (previews && previews[name] && previews[name].display_name) || name; }
function modelDesc(name, previews){ return (previews && previews[name] && previews[name].description) || ""; }
function modelKeywords(name, previews){ return (previews && previews[name] && previews[name].keywords) || []; }
function modelType(name, previews){
  const cats=modelCategories(name,previews);
  // The structured category (Flux V2/Anima/SDXL (legacy)/IL (legacy)) always
  // wins once an admin has actually classified a model — otherwise this falls
  // back to the free-text "Type" field, then the filename-guessed heuristic.
  // A LoRA can be classified under more than one compatible architecture
  // (e.g. a merge trained to work under both SDXL and IL conventions).
  if(cats.length) return cats.map(modelCategoryLabel).join(", ");
  return (previews && previews[name] && previews[name].model_type) || describeCheckpoint(name);
}
// Anima's category is structural (it's a UNETLoader model, not admin-set)
// and always wins over whatever's stored; everything else is whatever
// architecture(s) the admin picked in the edit-meta modal, or [] if never
// classified. Always returns an array — checkpoints are effectively always
// single-item, LoRAs can genuinely have more than one.
function modelCategories(name, previews){
  if(isAnimaModel(name)) return ["anima"];
  const meta=previews && previews[name];
  const raw=meta && meta.model_category;
  // An empty array ([]) is truthy in JS — stored that way for checkpoints
  // that have never had a legacy category set — so this has to check
  // .length explicitly rather than falling through to `if(raw)` treating
  // the empty array itself as a single (bogus, non-string) category.
  if(Array.isArray(raw)){ if(raw.length) return raw.filter(Boolean); }
  else if(raw) return [raw];
  // Checkpoints classify via the free-text Type field, not model_category
  // (see backend/db.py's set_checkpoint_meta) — without this fallback, a
  // checkpoint with a Type set but no legacy model_category showed no badge
  // at all, even though admin clearly set one via the edit-details modal.
  // A free-text value naming a known legacy architecture (SDXL/IL/Pony, any
  // case) is normalized to that category's canonical code — not just shown
  // as a raw label — so it's also correctly treated as legacy by
  // isLegacyModelCategory/hasOnlyLegacyCategories ("Hide legacy models").
  if(!(meta && meta.model_type)) return [];
  const norm=meta.model_type.trim().toLowerCase();
  const known=["sdxl","il","pony","flux_v2","anima"].find(c=>c===norm);
  return [known || meta.model_type];
}
// Legacy single-category callers (exact-match filtering against one active
// tab) — true if that ONE tab's category is among this model's categories.
function modelCategory(name, previews){ return modelCategories(name,previews)[0]||""; }
function modelHasCategory(name, previews, cat){ return modelCategories(name,previews).includes(cat); }
function isLegacyModelCategory(cat){ return cat==="sdxl"||cat==="il"||cat==="pony"; }
// "Hide legacy" should only hide something that's PURELY legacy — a LoRA
// tagged both e.g. sdxl and anima still supports a modern architecture and
// shouldn't disappear just because one of its several tags happens to be
// legacy too.
function hasOnlyLegacyCategories(name, previews){
  const cats=modelCategories(name,previews);
  return cats.length>0 && cats.every(isLegacyModelCategory);
}
function modelCategoryLabel(cat){
  return cat==="sdxl" ? t("adm_edit_meta_category_sdxl") : cat==="il" ? t("adm_edit_meta_category_il")
    : cat==="flux_v2" ? "Flux V2" : cat==="anima" ? "Anima" : cat==="pony" ? t("adm_edit_meta_category_pony") : cat;
}
function modelImage(name, previews){ return previews && previews[name] && previews[name].image; }
/* ComfyUI's /object_info only returns bare filenames, no metadata — this heuristically
   labels a checkpoint from common naming conventions so users can tell base models
   apart at a glance without knowing every filename's lineage by heart. */
function describeCheckpoint(name){
  const n=(name||"").toLowerCase();
  const arch = /illustrious|noobai|noob[-_]?ai/.test(n) ? "Illustrious"
    : /pony/.test(n) ? "Pony Diffusion"
    : /sdxl|_xl|-xl|\bxl\b/.test(n) ? "SDXL"
    : /sd3|sd_3/.test(n) ? "Stable Diffusion 3"
    : /flux/.test(n) ? "Flux"
    : /sd[-_ ]?1\.?5|v1-5|v1_5/.test(n) ? "SD 1.5"
    : "";
  const flavor = /anime|animagine|niji/.test(n) ? "anime-tuned"
    : /realistic|photo|real[-_]?vis/.test(n) ? "photoreal"
    : /turbo/.test(n) ? "turbo/fast"
    : /lightning/.test(n) ? "lightning/fast"
    : "";
  return [arch, flavor].filter(Boolean).join(" · ");
}
/* Native <select> can't show a description line per option, and its open dropdown list
   ignores CSS in most browsers — so model/LoRA pickers use this small custom dropdown
   instead: a themed button that toggles a .dd-menu-style list of rows. */
function mountCustomSelect(container, items, {value, onChange, getDesc, placeholder}={}){
  let current = value ?? (items[0] && items[0].value) ?? "";
  let menu=null;
  // The menu is portaled to <body> as position:fixed instead of living inside
  // .cs (which sits inside a scrolling .modal) — an absolutely-positioned
  // descendant of an overflow:auto ancestor gets clipped at that ancestor's
  // edge no matter how it's positioned, so it has to escape the DOM entirely.
  const setExpanded=v=>{ const b=container.querySelector(".cs-btn"); if(b) b.setAttribute("aria-expanded", v?"true":"false"); };
  const closeMenu=(returnFocus)=>{ if(menu){ menu.remove(); menu=null; } container.classList.remove("open"); setExpanded(false); if(returnFocus){ const b=container.querySelector(".cs-btn"); if(b) b.focus(); } };
  const selectRow=row=>{
    current=row.dataset.v; closeMenu(); render();
    if(onChange) onChange(current);
  };
  const focusRow=row=>{ if(row) row.focus(); };
  const openMenu=()=>{
    const btn=container.querySelector(".cs-btn");
    const r=btn.getBoundingClientRect();
    menu=el(`<div class="cs-menu cs-menu-portal" role="listbox">${items.map(it=>{
      const desc = getDesc ? getDesc(it.value) : "";
      const on=it.value===current;
      return `<div class="cs-row${on?" on":""}" role="option" tabindex="0" aria-selected="${on?"true":"false"}" data-v="${esc(it.value)}">
        <div class="cs-row-label">${esc(it.label)}</div>
        ${desc?`<div class="cs-row-desc">${esc(desc)}</div>`:""}
      </div>`;
    }).join("")}</div>`);
    document.body.appendChild(menu);
    menu.style.left=r.left+"px"; menu.style.width=r.width+"px";
    const spaceBelow=window.innerHeight-r.bottom-16, spaceAbove=r.top-16;
    if(spaceBelow<160 && spaceAbove>spaceBelow){
      menu.style.bottom=(window.innerHeight-r.top+6)+"px"; menu.style.maxHeight=Math.max(120,Math.min(260,spaceAbove))+"px";
    } else {
      menu.style.top=(r.bottom+6)+"px"; menu.style.maxHeight=Math.max(120,Math.min(260,spaceBelow))+"px";
    }
    container.classList.add("open");
    setExpanded(true);
    const rows=[...menu.querySelectorAll(".cs-row")];
    rows.forEach(row=>{
      row.onclick=(e)=>{ e.stopPropagation(); selectRow(row); };
      row.onkeydown=(e)=>{
        if(e.key==="ArrowDown"){ e.preventDefault(); focusRow(rows[Math.min(rows.length-1, rows.indexOf(row)+1)]); }
        else if(e.key==="ArrowUp"){ e.preventDefault(); focusRow(rows[Math.max(0, rows.indexOf(row)-1)]); }
        else if(e.key==="Enter"||e.key===" "){ e.preventDefault(); selectRow(row); }
        else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      };
    });
    focusRow(rows.find(r=>r.classList.contains("on")) || rows[0]);
  };
  const render=()=>{
    const sel = items.find(it=>it.value===current);
    container.innerHTML = `
      <button type="button" class="cs-btn" role="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="cs-btn-label">${sel?esc(sel.label):esc(placeholder||"")}</span>
        <svg class="cs-chevron" width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1L6 6L11 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`;
    const b=container.querySelector(".cs-btn");
    b.onclick=(e)=>{ e.stopPropagation(); if(menu){ closeMenu(); } else { closeAllDropdowns(); openMenu(); } };
    b.onkeydown=(e)=>{ if(!menu && (e.key==="ArrowDown"||e.key==="ArrowUp"||e.key==="Enter"||e.key===" ")){ e.preventDefault(); closeAllDropdowns(); openMenu(); } };
  };
  container.classList.add("cs");
  render();
  return {get value(){ return current; }, set value(v){ current=v; render(); }};
}
if(!window._csOutsideClickBound){
  window._csOutsideClickBound=true;
  document.addEventListener("click",()=>document.querySelectorAll(".cs-menu-portal").forEach(m=>m.remove()));
  document.addEventListener("click",()=>document.querySelectorAll(".cs.open").forEach(c=>c.classList.remove("open")));
}
// Multiple LoRAs, each with its own strength, chained in the order added —
// same as stacking several LoraLoader nodes in ComfyUI's own UI. Replaces the
// old single-LoRA dropdown + one shared strength slider.
function mountLoraMultiPicker(container, loraNames){
  const rows=[]; // {name, strength}
  const render=()=>{
    container.innerHTML=`<div class="lora-rows"></div>
      <button type="button" class="btn" id="loraAddBtn" ${loraNames.length?"":"disabled"}>+ ${esc(t("img_gen_lora_add"))}</button>`;
    const rowsEl=container.querySelector(".lora-rows");
    rows.forEach((row,i)=>{
      const rowEl=el(`<div class="lora-row">
        <div class="lora-row-sel"></div>
        <input type="range" class="lora-row-strength" min="-8" max="8" step="0.05" value="${row.strength}">
        <span class="hint lora-row-val">${row.strength}</span>
        <button type="button" class="tool danger">✕</button>
      </div>`);
      mountCustomSelect(rowEl.querySelector(".lora-row-sel"), loraNames.map(l=>({value:l,label:l})),
        {value:row.name, onChange:v=>{ row.name=v; }});
      rowEl.querySelector(".lora-row-strength").oninput=e=>{
        row.strength=parseFloat(e.target.value); rowEl.querySelector(".lora-row-val").textContent=e.target.value;
      };
      rowEl.querySelector("button.danger").onclick=()=>{ rows.splice(i,1); render(); };
      rowsEl.appendChild(rowEl);
    });
    const addBtn=container.querySelector("#loraAddBtn");
    if(addBtn) addBtn.onclick=()=>{ if(!loraNames.length) return; rows.push({name:loraNames[0], strength:1.0}); render(); };
  };
  render();
  return { getSelected:()=>rows.filter(r=>r.name).map(r=>({name:r.name, strength:r.strength})) };
}
// Shared upload glyph for every image-picker's empty/click-to-upload state.
const UPLOAD_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>`;
// Icon-only trash/edit glyphs for the admin Model/LoRA previews rows —
// same viewBox/stroke conventions as UPLOAD_ICON_SVG so all three sit flush together.
const TRASH_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const EDIT_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const ZOOM_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>`;
const SAVE_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const SPARKLE_ICON_SVG=`<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l1.8 5.9L20 10l-6.2 2.1L12 18l-1.8-5.9L4 10l6.2-2.1L12 2Z"/><path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/><path d="M5 15l.6 1.9L7.5 17.5 5.6 18.1 5 20l-.6-1.9-1.9-.6 1.9-.6L5 15Z"/></svg>`;
const REGEN_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>`;
const SHARE_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
const FLAG_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="3"/></svg>`;
const COPY_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const HISTORY_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>`;
const GALLERY_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const FILTER_ICON_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4 4 20 4 14 12 14 19 10 21 10 12 4 4"/></svg>`;

function _categoryFilterHTML(anchorId){
  return `<div class="ig-cat-filter" id="${anchorId}">
    <button type="button" class="tool ig-cat-filter-btn" title="${esc(t("ig_filter_category"))}" aria-label="${esc(t("ig_filter_category"))}">${FILTER_ICON_SVG}</button>
    <div class="ig-cat-filter-menu"></div>
  </div>`;
}
function _wireCategoryFilter(anchorId, categories, getCurrent, setCurrent, onChange){
  const wrap=$("#"+anchorId); if(!wrap) return;
  const btn=wrap.querySelector(".ig-cat-filter-btn"), menu=wrap.querySelector(".ig-cat-filter-menu");
  const renderMenu=()=>{
    const current=getCurrent();
    menu.innerHTML=`<button type="button" class="ig-cat-filter-opt${!current?" on":""}" data-c="">${esc(t("comm_mode_all"))}</button>`+
      categories.map(c=>`<button type="button" class="ig-cat-filter-opt${current===c?" on":""}" data-c="${c}">${esc(modelCategoryLabel(c))}</button>`).join("");
    menu.querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>{
      setCurrent(b.dataset.c);
      menu.classList.remove("show");
      onChange();
    });
  };
  btn.onclick=e=>{
    e.stopPropagation();
    const willShow=!menu.classList.contains("show");
    if(willShow) renderMenu();
    menu.classList.toggle("show", willShow);
  };
  document.addEventListener("click", e=>{ if(!wrap.contains(e.target)) menu.classList.remove("show"); });
}

function mountReferenceImagePicker(container){
  let dataUrl=null;
  container.innerHTML=`
    <div class="ig-ref-preview" id="igRefPreview" style="display:none;">
      <img id="igRefImg" alt="">
      <button type="button" class="tool danger img-pick-x" id="igRefClear" aria-label="${esc(t("img_gen_reference_remove"))}" title="${esc(t("img_gen_reference_remove"))}">✕</button>
    </div>
    <div class="img-pick-empty ig-ref-empty" id="igRefEmpty" title="${esc(t("img_gen_reference_pick"))}">${UPLOAD_ICON_SVG}</div>
    <input type="file" id="igRefFile" accept="image/*" hidden>
    <div class="field" id="igDenoiseRow" style="display:none;margin:10px 0 0;">
      <label>${esc(t("img_gen_denoise"))} <span class="hint" id="igDenoiseVal">0.6</span></label>
      <input type="range" id="igDenoise" min="0.1" max="1.0" step="0.05" value="0.6">
      <div class="hint" style="margin-top:4px;">${esc(t("img_gen_denoise_hint"))}</div>
    </div>`;
  const preview=container.querySelector("#igRefPreview"), emptyBox=container.querySelector("#igRefEmpty"),
        denoiseRow=container.querySelector("#igDenoiseRow");
  emptyBox.onclick=()=>container.querySelector("#igRefFile").click();
  const applyBlob=blob=>{
    const reader=new FileReader();
    reader.onload=()=>{
      dataUrl=reader.result;
      container.querySelector("#igRefImg").src=dataUrl;
      preview.style.display=""; emptyBox.style.display="none"; denoiseRow.style.display="";
    };
    reader.readAsDataURL(blob);
  };
  container.querySelector("#igRefFile").onchange=()=>{
    const f=container.querySelector("#igRefFile").files[0]; if(!f) return;
    const objectUrl=URL.createObjectURL(f);
    openCropper(objectUrl, 1, 768, 768, blob=>{ applyBlob(blob); container.querySelector("#igRefFile").value=""; });
  };
  container.querySelector("#igRefClear").onclick=()=>{
    dataUrl=null; preview.style.display="none"; emptyBox.style.display=""; denoiseRow.style.display="none";
    container.querySelector("#igRefFile").value="";
  };
  container.querySelector("#igDenoise").oninput=e=>{ container.querySelector("#igDenoiseVal").textContent=e.target.value; };
  return {
    getDataUrl:()=>dataUrl,
    getDenoise:()=>parseFloat(container.querySelector("#igDenoise").value)||0.6,
  };
}
// Model picker as a thumbnail grid (pix.ai-style): a selected-model summary card
// on top, then a grid of selectable checkpoints collapsed to an initial count with
// a "Show more" toggle. ComfyUI exposes no per-checkpoint thumbnail, so each tile
// uses a letter-avatar fallback like the character cards' .ava.mono.
// Model picker: a selected-model summary card, then every checkpoint always
// rendered as a small chip in a horizontally-scrolling strip — no
// collapse/hide state and no vertical growth as the list gets longer (unlike
// a wrapping grid), so the panel's height stays flat regardless of how many
// checkpoints are installed. All items are reachable by scrolling the strip
// sideways, never by a "show more" click.
// Model picker, Pixiv-style: a 2×3 grid of the first 6 checkpoints, each tile
// a large square thumbnail (the admin-curated preview image, or a big
// letter-avatar fallback when none is set) with the name below — the image
// is the dominant visual element, not a sliver next to text — plus a
// "Show more models" toggle revealing the rest. Collapsed by default so the
// panel stays compact enough to fit without page-level scroll even with
// many installed checkpoints.
function _igModelBigThumb(name, previews){
  const img=modelImage(name, previews);
  const label=modelLabel(name, previews);
  // Same admin-defined arch badge as the admin previews-management panel
  // (modelType() already prefers the structured category over free text).
  // A LoRA can be tagged compatible with more than one architecture.
  const cats=modelCategories(name,previews);
  const archBadge=cats.length?`<span class="ig-model-thumb-arch-row">${cats.map(c=>`<span class="ig-model-thumb-arch">${esc(modelCategoryLabel(c))}</span>`).join("")}</span>`:"";
  // A plain <img> instead of a CSS background-image — Chromium's downscale
  // filtering for background-image is visibly worse than for a real <img>
  // element at these small tile sizes (confirmed: identical source image,
  // clearly softer/blurrier as a background-image than as an <img>), even
  // though both are asked to shrink the same ~1024px source down to ~40-
  // 100px. <img> goes through the browser's image decoder's own resampling
  // instead of a CSS paint-time scale, which holds up much better here.
  return img ? `<span class="ig-model-thumb"><img src="${esc(mediaURL(img))}" alt="" loading="lazy">${archBadge}</span>`
             : `<span class="ig-model-thumb ava mono">${esc((label||"?")[0].toUpperCase())}${archBadge}</span>`;
}
// Per-browser usage counter (see recordCheckpointUsage) — how many times each
// checkpoint has actually been generated with, used to rank the compact
// first-look grid by what's actually commonly picked, not alphabetical order.
function _checkpointUsageCounts(){
  try{ return JSON.parse(localStorage.getItem("ig_checkpoint_usage")||"{}"); }catch(e){ return {}; }
}
function recordCheckpointUsage(name){
  if(!name) return;
  const counts=_checkpointUsageCounts();
  counts[name]=(counts[name]||0)+1;
  try{ localStorage.setItem("ig_checkpoint_usage", JSON.stringify(counts)); }catch(e){}
}
// Same per-browser most-used-first ranking as checkpoints, generalized to any
// other picker (LoRAs, samplers, schedulers) via its own localStorage key.
function _pickerUsageCounts(key){
  try{ return JSON.parse(localStorage.getItem(key)||"{}"); }catch(e){ return {}; }
}
function _recordPickerUsage(key, name){
  if(!name) return;
  const counts=_pickerUsageCounts(key);
  counts[name]=(counts[name]||0)+1;
  try{ localStorage.setItem(key, JSON.stringify(counts)); }catch(e){}
}
function mountModelGrid(container, checkpoints, {value, previews, onChange}={}){
  previews=previews||{};
  let current=value || checkpoints[0] || "";
  const INITIAL=6;
  const tile=name=>{
    return `<button type="button" class="ig-grid-tile ig-model-tile${name===current?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
      ${_igModelBigThumb(name,previews)}
      <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
    </button>`;
  };
  const render=()=>{
    const mtype=modelType(current,previews);
    const desc=modelDesc(current,previews);
    // The compact first-look grid ranks by actual usage (most-generated-with
    // first), not alphabetical order, so it surfaces what this browser
    // commonly picks rather than whatever ComfyUI happens to list first —
    // the rest is still there via "Show more". The selected model always
    // leads regardless of its own usage count, so picking something new
    // never makes it vanish from view here.
    const hideLegacy=localStorage.getItem("ig_mp_hide_legacy")==="1";
    const pool=hideLegacy?checkpoints.filter(n=>!hasOnlyLegacyCategories(n,previews)):checkpoints;
    const counts=_checkpointUsageCounts();
    const byUsage=[...pool].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
    const ordered=current&&byUsage.includes(current) ? [current, ...byUsage.filter(n=>n!==current)] : byUsage;
    const shown=ordered.slice(0,INITIAL);
    container.innerHTML=`
      <div class="ig-model-summary">
        ${_igModelBigThumb(current,previews)}
        <div class="ig-model-summary-txt"><b>${esc(modelLabel(current,previews)||"—")}</b>${mtype?`<span>${esc(mtype)}</span>`:""}${desc?`<span>${esc(desc)}</span>`:""}</div>
      </div>
      <label class="ig-mp-hide-legacy"><input type="checkbox" id="ig_mg_hide_legacy" ${hideLegacy?"checked":""}> ${esc(t("ig_mp_hide_legacy"))}</label>
      <div class="ig-grid ig-model-grid">${shown.map(tile).join("")}</div>
      <button type="button" class="ig-show-more" data-act="more">${esc(t("ig_show_more_models"))}</button>`;
    container.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ current=b.dataset.v; render(); if(onChange) onChange(current); });
    const hideLegacyBox=container.querySelector("#ig_mg_hide_legacy");
    if(hideLegacyBox) hideLegacyBox.onchange=e=>{
      localStorage.setItem("ig_mp_hide_legacy", e.target.checked?"1":"");
      render();
    };
    const more=container.querySelector("[data-act='more']");
    if(more) more.onclick=async()=>{
      previews=(await refreshImagegenOptions()).previews;
      openModelPickerModal(checkpoints, previews, current, v=>{ current=v; render(); if(onChange) onChange(current); });
    };
  };
  render();
  return { get value(){ return current; } };
}
// Full model-picker modal (pix.ai "Preset" tab equivalent, no marketplace/
// bookmark/usage-count features since this app is self-hosted with neither) —
// search box + a scrollable grid of every installed checkpoint, and a detail
// panel (right column on desktop, stacked below on mobile) with a bigger
// preview + "Use this model" button that selects it and closes the modal.
let _modelRequestHosts=["huggingface.co","civitai.red"];   // safe default until /api/settings responds
async function _loadModelRequestHosts(){
  const st=await api("/api/settings").catch(()=>null);
  if(st && Array.isArray(st.model_request_hosts) && st.model_request_hosts.length)
    _modelRequestHosts=st.model_request_hosts.map(h=>typeof h==="string"?h:h.host);
  return _modelRequestHosts;
}
// Admin-configurable allowlist for auto-embedding a comment/thread link as an
// inline image/gif preview — client-side only (see renderCommentNode), never
// fetched by the server. Safe defaults until /api/settings responds.
let _embedLinkHosts=["tenor.com","media.tenor.com","giphy.com","media.giphy.com",
  "media.discordapp.net","cdn.discordapp.com","imgur.com","i.imgur.com"];
async function _loadEmbedLinkHosts(){
  const st=await api("/api/settings").catch(()=>null);
  if(st && Array.isArray(st.embed_link_hosts)) _embedLinkHosts=st.embed_link_hosts;
  return _embedLinkHosts;
}
// Custom emoji/stickers — any signed-in user can upload one (see
// routers/emojis.py); this cache is refreshed after every upload/delete so
// a shortcode typed moments after being created still resolves.
let _customEmojis=[];
async function _loadCustomEmojis(){
  _customEmojis=await api("/api/emojis").catch(()=>[]);
  return _customEmojis;
}
function _customEmojiByShortcode(code){
  return _customEmojis.find(e=>e.shortcode===code);
}
function _modelRequestHostAllowed(url){
  let host;
  try{ host=new URL(url).hostname.toLowerCase(); }catch(e){ return false; }
  return _modelRequestHosts.some(h=>{ h=h.toLowerCase().replace(/^\.+/,""); return host===h || host.endsWith("."+h); });
}
const MODEL_CATEGORY_TABS=["anima","sdxl","il","pony"];
function openModelPickerModal(checkpoints, previews, current, onSelect){
  let tab="models";
  let query="";
  const storedCategory=localStorage.getItem("ig_mp_category");
  let category=(storedCategory==="" || MODEL_CATEGORY_TABS.includes(storedCategory)) ? storedCategory
    : (modelCategory(current,previews)||"sdxl");
  let hideLegacy=localStorage.getItem("ig_mp_hide_legacy")==="1";
  let picked=current;
  const tabsHTML=`<div class="seg lib-tabs ig-mp-tabs" id="mpTabs">
    <button type="button" class="seg-btn ${tab==="models"?"on":""}" data-t="models"><b>${esc(t("ig_mp_tab_models"))}</b></button>
    <button type="button" class="seg-btn ${tab==="request"?"on":""}" data-t="request"><b>${esc(t("ig_mp_tab_request"))}</b></button>
  </div>`;
  const renderGrid=()=>{
    const q=query.trim().toLowerCase();
    let list=q?checkpoints.filter(n=>n.toLowerCase().includes(q)||modelLabel(n,previews).toLowerCase().includes(q)):checkpoints;
    if(category) list=list.filter(n=>modelHasCategory(n,previews,category));
    if(hideLegacy) list=list.filter(n=>!hasOnlyLegacyCategories(n,previews));
    if(picked && list.includes(picked)) list=[picked, ...list.filter(n=>n!==picked)];
    const grid=$("#mpGrid"); if(!grid) return;
    grid.innerHTML=list.length?list.map(name=>`
      <button type="button" class="ig-grid-tile ig-model-tile${name===picked?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
        ${_igModelBigThumb(name,previews)}
        <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
      </button>`).join("") : `<div class="hint">${esc(t("ig_model_search_empty"))}</div>`;
    grid.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ picked=b.dataset.v; renderGrid(); renderDetail(); });
  };
  const renderDetail=()=>{
    const d=$("#mpDetail"); if(!d) return;
    const mtype=modelType(picked,previews);
    const desc=modelDesc(picked,previews);
    d.innerHTML=picked?`
      <div class="ig-mp-detail-thumb">${_igModelBigThumb(picked,previews)}</div>
      <div class="ig-mp-detail-name">${esc(modelLabel(picked,previews))}</div>
      ${mtype?`<div class="ig-mp-detail-desc">${esc(mtype)}</div>`:""}
      ${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}
      <button type="button" class="btn primary" id="mpUse">${esc(t("ig_use_this_model"))}</button>`
      : `<div class="hint">${esc(t("ig_model_pick_hint"))}</div>`;
    const useBtn=$("#mpUse");
    if(useBtn) useBtn.onclick=()=>{ onSelect(picked); closeModal(); };
  };
  // A function, not a plain string — it has to recompute from the current
  // category/hideLegacy each time renderBody() re-injects it, or toggling
  // "Hide legacy" just re-inserts the same frozen initial-render markup
  // (stale checkbox state, tabs that never actually filter).
  const modelsTabHTML=()=>`
    <div class="ig-mp-search-row">
      <input type="text" id="mpSearch" class="ig-mp-search" placeholder="${esc(t("ig_model_search_ph"))}">
      ${_categoryFilterHTML("mpCategoryTabs")}
    </div>
    <label class="ig-mp-hide-legacy"><input type="checkbox" id="mpHideLegacy" ${hideLegacy?"checked":""}> ${esc(t("ig_mp_hide_legacy"))}</label>
    <div class="ig-mp-body">
      <div class="ig-grid ig-model-grid ig-mp-grid" id="mpGrid"></div>
      <div class="ig-mp-detail" id="mpDetail"></div>
    </div>`;
  let mrType="checkpoint";
  const requestTabHTML=`
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_mp_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    <p class="hint" style="margin:0 0 14px;">${esc(t("ig_mp_find_checkpoint_hint"))}</p>
    <div class="field"><label>${esc(t("ig_mp_request_type"))}</label>
      <div class="seg" id="mrTypeSeg">
        <button type="button" class="seg-btn ${mrType==="checkpoint"?"on":""}" data-type="checkpoint">${esc(t("ig_mp_request_type_checkpoint"))}</button>
        <button type="button" class="seg-btn ${mrType==="anima"?"on":""}" data-type="anima">${esc(t("ig_mp_request_type_anima"))}</button>
      </div></div>
    <div class="field"><label>${esc(t("ig_mp_request_name"))}</label>
      <input type="text" id="mrName" placeholder="${esc(t("ig_mp_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="mrUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="mrUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    <div id="mrAnimaFields" style="${mrType==="anima"?"":"display:none;"}">
      <div class="field"><label>${esc(t("ig_mp_request_vae_url"))}</label>
        <input type="text" id="mrVaeUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_vae_url_hint"))}</div></div>
      <div class="field"><label>${esc(t("ig_mp_request_encoder_url"))}</label>
        <input type="text" id="mrEncoderUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_encoder_url_hint"))}</div></div>
    </div>
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="mrNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="mrSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="mrHistory" class="ig-mr-history"></div>`;
  const loadHistory=async()=>{
    const el=$("#mrHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=await api("/api/imagegen/model-requests").catch(()=>[]);
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_mp_request_history_empty"))}</div>`;
  };
  const renderBody=()=>{
    $("#mpBody").innerHTML=tab==="models"?modelsTabHTML():requestTabHTML;
    if(tab==="models"){
      $("#mpSearch").oninput=e=>{ query=e.target.value; renderGrid(); };
      _wireCategoryFilter("mpCategoryTabs",
        hideLegacy?MODEL_CATEGORY_TABS.filter(c=>!isLegacyModelCategory(c)):MODEL_CATEGORY_TABS,
        ()=>category, c=>{ category=c; localStorage.setItem("ig_mp_category",category); }, renderGrid);
      $("#mpHideLegacy").onchange=e=>{
        hideLegacy=e.target.checked;
        localStorage.setItem("ig_mp_hide_legacy", hideLegacy?"1":"");
        // Hiding legacy models should hide their category options too — a
        // legacy-only option (SDXL/IL/Pony) would otherwise sit there
        // leading to an empty grid once its models are filtered out below.
        if(hideLegacy && isLegacyModelCategory(category)){
          category="";
          localStorage.setItem("ig_mp_category",category);
        }
        renderBody();
      };
      renderGrid(); renderDetail();
    } else {
      const urlInp=$("#mrUrl"), errEl=$("#mrUrlErr");
      $("#mrTypeSeg").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
        mrType=b.dataset.type;
        $("#mrTypeSeg").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
        $("#mrAnimaFields").style.display=mrType==="anima"?"":"none";
        if(mrType!=="anima"){ $("#mrVaeUrl").value=""; $("#mrEncoderUrl").value=""; }
      });
      const validate=()=>{
        const url=urlInp.value.trim();
        if(!url){ errEl.style.display="none"; return true; }
        if(!/^https?:\/\/.+/i.test(url)){
          errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
          errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
        const allowed=_modelRequestHostAllowed(url);
        errEl.style.display=allowed?"none":"";
        errEl.style.color="var(--warn,#e0a800)";
        errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
        return true;
      };
      urlInp.oninput=validate;
      $("#mrSubmit").onclick=async()=>{
        const model_name=$("#mrName").value.trim();
        const source_url=urlInp.value.trim();
        const note=$("#mrNote").value.trim();
        if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
        if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
        const body={model_name, source_url, note, request_type:mrType};
        if(mrType==="anima"){
          const vae_url=$("#mrVaeUrl").value.trim();
          const text_encoder_url=$("#mrEncoderUrl").value.trim();
          if(vae_url) body.vae_url=vae_url;
          if(text_encoder_url) body.text_encoder_url=text_encoder_url;
        }
        try{
          await api("/api/imagegen/model-requests", j("POST",body));
          toast(t("ig_mp_request_submitted"));
          $("#mrName").value=""; $("#mrUrl").value=""; $("#mrNote").value="";
          if($("#mrVaeUrl")) $("#mrVaeUrl").value="";
          if($("#mrEncoderUrl")) $("#mrEncoderUrl").value="";
          loadHistory();
        }catch(e){ errorToast(e.message); }
      };
      loadHistory();
    }
  };
  openModal(`
    <button class="modal-close" id="mpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_model_picker_title"))}</h3>
    ${tabsHTML}
    <div id="mpBody"></div>`, "modal-wide", {stack:true});
  $("#mpClose").onclick=closeModal;
  $("#mpTabs").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.t;
    $("#mpTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x===b));
    renderBody();
  });
  renderBody();
  _loadModelRequestHosts().then(()=>{ if(tab==="request") renderBody(); });
}
// LoRA picker: same 2×3-grid + "Show more" pattern as the model picker
// above; tiles show the admin-curated preview image when one is set (same
// {name: {image, display_name, description}} map as checkpoints), else the
// letter-avatar fallback. A selected LoRA reveals an inline strength slider
// beneath its tile. Multiple LoRAs stack, same chain semantics as before.
function mountLoraGrid(container, loraNames, {previews, value}={}){
  previews=previews||{};
  const selected=new Map(); // name -> strength
  (value||[]).forEach(l=>{ if(l&&l.name&&loraNames.includes(l.name)) selected.set(l.name, l.strength??1.0); });
  const INITIAL=6;
  const render=()=>{
    // Same most-used-first ranking as the checkpoint grid — selected LoRAs
    // always stay visible regardless of their own usage count, so toggling
    // one on never makes it disappear from view here.
    const counts=_pickerUsageCounts("ig_lora_usage");
    const byUsage=[...loraNames].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
    const ordered=[...selected.keys(), ...byUsage.filter(n=>!selected.has(n))];
    const shown=ordered.slice(0,INITIAL);
    // One full-width summary card per selected LoRA, stacked below the whole
    // grid (not squeezed into each tile's own narrow column, which read as
    // unreadable at one-third the panel's width) — same yellow/olive
    // thumb+bold-name+type+desc structure as the checkpoint picker's single
    // summary header, just one per selection here since LoRAs multi-select.
    const summaryFor=name=>{
      const cats=modelCategories(name,previews);
      const mtype=cats.length?"":modelType(name,previews);
      const desc=modelDesc(name,previews), kws=modelKeywords(name,previews);
      return `<div class="ig-model-summary ig-lora-summary">
        ${_igModelBigThumb(name,previews)}
        <div class="ig-model-summary-txt">
          <b>${esc(modelLabel(name,previews))}</b>
          <div class="ig-lora-strength"><span class="hint">${esc(t("ig_strength"))}</span><span class="ig-lora-val-pill"><span class="ig-lora-val">${selected.get(name)}</span></span>
            <input type="range" min="-8" max="8" step="0.05" value="${selected.get(name)}" data-s="${esc(name)}"></div>
          ${cats.length?`<span class="ig-model-summary-arch-row">${cats.map(c=>`<span class="ig-model-thumb-arch">${esc(modelCategoryLabel(c))}</span>`).join("")}</span>`:""}
          ${mtype?`<span>${esc(mtype)}</span>`:""}
          ${desc?`<span class="ig-lora-summary-desc">${esc(desc)}</span>`:""}
          ${kws.length?`<div class="ig-lora-summary-tags">${kws.map(k=>`<span class="tag">${esc(k)}</span>`).join("")}</div>`:""}
        </div>
      </div>`;
    };
    container.innerHTML=`
      ${selected.size?`<div class="ig-lora-summaries">${[...selected.keys()].map(summaryFor).join("")}</div>`:""}
      <div class="ig-grid">${shown.map(name=>{
        const on=selected.has(name);
        return `<div class="ig-lora-tile-wrap">
          <button type="button" class="ig-grid-tile${on?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
            ${_igModelBigThumb(name,previews)}
            <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
          </button>
        </div>`;
      }).join("")}</div>
      <button type="button" class="ig-show-more" data-act="more">${esc(t("ig_show_more_loras"))}</button>`;
    container.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{
      const n=b.dataset.v;
      if(selected.has(n)) selected.delete(n); else selected.set(n, 1.0);
      render();
    });
    container.querySelectorAll("input[type='range'][data-s]").forEach(inp=>inp.oninput=e=>{
      const n=e.target.dataset.s; selected.set(n, parseFloat(e.target.value));
      const v=e.target.closest(".ig-lora-strength").querySelector(".ig-lora-val");
      if(v) v.textContent=e.target.value;
    });
    const more=container.querySelector("[data-act='more']");
    if(more) more.onclick=async()=>{
      previews=(await refreshImagegenOptions()).loraPreviews;
      openLoraPickerModal(loraNames, previews, selected, render);
    };
  };
  render();
  return { getSelected:()=>[...selected.entries()].map(([name,strength])=>({name,strength})) };
}
// Full LoRA-picker modal — same layout as openModelPickerModal, but LoRAs are
// multi-select (a story can stack several) so tiles toggle into the shared
// `selected` Map with a per-LoRA strength slider (default 1.0) instead of a
// single-choice "Use this model" detail panel. The Request tab posts to the
// same model_requests backend with request_type="lora".
function openLoraPickerModal(loraNames, previews, selected, onChange){
  let tab="loras";
  let query="";
  const storedCategory=localStorage.getItem("ig_lp_category");
  let category=(storedCategory==="" || MODEL_CATEGORY_TABS.includes(storedCategory)) ? storedCategory : "sdxl";
  let hideLegacy=localStorage.getItem("ig_mp_hide_legacy")==="1";
  // Purely informational (unlike the checkpoint picker's detail panel,
  // there's no separate "Use this" confirm step here — clicking a tile
  // already toggles it on/off directly) — just shows whichever LoRA was
  // last clicked, since the empty space next to the grid otherwise showed
  // nothing at all.
  let focused=null;
  const tabsHTML=`<div class="seg lib-tabs ig-mp-tabs" id="lpTabs">
    <button type="button" class="seg-btn ${tab==="loras"?"on":""}" data-t="loras"><b>${esc(t("ig_lora_section"))}</b></button>
    <button type="button" class="seg-btn ${tab==="request"?"on":""}" data-t="request"><b>${esc(t("ig_mp_tab_request"))}</b></button>
  </div>`;
  const renderDetail=()=>{
    const d=$("#lpDetail"); if(!d) return;
    const cats=focused?modelCategories(focused,previews):[];
    const mtype=focused&&!cats.length?modelType(focused,previews):"";
    const desc=focused?modelDesc(focused,previews):"";
    const kws=focused?modelKeywords(focused,previews):[];
    const strength=focused&&selected.has(focused)?selected.get(focused):null;
    d.innerHTML=focused?`
      <div class="ig-mp-detail-thumb">${_igModelBigThumb(focused,previews)}</div>
      <div class="ig-mp-detail-name">${esc(modelLabel(focused,previews))}</div>
      ${strength!=null?`<div class="ig-lora-strength"><span class="hint">${esc(t("ig_strength"))}</span><span class="ig-lora-val-pill"><span class="ig-lora-val">${strength}</span></span>
        <input type="range" min="-8" max="8" step="0.05" value="${strength}" data-s="${esc(focused)}"></div>`:""}
      ${cats.length?`<span class="ig-model-summary-arch-row">${cats.map(c=>`<span class="ig-model-thumb-arch">${esc(modelCategoryLabel(c))}</span>`).join("")}</span>`:""}
      ${mtype?`<div class="ig-mp-detail-desc">${esc(mtype)}</div>`:""}
      ${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}
      ${kws.length?`<div class="ig-lora-summary-tags">${kws.map(k=>`<span class="tag">${esc(k)}</span>`).join("")}</div>`:""}`
      : `<div class="hint">${esc(t("ig_model_pick_hint"))}</div>`;
    const inp=d.querySelector("input[type='range'][data-s]");
    if(inp) inp.oninput=e=>{
      selected.set(focused, parseFloat(e.target.value));
      const v=d.querySelector(".ig-lora-val"); if(v) v.textContent=e.target.value;
      renderGrid(); if(onChange) onChange();
    };
  };
  const renderGrid=()=>{
    const q=query.trim().toLowerCase();
    let list=q?loraNames.filter(n=>n.toLowerCase().includes(q)||modelLabel(n,previews).toLowerCase().includes(q)):loraNames;
    if(category) list=list.filter(n=>!modelCategories(n,previews).length||modelHasCategory(n,previews,category));
    if(hideLegacy) list=list.filter(n=>!hasOnlyLegacyCategories(n,previews));
    const grid=$("#lpGrid"); if(!grid) return;
    grid.innerHTML=list.length?list.map(name=>{
      const on=selected.has(name);
      return `<div class="ig-lora-tile-wrap">
        <button type="button" class="ig-grid-tile${on?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
          ${_igModelBigThumb(name,previews)}
          <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
        </button>
      </div>`;
    }).join("") : `<div class="hint">${esc(t("ig_lora_search_empty"))}</div>`;
    grid.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{
      const n=b.dataset.v;
      if(selected.has(n)) selected.delete(n); else selected.set(n, 1.0);
      focused=n; renderGrid(); renderDetail(); if(onChange) onChange();
    });
  };
  // A function, not a plain string — see the matching comment on
  // openModelPickerModal's modelsTabHTML for why.
  const lorasTabHTML=()=>`
    <div class="ig-mp-search-row">
      <input type="text" id="lpSearch" class="ig-mp-search" placeholder="${esc(t("ig_lora_search_ph"))}">
      ${_categoryFilterHTML("lpCategoryTabs")}
    </div>
    <label class="ig-mp-hide-legacy"><input type="checkbox" id="lpHideLegacy" ${hideLegacy?"checked":""}> ${esc(t("ig_mp_hide_legacy"))}</label>
    <div class="ig-mp-body">
      <div class="ig-grid ig-model-grid ig-mp-grid" id="lpGrid"></div>
      <div class="ig-mp-detail" id="lpDetail"></div>
    </div>
    <div class="actions" style="margin-top:14px;"><button type="button" class="btn primary" id="lpDone">${esc(t("ig_lora_done"))}</button></div>`;
  const requestTabHTML=`
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_lora_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    <div class="field"><label>${esc(t("ig_lora_request_name"))}</label>
      <input type="text" id="lrName" placeholder="${esc(t("ig_lora_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="lrUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="lrUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="lrNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="lrSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="lrHistory" class="ig-mr-history"></div>`;
  const loadHistory=async()=>{
    const el=$("#lrHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=(await api("/api/imagegen/model-requests").catch(()=>[])).filter(r=>r.request_type==="lora");
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_lora_request_history_empty"))}</div>`;
  };
  const renderBody=()=>{
    $("#lpBody").innerHTML=tab==="loras"?lorasTabHTML():requestTabHTML;
    if(tab==="loras"){
      $("#lpSearch").oninput=e=>{ query=e.target.value; renderGrid(); };
      $("#lpDone").onclick=closeModal;
      _wireCategoryFilter("lpCategoryTabs",
        hideLegacy?MODEL_CATEGORY_TABS.filter(c=>!isLegacyModelCategory(c)):MODEL_CATEGORY_TABS,
        ()=>category, c=>{ category=c; localStorage.setItem("ig_lp_category",category); }, renderGrid);
      $("#lpHideLegacy").onchange=e=>{
        hideLegacy=e.target.checked;
        localStorage.setItem("ig_mp_hide_legacy", hideLegacy?"1":"");
        if(hideLegacy && isLegacyModelCategory(category)){
          category="";
          localStorage.setItem("ig_lp_category",category);
        }
        renderBody();
      };
      renderGrid(); renderDetail();
    } else {
      const urlInp=$("#lrUrl"), errEl=$("#lrUrlErr");
      const validate=()=>{
        const url=urlInp.value.trim();
        if(!url){ errEl.style.display="none"; return true; }
        if(!/^https?:\/\/.+/i.test(url)){
          errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
          errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
        const allowed=_modelRequestHostAllowed(url);
        errEl.style.display=allowed?"none":"";
        errEl.style.color="var(--warn,#e0a800)";
        errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
        return true;
      };
      urlInp.oninput=validate;
      $("#lrSubmit").onclick=async()=>{
        const model_name=$("#lrName").value.trim();
        const source_url=urlInp.value.trim();
        const note=$("#lrNote").value.trim();
        if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
        if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
        try{
          await api("/api/imagegen/model-requests", j("POST",{model_name, source_url, note, request_type:"lora"}));
          toast(t("ig_mp_request_submitted"));
          $("#lrName").value=""; $("#lrUrl").value=""; $("#lrNote").value="";
          loadHistory();
        }catch(e){ errorToast(e.message); }
      };
      loadHistory();
    }
  };
  openModal(`
    <button class="modal-close" id="lpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_lora_picker_title"))}</h3>
    ${tabsHTML}
    <div id="lpBody"></div>`, "modal-wide", {stack:true});
  $("#lpClose").onclick=closeModal;
  $("#lpTabs").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    tab=b.dataset.t;
    $("#lpTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x===b));
    renderBody();
  });
  renderBody();
  _loadModelRequestHosts().then(()=>{ if(tab==="request") renderBody(); });
}
// Compact button that shows the current checkpoint's friendly name and opens
// the full model-picker modal — replaces the old native-style dropdown in the
// secondary generate/pick modals (openImageGenModal, openImageGenPickerModal).
function mountCheckpointButton(container, checkpoints, {value, previews, onChange}={}){
  previews=previews||{};
  let current=value || checkpoints[0] || "";
  const render=()=>{
    container.innerHTML=`<button type="button" class="ig-picker-btn">
      ${_igModelBigThumb(current,previews)}
      <span class="ig-picker-btn-label">${current?esc(modelLabel(current,previews)):esc(t("ig_show_models_btn"))}</span>
    </button>`;
    container.querySelector(".ig-picker-btn").onclick=async()=>{
      previews=(await refreshImagegenOptions()).previews;
      openModelPickerModal(checkpoints, previews, current, v=>{ current=v; render(); if(onChange) onChange(v); });
    };
  };
  render();
  return { get value(){ return current; } };
}
// Compact button that shows the currently-selected LoRAs and opens the full
// LoRA-picker modal — replaces mountLoraMultiPicker's native-style dropdowns.
function mountLoraButton(container, loraNames, {previews, value}={}){
  previews=previews||{};
  const selected=new Map();
  (value||[]).forEach(l=>{ if(l&&l.name&&loraNames.includes(l.name)) selected.set(l.name, l.strength??1.0); });
  const render=()=>{
    const names=[...selected.keys()].map(n=>modelLabel(n,previews));
    container.innerHTML=`<button type="button" class="ig-picker-btn">
      <span class="ig-picker-btn-label">${names.length?esc(names.join(", ")):esc(t("ig_show_loras_btn"))}</span>
    </button>`;
    container.querySelector(".ig-picker-btn").onclick=async()=>{
      previews=(await refreshImagegenOptions()).loraPreviews;
      openLoraPickerModal(loraNames, previews, selected, render);
    };
  };
  render();
  return { getSelected:()=>[...selected.entries()].map(([name,strength])=>({name,strength})) };
}
// Upscaler request modal — no installed-upscalers grid exists in this app
// yet, so unlike openModelPickerModal/openLoraPickerModal this is just the
// request form + history, same backend endpoint with request_type="upscaler".
function openUpscalerRequestModal(){
  const loadHistory=async()=>{
    const el=$("#urHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=(await api("/api/imagegen/model-requests").catch(()=>[])).filter(r=>r.request_type==="upscaler");
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_mp_request_history_empty"))}</div>`;
  };
  openModal(`
    <button class="modal-close" id="urClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("ig_upscaler_request_title"))}</h3>
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_upscaler_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    <p class="hint" style="margin:0 0 14px;">${esc(t("ig_mp_find_upscaler_hint"))}</p>
    <div class="field"><label>${esc(t("ig_mp_request_name"))}</label>
      <input type="text" id="urName" placeholder="${esc(t("ig_mp_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="urUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="urUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="urNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="urSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="urHistory" class="ig-mr-history"></div>`, "modal-wide", {stack:true});
  $("#urClose").onclick=closeModal;
  const urlInp=$("#urUrl"), errEl=$("#urUrlErr");
  const validate=()=>{
    const url=urlInp.value.trim();
    if(!url){ errEl.style.display="none"; return true; }
    if(!/^https?:\/\/.+/i.test(url)){
      errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
      errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
    const allowed=_modelRequestHostAllowed(url);
    errEl.style.display=allowed?"none":"";
    errEl.style.color="var(--warn,#e0a800)";
    errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
    return true;
  };
  urlInp.oninput=validate;
  $("#urSubmit").onclick=async()=>{
    const model_name=$("#urName").value.trim();
    const source_url=urlInp.value.trim();
    const note=$("#urNote").value.trim();
    if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
    if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
    try{
      await api("/api/imagegen/model-requests", j("POST",{model_name, source_url, note, request_type:"upscaler"}));
      toast(t("ig_mp_request_submitted"));
      $("#urName").value=""; urlInp.value=""; $("#urNote").value="";
      loadHistory();
    }catch(e){ errorToast(e.message); }
  };
  loadHistory();
  _loadModelRequestHosts().then(()=>{
    const hint=$("#urClose")?.closest(".modal")?.querySelector(".hint");
    if(hint) hint.textContent=t("ig_upscaler_request_hint").replace("{hosts}", _modelRequestHosts.join(", "));
  });
}
// Same standalone request-form pattern as openUpscalerRequestModal — no
// "Models"/"Request" tab toggle, no browse-existing grid, since opening this
// specifically to *add* a new one means the admin already knows it's not
// installed yet; making them click past a grid of what's already there first
// was pointless friction. kind is "checkpoint" (shows the checkpoint/Anima
// type toggle + Anima's extra VAE/text-encoder URL fields) or "lora" (fixed
// type, no toggle, no extra fields).
function openModelRequestModal(kind){
  let mrType="checkpoint";
  const isLora=kind==="lora";
  const loadHistory=async()=>{
    const el=$("#mraHistory"); if(!el) return;
    el.innerHTML=`<div class="hint">${esc(t("loading"))}</div>`;
    const rows=(await api("/api/imagegen/model-requests").catch(()=>[]))
      .filter(r=>isLora ? r.request_type==="lora" : (r.request_type==="checkpoint"||r.request_type==="anima"));
    el.innerHTML=rows.length?rows.map(r=>`
      <div class="ig-mr-row">
        <div class="ig-mr-row-main"><b>${esc(r.model_name)}</b><span class="ig-mr-status ig-mr-status-${esc(r.status)}">${esc(r.status)}</span></div>
        <div class="ig-mr-row-url mono">${esc(r.source_url)}</div>
      </div>`).join("") : `<div class="hint">${esc(t("ig_mp_request_history_empty"))}</div>`;
  };
  openModal(`
    <button class="modal-close" id="mraClose">${esc(t("btn_close"))}</button>
    <h3>${isLora?"Request a LoRA":"Request a model"}</h3>
    <p class="hint" style="margin:4px 0 14px;">${esc(t("ig_mp_request_hint")).replace("{hosts}", _modelRequestHosts.join(", "))}</p>
    ${isLora?"":`<p class="hint" style="margin:0 0 14px;">${esc(t("ig_mp_find_checkpoint_hint"))}</p>
    <div class="field"><label>${esc(t("ig_mp_request_type"))}</label>
      <div class="seg" id="mraTypeSeg">
        <button type="button" class="seg-btn on" data-type="checkpoint">${esc(t("ig_mp_request_type_checkpoint"))}</button>
        <button type="button" class="seg-btn" data-type="anima">${esc(t("ig_mp_request_type_anima"))}</button>
      </div></div>`}
    <div class="field"><label>${esc(t("ig_mp_request_name"))}</label>
      <input type="text" id="mraName" placeholder="${esc(t("ig_mp_request_name_ph"))}"></div>
    <div class="field"><label>${esc(t("ig_mp_request_url"))}</label>
      <input type="text" id="mraUrl" placeholder="https://civitai.com/api/download/models/…">
      <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_url_hint"))}</div>
      <div class="hint" id="mraUrlErr" style="color:var(--danger,#e05d5d);display:none;"></div></div>
    ${isLora?"":`<div id="mraAnimaFields" style="display:none;">
      <div class="field"><label>${esc(t("ig_mp_request_vae_url"))}</label>
        <input type="text" id="mraVaeUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_vae_url_hint"))}</div></div>
      <div class="field"><label>${esc(t("ig_mp_request_encoder_url"))}</label>
        <input type="text" id="mraEncoderUrl" placeholder="https://civitai.com/api/download/models/…">
        <div class="hint" style="margin-top:4px;">${esc(t("ig_mp_request_encoder_url_hint"))}</div></div>
    </div>`}
    <div class="field"><label>${esc(t("ig_mp_request_note"))}</label>
      <textarea id="mraNote" rows="2" placeholder="${esc(t("ig_mp_request_note_ph"))}"></textarea></div>
    <div class="actions"><button type="button" class="btn primary" id="mraSubmit">${esc(t("ig_mp_request_submit"))}</button></div>
    <div class="section-heading" style="margin:22px 0 12px;font-size:15px;">${esc(t("ig_mp_request_history"))}</div>
    <div id="mraHistory" class="ig-mr-history"></div>`, "modal-wide", {stack:true});
  $("#mraClose").onclick=closeModal;
  const typeSeg=$("#mraTypeSeg");
  if(typeSeg) typeSeg.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
    mrType=b.dataset.type;
    typeSeg.querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on",x===b));
    const animaFields=$("#mraAnimaFields");
    if(animaFields) animaFields.style.display=mrType==="anima"?"":"none";
  });
  const urlInp=$("#mraUrl"), errEl=$("#mraUrlErr");
  const validate=()=>{
    const url=urlInp.value.trim();
    if(!url){ errEl.style.display="none"; return true; }
    if(!/^https?:\/\/.+/i.test(url)){
      errEl.style.display=""; errEl.style.color="var(--danger,#e05d5d)";
      errEl.textContent=t("ig_mp_request_url_malformed"); return false; }
    const allowed=_modelRequestHostAllowed(url);
    errEl.style.display=allowed?"none":"";
    errEl.style.color="var(--warn,#e0a800)";
    errEl.textContent=allowed?"":t("ig_mp_request_url_unlisted");
    return true;
  };
  urlInp.oninput=validate;
  $("#mraSubmit").onclick=async()=>{
    const model_name=$("#mraName").value.trim();
    const source_url=urlInp.value.trim();
    const note=$("#mraNote").value.trim();
    if(!model_name){ toast(t("ig_mp_request_name_required")); return; }
    if(!source_url || !validate()){ toast(t("ig_mp_request_url_malformed")); return; }
    const body={model_name, source_url, note, request_type:isLora?"lora":mrType};
    if(!isLora && mrType==="anima"){
      const vae_url=($("#mraVaeUrl")?.value||"").trim();
      const text_encoder_url=($("#mraEncoderUrl")?.value||"").trim();
      if(vae_url) body.vae_url=vae_url;
      if(text_encoder_url) body.text_encoder_url=text_encoder_url;
    }
    try{
      await api("/api/imagegen/model-requests", j("POST",body));
      toast(t("ig_mp_request_submitted"));
      $("#mraName").value=""; urlInp.value=""; $("#mraNote").value="";
      loadHistory();
    }catch(e){ errorToast(e.message); }
  };
  loadHistory();
  _loadModelRequestHosts().then(()=>{
    const hint=$("#mraClose")?.closest(".modal")?.querySelector(".hint");
    if(hint) hint.textContent=t("ig_mp_request_hint").replace("{hosts}", _modelRequestHosts.join(", "));
  });
}
// Aspect ratio + resolution controls. Aspect selects the shape; resolution
// selects the long-edge size tier; getSize() derives concrete width/height
// (multiples of 8) threaded into the generation request.
function mountAspectResolution(container){
  const ratios=[{id:"3:4",w:3,h:4},{id:"1:1",w:1,h:1},{id:"9:16",w:9,h:16},
                {id:"3:5",w:3,h:5},{id:"4:3",w:4,h:3},{id:"16:9",w:16,h:9}];
  const tiers=[{id:"s",label:t("ig_res_s"),edge:768},{id:"m",label:t("ig_res_m"),edge:1024},{id:"l",label:t("ig_res_l"),edge:1280}];
  let ratio=ratios[0], tier=tiers[1], custom=null; // custom={w,h}
  const round8=v=>Math.max(256, Math.min(2048, Math.round(v/8)*8));
  const size=()=>{
    if(custom) return {width:round8(custom.w), height:round8(custom.h)};
    const {w,h}=ratio, edge=tier.edge;
    return w>=h ? {width:round8(edge), height:round8(edge*h/w)}
                : {width:round8(edge*w/h), height:round8(edge)};
  };
  const render=()=>{
    const s=size();
    container.innerHTML=`
      <div class="ig-sec" data-key="aspect">${igSectionHead("aspect", t("ig_aspect"))}
        <div class="ig-sec-body">
        <div class="ig-ratio-row">${ratios.map(r=>{
          const on=!custom&&r.id===ratio.id;
          const long=60, w=r.w>=r.h?long:Math.round(long*r.w/r.h), h=r.h>=r.w?long:Math.round(long*r.h/r.w);
          return `<button type="button" class="ig-ratio-btn${on?" on":""}" data-r="${r.id}">
            <span class="ig-ratio-box" style="width:${w*0.5}px;height:${h*0.5}px;"></span>
            <span>${r.id}</span></button>`;
        }).join("")}
        <button type="button" class="ig-ratio-btn${custom?" on":""}" data-r="custom"><span class="ig-ratio-box ig-ratio-custom">±</span><span>${esc(t("ig_aspect_custom"))}</span></button>
        </div>
        </div>
      </div>
      <div class="ig-sec" data-key="resolution">${igSectionHead("resolution", t("ig_resolution"))}
        <div class="ig-sec-body">
        <div class="ig-res-row">${tiers.map(tr=>`<button type="button" class="ig-res-btn${!custom&&tr.id===tier.id?" on":""}" data-t="${tr.id}">${esc(tr.label)}</button>`).join("")}
        <span class="ig-res-dims">${s.width}×${s.height}</span></div>
        ${custom?`<div class="ig-custom-dims"><input type="number" id="igCustW" value="${custom.w}" min="256" max="2048" step="8"> × <input type="number" id="igCustH" value="${custom.h}" min="256" max="2048" step="8"></div>`:""}
        </div>
      </div>`;
    container.querySelectorAll(".ig-ratio-btn").forEach(b=>b.onclick=()=>{
      if(b.dataset.r==="custom"){ const s2=size(); custom={w:s2.width,h:s2.height}; }
      else { custom=null; ratio=ratios.find(r=>r.id===b.dataset.r); }
      render();
    });
    container.querySelectorAll(".ig-res-btn").forEach(b=>b.onclick=()=>{ custom=null; tier=tiers.find(tr=>tr.id===b.dataset.t); render(); });
    const cw=container.querySelector("#igCustW"), ch=container.querySelector("#igCustH");
    if(cw) cw.oninput=e=>{ custom.w=parseInt(e.target.value)||custom.w; container.querySelector(".ig-res-dims").textContent=size().width+"×"+size().height; };
    if(ch) ch.oninput=e=>{ custom.h=parseInt(e.target.value)||custom.h; container.querySelector(".ig-res-dims").textContent=size().width+"×"+size().height; };
    wireIgSections(container);
  };
  render();
  return { getSize:size };
}
// Static descriptions for well-known Stable-Diffusion/ComfyUI samplers and
// schedulers. These are generic algorithm names, not per-instance files, so

// there's nothing to fetch — the text is hand-written and kept accurate.
const SAMPLER_DESCS={
  euler:"The simplest, fastest solver — a solid deterministic baseline that converges cleanly.",
  euler_ancestral:"Euler with ancestral (added) noise each step — more varied, creative results but non-deterministic and can look busier.",
  heun:"A second-order solver that refines each Euler step with a correction — more accurate than Euler, but roughly twice as slow.",
  heunpp2:"An improved higher-order Heun variant — slightly more accurate than plain Heun at a similar speed cost.",
  dpm_2:"A second-order DPM solver — higher accuracy than Euler at the cost of an extra model call per step.",
  dpm_2_ancestral:"DPM 2nd-order with ancestral noise — more varied output, non-deterministic, at a similar speed cost to dpm_2.",
  lms:"Linear multi-step (Adams-like) solver — reuses previous steps for efficiency, good quality but can be unstable at very low step counts.",
  dpm_fast:"A fixed-step DPM variant tuned for speed at low step counts — quick but lower quality than modern DPM++ solvers.",
  dpm_adaptive:"Adaptively chooses its own step sizes for accuracy — high quality but ignores the step count and can be slow.",
  dpmpp_2s_ancestral:"DPM++ single-step 2nd-order with ancestral noise — high quality and varied, but slower and non-deterministic.",
  dpmpp_sde:"DPM++ using a stochastic (SDE) formulation — excellent detail and quality, non-deterministic, slower than the ODE variants.",
  dpmpp_2m:"DPM++ 2M, a high-quality second-order multi-step solver — a fast, reliable default for most generations.",
  dpmpp_2m_sde:"DPM++ 2M in its stochastic (SDE) form — often richer detail than plain 2M, at the cost of determinism.",
  dpmpp_3m_sde:"DPM++ third-order multi-step SDE solver — can capture fine detail but usually needs more steps to be stable.",
  ddim:"An older deterministic solver — fast and stable, but generally lower quality than modern DPM++ solvers.",
  uni_pc:"UniPC, a unified predictor-corrector solver — high quality and fast convergence, good at low step counts.",
  uni_pc_bh2:"UniPC using the BH2 corrector variant — similar to uni_pc, often slightly higher quality.",
  lcm:"For Latent Consistency Models — produces images in very few steps (around 4-8) with a compatible LCM checkpoint or LoRA.",
};
const SCHEDULER_DESCS={
  simple:"A plain, evenly-spaced noise schedule — a straightforward default that works well in most cases.",
  normal:"The standard model-derived schedule (linear in the model's own noise space) — a safe general-purpose choice.",
  karras:"Spaces steps to spend more time at low noise levels — often produces sharper details, especially at higher step counts.",
  exponential:"Distributes noise levels on an exponential curve — a smooth schedule that can help fine detail.",
  sgm_uniform:"The uniform schedule used by SGM-style models — recommended for SDXL and models trained with that formulation.",
  ddim_uniform:"The uniform timestep spacing used by the original DDIM sampler — pair it with DDIM for expected results.",
  beta:"Derives step spacing from the model's beta (noise) schedule — a good match for models using that training formulation.",
  linear_quadratic:"Blends linear early steps with quadratic spacing later — designed to improve results at low step counts.",
  kl_optimal:"A schedule optimized to minimize KL divergence between steps — aims for efficient, high-quality sampling.",
};
function samplerDesc(name){
  if(SAMPLER_DESCS[name]) return SAMPLER_DESCS[name];
  let base=name, suffix="";
  if(name.endsWith("_cfg_pp")){ base=name.slice(0,-7); suffix=" (cfg++ variant of the same algorithm)"; }
  else if(name.endsWith("_gpu")){ base=name.slice(0,-4); suffix=" (GPU-noise variant of the same algorithm)"; }
  if(suffix && SAMPLER_DESCS[base]) return SAMPLER_DESCS[base]+suffix;
  return "";
}
function schedulerDesc(name){ return SCHEDULER_DESCS[name]||""; }
// Single-choice image-tile grid, same layout as mountModelGrid but with the
// Request tab dropped (samplers/schedulers are a fixed built-in set). Falls back
// to a built-in description (builtinDesc) when no admin one is set — same
// precedence as modelDesc()||describeCheckpoint() for checkpoints. Reuses the
// shared preview map helpers (modelLabel/modelDesc/modelImage/_igModelBigThumb).
function mountChoiceGrid(container, names, {value, previews, builtinDesc, showMoreLabel, openPicker, onChange, usageKey}={}){
  previews=previews||{};
  let current=value || names[0] || "";
  const INITIAL=6;
  const render=()=>{
    const desc=modelDesc(current,previews)||(builtinDesc?builtinDesc(current):"");
    // Same most-used-first ranking as the checkpoint/LoRA grids — the current
    // selection always leads regardless of its own usage count.
    let shown=names.slice(0,INITIAL);
    if(usageKey){
      const counts=_pickerUsageCounts(usageKey);
      const byUsage=[...names].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
      const ordered=current&&byUsage.includes(current) ? [current, ...byUsage.filter(n=>n!==current)] : byUsage;
      shown=ordered.slice(0,INITIAL);
    }
    container.innerHTML=`
      <div class="ig-model-summary">
        ${_igModelBigThumb(current,previews)}
        <div class="ig-model-summary-txt"><b>${esc(modelLabel(current,previews)||"—")}</b>${desc?`<span>${esc(desc)}</span>`:""}</div>
      </div>
      <div class="ig-grid ig-model-grid">${shown.map(name=>`
        <button type="button" class="ig-grid-tile ig-model-tile${name===current?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
          ${_igModelBigThumb(name,previews)}
          <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
        </button>`).join("")}</div>
      <button type="button" class="ig-show-more" data-act="more">${esc(showMoreLabel)}</button>`;
    container.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ current=b.dataset.v; render(); if(onChange) onChange(current); });
    const more=container.querySelector("[data-act='more']");
    if(more) more.onclick=()=>openPicker(current, v=>{ current=v; render(); if(onChange) onChange(current); });
  };
  render();
  return { get value(){ return current; } };
}
// Upload a source image, run it through this specific upscaler, and hand the
// upscaled result back as a blob — so an upscaler's admin-set preview shows
// what it actually does, the same way checkpoint/sampler/scheduler previews
// show a real generation rather than an arbitrary uploaded picture.
function openUpscalerPreviewModal(upscalerName, onUse){
  let srcDataUrl=null, resultDataUrl=null;
  openModal(`
    <button class="modal-close" id="uppClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("adm_upsc_preview_title"))} · ${esc(upscalerName)}</h3>
    <p class="hint" style="margin:0 0 14px;">${esc(t("adm_upsc_preview_upload_hint"))}</p>
    <div class="ig-ref-preview" id="uppPreview" style="display:none;">
      <img id="uppImg" alt="">
      <button type="button" class="tool danger img-pick-x" id="uppClear" aria-label="${esc(t("img_gen_reference_remove"))}" title="${esc(t("img_gen_reference_remove"))}">✕</button>
    </div>
    <div class="img-pick-empty ig-ref-empty" id="uppEmpty" title="${esc(t("img_gen_reference_pick"))}">${UPLOAD_ICON_SVG}</div>
    <input type="file" id="uppFile" accept="image/*" hidden>
    <div id="uppResultWrap" style="display:none;margin:16px 0;">
      <div class="lore-entry-label">${esc(t("adm_upsc_preview_result"))}</div>
      <img id="uppResultImg" style="width:100%;border-radius:10px;display:block;margin-top:6px;" alt="">
    </div>
    <div class="modal-foot">
      <button class="btn" id="uppCancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="uppRun" disabled>${esc(t("ig_upscale"))}</button>
      <button class="btn primary" id="uppUse" style="display:none;">${esc(t("adm_use_this_image"))}</button>
    </div>`, null, {stack:true});
  $("#uppClose").onclick=$("#uppCancel").onclick=closeModal;
  const preview=$("#uppPreview"), emptyBox=$("#uppEmpty"), runBtn=$("#uppRun"), useBtn=$("#uppUse"), resultWrap=$("#uppResultWrap");
  // Wired once here, not inside runBtn's re-runnable success handler below —
  // #uppResultImg is one persistent DOM node whose src just gets swapped on
  // each re-run, so wiring it per-run would stack duplicate listeners.
  _wireZoomPan($("#uppResultImg"));
  const setSrc=dataUrl=>{
    srcDataUrl=dataUrl;
    $("#uppImg").src=dataUrl;
    preview.style.display=""; emptyBox.style.display="none"; runBtn.disabled=false;
    runBtn.classList.add("primary"); runBtn.textContent=t("ig_upscale");
    resultDataUrl=null; useBtn.style.display="none"; resultWrap.style.display="none";
  };
  emptyBox.onclick=()=>$("#uppFile").click();
  $("#uppFile").onchange=()=>{
    const f=$("#uppFile").files[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=()=>setSrc(reader.result);
    reader.readAsDataURL(f);
    $("#uppFile").value="";
  };
  $("#uppClear").onclick=()=>{
    srcDataUrl=null; resultDataUrl=null;
    preview.style.display="none"; emptyBox.style.display=""; runBtn.disabled=true;
    runBtn.classList.add("primary");
    useBtn.style.display="none"; resultWrap.style.display="none";
  };
  runBtn.onclick=async()=>{
    if(!srcDataUrl) return;
    runBtn.disabled=true; const label=runBtn.textContent; runBtn.textContent=t("ig_upscaling");
    try{
      const res=await api("/api/imagegen/upscale", j("POST",{image:srcDataUrl, upscaler:upscalerName}));
      resultDataUrl=res.image;
      $("#uppResultImg").src=resultDataUrl;
      resultWrap.style.display=""; useBtn.style.display="";
      // Once a result exists, "Use this image" is the obvious next step —
      // demoting Upscale to a plain button (still available to re-run with a
      // different source/settings) avoids two identically-styled "primary"
      // buttons competing for attention side by side.
      runBtn.classList.remove("primary");
      runBtn.disabled=false; runBtn.textContent=t("ig_upscale_again");
      return;
    }catch(e){ errorToast(t("ig_upscale_failed")+": "+e.message); }
    runBtn.disabled=false; runBtn.textContent=label;
  };
  useBtn.onclick=async()=>{
    if(!resultDataUrl) return;
    const blob=await(await fetch(resultDataUrl)).blob();
    closeModal();
    onUse(blob);
  };
}
// Full single-choice picker modal — same layout as openModelPickerModal minus
// the Request tab: search box + scrollable grid of every option + a detail
// panel with a bigger preview and a "Use this …" button.
function openChoicePickerModal(names, previews, current, onSelect, opts){
  previews=previews||{};
  const {title, searchPh, useLabel, builtinDesc, emptyMsg, pickHint}=opts;
  let query="";
  let picked=current;
  const renderGrid=()=>{
    const q=query.trim().toLowerCase();
    const list=q?names.filter(n=>n.toLowerCase().includes(q)||modelLabel(n,previews).toLowerCase().includes(q)):names;
    const grid=$("#cpGrid"); if(!grid) return;
    grid.innerHTML=list.length?list.map(name=>`
      <button type="button" class="ig-grid-tile ig-model-tile${name===picked?" on":""}" data-v="${esc(name)}" title="${esc(name)}">
        ${_igModelBigThumb(name,previews)}
        <span class="ig-tile-name">${esc(modelLabel(name,previews))}</span>
      </button>`).join("") : `<div class="hint">${esc(emptyMsg)}</div>`;
    grid.querySelectorAll(".ig-grid-tile").forEach(b=>b.onclick=()=>{ picked=b.dataset.v; renderGrid(); renderDetail(); });
  };
  const renderDetail=()=>{
    const d=$("#cpDetail"); if(!d) return;
    const desc=modelDesc(picked,previews)||(builtinDesc?builtinDesc(picked):"");
    d.innerHTML=picked?`
      <div class="ig-mp-detail-thumb">${_igModelBigThumb(picked,previews)}</div>
      <div class="ig-mp-detail-name">${esc(modelLabel(picked,previews))}</div>
      ${desc?`<div class="ig-mp-detail-desc">${esc(desc)}</div>`:""}
      <button type="button" class="btn primary" id="cpUse">${esc(useLabel)}</button>`
      : `<div class="hint">${esc(pickHint)}</div>`;
    const useBtn=$("#cpUse");
    if(useBtn) useBtn.onclick=()=>{ onSelect(picked); closeModal(); };
  };
  openModal(`
    <button class="modal-close" id="cpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(title)}</h3>
    <input type="text" id="cpSearch" class="ig-mp-search" placeholder="${esc(searchPh)}">
    <div class="ig-mp-body">
      <div class="ig-grid ig-model-grid ig-mp-grid" id="cpGrid"></div>
      <div class="ig-mp-detail" id="cpDetail"></div>
    </div>`, "modal-wide", {stack:true});
  $("#cpClose").onclick=closeModal;
  $("#cpSearch").oninput=e=>{ query=e.target.value; renderGrid(); };
  renderGrid(); renderDetail();
}
async function mountSamplerPickers(container, {savedSampler, savedScheduler, onChange}={}){
  if(!_samplerData || !_samplerPreviews || !_schedulerPreviews){
    const [data, sampPrev, schedPrev]=await Promise.all([
      api("/api/imagegen/samplers").catch(()=>({samplers:[], schedulers:[]})),
      api("/api/imagegen/sampler-previews").catch(()=>({})),
      api("/api/imagegen/scheduler-previews").catch(()=>({})),
    ]);
    _samplerData=data; _samplerPreviews=sampPrev; _schedulerPreviews=schedPrev;
  }
  const samplers=_samplerData.samplers||[], schedulers=_samplerData.schedulers||[];
  const sampPrev=_samplerPreviews, schedPrev=_schedulerPreviews;
  const sampVal=(savedSampler&&samplers.includes(savedSampler))?savedSampler
    :samplers.includes("dpmpp_2m_sde_gpu")?"dpmpp_2m_sde_gpu":(samplers.includes("euler")?"euler":(samplers[0]||"euler"));
  const schedVal=(savedScheduler&&schedulers.includes(savedScheduler))?savedScheduler
    :schedulers.includes("karras")?"karras":(schedulers.includes("normal")?"normal":(schedulers[0]||"normal"));
  container.innerHTML=`
    <div class="field"><label>${esc(t("ig_sampler"))}</label><div id="ig_samp_sel"></div></div>
    <div class="field"><label>${esc(t("ig_scheduler"))}</label><div id="ig_sched_sel"></div></div>`;
  const sampSel=mountChoiceGrid(container.querySelector("#ig_samp_sel"), samplers, {
    value:sampVal, previews:sampPrev, builtinDesc:samplerDesc, showMoreLabel:t("ig_show_more_samplers"),
    usageKey:"ig_sampler_usage",
    openPicker:(cur,cb)=>openChoicePickerModal(samplers, sampPrev, cur, cb, {
      title:t("ig_sampler_picker_title"), searchPh:t("ig_sampler_search_ph"), useLabel:t("ig_use_this_sampler"),
      builtinDesc:samplerDesc, emptyMsg:t("ig_sampler_search_empty"), pickHint:t("ig_sampler_pick_hint")}),
    onChange:v=>{ if(onChange) onChange({sampler:v, scheduler:schedSel.value}); }});
  const schedSel=mountChoiceGrid(container.querySelector("#ig_sched_sel"), schedulers, {
    value:schedVal, previews:schedPrev, builtinDesc:schedulerDesc, showMoreLabel:t("ig_show_more_schedulers"),
    usageKey:"ig_scheduler_usage",
    openPicker:(cur,cb)=>openChoicePickerModal(schedulers, schedPrev, cur, cb, {
      title:t("ig_scheduler_picker_title"), searchPh:t("ig_scheduler_search_ph"), useLabel:t("ig_use_this_scheduler"),
      builtinDesc:schedulerDesc, emptyMsg:t("ig_scheduler_search_empty"), pickHint:t("ig_scheduler_pick_hint")}),
    onChange:v=>{ if(onChange) onChange({sampler:sampSel.value, scheduler:v}); }});
  return { get sampler(){ return sampSel.value; }, get scheduler(){ return schedSel.value; } };
}
// Any dropdown/menu toggle should close every OTHER open dropdown first — without
// this, opening one via a button that calls e.stopPropagation() (so its own click
// doesn't immediately re-close it) also stops that click from ever reaching the
// document-level listeners that close unrelated dropdowns, leaving both open.
function closeAllDropdowns(){
  document.querySelectorAll(".chat-more-menu:not([hidden])").forEach(m=>m.hidden=true);
  document.querySelectorAll(".dd.open").forEach(d=>d.classList.remove("open"));
  document.querySelectorAll(".cs.open").forEach(c=>c.classList.remove("open"));
  document.querySelectorAll(".cs-menu-portal").forEach(m=>m.remove());
  if(_cpPop) _cpPop.hidden=true;
  document.querySelectorAll(".confirm-pop").forEach(p=>p.remove());
}
