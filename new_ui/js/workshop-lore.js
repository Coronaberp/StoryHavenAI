"use strict";

function _grimoireEntryTitle(entry) {
  return entry.name || (entry.keys && entry.keys[0]) || t("grimoire_untitled_entry");
}

function _grimoireScopePickerModal(onPick) {
  const layer = openModal(`
    <h3>${t("grimoire_new_lore_entry_heading")}</h3>
    <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">${t("grimoire_where_should_lore_apply")}</p>
    <div style="display:flex;flex-direction:column;gap:2px">
      <div class="grimoire-picker-row" data-scope="global">
        <span class="sanctum-specimen" style="background:var(--color-surface-2);display:grid;place-items:center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        </span>
        <span class="font-display" style="font-size:14px;color:var(--color-ink)">${t("grimoire_global_scope_label")}</span>
      </div>
      <div class="grimoire-picker-row" data-scope="character">
        <span class="sanctum-specimen" style="background:var(--color-surface-2);display:grid;place-items:center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </span>
        <span class="font-display" style="font-size:14px;color:var(--color-ink)">${t("grimoire_specific_character_scope_label")}</span>
      </div>
    </div>
  `);
  layer.querySelectorAll("[data-scope]").forEach((row) => {
    row.onclick = async () => {
      if (row.dataset.scope === "global") {
        closeModal(layer);
        const confirmed = await confirmDialog(
          t("grimoire_global_scope_confirm_body", "This entry will be shown to every character you own, in every conversation, not just one character. Only choose this for facts that are true across your whole roster."),
          { title: t("grimoire_global_scope_confirm_title", "Apply to all your characters?"),
            confirmLabel: t("grimoire_global_scope_confirm_ok", "Yes, apply to all"),
            cancelLabel: t("modal_cancel", "Cancel"), danger: false });
        if (confirmed) onPick("global");
        return;
      }
      closeModal(layer);
      onPick(row.dataset.scope);
    };
  });
}

function _grimoireCharacterPickerModal(chars, onPick) {
  if (!chars.length) {
    const layer = openModal(`
      <h3>${t("grimoire_pick_a_character_heading")}</h3>
      <p style="margin:8px 0 0;font-size:13px;color:var(--color-sec)">${t("grimoire_lore_belongs_to_character_hint")}</p>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button type="button" class="pe-gen-btn" id="grimoireNoCharsGo">${t("grimoire_create_a_character_cta")}</button>
      </div>
    `);
    layer.querySelector("#grimoireNoCharsGo").onclick = () => { closeModal(layer); navigate("/workshop/characters/new"); };
    return;
  }
  const layer = openModal(`
    <h3>${t("grimoire_pick_a_character_heading")}</h3>
    <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">${t("grimoire_which_character_lore_hint")}</p>
    <div style="display:flex;flex-direction:column;gap:2px">
      ${chars.map((c) => `
        <div class="grimoire-picker-row" data-char-id="${c.id}">
          <span class="sanctum-specimen" style="${c.avatar ? `background-image:url('${_attr(c.avatar)}')` : "background:var(--color-surface-2)"}">${c.avatar ? "" : _esc(c.name[0].toUpperCase())}</span>
          <span class="font-display" style="font-size:14px;color:var(--color-ink)">${_esc(c.name)}</span>
        </div>
      `).join("")}
    </div>
  `);
  layer.querySelectorAll(".grimoire-picker-row").forEach((row) => {
    row.onclick = () => { closeModal(layer); onPick(row.dataset.charId); };
  });
}

