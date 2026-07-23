"use strict";
/* ====================== IMAGE GENERATION: GALLERY/COMMUNITY FEED ====================== */
// Split out of imagegen.js — the "my chat gallery" and "community" tab renderers of the
// /images page (Generate tab + its shared card/section helpers stayed in imagegen.js).
async function renderChatGalleryTab(body){
  const images=await api("/api/me/images").catch(()=>[]);
  const bySession=new Map();
  images.forEach(img=>{
    if(!bySession.has(img.sid)) bySession.set(img.sid, []);
    bySession.get(img.sid).push(img);
  });
  const entryHTML=(sid, imgs)=>{
    const first=imgs[0];
    return `<div class="codex-entry">
      <div class="codex-entry-head">
        ${avatar({avatar:first.char_avatar, name:first.char_name, is_explicit:first.is_explicit, char_owner_id:first.char_owner_id}, "codex-entry-ava")}
        <div class="codex-entry-title">
          <a href="/chat/${esc(sid)}">${esc(first.char_name||t("gallery_open_chat"))}</a>
          <div class="codex-entry-sub">${esc(first.session_title||"")}</div>
        </div>
        <span class="codex-entry-count">${imgs.length}</span>
      </div>
      <div class="ig-chatgallery-grid">${imgs.map(img=>`
        <div class="ig-mcard" data-mid="${esc(img.mid)}">
          <div class="ig-mthumb" data-act="gallery-view"><img class="${nsfwCls(img).trim()}" src="${esc(mediaURL(img.image))}" alt="">${ratingBadge(img)}</div>
          ${img.scene?`<div class="gallery-scene" data-act="gallery-view">${esc(img.scene)}</div>`:""}
          <div class="ig-mcard-tools"><button class="tool danger" data-act="gallery-del">${esc(t("tool_delete"))}</button></div>
        </div>`).join("")}</div>
    </div>`;
  };
  const imagesById=new Map(images.map(img=>[img.mid, img]));
  body.innerHTML=bySession.size
    ? `<div class="codex" id="galleryGrid">${[...bySession.entries()].map(([sid,imgs])=>entryHTML(sid,imgs)).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("gallery_empty"))}</div></div>`;
  $("#galleryGrid")?.addEventListener("click", e=>{
    const viewEl=e.target.closest("[data-act='gallery-view']");
    if(viewEl){ const mid=viewEl.closest(".ig-mcard").dataset.mid; const img=imagesById.get(mid); if(img) imageDetailModal(img); return; }
    const btn=e.target.closest("[data-act='gallery-del']"); if(!btn) return;
    const card=btn.closest(".ig-mcard"); const mid=card.dataset.mid;
    if(btn.dataset.confirming){ return; }
    btn.dataset.confirming="1"; btn.textContent=t("gallery_delete_confirm");
    const timer=setTimeout(()=>{ delete btn.dataset.confirming; btn.textContent=t("tool_delete"); }, 3000);
    btn.onclick=async()=>{
      clearTimeout(timer);
      try{ await api("/api/me/images/"+mid, {method:"DELETE"}); card.remove(); toast(t("gallery_deleted"));
        if(!card.closest(".ig-chatgallery-grid").children.length) renderChatGalleryTab(body); }
      catch(err){ errorToast(t("gallery_delete_failed")+": "+err.message); }
    };
  });
}

async function renderCommunityTab(body){
  const imgs=await api("/api/imagegen/community").catch(()=>[]);
  const byId=new Map(imgs.map(s=>[s.id,s]));
  body.innerHTML=imgs.length
    ? `<div class="ig-masonry" id="igCommunityGrid">${imgs.map(s=>igMasonryCard(s,{community:true, ownerInfo:s})).join("")}</div>`
    : `<div class="empty"><div class="big">${esc(t("ig_community_empty"))}</div></div>`;
  $("#igCommunityGrid")?.addEventListener("click", e=>{
    const card=e.target.closest(".ig-mcard"); if(!card) return;
    if(!e.target.closest("[data-act='ig-view']")) return;
    const s=byId.get(card.dataset.iid); if(!s) return;
    if(!nsfwCanShow({is_explicit:s.is_explicit})) return;
    imageDetailModal({id:s.id, image:s.image, image_positive:s.positive, image_negative:s.negative,
      image_ts:s.created, checkpoint:s.checkpoint, loras:s.loras, is_explicit:s.is_explicit, human_reviewed:s.human_reviewed,
      sampler:s.sampler, scheduler:s.scheduler, steps:s.steps, is_img2img:s.is_img2img,
      cfg:s.cfg, upscaler:s.upscaler},
      {owner:{name:s.owner_display_name||s.owner_username, username:s.owner_username, avatar:s.owner_avatar}, ownerId:s.user_id, shareable:true, reportable:true});
  });
}
