"use strict";

function copyInstructionsText(root){
  const parts=[...root.querySelectorAll("p")].map(p=>p.textContent.replace(/\s+/g," ").trim()).filter(Boolean);
  return parts.join("\n\n");
}

// Generic "lodge a report" button + modal for any image on the site that
// doesn't already have its own structured review flow (standalone generated
// images and emoji/sticker uploads both have a dedicated one — see
// reportRatingModal / adminReviewImageModal). kind is a short machine tag
// ("avatar", "banner", "profile", "character", "lore") the admin resolve
// endpoint dispatches on to flip the right row's is_explicit; label is the
// human-readable description sent to admins ("greed's profile avatar");
// targetId is the id of the underlying row (user id, character id, lore id)
// the admin verdict actually gets applied to; image is the image URL itself
// — sent along so the admin queue can show the image directly and resolve
// SFW/NSFW right there, same as every other rating-report queue in the app,
// instead of just linking off to go look at it manually.
function reportImageBtnHTML(kind, label, targetId, image){
  return `<button type="button" class="tool report-flag-btn" data-report-kind="${esc(kind)}" data-report-label="${esc(label)}" data-report-target="${esc(targetId||"")}" data-report-image="${esc(image||"")}" title="${esc(t("report_flag_tip"))}" aria-label="${esc(t("report_flag_tip"))}">${FLAG_ICON_SVG}</button>`;
}
function wireReportImageButtons(root){
  (root||document).querySelectorAll(".report-flag-btn").forEach(b=>{
    if(b._reportWired) return;
    b._reportWired=true;
    b.onclick=e=>{
      e.preventDefault(); e.stopPropagation();
      openReportImageModal(b.dataset.reportKind, b.dataset.reportLabel, b.dataset.reportTarget, b.dataset.reportImage);
    };
  });
}
// Wires a mandatory {{report}} placeholder button inside a custom
// presentation_html/profile_html card (see substituteCharacterTemplate /
// substituteProfileTemplate) — same modal as reportImageBtnHTML, just a
// different trigger element since the card author controls its markup/CSS.
function wireCardReportButtons(doc, kind, label, targetId, image){
  doc.querySelectorAll(".gl-report").forEach(btn=>{
    btn.addEventListener("click", e=>{ e.preventDefault(); openReportImageModal(kind, label, targetId, image); });
  });
}
// Custom presentation_html is raw author-pasted markup (see pres_b64_warning's
// guidance to paste a real lore image URL into an <img src>) — DOMPurify
// sanitizes it for safety but has no idea which of those URLs point at a
// lore image that's since been marked explicit. This is the same nsfw-blur
// gate every other image on the site gets, applied after the fact by
// matching each <img>'s src against the character's own lore image URLs.
function blurExplicitLoreImages(doc, lore){
  const explicitPaths=(lore||[]).filter(l=>l.is_explicit && l.image).map(l=>mediaURL(l.image).split("?")[0]);
  if(!explicitPaths.length || nsfwCanShow({is_explicit:true})) return;
  doc.querySelectorAll("img").forEach(img=>{
    const src=(img.getAttribute("src")||"").split("?")[0];
    if(!explicitPaths.some(p=>src.endsWith(p))) return;
    img.style.cssText+="filter:blur(20px) brightness(0.6);cursor:pointer;";
    img.addEventListener("click", e=>{ e.preventDefault(); e.stopPropagation(); openNsfwGate(); }, true);
  });
}
function openReportImageModal(kind, label, targetId, image){
  openModal(`<h3>${esc(t("report_flag_title"))}</h3>
    <p class="hint" style="margin:8px 0 14px;">${esc(t("report_flag_intro"))}</p>
    <div class="field"><label>${esc(t("report_note_label"))}</label>
      <textarea id="rifNote" rows="3" placeholder="${esc(t("report_note_ph"))}"></textarea></div>
    <div class="modal-foot" style="gap:8px;">
      <button class="btn" id="rifCancel">${esc(t("btn_cancel"))}</button>
      <button class="btn primary" id="rifSend">${esc(t("report_flag_send"))}</button>
    </div>`);
  $("#rifCancel").onclick=closeModal;
  $("#rifSend").onclick=async()=>{
    const note=($("#rifNote")?.value||"").trim();
    try{
      await api("/api/report-image", j("POST", {kind, label, target_id:targetId||"", image:image||"", note}));
      closeModal(); toast(t("report_sent"));
    }catch(e){ errorToast(t("report_failed")+": "+e.message); }
  };
}
