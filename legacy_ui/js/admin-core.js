"use strict";
/* ============================ ADMIN (core/orchestrator) ============================
   viewAdmin is the only global other files call (see nav.js). It fetches every
   admin-relevant dataset once per render, then hands each domain its slice of
   data to build/wire — see admin-users.js, admin-moderation.js, admin-previews.js,
   admin-emojis.js, admin-config.js, admin-health.js. */
const _ADMIN_TABS=["overview","users","moderation","previews","emojis","config","health"];
let _adminTab=null;
let _modPollIv=null;

// Shared list-block builder — a title + count, either the list of rendered
// rows or an empty-state message. Used by the moderation and emoji panels,
// which both present several such queues stacked on one page.
function _admModQueue(title, items, empty, body){
  return `<div class="adash-modblock">
    <div class="adash-eyebrow">${esc(title)} <span class="adash-count">${items.length}</span></div>
    ${items.length?`<div class="adash-list">${items.map(body).join("")}</div>`:`<div class="adash-empty">${esc(empty)}</div>`}
  </div>`;
}

async function viewAdmin(main, initialTab){
  if(!ME || !ME.is_admin){ main.innerHTML=`<div class="wrap"><div class="empty"><div class="big">${esc(t("access_denied"))}</div></div></div>`; return; }
  let activeTab = _ADMIN_TABS.includes(initialTab) ? initialTab : "overview";
  _adminTab = activeTab;

  const stat = (label, value, {attn=false, tab=null, sub=""}={})=>`
    <button type="button" class="adash-stat${attn&&value>0?" attn":""}${tab?" jump":""}" ${tab?`data-jump="${tab}"`:""}>
      <span class="adash-stat-num">${value}</span>
      <span class="adash-stat-label">${esc(label)}</span>
      ${sub?`<span class="adash-stat-sub">${esc(sub)}</span>`:""}
    </button>`;

  const navItem=(id,label,badge=0)=>`
    <button type="button" class="adash-navbtn${activeTab===id?" on":""}" data-tab="${id}">
      <span>${esc(label)}</span>${badge>0?`<span class="adash-badge">${badge}</span>`:""}
    </button>`;

  const overviewPanelHTML=(active, admins, chars, pending, flagged, resetReqs, pendingModelReqs, attentionTotal)=>`
    <div class="adash-stats">
      ${stat(t("adm_stat_users"), active.length)}
      ${stat(t("adm_stat_admins"), admins.length)}
      ${stat(t("adm_stat_characters"), chars.length)}
      ${stat(t("adm_stat_pending"), pending.length, {attn:true, tab:"moderation"})}
      ${stat(t("adm_stat_flagged"), flagged.length, {attn:true, tab:"moderation"})}
      ${stat(t("adm_stat_resets"), resetReqs.length, {attn:true, tab:"moderation"})}
      ${stat(t("adm_stat_model_reqs"), pendingModelReqs, {attn:true, tab:"moderation"})}
    </div>
    <div class="adash-attn-banner${attentionTotal>0?" hot":""}">
      <div>
        <div class="adash-attn-eyebrow">${attentionTotal>0?esc(t("adm_needs_attention")):esc(t("adm_stat_all_clear"))}</div>
        <div class="adash-attn-line">${attentionTotal>0
          ? `${pending.length} · ${esc(t("adm_stat_pending").toLowerCase())} &nbsp; ${flagged.length} · ${esc(t("adm_stat_flagged").toLowerCase())} &nbsp; ${resetReqs.length} · ${esc(t("adm_stat_resets").toLowerCase())} &nbsp; ${pendingModelReqs} · ${esc(t("adm_stat_model_reqs").toLowerCase())}`
          : esc(t("adm_nothing_pending"))}</div>
      </div>
      ${attentionTotal>0?`<button type="button" class="btn primary" data-jump="moderation">${esc(t("adm_jump_mod"))}</button>`:""}
    </div>`;

  const render = async () => {
    const [allUsers, flagged, resetReqs, modelReqs, titleReqs, imageReports, contentReports, chars, st,
           previews, loraPreviews, samplerPreviews, schedulerPreviews, upscalerPreviews,
           imagegenOpts, samplersData, allEmojis, upscalerList] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/flagged-endpoints").catch(()=>[]),
      api("/api/admin/password-reset-requests").catch(()=>[]),
      api("/api/admin/model-requests").catch(()=>[]),
      api("/api/admin/title-requests").catch(()=>[]),
      api("/api/admin/image-reports").catch(()=>[]),
      api("/api/admin/content-reports").catch(()=>[]),
      api("/api/characters").catch(()=>[]),
      api("/api/settings").catch(()=>({})),
      api("/api/imagegen/checkpoint-previews").catch(()=>({})),
      api("/api/imagegen/lora-previews").catch(()=>({})),
      api("/api/imagegen/sampler-previews").catch(()=>({})),
      api("/api/imagegen/scheduler-previews").catch(()=>({})),
      api("/api/imagegen/upscaler-previews").catch(()=>({})),
      getImagegenOptions().catch(()=>({checkpoints:[], loras:[]})),
      api("/api/imagegen/samplers").catch(()=>({})),
      api("/api/admin/emojis").catch(()=>[]),
      api("/api/imagegen/upscalers").catch(()=>[]),
    ]);
    const pendingEmojis=allEmojis.filter(e=>e.is_explicit);
    const approvedEmojis=allEmojis.filter(e=>!e.is_explicit);
    const pending = allUsers.filter(u => u.status === "pending");
    const active  = allUsers.filter(u => u.status !== "pending");
    const admins  = active.filter(u => u.is_admin);
    _checkpointPreviews = previews; _loraPreviews = loraPreviews;
    _samplerPreviews = samplerPreviews; _schedulerPreviews = schedulerPreviews;
    _upscalerPreviews = upscalerPreviews;
    const checkpoints = imagegenOpts.checkpoints || [], loraList = imagegenOpts.loras || [];
    const samplerList = samplersData.samplers || [], schedulerList = samplersData.schedulers || [];
    const isDev = ME.role==="dev";
    const pendingModelReqs = modelReqs.filter(m=>m.status==="pending").length;
    const attentionTotal = pending.length + flagged.length + resetReqs.length + pendingModelReqs + titleReqs.length + imageReports.length + contentReports.length + pendingEmojis.length;

    const overviewPanel=overviewPanelHTML(active, admins, chars, pending, flagged, resetReqs, pendingModelReqs, attentionTotal);
    const usersPanel=_admUsersPanelHTML(active, ME);
    const moderationPanel=_admModerationPanelHTML({pending, flagged, resetReqs, modelReqs, titleReqs, imageReports, contentReports, isDev, attentionTotal});
    const previewsPanel=_admPreviewsPanelHTML({checkpoints, loraList, samplerList, schedulerList, upscalerList, previews, loraPreviews, samplerPreviews, schedulerPreviews, upscalerPreviews});
    const emojisPanel=_admEmojisPanelHTML(allEmojis, pendingEmojis, approvedEmojis);
    const configPanel=_admConfigPanelHTML(st);
    const healthPanel=_admHealthPanelHTML();

    const modBadge = attentionTotal;
    main.innerHTML=`<div class="wrap adash">
      <div class="adash-hero">
        <div>
          <div class="page-eyebrow">${esc(t("adm_eyebrow"))}</div>
          <h1 class="page adash-title">${esc(t("adm_title"))}</h1>
          <div class="page-sub">${esc(t("adm_sub"))}</div>
        </div>
      </div>
      <div class="adash-shell">
        <nav class="adash-rail">
          ${navItem("overview", t("adm_nav_overview"))}
          ${navItem("users", t("adm_nav_users"), 0)}
          ${navItem("moderation", t("adm_nav_moderation"), modBadge)}
          ${navItem("previews", t("adm_nav_previews"))}
          ${navItem("emojis", "Emojis & Stickers", pendingEmojis.length)}
          ${navItem("config", t("adm_nav_config"))}
          ${navItem("health", t("adm_nav_health"))}
        </nav>
        <div class="adash-panels">
          <section class="adash-panel" data-panel="overview" ${activeTab==="overview"?"":'style="display:none"'}>${overviewPanel}</section>
          <section class="adash-panel" data-panel="users" ${activeTab==="users"?"":'style="display:none"'}>${usersPanel}</section>
          <section class="adash-panel" data-panel="moderation" ${activeTab==="moderation"?"":'style="display:none"'}>${moderationPanel}</section>
          <section class="adash-panel" data-panel="previews" ${activeTab==="previews"?"":'style="display:none"'}>${previewsPanel}</section>
          <section class="adash-panel" data-panel="emojis" ${activeTab==="emojis"?"":'style="display:none"'}>${emojisPanel}</section>
          <section class="adash-panel" data-panel="config" ${activeTab==="config"?"":'style="display:none"'}>${configPanel}</section>
          <section class="adash-panel" data-panel="health" ${activeTab==="health"?"":'style="display:none"'}>${healthPanel}</section>
        </div>
      </div>
    </div>`;

    const healthApi=_admWireHealth(activeTab);
    const switchTab=id=>{
      activeTab=id; _adminTab=id;
      main.querySelectorAll(".adash-navbtn").forEach(b=>b.classList.toggle("on",b.dataset.tab===id));
      main.querySelectorAll(".adash-panel").forEach(p=>p.style.display=p.dataset.panel===id?"":"none");
      history.replaceState(null,"","/admin"+(id==="overview"?"":"/"+id));
      if(id==="health"){ healthApi.renderHealth(); healthApi.renderLogs(); }
    };
    main.querySelectorAll(".adash-navbtn").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
    main.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>switchTab(b.dataset.jump));
    // Collapsible preview sections (see admin-previews.js's adashSection) —
    // state persists per-section across visits the same way the image-gen
    // studio's own collapsible sections do (store key), open by default.
    main.querySelectorAll(".adash-collapse").forEach(sec=>{
      const key="adashsec:"+sec.dataset.collapseKey;
      const collapsed=store.get(key,"false")==="true";
      sec.classList.toggle("collapsed", collapsed);
      const toggle=sec.querySelector("[data-collapse-toggle]");
      if(!toggle) return;
      toggle.setAttribute("aria-expanded", collapsed?"false":"true");
      toggle.onclick=()=>{
        const c=sec.classList.toggle("collapsed");
        store.set(key, c?"true":"false");
        toggle.setAttribute("aria-expanded", c?"false":"true");
      };
    });

    _admWireUsers(main, allUsers, ME, render);
    _admWireModeration(main, {allUsers, flagged, resetReqs, modelReqs, titleReqs, imageReports, contentReports, isDev}, render);
    _admWirePreviews(main, {previews, loraPreviews, samplerPreviews, schedulerPreviews, upscalerPreviews}, render);
    _admWireEmojis(main, allEmojis, render);
    _admWireConfig(main, st, render);
  };
  render();
  // Moderation queue counts otherwise only ever update on a manual reload —
  // an admin sitting on this tab waiting for new signups/reports has no way
  // to know something landed without refreshing. Self-cleaning poll, gated
  // on the URL actually still being /admin — #main is a single persistent
  // container the router reuses for every page (route() only ever replaces
  // its innerHTML, never removes it), so main.isConnected is true forever
  // regardless of navigation and can't detect "the admin left this page" at
  // all. Without this check the poll kept firing after navigating away and
  // force-overwrote whatever page was open (e.g. a character page) with the
  // admin panel out of nowhere every 20s — a real bug, not theoretical.
  // Skipped while a modal is open so it can't yank focus/scroll out from
  // under whatever the admin is mid-editing.
  // viewAdmin can be re-invoked (leaving /admin and coming back) before the
  // previous poller's own self-clear check gets a chance to tick — clear it
  // explicitly here rather than relying on that race, or two overlapping
  // pollers double up render() calls indefinitely.
  if(_modPollIv) clearInterval(_modPollIv);
  _modPollIv=setInterval(async()=>{
    if(!main.isConnected || !location.pathname.startsWith("/admin")){ clearInterval(_modPollIv); return; }
    // Overview and Moderation are both pure read-only summaries (no form
    // fields an admin could be mid-typing into, unlike Users/Config/Previews)
    // — refreshing either is safe. Restricting this to Moderation only meant
    // pending-item counts sitting on the Overview tab (the badges the admin
    // is most likely watching) silently went stale until a manual reload.
    if((_adminTab!=="moderation" && _adminTab!=="overview") || document.querySelector(".scrim.open")) return;
    // render() rebuilds main.innerHTML from scratch, which silently resets
    // scroll to the top — jarring if an admin is mid-scroll reading the
    // queue when the 20s poll fires. Snapshot/restore the scroll container's
    // position around it (after render, since it's async and the DOM isn't
    // replaced until it resolves) so the poll is invisible unless something
    // actually changed.
    const scroller=document.querySelector(".main");
    const y=scroller?scroller.scrollTop:0;
    await render();
    if(scroller) scroller.scrollTop=y;
  },20000);
}
