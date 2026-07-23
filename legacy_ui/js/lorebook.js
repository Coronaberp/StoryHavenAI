"use strict";
/* ============================ LOREBOOK ============================ */
function loreModal(cid, entry, onSave){
  const e=entry||{content:"",keys:[],always:false,global:false,image:"",category:"",hidden:true,name:"",appearance_tags:"",appearance_tags_negative:""};
  let curImage=e.image||"";
  openModal(`<h3>${esc((entry&&entry.id)?t("lm_edit"):t("lm_new"))}</h3>
    <div class="field"><label>${esc(t("lm_name"))} <span class="hint">${esc(t("lm_name_hint"))}</span></label>
      <input type="text" id="l_name" value="${esc(e.name||"")}" placeholder="e.g. Maeve"></div>
    <label class="switch"><input type="checkbox" id="l_has_image" ${curImage?"checked":""}> ${esc(t("lm_has_image"))}</label>
    <div class="field" id="lImgField" style="${curImage?"":"display:none;"}"><label>${esc(t("lm_image"))}</label>
      <div class="lore-img-edit" id="lImgEdit">
        <div class="img-pick-box lore-img-box" id="lImgBox">
          ${curImage
            ? `<img class="lore-img-preview" id="lImgPrev" src="${esc(mediaURL(curImage))}" alt=""><button type="button" class="img-pick-x" id="lImgClear" title="${esc(t("ed_remove"))}">✕</button>`
            : `<div class="lore-img-preview lore-img-empty" id="lImgPrev" title="${esc(t("ed_upload"))}">${UPLOAD_ICON_SVG}</div>`}
        </div>
        <input type="file" id="lImgFile" accept="image/*" hidden>
        <button type="button" class="btn" id="lImgGen" style="margin-top:8px;">🎨 ${esc(t("ig_generate"))}</button>
      </div>
      ${curImage?`<div id="lImgUrlWrap">
        <div class="lore-img-url"><input type="text" id="lImgUrlBox" readonly value="${esc(mediaURL(curImage))}"><button type="button" class="btn" id="lImgUrlCopy">${esc(t("lm_copy_url"))}</button></div>
        <div class="hint">${esc(t("lm_image_url_hint"))}</div>
      </div>`:""}
      <div id="lTagsFields" style="${curImage?"":"display:none;"}">
        <div class="field" style="margin-top:14px;margin-bottom:10px;"><label>${esc(t("lm_appearance_tags"))} <span class="hint">${esc(t("lm_appearance_tags_hint"))}</span></label>
          <textarea id="l_appearance_tags" class="ig-autosize" rows="2" placeholder="${esc(t("lm_appearance_tags_ph"))}">${esc(e.appearance_tags||"")}</textarea></div>
        <div class="field" style="margin-bottom:0;"><label>${esc(t("lm_appearance_tags_negative"))} <span class="hint">${esc(t("lm_appearance_tags_negative_hint"))}</span></label>
          <textarea id="l_appearance_tags_negative" class="ig-autosize" rows="2" placeholder="${esc(t("lm_appearance_tags_negative_ph"))}">${esc(e.appearance_tags_negative||"")}</textarea></div>
      </div>
    </div>
    <div class="field"><label>${esc(t("lm_category"))} <span class="hint">${esc(t("lm_category_hint"))}</span></label>
      <input type="text" id="l_category" value="${esc(e.category||"")}" placeholder="e.g. Character, Location, Item"></div>
    <div class="field"><label>${esc(t("lm_keys"))} <span class="hint">${esc(t("lm_keys_hint"))}</span></label>
      <input type="text" id="l_keys" value="${esc((e.keys||[]).join(", "))}" placeholder="e.g. the King, royal palace"></div>
    <div class="field"><label>${esc(t("lm_content"))} <span class="hint">${esc(t("lm_content_hint"))}</span></label>
      <textarea id="l_content" style="min-height:130px">${esc(e.content)}</textarea></div>
    <label class="switch"><input type="checkbox" id="l_always" ${e.always?"checked":""}> ${esc(t("lm_always"))}</label>
    <label class="switch"><input type="checkbox" id="l_hidden" ${e.hidden?"checked":""}> ${esc(t("lm_hidden"))}</label>
    ${(entry&&entry.id)?"":`<label class="switch"><input type="checkbox" id="l_global" ${e.global?"checked":""}> ${esc(t("lm_global"))}</label>`}
    <div class="modal-foot"><button class="btn" id="l_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="l_save">${esc(t("btn_save"))}</button></div>`);
  $("#l_cancel").onclick=closeModal;
  [$("#l_appearance_tags"), $("#l_appearance_tags_negative")].forEach(ta=>{
    ta.addEventListener("input",()=>autosize(ta)); autosize(ta);
  });
  const renderLImgBox=()=>{
    $("#lImgBox").innerHTML = curImage
      ? `<img class="lore-img-preview" id="lImgPrev" src="${esc(mediaURL(curImage))}" alt=""><button type="button" class="img-pick-x" id="lImgClear" title="${esc(t("ed_remove"))}">✕</button>`
      : `<div class="lore-img-preview lore-img-empty" id="lImgPrev" title="${esc(t("ed_upload"))}">${UPLOAD_ICON_SVG}</div>`;
    wireImgClear();
  };
  const wireImgClear=()=>{ const b=$("#lImgClear"); if(b) b.onclick=ev=>{
    ev.stopPropagation(); curImage=""; renderLImgBox(); $("#lImgUrlWrap")?.remove();
    const tf=$("#lTagsFields"); if(tf) tf.style.display="none";
  }; };
  wireImgClear();
  $("#lImgBox").onclick=e=>{ if(e.target.closest("#lImgClear")) return; $("#lImgFile").click(); };
  $("#l_has_image").onchange=()=>{
    const on=$("#l_has_image").checked;
    $("#lImgField").style.display = on ? "" : "none";
    if(!on){ curImage=""; }
  };
  const wireUrlCopy=()=>{ const b=$("#lImgUrlCopy"); if(b) b.onclick=()=>{
    $("#lImgUrlBox").select();
    navigator.clipboard?.writeText($("#lImgUrlBox").value).then(()=>toast(t("lm_url_copied"))).catch(()=>{});
  }; };
  wireUrlCopy();
  $("#lImgFile").onchange=()=>{
    const f=$("#lImgFile").files[0]; if(!f) return;
    if(!cid){ toast("Save the character first, then add lore images."); $("#lImgFile").value=""; return; }
    // openCropper always closes the current modal before its callback runs,
    // so we snapshot the in-progress edits and reopen this modal with them.
    const pending={
      content:$("#l_content").value, keys:$("#l_keys").value.split(",").map(k=>k.trim()).filter(Boolean),
      always:$("#l_always").checked, hidden:$("#l_hidden").checked, category:$("#l_category").value,
      name:$("#l_name").value, global:$("#l_global")?.checked||false,
      appearance_tags:$("#l_appearance_tags")?.value||"",
      appearance_tags_negative:$("#l_appearance_tags_negative")?.value||"",
    };
    openCropper(URL.createObjectURL(f), "1", 512, 512, async blob=>{
      const fd=new FormData(); fd.append("file",blob,"lore.jpg");
      try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd});
        toast("Image updated."); loreModal(cid, {...e, ...pending, image:r.url}, onSave); }
      catch(err){ errorToast("Upload failed: "+err.message); loreModal(cid, {...e, ...pending}, onSave); }
    });
  };
  $("#lImgGen").onclick=()=>{
    if(!cid){ toast("Save the character first, then add lore images."); return; }
    const pending={
      content:$("#l_content").value, keys:$("#l_keys").value.split(",").map(k=>k.trim()).filter(Boolean),
      always:$("#l_always").checked, hidden:$("#l_hidden").checked, category:$("#l_category").value,
      name:$("#l_name").value, global:$("#l_global")?.checked||false,
      appearance_tags:$("#l_appearance_tags")?.value||"",
      appearance_tags_negative:$("#l_appearance_tags_negative")?.value||"",
    };
    openImageGenPickerModal(genBlob=>{
      openCropper(URL.createObjectURL(genBlob), "1", 512, 512, async blob=>{
        const fd=new FormData(); fd.append("file",blob,"lore.jpg");
        try{ const r=await api(`/api/characters/${cid}/media`,{method:"POST",body:fd});
          toast("Image updated."); loreModal(cid, {...e, ...pending, image:r.url}, onSave); }
        catch(err){ errorToast("Upload failed: "+err.message); loreModal(cid, {...e, ...pending}, onSave); }
      });
    }, {positive:pending.appearance_tags||"", negative:pending.appearance_tags_negative||LORE_DEFAULT_NEGATIVE_TAGS});
  };
  $("#l_save").onclick=async()=>{
    const body={ content:$("#l_content").value, keys:$("#l_keys").value, always:$("#l_always").checked, hidden:$("#l_hidden").checked, image:curImage, category:$("#l_category").value.trim(), name:$("#l_name").value.trim(), appearance_tags:$("#l_appearance_tags")?.value.trim()||"", appearance_tags_negative:$("#l_appearance_tags_negative")?.value.trim()||"" };
    if(!body.content.trim()){ toast("Content required."); return; }
    try{
      if(entry && entry.id) await api("/api/lore/"+entry.id, j("PUT",body));
      else { body.global=$("#l_global")?.checked||false; await api("/api/characters/"+cid+"/lore", j("POST",body)); }
    }catch(err){ errorToast("Save failed: "+err.message); return; }
    closeModal(); toast("Saved."); onSave();
  };
}

