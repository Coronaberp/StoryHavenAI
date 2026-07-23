"use strict";
/* ============================ ADMIN: emoji/sticker moderation ============================
   No blur here (unlike the public picker) — admin_view=true on the API call
   means the server already returned the real file, not the pending preview
   stand-in, since reviewing *is* looking at the actual content. */
function _admEmojiCard(e){
  return `
    <div class="adash-rowcard${e.is_explicit?" warn":""}">
      <div class="adash-rowmain">
        <img class="adash-report-thumb" src="${esc(mediaURL(e.image))}" alt="">
        <div>
          <div class="adash-rowtitle">:${esc(e.shortcode)}: <span class="mr-type-tag">${esc(e.kind)}</span>${e.is_explicit?` <span class="mr-type-tag" style="background:var(--warn,#e0a800);color:#1a1a1a;">pending review</span>`:""}</div>
          <div class="adash-rowsub">${esc(e.uploader_username||e.uploader_id)}</div>
        </div>
      </div>
      <div class="adash-rowactions">
        ${e.is_explicit
          ? `<button class="btn primary" data-emoji-review="${esc(e.id)}">${esc(t("adm_review"))}</button>`
          : `<button class="tool" data-preview-zoom="${esc(mediaURL(e.image))}" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
             <button class="tool" data-emoji-edit="${esc(e.id)}" title="${esc(t("adm_preview_edit"))}" aria-label="${esc(t("adm_preview_edit"))}">${EDIT_ICON_SVG}</button>
             <button class="tool danger" data-emoji-delete="${esc(e.id)}" title="${esc(t("adm_delete"))}" aria-label="${esc(t("adm_delete"))}">${TRASH_ICON_SVG}</button>`}
      </div>
    </div>`;
}

function _admEmojisPanelHTML(allEmojis, pendingEmojis, approvedEmojis){
  return `
    <div class="adash-panel-head"><div><div class="adash-eyebrow">Emojis &amp; Stickers</div><h2 class="adash-h2">Manage custom emoji/stickers <span class="adash-count">${allEmojis.length}</span></h2><div class="adash-sub">Animated GIFs can't be auto-rated (the classifier only ever sees one static frame), so they always land here for a manual look before going live.</div></div></div>
    <div class="field" style="max-width:420px;margin-bottom:20px;">
      <label>Add new (as admin — goes live immediately, no review hold)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input type="text" id="adEmojiShortcode" placeholder="shortcode (e.g. pepega)" style="flex:1;min-width:140px;">
        <select id="adEmojiKind" style="flex:none;"><option value="emoji">Emoji</option><option value="sticker">Sticker</option></select>
        <input type="file" id="adEmojiFile" accept="image/*" hidden>
        <div class="emoji-pop-file-row" style="flex:1;min-width:160px;">
          <label for="adEmojiFile" class="emoji-pop-file-label" id="adEmojiFileLabel">Choose image…</label>
          <button type="button" class="btn" id="adEmojiGenerate" title="Generate with AI">🎨 Generate</button>
        </div>
        <button class="btn primary" id="adEmojiUpload">Add</button>
      </div>
    </div>
    ${_admModQueue("⏳ Pending review", pendingEmojis, "Nothing pending.", _admEmojiCard)}
    ${_admModQueue("✓ Approved", approvedEmojis, "None yet.", _admEmojiCard)}`;
}

function _admWireEmojis(main, allEmojis, render){
  main.querySelectorAll("[data-emoji-review]").forEach(b=>b.onclick=()=>{
    const item=allEmojis.find(x=>x.id===b.dataset.emojiReview);
    if(item) openEmojiReviewModal(item, async()=>{ await _loadCustomEmojis(); render(); });
  });
  main.querySelectorAll("[data-emoji-delete]").forEach(b=>b.onclick=()=>{
    confirmAction(b, "Delete this emoji/sticker? This can't be undone.", "Delete").then(async ok=>{
      if(!ok) return;
      try{
        await api("/api/emojis/"+b.dataset.emojiDelete,{method:"DELETE"});
        await _loadCustomEmojis();
        toast("Deleted."); render();
      }
      catch(e){ errorToast("Failed: "+e.message); }
    });
  });
  main.querySelectorAll("[data-emoji-edit]").forEach(b=>b.onclick=()=>{
    const item=allEmojis.find(x=>x.id===b.dataset.emojiEdit);
    if(!item) return;
    openModal(`<h3>Edit emoji/sticker</h3>
      <div class="field"><label>Shortcode</label>
        <input type="text" id="em_shortcode" value="${esc(item.shortcode)}"></div>
      <div class="field"><label>Kind</label>
        <select id="em_kind"><option value="emoji"${item.kind==="emoji"?" selected":""}>Emoji</option><option value="sticker"${item.kind==="sticker"?" selected":""}>Sticker</option></select></div>
      <div class="modal-foot"><button class="btn" id="em_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="em_save">${esc(t("btn_save"))}</button></div>`);
    document.getElementById("em_cancel").onclick=closeModal;
    document.getElementById("em_save").onclick=async()=>{
      const shortcode=document.getElementById("em_shortcode").value.trim().toLowerCase();
      const kind=document.getElementById("em_kind").value;
      try{
        await api("/api/admin/emojis/"+item.id, j("PATCH",{shortcode,kind}));
        closeModal();
        await _loadCustomEmojis();
        toast("Saved."); render();
      }
      catch(e){ errorToast("Failed: "+e.message); }
    };
  });
  const adEmojiFileInput=document.getElementById("adEmojiFile"), adEmojiFileLabel=document.getElementById("adEmojiFileLabel");
  let adEmojiPendingBlob=null, adEmojiPendingName="";
  if(adEmojiFileInput) adEmojiFileInput.onchange=()=>{
    const f=adEmojiFileInput.files[0];
    adEmojiPendingBlob=f||null; adEmojiPendingName=f?f.name:"";
    adEmojiFileLabel.textContent=f?f.name:"Choose image…";
  };
  const adEmojiGenerateBtn=document.getElementById("adEmojiGenerate");
  if(adEmojiGenerateBtn) adEmojiGenerateBtn.onclick=async()=>{
    await openImageGenPickerModal(blob=>{
      adEmojiPendingBlob=blob; adEmojiPendingName="generated.png";
      adEmojiFileInput.value="";
      adEmojiFileLabel.textContent="Generated image";
    });
  };
  const adEmojiUploadBtn=document.getElementById("adEmojiUpload");
  if(adEmojiUploadBtn) adEmojiUploadBtn.onclick=async()=>{
    const shortcode=document.getElementById("adEmojiShortcode").value.trim().toLowerCase();
    const kind=document.getElementById("adEmojiKind").value;
    if(!shortcode||!adEmojiPendingBlob){ toast("Pick a file and a shortcode."); return; }
    const fd=new FormData(); fd.append("shortcode",shortcode); fd.append("kind",kind);
    fd.append("file",adEmojiPendingBlob,adEmojiPendingName||"upload.png");
    try{ await api("/api/emojis",{method:"POST",body:fd}); toast("Added."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  };
}
