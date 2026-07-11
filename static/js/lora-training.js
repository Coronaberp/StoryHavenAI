"use strict";
/* ============================ LORA TRAINING ============================ */

// Appends rather than overwrites the Training Progress log — the old
// single-line-only version left the panel showing one frozen line (e.g.
// "accelerator device: cuda") for the whole silent setup/caching phase, with
// no way to tell whether anything was actually still happening. Skips blank
// heartbeat pings (see modal_app/lora_train.py's keep-alive comment) and an
// exact repeat of the last line (the recovery poll re-sends the DB's single
// stored line every 3s even when nothing new has happened).
function _appendTrainLog(logEl, line){
  if(!line) return;
  const lines=(logEl.dataset.lines?JSON.parse(logEl.dataset.lines):[]);
  if(lines[lines.length-1]===line) return;
  // Only force-scroll to the bottom if the user was already there — forcing
  // it on every single append made it impossible to scroll up and actually
  // read past lines, since the next tick (heartbeat or real log line) would
  // instantly yank it back down.
  const wasAtBottom=logEl.scrollHeight-logEl.scrollTop-logEl.clientHeight<20;
  lines.push(line);
  if(lines.length>200) lines.shift();
  logEl.dataset.lines=JSON.stringify(lines);
  logEl.textContent=lines.join("\n");
  if(wasAtBottom) logEl.scrollTop=logEl.scrollHeight;
}