async function _grimoireImageGenModal(onGenerated) {
  let checkpoints, animaUnets, loras, loraPreviews, checkpointPreviews, samplerData;
  try {
    [checkpoints, animaUnets, loras, loraPreviews, checkpointPreviews, samplerData] = await Promise.all([
      api("/api/imagegen/checkpoints"),
      api("/api/imagegen/anima-unets").catch(() => []),
      api("/api/imagegen/loras"),
      api("/api/imagegen/lora-previews").catch(() => ({})),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
    ]);
  } catch (err) {
    errorToast(err.message || t("grimoire_couldnt_load_imagegen_options"));
    return;
  }
  if (!checkpoints.length && !animaUnets.length) { toast(t("grimoire_no_checkpoints_found")); return; }
  let architecture = "sdxl";
  let advanced = false;
  let modalLayer = null;
  let selectedCheckpoint = null;
  let selectedSampler = null;
  let selectedScheduler = null;
  let selectedSteps = 20;
  let selectedCfg = 7.0;
  let selectedDenoise = 0.6;
  let refDataUrl = null;
  let positiveText = "";
  let negativeText = "";
  let lastImage = null;
  let lastImageMeta = null;
  let genToken = 0;
  let busy = false;
  const modelsFor = () => architecture === "anima" ? animaUnets : checkpoints;
  const defaultCheckpointFor = (models) => models.find((m) => m.toLowerCase().includes("realskin")) || models[0] || null;

  const renderModal = () => {
  const html = `
    <h3>${t("grimoire_generate_image_heading")}</h3>
    <div class="imggen-grid">
    <div class="imggen-settings">
      <div style="display:flex;gap:6px">
        <button type="button" id="lgSimpleTab" class="filter-chip${!advanced ? " on" : ""}" style="flex:1">${t("grimoire_simple_button")}</button>
        <button type="button" id="lgAdvancedTab" class="filter-chip${advanced ? " on" : ""}" style="flex:1">${t("grimoire_advanced_button")}</button>
      </div>
      ${animaUnets.length ? `
        <div>
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_architecture_label")}</label>
          <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_architecture_hint")}</p>
          ${customSelectHtml("lgArch", [{ value: "sdxl", label: t("grimoire_architecture_legacy_option") }, { value: "anima", label: t("grimoire_architecture_current_option") }], architecture)}
        </div>
      ` : ""}
      <div>
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_checkpoint_label")}</label>
        <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_checkpoint_hint")}</p>
        <div id="lgCheckpointWrap">${checkpointPickerHtml("lgCheckpoint", modelsFor(), checkpointPreviews, defaultCheckpointFor(modelsFor()))}</div>
      </div>
      ${loras.length ? `
        <div>
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_loras_label")}</label>
          <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_loras_hint")}</p>
          ${loraPickerHtml("lgLoras", loras, _loraPickerState.lgLoras ? getLoraPickerValues("lgLoras") : [], loraPreviews)}
        </div>
      ` : ""}
      <div>
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_reference_image_label")}</label>
        <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_reference_image_hint")}</p>
        ${refImagePickerHtml("lgRefPicker")}
        <div id="lgDenoiseRow" style="display:${refDataUrl ? "flex" : "none"};margin-top:8px;align-items:center;gap:8px">
          <span style="font-size:11.5px;color:var(--color-muted)">${t("grimoire_denoise_label")}</span>
          <input type="range" id="lgDenoise" min="0.05" max="1" step="0.05" value="${selectedDenoise}" style="flex:1">
          <span id="lgDenoiseVal" style="font-size:11.5px;color:var(--color-muted);width:32px;text-align:right">${selectedDenoise.toFixed(2)}</span>
        </div>
      </div>
      <div>
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_positive_prompt_label")}</label>
        <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_positive_prompt_hint")}</p>
        <textarea id="lgPositive" rows="3" placeholder="${t("grimoire_prompt_placeholder")}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px"></textarea>
      </div>
      <div>
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_negative_prompt_label")}</label>
        <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_negative_prompt_hint")}</p>
        <textarea id="lgNegative" rows="2" placeholder="${t("grimoire_negative_prompt_placeholder")}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px"></textarea>
      </div>
      ${advanced ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_sampler_label")}</label>
            <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_sampler_hint")}</p>
            ${customSelectHtml("lgSampler", samplerData.samplers, samplerData.samplers[0])}
          </div>
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("grimoire_scheduler_label")}</label>
            <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_scheduler_hint")}</p>
            ${customSelectHtml("lgScheduler", samplerData.schedulers, samplerData.schedulers[0])}
          </div>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11.5px;color:var(--color-muted);width:40px">${t("grimoire_steps_label")}</span>
            <input type="range" id="lgSteps" min="5" max="60" step="1" value="${selectedSteps}" style="flex:1">
            <span id="lgStepsVal" style="font-size:11.5px;color:var(--color-muted);width:24px;text-align:right">${selectedSteps}</span>
          </div>
          <p style="margin:4px 0 0;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_steps_hint")}</p>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11.5px;color:var(--color-muted);width:40px">${t("grimoire_cfg_label")}</span>
            <input type="range" id="lgCfg" min="1" max="15" step="0.5" value="${selectedCfg}" style="flex:1">
            <span id="lgCfgVal" style="font-size:11.5px;color:var(--color-muted);width:24px;text-align:right">${selectedCfg.toFixed(1)}</span>
          </div>
          <p style="margin:4px 0 0;color:var(--color-muted);font-size:11px;line-height:1.4">${t("grimoire_cfg_hint")}</p>
        </div>
      ` : ""}
    </div>
    <div class="imggen-preview">
      ${genPreviewBoxHtml("lgPreviewBox", "1 / 1")}
      <div class="imggen-actions">
        <button type="button" id="lgCancel" class="pe-gen-btn" style="flex:1;justify-content:center;border-color:var(--color-line-2);color:var(--color-sec)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ${t("grimoire_cancel_button")}
        </button>
        <button type="button" id="lgGo" class="pe-gen-btn" style="flex:1;justify-content:center${busy ? ";border-color:var(--color-warn);color:var(--color-warn)" : ""}">
          ${busy
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>${t("grimoire_stop_button")}`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l1.9 5.8L20 9.5l-6.1 1.7L12 17l-1.9-5.8L4 9.5l6.1-1.7L12 2z"/></svg>${t("grimoire_generate_button")}`}
        </button>
        <button type="button" id="lgUse" class="pe-gen-btn" style="flex:1;justify-content:center;display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ${t("grimoire_use_this_image_button")}
        </button>
      </div>
    </div>
    </div>
  `;
  if (!modalLayer) {
    modalLayer = openModal(html, { wide: true });
  } else {
    const modalDiv = modalLayer.querySelector(".modal");
    modalDiv.innerHTML = `<button type="button" class="modal-close" aria-label="${_attr(t("modal_close"))}" data-tooltip="${_attr(t("modal_close"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>${html}`;
    modalDiv.querySelector(".modal-close").onclick = () => closeModal(modalLayer);
  }
  setGenPreviewBox("lgPreviewBox", { busy, image: lastImage });
  const layer = modalLayer;
  const posEl = layer.querySelector("#lgPositive");
  const negEl = layer.querySelector("#lgNegative");
  posEl.value = positiveText;
  negEl.value = negativeText;
  posEl.addEventListener("input", () => { positiveText = posEl.value; });
  negEl.addEventListener("input", () => { negativeText = negEl.value; });
  selectedCheckpoint = selectedCheckpoint && modelsFor().includes(selectedCheckpoint) ? selectedCheckpoint : defaultCheckpointFor(modelsFor());
  wireCheckpointPicker("lgCheckpoint", (v) => { selectedCheckpoint = v; });
  if (loras.length) wireLoraPicker("lgLoras", { onKeywordClick: (kw) => {
    positiveText = positiveText.trim() ? `${positiveText.trim()}, ${kw}` : kw;
    posEl.value = positiveText;
  } });
  if (animaUnets.length) {
    wireCustomSelect("lgArch", (arch) => {
      architecture = arch;
      const models = modelsFor();
      selectedCheckpoint = defaultCheckpointFor(models);
      layer.querySelector("#lgCheckpointWrap").innerHTML = checkpointPickerHtml("lgCheckpoint", models, checkpointPreviews, selectedCheckpoint);
      wireCheckpointPicker("lgCheckpoint", (v) => { selectedCheckpoint = v; });
    });
  }
  if (advanced) {
    selectedSampler = selectedSampler || samplerData.samplers[0] || null;
    selectedScheduler = selectedScheduler || samplerData.schedulers[0] || null;
    wireCustomSelect("lgSampler", (v) => { selectedSampler = v; });
    wireCustomSelect("lgScheduler", (v) => { selectedScheduler = v; });
    const steps = layer.querySelector("#lgSteps");
    const stepsVal = layer.querySelector("#lgStepsVal");
    steps.addEventListener("input", () => { selectedSteps = Number(steps.value); stepsVal.textContent = steps.value; });
    const cfg = layer.querySelector("#lgCfg");
    const cfgVal = layer.querySelector("#lgCfgVal");
    cfg.addEventListener("input", () => { selectedCfg = Number(cfg.value); cfgVal.textContent = Number(cfg.value).toFixed(1); });
  }
  layer.querySelector("#lgSimpleTab").onclick = () => { advanced = false; renderModal(); };
  layer.querySelector("#lgAdvancedTab").onclick = () => { advanced = true; renderModal(); };
  const denoiseRow = layer.querySelector("#lgDenoiseRow");
  const denoise = layer.querySelector("#lgDenoise");
  const denoiseVal = layer.querySelector("#lgDenoiseVal");
  if (refDataUrl) denoiseRow.style.display = "flex";
  denoise.addEventListener("input", () => { selectedDenoise = Number(denoise.value); denoiseVal.textContent = selectedDenoise.toFixed(2); });
  wireRefImagePicker("lgRefPicker", (dataUrl) => {
    refDataUrl = dataUrl;
    denoiseRow.style.display = dataUrl ? "flex" : "none";
  }, refDataUrl);
  layer.querySelector("#lgCancel").onclick = () => closeModal(modalLayer);
  layer.querySelector("#lgUse").style.display = lastImage ? "" : "none";
  layer.querySelector("#lgGo").onclick = async () => {
    if (busy) {
      genToken += 1;
      busy = false;
      try {
        await api("/api/imagegen/standalone/stream/stop", { method: "POST" });
      } catch (err) {
        errorToast(err.message || t("grimoire_couldnt_stop_generation"));
      }
      setGenPreviewBox("lgPreviewBox", {});
      renderModal();
      return;
    }
    const positive = posEl.value.trim();
    if (!positive) { toast(t("grimoire_prompt_required")); return; }
    const useBtn = layer.querySelector("#lgUse");
    const token = ++genToken;
    busy = true;
    useBtn.style.display = "none";
    lastImage = null;
    lastImageMeta = null;
    setGenPreviewBox("lgPreviewBox", { busy: true });
    renderModal();
    const anima = architecture === "anima";
    const body = {
      positive,
      negative: negEl.value.trim(),
      checkpoint: selectedCheckpoint,
      loras: loras.length ? getLoraPickerValues("lgLoras") : [],
      width: 1024,
      height: 1024,
      sampler: advanced ? selectedSampler : (anima ? "er_sde" : "euler"),
      scheduler: advanced ? selectedScheduler : (anima ? "simple" : "normal"),
      steps: advanced ? selectedSteps : 20,
      cfg: advanced ? selectedCfg : (anima ? 4.0 : 7.0),
      architecture,
    };
    if (refDataUrl) {
      body.reference_image = refDataUrl;
      body.denoise = selectedDenoise;
    }
    let finalImage = null;
    try {
      const res = await fetch(`${API}/api/imagegen/standalone/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await sseEvents(res, (ev) => {
        if (token !== genToken) return;
        if (ev.type === "preview") setGenPreviewBox("lgPreviewBox", { busy: true, image: ev.image });
        if (ev.type === "done") { finalImage = ev.image; setGenPreviewBox("lgPreviewBox", { image: ev.image }); }
        if (ev.type === "error") throw new Error(ev.message || t("grimoire_generation_failed"));
      });
    } catch (err) {
      if (token !== genToken) return;
      errorToast(err.message || t("grimoire_generation_failed"));
      setGenPreviewBox("lgPreviewBox", {});
      busy = false;
      renderModal();
      return;
    }
    if (token !== genToken) return;
    busy = false;
    if (!finalImage) {
      errorToast(t("grimoire_generation_finished_no_image"));
      setGenPreviewBox("lgPreviewBox", {});
      renderModal();
      return;
    }
    lastImage = finalImage;
    lastImageMeta = {
      positive: body.positive,
      negative: body.negative,
      checkpoint: body.checkpoint,
      loras: body.loras,
      sampler: body.sampler,
      scheduler: body.scheduler,
      steps: body.steps,
      is_img2img: !!refDataUrl,
      cfg: body.cfg,
    };
    renderModal();
    layer.querySelector("#lgUse").style.display = "";
  };
  layer.querySelector("#lgUse").onclick = async () => {
    if (!lastImage || !lastImageMeta) return;
    const useBtn = layer.querySelector("#lgUse");
    useBtn.disabled = true;
    try {
      const rec = await api("/api/imagegen/standalone/save", { method: "POST", body: JSON.stringify({ image: lastImage, ...lastImageMeta }) });
      closeModal(modalLayer);
      toast(t("grimoire_image_generated_toast"));
      onGenerated(rec.image);
    } catch (err) {
      errorToast(err.message || t("grimoire_couldnt_save_generated_image"));
      useBtn.disabled = false;
    }
  };
  };
  renderModal();
}

const GRIMOIRE_CATEGORY_PRESETS = ["Character", "Location", "Item", "Faction", "Event", "World"];
const GRIMOIRE_CUSTOM_CATEGORY = "__custom__";

function _grimoireCategoryOptions(allEntries, current) {
  const options = [...GRIMOIRE_CATEGORY_PRESETS];
  const known = new Set(options.map((o) => o.toLowerCase()));
  for (const e of allEntries || []) {
    const cat = (e.category || "").trim();
    if (cat && !known.has(cat.toLowerCase())) { known.add(cat.toLowerCase()); options.push(cat); }
  }
  options.sort((a, b) => a.localeCompare(b));
  const cur = (current || "").trim();
  const match = cur ? options.find((o) => o.toLowerCase() === cur.toLowerCase()) : "";
  const selected = cur ? (match || GRIMOIRE_CUSTOM_CATEGORY) : "";
  return { options, selected, customValue: match ? "" : cur };
}

function _grimoireEditModal(charId, entry, allEntries, onSave) {
  const isGlobal = charId === null;
  const e = entry || { content: "", keys: [], require_keys: [], exclude_keys: [], always: false, hidden: true, category: "", name: "", image: "", appearance_tags: "", appearance_tags_negative: "" };
  const draftKey = `grimoireDraft:${isGlobal ? "global" : charId}:${entry ? entry.id : "new"}`;
  const localDraft = LocalAutosave.restore(draftKey);
  if (localDraft) {
    Object.assign(e, localDraft);
    toast(t("grimoire_restored_unsaved_changes"));
  }
  let curImage = e.image || "";
  let grimoireAutosave = null;
  const candidates = (allEntries || []).filter((c) =>
    c.id !== (entry ? entry.id : null) && (isGlobal || c.char_id === charId || c.char_id === null));
  let linkedTargets = new Map((entry?.outgoing_links || []).map((l) => [l.target_id, l.label]));
  const cat = _grimoireCategoryOptions(allEntries, e.category);
  const layer = openModal(`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;padding-right:46px">
      <h3 style="margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${entry ? t("grimoire_edit_entry_heading") : t("grimoire_new_entry_heading")}${isGlobal ? ` <span class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent)">${t("grimoire_global_badge")}</span>` : ""}</h3>
      <div style="display:flex;gap:8px;flex:none">
        <button type="button" class="pe-gen-btn" id="gCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("grimoire_cancel_button")}</button>
        <button type="button" class="pe-gen-btn" id="gSave" data-feature="lore">${t("grimoire_save_button")}</button>
      </div>
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("grimoire_name_label")}</label>
      <input type="text" id="gName" class="grimoire-field-input" value="${_attr(e.name || "")}" placeholder="e.g. Maeve">
    </div>
    <div style="margin-bottom:16px;display:flex;gap:14px;align-items:flex-end">
      <div class="grimoire-img-box" id="gImgBox">
        ${curImage ? `<img id="gImgPreview" src="${_attr(curImage)}" alt=""><span class="grimoire-img-clear" role="button" aria-label="${t("grimoire_clear_image_label")}" tabindex="0" id="gImgClear">&times;</span>`
          : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`}
      </div>
      <input type="file" id="gImgFile" accept="image/png,image/jpeg,image/webp" hidden>
      <button type="button" class="pe-gen-btn" id="gImgGen">${t("grimoire_generate_button")}</button>
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("grimoire_category_label")}</label>
      ${customSelectHtml("gCategory", [
        { value: "", label: "Uncategorized" },
        ...cat.options.map((o) => ({ value: o, label: o })),
        { value: GRIMOIRE_CUSTOM_CATEGORY, label: t("grimoire_custom_category_option") },
      ], cat.selected)}
      <input type="text" id="gCategoryCustom" class="grimoire-field-input" value="${_attr(cat.customValue)}"
        placeholder="${t("grimoire_type_a_category_placeholder")}" style="margin-top:8px;display:${cat.selected === GRIMOIRE_CUSTOM_CATEGORY ? "block" : "none"}">
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("grimoire_keys_label")}</label>
      <input type="text" id="gKeys" class="grimoire-field-input" value="${_attr((e.keys || []).join(", "))}" placeholder="e.g. the King, royal palace">
    </div>
    <details style="margin-bottom:16px">
      <summary class="grimoire-field-label" style="cursor:pointer">${t("grimoire_advanced_matching_summary")}</summary>
      <div style="margin-top:12px">
        <label class="grimoire-field-label">${t("grimoire_require_keys_label")}</label>
        <p style="margin:0 0 8px;color:var(--color-muted);font-size:11.5px;line-height:1.5">${t("grimoire_require_keys_hint")}</p>
        <input type="text" id="gRequireKeys" class="grimoire-field-input" value="${_attr((e.require_keys || []).join(", "))}" placeholder="e.g. cave, night">
      </div>
      <div style="margin-top:12px">
        <label class="grimoire-field-label">${t("grimoire_exclude_keys_label")}</label>
        <p style="margin:0 0 8px;color:var(--color-muted);font-size:11.5px;line-height:1.5">${t("grimoire_exclude_keys_hint")}</p>
        <input type="text" id="gExcludeKeys" class="grimoire-field-input" value="${_attr((e.exclude_keys || []).join(", "))}" placeholder="e.g. slain, dead">
      </div>
    </details>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("grimoire_linked_entries_label")}</label>
      <p style="margin:0 0 8px;color:var(--color-muted);font-size:11.5px;line-height:1.5">${t("grimoire_linked_entries_hint")}</p>
      <div id="gLinkPills" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px"></div>
      <input type="text" id="gLinkSearch" class="grimoire-field-input" placeholder="${t("grimoire_search_entries_to_link_placeholder")}" autocomplete="off">
      <div id="gLinkSuggest" class="dropdown-menu" style="position:relative;left:0;right:0;top:4px"></div>
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("grimoire_content_label")}</label>
      <textarea id="gContent" class="grimoire-field-textarea" rows="5">${_esc(e.content || "")}</textarea>
      <div id="gChunkPreview" style="display:none;margin-top:10px"></div>
    </div>
    <div class="grimoire-toggle-row">
      <span style="font-size:14px;color:var(--color-ink)">${t("grimoire_always_included_label")}</span>
      <input type="checkbox" id="gAlways" ${e.always ? "checked" : ""}>
    </div>
    <div class="grimoire-toggle-row">
      <span style="font-size:14px;color:var(--color-ink)">${t("grimoire_hide_content_from_others_label")}</span>
      <input type="checkbox" id="gHidden" ${e.hidden ? "checked" : ""}>
    </div>
    <div id="gUsableAsPersonaRow" style="display:${!e.hidden && (e.category || "").toLowerCase() === "character" ? "block" : "none"}">
      <div class="grimoire-toggle-row">
        <span style="font-size:14px;color:var(--color-ink)">${t("grimoire_let_others_use_as_mask_label")}</span>
        <input type="checkbox" id="gUsableAsPersona" ${e.usable_as_persona ? "checked" : ""}>
      </div>
    </div>
  `, { onClose: () => grimoireAutosave?.stop() });
  let categoryChoice = cat.selected;
  const categoryValue = () => {
    if (categoryChoice === GRIMOIRE_CUSTOM_CATEGORY) return layer.querySelector("#gCategoryCustom").value.trim();
    return categoryChoice;
  };
  const collectDraftFields = () => ({
    name: layer.querySelector("#gName").value,
    category: categoryValue(),
    keys: layer.querySelector("#gKeys").value.split(",").map((k) => k.trim()).filter(Boolean),
    require_keys: layer.querySelector("#gRequireKeys").value.split(",").map((k) => k.trim()).filter(Boolean),
    exclude_keys: layer.querySelector("#gExcludeKeys").value.split(",").map((k) => k.trim()).filter(Boolean),
    content: layer.querySelector("#gContent").value,
    always: layer.querySelector("#gAlways").checked,
    hidden: layer.querySelector("#gHidden").checked,
    usable_as_persona: layer.querySelector("#gUsableAsPersona").checked,
    image: curImage,
    appearance_tags: e.appearance_tags || "",
    appearance_tags_negative: e.appearance_tags_negative || "",
  });
  grimoireAutosave = new LocalAutosave(draftKey, collectDraftFields);
  grimoireAutosave.start();

  const updateUsableAsPersonaVisibility = () => {
    const isCharacter = categoryValue().toLowerCase() === "character";
    layer.querySelector("#gUsableAsPersonaRow").style.display = !layer.querySelector("#gHidden").checked && isCharacter ? "block" : "none";
  };
  const updateCustomCategoryVisibility = () => {
    const isCustom = categoryChoice === GRIMOIRE_CUSTOM_CATEGORY;
    const customField = layer.querySelector("#gCategoryCustom");
    customField.style.display = isCustom ? "block" : "none";
    if (!isCustom) customField.value = "";
    else customField.focus();
  };
  layer.querySelector("#gHidden").addEventListener("change", updateUsableAsPersonaVisibility);
  wireCustomSelect("gCategory", (value) => {
    categoryChoice = value;
    updateCustomCategoryVisibility();
    updateUsableAsPersonaVisibility();
  });
  layer.querySelector("#gCategoryCustom").addEventListener("input", updateUsableAsPersonaVisibility);
  let chunkPreviewTimer = null;
  const CHUNK_PREVIEW_CHAR_THRESHOLD = 500 * 4;
  const renderChunkPreview = (chunks) => {
    const box = layer.querySelector("#gChunkPreview");
    box.style.display = "block";
    box.innerHTML = `
      <p style="margin:0 0 8px;color:var(--color-muted);font-size:11.5px;line-height:1.5">${t("grimoire_chunk_preview_intro")}</p>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${chunks.map((chunk, index) => `
          <div style="border:1px solid var(--color-line);border-radius:8px;padding:8px 10px">
            <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px">${index + 1}</div>
            <div style="font-size:12px;color:var(--color-ink);white-space:pre-wrap">${_esc(chunk)}</div>
          </div>
        `).join("")}
      </div>
    `;
  };
  const hideChunkPreview = () => {
    const box = layer.querySelector("#gChunkPreview");
    box.style.display = "none";
    box.innerHTML = "";
  };
  layer.querySelector("#gContent").addEventListener("input", () => {
    if (chunkPreviewTimer) clearTimeout(chunkPreviewTimer);
    chunkPreviewTimer = setTimeout(async () => {
      const content = layer.querySelector("#gContent").value;
      if (content.length <= CHUNK_PREVIEW_CHAR_THRESHOLD) { hideChunkPreview(); return; }
      try {
        const result = await api("/api/lore/preview-chunks", { method: "POST", body: JSON.stringify({ content }) });
        if (layer.querySelector("#gContent").value !== content) return;
        renderChunkPreview(result.chunks || []);
      } catch { hideChunkPreview(); }
    }, 600);
  });
  layer.querySelector("#gCancel").onclick = () => { grimoireAutosave.clear(); closeModal(layer); };
  layer.querySelector("#gImgGen").onclick = () => _grimoireImageGenModal((url) => {
    curImage = url;
    layer.querySelector("#gImgBox").innerHTML = `<img id="gImgPreview" src="${_attr(curImage)}" alt=""><span class="grimoire-img-clear" role="button" aria-label="${t("grimoire_clear_image_label")}" tabindex="0" id="gImgClear">&times;</span>`;
    wireClear();
  });
  layer.querySelector("#gImgBox").onclick = (ev) => {
    if (ev.target.closest("#gImgClear")) return;
    layer.querySelector("#gImgFile").click();
  };
  const wireClear = () => {
    const btn = layer.querySelector("#gImgClear");
    if (btn) btn.onclick = (ev) => {
      ev.stopPropagation();
      curImage = "";
      layer.querySelector("#gImgBox").innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    };
  };
  wireClear();
  const renderLinkPills = () => {
    const pillsEl = layer.querySelector("#gLinkPills");
    pillsEl.innerHTML = [...linkedTargets].map(([id, label]) => {
      const c = candidates.find((x) => x.id === id);
      const name = c ? _grimoireEntryTitle(c) : t("grimoire_unknown_entry");
      return `
        <div class="grimoire-link-row" data-link-row="${_attr(id)}" style="display:flex;gap:8px;align-items:center;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:10px;padding:7px 10px">
          <span style="font-size:13px;color:var(--color-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${dirMark("&rarr;", "&larr;")} ${_esc(name)}</span>
          <input type="text" data-link-label="${_attr(id)}" value="${_attr(label)}" placeholder="relationship (optional)" style="margin-left:auto;width:150px;background:var(--color-surface);border:1px solid var(--color-line-2);border-radius:7px;color:var(--color-accent);font-family:var(--font-mono);font-size:11.5px;padding:5px 9px">
          <span class="x" data-unlink="${_attr(id)}" style="cursor:pointer;color:var(--color-muted);font-size:16px;flex:none">&times;</span>
        </div>
      `;
    }).join("");
    pillsEl.querySelectorAll("[data-unlink]").forEach((x) => {
      x.onclick = () => { linkedTargets.delete(x.dataset.unlink); renderLinkPills(); };
    });
    pillsEl.querySelectorAll("[data-link-label]").forEach((input) => {
      input.oninput = () => { linkedTargets.set(input.dataset.linkLabel, input.value.slice(0, 60)); };
    });
  };
  const linkSearch = layer.querySelector("#gLinkSearch");
  const linkSuggest = layer.querySelector("#gLinkSuggest");
  linkSearch.oninput = () => {
    const q = linkSearch.value.trim().toLowerCase();
    const matches = candidates.filter((c) => !linkedTargets.has(c.id) &&
      (!q || _grimoireEntryTitle(c).toLowerCase().includes(q))).slice(0, 8);
    if (!matches.length) { linkSuggest.classList.remove("open"); linkSuggest.innerHTML = ""; return; }
    linkSuggest.innerHTML = matches.map((c) =>
      `<button type="button" class="dropdown-item" data-pick-link="${_attr(c.id)}">${_esc(_grimoireEntryTitle(c))}</button>`).join("");
    linkSuggest.classList.add("open");
    linkSuggest.querySelectorAll("[data-pick-link]").forEach((btn) => btn.onclick = () => {
      linkedTargets.set(btn.dataset.pickLink, "");
      linkSearch.value = "";
      linkSuggest.classList.remove("open");
      linkSuggest.innerHTML = "";
      renderLinkPills();
    });
  };
  renderLinkPills();
  layer.querySelector("#gImgFile").onchange = () => {
    const fileInput = layer.querySelector("#gImgFile");
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    maybeCropUpload(file, "1", 512, 512, async (dataUrl, blob) => {
      const fd = new FormData();
      fd.append("file", blob, file.name);
      try {
        const r = await api(isGlobal ? "/api/lore/media" : `/api/characters/${encodeURIComponent(charId)}/media`, { method: "POST", body: fd });
        curImage = r.url;
        layer.querySelector("#gImgBox").innerHTML = `<img id="gImgPreview" src="${_attr(curImage)}" alt=""><span class="grimoire-img-clear" role="button" aria-label="${t("grimoire_clear_image_label")}" tabindex="0" id="gImgClear">&times;</span>`;
        wireClear();
      } catch (err) {
        errorToast(err.message || t("grimoire_upload_failed"));
      }
    });
  };
  layer.querySelector("#gSave").onclick = async () => {
    const content = layer.querySelector("#gContent").value.trim();
    if (!content) { toast(t("grimoire_content_required")); return; }
    const body = {
      content,
      keys: layer.querySelector("#gKeys").value,
      require_keys: layer.querySelector("#gRequireKeys").value,
      exclude_keys: layer.querySelector("#gExcludeKeys").value,
      always: layer.querySelector("#gAlways").checked,
      hidden: layer.querySelector("#gHidden").checked,
      image: curImage,
      category: categoryValue(),
      name: layer.querySelector("#gName").value.trim(),
      appearance_tags: e.appearance_tags || "",
      appearance_tags_negative: e.appearance_tags_negative || "",
    };
    const usableAsPersona = layer.querySelector("#gUsableAsPersona").checked;
    try {
      let lid = entry?.id;
      if (entry) await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else {
        const createUrl = isGlobal ? "/api/lore/global" : `/api/characters/${encodeURIComponent(charId)}/lore`;
        const created = await api(createUrl, { method: "POST", body: JSON.stringify(body) });
        lid = created.id;
      }
      if (usableAsPersona !== !!e.usable_as_persona) {
        await api(`/api/lore/${encodeURIComponent(lid)}/usable-as-persona`, { method: "PUT", body: JSON.stringify({ value: usableAsPersona }) });
      }
      try {
        const links = [...linkedTargets].map(([target_id, label]) => ({ target_id, label }));
        await api(`/api/lore/${encodeURIComponent(lid)}/links`, { method: "PUT", body: JSON.stringify({ links }) });
      } catch (err) {
        errorToast(err.message || t("grimoire_couldnt_save_linked_entries"));
        return;
      }
    } catch (err) {
      errorToast(err.message || t("grimoire_save_failed"));
      return;
    }
    grimoireAutosave.clear();
    closeModal(layer);
    toast(t("grimoire_saved_toast"));
    onSave();
  };
}

const GRIMOIRE_REL_PAGE_SIZE = 8;

function _grimoireRelationshipsHtml(entry, allEntries) {
  const outgoing = entry.outgoing_links || [];
  const incoming = entry.incoming_links || [];
  const total = outgoing.length + incoming.length;
  if (!total) return "";
  const selfName = _grimoireEntryTitle(entry);
  const nameFor = (id) => {
    const e = (allEntries || []).find((x) => x.id === id);
    return e ? _grimoireEntryTitle(e) : t("grimoire_unknown_entry");
  };
  const rowHtml = (name, label, i, incomingSide) => `
    <div class="grimoire-rel-row" data-rel-idx="${i}" data-rel-name="${_attr(name.toLowerCase())}" style="font-size:12.5px;color:var(--color-sec)">
      ${incomingSide
        ? `<b style="color:var(--color-ink)">${_esc(name)}</b> ${dirMark("&rarr;", "&larr;")} <b style="color:var(--color-ink)">${_esc(selfName)}</b>`
        : `${dirMark("&rarr;", "&larr;")} <b style="color:var(--color-ink)">${_esc(name)}</b>`}
      ${label ? ` <span style="color:var(--color-accent);font-family:var(--font-mono);font-size:11px">${_esc(label)}</span>` : ""}
    </div>
  `;
  let i = 0;
  const rows = [
    ...outgoing.map((l) => rowHtml(nameFor(l.target_id), l.label, i++, false)),
    ...incoming.map((l) => rowHtml(nameFor(l.source_id), l.label, i++, true)),
  ];
  const needsPaging = total > GRIMOIRE_REL_PAGE_SIZE;
  return `
    <div id="gRelSection" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--color-line)">
      <div class="font-mono" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted);margin-bottom:8px">${t("grimoire_relationships_heading")} <span style="color:var(--color-sec)">&middot; ${total}</span></div>
      ${needsPaging ? `<input type="text" id="gRelSearch" class="grimoire-field-input" placeholder="${t("grimoire_search_linked_entries_placeholder", "Search linked entries…")}" style="margin-bottom:8px;font-size:12.5px;padding:6px 8px" autocomplete="off">` : ""}
      <div id="gRelList" data-page-size="${GRIMOIRE_REL_PAGE_SIZE}" style="display:flex;flex-direction:column;gap:6px">${rows.join("")}</div>
      ${needsPaging ? `<button type="button" id="gRelShowMore" style="margin-top:6px;background:none;border:none;cursor:pointer;padding:0;font-size:12px;color:var(--color-accent)">${t("grimoire_show_all_linked", "Show all")} (${total})</button>` : ""}
    </div>
  `;
}

function _wireGrimoireRelationships(doc) {
  const list = doc.querySelector("#gRelList");
  if (!list) return;
  const pageSize = Number(list.dataset.pageSize) || GRIMOIRE_REL_PAGE_SIZE;
  const rows = [...list.querySelectorAll("[data-rel-idx]")];
  const search = doc.querySelector("#gRelSearch");
  const showMore = doc.querySelector("#gRelShowMore");
  let expanded = false;
  const applyFilter = () => {
    const q = (search?.value || "").trim().toLowerCase();
    rows.forEach((row) => {
      const idx = Number(row.dataset.relIdx);
      const matchesQuery = !q || row.dataset.relName.includes(q);
      const withinPage = expanded || q || idx < pageSize;
      row.style.display = matchesQuery && withinPage ? "" : "none";
    });
    if (showMore) showMore.style.display = (expanded || q) ? "none" : "";
  };
  if (search) search.oninput = applyFilter;
  if (showMore) showMore.onclick = () => { expanded = true; applyFilter(); };
  applyFilter();
}

function _grimoireViewModal(entry, charName, allEntries, { onEdit, onDelete }) {
  const title = _grimoireEntryTitle(entry);
  const layer = openModal(`
    <div class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px">${_esc(entry.category || "Uncategorized")} &middot; ${_esc(charName)}</div>
    ${entry.image ? `<img src="${_attr(entry.image)}" alt="" ${entry.is_explicit ? 'data-explicit="1"' : ""} style="width:100%;height:auto;border-radius:10px;margin:6px 0 14px;${entry.is_explicit && !ME?.nsfw_allowed ? "filter:blur(14px) saturate(60%)" : ""}">` : ""}
    <h3 class="font-display" style="margin:0 0 10px">${_esc(title)}</h3>
    ${(entry.keys || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${entry.keys.map((k) => `<span class="grimoire-tag" style="border:1px solid var(--color-line-2);border-radius:999px;padding:3px 9px">${_esc(k)}</span>`).join("")}</div>` : ""}
    <p style="font-size:14px;color:var(--color-ink);line-height:1.6;white-space:pre-wrap">${_esc(entry.content)}</p>
    <div style="display:flex;gap:16px;margin-top:16px;font-size:12px;color:var(--color-sec)">
      <span>${t("grimoire_always_label")} <b style="color:var(--color-ink)">${entry.always ? t("grimoire_yes_word") : t("grimoire_no_word")}</b></span>
      <span>${t("grimoire_global_label")} <b style="color:var(--color-ink)">${entry.global ? t("grimoire_yes_word") : t("grimoire_no_word")}</b></span>
    </div>
    ${_grimoireRelationshipsHtml(entry, allEntries)}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
      <button type="button" class="pe-gen-btn" id="gvEdit">${t("grimoire_edit_button")}</button>
      <button type="button" class="pe-gen-btn" id="gvDelete" style="border-color:var(--color-warn);color:var(--color-warn)">${t("grimoire_delete_button")}</button>
    </div>
  `);
  _wireGrimoireRelationships(layer);
  layer.querySelector("#gvEdit").onclick = () => { closeModal(layer); onEdit(); };
  layer.querySelector("#gvDelete").onclick = () => {
    const confirmLayer = openModal(`
      <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("grimoire_delete_entry_confirm_heading")}</h3>
      <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">"${_esc(title)}" ${t("grimoire_will_be_gone_for_good")}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="gvDelCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("grimoire_keep_it_button")}</button>
        <button type="button" class="pe-gen-btn" id="gvDelConfirm" style="border-color:var(--color-warn);color:var(--color-warn)">${t("grimoire_delete_button")}</button>
      </div>
    `);
    confirmLayer.querySelector("#gvDelCancel").onclick = () => closeModal(confirmLayer);
    confirmLayer.querySelector("#gvDelConfirm").onclick = () => {
      closeModal(confirmLayer);
      closeModal(layer);
      onDelete();
    };
  };
}

