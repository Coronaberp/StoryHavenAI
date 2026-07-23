"use strict";
/* ============================ ADMIN: moderation queues ============================
   Pending signups, flagged endpoints, password-reset/model/title requests,
   image/content reports — every queue an admin has to actively clear. */
const _mrKeys={};

function _admModerationPanelHTML({pending, flagged, resetReqs, modelReqs, titleReqs, imageReports, contentReports, isDev, attentionTotal}){
  return `
    <div class="adash-panel-head"><div><div class="adash-eyebrow">${esc(t("adm_nav_moderation"))}</div><h2 class="adash-h2">${esc(t("adm_needs_attention"))} <span class="adash-count">${attentionTotal}</span></h2></div></div>
    ${_admModQueue("⏳ "+t("adm_pending"), pending, t("adm_nothing_pending"), u=>`
      <div class="adash-rowcard warn">
        <div class="adash-rowmain"><div><div class="adash-rowtitle">${esc(u.username)}</div><div class="adash-rowsub">${esc(t("adm_awaiting"))}</div></div></div>
        <div class="adash-rowactions">
          <button class="btn primary" data-approve="${u.id}">${esc(t("adm_approve"))}</button>
          <button class="btn danger" data-deny="${u.id}">${esc(t("adm_deny"))}</button>
        </div>
      </div>`)}
    ${_admModQueue("🚩 "+t("admin_flagged_title"), flagged, t("adm_nothing_pending"), fl=>`
      <div class="adash-rowcard warn">
        <div class="adash-rowmain"><div><div class="adash-rowtitle mono" style="word-break:break-all;font-size:13px;">${esc(fl.url)}</div><div class="adash-rowsub">${esc(fl.username||fl.user_id)} · ${esc(t("admin_flagged_reason"))}: ${esc(fl.reason)}</div>${fl.detail?`<pre class="adash-netlog mono" style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;padding:8px;border-radius:6px;background:var(--bg2,#1a1a1a);font-size:11.5px;max-height:220px;overflow:auto;">${esc(fl.detail)}</pre>`:""}</div></div>
        <div class="adash-rowactions">
          <button class="btn" data-allow-ep="${esc(fl.id)}">${esc(t("admin_flagged_allow"))}</button>
          <button class="btn danger" data-block-ep="${esc(fl.id)}">${esc(t("admin_flagged_block"))}</button>
        </div>
      </div>`)}
    ${_admModQueue("🔑 "+t("adm_reset_reqs"), resetReqs, t("adm_nothing_pending"), r=>`
      <div class="adash-rowcard warn">
        <div class="adash-rowmain"><div><div class="adash-rowtitle">${esc(r.username)}</div><div class="adash-rowsub mono">${esc(t("adm_reset_requested"))} · ${esc(new Date(r.created*1000).toLocaleString())}</div></div></div>
        <div class="adash-rowactions">
          <button class="btn primary" data-pr-approve="${esc(r.id)}">${esc(t("adm_approve"))}</button>
          <button class="btn danger" data-pr-deny="${esc(r.id)}">${esc(t("adm_deny"))}</button>
        </div>
      </div>`)}
    ${_admModQueue("🧩 "+t("adm_model_reqs_title"),
      // Rejected requests are done (nothing left to do) — this queue is for
      // what's still actionable, not a permanent history of every request
      // ever made. Deliberately NOT filtering out "fulfilled" approved
      // requests here: the fulfilled flag is a best-effort fuzzy name match
      // against ComfyUI's installed files (see admin.py's _alnum_only) and
      // can false-positive on two genuinely different models that happen to
      // share a name prefix (e.g. a LoRA and its separate "- Anima" variant)
      // — a false positive used to make the whole row (and the only way to
      // get its download command) vanish from the admin/dev with no way to
      // get it back short of re-approving. It's shown as an informational
      // badge only now; an admin dismisses a row by rejecting it once done.
      modelReqs.filter(mr=>mr.status==="pending" || mr.status==="approved"),
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
          ${isDev&&mr.status==="approved"&&mr.resolved_api_key?`<div class="adash-rowsub mono">Authorization: Bearer ••••••••</div>`:""}
          ${isDev&&mr.status==="approved"&&mr.fulfilled?`<div class="adash-rowsub" style="color:var(--accent);">✓ ${esc(t("mr_fulfilled"))} <span class="hint">(auto-detected — double check before assuming this exact request is done)</span></div>`:""}
          ${isDev&&mr.status==="approved"?`<div class="adash-rowsub hint">${esc(t("mr_anima_hint"))}</div>`:""}
        </div></div>
        <div class="adash-rowactions">
          ${mr.status==="pending"?`<button class="btn primary" data-mr-approve="${esc(mr.id)}">${esc(t("adm_approve"))}</button>
              <button class="btn danger" data-mr-reject="${esc(mr.id)}">${esc(t("adm_deny"))}</button>`:""}
          ${isDev&&mr.status==="approved"?`<button class="btn" data-mr-curl="${esc(mr.id)}" data-mr-name="${esc(mr.model_name)}" data-mr-url="${esc(mr.source_url)}" data-mr-type="${esc(mr.request_type||"checkpoint")}" data-mr-vae-url="${esc(mr.vae_url||"")}" data-mr-te-url="${esc(mr.text_encoder_url||"")}">${esc(t("mr_copy_curl"))}</button>`:""}
          ${mr.status==="approved"?`<button class="btn" data-mr-done="${esc(mr.id)}" title="Remove from this queue once installed">Done</button>`:""}
        </div>
      </div>`;
    })}
    ${_admModQueue("🏷️ "+t("adm_title_reqs"), titleReqs, t("adm_nothing_pending"), tr=>`
      <div class="adash-rowcard warn">
        <div class="adash-rowmain"><div><div class="adash-rowtitle"><span class="pf-badge pf-badge-title">${esc(tr.title||"")}</span> ${esc(tr.display_name||tr.username)}</div><div class="adash-rowsub">${esc(t("adm_title_requested_by"))} @${esc(tr.username)}</div></div></div>
        <div class="adash-rowactions">
          <button class="btn primary" data-tr-approve="${esc(tr.id)}">${esc(t("adm_approve"))}</button>
          <button class="btn danger" data-tr-reject="${esc(tr.id)}">${esc(t("adm_deny"))}</button>
        </div>
      </div>`)}
    ${_admModQueue("🖼️ "+t("adm_image_reports"), imageReports, t("adm_nothing_pending"), ir=>`
      <div class="adash-rowcard warn">
        <div class="adash-rowmain">
          <img class="adash-report-thumb" src="${esc(mediaURL(ir.image||""))}" alt="">
          <div><div class="adash-rowtitle">${esc(t("adm_review_reported"))}: ${ir.claimed_explicit?"NSFW":"SFW"} <span class="rating-detail-disc">(${esc(t("adm_review_current"))}: ${ir.current_explicit?"NSFW":"SFW"})</span></div><div class="adash-rowsub">${esc(ir.reporter_username||ir.reporter_id)}${ir.note?" · "+esc(ir.note):""}</div></div>
        </div>
        <div class="adash-rowactions">
          <button class="btn primary" data-ir-review="${esc(ir.id)}">${esc(t("adm_review"))}</button>
        </div>
      </div>`)}
    ${_admModQueue("🚩 "+t("adm_content_reports"), contentReports, t("adm_nothing_pending"), cr=>`
      <div class="adash-rowcard warn">
        <div class="adash-rowmain">
          ${cr.image?`<img class="adash-report-thumb" src="${esc(mediaURL(cr.image))}" alt="">`:""}
          <div><div class="adash-rowtitle">${esc(cr.label||cr.kind)}</div><div class="adash-rowsub">${esc(cr.reporter_username||cr.reporter_id)}${cr.note?" · "+esc(cr.note):""}</div></div>
        </div>
        <div class="adash-rowactions">
          <button class="btn primary" data-cr-review="${esc(cr.id)}">${esc(t("adm_review"))}</button>
        </div>
      </div>`)}`;
}

function _admWireModeration(main, {allUsers, imageReports, contentReports}, render){
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

  main.querySelectorAll("[data-allow-ep]").forEach(b=>b.onclick=async()=>{
    try{ await api("/api/admin/flagged-endpoints/"+b.dataset.allowEp+"/allow",{method:"POST"}); toast("Endpoint allowed."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });
  main.querySelectorAll("[data-block-ep]").forEach(b=>b.onclick=async()=>{
    if(!(await confirmAction(b, "Block this endpoint?"))) return;
    try{ await api("/api/admin/flagged-endpoints/"+b.dataset.blockEp+"/block",{method:"POST"}); toast("Endpoint blocked."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });

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
  main.querySelectorAll("[data-mr-done]").forEach(b=>b.onclick=async()=>{
    if(!(await confirmAction(b, "Mark this model request as installed and remove it from the queue?", "Mark done"))) return;
    try{ await api("/api/admin/model-requests/"+b.dataset.mrDone+"/complete",{method:"POST"}); toast("Marked installed."); render(); }
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
    //
    // The real filename/content-type only becomes known once the download
    // actually starts (Civitai's redirect chain reveals it via
    // Content-Disposition, not the request URL) — some listings, especially
    // upscalers, turn out to be a .zip bundle rather than a raw model file,
    // which a guessed .pth/.safetensors extension would silently mislabel.
    // Download to a neutral temp name first, then branch on the real file
    // type: a zip gets extracted and every recognized model file inside is
    // moved into place directly, no manual step needed either way.
    const block=(dir,u,fname,key)=>{
      const tmp=fname+".dl";
      const extractDir=fname+"_extract";
      // Detected via the raw ZIP magic bytes (PK\x03\x04), not `file`'s text
      // output — `file`'s wording for a zip varies by system/magic-db version
      // (confirmed in practice: it reported a real, valid zip as plain "data"
      // on one system, silently skipping extraction and leaving the renamed
      // raw zip bytes sitting there as a fake ".pth" that ComfyUI can't load).
      //
      // A ZIP hit is NOT automatically a "bundle to unpack": since PyTorch
      // ~1.6, torch.save()'s OWN on-disk format for a single checkpoint is
      // itself a zip container (members named <root>/data.pkl, <root>/data/
      // <n>, <root>/version — none of which end in .pth/.safetensors/.ckpt/
      // .pt). Treating every zip as "extract and pick matching-extension
      // files" found zero matches for a real torch checkpoint like this,
      // silently discarding the entire download with no file left behind and
      // no error surfaced. Only extract when the zip does NOT carry that
      // data.pkl signature — a genuine torch checkpoint zip is used as-is,
      // just renamed, since torch.load()/spandrel already read this format
      // natively without any unzipping.
      return `cd "${base_dir}/${dir}" && sudo curl -L -A "${ua}"${authPart(key)} "${u}" -o "${tmp}" && ` +
        `if [ "$(head -c2 "${tmp}" 2>/dev/null)" = "PK" ] && ! unzip -l "${tmp}" 2>/dev/null | grep -q '/data\\.pkl$'; then ` +
          `sudo mkdir -p "${extractDir}" && sudo unzip -o "${tmp}" -d "${extractDir}" && ` +
          `sudo find "${extractDir}" -type f \\( -iname "*.safetensors" -o -iname "*.ckpt" -o -iname "*.pt" -o -iname "*.pth" \\) -exec mv {} . \\; && ` +
          `sudo chown 525287:525287 *.safetensors *.ckpt *.pt *.pth 2>/dev/null; ` +
          `sudo rm -rf "${tmp}" "${extractDir}"; ` +
        `else ` +
          `sudo mv "${tmp}" "${fname}" && sudo chown 525287:525287 "${fname}"; ` +
        `fi`;
    };
    const cmds=[block(subdir,url,slug,keys.api_key)];
    if(type==="anima"&&vaeUrl) cmds.push(block("vae",vaeUrl,base+"_vae"+extFor(vaeUrl),keys.vae_api_key));
    if(type==="anima"&&teUrl) cmds.push(block("text_encoders",teUrl,base+"_text_encoder"+extFor(teUrl),keys.text_encoder_api_key));
    const cmd=cmds.join(" && ");
    navigator.clipboard?.writeText(cmd);
    toast(t("mr_curl_copied"));
  });

  main.querySelectorAll("[data-tr-approve]").forEach(b=>b.onclick=async()=>{
    try{ await api("/api/admin/title-requests/"+b.dataset.trApprove+"/approve",{method:"POST"}); toast("Title approved."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });
  main.querySelectorAll("[data-tr-reject]").forEach(b=>b.onclick=async()=>{
    if(!(await confirmAction(b, "Reject this title request?"))) return;
    try{ await api("/api/admin/title-requests/"+b.dataset.trReject+"/reject",{method:"POST"}); toast("Title rejected."); render(); }
    catch(e){ errorToast("Failed: "+e.message); }
  });

  main.querySelectorAll("[data-ir-review]").forEach(b=>b.onclick=()=>{
    const rep=imageReports.find(r=>r.id===b.dataset.irReview);
    if(rep) adminReviewImageModal(rep, render);
  });
  main.querySelectorAll("[data-cr-review]").forEach(b=>b.onclick=()=>{
    const rep=contentReports.find(r=>r.id===b.dataset.crReview);
    if(rep) adminReviewContentModal(rep, render);
  });
}
