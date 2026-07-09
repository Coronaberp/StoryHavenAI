"use strict";
/* ============================ ADMIN ============================ */
const _ADMIN_TABS=["overview","users","moderation","previews","emojis","config","health"];
let _adminTab=null;
const _mrKeys={};
async function viewAdmin(main, initialTab){
  if(!ME || !ME.is_admin){ main.innerHTML=`<div class="wrap"><div class="empty"><div class="big">${esc(t("access_denied"))}</div></div></div>`; return; }
  let activeTab = _ADMIN_TABS.includes(initialTab) ? initialTab : "overview";
  _adminTab = activeTab;

  // local form helpers (mirrors of the ones the Settings modal uses) for the
  // instance-configuration panel that moved out of Settings and into here.
  const f=(id,label,val,hint="")=>`<div class="field" style="margin:0 0 12px"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label><input type="text" id="${id}" value="${esc(val??"")}"></div>`;
  const row=(...items)=>`<div style="display:grid;grid-template-columns:repeat(${items.length},1fr);gap:10px">${items.join("")}</div>`;
  const sf=(id,label,val,{min=0,max=1,step=0.01,hint="",fallback=0}={})=>{
    const has=val!==""&&val!==null&&val!==undefined; const rangeVal=has?val:fallback;
    return `<div class="field slider-field"><label>${label}${hint?` <span class="hint">${hint}</span>`:""}</label>
      <div class="slider-row">
        <input type="range" class="sf-range" data-target="${id}" min="${min}" max="${max}" step="${step}" value="${rangeVal}">
        <input type="number" id="${id}" class="sf-num" min="${min}" max="${max}" step="${step}" value="${has?esc(val):""}" placeholder="${has?"":rangeVal}">
      </div></div>`;
  };
  const sliderGrid=(...items)=>`<div class="slider-grid">${items.join("")}</div>`;
  const fillModelList=(listId, inputId, models)=>{
    const el=$("#"+listId); if(!el) return;
    el.innerHTML=`<button class="model-pill-close" type="button" title="Dismiss">×</button>`
      +models.map(m=>`<button class="model-pill" type="button">${esc(m)}</button>`).join("");
    el.style.display="flex";
    el.querySelector(".model-pill-close").onclick=()=>{ el.style.display="none"; };
    el.querySelectorAll(".model-pill").forEach(p=>p.onclick=()=>{
      const inp=$("#"+inputId); if(inp){ inp.value=p.textContent; inp.dispatchEvent(new Event("input")); }
      el.style.display="none";
    });
  };
  const kobold="http://koboldcpp:5001/v1";

  const render = async () => {
    const [allUsers, flagged, resetReqs, modelReqs, titleReqs, imageReports, chars, st,
           previews, loraPreviews, samplerPreviews, schedulerPreviews, upscalerPreviews,
           imagegenOpts, samplersData, allEmojis, upscalerList] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/flagged-endpoints").catch(()=>[]),
      api("/api/admin/password-reset-requests").catch(()=>[]),
      api("/api/admin/model-requests").catch(()=>[]),
      api("/api/admin/title-requests").catch(()=>[]),
      api("/api/admin/image-reports").catch(()=>[]),
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
    const isDev = ME.username==="zukaarimoto";
    const pendingModelReqs = modelReqs.filter(m=>m.status==="pending").length;
    const attentionTotal = pending.length + flagged.length + resetReqs.length + pendingModelReqs + titleReqs.length + imageReports.length + pendingEmojis.length;

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

    // ---- Overview panel ----
    const overviewPanel=`
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

    // ---- Users panel ----
    const usersPanel=`
      <div class="adash-panel-head">
        <div><div class="adash-eyebrow">${esc(t("adm_nav_users"))}</div><h2 class="adash-h2">${esc(t("adm_users"))} <span class="adash-count">${active.length}</span></h2></div>
        <button class="btn primary" id="createUserBtn">+ ${esc(t("adm_new_user"))}</button>
      </div>
      <div class="adash-list">
        ${active.map(u=>`
          <div class="adash-rowcard">
            <div class="adash-rowmain">
              ${avatar({name:u.username, avatar:u.avatar}, "adash-uava")}
              <div>
                <div class="adash-rowtitle">${esc(u.username)}${u.identity_label?` <span class="adash-tag ident" title="Admin identity note">${esc(u.identity_label)}</span>`:""}${u.id===ME.id?` <span class="adash-tag">${esc(t("adm_you"))}</span>`:""}${u.is_admin?` <span class="adash-tag gold">${esc(u.username==="zukaarimoto"?"Dev":t("adm_admin"))}</span>`:""}${u.status==="suspended"?` <span class="adash-tag" style="background:var(--danger,#b42318);color:#fff;">suspended</span>`:""}</div>
                <div class="adash-rowsub mono">${esc(u.id.slice(0,8))}…</div>
                ${u.status==="suspended"&&u.suspension_reason?`<div class="adash-rowsub">Reason: ${esc(u.suspension_reason)}</div>`:""}
              </div>
            </div>
            <div class="adash-rowactions">
              <button class="btn" data-notes="${u.id}">Notes</button>
              <button class="btn" data-resetpw="${u.id}">${esc(t("adm_reset_pw"))}</button>
              ${u.is_admin
                ? (u.id!==ME.id ? `<button class="btn" data-role="${u.id}" data-toadmin="false">${esc(t("adm_demote"))}</button>` : "")
                : `<button class="btn" data-role="${u.id}" data-toadmin="true">${esc(t("adm_make_admin"))}</button>`}
              ${u.id!==ME.id ? (u.status==="suspended"
                ? `<button class="btn" data-unsuspend="${u.id}">Unsuspend</button>`
                : `<button class="btn" data-suspend="${u.id}">Suspend</button>`) : ""}
              ${u.id!==ME.id?`<button class="btn danger" data-delusr="${u.id}">${esc(t("adm_delete"))}</button>`:""}
            </div>
          </div>`).join("")}
      </div>`;

    // ---- Moderation panel ----
    const modQueue=(title, items, empty, body)=>`
      <div class="adash-modblock">
        <div class="adash-eyebrow">${esc(title)} <span class="adash-count">${items.length}</span></div>
        ${items.length?`<div class="adash-list">${items.map(body).join("")}</div>`:`<div class="adash-empty">${esc(empty)}</div>`}
      </div>`;
    const moderationPanel=`
      <div class="adash-panel-head"><div><div class="adash-eyebrow">${esc(t("adm_nav_moderation"))}</div><h2 class="adash-h2">${esc(t("adm_needs_attention"))} <span class="adash-count">${attentionTotal}</span></h2></div></div>
      ${modQueue("⏳ "+t("adm_pending"), pending, t("adm_nothing_pending"), u=>`
        <div class="adash-rowcard warn">
          <div class="adash-rowmain"><div><div class="adash-rowtitle">${esc(u.username)}</div><div class="adash-rowsub">${esc(t("adm_awaiting"))}</div></div></div>
          <div class="adash-rowactions">
            <button class="btn primary" data-approve="${u.id}">${esc(t("adm_approve"))}</button>
            <button class="btn danger" data-deny="${u.id}">${esc(t("adm_deny"))}</button>
          </div>
        </div>`)}
      ${modQueue("🚩 "+t("admin_flagged_title"), flagged, t("adm_nothing_pending"), fl=>`
        <div class="adash-rowcard warn">
          <div class="adash-rowmain"><div><div class="adash-rowtitle mono" style="word-break:break-all;font-size:13px;">${esc(fl.url)}</div><div class="adash-rowsub">${esc(fl.username||fl.user_id)} · ${esc(t("admin_flagged_reason"))}: ${esc(fl.reason)}</div>${fl.detail?`<pre class="adash-netlog mono" style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;padding:8px;border-radius:6px;background:var(--bg2,#1a1a1a);font-size:11.5px;max-height:220px;overflow:auto;">${esc(fl.detail)}</pre>`:""}</div></div>
          <div class="adash-rowactions">
            <button class="btn" data-allow-ep="${esc(fl.id)}">${esc(t("admin_flagged_allow"))}</button>
            <button class="btn danger" data-block-ep="${esc(fl.id)}">${esc(t("admin_flagged_block"))}</button>
          </div>
        </div>`)}
      ${modQueue("🔑 "+t("adm_reset_reqs"), resetReqs, t("adm_nothing_pending"), r=>`
        <div class="adash-rowcard warn">
          <div class="adash-rowmain"><div><div class="adash-rowtitle">${esc(r.username)}</div><div class="adash-rowsub mono">${esc(t("adm_reset_requested"))} · ${esc(new Date(r.created*1000).toLocaleString())}</div></div></div>
          <div class="adash-rowactions">
            <button class="btn primary" data-pr-approve="${esc(r.id)}">${esc(t("adm_approve"))}</button>
            <button class="btn danger" data-pr-deny="${esc(r.id)}">${esc(t("adm_deny"))}</button>
          </div>
        </div>`)}
      ${modQueue("🧩 "+t("adm_model_reqs_title"),
        // Rejected requests are done (nothing left to do) and a fulfilled
        // approved request has already been downloaded and installed — this
        // queue is for what's still actionable, not a permanent history of
        // every request ever made. Without this filter an approved+fulfilled
        // request just sat here forever looking unresolved.
        modelReqs.filter(mr=>mr.status==="pending" || (mr.status==="approved" && !mr.fulfilled)),
        t("adm_nothing_pending"), mr=>{
        const typeLabel=mr.request_type==="lora"?"LoRA":mr.request_type==="upscaler"?"Upscaler":"Model";
        if(isDev && mr.status==="approved") _mrKeys[mr.id]={api_key:mr.resolved_api_key||null, vae_api_key:mr.resolved_vae_api_key||null, text_encoder_api_key:mr.resolved_text_encoder_api_key||null};
        return `
        <div class="adash-rowcard warn">
          <div class="adash-rowmain"><div>
            <div class="adash-rowtitle">
              <span class="mr-type-tag mr-type-${esc(mr.request_type||"checkpoint")}">${esc(typeLabel)}</span>${esc(mr.model_name)}
              ${mr.host_allowed===0?` <span class="mr-type-tag" style="background:var(--warn,#e0a800);color:#1a1a1a;">⚠ ${esc(t("mr_unlisted_host"))}</span>`:""}
              ${mr.status==="approved"?` <span class="ig-mr-status">${esc(t("adm_approve"))}</span>`:""}
              ${mr.status==="rejected"?` <span class="ig-mr-status">${esc(t("adm_deny"))}</span>`:""}
            </div>
            <div class="adash-rowsub">${esc(mr.username||mr.user_id)} · <a href="${esc(mr.source_url)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(mr.source_url)}</a>${mr.note?` · ${esc(mr.note)}`:""}</div>
            ${isDev&&mr.status==="approved"&&!mr.fulfilled&&mr.resolved_api_key?`<div class="adash-rowsub mono">Authorization: Bearer ••••••••</div>`:""}
            ${isDev&&mr.status==="approved"&&mr.fulfilled?`<div class="adash-rowsub" style="color:var(--accent);">✓ ${esc(t("mr_fulfilled"))}</div>`:""}
            ${isDev&&mr.status==="approved"&&!mr.fulfilled?`<div class="adash-rowsub hint">${esc(t("mr_anima_hint"))}</div>`:""}
          </div></div>
          <div class="adash-rowactions">
            ${mr.status==="pending"?`<button class="btn primary" data-mr-approve="${esc(mr.id)}">${esc(t("adm_approve"))}</button>
                <button class="btn danger" data-mr-reject="${esc(mr.id)}">${esc(t("adm_deny"))}</button>`:""}
            ${isDev&&mr.status==="approved"&&!mr.fulfilled?`<button class="btn" data-mr-curl="${esc(mr.id)}" data-mr-name="${esc(mr.model_name)}" data-mr-url="${esc(mr.source_url)}" data-mr-type="${esc(mr.request_type||"checkpoint")}" data-mr-vae-url="${esc(mr.vae_url||"")}" data-mr-te-url="${esc(mr.text_encoder_url||"")}">${esc(t("mr_copy_curl"))}</button>`:""}
          </div>
        </div>`;
      })}
      ${modQueue("🏷️ "+t("adm_title_reqs"), titleReqs, t("adm_nothing_pending"), tr=>`
        <div class="adash-rowcard warn">
          <div class="adash-rowmain"><div><div class="adash-rowtitle"><span class="pf-badge pf-badge-title">${esc(tr.title||"")}</span> ${esc(tr.display_name||tr.username)}</div><div class="adash-rowsub">${esc(t("adm_title_requested_by"))} @${esc(tr.username)}</div></div></div>
          <div class="adash-rowactions">
            <button class="btn primary" data-tr-approve="${esc(tr.id)}">${esc(t("adm_approve"))}</button>
            <button class="btn danger" data-tr-reject="${esc(tr.id)}">${esc(t("adm_deny"))}</button>
          </div>
        </div>`)}
      ${modQueue("🖼️ "+t("adm_image_reports"), imageReports, t("adm_nothing_pending"), ir=>`
        <div class="adash-rowcard warn">
          <div class="adash-rowmain">
            <img class="adash-report-thumb" src="${esc(mediaURL(ir.image||""))}" alt="">
            <div><div class="adash-rowtitle">${esc(t("adm_review_reported"))}: ${ir.claimed_explicit?"NSFW":"SFW"} <span class="rating-detail-disc">(${esc(t("adm_review_current"))}: ${ir.current_explicit?"NSFW":"SFW"})</span></div><div class="adash-rowsub">${esc(ir.reporter_username||ir.reporter_id)}${ir.note?" · "+esc(ir.note):""}</div></div>
          </div>
          <div class="adash-rowactions">
            <button class="btn primary" data-ir-review="${esc(ir.id)}">${esc(t("adm_review"))}</button>
          </div>
        </div>`)}`;

    // ---- Model / LoRA previews panels ----
    // Shared row builder: a name, an optional preview image, and optional
    // admin-set display_name/description — same {name: {image, display_name,
    // description}} shape for both checkpoints and LoRAs (checkpoint_previews /
    // lora_previews tables). kind is "ckpt" or "lora", used for the data-*
    // action attribute names the click handlers below key off of.
    const previewGrid=(names, previewMap, kind, emptyMsg, builtinDesc)=>names.length?`<div class="adash-preview-grid">
        ${names.map(name=>{
          const meta=previewMap[name]||{};
          const label=meta.display_name||name;
          const img=meta.image;
          const desc=meta.description||(builtinDesc?builtinDesc(name):"");
          // The arch badge always reflects the admin-defined category
          // instead of the free-text description — that field can hold
          // whatever a checkpoint's own README/source called itself (e.g.
          // "PixAI DiT.2"), which isn't the same thing as its actual base
          // architecture and shouldn't be presented as if it were one.
          // Applies to both checkpoints and LoRAs — a LoRA can carry more
          // than one compatible-architecture pill.
          const archCats=(kind==="ckpt"||kind==="lora")?modelCategories(name,previewMap):[];
          const archBadge=archCats.length?`<span class="adash-preview-arch-row">${archCats.map(c=>`<span class="adash-preview-arch">${esc(modelCategoryLabel(c))}</span>`).join("")}</span>`:"";
          const thumb=img?`<div class="adash-preview-thumb" data-${kind}-set="${esc(name)}" style="background-image:url('${esc(mediaURL(img))}');cursor:pointer;">${archBadge}</div>`
                       :`<div class="adash-preview-thumb ava mono" data-${kind}-set="${esc(name)}" style="cursor:pointer;">${esc((label||"?")[0].toUpperCase())}${archBadge}</div>`;
          return `<div class="adash-preview-card">
            ${thumb}
            <div class="adash-preview-name" title="${esc(name)}">${esc(label)}</div>
            <div class="adash-preview-meta">${desc?esc(desc):(img?"":esc(t("adm_preview_none")))}</div>
            <div class="adash-preview-actions">
              ${img?`<button class="tool" data-preview-zoom="${esc(mediaURL(img))}" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>`:""}
              <button class="tool" data-${kind}-set="${esc(name)}" title="${esc(img?t("adm_preview_replace"):t("adm_preview_set"))}" aria-label="${esc(img?t("adm_preview_replace"):t("adm_preview_set"))}">${UPLOAD_ICON_SVG}</button>
              ${img?`<button class="tool danger" data-${kind}-clear="${esc(name)}" title="${esc(t("adm_preview_clear"))}" aria-label="${esc(t("adm_preview_clear"))}">${TRASH_ICON_SVG}</button>`:""}
              <button class="tool" data-${kind}-edit="${esc(name)}" title="${esc(t("adm_preview_edit"))}" aria-label="${esc(t("adm_preview_edit"))}">${EDIT_ICON_SVG}</button>
            </div>
          </div>`;
        }).join("")}
      </div>`:`<div class="adash-empty">${esc(emptyMsg)}</div>`;

    // Collapsible sections — five full preview grids stacked on one page
    // read as cluttered, especially once an admin only cares about one of
    // them. The chevron toggle lives in .adash-panel-head itself (not a
    // separate header replacing it, like .ig-sec elsewhere uses) so the
    // "+ Add" button stays reachable without expanding the grid underneath.
    const adashSection=(key, eyebrow, title, sub, addBtnHTML, bodyHTML)=>`
      <div class="adash-collapse" data-collapse-key="${esc(key)}" style="margin-top:32px;">
        <div class="adash-panel-head">
          <button type="button" class="adash-collapse-toggle" data-collapse-toggle aria-expanded="true">
            <svg class="adash-collapse-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            <div><div class="adash-eyebrow">${esc(eyebrow)}</div><h2 class="adash-h2">${esc(title)}</h2><div class="adash-sub">${esc(sub)}</div></div>
          </button>
          ${addBtnHTML||""}
        </div>
        <div class="adash-collapse-body">${bodyHTML}</div>
      </div>`;
    const previewsPanel=`
      ${adashSection("ckpt", t("adm_nav_previews"), t("adm_previews_title"), t("adm_previews_sub"),
        `<button type="button" class="btn primary" id="previewsAddModel">+ Add model</button>`,
        previewGrid(checkpoints, previews, "ckpt", t("img_gen_no_checkpoints")))}
      ${adashSection("lora", t("adm_nav_lora_previews"), t("adm_lora_previews_title"), t("adm_lora_previews_sub"),
        `<button type="button" class="btn primary" id="previewsAddLora">+ Add LoRA</button>`,
        previewGrid(loraList, loraPreviews, "lora", t("adm_no_loras")))}
      ${adashSection("upscaler", "Upscalers", "Upscaler reference images", "Curate one representative sample image per upscaler — same as models and LoRAs above.",
        `<button type="button" class="btn primary" id="previewsAddUpscaler">+ Request upscaler</button>`,
        previewGrid(upscalerList, upscalerPreviews, "upsc", "No upscalers installed yet — request one above."))}
      ${adashSection("samp", t("adm_nav_sampler_previews"), t("adm_sampler_previews_title"), t("adm_sampler_previews_sub"),
        "", previewGrid(samplerList, samplerPreviews, "samp", t("adm_no_samplers"), samplerDesc))}
      ${adashSection("sched", t("adm_nav_scheduler_previews"), t("adm_scheduler_previews_title"), t("adm_scheduler_previews_sub"),
        "", previewGrid(schedulerList, schedulerPreviews, "sched", t("adm_no_schedulers"), schedulerDesc))}`;

    // ---- Emojis & Stickers panel ----
    // No blur here (unlike the public picker) — admin_view=true on the API
    // call means the server already returned the real file, not the pending
    // preview stand-in, since reviewing *is* looking at the actual content.
    const emojiCard=(e)=>`
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
    const emojisPanel=`
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
      ${modQueue("⏳ Pending review", pendingEmojis, "Nothing pending.", emojiCard)}
      ${modQueue("✓ Approved", approvedEmojis, "None yet.", emojiCard)}`;

    // ---- Configuration panel (moved out of the Settings modal) ----
    const configPanel=`
      <div class="adash-panel-head"><div><div class="adash-eyebrow">${esc(t("adm_nav_config"))}</div><h2 class="adash-h2">${esc(t("adm_config_title"))}</h2><div class="adash-sub">${esc(t("adm_config_sub"))}</div></div>
        <button class="btn primary" id="s_save_global">${esc(t("set_save_global"))}</button></div>
      <div class="adash-config">
        <div class="field"><label>${esc(t("set_deflang"))} <span class="hint">${esc(t("set_deflang_hint"))}</span></label>
          <input type="text" id="s_deflang" list="ifaceLangList" value="${esc(st.default_language||"English")}" placeholder="English" autocomplete="off">
          <datalist id="ifaceLangList">${worldLanguages().map(n=>`<option value="${esc(n)}">`).join("")}</datalist></div>
        <div class="ep-group">
          <div class="ep-group-head">${esc(t("set_chat_ep"))}</div>
          <div class="field"><label>${esc(t("set_base_url"))}</label>
            <input type="text" id="s_base" value="${esc(st.base_url||"")}" placeholder="${kobold}"></div>
          <div class="field"><label>API key <span class="hint">${st.has_api_key?t("set_keep"):t("set_optional")}</span></label>
            <input type="password" id="s_key" value="" placeholder="${st.has_api_key?"••••••••":"(none)"}"></div>
          <div class="field" style="margin:0"><label>${esc(t("set_model"))}</label>
            <div style="display:flex;gap:8px;">
              <input type="text" id="s_chat" value="${esc(st.chat_model||"")}" style="flex:1">
              <button class="btn" id="s_fetch" type="button">${esc(t("set_fetch"))}</button></div>
            <div id="s_model_list" style="display:none;margin-top:6px;flex-wrap:wrap;gap:6px;"></div>
          </div>
        </div>
        <div class="ep-group">
          <div class="ep-group-head">${esc(t("set_embed_ep"))} <span class="hint" style="text-transform:none;letter-spacing:0;font-size:11px;">${esc(t("set_blank_reuse"))}</span></div>
          <div class="field"><label>${esc(t("set_base_url"))} <span class="hint">${esc(t("set_ollama_hint"))}</span></label>
            <input type="text" id="s_embedbase" value="${esc(st.embed_base_url||"")}" placeholder="${esc(t("set_blank_same"))}"></div>
          <div class="field"><label>API key <span class="hint">${st.has_embed_api_key?t("set_keep"):t("set_optional")}</span></label>
            <input type="password" id="s_ekey" value="" placeholder="${st.has_embed_api_key?"••••••••":"(none)"}"></div>
          <div class="field"><label>${esc(t("set_embed_dim"))} <span class="hint">${esc(t("set_embed_dim_hint"))}</span></label>
            <input type="text" id="s_dim" value="${st.embed_dim??768}"></div>
          <div class="field" style="margin:0"><label>${esc(t("set_model"))}</label>
            <div style="display:flex;gap:8px;">
              <input type="text" id="s_embed_model" value="${esc(st.embed_model||"")}" placeholder="nomic-embed-text" style="flex:1">
              <button class="btn" id="s_testembed" type="button">${esc(t("set_test"))}</button></div>
          </div>
        </div>
        <div class="ep-group">
          <div class="ep-group-head">${esc(t("set_comfy_ep"))}</div>
          <div class="field"><label>${esc(t("set_base_url"))}</label>
            <input type="text" id="s_comfy_url" value="${esc(st.comfyui_url||"")}" placeholder="http://comfyui:8188"></div>
          <div class="field" style="margin:0"><label>${esc(t("set_comfy_checkpoint"))} <span class="hint">${esc(t("set_comfy_checkpoint_hint"))}</span></label>
            <input type="text" id="s_comfy_ckpt" value="${esc(st.comfyui_checkpoint||"")}"></div>
        </div>
        <div class="ep-group">
          <div class="ep-group-head">${esc(t("set_model_request_hosts"))}</div>
          <div class="hint" style="margin:0 0 10px;">${esc(t("set_model_request_hosts_hint"))}</div>
          <div id="s_mr_hosts_rows"></div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="s_mr_host_add">${esc(t("set_mr_host_add"))}</button>
            <button type="button" class="btn primary" id="s_mr_host_save">${esc(t("btn_save"))}</button>
          </div>
        </div>
        <div class="ep-group">
          <div class="ep-group-head">${esc(t("set_embed_hosts"))}</div>
          <div class="hint" style="margin:0 0 10px;">${esc(t("set_embed_hosts_hint"))}</div>
          <textarea id="s_embed_hosts" rows="4" style="font-family:var(--mono);font-size:13px;" placeholder="tenor.com">${esc((st.embed_link_hosts||[]).join("\n"))}</textarea>
        </div>
        <div class="settings-row">
          <div class="field" style="margin:0"><label>${esc(t("settings_past_messages"))} <span class="hint">${esc(t("settings_past_messages_hint"))}</span></label>
            <input type="text" id="s_hist" value="${st.history_turns??16}"></div>
          <div class="field" style="margin:0"><label>${esc(t("settings_max_tokens"))} <span class="hint">${esc(t("settings_max_tokens_hint"))}</span></label>
            <input type="text" id="s_max" value="${st.max_tokens??4096}"></div>
        </div>
        <label class="switch" style="margin-bottom:16px;margin-top:12px;"><input type="checkbox" id="s_think" ${st.enable_thinking?"checked":""}> ${esc(t("settings_thinking_default"))}</label>
        <h3 class="sec">${esc(t("settings_advanced_sampling"))}</h3>
        <div style="font-size:12px;margin:0 0 14px;color:var(--muted);">${esc(t("set_sent_note"))}</div>
        ${sliderGrid(
          sf("s_temp",t("samp_temp"),st.temperature??0.85,{min:0,max:2,step:0.01,fallback:0.85}),
          sf("s_topp","Top-p",st.top_p??0.9,{min:0,max:1,step:0.01,fallback:0.9}),
          sf("s_topk","Top-k",st.top_k??0,{min:0,max:100,step:1,fallback:0}),
          sf("s_minp","Min-p",st.min_p??0,{min:0,max:1,step:0.01,fallback:0}),
          sf("s_topa","Top-a",st.top_a??0,{min:0,max:1,step:0.01,fallback:0}),
          sf("s_typ","Typical-p",st.typical_p??1,{min:0,max:1,step:0.01,fallback:1}),
          sf("s_rep",t("samp_rep"),st.repetition_penalty??1,{min:0.5,max:2,step:0.01,fallback:1}),
          sf("s_freq",t("samp_freq"),st.frequency_penalty??0,{min:0,max:2,step:0.01,fallback:0}),
          sf("s_pres",t("samp_pres"),st.presence_penalty??0,{min:0,max:2,step:0.01,fallback:0}),
          sf("s_tfs","TFS",st.tfs??1,{min:0,max:1,step:0.01,fallback:1}),
          sf("s_smooth","Smoothing",st.smoothing_factor??0,{min:0,max:5,step:0.01,fallback:0}),
          sf("s_reprange","Rep. range",st.repetition_penalty_range??0,{min:0,max:2048,step:16,fallback:0}),
          sf("s_dlow","DynaTemp low",st.dynatemp_low??0,{min:0,max:2,step:0.01,fallback:0}),
          sf("s_dhigh","DynaTemp high",st.dynatemp_high??0,{min:0,max:2,step:0.01,fallback:0}),
          sf("s_mtau","Mirostat τ",st.mirostat_tau??5,{min:0,max:10,step:0.1,fallback:5}),
          sf("s_meta","Mirostat η",st.mirostat_eta??0.1,{min:0,max:1,step:0.01,fallback:0.1}),
          sf("s_drym","DRY mult.",st.dry_multiplier??0,{min:0,max:5,step:0.01,fallback:0}),
          sf("s_dryb","DRY base",st.dry_base??1.75,{min:0,max:3,step:0.01,fallback:1.75}),
          sf("s_dryl","DRY len",st.dry_allowed_length??2,{min:0,max:50,step:1,fallback:2}),
          sf("s_xtct","XTC threshold",st.xtc_threshold??0.1,{min:0,max:1,step:0.01,fallback:0.1}),
          sf("s_xtcp","XTC prob.",st.xtc_probability??0,{min:0,max:1,step:0.01,fallback:0}),
        )}
        ${row(f("s_miro","Mirostat mode",st.mirostat_mode??0,"0/1/2"), f("s_seed",t("samp_seed"),st.seed??-1,t("samp_seed_hint")))}
        <div class="field" style="margin:16px 0 12px"><label>${esc(t("samp_stop"))} <span class="hint">${esc(t("samp_stop_hint"))}</span></label>
          <textarea id="s_stop" style="min-height:52px;font-family:var(--mono);font-size:12.5px">${esc((st.stop||[]).join("\n"))}</textarea></div>
        <div class="field" style="margin:0 0 16px"><label>${esc(t("set_extra_fields"))} <span class="hint">JSON</span></label>
          <textarea id="s_extra" style="min-height:52px;font-family:var(--mono);font-size:12.5px">${esc(Object.keys(st.extra_params||{}).length?JSON.stringify(st.extra_params,null,2):"")}</textarea></div>
        <h3 class="sec">${esc(t("settings_prompt_injection"))}</h3>
        <div class="field"><label>${esc(t("set_suffix"))} <span class="hint">${esc(t("set_suffix_hint"))}</span></label>
          <textarea id="s_suffix" style="min-height:72px">${esc(st.system_suffix||"")}</textarea></div>
        <div class="field" style="margin:0 0 16px"><label>${esc(t("set_posthist"))} <span class="hint">${esc(t("set_posthist_hint"))}</span></label>
          <textarea id="s_posthist" style="min-height:72px">${esc(st.post_history||"")}</textarea></div>
        <h3 class="sec">${esc(t("set_backend"))}</h3>
        <div class="field" style="margin:0"><label>${esc(t("set_backend_url"))} <span class="hint">${esc(t("set_backend_hint"))}</span></label>
          <input type="text" id="s_api" value="${esc(API)}" placeholder="(same origin)"></div>
      </div>`;

    // ---- Health + Logs panel (folded into one) ----
    const healthPanel=`
      <div class="adash-panel-head"><div><div class="adash-eyebrow">${esc(t("adm_nav_health"))}</div><h2 class="adash-h2">${esc(t("adm_health_title"))}</h2><div class="adash-sub">${esc(t("adm_health_note"))}</div></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div class="seg" id="healthRange">
            <button type="button" class="seg-btn" data-hours="1">${esc(t("adm_health_range_1h"))}</button>
            <button type="button" class="seg-btn on" data-hours="24">${esc(t("adm_health_range_24h"))}</button>
            <button type="button" class="seg-btn" data-hours="168">${esc(t("adm_health_range_7d"))}</button>
          </div>
          <button class="btn" id="healthRefresh">↻ ${esc(t("adm_refresh"))}</button>
        </div></div>
      <div id="healthUptime" class="adash-health-uptime"></div>
      <div id="healthGrid" class="adash-health-grid"><span style="color:var(--muted)">${esc(t("loading"))}</span></div>
      <h3 class="sec">${esc(t("adm_logs"))}</h3>
      <div class="adash-sub" style="margin:-4px 0 12px;">${esc(t("adm_logs_note"))}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <select id="logLevel" class="adash-select">
          <option value="DEBUG">${esc(t("log_debug"))}</option>
          <option value="INFO" selected>${esc(t("log_info"))}</option>
          <option value="WARNING">${esc(t("log_warn"))}</option>
          <option value="ERROR">${esc(t("log_err"))}</option>
        </select>
        <button class="btn" id="logRefresh">↻ ${esc(t("adm_refresh"))}</button>
      </div>
      <div id="logView" class="adash-logs"></div>`;

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

    const switchTab=id=>{
      activeTab=id; _adminTab=id;
      main.querySelectorAll(".adash-navbtn").forEach(b=>b.classList.toggle("on",b.dataset.tab===id));
      main.querySelectorAll(".adash-panel").forEach(p=>p.style.display=p.dataset.panel===id?"":"none");
      history.replaceState(null,"","/admin"+(id==="overview"?"":"/"+id));
      if(id==="health"){ renderHealth(); renderLogs(); }
    };
    main.querySelectorAll(".adash-navbtn").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
    main.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>switchTab(b.dataset.jump));
    // Collapsible preview sections (see adashSection above) — state persists
    // per-section across visits the same way the image-gen studio's own
    // collapsible sections do (store key), open by default.
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

    // sliders in the config panel
    main.querySelectorAll(".sf-range").forEach(r=>{
      const numEl=document.getElementById(r.dataset.target); if(!numEl) return;
      r.addEventListener("input",()=>{ numEl.value=r.value; });
      numEl.addEventListener("input",()=>{ const v=parseFloat(numEl.value); if(!isNaN(v)) r.value=v; });
    });
    const deflangEl=$("#s_deflang"); if(deflangEl && typeof attachLangAC==="function") attachLangAC(deflangEl);

    // ---- Logs ----
    const renderLogs = async () => {
      const level = document.getElementById("logLevel")?.value || "INFO";
      const box = document.getElementById("logView"); if(!box) return;
      box.innerHTML = `<span style="color:var(--muted)">${esc(t("loading"))}</span>`;
      try{
        const {logs} = await api(`/api/admin/logs?level=${level}&limit=300`);
        box.innerHTML = logs.length ? logs.slice().reverse().map(l=>{
          const dt = new Date(l.ts*1000).toLocaleString();
          const color = (l.level==="ERROR"||l.level==="CRITICAL") ? "var(--warn)" : l.level==="WARNING" ? "var(--accent)" : "var(--sec)";
          return `<div style="padding:2px 0;white-space:pre-wrap;word-break:break-word;"><span style="color:var(--muted)">${esc(dt)}</span> <span style="color:${color};font-weight:600;">${esc(l.level)}</span> <span style="color:var(--muted)">${esc(l.logger)}:</span> ${esc(l.message)}</div>`;
        }).join("") : `<span style="color:var(--muted)">${esc(t("log_empty"))}</span>`;
      }catch(e){ box.innerHTML = `<span style="color:var(--warn)">${esc(t("log_fail"))} ${esc(e.message)}</span>`; }
    };
    document.getElementById("logLevel").onchange = renderLogs;
    document.getElementById("logRefresh").onclick = renderLogs;
    if(activeTab==="health") renderLogs();

    // ---- Service health ----
    const fmtDuration = secs=>{
      secs=Math.floor(secs);
      const d=Math.floor(secs/86400), h=Math.floor((secs%86400)/3600), m=Math.floor((secs%3600)/60);
      const parts=[];
      if(d) parts.push(d+"d"); if(h||d) parts.push(h+"h"); parts.push(m+"m");
      return parts.join(" ");
    };
    const healthSvcLabel = name=>({
      database:t("adm_health_svc_database"), chat_llm:t("adm_health_svc_chat_llm"),
      embed_llm:t("adm_health_svc_embed_llm"), comfyui:t("adm_health_svc_comfyui"),
      image_classify_llm:t("adm_health_svc_image_classify_llm")}[name]||name);
    function healthLineChart(points){
      if(!points.length) return `<span class="hint">${esc(t("adm_health_no_history"))}</span>`;
      const w=200, h=32, pad=3;
      const msVals=points.map(p=>p.ok&&p.ms!=null?p.ms:0);
      const maxMs=Math.max(1, ...msVals);
      const stepX=points.length>1 ? (w-pad*2)/(points.length-1) : 0;
      const xy=points.map((p,i)=>{
        const x=pad+i*stepX;
        const y=p.ok ? h-pad-((p.ms||0)/maxMs)*(h-pad*2) : h-pad;
        return {x,y,p};
      });
      const linePts=xy.map(pt=>`${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      const dots=xy.map(pt=>{
        const when=new Date(pt.p.t*1000).toLocaleTimeString();
        const tip=pt.p.ok?`${when} — ${pt.p.ms!=null?pt.p.ms+" ms":"ok"}`:`${when} — ${t("adm_health_down")}`;
        return `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2" class="${pt.p.ok?"up":"down"}"><title>${esc(tip)}</title></circle>`;
      }).join("");
      return `<svg class="health-linechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <polyline points="${linePts}" fill="none" class="health-linechart-line"/>
        ${dots}
      </svg>`;
    }
    let healthRangeHours = 24;
    const renderHealth = async () => {
      const grid=document.getElementById("healthGrid"); const upBox=document.getElementById("healthUptime");
      if(!grid) return;
      grid.innerHTML = `<span style="color:var(--muted)">${esc(t("loading"))}</span>`;
      try{
        const data = await api("/api/admin/service-health?hours="+healthRangeHours);
        if(upBox) upBox.innerHTML = `<div class="adash-health-process">${esc(t("adm_health_process_uptime"))}: <b>${esc(fmtDuration(data.process_uptime_seconds))}</b></div>`;
        grid.innerHTML = data.services.map(s=>{
          const spark = healthLineChart(s.latency_history||[]);
          const pct = s.uptime_pct_24h==null ? "—" : s.uptime_pct_24h+"%";
          const avg = s.avg_latency_ms==null ? "—" : s.avg_latency_ms+" ms";
          return `<div class="adash-health-card ${s.ok?"up":"down"}">
            <div class="adash-health-card-head">
              <span class="adash-health-dot ${s.ok?"up":"down"}"></span>
              <span class="adash-health-name">${esc(healthSvcLabel(s.name))}</span>
              <span class="adash-health-status">${s.ok?esc(t("adm_health_up")):esc(t("adm_health_down"))}</span>
            </div>
            <div class="adash-health-stats">
              <span>${esc(t("adm_health_latency"))}: <b>${s.latency_ms!=null?s.latency_ms+" ms":"—"}</b></span>
              <span>${esc(t("adm_health_uptime_24h"))}: <b>${esc(pct)}</b></span>
            </div>
            <div class="adash-health-chart-row">
              <div class="adash-health-spark">${spark}</div>
              <div class="adash-health-avg"><span class="hint">${esc(t("adm_health_avg"))}</span><b>${esc(avg)}</b></div>
            </div>
            ${s.error?`<div class="adash-health-err">${esc(s.error)}</div>`:""}
          </div>`;
        }).join("");
      }catch(e){ grid.innerHTML = `<span style="color:var(--warn)">${esc(t("log_fail"))} ${esc(e.message)}</span>`; }
    };
    document.getElementById("healthRefresh").onclick = renderHealth;
    document.getElementById("healthRange").querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
      healthRangeHours = parseFloat(b.dataset.hours);
      document.getElementById("healthRange").querySelectorAll(".seg-btn").forEach(x=>x.classList.toggle("on", x===b));
      renderHealth();
    });
    if(activeTab==="health") renderHealth();

    // ---- Emojis & Stickers panel ----
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

    // ---- Create user ----
    const openCreateUser = () => {
      openModal(`<h3>${esc(t("adm_create_user"))}</h3>
        <div class="field"><label>${esc(t("li_username"))}</label><input type="text" id="nu_name" autocomplete="off"></div>
        <div class="field"><label>${esc(t("li_password"))} <span class="hint">${esc(t("li_min8"))}</span></label><input type="password" id="nu_pass" autocomplete="new-password"></div>
        <label class="switch" style="margin-bottom:14px;"><input type="checkbox" id="nu_admin"> ${esc(t("adm_grant"))}</label>
        <div class="modal-foot"><button class="btn" id="nu_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="nu_save">${esc(t("adm_create"))}</button></div>`);
      document.getElementById("nu_cancel").onclick = closeModal;
      const nuName=document.getElementById("nu_name");
      nuName.addEventListener("input", ()=>{
        const pos=nuName.selectionStart;
        const clean=nuName.value.replace(/\s+/g,"-").replace(/[^A-Za-z0-9_-]/g,"");
        if(clean!==nuName.value){ nuName.value=clean; nuName.setSelectionRange(pos,pos); }
      });
      document.getElementById("nu_save").onclick = async () => {
        const username = document.getElementById("nu_name").value.trim();
        const password = document.getElementById("nu_pass").value;
        const is_admin = document.getElementById("nu_admin").checked;
        if(!username||!password){ toast("Username and password required."); return; }
        if(password.length<8){ toast("Password must be at least 8 characters."); return; }
        try{ await api("/api/admin/users", j("POST",{username,password,is_admin})); closeModal(); toast("User created."); render(); }
        catch(e){ errorToast("Failed: "+e.message); }
      };
    };
    const cub=document.getElementById("createUserBtn"); if(cub) cub.onclick = openCreateUser;

    // ---- User actions ----
    main.querySelectorAll("[data-approve]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.approve);
      try{ await api("/api/admin/users/"+b.dataset.approve+"/approve",{method:"POST"}); toast(`${u?.username} approved.`); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-deny]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.deny);
      if(!(await confirmAction(b, `Deny and delete "${u?.username}"?`))) return;
      try{ await api("/api/admin/users/"+b.dataset.deny+"/deny",{method:"POST"}); toast(`${u?.username} denied.`); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-delusr]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.delusr);
      if(!(await confirmAction(b, `Delete user "${u?.username}"? This cannot be undone.`))) return;
      try{ await api("/api/admin/users/"+b.dataset.delusr,{method:"DELETE"}); toast("User deleted."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-resetpw]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.resetpw);
      const pw=prompt(`New password for "${u?.username}" (min 8 chars):`);
      if(!pw) return;
      if(pw.length<8){ toast("Password must be at least 8 characters."); return; }
      try{ await api("/api/admin/users/"+b.dataset.resetpw+"/password", j("PUT",{username:u?.username||"_",password:pw})); toast("Password updated."); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-role]").forEach(b=>b.onclick=async()=>{
      const uid=b.dataset.role, toAdmin=b.dataset.toadmin==="true";
      const u=allUsers.find(x=>x.id===uid);
      try{ await api("/api/admin/users/"+uid+"/role", j("PUT",{username:u?.username||"_",password:"_",is_admin:toAdmin})); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-suspend]").forEach(b=>b.onclick=()=>{
      const uid=b.dataset.suspend;
      const u=allUsers.find(x=>x.id===uid);
      openSuspendModal(uid, u?.username||"", render);
    });
    main.querySelectorAll("[data-unsuspend]").forEach(b=>b.onclick=async()=>{
      const u=allUsers.find(x=>x.id===b.dataset.unsuspend);
      if(!(await confirmAction(b, `Unsuspend "${u?.username}"?`+(u?.suspension_reason?` (reason: ${u.suspension_reason})`:""), "Unsuspend"))) return;
      try{ await api("/api/admin/users/"+b.dataset.unsuspend+"/unsuspend",{method:"POST"}); toast(`${u?.username} unsuspended.`); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });

    main.querySelectorAll("[data-notes]").forEach(b=>b.onclick=()=>{
      const u=allUsers.find(x=>x.id===b.dataset.notes);
      openAdminNotesModal(u, render);
    });

    // ---- Flagged endpoints ----
    main.querySelectorAll("[data-allow-ep]").forEach(b=>b.onclick=async()=>{
      try{ await api("/api/admin/flagged-endpoints/"+b.dataset.allowEp+"/allow",{method:"POST"}); toast("Endpoint allowed."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-block-ep]").forEach(b=>b.onclick=async()=>{
      if(!(await confirmAction(b, "Block this endpoint?"))) return;
      try{ await api("/api/admin/flagged-endpoints/"+b.dataset.blockEp+"/block",{method:"POST"}); toast("Endpoint blocked."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });

    // ---- Password reset requests ----
    main.querySelectorAll("[data-pr-approve]").forEach(b=>b.onclick=async()=>{
      try{
        const r=await api("/api/admin/password-reset-requests/"+b.dataset.prApprove+"/approve",{method:"POST"});
        openModal(`
          <div style="font-weight:600;font-size:16px;margin-bottom:8px;">${esc(t("adm_reset_new_pw"))}</div>
          <p style="color:var(--sec);font-size:14px;line-height:1.6;margin:0 0 12px;">${esc(t("adm_reset_new_pw_note").replace("{u}", r.username))}</p>
          <div class="field"><input type="text" id="pr_pw_val" readonly value="${esc(r.password)}" style="font-family:var(--mono);font-size:15px;"></div>
          <div class="modal-foot" style="justify-content:flex-end;gap:8px;">
            <button class="btn" id="pr_pw_copy">${esc(t("adm_reset_copy"))}</button>
            <button class="btn primary" id="pr_pw_done">${esc(t("btn_save")||"Done")}</button>
          </div>`);
        document.getElementById("pr_pw_copy").onclick=()=>{ navigator.clipboard?.writeText(r.password); toast("Copied."); };
        document.getElementById("pr_pw_done").onclick=()=>{ closeModal(); render(); };
      }catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-pr-deny]").forEach(b=>b.onclick=async()=>{
      if(!(await confirmAction(b, "Deny this password reset request?"))) return;
      try{ await api("/api/admin/password-reset-requests/"+b.dataset.prDeny+"/deny",{method:"POST"}); toast("Request denied."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });

    // ---- Model requests ----
    main.querySelectorAll("[data-mr-approve]").forEach(b=>b.onclick=async()=>{
      try{
        await api("/api/admin/model-requests/"+b.dataset.mrApprove+"/approve",{method:"POST"});
        toast(t("mr_approved_manual"));
        render();
      }catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-mr-reject]").forEach(b=>b.onclick=async()=>{
      if(!(await confirmAction(b, "Reject this model request?"))) return;
      try{ await api("/api/admin/model-requests/"+b.dataset.mrReject+"/reject",{method:"POST"}); toast("Model request rejected."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-mr-curl]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.mrCurl, name=b.dataset.mrName, url=b.dataset.mrUrl, type=b.dataset.mrType||"checkpoint";
      const vaeUrl=b.dataset.mrVaeUrl||"", teUrl=b.dataset.mrTeUrl||"";
      const base=name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")||"model";
      // Most links (e.g. Civitai's /api/download/... form) don't carry the
      // real filename/extension in the URL — the server only learns the true
      // name from a Content-Disposition header on the actual response, which
      // isn't available to build a copy-paste command client-side. Sniff a
      // known model extension out of the URL path if present, otherwise fall
      // back to a per-type default: upscalers are still overwhelmingly
      // distributed as classic ESRGAN .pth/.pt files (RealESRGAN, 4x-
      // UltraSharp, etc.) even on Civitai, unlike checkpoints/LoRAs where
      // .safetensors is now the norm — defaulting every unsniffed link to
      // .safetensors silently mislabeled real .pth/.pt upscaler downloads.
      const knownExts=[".safetensors",".ckpt",".pt",".pth"];
      const extFor=(u,reqType)=>{
        const urlPath=(()=>{ try{ return new URL(u).pathname.toLowerCase(); }catch(e){ return u.toLowerCase(); } })();
        return knownExts.find(e=>urlPath.endsWith(e))||(reqType==="upscaler"?".pth":".safetensors");
      };
      const slug=base+extFor(url,type);
      const keys=_mrKeys[id]||{};
      const ua="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
      const authPart=k=>k?` -H "Authorization: Bearer ${k}"`:"";
      const subdir={checkpoint:"checkpoints", lora:"loras", upscaler:"upscale_models", anima:"diffusion_models"}[type]||"checkpoints";
      const base_dir="/var/mnt/storage/podman/volumes/sillytavern_comfyui_models/_data";
      // The volume's files are owned by the container's remapped rootless UID
      // (525287 on this host), not the dev's own user — a plain curl -o there
      // fails with permission denied. sudo bypasses the write-permission check;
      // the follow-up chown matches ownership to the existing files in that
      // directory so it's consistent with everything ComfyUI already wrote there.
      const block=(dir,u,fname,key)=>`cd "${base_dir}/${dir}" && sudo curl -L -A "${ua}"${authPart(key)} "${u}" -o "${fname}" && sudo chown 525287:525287 "${fname}"`;
      const cmds=[block(subdir,url,slug,keys.api_key)];
      if(type==="anima"&&vaeUrl) cmds.push(block("vae",vaeUrl,base+"_vae"+extFor(vaeUrl),keys.vae_api_key));
      if(type==="anima"&&teUrl) cmds.push(block("text_encoders",teUrl,base+"_text_encoder"+extFor(teUrl),keys.text_encoder_api_key));
      const cmd=cmds.join(" && ");
      navigator.clipboard?.writeText(cmd);
      toast(t("mr_curl_copied"));
    });

    // ---- Title requests ----
    main.querySelectorAll("[data-tr-approve]").forEach(b=>b.onclick=async()=>{
      try{ await api("/api/admin/title-requests/"+b.dataset.trApprove+"/approve",{method:"POST"}); toast("Title approved."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-tr-reject]").forEach(b=>b.onclick=async()=>{
      if(!(await confirmAction(b, "Reject this title request?"))) return;
      try{ await api("/api/admin/title-requests/"+b.dataset.trReject+"/reject",{method:"POST"}); toast("Title rejected."); render(); }
      catch(e){ errorToast("Failed: "+e.message); }
    });

    // ---- Image rating reports ----
    main.querySelectorAll("[data-ir-review]").forEach(b=>b.onclick=()=>{
      const rep=imageReports.find(r=>r.id===b.dataset.irReview);
      if(rep) adminReviewImageModal(rep, render);
    });

    // ---- Model / LoRA previews ----
    // Straight to the request form (openModelRequestModal, same standalone
    // no-tabs layout as openUpscalerRequestModal) — an admin clicking
    // "+ Add model/LoRA" already knows it's not installed yet, so making them
    // click past a browse-what's-already-there grid first (the picker
    // modal's default "Models" tab) was pointless friction.
    const previewsAddModelBtn=document.getElementById("previewsAddModel");
    if(previewsAddModelBtn) previewsAddModelBtn.onclick=()=>{
      openModelRequestModal("checkpoint");
    };
    const previewsAddLoraBtn=document.getElementById("previewsAddLora");
    if(previewsAddLoraBtn) previewsAddLoraBtn.onclick=()=>{
      openModelRequestModal("lora");
    };
    const previewsAddUpscalerBtn=document.getElementById("previewsAddUpscaler");
    if(previewsAddUpscalerBtn) previewsAddUpscalerBtn.onclick=()=>{
      openUpscalerRequestModal();
    };
    main.querySelectorAll("[data-preview-zoom]").forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      openModal(`<img src="${esc(b.dataset.previewZoom)}" alt="" style="width:100%;border-radius:10px;display:block;">`,
        null, {stack:true});
    });
    main.querySelectorAll("[data-ckpt-set]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.ckptSet;
      openImageGenPickerModal(async blob=>{
        const fd=new FormData(); fd.append("file", blob, "preview.jpg");
        try{
          await api("/api/admin/checkpoint-previews/"+encodeURIComponent(name),{method:"PUT",body:fd});
          _imagegenCheckpoints=null; _checkpointPreviews=null;
          toast(t("adm_preview_saved")); render();
        }catch(e){ errorToast("Upload failed: "+e.message); }
      }, {lockCheckpoint:name, hideLoraPicker:true});
    });
    main.querySelectorAll("[data-ckpt-clear]").forEach(b=>b.onclick=async()=>{
      const name=b.dataset.ckptClear;
      if(!(await confirmAction(b, t("adm_preview_clear")+"?"))) return;
      try{
        await api("/api/admin/checkpoint-previews/"+encodeURIComponent(name),{method:"DELETE"});
        _imagegenCheckpoints=null; _checkpointPreviews=null;
        toast(t("adm_preview_cleared")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-lora-set]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.loraSet;
      openImageGenPickerModal(async blob=>{
        const fd=new FormData(); fd.append("file", blob, "preview.jpg");
        try{
          await api("/api/admin/lora-previews/"+encodeURIComponent(name),{method:"PUT",body:fd});
          _imagegenCheckpoints=null; _loraPreviews=null;
          toast(t("adm_preview_saved")); render();
        }catch(e){ errorToast("Upload failed: "+e.message); }
      }, {lockLora:name});
    });
    main.querySelectorAll("[data-lora-clear]").forEach(b=>b.onclick=async()=>{
      const name=b.dataset.loraClear;
      if(!(await confirmAction(b, t("adm_preview_clear")+"?"))) return;
      try{
        await api("/api/admin/lora-previews/"+encodeURIComponent(name),{method:"DELETE"});
        _imagegenCheckpoints=null; _loraPreviews=null;
        toast(t("adm_preview_cleared")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-samp-set]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.sampSet;
      openImageGenPickerModal(async blob=>{
        const fd=new FormData(); fd.append("file", blob, "preview.jpg");
        try{
          await api("/api/admin/sampler-previews/"+encodeURIComponent(name),{method:"PUT",body:fd});
          _samplerPreviews=null;
          toast(t("adm_preview_saved")); render();
        }catch(e){ errorToast("Upload failed: "+e.message); }
      }, {lockSampler:name});
    });
    main.querySelectorAll("[data-samp-clear]").forEach(b=>b.onclick=async()=>{
      const name=b.dataset.sampClear;
      if(!(await confirmAction(b, t("adm_preview_clear")+"?"))) return;
      try{
        await api("/api/admin/sampler-previews/"+encodeURIComponent(name),{method:"DELETE"});
        _samplerPreviews=null;
        toast(t("adm_preview_cleared")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    });
    main.querySelectorAll("[data-sched-set]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.schedSet;
      openImageGenPickerModal(async blob=>{
        const fd=new FormData(); fd.append("file", blob, "preview.jpg");
        try{
          await api("/api/admin/scheduler-previews/"+encodeURIComponent(name),{method:"PUT",body:fd});
          _schedulerPreviews=null;
          toast(t("adm_preview_saved")); render();
        }catch(e){ errorToast("Upload failed: "+e.message); }
      }, {lockScheduler:name});
    });
    main.querySelectorAll("[data-sched-clear]").forEach(b=>b.onclick=async()=>{
      const name=b.dataset.schedClear;
      if(!(await confirmAction(b, t("adm_preview_clear")+"?"))) return;
      try{
        await api("/api/admin/scheduler-previews/"+encodeURIComponent(name),{method:"DELETE"});
        _schedulerPreviews=null;
        toast(t("adm_preview_cleared")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    });
    // Upscalers don't generate an image on their own (they post-process one
    // that already exists) — reusing the AI-generate-locked-to-this-model
    // flow the checkpoint/sampler/scheduler previews use doesn't make sense
    // here, so this is a plain file upload instead.
    main.querySelectorAll("[data-upsc-set]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.upscSet;
      const fileInput=document.createElement("input");
      fileInput.type="file"; fileInput.accept="image/*";
      fileInput.onchange=async()=>{
        const file=fileInput.files[0]; if(!file) return;
        const fd=new FormData(); fd.append("file", file, file.name);
        try{
          await api("/api/admin/upscaler-previews/"+encodeURIComponent(name),{method:"PUT",body:fd});
          _upscalerPreviews=null;
          toast(t("adm_preview_saved")); render();
        }catch(e){ errorToast("Upload failed: "+e.message); }
      };
      fileInput.click();
    });
    main.querySelectorAll("[data-upsc-clear]").forEach(b=>b.onclick=async()=>{
      const name=b.dataset.upscClear;
      if(!(await confirmAction(b, t("adm_preview_clear")+"?"))) return;
      try{
        await api("/api/admin/upscaler-previews/"+encodeURIComponent(name),{method:"DELETE"});
        _upscalerPreviews=null;
        toast(t("adm_preview_cleared")); render();
      }catch(e){ errorToast("Failed: "+e.message); }
    });

    // ---- Model / LoRA metadata (display name + description) ----
    const openEditMetaModal=async(kind, name, currentMeta)=>{
      const routeBase = kind==="ckpt" ? "/api/admin/checkpoint-previews/"
        : kind==="lora" ? "/api/admin/lora-previews/"
        : kind==="samp" ? "/api/admin/sampler-previews/"
        : kind==="upsc" ? "/api/admin/upscaler-previews/"
        : "/api/admin/scheduler-previews/";
      const isAnimaCkpt = kind==="ckpt" && isAnimaModel(name);
      const {clipModels, vaeModels} = isAnimaCkpt ? await getAnimaEncoderOptions() : {clipModels:[], vaeModels:[]};
      const animaCsItems=list=>[{value:"", label:t("adm_edit_meta_anima_default")}, ...list.map(m=>({value:m, label:m}))];
      openModal(`<h3>${esc(t("adm_edit_meta_title"))}</h3>
        <p class="hint" style="margin:0 0 14px;word-break:break-all;">${esc(name)}</p>
        <div class="field"><label>${esc(t("adm_edit_meta_name"))}</label>
          <input type="text" id="mm_name" value="${esc(currentMeta.display_name||"")}" placeholder="${esc(t("adm_edit_meta_name_ph"))}"></div>
        ${kind==="ckpt"?`<div class="field"><label>${esc(t("adm_edit_meta_type"))}</label>
          <input type="text" id="mm_type" value="${esc(currentMeta.model_type||"")}" placeholder="${esc(t("adm_edit_meta_type_ph"))}"></div>`:""}
        ${kind==="ckpt"?`<div class="field"><label>${esc(t("adm_edit_meta_steps"))} <span class="hint">${esc(t("adm_edit_meta_steps_hint"))}</span></label>
          <label class="switch" style="margin-bottom:8px;"><input type="checkbox" id="mm_steps_on" ${currentMeta.default_steps!=null?"checked":""}> ${esc(t("adm_edit_meta_steps_toggle"))}</label>
          <div id="mm_steps_row" style="display:${currentMeta.default_steps!=null?"":"none"};">
            <span class="hint" id="mm_steps_val">${currentMeta.default_steps!=null?currentMeta.default_steps:20}</span>
            <input type="range" id="mm_steps" min="1" max="60" step="1" value="${currentMeta.default_steps!=null?currentMeta.default_steps:20}">
          </div></div>`:""}
        ${kind==="lora"?`<div class="field"><label>${esc(t("adm_edit_meta_category"))} <span class="hint">${esc(t("adm_edit_meta_category_multi_hint"))}</span></label>
          <div class="seg ig-mp-category-tabs" id="mmCategoryPills">
            ${MODEL_CATEGORY_TABS.map(c=>`<button type="button" class="seg-btn${(currentMeta.model_category||[]).includes(c)?" on":""}" data-c="${c}">${esc(modelCategoryLabel(c))}</button>`).join("")}
          </div></div>`:""}
        ${isAnimaCkpt?`<div class="field"><label>${esc(t("adm_edit_meta_anima_clip"))}</label>
          <div id="mm_anima_clip"></div></div>
        <div class="field"><label>${esc(t("adm_edit_meta_anima_vae"))}</label>
          <div id="mm_anima_vae"></div>
          <span class="hint">${esc(t("adm_edit_meta_anima_hint"))}</span></div>`:""}
        <div class="field"><label>${esc(t("adm_edit_meta_desc"))}</label>
          <textarea id="mm_desc" style="min-height:64px" placeholder="${esc(t("adm_edit_meta_desc_ph"))}">${esc(currentMeta.description||"")}</textarea></div>
        <div class="modal-foot"><button class="btn" id="mm_cancel">${esc(t("btn_cancel"))}</button><button class="btn primary" id="mm_save">${esc(t("btn_save"))}</button></div>`);
      document.getElementById("mm_cancel").onclick=closeModal;
      let animaClipCs=null, animaVaeCs=null;
      if(isAnimaCkpt){
        animaClipCs=mountCustomSelect(document.getElementById("mm_anima_clip"), animaCsItems(clipModels),
          {value:currentMeta.anima_clip_name||"", placeholder:t("adm_edit_meta_anima_default")});
        animaVaeCs=mountCustomSelect(document.getElementById("mm_anima_vae"), animaCsItems(vaeModels),
          {value:currentMeta.anima_vae_name||"", placeholder:t("adm_edit_meta_anima_default")});
      }
      const stepsOnEl=document.getElementById("mm_steps_on"), stepsRowEl=document.getElementById("mm_steps_row");
      if(stepsOnEl){
        stepsOnEl.onchange=()=>{ stepsRowEl.style.display=stepsOnEl.checked?"":"none"; };
        document.getElementById("mm_steps").oninput=e=>{ document.getElementById("mm_steps_val").textContent=e.target.value; };
      }
      const categoryPills=new Set(kind==="lora"?(currentMeta.model_category||[]):[]);
      const pillsEl=document.getElementById("mmCategoryPills");
      if(pillsEl) pillsEl.querySelectorAll(".seg-btn").forEach(b=>b.onclick=()=>{
        const c=b.dataset.c;
        if(categoryPills.has(c)) categoryPills.delete(c); else categoryPills.add(c);
        b.classList.toggle("on", categoryPills.has(c));
      });
      document.getElementById("mm_save").onclick=async()=>{
        const display_name=document.getElementById("mm_name").value.trim()||null;
        const description=document.getElementById("mm_desc").value.trim()||null;
        const typeEl=document.getElementById("mm_type");
        const model_type=typeEl?(typeEl.value.trim()||null):null;
        const stepsEl=document.getElementById("mm_steps");
        const default_steps=(stepsEl&&stepsOnEl&&stepsOnEl.checked)?parseInt(stepsEl.value,10):null;
        const body={display_name, description, model_type, default_steps};
        // model_category is LoRA-only — omitted entirely for checkpoints so
        // the backend leaves whatever's already stored untouched instead of
        // overwriting it to null on every unrelated-field save.
        if(kind==="lora") body.model_category=[...categoryPills];
        if(isAnimaCkpt){
          body.anima_clip_name=animaClipCs.value||null;
          body.anima_vae_name=animaVaeCs.value||null;
        }
        try{
          await api(routeBase+encodeURIComponent(name)+"/meta", j("PUT",body));
          _imagegenCheckpoints=null; _checkpointPreviews=null; _loraPreviews=null;
          _samplerPreviews=null; _schedulerPreviews=null;
          closeModal(); toast(t("adm_edit_meta_saved")); render();
        }catch(e){ errorToast("Failed: "+e.message); }
      };
    };
    main.querySelectorAll("[data-ckpt-edit]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.ckptEdit;
      openEditMetaModal("ckpt", name, previews[name]||{});
    });
    main.querySelectorAll("[data-lora-edit]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.loraEdit;
      openEditMetaModal("lora", name, loraPreviews[name]||{});
    });
    main.querySelectorAll("[data-samp-edit]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.sampEdit;
      openEditMetaModal("samp", name, samplerPreviews[name]||{});
    });
    main.querySelectorAll("[data-sched-edit]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.schedEdit;
      openEditMetaModal("sched", name, schedulerPreviews[name]||{});
    });
    main.querySelectorAll("[data-upsc-edit]").forEach(b=>b.onclick=()=>{
      const name=b.dataset.upscEdit;
      openEditMetaModal("upsc", name, upscalerPreviews[name]||{});
    });

    // ---- Config panel handlers ----
    const sFetch=$("#s_fetch");
    if(sFetch) sFetch.onclick=async()=>{
      sFetch.textContent="…";
      try{
        const base=$("#s_base")?.value.trim()||"";
        const key=$("#s_key")?.value.trim()||"";
        const params=new URLSearchParams(); if(base) params.set("base_url",base); if(key) params.set("api_key",key);
        const {models}=await api("/api/models"+(params.toString()?"?"+params:""));
        if(models?.length) fillModelList("s_model_list","s_chat",models);
        else toast("No models returned");
      }catch(e){ errorToast("Fetch failed: "+e.message); }
      sFetch.textContent="Fetch";
    };
    const stEmbed=$("#s_testembed");
    if(stEmbed) stEmbed.onclick=async()=>{
      stEmbed.textContent="…";
      try{
        const testBody={embed_base_url:$("#s_embedbase")?.value.trim(),embed_model:$("#s_embed_model")?.value.trim()};
        const ek=$("#s_ekey")?.value; if(ek) testBody.embed_api_key=ek;
        await api("/api/settings",j("PUT",testBody));
        const r=await api("/api/settings/test-embed",{method:"POST"});
        if(r.ok) toast(`✓ Embeddings OK (${r.dim} dims) at ${r.url}`);
        else toast(`✗ ${r.error}`);
      }catch(e){ errorToast("Test failed: "+e.message); }
      stEmbed.textContent="Test";
    };
    let mrHosts=(st.model_request_hosts||[]).map(h=>({host:h.host||"", api_key:"", has_api_key:!!h.has_api_key}));
    const mrHostRowHtml=(row,i)=>`
      <div class="s-mr-host-row field" data-i="${i}" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <input type="text" class="s-mr-host-name" value="${esc(row.host)}" placeholder="${esc(t("set_mr_host_ph"))}" style="flex:1">
        <input type="password" class="s-mr-host-key" value="" placeholder="${row.has_api_key?esc(t("set_mr_host_key"))+" ••••••••":esc(t("set_mr_host_key"))+" ("+esc(t("set_mr_host_key_note"))+")"}" style="flex:1">
        <button type="button" class="btn danger s-mr-host-remove" title="${esc(t("set_mr_host_remove"))}" aria-label="${esc(t("set_mr_host_remove"))}">×</button>
      </div>`;
    const syncMrHostsFromDom=()=>{
      document.querySelectorAll("#s_mr_hosts_rows .s-mr-host-row").forEach((row,i)=>{
        if(!mrHosts[i]) return;
        mrHosts[i].host=row.querySelector(".s-mr-host-name").value.trim();
        const kv=row.querySelector(".s-mr-host-key").value;
        if(kv) mrHosts[i].api_key=kv;
      });
    };
    const renderMrHostRows=()=>{
      const el=$("#s_mr_hosts_rows"); if(!el) return;
      el.innerHTML=mrHosts.length?mrHosts.map(mrHostRowHtml).join(""):`<div class="hint">${esc(t("set_mr_hosts_empty"))}</div>`;
      el.querySelectorAll(".s-mr-host-remove").forEach(b=>b.onclick=()=>{
        syncMrHostsFromDom();
        mrHosts.splice(parseInt(b.closest(".s-mr-host-row").dataset.i,10),1);
        renderMrHostRows();
      });
    };
    renderMrHostRows();
    const mrHostAdd=$("#s_mr_host_add");
    if(mrHostAdd) mrHostAdd.onclick=()=>{
      syncMrHostsFromDom();
      mrHosts.push({host:"", api_key:"", has_api_key:false});
      renderMrHostRows();
    };
    const mrHostSave=$("#s_mr_host_save");
    if(mrHostSave) mrHostSave.onclick=async()=>{
      syncMrHostsFromDom();
      const body={model_request_hosts:mrHosts.filter(h=>h.host).map(h=>({host:h.host, api_key:h.api_key||""}))};
      try{
        const r=await api("/api/settings",j("PUT",body));
        mrHosts=(r.model_request_hosts||[]).map(h=>({host:h.host||"", api_key:"", has_api_key:!!h.has_api_key}));
        renderMrHostRows();
        toast(t("adm_preview_saved"));
      }catch(e){ errorToast("Save failed: "+e.message); }
    };
    const sSave=$("#s_save_global");
    if(sSave) sSave.onclick=async()=>{
      const num=(id,fb)=>{ const v=parseFloat($("#"+id)?.value??""); return isNaN(v)?fb:v; };
      const intv=(id,fb)=>{ const v=parseInt($("#"+id)?.value??""  ,10); return isNaN(v)?fb:v; };
      let extra={}; const et=$("#s_extra")?.value.trim();
      if(et){ try{ extra=JSON.parse(et); }catch(e){ toast("Extra JSON invalid — ignored"); } }
      const str=id=>{ const v=$("#"+id)?.value.trim(); return v||null; };
      const body={
        base_url:str("s_base"), embed_base_url:str("s_embedbase"),
        chat_model:str("s_chat"), embed_model:str("s_embed_model"),
        embed_dim:intv("s_dim",768), max_tokens:intv("s_max",4096), history_turns:intv("s_hist",16),
        enable_thinking:!!($("#s_think")?.checked),
        temperature:num("s_temp",0.85), top_p:num("s_topp",0.9), top_k:intv("s_topk",0),
        min_p:num("s_minp",0), top_a:num("s_topa",0), typical_p:num("s_typ",1), tfs:num("s_tfs",1),
        smoothing_factor:num("s_smooth",0), seed:intv("s_seed",-1),
        repetition_penalty:num("s_rep",1), repetition_penalty_range:intv("s_reprange",0),
        frequency_penalty:num("s_freq",0), presence_penalty:num("s_pres",0),
        dynatemp_low:num("s_dlow",0), dynatemp_high:num("s_dhigh",0),
        mirostat_mode:intv("s_miro",0), mirostat_tau:num("s_mtau",5), mirostat_eta:num("s_meta",0.1),
        dry_multiplier:num("s_drym",0), dry_base:num("s_dryb",1.75), dry_allowed_length:intv("s_dryl",2),
        xtc_threshold:num("s_xtct",0.1), xtc_probability:num("s_xtcp",0),
        default_language:str("s_deflang")||"English",
        comfyui_url:str("s_comfy_url"), comfyui_checkpoint:str("s_comfy_ckpt"),
        stop:($("#s_stop")?.value||"").split("\n").map(s=>s.trim()).filter(Boolean),
        model_request_hosts:(()=>{ syncMrHostsFromDom(); return mrHosts.filter(h=>h.host).map(h=>({host:h.host, api_key:h.api_key||""})); })(),
        embed_link_hosts:($("#s_embed_hosts")?.value||"").split("\n").map(s=>s.trim()).filter(Boolean),
        extra_params:extra, system_suffix:$("#s_suffix")?.value??null, post_history:$("#s_posthist")?.value??null };
      const key=$("#s_key")?.value.trim(); if(key) body.api_key=key;
      const ekey=$("#s_ekey")?.value.trim(); if(ekey) body.embed_api_key=ekey;
      try{
        const r=await api("/api/settings",j("PUT",body));
        const sa=$("#s_api"); if(sa){ API=sa.value.trim().replace(/\/+$/,""); store.set("api",API); }
        document.querySelectorAll("#s_model_list").forEach(el=>el.style.display="none");
        toast(r.reindexed?"Saved — vector index rebuilt.":"Configuration saved.");
      }catch(e){ errorToast("Save failed: "+e.message); }
    };
  };
  render();
  // Moderation queue counts otherwise only ever update on a manual reload —
  // an admin sitting on this tab waiting for new signups/reports has no way
  // to know something landed without refreshing. Self-cleaning poll (checks
  // main.isConnected each tick, same idiom as personas.js's
  // pollUntilClassified) instead of a teardown hook, since there's no
  // existing "leaving this view" callback to hang a clearInterval off of.
  // Skipped while a modal is open so it can't yank focus/scroll out from
  // under whatever the admin is mid-editing.
  const _modPollIv=setInterval(()=>{
    if(!main.isConnected){ clearInterval(_modPollIv); return; }
    if(_adminTab==="moderation" && !document.querySelector(".scrim.open")) render();
  },20000);
}
