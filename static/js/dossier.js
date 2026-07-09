"use strict";
/* ============================ DOSSIER ============================ */
async function viewDossier(main, cid, activeCat="__all"){
  const c=await api("/api/characters/"+cid);
  const [sessions, lore, dossUserName]=await Promise.all([
    api("/api/sessions?limit=200&char_id="+encodeURIComponent(cid)),
    api("/api/characters/"+cid+"/lore"),
    getDefaultPersonaName(),
  ]);
  const dossDescription = substMacros(c.description, c.name, dossUserName);
  const heroImg = mediaURL((c.assets||{}).banner||"") || mediaURL((c.assets&&c.assets.stage&&c.assets.stage.default)||"") || mediaURL(c.avatar);
  const hasCustom = (c.presentation_html||"").trim().length>0;
  const heroHTML = `<div class="doss-hero${nsfwCls(c)}"${heroImg?` style="background-image:url('${esc(heroImg)}')"`:""}><div class="doss-hero-fade"></div></div>`;
  const canEdit = c.owner_id===ME.id||ME.is_admin;
  const isOwner = c.owner_id===ME.id;
  const greetingCount = (c.greeting?1:0) + (c.alt_greetings||[]).length;
  const messageCount = sessions.reduce((n,s)=>n+(s.message_count||0),0);
  const createdDate = c.created?new Date(c.created*1000).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"}):"";
  const activity = [...sessions].sort((a,b)=>b.updated-a.updated).slice(0,5);
  main.innerHTML=`<div class="wrap wrap-wide">
    ${heroHTML}
    <div class="doss-card">
      <div class="doss-card-ava">${avatar(c)}</div>
      <div class="doss-card-body">
        <div class="call">${esc(callno(c))}</div>
        <div class="doss-card-row">
          <h1>${esc(c.name)}</h1>
          <div class="doss-actions">
            <button class="btn primary" id="startBtn">▷ ${esc(t("doss_start"))}</button>
            <button class="btn" id="previewBtn">◎ ${esc(t("doss_preview"))}</button>
            <button class="btn" id="shareBtn">⤴ ${esc(t("doss_share"))}</button>
            <button class="btn" id="cmtBtn">💬 ${esc(t("doss_comments"))}</button>
            ${isOwner?`<a class="btn" href="/edit/${c.id}">✎ ${esc(t("doss_edit"))}</a>`:''}
            ${(isOwner||c.allow_download)?`<div class="dd" id="exportDD">
              <button class="btn" id="exportBtn">⤓ ${esc(t("doss_export"))} ▾</button>
              <div class="dd-menu">
                <a href="${API}/api/characters/${c.id}/export?spec=v2">${esc(t("doss_export_v2"))}</a>
                <a href="${API}/api/characters/${c.id}/export?spec=v3">${esc(t("doss_export_v3"))}</a>
                <a class="dd-menu-small" href="${API}/api/characters/${c.id}/export?spec=storyhaven">${esc(t("doss_export_storyhaven"))}</a>
              </div>
            </div>`:''}
            ${canEdit?`<button class="btn danger" id="delBtn">${esc(t("doss_delete"))}</button>`:''}
          </div>
        </div>
        <div class="meta"><span class="tag mode-tag" style="${c.mode==='rpg'?'background:var(--accent-soft);color:var(--accent-deep);border-color:transparent;':''}">${esc(c.mode==='rpg'?t("badge_rpg"):t("badge_character"))}</span><span class="tag-group">${(c.tags||[]).map(tg=>`<span class="tag" data-tag="${esc(tg)}">${esc(tg)}</span>`).join("")}</span></div>
        <div class="doss-stats">
          <span class="doss-stat">▣ <b>${lore.length}</b> ${esc(t("doss_stat_lore"))}</span>
          <span class="doss-stat">✉ <b>${messageCount}</b> ${esc(t("doss_stat_messages"))}</span>
          <span class="doss-stat">◈ <b>${greetingCount}</b> ${esc(t("doss_stat_greetings"))}</span>
          <span class="doss-stat">◷ <b>${sessions.length}</b> ${esc(t("doss_stat_chats"))}</span>
        </div>
        ${createdDate?`<div class="doss-created">${esc(t("doss_created"))} ${esc(createdDate)}</div>`:""}
        ${c.description?`<div class="doss-desc clamped" id="dossDescBrief">${esc(dossDescription)}</div><button class="doss-desc-toggle" id="dossDescToggle">${esc(t("doss_expand"))} ▾</button>`:""}
      </div>
    </div>
    ${(()=>{
      const loreCardHTML = `<div class="lore-card">
          <div class="lore-card-head">
            <span>${esc(t("doss_lore_card_title"))}</span>
            ${isOwner?`<a href="#" id="loreAddBtn" class="lore-add-top">+ ${esc(t("btn_add_entry"))}</a>`:""}
          </div>
          ${lore.length?`<div class="lore-cat-tabs" id="loreCatTabs">
            <button class="lore-cat-tab${activeCat==="__all"?" on":""}" data-cat="__all">${esc(t("doss_lore_all"))}</button>
            ${[...new Set(lore.map(l=>l.category||""))].filter(Boolean).map(cat=>
              `<button class="lore-cat-tab${activeCat===cat?" on":""}" data-cat="${esc(cat)}">${esc(cat)}</button>`
            ).join("")}
            ${lore.some(l=>!l.category)?`<button class="lore-cat-tab${activeCat==="__untagged"?" on":""}" data-cat="__untagged">${esc(t("doss_lore_untagged"))}</button>`:""}
          </div>`:""}
          ${lore.length?lore.map(l=>{
            const rowCat=l.category||"";
            return `<div class="lore-link-row" data-lore="${esc(l.id)}" data-cat="${esc(rowCat)}">
            ${l.image?`<div class="lore-link-ava"><img class="ava" src="${esc(mediaURL(l.image))}" alt=""></div>`:""}
            <div class="lore-link-info">
              <div class="t" data-lorename="${esc(l.id)}">${esc(l.name||(l.keys&&l.keys[0])||l.category||t("doss_lore_untitled"))}</div>
              <div class="s">${esc(l.category||(l.global?t("doss_lore_global"):t("doss_lore_group")))}</div>
            </div>
          </div>`;
          }).join(""):`<div class="empty"><div class="big">${esc(t("doss_lore_empty"))}</div></div>`}
          ${lore.length?`<div class="lore-pager" id="lorePager"></div>`:""}
        </div>`;
      if(hasCustom){
        return `<div class="doss-layout">
          <div class="doss-main">
            <div class="doss-presentation" id="dossPresentation"></div>
          </div>
          <div class="doss-sidebar">${loreCardHTML}</div>
        </div>`;
      }
      return loreCardHTML ? `<div class="section">${loreCardHTML}</div>` : "";
    })()}
  </div>`;

  const cmtBtn=$("#cmtBtn");
  if(cmtBtn){
    cmtBtn.onclick=()=>openCommentsModal("character", cid, {ownerId:c.owner_id});
    updateCommentBtn(cmtBtn, "character", cid);
  }

  if(hasCustom) mountSandboxedHTML($("#dossPresentation"), substituteCharacterTemplate(c.presentation_html, c), {onReady:(doc)=>{
    wireCardCommentsButtons(doc, "character", cid, {ownerId:c.owner_id});
    if(!isOwner) return;
    const reasons=cardComplianceReasons(c.presentation_html, doc, "character");
    if(!reasons.length) return;
    openComplianceModal({
      html: c.presentation_html,
      filename: `${(c.name||"card").replace(/[^a-z0-9]+/gi,"-")}-presentation.html`,
      reasons,
      onEdit: ()=>navigate("/edit/"+c.id),
      onClear: async()=>{
        await api("/api/characters/"+c.id, j("PUT", {...c, presentation_html:""}));
        viewDossier(main, cid, activeCat);
      },
    });
  }});

  localizeContent([
    {el:main.querySelector(".doss-card-row h1"), text:c.name},
    {el:$("#dossDescBrief"), text:c.description},
    ...[...main.querySelectorAll(".doss-card [data-tag]")].map(el=>({el, text:el.dataset.tag})),
    ...[...main.querySelectorAll("[data-lorename]")].map(el=>({el, text:el.textContent})),
  ]).then(()=>{
    const el=$("#dossDescBrief");
    if(el) el.textContent = substMacros(el.textContent, c.name, dossUserName);
  });

  $("#startBtn").onclick=()=>startChat(cid, c.name);
  $("#previewBtn").onclick=()=>previewGreetingsModal(c);
  $("#shareBtn").onclick=()=>{
    const shareUrl=`${location.origin}/c/${cid}`;
    navigator.clipboard?.writeText(shareUrl).then(()=>toast(t("doss_share_copied"))).catch(()=>{});
  };
  const exportDD=$("#exportDD");
  if(exportDD){
    $("#exportBtn").onclick=(ev)=>{ ev.stopPropagation(); const wasOpen=exportDD.classList.contains("open"); closeAllDropdowns(); exportDD.classList.toggle("open", !wasOpen); };
    document.addEventListener("click", ()=>exportDD.classList.remove("open"));
  }
  if(c.owner_id===ME.id||ME.is_admin){
    $("#delBtn").onclick=async()=>{ if(!(await confirmAction($("#delBtn"), "Delete "+c.name+" and all its chats, lore, and memories?")))return;
      await api("/api/characters/"+cid,{method:"DELETE"}); toast("Deleted."); navigate("/"); };
  }
  const descToggle=$("#dossDescToggle"), descBrief=$("#dossDescBrief");
  if(descToggle) descToggle.onclick=()=>{
    const collapsed=descBrief.classList.toggle("clamped");
    descToggle.textContent = collapsed ? `${t("doss_expand")} ▾` : `${t("doss_collapse")} ▴`;
  };
  const LORE_PAGE_SIZE=10;
  let lorePage=1;
  const applyLoreView=()=>{
    const cat=main.querySelector(".lore-cat-tab.on")?.dataset.cat||"__all";
    const rows=[...main.querySelectorAll(".lore-link-row")];
    const matches=rows.filter(row=>{
      const rc=row.dataset.cat;
      return cat==="__all" || (cat==="__untagged" ? !rc : rc===cat);
    });
    const totalPages=Math.max(1,Math.ceil(matches.length/LORE_PAGE_SIZE));
    if(lorePage>totalPages) lorePage=totalPages;
    const start=(lorePage-1)*LORE_PAGE_SIZE;
    rows.forEach(row=>row.style.display="none");
    matches.slice(start,start+LORE_PAGE_SIZE).forEach(row=>row.style.display="");
    const pager=$("#lorePager");
    if(!pager) return;
    pager.innerHTML = totalPages>1 ? `<button class="btn" id="lorePrev"${lorePage<=1?" disabled":""}>‹</button><span>${esc(t("doss_lore_page"))} ${lorePage} / ${totalPages}</span><button class="btn" id="loreNext"${lorePage>=totalPages?" disabled":""}>›</button>` : "";
    if($("#lorePrev")) $("#lorePrev").onclick=()=>{ lorePage--; applyLoreView(); };
    if($("#loreNext")) $("#loreNext").onclick=()=>{ lorePage++; applyLoreView(); };
  };
  applyLoreView();
  main.querySelectorAll(".lore-cat-tab").forEach(tab=>tab.onclick=()=>{
    main.querySelectorAll(".lore-cat-tab").forEach(x=>x.classList.remove("on"));
    tab.classList.add("on");
    lorePage=1;
    applyLoreView();
  });
  const curCat=()=>main.querySelector(".lore-cat-tab.on")?.dataset.cat||"__all";
  main.querySelectorAll("[data-lore]").forEach(row=>row.onclick=async()=>{
    const all=await api("/api/characters/"+cid+"/lore");
    loreEntryModal(cid, all.find(x=>x.id===row.dataset.lore), isOwner, ()=>viewDossier(main,cid,curCat()));
  });
  const addBtn=$("#loreAddBtn");
  if(addBtn) addBtn.onclick=(ev)=>{ ev.preventDefault(); loreModal(cid, null, ()=>viewDossier(main,cid,curCat())); };
}