const GRIMOIRE_CATEGORY_COLORS_KEY = "grimoireCategoryColors";

function getCategoryColors() {
  return store.get(GRIMOIRE_CATEGORY_COLORS_KEY, {});
}

function setCategoryColor(category, hex) {
  const colors = getCategoryColors();
  const key = category.trim().toLowerCase();
  if (hex) colors[key] = hex;
  else delete colors[key];
  store.set(GRIMOIRE_CATEGORY_COLORS_KEY, colors);
}

function categoryColor(category) {
  return getCategoryColors()[(category || "").trim().toLowerCase()] || "";
}

class WorkshopLoreView {
  constructor() {
    this.entries = null;
    this.chars = {};
    this.q = "";
    this.keyFilters = [];
    this.mode = "web";
    this.sortMode = store.get("grimoireSortMode", "category");
  }

  allKeys() {
    return [...new Set((this.entries || []).flatMap((e) => e.keys || []))].sort();
  }

  visibleEntries() {
    return (this.entries || []).filter((e) => {
      if (this.keyFilters.length) {
        const keys = (e.keys || []).map((k) => k.toLowerCase());
        if (!this.keyFilters.every((kf) => keys.includes(kf.toLowerCase()))) return false;
      }
      if (!this.q) return true;
      const q = this.q.toLowerCase();
      return _grimoireEntryTitle(e).toLowerCase().includes(q) ||
        (e.content || "").toLowerCase().includes(q) ||
        (e.keys || []).some((k) => k.toLowerCase().includes(q));
    });
  }

