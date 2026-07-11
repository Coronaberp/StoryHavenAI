"use strict";
/* ============================ NOTIFICATIONS ============================
   Discord-style bell + dropdown panel in the rail foot. The unread count is
   polled on the same 60s cadence as the version watcher and refreshed on every
   SPA navigation; the panel itself is only fetched when opened. */
// Every notification `type` written anywhere in the backend collapses into
// one of these buckets — add new types here as they're introduced, or they
// silently fall under "All" only (still visible, just not filterable).
const _NOTIF_ICON_SHIELD='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
const _NOTIF_ICON_CHAT='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const _NOTIF_ICON_TROPHY='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4a1 1 0 0 0-1 1c0 3 2 5 4 5M17 5h3a1 1 0 0 1 1 1c0 3-2 5-4 5"/></svg>';
function notifCategory(type){
  if((type||"").startsWith("admin_")) return "admin";
  if(type==="comment"||type==="mention") return "comments";
  if(type==="milestone") return "milestones";
  return "";
}
const NOTIF_FILTERS=[
  {key:"all", labelKey:"notif_filter_all", icon:""},
  {key:"admin", labelKey:"notif_filter_admin", icon:_NOTIF_ICON_SHIELD},
  {key:"comments", labelKey:"notif_filter_comments", icon:_NOTIF_ICON_CHAT},
  {key:"milestones", labelKey:"notif_filter_milestones", icon:_NOTIF_ICON_TROPHY},
];
function setNotifBadge(n){
  const b=$("#notifBadge"); if(!b) return;
  if(n>0){ b.textContent=n>99?"99+":String(n); b.hidden=false; }
  else{ b.hidden=true; }
}
async function refreshNotifCount(){
  if(!ME) return;
  try{ const {count}=await api("/api/notifications/unread-count"); setNotifBadge(count); }
  catch(e){ /* transient — retry next tick */ }
}
function closeNotifPanel(){ $("#notifPanel")?.remove(); }
async function openNotifPanel(){
  closeNotifPanel();
  let activeFilter=store.get("notifFilter","all");
  if(!NOTIF_FILTERS.some(f=>f.key===activeFilter)) activeFilter="all";
  const panel=el(`<div id="notifPanel" class="notif-panel" role="dialog" aria-label="${esc(t("notif_title"))}">
    <div class="notif-head">
      <span>${esc(t("notif_title"))}</span>
      <div class="notif-head-actions">
        <button type="button" class="notif-markall" id="notifMarkAll">${esc(t("notif_mark_all_read"))}</button>
        <button type="button" class="notif-markall" id="notifClearAll">${esc(t("notif_clear_all"))}</button>
      </div>
    </div>
    <div class="notif-filters" id="notifFilters">${NOTIF_FILTERS.map(f=>
      `<button type="button" class="notif-filter-pill${f.key===activeFilter?" on":""}" data-f="${f.key}" title="${esc(t(f.labelKey))}" aria-label="${esc(t(f.labelKey))}">${f.icon}${f.icon?"":esc(t(f.labelKey))}</button>`
    ).join("")}</div>
    <div class="notif-list" id="notifList"><div class="notif-empty">…</div></div>
  </div>`);
  document.body.appendChild(panel);
  const btn=$("#notifBtn");
  if(btn){
    const r=btn.getBoundingClientRect();
    panel.style.left=Math.round(r.left)+"px";
    panel.style.bottom=Math.round(window.innerHeight-r.top+8)+"px";
  }
  $("#notifMarkAll").onclick=async()=>{
    try{ await api("/api/notifications/read-all", {method:"POST"}); }catch(e){}
    setNotifBadge(0); openNotifPanel();
  };
  $("#notifClearAll").onclick=async()=>{
    if(!(await confirmAction($("#notifClearAll"), t("notif_clear_all_confirm")))) return;
    try{ await api("/api/notifications", {method:"DELETE"}); }catch(e){}
    setNotifBadge(0); openNotifPanel();
  };
  let items=[], loadFailed=false;
  try{ items=await api("/api/notifications"); }catch(e){ items=[]; loadFailed=true; }
  const list=$("#notifList"); if(!list) return;
  const paintList=()=>{
    if(loadFailed){ list.innerHTML=`<div class="notif-empty">${esc(t("notif_load_error"))} <button type="button" class="btn" id="notifRetryBtn">${esc(t("btn_retry"))}</button></div>`; const rb=$("#notifRetryBtn"); if(rb) rb.onclick=openNotifPanel; return; }
    const shown=activeFilter==="all" ? items : items.filter(n=>notifCategory(n.type)===activeFilter);
    if(!shown.length){ list.innerHTML=`<div class="notif-empty">${esc(t("notif_empty"))}</div>`; return; }
    list.innerHTML=shown.map(n=>`
      <button type="button" class="notif-item${n.read?"":" unread"}" data-id="${esc(n.id)}" data-link="${esc(n.link||"")}">
        <span class="notif-dot"></span>
        <span class="notif-body">
          <span class="notif-item-title">${esc(n.title||"")}</span>
          ${n.body?`<span class="notif-item-text">${esc(n.body)}</span>`:""}
          <span class="notif-item-time">${esc(timeAgo(n.created))}</span>
        </span>
      </button>`).join("");
    list.querySelectorAll(".notif-item").forEach(it=>{
      it.onclick=async()=>{
        const id=it.dataset.id, link=it.dataset.link;
        if(it.classList.contains("unread")){
          it.classList.remove("unread");
          try{ await api(`/api/notifications/${id}/read`, {method:"POST"}); }catch(e){}
          refreshNotifCount();
        }
        closeNotifPanel();
        if(link) navigate(link);
      };
    });
  };
  $("#notifFilters").querySelectorAll(".notif-filter-pill").forEach(p=>p.onclick=()=>{
    activeFilter=p.dataset.f; store.set("notifFilter",activeFilter);
    $("#notifFilters").querySelectorAll(".notif-filter-pill").forEach(x=>x.classList.toggle("on",x===p));
    paintList();
  });
  if(!items.length){ list.innerHTML=`<div class="notif-empty">${esc(t("notif_empty"))}</div>`; return; }
  paintList();
}
$("#notifBtn")?.addEventListener("click", (e)=>{
  e.preventDefault(); e.stopPropagation();
  if($("#notifPanel")) closeNotifPanel(); else openNotifPanel();
});
document.addEventListener("click", (e)=>{
  const p=$("#notifPanel"); if(!p) return;
  if(!p.contains(e.target) && !e.target.closest("#notifBtn")) closeNotifPanel();
});