async function startChat(cid, cname){
  const [personas, pool]=await Promise.all([api("/api/personas"), api("/api/characters/persona-pool")]);
  const chars=pool.filter(pc=>pc.id!==cid);
  const begin=async(pid)=>{ const s=await api(`/api/characters/${cid}/sessions`, j("POST",{persona_id:pid||null})); invalidateRecent(); navigate("/chat/"+s.id); };
  if(!personas.length && !chars.length){ return begin(null); }
  openModal(`<h3>${esc(t("play_as"))}</h3><div id="pp">
    <div class="session-row" data-pid=""><div><div class="t">${esc(t("just_you"))}</div><div class="p">${esc(t("no_persona"))}</div></div></div>
    ${personas.map(p=>`<div class="session-row" data-pid="${p.id}"><div><div class="t">${esc(p.name)}${p.is_default?" · default":""}</div><div class="p">${esc((p.description||"").slice(0,72))}</div></div></div>`).join("")}
  </div>
  ${chars.length?`<div class="hint" style="margin:14px 0 8px;">${esc(t("play_as_character"))}</div><div id="ppChars">
    ${chars.map(pc=>`<div class="session-row" data-char="${pc.id}"><div><div class="t">${esc(pc.name)}</div><div class="p">${esc(logline(pc))}</div></div></div>`).join("")}
  </div>`:""}`);
  document.querySelectorAll("#pp .session-row").forEach(r=>r.onclick=()=>{ closeModal(); begin(r.dataset.pid); });
  document.querySelectorAll("#ppChars .session-row").forEach(r=>r.onclick=async()=>{
    closeModal();
    const p=await api(`/api/characters/${r.dataset.char}/persona`,{method:"POST"});
    begin(p.id);
  });
}
