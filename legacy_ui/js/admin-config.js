"use strict";
/* ============================ ADMIN: site configuration ============================
   Global instance config (moved out of the Settings modal): chat/embed
   endpoints, ComfyUI, model-request/embed-link host allowlists, sampling
   defaults, prompt injection, backend URL. */
const _admConfigKobold="http://koboldcpp:5001/v1";

function _admConfigPanelHTML(st){
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
  const kobold=_admConfigKobold;
  return `
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
        <div class="field" style="margin:0"><textarea id="s_embed_hosts" rows="4" style="font-family:var(--mono);font-size:13px;" placeholder="tenor.com">${esc((st.embed_link_hosts||[]).join("\n"))}</textarea></div>
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
}

function _admWireConfig(main, st, render){
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

  // sliders in the config panel
  main.querySelectorAll(".sf-range").forEach(r=>{
    const numEl=document.getElementById(r.dataset.target); if(!numEl) return;
    r.addEventListener("input",()=>{ numEl.value=r.value; });
    numEl.addEventListener("input",()=>{ const v=parseFloat(numEl.value); if(!isNaN(v)) r.value=v; });
  });
  const deflangEl=$("#s_deflang"); if(deflangEl && typeof attachLangAC==="function") attachLangAC(deflangEl);

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
}