function loreEntryModal(cid, entry, canEdit, onChange){
  const renderView=()=>{
    const e2=entry;
    const eyebrow=(e2.category||t("lm_category_default")).toUpperCase();
    const title=e2.name||(e2.keys&&e2.keys[0])||t("doss_lore_untitled");
    const img=mediaURL(e2.image);
    $(".modal").innerHTML=`
      <button class="modal-close" id="leClose">${esc(t("btn_close"))}</button>
      <div class="lore-entry-modal">
        ${img?`<div class="lore-entry-img" style="position:relative;"><img class="${nsfwCls(e2).trim()}" src="${esc(img)}" alt="">${reportImageBtnHTML("lore", t("report_flag_lore").replace("{name}", title), e2.id, img).replace("class=\"tool report-flag-btn\"", "class=\"tool report-flag-btn report-flag-overlay\"")}</div>`:""}
        <div class="lore-entry-body">
          <div class="lore-entry-eyebrow">${esc(eyebrow)}</div>
          <h3>${esc(title)}</h3>
          <div class="lore-entry-keys">${(e2.keys||[]).map(k=>`<span class="tag gold">${esc(k)}</span>`).join("")}</div>
          <div class="lore-entry-label">${esc(t("lm_content"))}</div>
          <div class="lore-entry-text"${(e2.hidden&&!canEdit)?' style="font-style:italic;color:var(--muted);"':""}>${(e2.hidden&&!canEdit)?esc(t("lm_hidden_notice")):esc(e2.content)}</div>
          <div class="lore-entry-stats">
            <span>${esc(t("lm_always"))} <b>${e2.always?t("yes"):t("no")}</b></span>
            <span>${esc(t("lm_global"))} <b>${e2.global?t("yes"):t("no")}</b></span>
          </div>
          ${(canEdit && (e2.appearance_tags||e2.appearance_tags_negative))?`
          <details class="stage-editor ig-tags-owner">
            <summary>🎨 ${esc(t("lm_owner_tags_summary"))} <span class="ig-tags-lock" title="${esc(t("lm_owner_tags_lock"))}">🔒</span></summary>
            <p class="hint">${esc(t("lm_owner_tags_hint"))}</p>
            ${e2.appearance_tags?`<div class="ig-tags-row ig-tags-row-copy" data-tags="${esc(e2.appearance_tags)}"><span class="ig-tags-label ig-tags-pos">+</span>${e2.appearance_tags.split(",").map(x=>x.trim()).filter(Boolean).map(tg=>`<span class="ig-tag ig-tag-pos">${esc(tg)}</span>`).join("")}<button type="button" class="tool" data-act="copy-tags">${esc(t("gallery_copy_tags"))}</button></div>`:""}
            ${e2.appearance_tags_negative?`<div class="ig-tags-row ig-tags-row-copy" data-tags="${esc(e2.appearance_tags_negative)}"><span class="ig-tags-label ig-tags-neg">−</span>${e2.appearance_tags_negative.split(",").map(x=>x.trim()).filter(Boolean).map(tg=>`<span class="ig-tag ig-tag-neg">${esc(tg)}</span>`).join("")}<button type="button" class="tool" data-act="copy-tags">${esc(t("gallery_copy_tags"))}</button></div>`:""}
          </details>`:""}
          ${canEdit?`<div class="modal-foot"><button class="btn" id="leEdit">${esc(t("btn_edit"))}</button><button class="btn danger" id="leDel">${esc(t("btn_delete"))}</button></div>`:""}
        </div>
      </div>`;
    $("#leClose").onclick=closeModal;
    if(canEdit){
      $("#leEdit").onclick=()=>loreModal(cid, entry, ()=>{ closeModal(); onChange(); });
      $("#leDel").onclick=async()=>{ if(!(await confirmAction($("#leDel"), "Delete this entry?")))return;
        await api("/api/lore/"+entry.id,{method:"DELETE"}); closeModal(); toast("Deleted."); onChange(); };
    }
    $(".modal").querySelectorAll("[data-act='copy-tags']").forEach(b=>b.onclick=()=>{
      const tags=b.closest(".ig-tags-row").dataset.tags;
      navigator.clipboard?.writeText(tags).then(()=>toast(t("gallery_tags_copied"))).catch(()=>{});
    });
    wireReportImageButtons($(".modal"));
  };
  openModal("");
  renderView();
}
