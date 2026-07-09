"use strict";
/* ============================ MOBILE DRAWER ============================ */
if(store.get("railCollapsed","false")==="true") document.body.classList.add("rail-collapsed");
const toggleRailCollapsed=()=>{
  const collapsed=document.body.classList.toggle("rail-collapsed");
  store.set("railCollapsed", collapsed?"true":"false");
};
$("#railGlyphBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); toggleRailCollapsed(); });
$("#railCollapseBtn")?.addEventListener("click", toggleRailCollapsed);

if(store.get("recentCollapsed","false")==="true") $("#rail")?.classList.add("recent-collapsed");
$("#recentToggle")?.addEventListener("click", ()=>{
  const rail=$("#rail"); if(!rail) return;
  const collapsed=rail.classList.toggle("recent-collapsed");
  store.set("recentCollapsed", collapsed?"true":"false");
  $("#recentToggle").setAttribute("aria-expanded", collapsed?"false":"true");
});
function openDrawer(){ $("#rail").classList.add("open"); $("#scrimNav").classList.add("open"); }
function closeDrawer(){ $("#rail").classList.remove("open"); $("#scrimNav").classList.remove("open"); }
$("#mHamb")?.addEventListener("click", openDrawer);
$("#scrimNav")?.addEventListener("click", closeDrawer);
$("#mGear")?.addEventListener("click", ()=> $("#settingsBtn")?.click());
$("#tabMenu")?.addEventListener("click", (e)=>{ e.preventDefault(); openDrawer(); });
$("#nav")?.addEventListener("click", (e)=>{ if(e.target.closest("a")) closeDrawer(); });
// #settingsBtn/#themeBtn live in the drawer's footer (not #nav), so tapping
// them on mobile left the drawer open behind whatever they triggered.
$(".rail .foot")?.addEventListener("click", (e)=>{ if(e.target.closest("button")) closeDrawer(); });

/* ============================ EXPLORE (anonymous, read-only) ============================ */
function _exploreShell(){
  document.body.classList.add("unauthed");
  const main=$("#main");
  main.innerHTML=`
    <div class="explore-topbar">
      <a href="/explore" class="brand explore-brand">
        <span class="glyph">❖</span>
        <div class="brand-text">
          <span class="name">StoryHaven AI</span>
          <span class="tagline">${esc(t("tagline"))}</span>
        </div>
      </a>
      <div class="explore-topbar-actions">
        <button type="button" class="btn" id="exploreThemeBtn">${THEME==="dark"?"☾":"☀"}</button>
        <a href="/" class="btn primary explore-signin">${esc(t("explore_signin_register"))}</a>
      </div>
    </div>
    <div id="exploreMain"></div>
    <div class="explore-footnote">${esc(t("explore_nsfw_notice"))}</div>`;
  $("#exploreThemeBtn").onclick=()=>{ toggleTheme(); $("#exploreThemeBtn").textContent = THEME==="dark"?"☾":"☀"; };
  return $("#exploreMain");
}

async function routeExplore(seg){
  const box=_exploreShell();
  try{
    if(seg[0]==="c") return viewExploreCharacter(box, seg[1]);
    if(seg[0]==="u") return viewProfile(box, decodeURIComponent(seg[1]||""));
    return viewExploreCommunity(box);
  }catch(e){
    errorPage(box, {title:"Something went wrong", message:"An error occurred while loading this page.", detail:e.message});
  }
}

async function viewExploreCommunity(main){
  let modeFilter = store.get("exploreMode","all");
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="explore-comm-head">
      <div>
        <div class="page-eyebrow">${esc(t("comm_eyebrow"))}</div>
        <h1 class="page">${esc(t("comm_title"))}</h1>
        <div class="page-sub" id="commSub">${esc(t("comm_sub"))}</div>
      </div>
      <div class="explore-comm-controls">
        ${searchFilterHTML(true)}
        <div class="view-switch" id="modeSwitch" role="group" aria-label="Mode">
          <button type="button" class="vs-btn" data-mode="all">${esc(t("comm_mode_all"))}</button>
          <button type="button" class="vs-btn" data-mode="rpg">${esc(t("badge_rpg"))}</button>
          <button type="button" class="vs-btn" data-mode="character">${esc(t("badge_character"))}</button>
        </div>
      </div>
    </div>
    <div class="catalog" id="catalog"></div>
  </div>`;
  const paintMode=()=>{ $("#modeSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.mode===modeFilter)); };
  $("#modeSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    modeFilter=b.dataset.mode; store.set("exploreMode",modeFilter); paintMode(); render();
  });
  paintMode();
  const state={tab:"bots"};
  const modeSwitch=$("#modeSwitch");
  const syncControls=()=>{
    if(modeSwitch) modeSwitch.style.display=state.tab==="bots"?"":"none";
    const sub=$("#commSub"); if(sub) sub.textContent=t(state.tab==="creators"?"comm_sub_creators":"comm_sub");
  };
  const render=async()=>{
    const box=$("#catalog");
    const {q, tags, creator}=deriveSearch($("#q"));
    if(state.tab==="creators"){
      box.classList.remove("catalog-card");
      box.classList.add("catalog-creators");
      const params=new URLSearchParams(); if(q) params.set("q",q);
      const users=await api("/api/users?"+params);
      if(!users.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(t("empty_creators"))}</div></div>`; return; }
      const r=creatorCatalog(users);
      box.innerHTML=r.html; r.wire(box);
      return;
    }
    box.classList.remove("catalog-creators");
    const params=new URLSearchParams({scope:"community"});
    if(q) params.set("q",q);
    if(tags.length) params.set("tags", tags.join(","));
    if(creator) params.set("creator", creator);
    let chars=await api("/api/characters?"+params);
    if(modeFilter!=="all") chars=chars.filter(c=>(c.mode||"character")===modeFilter);
    box.classList.add("catalog-card");
    if(!chars.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(t("empty_lib"))}</div></div>`; return; }
    const r=_catalogView(chars, "card", id=>navigate("/explore/c/"+id));
    box.innerHTML=r.html; r.wire(box);
  };
  wireSearchFilter(main, state, render, syncControls);
  render();
}

async function viewExploreCharacter(main, cid){
  const [c, lore]=await Promise.all([
    api("/api/characters/"+cid),
    api("/api/characters/"+cid+"/lore").catch(()=>[]),
  ]);
  const heroImg = mediaURL((c.assets||{}).banner||"") || mediaURL((c.assets&&c.assets.stage&&c.assets.stage.default)||"") || mediaURL(c.avatar);
  const hasCustom=(c.presentation_html||"").trim().length>0;
  const exploreDescription = substMacros(c.description, c.name, "You");
  main.innerHTML=`<div class="wrap">
    <div class="doss-hero${nsfwCls(c)}"${heroImg?` style="background-image:url('${esc(heroImg)}')"`:""}><div class="doss-hero-fade"></div></div>
    <div class="doss-card">
      <div class="doss-card-ava">${avatar(c)}</div>
      <div class="doss-card-body">
        <div class="call">${esc(callno(c))}</div>
        <div class="doss-card-row">
          <h1>${esc(c.name)}</h1>
          <div class="doss-actions"><a class="btn primary" href="/">${esc(t("explore_signin_to_chat"))}</a></div>
        </div>
        <div class="meta"><span class="tag mode-tag" style="${c.mode==='rpg'?'background:var(--accent-soft);color:var(--accent-deep);border-color:transparent;':''}">${esc(c.mode==='rpg'?t("badge_rpg"):t("badge_character"))}</span><span class="tag-group">${(c.tags||[]).map(tg=>`<span class="tag">${esc(tg)}</span>`).join("")}</span></div>
        ${c.description?`<div class="doss-desc">${esc(exploreDescription)}</div>`:""}
      </div>
    </div>
    ${(()=>{
      const loreCardHTML = `<div class="lore-card">
        <div class="lore-card-head"><span>${esc(t("doss_lore_card_title"))}</span></div>
        ${lore.length?lore.map(l=>`<div class="lore-link-row" data-lore="${esc(l.id)}">
          ${l.image?`<div class="lore-link-ava"><img class="ava" src="${esc(mediaURL(l.image))}" alt=""></div>`:""}
          <div class="lore-link-info">
            <div class="t">${esc(l.name||(l.keys&&l.keys[0])||l.category||t("doss_lore_untitled"))}</div>
            <div class="s">${esc(l.category||t("doss_lore_group"))}</div>
          </div>
        </div>`).join(""):`<div class="empty"><div class="big">${esc(t("doss_lore_empty"))}</div></div>`}
      </div>`;
      if(hasCustom){
        return `<div class="doss-layout">
          <div class="doss-main"><div class="doss-presentation" id="dossPresentation"></div></div>
          <div class="doss-sidebar">${loreCardHTML}</div>
        </div>`;
      }
      return loreCardHTML ? `<div class="section">${loreCardHTML}</div>` : "";
    })()}
  </div>`;
  if(hasCustom) mountSandboxedHTML($("#dossPresentation"), substituteCharacterTemplate(c.presentation_html, c), {onReady:doc=>wireCardCommentsButtons(doc, "character", cid, {ownerId:c.owner_id})});
  main.querySelectorAll("[data-lore]").forEach(row=>row.onclick=()=>{
    loreEntryModal(cid, lore.find(x=>x.id===row.dataset.lore), false, ()=>{});
  });
}

/* ============================ ROUTER ============================ */
function pathSegments(){ return location.pathname.split("/").filter(Boolean); }
function navigate(path){ history.pushState(null, "", path); route(); }
async function route(){
  closeDrawer();
  if(!ME){
    const seg0=pathSegments();
    // Same reasoning as init(): a shared /c/{cid} or /u/{username} link has to
    // render for a logged-out visitor, not force a login wall — reuse the same
    // read-only explore rendering path /explore/c/{cid} already uses.
    if(seg0[0]==="explore") return routeExplore(seg0.slice(1));
    if(seg0[0]==="c" || seg0[0]==="u") return routeExplore(seg0);
    _showingLogin=false; showLoginScreen();
    return;
  }
  const seg=pathSegments();
  const top=seg[0]||"library";
  document.querySelectorAll("#nav a[data-route], #tabbar a[data-route]").forEach(a=>a.classList.toggle("on", a.dataset.route===(seg.length?top:"library")));
  const main=$("#main");
  if(top!=="chat") ChatState.clear();
  loadRecent();
  refreshNotifCount();
  try{
    if(seg.length===0) return viewLibrary(main);
    if(seg[0]==="community") return viewCommunity(main, seg[1]==="creators"?"creators":seg[1]==="images"?"images":"bots");
    if(seg[0]==="personas") return viewPersonas(main);
    if(seg[0]==="images") return viewImages(main, ["generate","gallery","community"].includes(seg[1])?seg[1]:"generate");
    if(seg[0]==="gallery") return viewImages(main, "gallery");
    if(seg[0]==="imagegen") return viewImages(main, "generate");
    if(seg[0]==="forum" && seg[1]) return viewForumThread(main, seg[1]);
    if(seg[0]==="forum") return viewForum(main);
    if(seg[0]==="u")        return viewProfile(main, decodeURIComponent(seg[1]||""));
    if(seg[0]==="admin")   return viewAdmin(main, seg[1]||"overview");
    if(seg[0]==="create") return viewEditor(main, null);
    if(seg[0]==="edit")   return viewEditor(main, seg[1]);
    if(seg[0]==="c")      return viewDossier(main, seg[1]);
    if(seg[0]==="i")      return viewSharedImage(main, seg[1]);
    if(seg[0]==="chat")   return viewChat(main, seg[1]);
    return errorPage(main, {code:"404", title:"Page not found",
      message:"There's nothing at this address."});
  }catch(e){
    if(e.message==="Not authenticated") return;
    const isOffline = e.message.includes("fetch") || e.message.includes("network") || e.message.includes("Failed");
    errorPage(main, {
      title: isOffline ? "Backend unreachable" : "Something went wrong",
      message: isOffline
        ? "Can't connect to the server. Make sure the backend is running and this page is served from it."
        : "An error occurred while loading this page.",
      detail: e.message,
    });
  }
}
window.addEventListener("popstate", route);
document.addEventListener("click", (e)=>{
  const a=e.target.closest("a");
  if(!a) return;
  if(a.target==="_blank" || a.hasAttribute("download")) return;
  if(e.defaultPrevented || e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href=a.getAttribute("href");
  if(!href || !href.startsWith("/")) return;
  // Real server endpoints (file exports, media) aren't SPA routes — let the
  // browser navigate/download them normally instead of handing them to the
  // client router, which has no view for them and would just 404.
  if(href.startsWith("/api/") || href.startsWith("/media/")) return;
  if(a.origin && a.origin!==location.origin) return;
  e.preventDefault();
  navigate(href);
});