// Labeled Loss-vs-Step training curve (loss is the one metric here that
// actually varies over time — learning rate is held constant by this app's
// training config, so there's nothing meaningful to chart for it the way a
// LR-schedule chart in Vertex AI/TensorBoard would). Draws axis labels and
// gridlines rather than a bare sparkline so it's clear what's being shown.
function _drawLossChart(canvas, metrics){
  if(!canvas) return;
  const points=(metrics||[]).filter(p=>p.loss!=null);
  const w=canvas.width=canvas.clientWidth||300, h=canvas.height=140;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,w,h);
  const muted=getComputedStyle(document.documentElement).getPropertyValue("--muted")||"#888";
  const accent=getComputedStyle(document.documentElement).getPropertyValue("--accent")||"#E3BD6C";
  if(points.length<2){
    ctx.fillStyle=muted; ctx.font="11px var(--mono, monospace)";
    ctx.fillText("Loss vs step — waiting for enough data points…", 8, h/2);
    return;
  }
  const padL=42, padB=16, padT=16, padR=8;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const losses=points.map(p=>p.loss);
  const steps=points.map(p=>p.step||0);
  const minLoss=Math.min(...losses), maxLoss=Math.max(...losses);
  const range=(maxLoss-minLoss)||1;
  const minStep=Math.min(...steps), maxStep=Math.max(...steps);
  const stepRange=(maxStep-minStep)||1;
  ctx.strokeStyle=muted; ctx.fillStyle=muted; ctx.font="10px var(--mono, monospace)";
  ctx.lineWidth=1;
  // horizontal gridlines + y-axis loss labels
  for(let i=0;i<=2;i++){
    const y=padT+plotH*(i/2);
    const val=maxLoss-(range*(i/2));
    ctx.globalAlpha=0.15;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
    ctx.globalAlpha=1;
    ctx.fillText(val.toFixed(3), 2, y+3);
  }
  ctx.fillText(`step ${minStep}`, padL, h-2);
  ctx.fillText(`step ${maxStep}`, w-padR-40, h-2);
  ctx.fillText("Loss", padL, 10);
  ctx.strokeStyle=accent; ctx.lineWidth=2;
  ctx.beginPath();
  points.forEach((p,i)=>{
    const x=padL+((p.step-minStep)/stepRange)*plotW;
    const y=padT+plotH-((p.loss-minLoss)/range)*plotH;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.stroke();
}

// A single always-current row, overwritten in place each poll — not one row
// per epoch (that grew the table for the whole run's history, which read as
// "adding new rows" even though it was really just intentional per-epoch
// history; this app only ever needs "where's it at right now").
function _renderMetricsTable(tbody, metrics, job){
  if(!tbody) return;
  const arr=metrics||[];
  const m=arr[arr.length-1];
  if(!m){ tbody.innerHTML=""; return; }
  const totalEpochs=m.total_epochs||"?";
  const eta=m.eta_text||"—";
  const speed=m.speed_img_s!=null?`${m.speed_img_s.toFixed(1)} img/s`:"—";
  const gpu=m.gpu_mem_gb!=null?`${m.gpu_mem_gb.toFixed(1)} GB`:"—";
  const loss=m.loss!=null?m.loss.toFixed(4):"—";
  const lr=job.learning_rate!=null?job.learning_rate.toExponential(2):"—";
  const status=job.status==="done"?"✓ Completed":job.status==="failed"?"✗ Failed":"▶ Running";
  const statusColor=status.startsWith("✗")?"var(--danger,#e66)":status.startsWith("▶")?"var(--accent)":"var(--muted)";
  tbody.innerHTML=`<tr style="border-top:1px solid var(--line);">
      <td style="padding:4px 8px 4px 0;">${m.epoch??0}/${totalEpochs}</td>
      <td style="padding:4px 8px;">${m.step||0}/${job.steps||"?"}</td>
      <td style="padding:4px 8px;">${loss}</td>
      <td style="padding:4px 8px;">${lr}</td>
      <td style="padding:4px 8px;">${speed}</td>
      <td style="padding:4px 8px;">${eta}</td>
      <td style="padding:4px 8px;">${gpu}</td>
      <td style="padding:4px 0 4px 8px;color:${statusColor};">${status}</td>
    </tr>`;
}

// Shared renderer for both the Upload and Download tables — same shape
// ({name,bytes,total_bytes,speed_mb_s}), just a different label/tbody.
function _renderTransferTable(tbody, tp){
  if(!tbody) return;
  const recv=(tp.bytes||0)/(1024*1024);
  const total=tp.total_bytes?tp.total_bytes/(1024*1024):null;
  const pct=total?Math.min(100,Math.round(recv/total*100))+"%":"—";
  const speed=tp.speed_mb_s!=null?`${tp.speed_mb_s.toFixed(1)} MB/s`:"—";
  tbody.innerHTML=`<tr style="border-top:1px solid var(--line);">
      <td style="padding:4px 8px 4px 0;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${esc(tp.name||"")}</td>
      <td style="padding:4px 8px;">${recv.toFixed(0)}${total?`/${total.toFixed(0)}`:""} MB</td>
      <td style="padding:4px 8px;">${pct}</td>
      <td style="padding:4px 0 4px 8px;">${speed}</td>
    </tr>`;
}

const LT_L4_USD_PER_HOUR=0.80;
// No pre-run speed is known for a job that hasn't started, so this derives
// img/s from this admin's own past completed runs of the same architecture
// (steps/batch varies job to job, but img/s throughput is roughly stable for
// a given architecture+resolution on the same rented GPU) — falling back to
// a conservative flat guess only when no history exists yet. +5 minutes on
// top covers the provisioning/caching/finalizing overhead this estimate
// otherwise can't see, per the fixed padding requested for this feature.
function _estimateTrainingRun(jobs, architecture, steps, batchSize){
  const speeds=[];
  (jobs||[]).forEach(j=>{
    if(j.architecture!==architecture) return;
    (j.metrics||[]).forEach(m=>{ if(m.speed_img_s>0) speeds.push(m.speed_img_s); });
  });
  const avgSpeed=speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : (architecture==="anima"?0.35:0.8);
  const trainSeconds=(steps*batchSize)/avgSpeed;
  const totalSeconds=trainSeconds+5*60;
  const totalHours=totalSeconds/3600;
  return {seconds:totalSeconds, cost:totalHours*LT_L4_USD_PER_HOUR, fromHistory:speeds.length>0};
}
function _formatDuration(seconds){
  const mins=Math.round(seconds/60);
  if(mins<60) return `${mins}m`;
  const h=Math.floor(mins/60), m=mins%60;
  return m?`${h}h ${m}m`:`${h}h`;
}

// Reload/tab-revisit recovery: a training job keeps running server-side even
// though the fetch/SSE reader that was watching it is long gone (it lived
// only in the tab that got refreshed) — this class polls the job row instead
// of resetting to the idle "no training yet" panel, since db.update_lora_
// training_job already persists status/progress/log on every SSE event
// create_and_stream_lora_training_job relays server-side. Rebuilding the
// table/chart/log from job.metrics/job.log (persisted server-side) on every
// single poll — not only the first one after a reload — is what keeps a live
// view and a just-reattached one showing exactly the same thing.
//
// One instance is created per renderTrainingTab call and owns the polling
// interval + which job id it's watching — this replaces what used to be
// free-floating module-level `currentJobId`/`recoveredPolling` variables and
// a bare `watchTrainingJob` function.
const TRAIN_POLL_FAIL_TOAST_THRESHOLD=3;

class TrainingJobWatcher{
  constructor(){
    this.jobId=null;
    this.interval=null;
    this.consecutiveFailures=0;
    this.onVisible=null;
  }
  get isWatching(){ return this.interval!=null; }
  stop(){
    clearInterval(this.interval);
    this.interval=null;
    this.consecutiveFailures=0;
    if(this.onVisible){ document.removeEventListener("visibilitychange", this.onVisible); this.onVisible=null; }
  }
  // refs: the DOM elements for this render of the Train LoRA tab.
  // setStartBtnMode(running): toggles the Start/Abort button.
  // onSettled(job): called once the job leaves an active status (done/failed).
  watch(jobId, refs, setStartBtnMode, onSettled){
    // Every call replaces #lt_live's contents on the next renderTrainingTab,
    // detaching the elements this instance captures below — without
    // stopping the prior interval here, switching tabs and back stacks a new
    // 5s poller on top of the old one forever (each still "running" against
    // stale, now-orphaned DOM nodes).
    this.stop();
    this.jobId=jobId;
    const {statusLabel,bar,logEl,costBanner,metricsTable,chart,metricsWrap,finalizing,doneTile,
           uploadWrap,uploadTable,downloadWrap,downloadTable}=refs;
    setStartBtnMode(true);
    const poll=async()=>{
      // Belt-and-braces: if this instance's own captured node was detached by
      // a newer watch() call anyway (e.g. a race during a fast double
      // tab-switch), self-terminate instead of writing into detached DOM.
      if(!statusLabel.isConnected){ this.stop(); return; }
      let job;
      try{
        job=(await api("/api/admin/lora-training/jobs")).find(j=>j.id===jobId);
        this.consecutiveFailures=0;
      }catch(e){
        this.consecutiveFailures++;
        console.error(`training job poll failed (attempt ${this.consecutiveFailures}):`, e);
        if(this.consecutiveFailures===TRAIN_POLL_FAIL_TOAST_THRESHOLD){
          errorToast("Lost touch with the training job status — the panel may be stale. Reload if it doesn't recover.");
        }
        return;
      }
      if(!job) return;
      statusLabel.textContent=`Status: ${job.status}`+(job.resume_from_lora?` · ↻ resumed from ${job.resume_from_lora}`:"");
      bar.style.width=Math.round((job.progress||0)*100)+"%";
      if(job.log) _appendTrainLog(logEl, job.log);
      this._updateCostBanner(costBanner, job);
      // Upload only shows during provisioning (before any step has run).
      // Download shows whenever a checkpoint is actually being fetched —
      // this can happen mid-"training" (a scheduled or manually-requested
      // checkpoint) without pausing training, so it renders alongside the
      // metrics table/chart rather than replacing them; training itself
      // only actually stops once status flips to "saving" (the final
      // end-of-run download), which is when the metrics view hides in
      // favor of the finalizing/download view.
      const tp=job.transfer_progress||{};
      const uploadNow=tp.phase==="upload" && job.status==="provisioning";
      const downloadNow=tp.phase==="download" && ["training","saving"].includes(job.status);
      const trainingNow=job.status==="training";
      const finalizingNow=job.status==="saving" && !downloadNow;
      const doneNow=job.status==="done";
      uploadWrap.style.display=uploadNow?"":"none";
      downloadWrap.style.display=downloadNow?"":"none";
      metricsWrap.style.display=trainingNow?"":"none";
      finalizing.style.display=finalizingNow?"":"none";
      doneTile.style.display=doneNow?"":"none";
      if(uploadNow) _renderTransferTable(uploadTable, tp);
      if(downloadNow) _renderTransferTable(downloadTable, tp);
      if(trainingNow){
        _renderMetricsTable(metricsTable, job.metrics, job);
        _drawLossChart(chart, job.metrics);
      }
      if(["queued","provisioning","training","saving"].includes(job.status)) return;
      this.stop();
      this.jobId=null; setStartBtnMode(false);
      if(job.status==="failed") errorToast("Training failed: "+(job.error||"unknown error"));
      else if(job.status==="done") toast("LoRA training complete: "+(job.output_file||""));
      onSettled && onSettled(job);
    };
    this.interval=setInterval(poll, 5000);
    // Background tabs get their setInterval throttled by the browser (often
    // to 1/minute or worse), so a job can finish minutes ago and this panel
    // still shows stale progress until the next throttled tick — poll
    // immediately on return to the tab instead of waiting on it.
    this.onVisible=()=>{ if(document.visibilityState==="visible") poll(); };
    document.addEventListener("visibilitychange", this.onVisible);
    poll();
  }
  // L4 is the GPU modal_app/lora_train.py's train() function requests (see
  // that file's own comment on why) — this is a rough estimate from elapsed
  // wall-clock time since the job was created, not Modal's actual metered
  // billing, since there's no live-cost API this app calls; it's clearly
  // labeled "est." for that reason.
  _updateCostBanner(banner, job){
    const L4_USD_PER_HOUR=0.80;
    if(!["queued","provisioning","training","saving"].includes(job.status)){ banner.style.display="none"; return; }
    const elapsedHours=Math.max(0, (Date.now()/1000 - job.created))/3600;
    const cost=elapsedHours*L4_USD_PER_HOUR;
    banner.style.display="flex";
    banner.textContent=`💰 Est. cost so far: $${cost.toFixed(3)} (L4 @ $${L4_USD_PER_HOUR.toFixed(2)}/hr, running ${Math.round(elapsedHours*60)}m)`;
  }
}

async function renderTrainingTab(body, presetTestEntry){
  if(!(ME && ME.is_admin)){ body.innerHTML=`<div class="empty"><div class="big">${esc(t("access_denied"))}</div></div>`; return; }
  const {checkpoints, previews}=await getImagegenOptions();
  let jobs=[];
  try{ jobs=await api("/api/admin/lora-training/jobs"); }catch(e){ errorToast("Could not load training jobs: "+e.message); }

  // Every field the admin has typed persists across tab switches/reloads even
  // without an explicit save — losing a half-filled training form (especially
  // after already picking through dozens of images) to an accidental nav
  // away is exactly the kind of friction Generate's own ig_create_gen_state
  // already avoids, so Train LoRA gets the same treatment here.
  let lt=null;
  try{ lt=JSON.parse(localStorage.getItem("lt_train_state")||"null"); }catch(e){}
  lt=lt||{};
  const persistLt=patch=>{
    Object.assign(lt, patch);
    try{ localStorage.setItem("lt_train_state", JSON.stringify(lt)); }catch(e){}
  };

  body.innerHTML=`<div class="ig-layout">
    <aside class="ig-panel">
      <div class="ig-panel-title">Train a LoRA</div>
      <div class="field"><label>Name</label><input type="text" id="lt_name" placeholder="my-character-lora" value="${esc(lt.name||"")}">
        <div class="hint" style="margin-top:4px;">Just a label to tell this training job apart from others later — doesn't affect the result.</div></div>
      <div class="field"><label>Trigger word</label><input type="text" id="lt_trigger" value="${esc(lt.trigger_word??"sks")}">
        <div class="hint" style="margin-top:4px;">A made-up word (like "sks") you'll type in prompts later to summon this LoRA's look. Keep it short and not a real word.</div></div>
      <div class="ig-sec" data-key="basemodel">${igSectionHead("basemodel", "Base checkpoint")}
        <div class="ig-sec-body">
          <div id="lt_ckpt"></div>
          <div class="hint" style="margin-top:8px;">The existing model this LoRA will be trained on top of. Pick whichever checkpoint you plan to actually use it with later.</div>
        </div></div>
      <div class="ig-sec" data-key="params">${igSectionHead("params", "Training parameters")}
        <div class="ig-sec-body">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
            <div class="field" style="margin:0;"><label>Resolution</label><input type="text" inputmode="numeric" id="lt_res" value="${esc(lt.resolution??"512")}"></div>
            <div class="field" style="margin:0;"><label>Batch size</label><input type="text" inputmode="numeric" id="lt_batch" value="${esc(lt.batch_size??"1")}"></div>
            <div class="field" style="margin:0;"><label>Rank</label><input type="text" inputmode="numeric" id="lt_rank" value="${esc(lt.rank??"16")}"></div>
            <div class="field" style="margin:0;"><label>Alpha</label><input type="text" inputmode="numeric" id="lt_alpha" value="${esc(lt.alpha??"16")}"></div>
            <div class="field" style="margin:0;"><label>Learning rate</label><input type="text" id="lt_lr" value="${esc(lt.learning_rate??"0.0001")}"></div>
            <div class="field" style="margin:0;"><label>Steps</label><input type="text" inputmode="numeric" id="lt_steps" value="${esc(lt.steps??"1000")}"></div>
          </div>
          <div class="hint" style="margin-top:10px;line-height:1.5;">
            <b>Resolution</b>: pixel size images are trained at (512 is the safe default; up to 1024x1024 is supported but needs more VRAM/batch headroom and takes longer).<br>
            <b>Batch size</b>: how many images are processed at once — higher is faster but uses more GPU memory. Leave at 1 if unsure.<br>
            <b>Rank</b>: how much the LoRA can learn/how big the output file is — 16 is a solid default; go higher (32-64) for a more complex look, lower (4-8) for a simple one.<br>
            <b>Alpha</b>: strength scaling for Rank — leave equal to Rank unless you know you want a different effect.<br>
            <b>Learning rate</b>: how fast it learns per step — 0.0001 is a safe default; too high can wreck the result, too low barely learns anything.<br>
            <b>Steps</b>: how many training iterations to run — more steps = more learning but risks "overfitting" (baking in your exact photos instead of the general look) if pushed too far.
          </div>
        </div></div>
      <div class="ig-sec" data-key="images">${igSectionHead("images", "Training images")}
        <div class="ig-sec-body">
          <input type="file" id="lt_images" accept="image/png,image/jpeg,image/webp" multiple hidden>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="img-pick-empty ig-train-drop" id="lt_images_drop" title="Choose images">${UPLOAD_ICON_SVG}</div>
            <div class="img-pick-empty ig-train-drop" id="lt_images_clear" title="Remove all" aria-label="Remove all">${TRASH_ICON_SVG}</div>
          </div>
          <span class="hint" id="lt_images_count"></span>
          <div id="lt_images_grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-top:10px;"></div>
          <div class="hint" style="margin-top:10px;">Pick 10-30 clear images of the same subject/style, ideally cropped similarly. Click any thumbnail to zoom in and check for defects before starting.</div>
        </div></div>
      <div class="actions" style="align-items:center;">
        <button class="btn primary" id="lt_start">Start training</button>
        <div class="lt-eta-pill" id="lt_time_est"></div>
      </div>
      <div class="hint" style="margin-top:-4px;">Training runs on a rented cloud GPU and can take anywhere from several minutes to a few hours depending on Steps/Resolution/Batch size — you can watch live progress on the right once it starts.</div>
    </aside>
    <aside class="ig-preview-pane">
      <div class="ig-sec" data-key="lt_progress" data-default="open">${igSectionHead("lt_progress", "Training progress")}
        <div class="ig-sec-body">
          <div id="lt_idle" class="hint">Preview and loss will appear here once training starts.</div>
          <div id="lt_live" style="display:none;">
            <div id="lt_cost_banner" style="display:none;margin:0 0 14px;padding:10px 14px;border-radius:10px;
                border:1px solid color-mix(in srgb, var(--accent) 55%, var(--line));
                background:color-mix(in srgb, var(--accent) 16%, var(--surface-2));
                font-family:var(--mono);font-size:13px;font-weight:600;color:var(--ink);
                align-items:center;gap:8px;"></div>
            <div id="lt_status_label" class="hint" style="margin-bottom:6px;">Status: queued</div>
            <div style="background:var(--surface-2);border-radius:8px;height:8px;overflow:hidden;margin:0 0 14px;">
              <div id="lt_progress_bar" style="background:var(--accent);height:100%;width:0%;transition:width .3s;"></div>
            </div>
            <div class="ig-sec" data-key="lt_log_sec" data-default="open" style="margin-bottom:14px;">
              ${igSectionHead("lt_log_sec", "Log")}
              <div class="ig-sec-body">
                <div id="lt_log" class="hint mono" style="white-space:pre-wrap;max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--surface-2);"></div>
              </div>
            </div>
            <div id="lt_upload_wrap" style="display:none;overflow-x:auto;margin-bottom:14px;">
              <table class="mono" style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap;">
                <thead><tr style="color:var(--muted);text-align:left;">
                  <th style="padding:4px 8px 4px 0;">Uploading</th><th style="padding:4px 8px;">Received</th>
                  <th style="padding:4px 8px;">Progress</th><th style="padding:4px 0 4px 8px;">Speed</th>
                </tr></thead>
                <tbody id="lt_upload_table"></tbody>
              </table>
            </div>
            <div id="lt_download_wrap" style="display:none;overflow-x:auto;margin-bottom:14px;">
              <table class="mono" style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap;">
                <thead><tr style="color:var(--muted);text-align:left;">
                  <th style="padding:4px 8px 4px 0;">Downloading</th><th style="padding:4px 8px;">Received</th>
                  <th style="padding:4px 8px;">Progress</th><th style="padding:4px 0 4px 8px;">Speed</th>
                </tr></thead>
                <tbody id="lt_download_table"></tbody>
              </table>
            </div>
            <div id="lt_metrics_wrap">
              <div style="overflow-x:auto;margin-bottom:14px;">
                <table class="mono" style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap;">
                  <thead><tr style="color:var(--muted);text-align:left;">
                    <th style="padding:4px 8px 4px 0;">Epoch</th><th style="padding:4px 8px;">Step</th>
                    <th style="padding:4px 8px;">Loss</th><th style="padding:4px 8px;">Learning Rate</th>
                    <th style="padding:4px 8px;">Speed</th><th style="padding:4px 8px;">ETA</th>
                    <th style="padding:4px 8px;">GPU Mem</th><th style="padding:4px 0 4px 8px;">Status</th>
                  </tr></thead>
                  <tbody id="lt_metrics_table"></tbody>
                </table>
              </div>
              <div class="ig-unsaved-warning" style="margin:0 0 14px;">⚠ This table, the chart, and the log refresh every ~5s — not continuously — so brief gaps between updates are expected, not a stall.</div>
              <div class="hint" style="margin:0 0 14px;line-height:1.5;">
                <b>Epoch</b>: one full pass through all your training images — this run repeats several times.<br>
                <b>Step</b>: one training iteration (a batch of images processed once) — Steps in the settings above is the total.<br>
                <b>Loss</b>: how wrong the model's guesses are right now — should trend down overall, though it naturally bounces around step to step.<br>
                <b>Learning Rate</b>: how big a correction each step makes — fixed for the whole run, matches what you set above.<br>
                <b>Speed</b>: images processed per second — higher is faster.<br>
                <b>ETA</b>: estimated time left for the current epoch, not the whole run.<br>
                <b>GPU Mem</b>: how much VRAM the rented GPU is using right now.<br>
                <b>Status</b>: which epoch already finished vs. the one currently running.
              </div>
              <canvas id="lt_loss_chart" style="width:100%;height:140px;display:block;"></canvas>
              <div class="ig-preview-box" style="aspect-ratio:auto;height:auto;margin-top:14px;">
                <img id="lt_preview" style="width:100%;border-radius:10px;display:none;" alt="">
              </div>
            </div>
            <div id="lt_finalizing" style="display:none;margin-bottom:14px;">
              <table class="mono" style="width:100%;border-collapse:collapse;font-size:12px;">
                <tbody><tr style="border-top:1px solid var(--line);">
                  <td style="padding:8px 8px 8px 0;width:24px;">
                    <span style="display:inline-block;width:14px;height:14px;border-radius:50%;
                      border:2px solid color-mix(in srgb, var(--accent) 40%, transparent);
                      border-top-color:var(--accent);animation:lt-spin .8s linear infinite;"></span>
                  </td>
                  <td style="padding:8px 0;color:var(--ink);">Finalizing — saving and transferring the trained LoRA off the GPU…</td>
                </tr></tbody>
              </table>
            </div>
            <div id="lt_done_tile" style="display:none;margin:0 0 14px;">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
                  padding:28px;border-radius:12px;border:1px solid color-mix(in srgb, #3c3 40%, var(--line));
                  background:color-mix(in srgb, #3c3 10%, var(--surface-2));">
                <div style="width:48px;height:48px;border-radius:10px;background:#2e7d32;color:#fff;
                    display:flex;align-items:center;justify-content:center;font-size:28px;line-height:1;">✓</div>
                <div style="font-weight:600;color:var(--ink);">Done</div>
              </div>
            </div>
            <style>@keyframes lt-spin{to{transform:rotate(360deg)}}</style>
            <button type="button" class="btn" id="lt_checkpoint_now" style="margin-top:12px;width:100%;">Request checkpoint now</button>
            <div class="hint" style="margin-top:6px;">Saves the model's current state as its own snapshot for testing — doesn't stop or affect training. Pick it from "Past jobs" (top right) once it arrives.</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="lt_test_preview" data-default="open">${igSectionHead("lt_test_preview", t("ig_preview_title"))}
        <div class="ig-sec-body">
          <div class="ig-unsaved-warning">⚠ ${esc(t("ig_unsaved_warning"))}</div>
          <div id="tl_preview_wrap" class="ig-preview-empty">
            <div class="ig-preview-box">
              <img id="tl_preview_img" alt="">
              <div class="ig-status-pill" id="tl_status_pill" style="display:none;"></div>
              <button type="button" class="ig-detail-download" id="tl_zoom" title="${esc(t("adm_preview_zoom"))}" aria-label="${esc(t("adm_preview_zoom"))}">${ZOOM_ICON_SVG}</button>
              <div id="tl_result_actions" style="display:none;">
                <button type="button" class="ig-detail-download" id="tl_upscale" style="right:140px;" title="${esc(t("ig_upscale"))}" aria-label="${esc(t("ig_upscale"))}">${SPARKLE_ICON_SVG}</button>
                <button type="button" class="ig-detail-download" id="tl_save" style="right:96px;" title="${esc(t("ig_save"))}" aria-label="${esc(t("ig_save"))}">${SAVE_ICON_SVG}</button>
                <button type="button" class="ig-detail-download" id="tl_discard" style="right:52px;" title="${esc(t("ig_discard"))}" aria-label="${esc(t("ig_discard"))}">${TRASH_ICON_SVG}</button>
              </div>
            </div>
          </div>
        </div></div>
    </aside>
    <aside class="ig-panel">
      <div class="ig-panel-title">Test a trained LoRA</div>
      <div class="field"><label>LoRA / checkpoint</label>
        <div class="hint" id="tl_job_meta">Pick one from "Past jobs" (top right) to test it.</div></div>
      <div class="field"><div class="ig-lora-strength" style="padding-top:0;">
        <span class="hint">${esc(t("ig_strength"))}</span><span class="ig-lora-val-pill"><span class="ig-lora-val" id="tl_strength_val">1</span></span>
        <input type="range" id="tl_strength" min="-8" max="8" step="0.05" value="1"></div></div>
      <div class="hint" style="margin-bottom:8px;">Prompt is prefilled automatically with this LoRA's trigger word plus a general-purpose quality template — pick a different job/checkpoint from "Past jobs" to swap it.</div>
      <div id="tl_aspectres"></div>
      <div class="ig-sec" data-key="sampler">${igSectionHead("sampler", t("ig_sampler_section"))}
        <div class="ig-sec-body"><div id="tl_sampler"></div></div></div>
      <div class="ig-sec" data-key="steps">${igSectionHead("steps", t("ig_steps"))}
        <div class="ig-sec-body">
          <div class="field" style="margin:0;">
            <label>${esc(t("ig_steps"))} <span class="hint" id="tl_steps_val">20</span></label>
            <input type="range" id="tl_steps" min="1" max="60" step="1" value="20">
            <div class="hint" style="margin-top:4px;">${esc(t("ig_steps_hint"))}</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="cfg">${igSectionHead("cfg", t("ig_cfg"))}
        <div class="ig-sec-body">
          <div class="field" style="margin:0;">
            <label>${esc(t("ig_cfg"))} <span class="hint" id="tl_cfg_val">7</span></label>
            <input type="range" id="tl_cfg" min="1" max="20" step="0.5" value="7">
            <div class="hint" style="margin-top:4px;">${esc(t("ig_cfg_hint"))}</div>
          </div>
        </div></div>
      <div class="ig-sec" data-key="reference" id="tl_ref_sec">${igSectionHead("reference", t("img_gen_reference"))}
        <div class="ig-sec-body"><div id="tl_ref" title="${esc(t("img_gen_reference_hint"))}"></div></div></div>
      <div class="actions"><button class="btn primary" id="tl_go" disabled>${esc(t("ig_generate"))}</button></div>
    </aside>
  </div>`;

  const updateTimeEstimate=()=>{
    const pill=$("#lt_time_est");
    const steps=parseInt($("#lt_steps").value,10), batch=parseInt($("#lt_batch").value,10);
    if(!ckptSel.value||!steps||!batch||steps<=0||batch<=0){ pill.classList.remove("show"); return; }
    const architecture=isAnimaModel(ckptSel.value)?"anima":"sdxl";
    const est=_estimateTrainingRun(jobs, architecture, steps, batch);
    pill.textContent=`~${_formatDuration(est.seconds)} · ~$${est.cost.toFixed(2)} est.${est.fromHistory?"":" (rough)"}`;
    pill.title=est.fromHistory
      ? "Estimated from your past training runs' actual speed on this architecture, plus 5 min for provisioning/finalizing overhead."
      : "No past runs of this architecture yet, so this is a rough guess, plus 5 min for provisioning/finalizing overhead.";
    pill.classList.add("show");
  };

  const savedLtCkpt=lt.checkpoint && checkpoints.includes(lt.checkpoint) ? lt.checkpoint : undefined;
  const ckptSel=mountModelGrid($("#lt_ckpt"), checkpoints, {previews:previews||{}, value:savedLtCkpt,
    onChange:name=>{ persistLt({checkpoint:name}); updateTimeEstimate(); }});
  wireIgSections(body);
  [["lt_name","name"],["lt_trigger","trigger_word"],["lt_res","resolution"],["lt_batch","batch_size"],
   ["lt_rank","rank"],["lt_alpha","alpha"],["lt_lr","learning_rate"],["lt_steps","steps"]]
    .forEach(([id,key])=>{ $("#"+id).oninput=e=>{ persistLt({[key]:e.target.value}); updateTimeEstimate(); }; });
  updateTimeEstimate();

  const imagesInput=$("#lt_images"), imagesGrid=$("#lt_images_grid"), imagesCount=$("#lt_images_count");
  $("#lt_images_drop").onclick=()=>imagesInput.click();
  $("#lt_images_clear").onclick=()=>{ setInputFiles([]); renderImagesGrid(); };
  const setInputFiles=files=>{
    const dt=new DataTransfer();
    files.forEach(f=>dt.items.add(f));
    imagesInput.files=dt.files;
  };
  const renderImagesGrid=()=>{
    const files=[...imagesInput.files];
    imagesCount.textContent=files.length?`${files.length} image${files.length===1?"":"s"} selected`:"";
    const urls=files.map(f=>URL.createObjectURL(f));
    imagesGrid.innerHTML=files.map((f,i)=>`
      <div class="lt-thumb" style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:zoom-in;">
        <img data-zoom="${i}" src="${urls[i]}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="">
        <button type="button" data-rm="${i}" title="Remove" aria-label="Remove"
          style="position:absolute;top:3px;right:3px;width:18px;height:18px;border:none;border-radius:50%;
          background:rgba(0,0,0,.65);color:#fff;font-size:12px;line-height:1;display:flex;align-items:center;
          justify-content:center;cursor:pointer;padding:0;">✕</button>
      </div>`).join("");
    imagesGrid.querySelectorAll("[data-zoom]").forEach(img=>img.onclick=()=>{
      openModal(`<img src="${esc(urls[parseInt(img.dataset.zoom,10)])}" alt="" style="width:100%;border-radius:10px;display:block;">`, null, {stack:true});
      _wireZoomPan($(".modal img"));
    });
    imagesGrid.querySelectorAll("[data-rm]").forEach(btn=>btn.onclick=e=>{
      e.stopPropagation();
      const files=[...imagesInput.files];
      files.splice(parseInt(btn.dataset.rm,10),1);
      setInputFiles(files);
      renderImagesGrid();
    });
  };
  imagesInput.onchange=renderImagesGrid;

  // Every field is validated up front, not just "images present" — this
  // kicks off a real cloud GPU rental per submit, so a typo'd/empty/absurd
  // field shouldn't be discovered only after Modal has already started
  // billing for a run that's guaranteed to fail or produce garbage.
  const validateTrainingForm=()=>{
    const errors=[];
    const name=$("#lt_name").value.trim();
    if(!name) errors.push("Name is required.");
    const trigger=$("#lt_trigger").value.trim();
    if(!trigger) errors.push("Trigger word is required.");
    else if(/\s/.test(trigger)) errors.push("Trigger word must be a single word, no spaces.");
    if(!ckptSel.value) errors.push("Pick a base checkpoint.");
    const files=[...$("#lt_images").files];
    if(!files.length) errors.push("Training images are required — pick at least one.");
    else if(files.length<5) errors.push("Pick at least 5 training images — fewer than that won't train a usable LoRA.");
    const intField=(id,label,min,max)=>{
      const raw=$("#"+id).value.trim();
      const v=parseInt(raw,10);
      if(raw===""||isNaN(v)||String(v)!==raw) errors.push(`${label} must be a whole number.`);
      else if(v<min||v>max) errors.push(`${label} must be between ${min} and ${max}.`);
      return v;
    };
    const res=intField("lt_res","Resolution",256,1024);
    if(!isNaN(res) && res%64!==0) errors.push("Resolution must be a multiple of 64.");
    intField("lt_batch","Batch size",1,8);
    intField("lt_rank","Rank",1,128);
    intField("lt_alpha","Alpha",1,128);
    intField("lt_steps","Steps",50,20000);
    const lr=parseFloat($("#lt_lr").value.trim());
    if(isNaN(lr)||lr<=0) errors.push("Learning rate must be a positive number.");
    else if(lr>0.01) errors.push("Learning rate looks too high (>0.01) — this usually wrecks the result. Use something like 0.0001.");
    return errors;
  };

  const watcher=new TrainingJobWatcher();
  const setStartBtnMode=running=>{
    const btn=$("#lt_start");
    btn.textContent=running?"Abort training":"Start training";
    btn.classList.toggle("primary", !running);
    btn.classList.toggle("danger", running);
    btn.disabled=false;
    $("#lt_checkpoint_now").style.display=running?"":"none";
  };
  const watchTrainingJob=jobId=>{
    const refs={
      statusLabel:$("#lt_status_label"), bar:$("#lt_progress_bar"), logEl:$("#lt_log"),
      costBanner:$("#lt_cost_banner"), metricsTable:$("#lt_metrics_table"), chart:$("#lt_loss_chart"),
      metricsWrap:$("#lt_metrics_wrap"), finalizing:$("#lt_finalizing"), doneTile:$("#lt_done_tile"),
      uploadWrap:$("#lt_upload_wrap"), uploadTable:$("#lt_upload_table"),
      downloadWrap:$("#lt_download_wrap"), downloadTable:$("#lt_download_table"),
    };
    $("#lt_idle").style.display="none";
    $("#lt_live").style.display="";
    watcher.watch(jobId, refs, setStartBtnMode, async job=>{
      if(job.status==="done") jobs=await api("/api/admin/lora-training/jobs").catch(()=>jobs);
    });
  };
  $("#lt_checkpoint_now").onclick=async()=>{
    if(!watcher.jobId) return;
    const btn=$("#lt_checkpoint_now");
    btn.disabled=true; btn.textContent="Requesting…";
    try{
      await api(`/api/admin/lora-training/jobs/${encodeURIComponent(watcher.jobId)}/checkpoint`, {method:"POST"});
      toast("Checkpoint requested — it'll arrive as the model finishes its current step.");
    }catch(e){ errorToast("Could not request checkpoint: "+e.message); }
    btn.disabled=false; btn.textContent="Request checkpoint now";
  };
  $("#lt_start").onclick=async()=>{
    if(watcher.isWatching){
      // Cutting losses mid-run: this is a rented GPU that's already billing,
      // so make the admin explicitly confirm before killing it — same
      // confirm-popover pattern as every other destructive action here.
      if(!(await confirmAction($("#lt_start"),
          "Abort this training run? The GPU stops immediately. Any checkpoint already saved (scheduled or manually requested) is kept and testable in Test LoRA, but progress since the last one is lost. Cost already incurred is not refunded.",
          "Abort training"))) return;
      if(watcher.jobId){
        try{ await api(`/api/admin/lora-training/jobs/${encodeURIComponent(watcher.jobId)}/abort`, {method:"POST"}); }
        catch(e){ errorToast("Could not confirm abort with the server (GPU may keep running): "+e.message); }
      }
      watcher.stop();
      setStartBtnMode(false);
      return;
    }
    const errors=validateTrainingForm();
    if(errors.length){ errorToast(errors[0]); return; }
    const startBtn=$("#lt_start");
    if(!(await confirmAction(startBtn,
        `Start training on a rented cloud GPU? This begins incurring cost immediately and typically runs for a while. Double-check your settings first.`,
        "Start training"))) return;
    const files=[...$("#lt_images").files];
    const fd=new FormData();
    fd.append("name", $("#lt_name").value.trim());
    fd.append("trigger_word", $("#lt_trigger").value.trim());
    fd.append("local_checkpoint", ckptSel.value);
    fd.append("architecture", isAnimaModel(ckptSel.value)?"anima":"sdxl");
    fd.append("resolution", $("#lt_res").value.trim());
    fd.append("rank", $("#lt_rank").value.trim());
    fd.append("alpha", $("#lt_alpha").value.trim());
    fd.append("learning_rate", $("#lt_lr").value.trim());
    fd.append("steps", $("#lt_steps").value.trim());
    fd.append("batch_size", $("#lt_batch").value.trim());
    for(const f of files) fd.append("images", f, f.name);

    // The backend now runs training as a task fully decoupled from this
    // request (see backend/routers/lora_training.py's _execute_training_job)
    // — this POST just creates the job and returns its id immediately, not a
    // stream. From here on this tab is a pure spectator polling job state via
    // watchTrainingJob, identical to the reload-recovery path — there's only
    // ever one way this UI watches a run now, live or reattached.
    const logEl=$("#lt_log"); logEl.textContent=""; delete logEl.dataset.lines;
    setStartBtnMode(true);
    try{
      const resp=await api("/api/admin/lora-training/jobs", {method:"POST", body:fd});
      jobs=await api("/api/admin/lora-training/jobs").catch(()=>jobs);
      watchTrainingJob(resp.job_id);
    }catch(e){
      errorToast("Training request failed: "+e.message);
      setStartBtnMode(false);
    }
  };

  const stillTraining=jobs.find(j=>["queued","provisioning","training"].includes(j.status));
  if(stillTraining) watchTrainingJob(stillTraining.id);

  // ---- Test a trained LoRA (right column) ----
  let entry=null, strength=1.0;
  const jobMetaEl=$("#tl_job_meta"), goBtn=$("#tl_go");
  const updateJobMeta=()=>{
    if(!entry){ jobMetaEl.textContent=`Pick one from "Past jobs" (top right) to test it.`; goBtn.disabled=true; return; }
    const notFound=!checkpoints.includes(entry.job.base_checkpoint);
    jobMetaEl.innerHTML=`<b>${esc(entry.label)}</b><br>Trigger word: <b>${esc(entry.job.trigger_word||"—")}</b> · Base: ${esc(entry.job.base_checkpoint||"—")} · File: <span class="mono">${esc(entry.filename)}</span>`
      +(notFound?` <span style="color:var(--danger,#e66);">— base checkpoint no longer found, generation will fail</span>`:"");
    goBtn.disabled=notFound;
  };
  entry=presetTestEntry||null;
  updateJobMeta();

  const strengthInp=$("#tl_strength"), strengthVal=$("#tl_strength_val");
  strengthInp.oninput=e=>{ strength=parseFloat(e.target.value); strengthVal.textContent=e.target.value; };

  const tlAspectRes=mountAspectResolution($("#tl_aspectres"));
  const tlSamplerPickers=await mountSamplerPickers($("#tl_sampler"), {});
  const tlRefPicker=mountReferenceImagePicker($("#tl_ref"));
  wireIgSections(body);
  const tlStepsInput=$("#tl_steps");
  const tlGetSteps=()=>parseInt(tlStepsInput.value,10)||20;
  tlStepsInput.oninput=e=>{ $("#tl_steps_val").textContent=e.target.value; };
  const tlCfgInput=$("#tl_cfg");
  const tlGetCfg=()=>parseFloat(tlCfgInput.value)||7;
  tlCfgInput.oninput=e=>{ $("#tl_cfg_val").textContent=e.target.value; };

  let tlAbort=null, tlLastImage=null, tlLastUpscaler="", tlLastGenBody=null, tlStatusPillTimer=null;
  const wrap=$("#tl_preview_wrap"), img=$("#tl_preview_img");
  const resultActions=$("#tl_result_actions"), upscaleBtn=$("#tl_upscale");
  const tlShowStatusPill=baseTextRaw=>{
    const pill=$("#tl_status_pill"); if(!pill) return;
    clearInterval(tlStatusPillTimer);
    const baseText=baseTextRaw.replace(/[.…]+$/,"");
    let dots=0;
    pill.style.display="";
    pill.textContent=baseText+".";
    tlStatusPillTimer=setInterval(()=>{ dots=dots%3+1; pill.textContent=baseText+".".repeat(dots); },450);
  };
  const tlHideStatusPill=()=>{
    clearInterval(tlStatusPillTimer); tlStatusPillTimer=null;
    const pill=$("#tl_status_pill"); if(pill){ pill.style.display="none"; pill.textContent=""; }
  };
  const tlResetGoBtn=()=>{ goBtn.disabled=!entry; goBtn.classList.remove("stop"); goBtn.textContent=t("ig_generate"); goBtn.onclick=tlRunGenerate; };
  const tlStopGenerate=()=>{
    if(tlAbort){ try{ tlAbort.abort(); }catch(e){} tlAbort=null; }
    fetch(API+"/api/imagegen/standalone/stream/stop",{method:"POST"}).catch(()=>{});
    if(!tlLastImage){ img.src=""; wrap.classList.add("ig-preview-empty"); }
    tlHideStatusPill();
    tlResetGoBtn();
  };
  const tlRunGenerate=async()=>{
    if(!entry) return;
    if(!checkpoints.includes(entry.job.base_checkpoint)){ errorToast("Base checkpoint no longer found."); return; }
    tlAbort=new AbortController();
    goBtn.classList.add("stop"); goBtn.textContent=t("ig_stop"); goBtn.onclick=tlStopGenerate;
    resultActions.style.display="none";
    tlShowStatusPill(t("ig_generating"));
    const anima=isAnimaModel(entry.job.base_checkpoint);
    const dims=tlAspectRes.getSize();
    const bodyReq={
      positive:`${entry.job.trigger_word||""}, ${TEST_LORA_DEFAULT_POSITIVE}`, negative:TEST_LORA_DEFAULT_NEGATIVE,
      checkpoint:entry.job.base_checkpoint, architecture:anima?"anima":"sdxl",
      loras:[{name:entry.filename, strength}],
      reference_image:tlRefPicker.getDataUrl(), denoise:tlRefPicker.getDenoise(),
      width:dims.width, height:dims.height,
      sampler:anima?ANIMA_DEFAULT_SAMPLER:tlSamplerPickers.sampler,
      scheduler:anima?ANIMA_DEFAULT_SCHEDULER:tlSamplerPickers.scheduler,
      steps:tlGetSteps(), cfg:anima?ANIMA_DEFAULT_CFG:tlGetCfg()};
    try{
      const res=await fetch(API+"/api/imagegen/standalone/stream",{method:"POST",
        headers:{"Content-Type":"application/json"}, body:JSON.stringify(bodyReq), signal:tlAbort.signal});
      if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
      await sseEvents(res, ev=>{
        if(ev.type==="preview"||ev.type==="done"){ wrap.classList.remove("ig-preview-empty"); img.src=ev.image; }
        if(ev.type==="done"){
          tlLastImage=ev.image; tlLastUpscaler=""; tlLastGenBody=bodyReq;
          resultActions.style.display=""; upscaleBtn.style.display="";
        }
        if(ev.type==="error"){ errorToast("Test generation failed: "+ev.message); }
      });
    }catch(e){ if(e.name!=="AbortError") errorToast("Test generation failed: "+e.message); }
    tlHideStatusPill();
    tlAbort=null;
    tlResetGoBtn();
  };
  goBtn.onclick=tlRunGenerate;

  $("#tl_zoom").onclick=()=>{
    if(!tlLastImage) return;
    openModal(`<img src="${esc(tlLastImage)}" alt="" style="width:100%;border-radius:10px;display:block;">`, null, {stack:true});
    _wireZoomPan($(".modal img"));
  };
  $("#tl_discard").onclick=()=>{
    tlLastImage=null; tlLastUpscaler=""; img.src=""; resultActions.style.display="none";
    upscaleBtn.style.display=""; wrap.classList.add("ig-preview-empty");
  };
  upscaleBtn.onclick=async()=>{
    if(!tlLastImage) return;
    upscaleBtn.disabled=true;
    let upscalers=[], previews2={};
    try{
      [upscalers, previews2]=await Promise.all([
        api("/api/imagegen/upscalers").catch(()=>[]),
        api("/api/imagegen/upscaler-previews").catch(()=>({}))]);
    }catch(e){}
    upscaleBtn.disabled=false;
    if(!upscalers.length){ errorToast(t("ig_no_upscalers")); return; }
    const savedUpscaler=store.get("ig_last_upscaler","");
    const runUpscale=async(upscaler)=>{
      upscaleBtn.style.display="none";
      tlShowStatusPill(t("ig_upscaling"));
      resultActions.classList.add("ig-upscaling");
      try{
        const res=await fetch(API+"/api/imagegen/upscale/stream",{method:"POST",
          headers:{"Content-Type":"application/json"}, body:JSON.stringify({image:tlLastImage, upscaler})});
        if(!res.ok||!res.body) throw new Error("HTTP "+res.status);
        let streamErr=null;
        await sseEvents(res, ev=>{
          if(ev.type==="preview"||ev.type==="done"){ img.src=ev.image; }
          if(ev.type==="done"){ tlLastImage=ev.image; tlLastUpscaler=previews2[upscaler]?.display_name||upscaler; store.set("ig_last_upscaler", upscaler); }
          if(ev.type==="error"){ streamErr=ev.message; }
        });
        if(streamErr) throw new Error(streamErr);
      }catch(e){
        errorToast(t("ig_upscale_failed")+": "+e.message);
        upscaleBtn.style.display="";
        img.src=tlLastImage;
      }
      tlHideStatusPill();
      resultActions.classList.remove("ig-upscaling");
    };
    openChoicePickerModal(upscalers, previews2, upscalers.includes(savedUpscaler)?savedUpscaler:upscalers[0], runUpscale, {
      title:t("ig_upscaler_picker_title"), searchPh:t("ig_upscaler_search_ph"), useLabel:t("ig_use_this_upscaler"),
      emptyMsg:t("ig_upscaler_search_empty"), pickHint:t("ig_upscaler_pick_hint")});
  };
  $("#tl_save").onclick=async()=>{
    if(!tlLastImage||!tlLastGenBody) return;
    try{
      await api("/api/imagegen/standalone/save", j("POST",{image:tlLastImage,
        positive:tlLastGenBody.positive, negative:tlLastGenBody.negative,
        checkpoint:tlLastGenBody.checkpoint, loras:tlLastGenBody.loras,
        sampler:tlLastGenBody.sampler, scheduler:tlLastGenBody.scheduler, steps:tlLastGenBody.steps,
        is_img2img:!!tlLastGenBody.reference_image, cfg:tlLastGenBody.cfg, upscaler:tlLastUpscaler}));
      toast(t("ig_saved_toast"));
    }catch(e){ errorToast(t("ig_save_failed")+": "+e.message); }
  };
}

// A generic, filled-in quality/composition prompt template — testing a fresh
// LoRA against a blank textbox tells you nothing about how it holds up in a
// real scene, so this gives a reasonable starting point (swap out the
// mid-sections, keep the quality/negative boilerplate) instead of an admin
// having to write one from scratch for every test.
const TEST_LORA_DEFAULT_POSITIVE=`masterpiece, best quality, absurdres, newest, smooth colors, depth of field, blurry background, scenery, anime coloring, anime screencap, detailed lighting, framevault, movie still, light particles, dynamic pose,

BREAK 1girl, (dynamic angle:1.5), slender, (skinny:1.5), perky breasts,  small breasts, asian, petite, tomboy,
BREAK short hair, messy hair, yellow eyes, red hair, pixie cut, pantyhose, black miniskirt, boots, black hoodie, hood down, headphones around neck,
BREAK holding phone, looking to the side, looking at object, looking down, bored, half-closed eyes, standing, smartphone, disdain, closed mouth, angry,
BREAK mall, people, crowded, shopping, shopping mall, stairs, bush, bench, fountain, indoors, ceiling light,
BREAK modern, neon lights, day, yellow lights, perspective, upper body, (arknights:0.6), hand on own hip,
BREAK  (4 fingers:1.2)`;
const TEST_LORA_DEFAULT_NEGATIVE=`worst quality, bad quality, worst detail, sketch, censor, censored, extra fingers, hair bun,  see-through clothes, symmetry, red skin, english text, lipstick, shiny clothes, kid, child, loli, aged down, blush, 3d, realistic,`;

// Fetches every training job plus, for each job that has an output_file, its
// manually requested checkpoints — flattened into one list of distinct
// testable .safetensors (see "Request checkpoint now" in Train LoRA). Used
// both by openPastJobsModal (to build the picker) and to validate a preset
// entry is still valid.
async function buildTestLoraEntries(){
  const jobs=await api("/api/admin/lora-training/jobs").catch(()=>[]);
  const testableJobs=jobs.filter(j=>j.output_file);
  const ckptLists=await Promise.all(testableJobs.map(j=>
    api(`/api/admin/lora-training/jobs/${encodeURIComponent(j.id)}/checkpoints`).catch(()=>[])));
  const entries=[];
  testableJobs.forEach((j,i)=>{
    entries.push({job:j, filename:j.output_file, label:`${j.name} — latest (${j.status})`});
    ckptLists[i].forEach(c=>{
      const m=/_(\d{8}T\d{6}Z)\.safetensors$/.exec(c.filename);
      entries.push({job:j, filename:c.filename, label:`${j.name} — checkpoint ${m?m[1]:c.filename}`});
    });
  });
  return {jobs, entries};
}
// The "Past jobs" button (top right of the Images page, Train LoRA tab only)
// — lists every training job (with live status/progress, delete) and, for
// testable ones, their selectable entries (see buildTestLoraEntries).
// Picking an entry calls onSelectEntry and closes the modal; this is the
// only way to choose what Test LoRA's right-column form runs against — the
// form itself has no inline model/LoRA picker.
async function openPastJobsModal(onSelectEntry){
  openModal(`
    <button class="modal-close" id="pj_close">${esc(t("btn_close"))}</button>
    <h3>Past jobs</h3>
    <div id="pj_list" class="hint">${esc(t("loading"))}</div>`, "modal-wide");
  $("#pj_close").onclick=closeModal;
  const render=async()=>{
    const {jobs, entries}=await buildTestLoraEntries();
    const list=$("#pj_list"); if(!list) return;
    if(!jobs.length){ list.innerHTML=`<div class="empty"><div class="big">No training jobs yet.</div></div>`; return; }
    list.innerHTML=jobs.map(j=>{
      const jobEntries=entries.filter(e=>e.job.id===j.id);
      return `<div class="lt-job-row" style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <b>${esc(j.name)}</b> <span class="hint">${esc(j.status)} · ${Math.round((j.progress||0)*100)}%</span>
          ${j.resume_from_lora?`<div class="hint" style="color:var(--accent);">↻ resumed from ${esc(j.resume_from_lora)}</div>`:""}
          ${j.error?`<div class="hint" style="color:var(--danger,#e66);white-space:pre-wrap;overflow-wrap:anywhere;">${esc(j.error)}</div>`:""}
        </div>
        <button class="tool danger" data-del="${esc(j.id)}" title="Delete" style="flex:none;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid var(--line-2);border-radius:7px;background:var(--surface-2);color:var(--danger,#e66);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
      ${jobEntries.map(e=>`<button type="button" class="ig-picker-btn" data-select="${esc(jobEntries.indexOf(e))}" data-job="${esc(j.id)}" style="margin:4px 0 4px 16px;width:calc(100% - 16px);">
        <span class="ig-picker-btn-label">${esc(e.label)}</span>
      </button>`).join("")}`;
    }).join("");
    list.querySelectorAll("[data-del]").forEach(btn=>btn.onclick=async()=>{
      // No confirm-popover here (unlike aborting a live run) — deleting a
      // job record only removes history/checkpoints, it can't touch a GPU
      // that's actually running, so the extra click was pure friction.
      btn.disabled=true;
      try{
        await api("/api/admin/lora-training/jobs/"+encodeURIComponent(btn.dataset.del), {method:"DELETE"});
        render();
      }catch(e){ errorToast("Delete failed: "+e.message); btn.disabled=false; }
    });
    list.querySelectorAll("[data-select]").forEach(btn=>btn.onclick=()=>{
      const jobEntries=entries.filter(e=>e.job.id===btn.dataset.job);
      const picked=jobEntries[parseInt(btn.dataset.select,10)];
      if(!picked) return;
      closeModal();
      onSelectEntry(picked);
    });
  };
  render();
}