  addKeyFilter(key) {
    if (!this.keyFilters.includes(key)) this.keyFilters = [...this.keyFilters, key];
    this.render();
  }

  removeKeyFilter(key) {
    this.keyFilters = this.keyFilters.filter((k) => k !== key);
    this.render();
  }

  async mount(main) {
    this.main = main;
    window._activeGrimoireView = this;
    this.render();
    const [entries, chars] = await Promise.all([
      api("/api/lore/mine").catch(() => []),
      api("/api/characters?scope=mine").catch(() => []),
    ]);
    this.entries = entries;
    chars.forEach((c) => { this.chars[c.id] = c; });
    this.render();
    this.maybeAutoOpen();
  }

  maybeAutoOpen() {
    if (sessionStorage.getItem("openGrimoireAdd")) {
      sessionStorage.removeItem("openGrimoireAdd");
      this.openAddFlow();
      return;
    }
    const parts = location.pathname.split("/").filter(Boolean);
    const lid = parts[3];
    if (!lid) return;
    const entry = this.entries.find((e) => e.id === lid);
    if (entry) this.openEntry(lid);
  }

  openEntry(lid) {
    const entry = this.entries.find((e) => e.id === lid);
    if (!entry) return;
    const charName = entry.char_id === null ? t("grimoire_global_label") : (this.chars[entry.char_id]?.name || t("grimoire_unknown_character"));
    _grimoireViewModal(entry, charName, this.entries, {
      onEdit: () => _grimoireEditModal(entry.char_id, entry, this.entries, () => this.mount(this.main)),
      onDelete: async () => {
        try {
          await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
          toast(t("grimoire_deleted_toast"));
          this.mount(this.main);
        } catch (err) {
          errorToast(err.message || t("grimoire_couldnt_delete_entry"));
        }
      },
    });
  }

