"use strict";
/* ============================ FORUM ============================
   Reddit-lite: a flat list of threads (title/body/category), each with its
   own detail page whose replies are handled entirely by the existing
   comments component (target_type="thread") — no separate reply system. */
async function viewForum(main){
  let sort=store.get("forumSort","new");
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("forum_eyebrow"))}</div>
    <h1 class="page">${esc(t("forum_title"))}</h1>
    <div class="page-sub">${esc(t("forum_sub"))}</div>
    <div class="toolbar">
      <div class="view-switch" id="forumSortSwitch" role="group" aria-label="Sort">
        <button type="button" class="vs-btn" data-sort="new">${esc(t("forum_sort_new"))}</button>
        <button type="button" class="vs-btn" data-sort="top">${esc(t("forum_sort_top"))}</button>
      </div>
      ${ME?`<button type="button" class="btn primary" id="forumNewBtn">+ ${esc(t("forum_new_thread"))}</button>`:""}
    </div>
    <div class="forum-list" id="forumList"><div class="hint">${esc(t("loading"))}</div></div>
  </div>`;
  const paintSort=()=>{ $("#forumSortSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.sort===sort)); };
  const render=async()=>{
    const list=$("#forumList");
    let threads=[], loadFailed=false;
    try{ threads=await api("/api/forum/threads?sort="+encodeURIComponent(sort)); }catch(e){ threads=[]; loadFailed=true; }
    if(loadFailed){ list.innerHTML=`<div class="empty"><div class="big">${esc(t("forum_load_error"))}</div><button type="button" class="btn" id="forumRetryBtn">${esc(t("btn_retry"))}</button></div>`; $("#forumRetryBtn").onclick=render; return; }
    if(!threads.length){ list.innerHTML=`<div class="empty"><div class="big">${esc(t("forum_empty"))}</div></div>`; return; }
    list.innerHTML=threads.map(th=>`
      <a href="/forum/${esc(th.id)}" class="forum-row" data-nav>
        <div class="forum-row-top">
          ${th.pinned?`<span title="${esc(t("forum_pinned"))}">📌</span>`:""}
          ${th.category?`<span class="tag gold">${esc(th.category)}</span>`:""}
          <div class="forum-row-title">${esc(th.title)}</div>
        </div>
        <div class="forum-row-meta">${esc(t("forum_by"))} ${esc(th.author_display_name||th.author_username)} · ${esc(timeAgo(th.created))} · ${th.reply_count} ${esc(t("forum_replies"))} · ${th.like_count} ${esc(t("forum_likes"))}</div>
      </a>`).join("");
    list.querySelectorAll("[data-nav]").forEach(a=>a.onclick=e=>{ e.preventDefault(); navigate(a.getAttribute("href")); });
  };
  $("#forumSortSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    sort=b.dataset.sort; store.set("forumSort",sort); paintSort(); render();
  });
  paintSort();
  const newBtn=$("#forumNewBtn");
  if(newBtn) newBtn.onclick=()=>openForumNewThreadModal(render);
  render();
}
function openForumNewThreadModal(onDone){
  openModal(`<h3>${esc(t("forum_new_thread"))}</h3>
    <div class="field"><label>${esc(t("forum_field_title"))}</label>
      <input type="text" id="ft_title" maxlength="200" placeholder="${esc(t("forum_field_title_ph"))}"></div>
    <div class="field"><label>${esc(t("forum_field_category"))} <span class="hint">${esc(t("forum_field_category_hint"))}</span></label>
      <input type="text" id="ft_category" maxlength="40" placeholder="${esc(t("forum_field_category_ph"))}"></div>
    <div class="field"><label>${esc(t("forum_field_body"))}</label>
      <textarea id="ft_body" style="min-height:160px" placeholder="${esc(t("forum_field_body_ph"))}"></textarea></div>
    <div class="modal-foot"><button class="btn" id="ft_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="ft_post">${esc(t("forum_post_thread"))}</button></div>`);
  $("#ft_cancel").onclick=closeModal;
  $("#ft_post").onclick=async()=>{
    const title=$("#ft_title").value.trim(), content=$("#ft_body").value.trim(), category=$("#ft_category").value.trim();
    if(!title||!content){ toast(t("forum_fields_required")); return; }
    const btn=$("#ft_post"); btn.disabled=true;
    try{
      const th=await api("/api/forum/threads", j("POST",{title, content, category}));
      closeModal(); toast(t("forum_posted_toast")); navigate("/forum/"+th.id);
    }catch(e){ errorToast(e.message||"Failed"); btn.disabled=false; }
  };
}
async function viewForumThread(main, tid){
  let th;
  try{ th=await api("/api/forum/threads/"+encodeURIComponent(tid)); }
  catch(e){ main.innerHTML=`<div class="wrap"><div class="empty"><div class="big">${esc(t("forum_not_found"))}</div></div></div>`; return; }
  main.innerHTML=`<div class="wrap wrap-wide">
    <a href="/forum" class="forum-back" data-nav>← ${esc(t("forum_back"))}</a>
    <div class="forum-thread-card">
      ${th.category?`<span class="tag gold">${esc(th.category)}</span>`:""}
      <h1 class="page">${esc(th.title)}</h1>
      <div class="forum-thread-meta">${esc(t("forum_by"))} ${esc(th.author_display_name||th.author_username)} · ${esc(timeAgo(th.created))}</div>
      <div class="forum-thread-body md">${md(th.content)}</div>
      <div class="forum-thread-actions">
        <button type="button" class="tool${th.liked_by_me?" on":""}" id="forumLikeBtn">${th.liked_by_me?"♥":"♡"} <span id="forumLikeCount">${th.like_count}</span></button>
        ${(ME && (ME.id===th.author_id||ME.is_admin))?`<button type="button" class="tool danger" id="forumDeleteBtn">${esc(t("btn_delete"))}</button>`:""}
      </div>
    </div>
    <div id="forumComments"></div>
  </div>`;
  main.querySelectorAll("[data-nav]").forEach(a=>a.onclick=e=>{ e.preventDefault(); navigate(a.getAttribute("href")); });
  $("#forumLikeBtn").onclick=async()=>{
    if(!ME){ toast(t("forum_signin_to_like")); return; }
    const btn=$("#forumLikeBtn"); const on=btn.classList.contains("on");
    try{
      const r=await api("/api/forum/threads/"+tid+(on?"/unlike":"/like"),{method:"POST"});
      btn.classList.toggle("on", r.liked_by_me);
      btn.innerHTML=`${r.liked_by_me?"♥":"♡"} <span id="forumLikeCount">${r.like_count}</span>`;
    }catch(e){ errorToast(e.message||"Failed"); }
  };
  const delBtn=$("#forumDeleteBtn");
  if(delBtn) delBtn.onclick=async()=>{
    if(!(await confirmAction(delBtn, t("forum_delete_confirm")))) return;
    try{ await api("/api/forum/threads/"+tid,{method:"DELETE"}); toast(t("forum_deleted_toast")); navigate("/forum"); }
    catch(e){ errorToast(e.message||"Failed"); }
  };
  renderComments("thread", tid, $("#forumComments"), {ownerId: th.author_id});
}
