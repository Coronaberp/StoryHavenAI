"use strict";
/* ============================ ADMIN: service health + server logs ============================ */
function _admFmtDuration(secs){
  secs=Math.floor(secs);
  const d=Math.floor(secs/86400), h=Math.floor((secs%86400)/3600), m=Math.floor((secs%3600)/60);
  const parts=[];
  if(d) parts.push(d+"d"); if(h||d) parts.push(h+"h"); parts.push(m+"m");
  return parts.join(" ");
}
function _admHealthSvcLabel(name){
  return ({
    database:t("adm_health_svc_database"), chat_llm:t("adm_health_svc_chat_llm"),
    embed_llm:t("adm_health_svc_embed_llm"), comfyui:t("adm_health_svc_comfyui"),
    image_classify_llm:t("adm_health_svc_image_classify_llm"),
    modal:t("adm_health_svc_modal")}[name]||name);
}
function _admHealthLineChart(points){
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
function _admHealthPanelHTML(){
  return `
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
}
// Wires the health/logs panel and returns {renderHealth, renderLogs} so the
// tab-switch handler in admin-core.js can re-trigger a refresh without
// rebuilding the panel's DOM (all panels are mounted once per render() call
// and merely toggled via display:none, see viewAdmin).
function _admWireHealth(activeTab){
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

  let healthRangeHours = 24;
  const renderHealth = async () => {
    const grid=document.getElementById("healthGrid"); const upBox=document.getElementById("healthUptime");
    if(!grid) return;
    grid.innerHTML = `<span style="color:var(--muted)">${esc(t("loading"))}</span>`;
    try{
      const data = await api("/api/admin/service-health?hours="+healthRangeHours);
      if(upBox) upBox.innerHTML = `<div class="adash-health-process">${esc(t("adm_health_process_uptime"))}: <b>${esc(_admFmtDuration(data.process_uptime_seconds))}</b></div>`;
      grid.innerHTML = data.services.map(s=>{
        const spark = _admHealthLineChart(s.latency_history||[]);
        const pct = s.uptime_pct_24h==null ? "—" : s.uptime_pct_24h+"%";
        const avg = s.avg_latency_ms==null ? "—" : s.avg_latency_ms+" ms";
        return `<div class="adash-health-card ${s.ok?"up":"down"}">
          <div class="adash-health-card-head">
            <span class="adash-health-dot ${s.ok?"up":"down"}"></span>
            <span class="adash-health-name">${esc(_admHealthSvcLabel(s.name))}</span>
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

  return { renderHealth, renderLogs };
}
