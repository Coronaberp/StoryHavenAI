"use strict";
/* ============================ LIBRARY ============================ */
function _catalogView(chars, view, linkFn){
  if(!chars.length) return null;
  const tagSpan=t=>`<span class="tag tag-filter" data-tag="${esc(t)}">${esc(t)}</span>`;
  const html = view==="card" ? chars.map(c=>`
    <div class="card-entry" data-id="${c.id}">
      <div class="card-media">
        ${avatar(c,"card-ava")}
        <div class="card-fade"></div>
      </div>
      <div class="card-body">
        <div class="meta"><span class="tag card-chats">💬 ${c.chats||0}</span>${(c.tags||[]).slice(0,3).map(tagSpan).join("")}</div>
        <h3>${esc(c.name)}</h3>
        <p class="log">${esc(logline(c))}</p>
        <span class="by">${esc(t("by_word"))} ${c.owner_username?`<a class="by-link" href="/u/${encodeURIComponent(c.owner_username)}" data-creator="${esc(c.owner_username)}" onclick="event.stopPropagation()">${esc(c.creator||c.owner_username)}</a>`:esc(c.creator||"you")}</span>
      </div>
    </div>`).join("") : chars.map(c=>`
    <div class="entry" data-id="${c.id}">
      <div>
        <div class="call">${esc(callno(c))}</div>
        <h3>${esc(c.name)}</h3>
        <p class="log">${esc(logline(c))}</p>
        <div class="meta">
          ${(c.tags||[]).slice(0,4).map(tagSpan).join("")}
          <span class="by">${c.chats||0} ${esc(t("chats_word"))} · ${esc(t("by_word"))} ${esc(c.creator||"you")}</span>
        </div>
      </div>
      ${avatar(c)}
    </div>`).join("");
  return {html, wire: box => {
    localizeContent([...box.querySelectorAll(".entry, .card-entry")].flatMap(e=>{
      const c=chars.find(x=>x.id===e.dataset.id)||{};
      return [{el:e.querySelector(".log"), text:logline(c)},
              {el:e.querySelector("h3"),   text:c.name||""}];
    }).concat([...box.querySelectorAll(".tag-filter")].map(p=>({el:p, text:p.dataset.tag}))));
    box.querySelectorAll(".entry, .card-entry").forEach(e=>e.onclick=()=>linkFn(e.dataset.id));
    box.querySelectorAll(".tag-filter").forEach(pill=>pill.onclick=e=>{
      e.stopPropagation();
      if($("#q")) applyTagFilter(pill.dataset.tag);
    });
    box.querySelectorAll(".by-link").forEach(link=>link.addEventListener("click", e=>{
      // On a browse page (a search box is present) a creator link filters the
      // catalog by that creator; elsewhere it still navigates to the profile.
      const qbox=$("#q");
      if(!qbox || !link.dataset.creator) return;
      e.preventDefault(); e.stopPropagation();
      insertPill(qbox, "creator", link.dataset.creator);
      qbox.dispatchEvent(new Event("input"));
    }));
    box.querySelectorAll(".card-media img.card-ava").forEach(img=>tintCardMedia(img));
  }};
}