  groupedByCategory() {
    const groups = new Map();
    for (const entry of this.visibleEntries()) {
      const key = (entry.category || "").trim() || "Uncategorized";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const sections = [...groups.entries()].filter(([key]) => key !== "Uncategorized");
    sections.sort((a, b) => b[1].length - a[1].length);
    if (groups.has("Uncategorized")) sections.push(["Uncategorized", groups.get("Uncategorized")]);
    return sections;
  }

  rowHtml(entry) {
    const title = _grimoireEntryTitle(entry);
    const initial = title[0].toUpperCase();
    const art = entry.image
      ? `background-image:url('${_attr(entry.image)}')`
      : `background:var(--color-surface-2)`;
    const charName = entry.char_id === null ? t("grimoire_global_label") : (this.chars[entry.char_id]?.name || t("grimoire_unknown_character"));
    return `
      <div class="sanctum-feed-row" data-lore-id="${_attr(entry.id)}" data-char-id="${_attr(entry.char_id)}" onclick="_activeGrimoireView?.openEntry('${_attr(entry.id)}')">
        <span class="sanctum-specimen" style="${art}">
          ${entry.image ? "" : _esc(initial)}
          <span class="sanctum-specimen-tab">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_NAV_MENU_ICONS.grimoire}</svg>
          </span>
        </span>
        <div class="sanctum-feed-body">
          <span class="sanctum-feed-title">${_esc(title)}</span>
          <span class="grimoire-tag">${_esc(charName)}</span>
        </div>
      </div>
    `;
  }

  bodyHtml() {
    if (this.entries === null) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("grimoire_opening_grimoire")}</p>`;
    }
    if (!this.entries.length) {
      return `
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">${t("grimoire_nothing_recorded_yet")}</p>
          <p class="sanctum-empty-sub">${t("grimoire_lore_entries_show_up_here")}</p>
          <button type="button" class="sanctum-empty-cta" style="border:none;background:none;cursor:pointer" id="grimoireEmptyAdd">${t("grimoire_add_first_entry_cta")}</button>
        </div>
      `;
    }
    if (this.sortMode === "recent") {
      const flat = [...this.visibleEntries()].sort((a, b) => (b.created || 0) - (a.created || 0));
      if (!flat.length) {
        return `<p style="color:var(--color-sec);font-size:13px">${t("grimoire_no_entries_match_search")}</p>`;
      }
      return `<div class="sanctum-feed">${flat.map((e) => this.rowHtml(e)).join("")}</div>`;
    }
    const sections = this.groupedByCategory();
    if (!sections.length) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("grimoire_no_entries_match_search")}</p>`;
    }
    return sections.map(([category, entries]) => {
      const color = categoryColor(category);
      return `
      <div class="sanctum-feed-header" style="display:flex;align-items:center;gap:8px${color ? `;border-left:3px solid ${_attr(color)};padding-left:8px` : ""}">
        <span style="flex:1">${_esc(category)}</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-muted)">${entries.length}</span>
        ${category !== "Uncategorized" ? `
          <button type="button" class="grimoire-cat-color-btn" data-cat-color="${_attr(category)}" aria-label="${t("grimoire_category_color_label", "Category color")}"
            style="width:16px;height:16px;border-radius:50%;border:1px solid var(--color-line-2);background:${color || "var(--color-surface-2)"};cursor:pointer;padding:0;flex:none"></button>
        ` : ""}
      </div>
      <div class="sanctum-feed">${entries.map((e) => this.rowHtml(e)).join("")}</div>
    `;
    }).join("");
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col grimoire-content">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml(t("grimoire_workshop_breadcrumb"), t("grimoire_lore_title"), t("ph_lorebook_title"), `${t("ph_lorebook_sub")} ${this.entries && this.entries.length ? `&middot; <b style="color:var(--color-ink)">${this.entries.length}</b> ${this.entries.length === 1 ? t("grimoire_entry_singular", "entry") : t("grimoire_entry_plural", "entries")}` : ""}`)}</div>
        <button type="button" class="grimoire-add-btn" id="grimoireAddBtn" aria-label="${t("grimoire_add_lore_entry_label")}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;width:fit-content;margin-bottom:16px">
        <button type="button" class="filter-chip${this.mode === "list" ? " on" : ""}" id="grimoireModeList">${t("grimoire_list_tab")}</button>
        <button type="button" class="filter-chip${this.mode === "web" ? " on" : ""}" id="grimoireModeWeb">${t("grimoire_web_tab")}</button>
      </div>
      ${this.mode === "list" ? `
        ${this.entries && this.entries.length ? `
          <div id="grimoireSearchBox" style="position:relative;margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
            ${this.keyFilters.map((k) => `
              <span class="inline-pill pill-tag">#${_esc(k)}<span class="x" data-remove-key="${_attr(k)}">&times;</span></span>
            `).join("")}
            <input type="text" id="grimoireSearch" value="${_attr(this.q)}" placeholder="${this.keyFilters.length ? "" : t("grimoire_search_key_placeholder")}"
              style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
            <div id="grimoireSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
          </div>
          <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;width:fit-content;margin-bottom:16px">
            <button type="button" class="filter-chip${this.sortMode === "category" ? " on" : ""}" id="grimoireSortCategory">${t("grimoire_sort_category", "By category")}</button>
            <button type="button" class="filter-chip${this.sortMode === "recent" ? " on" : ""}" id="grimoireSortRecent">${t("grimoire_sort_recent", "Recent")}</button>
          </div>
        ` : ""}
        ${this.bodyHtml()}
      ` : `<div id="grimoireWebMount"></div>`}
      </div>
    `;
    const addBtn = this.main.querySelector("#grimoireAddBtn");
    if (addBtn) addBtn.onclick = () => this.openAddFlow();
    const emptyAdd = this.main.querySelector("#grimoireEmptyAdd");
    if (emptyAdd) emptyAdd.onclick = () => this.openAddFlow();
    this.main.querySelectorAll("[data-remove-key]").forEach((x) => {
      x.onclick = (e) => { e.stopPropagation(); this.removeKeyFilter(x.dataset.removeKey); };
    });
    const search = this.main.querySelector("#grimoireSearch");
    if (search) {
      let searchTimer;
      search.oninput = () => {
        this.updateKeySuggestions();
        if (search.value.startsWith("#")) return;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          this.q = search.value.trim();
          this.render();
        }, 250);
      };
      search.onkeydown = (e) => {
        if (e.key === "Backspace" && search.value === "" && this.keyFilters.length) {
          e.preventDefault();
          this.keyFilters = this.keyFilters.slice(0, -1);
          this.render();
          return;
        }
        if (e.key !== "Enter") return;
        const val = search.value.trim();
        if (val.startsWith("#") && val.length > 1) {
          this.addKeyFilter(val.slice(1));
          search.value = "";
          this.q = "";
        }
      };
    }
    const modeListBtn = this.main.querySelector("#grimoireModeList");
    const modeWebBtn = this.main.querySelector("#grimoireModeWeb");
    if (modeListBtn) modeListBtn.onclick = () => { this.mode = "list"; this.render(); };
    if (modeWebBtn) modeWebBtn.onclick = () => { this.mode = "web"; this.render(); };
    const sortCategoryBtn = this.main.querySelector("#grimoireSortCategory");
    const sortRecentBtn = this.main.querySelector("#grimoireSortRecent");
    if (sortCategoryBtn) sortCategoryBtn.onclick = () => { this.sortMode = "category"; store.set("grimoireSortMode", "category"); this.render(); };
    if (sortRecentBtn) sortRecentBtn.onclick = () => { this.sortMode = "recent"; store.set("grimoireSortMode", "recent"); this.render(); };
    this.main.querySelectorAll("[data-cat-color]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const category = btn.dataset.catColor;
        openColorPicker(categoryColor(category) || "#8973ae", (hex) => {
          setCategoryColor(category, hex);
          this.render();
        });
      };
    });
    const webMount = this.main.querySelector("#grimoireWebMount");
    if (webMount && this.entries !== null && typeof WorkshopLoreWebView !== "undefined") {
      const webView = new WorkshopLoreWebView(this.entries, this.chars);
      webView.mount(webMount);
    }
  }

  updateKeySuggestions() {
    const box = this.main.querySelector("#grimoireSuggest");
    const search = this.main.querySelector("#grimoireSearch");
    if (!box || !search) return;
    const val = search.value;
    if (!val.startsWith("#")) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const q = val.slice(1).toLowerCase();
    const matches = this.allKeys().filter((k) => !this.keyFilters.includes(k) && k.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { box.classList.remove("open"); box.innerHTML = ""; return; }
    box.innerHTML = matches.map((k) => `<button type="button" class="dropdown-item" data-pick-key="${_attr(k)}">#${_esc(k)}</button>`).join("");
    box.classList.add("open");
    box.querySelectorAll("[data-pick-key]").forEach((btn) => btn.onclick = () => {
      search.value = "";
      box.classList.remove("open");
      this.addKeyFilter(btn.dataset.pickKey);
    });
  }

  openAddFlow() {
    _grimoireScopePickerModal((scope) => {
      if (scope === "global") {
        _grimoireEditModal(null, null, this.entries, () => this.mount(this.main));
        return;
      }
      _grimoireCharacterPickerModal(Object.values(this.chars), (charId) => {
        _grimoireEditModal(charId, null, this.entries, () => this.mount(this.main));
      });
    });
  }
}