const FILTER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`;

/* ---------- search box with inline tag:/creator: pills ----------
   #q is a contenteditable div, not an <input>, so a `tag:X` / `creator:X`
   token can render as a real pill element instead of literal text — a plain
   input can't mix rich pill nodes with editable plain text. Content model:
   a sequence of text nodes (the plaintext query) interleaved with
   `.qpill[data-type][data-value]` spans (contenteditable=false, atomic).
   Typing "tag:Foo " or "creator:Foo " auto-converts the just-typed segment
   into a pill the instant the terminating space/enter is hit — the literal
   "tag:Foo" text is only ever visible mid-keystroke, never at rest. */

function qpillNode(type, value){
  const span=document.createElement("span");
  span.className="qpill qpill-"+type;
  span.contentEditable="false";
  span.dataset.type=type;
  span.dataset.value=value;
  const label=document.createElement("span");
  label.className="qpill-label";
  label.textContent=(type==="creator"?"@":"")+value;
  const x=document.createElement("button");
  x.type="button"; x.className="qpill-x"; x.setAttribute("aria-label","Remove"); x.textContent="✕";
  span.append(label, x);
  return span;
}

// Reads the current pills+text out of the contenteditable box.
function deriveSearch(box){
  const tags=[]; let creator=""; let text="";
  box.childNodes.forEach(n=>{
    if(n.nodeType===Node.TEXT_NODE){ text+=n.textContent; return; }
    if(n.nodeType===Node.ELEMENT_NODE && n.classList.contains("qpill")){
      if(n.dataset.type==="tag") tags.push(n.dataset.value); else creator=n.dataset.value;
    }
  });
  return {q:text.replace(/\s+/g," ").trim(), tags, creator};
}

function placeCaretAfter(node){
  const r=document.createRange(), sel=window.getSelection();
  r.setStartAfter(node); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

// Appends a real pill at the end of the box (used by entry points that already
// know the value: tag pill clicks, creator link clicks, dropdown-row picks
// made after typing). Followed by a space text node so typing continues past it.
function insertPill(box, type, value){
  if(!value) return;
  box.focus();
  const trailing=document.createTextNode(" ");
  box.append(qpillNode(type, value), trailing);
  placeCaretAfter(trailing);
}

// Inserts a plain (still-editable) "tag:" / "creator:" prefix at the end for
// the user to type a value after — used only by the filter-dropdown rows,
// which don't know a value yet. This text auto-converts to a pill on the
// next space/enter, same as if the user had typed it from scratch.
function insertTypedPrefix(box, prefix){
  box.focus();
  const needsSpace = box.lastChild && box.lastChild.nodeType===Node.TEXT_NODE
    && box.lastChild.textContent && !/\s$/.test(box.lastChild.textContent);
  const t=document.createTextNode((needsSpace?" ":"")+prefix);
  box.append(t);
  placeCaretAfter(t);
}

// Route a tag-pill click (from a card anywhere on a browse page) into the page
// search box as a real tag pill and re-run the search.
function applyTagFilter(tag){
  const box=$("#q"); if(!box) return;
  insertPill(box, "tag", tag);
  box.dispatchEvent(new Event("input"));
}

// Looks at the text node the caret sits in and converts a trailing
// "tag:Foo"/"creator:Foo" token (right before the caret) into a pill, called
// right as the user finishes typing the token (on space/enter).
function convertPendingToken(box){
  const sel=window.getSelection();
  if(!sel.rangeCount) return false;
  const range=sel.getRangeAt(0);
  const node=range.startContainer;
  if(node.nodeType!==Node.TEXT_NODE || node.parentNode!==box) return false;
  const before=node.textContent.slice(0, range.startOffset);
  const m=before.match(/(^|\s)(tag|creator):(\S+)$/i);
  if(!m) return false;
  const type=m[2].toLowerCase(), value=m[3];
  const start=before.length-m[0].length+m[1].length;
  const after=node.textContent.slice(range.startOffset);
  const keepBefore=node.textContent.slice(0, start);
  node.textContent=keepBefore;
  const pill=qpillNode(type, value);
  const rest=document.createTextNode(" "+after.replace(/^\s+/,""));
  node.after(pill, rest);
  const r=document.createRange();
  r.setStart(rest, Math.min(1, rest.textContent.length));
  r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
  return true;
}

function searchFilterHTML(showTabs){
  return `<div class="search searchf">
    <span class="ic">⌕</span>
    <div id="q" class="searchf-input" contenteditable="true" role="textbox" aria-multiline="false" data-placeholder="${esc(t("search_placeholder"))}"></div>
    <button type="button" class="searchf-btn" id="filterBtn" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t("browse_filters"))}" title="${esc(t("browse_filters"))}">${FILTER_ICON}</button>
    <div class="dd-menu searchf-menu" id="filterMenu" role="menu">
      <div class="searchf-title">${esc(t("browse_filters"))}</div>
      ${showTabs?`<div class="searchf-tabs" id="browseTabs">
        <button type="button" data-tab="bots" class="on">${esc(t("browse_tab_bots"))}</button>
        <button type="button" data-tab="creators">${esc(t("browse_tab_creators"))}</button>
        <button type="button" data-tab="images">${esc(t("browse_tab_images"))}</button>
      </div>`:""}
      <button type="button" class="searchf-row" data-insert="creator:">
        <span class="searchf-row-ic">👤</span>
        <span><b>${esc(t("browse_filter_creator"))}</b><em>creator: username</em></span>
      </button>
      <button type="button" class="searchf-row" data-insert="tag:">
        <span class="searchf-row-ic">🏷️</span>
        <span><b>${esc(t("browse_filter_tag"))}</b><em>tag: tagname</em></span>
      </button>
    </div>
  </div>`;
}

// Wires the search box + filter popover. `state` holds only the browse tab
// (bots/creators); the tag/creator filters live entirely as pills in the box.
function wireSearchFilter(scope, state, render, onTabChange){
  const box=scope.querySelector("#q");
  const btn=scope.querySelector("#filterBtn");
  const wrap=scope.querySelector(".searchf");
  const menu=scope.querySelector("#filterMenu");
  const paintBadge=()=>{
    const f=deriveSearch(box);
    const n=f.tags.length+(f.creator?1:0);
    btn.classList.toggle("active", n>0);
    btn.innerHTML=FILTER_ICON+(n>0?`<span class="searchf-count">${n}</span>`:"");
  };
  paintBadge();
  btn.onclick=e=>{ e.stopPropagation(); const open=wrap.classList.toggle("open"); btn.setAttribute("aria-expanded", open?"true":"false"); };
  menu.onclick=e=>{
    e.stopPropagation();
    const row=e.target.closest("[data-insert]");
    if(!row) return;
    wrap.classList.remove("open"); btn.setAttribute("aria-expanded","false");
    insertTypedPrefix(box, row.dataset.insert);
  };
  document.addEventListener("click", ()=>{ wrap.classList.remove("open"); btn.setAttribute("aria-expanded","false"); });
  const tabs=scope.querySelector("#browseTabs");
  if(tabs) tabs.onclick=e=>{
    const b=e.target.closest("[data-tab]"); if(!b) return;
    e.stopPropagation();
    state.tab=b.dataset.tab;
    tabs.querySelectorAll("button").forEach(x=>x.classList.toggle("on", x===b));
    if(onTabChange) onTabChange();
    render();
  };
  box.addEventListener("click", e=>{
    const x=e.target.closest(".qpill-x"); if(!x) return;
    e.stopPropagation();
    x.closest(".qpill").remove();
    paintBadge(); render();
  });
  box.addEventListener("keydown", e=>{
    if(e.key===" " || e.key==="Enter"){
      if(e.key==="Enter") e.preventDefault();
      if(convertPendingToken(box)){
        if(e.key===" ") e.preventDefault();
        paintBadge();
        clearTimeout(qT); qT=setTimeout(render,150);
      }
      return;
    }
    if(e.key==="Backspace"){
      const sel=window.getSelection();
      if(!sel.rangeCount || !sel.isCollapsed) return;
      const r=sel.getRangeAt(0);
      let killPill=null;
      if(r.startContainer===box){
        const prev=box.childNodes[r.startOffset-1];
        if(prev && prev.nodeType===Node.ELEMENT_NODE && prev.classList.contains("qpill")) killPill=prev;
      }else if(r.startContainer.nodeType===Node.TEXT_NODE && r.startOffset===0){
        const prev=r.startContainer.previousSibling;
        if(prev && prev.nodeType===Node.ELEMENT_NODE && prev.classList.contains("qpill")) killPill=prev;
      }
      if(killPill){ e.preventDefault(); killPill.remove(); paintBadge();
        clearTimeout(qT); qT=setTimeout(render,150); }
    }
  });
  let qT;
  box.addEventListener("input",()=>{
    paintBadge();
    clearTimeout(qT); qT=setTimeout(render,200);
  });
}

function creatorCatalog(users){
  const html=users.map(u=>{
    const c1=u.banner_color||"#E3BD6C", c2=u.accent_color||u.banner_color||"#A97F2C";
    const bg=u.banner_img
      ? `url('${esc(mediaURL(u.banner_img))}') center/cover`
      : `linear-gradient(120deg, ${esc(c1)}, ${esc(c2)})`;
    const avaHTML=u.avatar
      ? `<img class="ava${nsfwCls({is_explicit:u.is_explicit})}" src="${esc(mediaURL(u.avatar))}" alt="">`
      : `<div class="ava mono cc-ava-fallback">${esc((u.display_name||u.username||"?")[0].toUpperCase())}</div>`;
    return `
    <div class="creator-card" data-user="${esc(u.username)}" style="--cc-banner:${bg};">
      ${avaHTML}
      <div class="cc-body">
        <div class="cc-name">${esc(u.display_name||u.username)}${(ME&&ME.username===u.username)?`<span class="cc-you-tag">${esc(t("cc_you"))}</span>`:""}</div>
        <div class="cc-user">@${esc(u.username)}</div>
        ${u.bio?`<div class="cc-bio">${esc(u.bio)}</div>`:""}
      </div>
      <div class="cc-count">${u.public_characters} ${esc(t("browse_creator_bots"))}</div>
    </div>`;
  }).join("");
  return {html, wire:box=>box.querySelectorAll(".creator-card").forEach(c=>c.onclick=()=>navigate("/u/"+encodeURIComponent(c.dataset.user)))};
}

async function viewLibrary(main){
  let view = store.get("libView","list");
  let showDrafts = false;
  const drafts = await api("/api/characters?scope=drafts").catch(()=>[]);
  main.innerHTML=`<div class="wrap">
    <div class="page-eyebrow">${esc(t("lib_eyebrow"))}</div>
    <h1 class="page">${esc(t("lib_title"))}</h1>
    <div class="page-sub">${esc(t("lib_sub"))}</div>
    ${drafts.length ? `<div class="seg lib-tabs" id="libTabs">
      <button type="button" class="seg-btn on" data-tab="all"><b>${esc(t("lib_tab_all"))}</b></button>
      <button type="button" class="seg-btn" data-tab="drafts"><b>${esc(t("lib_tab_pending"))} (${drafts.length})</b></button>
    </div>` : ""}
    <div class="toolbar">
      ${searchFilterHTML(false)}
      <div class="view-switch" id="viewSwitch" role="group" aria-label="Layout">
        <button type="button" class="vs-btn" data-view="list" title="${esc(t("view_list"))}">☰</button>
        <button type="button" class="vs-btn" data-view="card" title="${esc(t("view_card"))}">▦</button>
      </div>
      <a class="btn primary" href="/create">+ ${esc(t("btn_new"))}</a>
    </div>
    <div class="catalog" id="catalog"></div>
  </div>`;
  const paintSwitch=()=>{ $("#viewSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.view===view)); };
  $("#viewSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    view=b.dataset.view; store.set("libView",view); paintSwitch(); render();
  });
  paintSwitch();
  if(drafts.length) $("#libTabs").addEventListener("click", e=>{
    const b=e.target.closest(".seg-btn"); if(!b) return;
    showDrafts = b.dataset.tab==="drafts";
    $("#libTabs").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x===b));
    render();
  });
  const render=async()=>{
    const box=$("#catalog");
    box.classList.toggle("catalog-card", view==="card");
    if(showDrafts){
      // Pending drafts go straight to the editor, not the normal character
      // page — there's nothing finished to view yet, just unfinished fields
      // to pick back up.
      if(!drafts.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(t("lib_no_drafts"))}</div></div>`; return; }
      const r=_catalogView(drafts, view, id=>navigate("/edit/"+id));
      box.innerHTML=r.html; r.wire(box);
      return;
    }
    const {q, tags, creator}=deriveSearch($("#q"));
    const params=new URLSearchParams({scope:"mine"});
    if(q) params.set("q",q);
    if(tags.length) params.set("tags", tags.join(","));
    if(creator) params.set("creator", creator);
    const chars=await api("/api/characters?"+params);
    const hasFilter=q||tags.length||creator;
    if(!chars.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(hasFilter?t("empty_search"):t("empty_lib"))}</div>${hasFilter?"":esc(t("empty_lib_hint"))}</div>`; return; }
    const r=_catalogView(chars, view, id=>navigate("/c/"+id));
    box.innerHTML=r.html; r.wire(box);
  };
  wireSearchFilter(main, {tab:"bots"}, render);
  render();
}

async function viewCommunity(main, initialTab="bots"){
  let view = store.get("libView","list");
  const nsfwUnlocked = !!(ME && ME.nsfw_allowed);
  // Until a user has actually opted into mature content (Settings), don't even
  // show a NSFW/All filter — picking it wouldn't do anything but click through
  // blurred cards that gate them right back, which just invites doing that.
  let rating = nsfwUnlocked ? store.get("commRating","sfw") : "sfw";
  let modeFilter = store.get("commMode","all"); // "all" | "rpg" | "character"
  main.innerHTML=`<div class="wrap wrap-wide">
    <div class="page-eyebrow">${esc(t("comm_eyebrow"))}</div>
    <h1 class="page">${esc(t("comm_title"))}</h1>
    <div class="page-sub">${esc(t("comm_sub"))}</div>
    <div class="toolbar">
      ${searchFilterHTML(true)}
      ${nsfwUnlocked ? `<div class="view-switch" id="ratingSwitch" role="group" aria-label="Rating">
        <button type="button" class="vs-btn" data-rating="sfw">${esc(t("comm_sfw"))}</button>
        <button type="button" class="vs-btn" data-rating="nsfw">${esc(t("comm_nsfw"))}</button>
        <button type="button" class="vs-btn" data-rating="both">${esc(t("comm_mode_all"))}</button>
      </div>` : ""}
      <div class="view-switch" id="modeSwitch" role="group" aria-label="Mode">
        <button type="button" class="vs-btn" data-mode="all">${esc(t("comm_mode_all"))}</button>
        <button type="button" class="vs-btn" data-mode="rpg">${esc(t("badge_rpg"))}</button>
        <button type="button" class="vs-btn" data-mode="character">${esc(t("badge_character"))}</button>
      </div>
      <div class="view-switch" id="viewSwitch" role="group" aria-label="Layout">
        <button type="button" class="vs-btn" data-view="list" title="${esc(t("view_list"))}">☰</button>
        <button type="button" class="vs-btn" data-view="card" title="${esc(t("view_card"))}">▦</button>
      </div>
      <div class="view-switch" id="archSwitch" role="group" aria-label="Architecture" style="display:none;">
        <button type="button" class="vs-btn" data-arch="">${esc(t("comm_mode_all"))}</button>
        ${MODEL_CATEGORY_TABS.map(c=>`<button type="button" class="vs-btn" data-arch="${c}">${esc(modelCategoryLabel(c))}</button>`).join("")}
      </div>
    </div>
    <div class="catalog" id="catalog"></div>
  </div>`;
  const paintSwitch=()=>{ $("#viewSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.view===view)); };
  $("#viewSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    view=b.dataset.view; store.set("libView",view); paintSwitch(); render();
  });
  paintSwitch();
  if(nsfwUnlocked){
    const paintRating=()=>{ $("#ratingSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.rating===rating)); };
    $("#ratingSwitch").addEventListener("click", e=>{
      const b=e.target.closest(".vs-btn"); if(!b) return;
      rating=b.dataset.rating; store.set("commRating",rating); paintRating(); render();
    });
    paintRating();
  }
  const paintMode=()=>{ $("#modeSwitch").querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.mode===modeFilter)); };
  $("#modeSwitch").addEventListener("click", e=>{
    const b=e.target.closest(".vs-btn"); if(!b) return;
    modeFilter=b.dataset.mode; store.set("commMode",modeFilter); paintMode(); render();
  });
  paintMode();
  let archFilter=store.get("commArch","");
  const state={tab:initialTab};
  const modeSwitch=$("#modeSwitch"), ratingSwitch=$("#ratingSwitch"), viewSwitch=$("#viewSwitch"), archSwitch=$("#archSwitch");
  const paintArch=()=>{ if(archSwitch) archSwitch.querySelectorAll(".vs-btn").forEach(b=>b.classList.toggle("on", b.dataset.arch===archFilter)); };
  if(archSwitch){
    archSwitch.addEventListener("click", e=>{
      const b=e.target.closest(".vs-btn"); if(!b) return;
      archFilter=b.dataset.arch; store.set("commArch",archFilter); paintArch(); render();
    });
    paintArch();
  }
  const syncControls=()=>{
    // Mode (RPG/Character) and layout (list/card) only make sense for the
    // character catalog. Rating (SFW/NSFW/All) is just as relevant for
    // images as for characters, though, so that one stays available there too.
    const bots=state.tab==="bots";
    const images=state.tab==="images";
    [modeSwitch, viewSwitch].forEach(el=>{ if(el) el.style.display=bots?"":"none"; });
    if(ratingSwitch) ratingSwitch.style.display=(bots||images)?"":"none";
    if(archSwitch) archSwitch.style.display=images?"":"none";
    const sub=$("#commSub"); if(sub) sub.textContent=t(bots?"comm_sub":images?"comm_sub_images":"comm_sub_creators");
    // /community/characters and /community/creators are real, bookmarkable/
    // shareable paths — render() below keeps this (and the ?query= search
    // param) in sync on every render, this just covers the initial paint
    // before the first render() call has run.
  };
  const render=async()=>{
    const box=$("#catalog");
    const {q, tags, creator}=deriveSearch($("#q"));
    const qs=new URLSearchParams(); if(q) qs.set("query",q);
    const path="/community/"+(state.tab==="creators"?"creators":state.tab==="images"?"images":"characters");
    history.replaceState(null,"",path+(qs.toString()?"?"+qs:""));
    if(state.tab==="images"){
      box.classList.remove("catalog-card","catalog-creators");
      let imgs=await api("/api/imagegen/community").catch(()=>[]);
      // No server-side filtering for this endpoint — applied client-side
      // instead, same idea as the "creators" tab's own q= filtering.
      if(rating!=="both") imgs=imgs.filter(s=>rating==="nsfw" ? !!s.is_explicit : !s.is_explicit);
      if(archFilter){
        const {previews}=await getImagegenOptions().catch(()=>({previews:{}}));
        imgs=imgs.filter(s=>modelHasCategory(s.checkpoint,previews,archFilter));
      }
      if(creator) imgs=imgs.filter(s=>(s.owner_username||"").toLowerCase()===creator.toLowerCase());
      if(q){
        const ql=q.toLowerCase();
        imgs=imgs.filter(s=>(s.owner_username||"").toLowerCase().includes(ql)
          || (s.owner_display_name||"").toLowerCase().includes(ql)
          || (s.positive||"").toLowerCase().includes(ql));
      }
      if(!imgs.length){ box.innerHTML=`<div class="empty"><div class="big">${esc((q||tags.length||creator)?t("empty_search"):t("ig_community_empty"))}</div></div>`; return; }
      box.innerHTML=`<div class="ig-masonry" id="commImagesGrid">${imgs.map(s=>igMasonryCard(s,{community:true, ownerInfo:s})).join("")}</div>`;
      const byId=new Map(imgs.map(s=>[s.id,s]));
      $("#commImagesGrid")?.addEventListener("click", e=>{
        const card=e.target.closest(".ig-mcard"); if(!card) return;
        if(!e.target.closest("[data-act='ig-view']")) return;
        const s=byId.get(card.dataset.iid); if(!s) return;
        if(!nsfwCanShow({is_explicit:s.is_explicit})) return;
        imageDetailModal({id:s.id, image:s.image, image_positive:s.positive, image_negative:s.negative,
          image_ts:s.created, checkpoint:s.checkpoint, loras:s.loras, is_explicit:s.is_explicit, human_reviewed:s.human_reviewed,
          sampler:s.sampler, scheduler:s.scheduler, steps:s.steps, is_img2img:s.is_img2img},
          {owner:{name:s.owner_display_name||s.owner_username, username:s.owner_username, avatar:s.owner_avatar}, ownerId:s.user_id, shareable:true, reportable:true});
      });
      return;
    }
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
    if(rating!=="both") chars=chars.filter(c=>rating==="nsfw" ? !!c.is_explicit : !c.is_explicit);
    if(modeFilter!=="all") chars=chars.filter(c=>(c.mode||"character")===modeFilter);
    box.classList.toggle("catalog-card", view==="card");
    const hasFilter=q||tags.length||creator;
    if(!chars.length){ box.innerHTML=`<div class="empty"><div class="big">${esc(hasFilter?t("empty_search"):t("empty_comm"))}</div>${hasFilter?"":esc(t("empty_comm_hint"))}</div>`; return; }
    const r=_catalogView(chars, view, id=>navigate("/c/"+id));
    box.innerHTML=r.html; r.wire(box);
  };
  const initialQuery=new URLSearchParams(location.search).get("query");
  if(initialQuery) $("#q").textContent=initialQuery;
  wireSearchFilter(main, state, render, syncControls);
  // wireSearchFilter only calls syncControls on a tab-button click, never on
  // first mount — without this, landing directly on /community/images (or
  // /creators) via a real navigation/link never applies the tab-specific
  // control visibility until the user manually clicks a tab in the dropdown.
  syncControls();
  render();
}

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
