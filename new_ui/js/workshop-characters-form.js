"use strict";

async function _createQuickGenModal(width, height, onUse) {
  let checkpoints, animaUnets, loras, loraPreviews, checkpointPreviews, samplerData, upscalers;
  try {
    [checkpoints, animaUnets, loras, loraPreviews, checkpointPreviews, samplerData, upscalers] = await Promise.all([
      api("/api/imagegen/checkpoints"),
      api("/api/imagegen/anima-unets").catch(() => []),
      api("/api/imagegen/loras"),
      api("/api/imagegen/lora-previews").catch(() => ({})),
      api("/api/imagegen/checkpoint-previews").catch(() => ({})),
      api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
      api("/api/imagegen/upscalers").catch(() => []),
    ]);
  } catch (err) {
    errorToast(err.message || t("create_couldnt_load_imagegen_options"));
    return;
  }
  if (!checkpoints.length && !animaUnets.length) { toast(t("create_no_checkpoints_found")); return; }
  const samplers = samplerData.samplers || [];
  const schedulers = samplerData.schedulers || [];
  let architecture = "sdxl";
  const modelsFor = () => architecture === "anima" ? animaUnets : checkpoints;
  const defaultCheckpointFor = (models) => models.find((m) => m.toLowerCase().includes("realskin")) || models[0] || null;
  const layer = openModal(`
    <h3>${t("create_generate_image_heading")}</h3>
    <div class="imggen-grid">
    <div class="imggen-settings">
      <div style="display:flex;gap:8px">
        <button type="button" id="cqgModeSimple" class="pe-gen-btn" style="flex:1">${t("create_simple_button")}</button>
        <button type="button" id="cqgModeAdvanced" class="pe-gen-btn" style="flex:1;border-color:var(--color-line-2);color:var(--color-sec)">${t("create_advanced_button")}</button>
      </div>
      ${animaUnets.length ? `
        <div>
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_architecture_label")}</label>
          ${customSelectHtml("cqgArch", [{ value: "sdxl", label: t("create_architecture_legacy_option") }, { value: "anima", label: t("create_architecture_current_option") }], architecture)}
        </div>
      ` : ""}
      <div>
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_reference_image_label")}</label>
        <p style="margin:0 0 4px;color:var(--color-muted);font-size:11px;line-height:1.4">${t("create_reference_image_hint")}</p>
        ${refImagePickerHtml("cqgRefPicker")}
        <div id="cqgDenoiseRow" style="display:none;margin-top:8px;align-items:center;gap:8px">
          <span style="font-size:11.5px;color:var(--color-muted)">${t("create_denoise_label")}</span>
          <input type="range" id="cqgDenoise" min="0.05" max="1" step="0.05" value="0.6" style="flex:1">
          <span id="cqgDenoiseVal" style="font-size:11.5px;color:var(--color-muted);width:32px;text-align:right">0.60</span>
        </div>
      </div>
      <div>
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_checkpoint_label")}</label>
        <div id="cqgCheckpointWrap">${checkpointPickerHtml("cqgCheckpoint", modelsFor(), checkpointPreviews, defaultCheckpointFor(modelsFor()))}</div>
      </div>
      ${loras.length ? `
        <div>
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_loras_label")}</label>
          ${loraPickerHtml("cqgLoras", loras, [], loraPreviews)}
        </div>
      ` : ""}
      <div id="cqgSimpleFields">
        <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_describe_image_label")}</label>
        <textarea id="cqgSimpleDescription" class="grimoire-field-textarea" rows="3" placeholder="${t("create_describe_image_placeholder")}"></textarea>
        <div style="font-size:11px;color:var(--color-muted);margin-top:4px">${t("create_danbooru_tags_hint")}</div>
      </div>
      <div id="cqgAdvancedFields" style="display:none;flex-direction:column;gap:10px">
        <div>
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_prompt_label")}</label>
          <textarea id="cqgPrompt" class="grimoire-field-textarea" rows="3" placeholder="${t("create_prompt_placeholder")}"></textarea>
        </div>
        <div>
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_negative_prompt_label")}</label>
          <textarea id="cqgNegative" class="grimoire-field-textarea" rows="2" placeholder="${t("create_negative_prompt_placeholder")}"></textarea>
        </div>
      </div>
      <div id="cqgAdvancedParams" style="display:none;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_sampler_label")}</label>
            ${customSelectHtml("cqgSampler", samplers, samplers.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : samplers[0])}
          </div>
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_scheduler_label")}</label>
            ${customSelectHtml("cqgScheduler", schedulers, schedulers.includes("karras") ? "karras" : schedulers[0])}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_steps_label")}</label>
            <input type="number" id="cqgSteps" value="20" min="1" max="60" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px">
          </div>
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_cfg_label")}</label>
            <input type="number" id="cqgCfg" value="7.0" step="0.5" min="1" max="20" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px">
          </div>
        </div>
      </div>
    </div>
    <div class="imggen-preview">
      ${genPreviewBoxHtml("cqgPreviewBox", `${width} / ${height}`)}
      ${upscalers.length ? `
        <div id="cqgUpscaleRow" style="display:none">
          <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("create_upscaler_label")}</label>
          <div style="display:flex;gap:8px">
            ${customSelectHtml("cqgUpscaler", upscalers, upscalers[0])}
            <button type="button" id="cqgUpscaleGo" class="pe-gen-btn" style="flex:none">${t("create_upscale_button")}</button>
          </div>
        </div>
      ` : ""}
      <div class="imggen-actions" style="justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="cqgCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ${t("create_cancel_button")}
        </button>
        <button type="button" class="pe-gen-btn" id="cqgUse" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          ${t("create_use_this_image_button")}
        </button>
        <button type="button" class="pe-gen-btn" id="cqgGo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l1.9 5.8L20 9.5l-6.1 1.7L12 17l-1.9-5.8L4 9.5l6.1-1.7L12 2z"/></svg>
          ${t("create_generate_button")}
        </button>
      </div>
    </div>
    </div>
  `, { wide: true });
  let selectedCheckpoint = defaultCheckpointFor(modelsFor());
  let selectedSampler = samplers.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (samplers[0] || null);
  let selectedScheduler = schedulers.includes("karras") ? "karras" : (schedulers[0] || null);
  let selectedUpscaler = upscalers[0] || null;
  wireCheckpointPicker("cqgCheckpoint", (v) => { selectedCheckpoint = v; });
  if (loras.length) wireLoraPicker("cqgLoras", { onKeywordClick: (kw) => {
    const target = layer.querySelector(mode === "advanced" ? "#cqgPrompt" : "#cqgSimpleDescription");
    if (target) target.value = target.value.trim() ? `${target.value.trim()}, ${kw}` : kw;
  } });
  wireCustomSelect("cqgSampler", (v) => { selectedSampler = v; });
  wireCustomSelect("cqgScheduler", (v) => { selectedScheduler = v; });
  if (upscalers.length) wireCustomSelect("cqgUpscaler", (v) => { selectedUpscaler = v; });
  if (animaUnets.length) {
    wireCustomSelect("cqgArch", (arch) => {
      architecture = arch;
      const models = modelsFor();
      selectedCheckpoint = defaultCheckpointFor(models);
      layer.querySelector("#cqgCheckpointWrap").innerHTML = checkpointPickerHtml("cqgCheckpoint", models, checkpointPreviews, selectedCheckpoint);
      wireCheckpointPicker("cqgCheckpoint", (v) => { selectedCheckpoint = v; });
    });
  }
  let mode = "simple";
  const simpleBtn = layer.querySelector("#cqgModeSimple");
  const advancedBtn = layer.querySelector("#cqgModeAdvanced");
  const simpleFields = layer.querySelector("#cqgSimpleFields");
  const advancedFields = layer.querySelector("#cqgAdvancedFields");
  const advancedParams = layer.querySelector("#cqgAdvancedParams");
  const setMode = (m) => {
    mode = m;
    simpleFields.style.display = m === "simple" ? "block" : "none";
    advancedFields.style.display = m === "simple" ? "none" : "flex";
    advancedParams.style.display = m === "simple" ? "none" : "flex";
    simpleBtn.style.borderColor = m === "simple" ? "var(--color-accent)" : "var(--color-line-2)";
    simpleBtn.style.color = m === "simple" ? "var(--color-accent)" : "var(--color-sec)";
    advancedBtn.style.borderColor = m === "advanced" ? "var(--color-accent)" : "var(--color-line-2)";
    advancedBtn.style.color = m === "advanced" ? "var(--color-accent)" : "var(--color-sec)";
  };
  simpleBtn.onclick = () => setMode("simple");
  advancedBtn.onclick = () => setMode("advanced");
  setMode("simple");
  let lastImage = null;
  let refDataUrl = null;
  const denoiseRow = layer.querySelector("#cqgDenoiseRow");
  const denoise = layer.querySelector("#cqgDenoise");
  const denoiseVal = layer.querySelector("#cqgDenoiseVal");
  denoise.addEventListener("input", () => { denoiseVal.textContent = Number(denoise.value).toFixed(2); });
  wireRefImagePicker("cqgRefPicker", (dataUrl) => {
    refDataUrl = dataUrl;
    denoiseRow.style.display = dataUrl ? "flex" : "none";
  });
  layer.querySelector("#cqgCancel").onclick = () => closeModal(layer);
  let genToken = 0;
  const setGoBusy = (goBtn, isBusy) => {
    goBtn.disabled = false;
    goBtn.style.borderColor = isBusy ? "var(--color-warn)" : "";
    goBtn.style.color = isBusy ? "var(--color-warn)" : "";
    goBtn.innerHTML = isBusy
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Stop'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l1.9 5.8L20 9.5l-6.1 1.7L12 17l-1.9-5.8L4 9.5l6.1-1.7L12 2z"/></svg>Generate';
  };
  layer.querySelector("#cqgGo").onclick = async () => {
    const goBtn = layer.querySelector("#cqgGo");
    if (genToken % 2 === 1) {
      genToken += 1;
      try {
        await api("/api/imagegen/standalone/stream/stop", { method: "POST" });
      } catch (err) {
        errorToast(err.message || t("create_couldnt_stop_generation"));
      }
      setGenPreviewBox("cqgPreviewBox", {});
      setGoBusy(goBtn, false);
      return;
    }
    let positive, negative, sampler, scheduler, steps, cfg;
    if (mode === "simple") {
      const description = layer.querySelector("#cqgSimpleDescription").value.trim();
      if (!description) { toast(t("create_describe_something_first")); return; }
      goBtn.disabled = true;
      goBtn.textContent = t("create_thinking_button");
      try {
        const r = await api("/api/imagegen/prompt-from-description", { method: "POST", body: JSON.stringify({ description }) });
        positive = r.positive;
        negative = r.negative;
        sampler = r.sampler;
        scheduler = r.scheduler;
        steps = r.steps;
        cfg = r.cfg;
      } catch (err) {
        errorToast(err.message || t("create_couldnt_convert_description"));
        goBtn.disabled = false;
        goBtn.textContent = t("create_generate_button");
        return;
      }
    } else {
      positive = layer.querySelector("#cqgPrompt").value.trim();
      if (!positive) { toast(t("create_describe_something_first")); return; }
      negative = layer.querySelector("#cqgNegative").value.trim();
      sampler = selectedSampler;
      scheduler = selectedScheduler;
      steps = parseInt(layer.querySelector("#cqgSteps").value, 10) || 20;
      cfg = parseFloat(layer.querySelector("#cqgCfg").value) || 7.0;
      goBtn.disabled = true;
    }
    const token = (genToken += 1);
    setGoBusy(goBtn, true);
    const body = {
      positive, negative, sampler, scheduler, steps, cfg,
      checkpoint: selectedCheckpoint,
      loras: loras.length ? getLoraPickerValues("cqgLoras") : [],
      width, height,
      architecture,
    };
    if (refDataUrl) { body.reference_image = refDataUrl; body.denoise = Number(denoise.value); }
    setGenPreviewBox("cqgPreviewBox", { busy: true });
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
        if (ev.type === "preview") {
          setGenPreviewBox("cqgPreviewBox", { busy: true, image: ev.image });
        } else if (ev.type === "done") {
          setGenPreviewBox("cqgPreviewBox", { image: ev.image });
          lastImage = ev.image;
          layer.querySelector("#cqgUse").style.display = "";
          const upscaleRow = layer.querySelector("#cqgUpscaleRow");
          if (upscaleRow) upscaleRow.style.display = "block";
        } else if (ev.type === "error") {
          errorToast(ev.message || t("create_generation_failed"));
        }
      });
    } catch (err) {
      if (token === genToken) errorToast(err.message || t("create_generation_failed"));
    }
    if (token === genToken) setGoBusy(goBtn, false);
  };
  const upscaleGoBtn = layer.querySelector("#cqgUpscaleGo");
  if (upscaleGoBtn) {
    upscaleGoBtn.onclick = async () => {
      if (!lastImage) return;
      upscaleGoBtn.disabled = true;
      upscaleGoBtn.textContent = t("create_upscaling_button");
      try {
        const res = await fetch(`${API}/api/imagegen/upscale/stream`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: lastImage, upscaler: selectedUpscaler }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        await sseEvents(res, (ev) => {
          if (ev.type === "preview" || ev.type === "done") {
            lastImage = ev.image;
            setGenPreviewBox("cqgPreviewBox", { busy: ev.type === "preview", image: lastImage });
          } else if (ev.type === "error") {
            errorToast(ev.message || t("create_upscale_failed"));
          }
        });
      } catch (err) {
        errorToast(err.message || t("create_upscale_failed"));
      }
      upscaleGoBtn.disabled = false;
      upscaleGoBtn.textContent = t("create_upscale_button");
    };
  }
  layer.querySelector("#cqgUse").onclick = () => {
    if (!lastImage) return;
    closeModal(layer);
    onUse(lastImage);
  };
}

class WorkshopCharactersFormView {
  constructor(editId = null) {
    this.editId = editId || null;
    this.isEdit = !!editId;
    this.sourceTab = "manual";
    this.mode = "character";
    this.avatar = "";
    this.avatarBlob = null;
    this.banner = "";
    this.bannerBlob = null;
    this.name = "";
    this.description = "";
    this.appearanceTags = "";
    this.appearanceTagsNegative = "";
    this.persona = "";
    this.scenario = "";
    this.greeting = "";
    this.dialogue = "";
    this.systemPrompt = "";
    this.tags = [];
    this.creator = "you";
    this.altGreetings = [];
    this.isPublic = false;
    this.canBePersona = false;
    this.allowDownload = false;
    this.isExplicit = false;
    this.presentationHtmlValue = "";
    this.stageBg = "";
    this.stageMusic = "";
    this.stageSprite = "";
    this.moods = [];
    this.stageOpen = false;
    this.presOpen = false;
    this.loreViewMode = "list";
    this.pendingLore = [];
    this.genDescription = "";
    this.saving = false;
    this.draftId = null;
    this.autosaveTimer = null;
    this.lastAutosaveSerialized = null;
    this.autosaveFailCount = 0;
    this.autosaveBroken = false;
    this.importing = false;
    this.reimporting = false;
  }

  async mount(main) {
    this.main = main;
    window._activeCreateView = this;
    if (this.isEdit) {
      await this.loadForEdit();
      this.render();
      return;
    }
    if (window.tutorialEngine?.active) {
      this.render();
      return;
    }
    await this.offerDraftResume();
    this.render();
    this.startAutosave();
  }

  async loadForEdit() {
    let c;
    try {
      c = await api(`/api/characters/${encodeURIComponent(this.editId)}`);
    } catch (err) {
      errorToast(err.message || t("create_couldnt_load_character"));
      navigate("/workshop/characters");
      return;
    }
    this.draftId = c.id;
    this.name = c.name === "Unnamed" ? "" : (c.name || "");
    this.description = c.description || "";
    this.appearanceTags = c.appearance_tags || "";
    this.appearanceTagsNegative = c.appearance_tags_negative || "";
    this.persona = c.persona || "";
    this.scenario = c.scenario || "";
    this.greeting = c.greeting || "";
    this.dialogue = c.dialogue || "";
    this.systemPrompt = c.system_prompt || "";
    this.tags = c.tags || [];
    this.creator = c.creator || "you";
    this.altGreetings = c.alt_greetings || [];
    this.mode = c.mode || "character";
    this.isPublic = !!c.is_public;
    this.presentationHtmlValue = c.presentation_html || "";
    this.canBePersona = !!c.can_be_persona;
    this.allowDownload = !!c.allow_download;
    this.isExplicit = !!c.is_explicit;
    this.avatar = c.avatar || "";
    const assets = c.assets || {};
    this.banner = assets.banner || "";
    this.stageBg = assets.stage?.default || "";
    this.stageMusic = assets.music?.default || "";
    this.stageSprite = assets.sprites?.default || "";
    this.moods = assets.moods || [];
  }

  async offerDraftResume() {
    let drafts = [];
    try {
      drafts = await api("/api/characters?scope=drafts");
    } catch {
      return;
    }
    if (!drafts.length) return;
    const draft = drafts[0];
    if (await confirmDialog(`Discard your unfinished character "${draft.name || t("create_unnamed_fallback")}" and start a new one?`, { confirmLabel: t("create_discard_start_new_button"), cancelLabel: t("create_continue_draft_button"), danger: true })) {
      api(`/api/characters/${encodeURIComponent(draft.id)}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    this.draftId = draft.id;
    this.name = draft.name === "Unnamed" ? "" : (draft.name || "");
    this.description = draft.description || "";
    this.appearanceTags = draft.appearance_tags || "";
    this.appearanceTagsNegative = draft.appearance_tags_negative || "";
    this.persona = draft.persona || "";
    this.scenario = draft.scenario || "";
    this.greeting = draft.greeting || "";
    this.dialogue = draft.dialogue || "";
    this.systemPrompt = draft.system_prompt || "";
    this.tags = draft.tags || [];
    this.creator = draft.creator || "you";
    this.altGreetings = draft.alt_greetings || [];
    this.mode = draft.mode || "character";
    this.isPublic = !!draft.is_public;
    this.presentationHtmlValue = draft.presentation_html || "";
    this.canBePersona = !!draft.can_be_persona;
    this.allowDownload = !!draft.allow_download;
    this.isExplicit = !!draft.is_explicit;
    this.avatar = draft.avatar || "";
    const assets = draft.assets || {};
    this.stageBg = assets.stage?.default || "";
    this.stageMusic = assets.music?.default || "";
    this.stageSprite = assets.sprites?.default || "";
    this.moods = assets.moods || [];
  }

  startAutosave() {
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = setInterval(() => this.autosaveNow(), 5000);
  }

  stopAutosave() {
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  async autosaveNow() {
    if (!document.body.contains(this.main)) { this.stopAutosave(); return; }
    if (this.saving) return;
    const body = this.buildBody();
    if (!body.name.trim() && !body.description.trim() && !body.persona.trim()) return;
    const serialized = JSON.stringify(body);
    if (serialized === this.lastAutosaveSerialized) return;
    const draftBody = { ...body, is_draft: true };
    try {
      if (this.draftId) {
        await api(`/api/characters/${encodeURIComponent(this.draftId)}`, { method: "PUT", body: JSON.stringify(draftBody) });
      } else {
        const created = await api("/api/characters", { method: "POST", body: JSON.stringify(draftBody) });
        this.draftId = created.id;
      }
      this.lastAutosaveSerialized = serialized;
      this.autosaveFailCount = 0;
      if (this.autosaveBroken) { this.autosaveBroken = false; this.render(); }
    } catch (err) {
      console.error("Autosave failed:", err);
      this.autosaveFailCount++;
      if (this.autosaveFailCount >= 2 && !this.autosaveBroken) {
        this.autosaveBroken = true;
        this.render();
      }
    }
  }

  fieldLabel(label, hint) {
    return `<label class="grimoire-field-label">${label}${hint ? ` <span style="text-transform:none;letter-spacing:0;color:var(--color-sec);font-family:var(--font-sans)">${hint}</span>` : ""}</label>`;
  }

  macroRow(field) {
    return `
      <div style="display:flex;gap:6px;margin-top:6px">
        <button type="button" class="filter-chip" onclick="_activeCreateView.insertMacro('${field}','{{user}}')">+ {{user}}</button>
        <button type="button" class="filter-chip" onclick="_activeCreateView.insertMacro('${field}','{{char}}')">+ {{char}}</button>
      </div>
    `;
  }

  insertMacro(field, macro) {
    const el = this.main.querySelector(`#cf_${field}`);
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + macro + el.value.slice(end);
    this[field] = el.value;
    el.focus();
    const caret = start + macro.length;
    el.setSelectionRange(caret, caret);
  }

  sourceTabsHtml() {
    return `
      <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;margin-bottom:16px">
        <button type="button" class="filter-chip${this.sourceTab === "manual" ? " on" : ""}" onclick="_activeCreateView.sourceTab='manual';_activeCreateView.render()">${t("create_manual_tab")}</button>
        <button type="button" class="filter-chip${this.sourceTab === "generate" ? " on" : ""}" onclick="_activeCreateView.sourceTab='generate';_activeCreateView.render()">${t("create_generate_tab")}</button>
        <button type="button" class="filter-chip${this.sourceTab === "import" ? " on" : ""}" onclick="_activeCreateView.sourceTab='import';_activeCreateView.render()">${t("create_import_tab")}</button>
      </div>
    `;
  }

  generateTabHtml() {
    if (this.sourceTab !== "generate") return "";
    return `
      <div style="margin-bottom:20px">
        ${this.fieldLabel(t("create_describe_character_label"), t("create_describe_character_hint"))}
        <textarea id="cf_genDescription" class="grimoire-field-textarea" rows="4" placeholder="${t("create_describe_character_placeholder")}">${_esc(this.genDescription)}</textarea>
        <button type="button" class="pe-gen-btn" id="cgGoBtn" style="margin-top:10px">${t("create_generate_button")}</button>
      </div>
    `;
  }

  importTabHtml() {
    if (this.sourceTab !== "import") return "";
    return `
      <div style="margin-bottom:20px;padding:24px;border:1.5px dashed var(--color-line-2);border-radius:14px;text-align:center;cursor:${this.importing ? "default" : "pointer"};${this.importing ? "pointer-events:none;opacity:.6" : ""}" id="cImportDrop">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;color:var(--color-accent)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div style="font-size:13.5px;color:var(--color-sec)">${this.importing ? t("create_importing_label") : t("create_drop_card_label")}</div>
        <input type="file" id="cImportFile" accept=".png,.json" hidden>
      </div>
    `;
  }

  avatarBannerHtml() {
    const avaInner = this.avatar
      ? `<img src="${this.avatar}" style="width:100%;height:100%;object-fit:cover" id="cAvaImg" alt=""><span class="grimoire-img-clear" role="button" aria-label="Clear image" tabindex="0" onclick="event.stopPropagation();_activeCreateView.avatar='';_activeCreateView.avatarBlob=null;_activeCreateView.render()">&times;</span>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    const bannerInner = this.banner
      ? `<img src="${this.banner}" style="width:100%;height:100%;object-fit:cover" alt=""><span class="grimoire-img-clear" role="button" aria-label="Clear image" tabindex="0" onclick="event.stopPropagation();_activeCreateView.banner='';_activeCreateView.bannerBlob=null;_activeCreateView.render()">&times;</span>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    return `
      <div class="mf-avatar-banner-row" style="margin-bottom:20px">
        <div>
          ${this.fieldLabel(t("create_avatar_label"), t("create_avatar_hint"))}
          <div class="grimoire-img-box" id="cAvaBox" style="width:96px;height:96px;border-radius:14px">${avaInner}</div>
          <input type="file" id="cAvaFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          <button type="button" class="pe-gen-btn" id="cAvaGen" style="margin-top:8px;font-size:11px;padding:6px 10px">${t("create_generate_button")}</button>
          ${this.avatarBlob ? `<p style="color:var(--color-sec);font-size:11px;margin-top:6px;max-width:120px">${t("create_image_not_saved_until_create")}</p>` : ""}
        </div>
        <div style="flex:1">
          ${this.fieldLabel(t("create_banner_label"), t("create_banner_hint"))}
          <div class="grimoire-img-box" id="cBannerBox" style="width:100%;height:96px;border-radius:14px">${bannerInner}</div>
          <input type="file" id="cBannerFile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          <button type="button" class="pe-gen-btn" id="cBannerGen" style="margin-top:8px;font-size:11px;padding:6px 10px">${t("create_generate_button")}</button>
          ${this.bannerBlob ? `<p style="color:var(--color-sec);font-size:11px;margin-top:6px">${t("create_image_not_saved_until_create")}</p>` : ""}
        </div>
      </div>
    `;
  }

  _appearanceTagPillsHtml(text, kind) {
    const list = (text || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!list.length) return "";
    return `<div class="ig-tags-wrap" style="margin-top:6px">${list.map((tg) => `<span class="ig-tag ${kind === "pos" ? "ig-tag-pos" : "ig-tag-neg"}">${_esc(tg)}</span>`).join("")}</div>`;
  }

  appearanceTagsHtml() {
    return `
      <div style="margin-bottom:16px">
        ${this.fieldLabel(t("create_appearance_tags_label"), t("create_appearance_tags_hint"))}
        <textarea id="cf_appearanceTags" class="grimoire-field-textarea" rows="2" placeholder="${t("create_appearance_tags_placeholder")}">${_esc(this.appearanceTags)}</textarea>
        <div id="cfAppearanceTagsPreview">${this._appearanceTagPillsHtml(this.appearanceTags, "pos")}</div>
      </div>
      <div style="margin-bottom:16px">
        ${this.fieldLabel(t("create_appearance_tags_negative_label"), t("create_appearance_tags_negative_hint"))}
        <textarea id="cf_appearanceTagsNegative" class="grimoire-field-textarea" rows="2" placeholder="${t("create_appearance_tags_negative_placeholder")}">${_esc(this.appearanceTagsNegative)}</textarea>
        <div id="cfAppearanceTagsNegativePreview">${this._appearanceTagPillsHtml(this.appearanceTagsNegative, "neg")}</div>
      </div>
    `;
  }

  tagsHtml() {
    return `
      <div style="margin-bottom:20px">
        ${this.fieldLabel(t("create_tags_label"), t("create_tags_hint"))}
        <div id="cTagsBox" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
          ${this.tags.map((tg) => `<span class="inline-pill pill-tag">#${_esc(tg)}<span class="x" data-remove-ctag="${_esc(tg)}">&times;</span></span>`).join("")}
          <input type="text" id="cf_tagInput" placeholder="${t("create_tag_input_placeholder")}" style="flex:1;min-width:120px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
        </div>
      </div>
    `;
  }

  altGreetingsHtml() {
    return `
      <div style="margin-bottom:20px">
        ${this.fieldLabel(t("create_alt_greetings_label"), t("create_alt_greetings_hint"))}
        <div id="cAltGreets">
          ${this.altGreetings.map((g, i) => `
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <textarea class="grimoire-field-textarea" rows="2" data-alt-idx="${i}" style="flex:1">${_esc(g)}</textarea>
              <button type="button" class="forge-img-act" style="position:static;background:var(--color-warn)" onclick="_activeCreateView.removeAltGreeting(${i})">&times;</button>
            </div>
          `).join("")}
        </div>
        <button type="button" class="filter-chip" id="cAddAltGreet">${t("create_add_greeting_button")}</button>
      </div>
    `;
  }

  stageHtml() {
    return `
      <div style="margin-bottom:16px;border:1px solid var(--color-line);border-radius:14px;overflow:hidden">
        <button type="button" onclick="_activeCreateView.stageOpen=!_activeCreateView.stageOpen;_activeCreateView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink)">
          <span style="flex:1;text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted)">${t("create_visual_novel_stage_heading")}</span>
          <span style="transform:rotate(${this.stageOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${this.stageOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line)">
            <p style="font-size:12px;color:var(--color-sec);margin:0 0 14px">${t("create_stage_section_hint")}</p>
            ${this.fieldLabel(t("create_background_url_label"), t("create_background_url_hint"))}
            <input type="text" id="cf_stageBg" class="grimoire-field-input" value="${_esc(this.stageBg)}" placeholder="https://…/room.jpg" style="margin-bottom:14px">
            ${this.fieldLabel(t("create_music_url_label"), t("create_music_url_hint"))}
            <input type="text" id="cf_stageMusic" class="grimoire-field-input" value="${_esc(this.stageMusic)}" placeholder="https://…/theme.mp3" style="margin-bottom:14px">
            ${this.fieldLabel(t("create_sprite_url_label"), t("create_sprite_url_hint"))}
            <input type="text" id="cf_stageSprite" class="grimoire-field-input" value="${_esc(this.stageSprite)}" placeholder="https://…/neutral.png" style="margin-bottom:14px">
            ${this.fieldLabel(t("create_moods_label"), t("create_moods_hint"))}
            <div id="cMoodRows">
              ${this.moods.map((m, i) => `
                <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                  <input type="text" data-mood-field="name" data-mood-idx="${i}" value="${_esc(m.name || "")}" placeholder="${t("create_mood_placeholder")}" class="grimoire-field-input" style="flex:1;min-width:70px">
                  <input type="text" data-mood-field="bg" data-mood-idx="${i}" value="${_esc(m.bg || "")}" placeholder="${t("create_mood_bg_placeholder")}" class="grimoire-field-input" style="flex:1;min-width:70px">
                  <input type="text" data-mood-field="music" data-mood-idx="${i}" value="${_esc(m.music || "")}" placeholder="${t("create_mood_music_placeholder")}" class="grimoire-field-input" style="flex:1;min-width:70px">
                  <input type="text" data-mood-field="sprite" data-mood-idx="${i}" value="${_esc(m.sprite || "")}" placeholder="${t("create_mood_sprite_placeholder")}" class="grimoire-field-input" style="flex:1;min-width:70px">
                  <button type="button" class="forge-img-act" style="position:static;background:var(--color-warn)" onclick="_activeCreateView.removeMood(${i})">&times;</button>
                </div>
              `).join("")}
            </div>
            <button type="button" class="filter-chip" id="cAddMood">${t("create_add_mood_button")}</button>
          </div>
        ` : ""}
      </div>
    `;
  }

  presentationHtml() {
    return `
      <div style="margin-bottom:20px;border:1px solid var(--color-line);border-radius:14px;overflow:hidden">
        <button type="button" onclick="_activeCreateView.presOpen=!_activeCreateView.presOpen;_activeCreateView.render()" style="width:100%;display:flex;align-items:center;gap:9px;padding:13px 14px;background:var(--color-surface);border:none;cursor:pointer;color:var(--color-ink)">
          <span style="flex:1;text-align:left;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--color-muted)">${t("create_custom_page_heading")}</span>
          <span style="transform:rotate(${this.presOpen ? "90deg" : "0deg"});transition:transform .2s;color:var(--color-muted)">&rsaquo;</span>
        </button>
        ${this.presOpen ? `
          <div style="padding:14px;border-top:1px solid var(--color-line)">
            <p style="font-size:12px;color:var(--color-sec);margin:0 0 12px">${t("create_custom_page_hint")}</p>
            <textarea id="cf_presentationHtml" class="grimoire-field-textarea" rows="6" placeholder="&lt;div class=&quot;my-card&quot;&gt;…&lt;/div&gt;">${_esc(this.presentationHtmlValue)}</textarea>
            <label class="grimoire-field-label" style="margin-top:12px">${t("create_preview_label")}</label>
            <div id="cPresPreview" style="border:1px solid var(--color-line);border-radius:10px;min-height:60px;padding:8px"></div>
          </div>
        ` : ""}
      </div>
    `;
  }

  loreHtml() {
    return `
      ${this.pendingLore.length ? `
        <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;width:fit-content;margin-bottom:14px">
          <button type="button" class="filter-chip${this.loreViewMode === "list" ? " on" : ""}" id="cLoreModeList">${t("grimoire_list_tab")}</button>
          <button type="button" class="filter-chip${this.loreViewMode === "web" ? " on" : ""}" id="cLoreModeWeb">${t("grimoire_web_tab")}</button>
        </div>
      ` : ""}
      ${this.loreViewMode === "web" && this.pendingLore.length ? `<div id="cLoreWebMount"></div>` : `
        <div id="cLoreRows">
          ${this.pendingLore.map((l, i) => `
            <div style="margin-bottom:14px;padding:12px;border:1px solid var(--color-line-2);border-radius:12px">
              <div style="display:flex;gap:8px;margin-bottom:8px">
                <input type="text" data-lore-field="name" data-lore-idx="${i}" value="${_esc(l.name || "")}" placeholder="${t("create_lore_name_placeholder")}" class="grimoire-field-input" style="flex:1">
                <input type="text" data-lore-field="category" data-lore-idx="${i}" value="${_esc(l.category || "")}" placeholder="${t("create_lore_category_placeholder")}" class="grimoire-field-input" style="flex:1">
                <button type="button" class="forge-img-act" style="position:static;background:var(--color-warn)" onclick="_activeCreateView.removeLoreEntry(${i})">&times;</button>
              </div>
              <input type="text" data-lore-field="keys" data-lore-idx="${i}" value="${_esc((l.keys || []).join(", "))}" placeholder="${t("create_lore_keys_placeholder")}" class="grimoire-field-input" style="margin-bottom:8px">
              <textarea data-lore-field="content" data-lore-idx="${i}" rows="3" placeholder="${t("create_lore_content_placeholder")}" class="grimoire-field-textarea" style="margin-bottom:8px">${_esc(l.content || "")}</textarea>
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-ink)">
                <input type="checkbox" data-lore-field="always" data-lore-idx="${i}" ${l.always ? "checked" : ""}>
                ${t("create_lore_always_active_label")}
              </label>
            </div>
          `).join("")}
        </div>
      `}
      <button type="button" class="filter-chip" id="cAddLore">${t("create_add_lore_entry_button")}</button>
    `;
  }

  manualFieldsHtml() {
    return `
      <div class="mf-identity">
        ${this.identitySectionHeadHtml("1", t("create_identity_section_title"), t("create_identity_section_desc"))}
        ${this.avatarBannerHtml()}
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_name_label"), t("create_name_hint"))}<input type="text" id="cf_name" class="grimoire-field-input" value="${_esc(this.name)}" placeholder="e.g. Maeve"></div>
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_description_label"), t("create_description_hint"))}<textarea id="cf_description" class="grimoire-field-textarea" rows="2">${_esc(this.description)}</textarea></div>
        ${this.appearanceTagsHtml()}
        ${this.tagsHtml()}
        <div style="margin-bottom:0">${this.fieldLabel(t("create_creator_label"), t("create_creator_hint"))}<input type="text" id="cf_creator" class="grimoire-field-input" value="${_esc(this.creator)}"></div>
      </div>
      <div class="mf-personality">
        ${this.identitySectionHeadHtml("2", t("create_personality_section_title"), t("create_personality_section_desc"))}
        <div style="margin-bottom:16px">
          <div class="mf-subdesc">${t("create_mode_explanation")}</div>
          <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px">
            <button type="button" class="filter-chip${this.mode === "character" ? " on" : ""}" onclick="_activeCreateView.mode='character';_activeCreateView.render()">${t("create_mode_character_option")}</button>
            <button type="button" class="filter-chip${this.mode === "rpg" ? " on" : ""}" onclick="_activeCreateView.mode='rpg';_activeCreateView.render()">${t("create_mode_rpg_option")}</button>
          </div>
        </div>
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_persona_label"), t("create_persona_hint"))}<textarea id="cf_persona" class="grimoire-field-textarea" rows="6">${_esc(this.persona)}</textarea>${this.macroRow("persona")}</div>
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_scenario_label"), t("create_scenario_hint"))}<textarea id="cf_scenario" class="grimoire-field-textarea" rows="3">${_esc(this.scenario)}</textarea>${this.macroRow("scenario")}</div>
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_opening_message_label"), t("create_opening_message_hint"))}<textarea id="cf_greeting" class="grimoire-field-textarea" rows="4">${_esc(this.greeting)}</textarea>${this.macroRow("greeting")}</div>
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_example_dialogue_label"), t("create_example_dialogue_hint"))}<textarea id="cf_dialogue" class="grimoire-field-textarea" rows="4" placeholder="&lt;START&gt;&#10;{{user}}: Hello.&#10;{{char}}: *smiles* Hello yourself.&#10;&#10;&lt;START&gt;&#10;{{user}}: Where were you?&#10;{{char}}: *shrugs* Around.">${_esc(this.dialogue)}</textarea>${this.macroRow("dialogue")}</div>
        <div style="margin-bottom:16px">${this.fieldLabel(t("create_system_prompt_override_label"), t("create_system_prompt_override_hint"))}<textarea id="cf_systemPrompt" class="grimoire-field-textarea" rows="3">${_esc(this.systemPrompt)}</textarea>${this.macroRow("systemPrompt")}</div>
        ${this.altGreetingsHtml()}
        ${this.stageHtml()}
        ${this.presentationHtml()}
        ${this.isEdit ? this.reimportHtml() : ""}
      </div>
      <div class="mf-lore">
        ${this.identitySectionHeadHtml("3", t("create_lore_section_title"), t("create_lore_section_desc"))}
        <div style="padding:14px 16px">
          ${this.loreHtml()}
        </div>
      </div>
      <div class="mf-sharing">
        ${this.identitySectionHeadHtml("4", t("create_sharing_section_title"), "")}
        <div style="padding:14px 16px 4px">
          ${this.toggleRowHtml("cf_isPublic", t("create_share_to_community_label"), t("create_share_to_community_hint"), this.isPublic)}
          ${this.mode === "character" ? this.toggleRowHtml("cf_canBePersona", t("create_let_others_play_as_label"), t("create_let_others_play_as_hint"), this.canBePersona) : ""}
          ${this.toggleRowHtml("cf_allowDownload", t("create_allow_download_label"), t("create_allow_download_hint"), this.allowDownload)}
          ${this.toggleRowHtml("cf_isExplicit", t("create_contains_mature_content_label"), t("create_contains_mature_content_hint"), this.isExplicit)}
        </div>
        <div style="padding:16px">
          <div class="grimoire-field-label" style="margin-bottom:8px">${t("create_live_preview_label")}</div>
          <p style="margin:0 0 12px;color:var(--color-muted);font-size:12.5px;line-height:1.5">${t("create_live_preview_hint")}</p>
          ${this.previewCardHtml()}
          ${this.autosaveBroken ? `<p style="color:var(--color-warn);font-size:12px;margin-top:10px">${t("create_not_saving_check_connection")}</p>` : ""}
          <button type="button" class="forge-generate-btn" id="cSaveBtn" data-feature="characters" style="margin-top:14px">${this.saving ? t("create_saving_button") : (this.isEdit ? t("create_save_changes_button") : t("create_create_character_button"))}</button>
          ${this.isEdit ? `
            <button type="button" id="cCancelBtn" style="width:100%;margin-top:10px;padding:11px;border-radius:10px;border:1px solid var(--color-line-2);background:transparent;color:var(--color-ink);font-size:13.5px;font-weight:600;cursor:pointer">${t("create_cancel_button")}</button>
            <button type="button" id="cDeleteBtn" style="width:100%;margin-top:8px;padding:11px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--color-warn);font-size:13px;cursor:pointer">${t("create_delete_character_button")}</button>
          ` : ""}
        </div>
      </div>
    `;
  }

  cancelEdit() {
    navigate(`/c/${this.editId}`);
  }

  async deleteCharacter() {
    if (!(await confirmDialog(`${t("create_delete_character_confirm_prefix")} "${this.name || t("create_this_character_fallback")}"? ${t("create_cant_be_undone_suffix")}`, { confirmLabel: t("create_delete_button"), cancelLabel: t("create_cancel_button"), danger: true }))) return;
    try {
      await api(`/api/characters/${encodeURIComponent(this.editId)}`, { method: "DELETE" });
      toast(t("create_deleted_toast"));
      navigate("/workshop/characters");
    } catch (err) {
      toast(err.message || t("create_couldnt_delete_character"));
    }
  }

  toggleRowHtml(id, label, desc, checked) {
    return `
      <div class="grimoire-toggle-row">
        <span>
          <span style="display:block;font-size:14px;color:var(--color-ink)">${_esc(label)}</span>
          <span class="mf-subdesc" style="margin-top:2px">${_esc(desc)}</span>
        </span>
        <input type="checkbox" id="${id}" ${checked ? "checked" : ""} style="flex-shrink:0;margin-left:12px">
      </div>
    `;
  }

  identitySectionHeadHtml(num, name, desc) {
    return `
      <div class="mf-section-head">
        <span class="mf-section-num">${num}</span>
        <span class="mf-section-name">${_esc(name)}</span>
        ${desc ? `<span class="mf-section-desc">${_esc(desc)}</span>` : ""}
      </div>
    `;
  }

  reimportHtml() {
    return `
      <div style="margin:0 0 20px;padding:14px;border:1px solid var(--color-line);border-radius:14px">
        <p style="font-size:12px;color:var(--color-sec);margin:0 0 10px">${t("create_reimport_hint")}</p>
        <button type="button" class="filter-chip" id="cReimportBtn">${this.reimporting ? t("create_reimporting_button") : t("create_reimport_from_file_button")}</button>
        <input type="file" id="cReimportFile" accept=".png,.json" hidden>
      </div>
    `;
  }

  removeAltGreeting(i) { this.altGreetings = this.altGreetings.filter((_, j) => j !== i); this.render(); }
  removeMood(i) { this.moods = this.moods.filter((_, j) => j !== i); this.render(); }
  removeLoreEntry(i) { this.pendingLore = this.pendingLore.filter((_, j) => j !== i); this.render(); }

  async applyGeneratedFields(data) {
    this.name = data.name || this.name;
    this.description = data.description || this.description;
    this.persona = data.persona || this.persona;
    this.scenario = data.scenario || this.scenario;
    this.greeting = data.greeting || this.greeting;
    this.dialogue = data.dialogue || this.dialogue;
    this.systemPrompt = data.system_prompt || this.systemPrompt;
    this.tags = data.tags && data.tags.length ? data.tags : this.tags;
    this.mode = data.mode || this.mode;
    this.altGreetings = data.alt_greetings && data.alt_greetings.length ? data.alt_greetings : this.altGreetings;
    this.presentationHtmlValue = data.presentation_html || this.presentationHtmlValue;
    if (data.is_explicit) this.isExplicit = true;
    if (data.assets) {
      this.stageBg = (data.assets.stage || {}).default || this.stageBg;
      this.stageMusic = (data.assets.music || {}).default || this.stageMusic;
      this.stageSprite = (data.assets.sprites || {}).default || this.stageSprite;
    }
    if (data.avatar_data_url) {
      this.avatar = data.avatar_data_url;
      try {
        this.avatarBlob = await (await fetch(data.avatar_data_url)).blob();
      } catch (err) {
        errorToast(err.message || t("create_couldnt_process_generated_avatar"));
      }
    }
    if (data.lore) this.pendingLore = data.lore;
    this.sourceTab = "manual";
    this.render();
  }

  async runGenerate() {
    const desc = this.main.querySelector("#cf_genDescription").value.trim();
    if (!desc) { toast(t("create_describe_character_first")); return; }
    const btn = this.main.querySelector("#cgGoBtn");
    btn.disabled = true;
    btn.textContent = t("create_generating_button");
    try {
      const data = await api("/api/characters/generate-from-description", { method: "POST", body: JSON.stringify({ description: desc }) });
      toast(t("create_fields_filled_review_save"));
      await this.applyGeneratedFields(data);
    } catch (err) {
      errorToast(err.message || t("create_generation_failed"));
    }
    if (btn) { btn.disabled = false; btn.textContent = t("create_generate_button"); }
  }

  async runImport(file) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    this.importing = true;
    this.render();
    try {
      const data = await api("/api/characters/import", { method: "POST", body: fd });
      toast(t("create_card_imported_review_save"));
      await this.applyGeneratedFields(data);
    } catch (err) {
      errorToast(err.message || t("create_couldnt_read_card"));
    } finally {
      this.importing = false;
      this.render();
    }
  }

  buildBody() {
    return {
      name: this.name.trim() || "Unnamed",
      description: this.description.trim(),
      appearance_tags: this.appearanceTags.trim(),
      appearance_tags_negative: this.appearanceTagsNegative.trim(),
      persona: this.persona.trim(),
      scenario: this.scenario.trim(),
      greeting: this.greeting.trim(),
      dialogue: this.dialogue.trim(),
      system_prompt: this.systemPrompt.trim(),
      tags: this.tags,
      creator: this.creator.trim() || "you",
      alt_greetings: this.altGreetings.filter((g) => g.trim()),
      mode: this.mode,
      assets: {
        ...(this.banner && !this.banner.startsWith("data:") ? { banner: this.banner } : {}),
        stage: this.stageBg ? { default: this.stageBg } : {},
        music: this.stageMusic ? { default: this.stageMusic } : {},
        sprites: this.stageSprite ? { default: this.stageSprite } : {},
        moods: this.moods.filter((m) => m.name),
      },
      is_public: this.isPublic,
      presentation_html: this.presentationHtmlValue.trim(),
      can_be_persona: this.mode === "character" ? this.canBePersona : false,
      allow_download: this.allowDownload,
      is_explicit: this.isExplicit,
      avatar: this.avatar && !this.avatar.startsWith("data:") ? this.avatar : "",
    };
  }

  async save() {
    if (this.saving) return;
    if (!this.name.trim()) {
      toast(t("create_name_required"));
      const nameEl = this.main.querySelector("#cf_name");
      if (nameEl) { nameEl.style.borderColor = "var(--color-warn)"; nameEl.focus(); }
      return;
    }
    this.saving = true;
    this.stopAutosave();
    this.render();
    let char;
    const finalBody = { ...this.buildBody(), is_draft: false };
    try {
      char = this.draftId
        ? await api(`/api/characters/${encodeURIComponent(this.draftId)}`, { method: "PUT", body: JSON.stringify(finalBody) })
        : await api("/api/characters", { method: "POST", body: JSON.stringify(finalBody) });
    } catch (err) {
      let message = err.message || t("create_couldnt_create_character");
      if (Array.isArray(err.detail) && err.detail.length > 0 && err.detail[0].msg) {
        message = err.detail[0].msg;
      }
      errorToast(message);
      this.saving = false;
      this.startAutosave();
      this.render();
      return;
    }
    const failures = [];
    if (this.avatarBlob) {
      const fd = new FormData();
      fd.append("file", this.avatarBlob, "avatar.png");
      try {
        const r = await api(`/api/characters/${encodeURIComponent(char.id)}/avatar`, { method: "POST", body: fd });
        this.avatar = r.avatar;
      }
      catch (err) { failures.push(t("create_avatar_failure_word")); console.error("avatar upload failed:", err); }
    }
    if (this.bannerBlob) {
      const fd = new FormData();
      fd.append("file", this.bannerBlob, "banner.png");
      try {
        const r = await api(`/api/characters/${encodeURIComponent(char.id)}/media`, { method: "POST", body: fd });
        await api(`/api/characters/${encodeURIComponent(char.id)}`, {
          method: "PUT",
          body: JSON.stringify({ ...this.buildBody(), assets: { ...this.buildBody().assets, banner: r.url } }),
        });
      } catch (err) { failures.push(t("create_banner_failure_word")); console.error("banner upload failed:", err); }
    }
    let loreFailures = 0;
    for (const lore of this.pendingLore) {
      try {
        await api(`/api/characters/${encodeURIComponent(char.id)}/lore`, {
          method: "POST",
          body: JSON.stringify({
            keys: lore.keys || [], content: lore.content || "", always: !!lore.always,
            category: lore.category || "", name: lore.name || "",
            appearance_tags: lore.appearance_tags || "", appearance_tags_negative: lore.appearance_tags_negative || "",
            image_data: lore.image_data || null,
          }),
        });
      } catch (err) {
        loreFailures++;
        console.error("lore entry upload failed:", err);
      }
    }
    if (loreFailures) failures.push(`${loreFailures} ${loreFailures === 1 ? t("create_lore_entry_word") : t("create_lore_entries_word")}`);
    if (failures.length) {
      const savedOrCreated = this.isEdit ? t("create_character_saved_word") : t("create_character_created_word");
      errorToast(`${savedOrCreated}, ${failures.join(", ")} ${t("create_failed_to_save_retry_suffix")}`);
    } else {
      toast(this.isEdit ? t("create_character_saved_toast") : t("create_character_created_toast"));
    }
    navigate(`/c/${char.id}`);
  }

  async runReimport(file) {
    if (!this.draftId) return;
    this.reimporting = true;
    this.render();
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      await api(`/api/characters/${encodeURIComponent(this.draftId)}/reimport`, { method: "POST", body: fd });
      toast(t("create_reimported_fields_refreshed"));
      await this.loadForEdit();
    } catch (err) {
      errorToast(err.message || t("create_couldnt_reimport_card"));
    } finally {
      this.reimporting = false;
      this.render();
    }
  }

  async blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  previewCardHtml() {
    const seed = this.name || "preview";
    const hue = [...seed].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const art = this.avatar
      ? `background-image:url('${_attr(this.avatar)}');background-size:cover;background-position:center`
      : `background:linear-gradient(150deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 45% 16%))`;
    return `
      <div class="char-card" style="--dom:hsl(${hue} 45% 20%);pointer-events:none">
        <div class="char-card-frame">
          <div class="char-card-art" id="createPreviewArt" style="${art}"></div>
          <div class="char-card-fade"></div>
          <div class="char-card-body">
            <div class="char-card-tags" id="createPreviewTags">${(this.tags || []).slice(0, 2).map((t) => `<span class="char-card-tag">#${_esc(t)}</span>`).join("")}</div>
            <h3 class="char-card-title" id="createPreviewName">${_esc(this.name || t("create_unnamed_fallback"))}</h3>
            <p class="char-card-log" id="createPreviewDesc">${_esc(this.description || t("create_description_placeholder_preview"))}</p>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const showManual = this.isEdit || this.sourceTab === "manual";
    this.main.innerHTML = `<div class="content-col create-content">` + (this.isEdit
      ? `
        ${pageHeaderHtml(t("create_workshop_breadcrumb"), t("create_edit_character_title"), t("create_edit_character_title"), `${t("create_editing_prefix")} ${_esc(this.name || t("create_your_character_fallback"))}.`)}
      `
      : `
        ${pageHeaderHtml(t("create_workshop_breadcrumb"), t("create_new_character_title"), t("ph_new_character_title"), t("ph_new_character_sub"))}
        ${this.sourceTabsHtml()}
        ${this.generateTabHtml()}
        ${this.importTabHtml()}
      `) + (showManual
      ? `<div id="createGrid">${this.manualFieldsHtml()}</div>`
      : ""
      ) + `
      </div>
    `;
    this.wireEvents();
  }

  wireEvents() {
    const m = this.main;
    const bind = (id, prop) => { const el = m.querySelector(id); if (el) el.oninput = () => { this[prop] = el.value; }; };
    const nameEl = m.querySelector("#cf_name");
    if (nameEl) nameEl.oninput = () => {
      this.name = nameEl.value;
      nameEl.style.borderColor = "";
      const previewName = m.querySelector("#createPreviewName");
      if (previewName) previewName.textContent = this.name || t("create_unnamed_fallback");
    };
    const descEl = m.querySelector("#cf_description");
    if (descEl) descEl.oninput = () => {
      this.description = descEl.value;
      const previewDesc = m.querySelector("#createPreviewDesc");
      if (previewDesc) previewDesc.textContent = this.description || t("create_description_placeholder_preview");
    };
    const appearEl = m.querySelector("#cf_appearanceTags");
    if (appearEl) appearEl.oninput = () => {
      this.appearanceTags = appearEl.value;
      m.querySelector("#cfAppearanceTagsPreview").innerHTML = this._appearanceTagPillsHtml(this.appearanceTags, "pos");
    };
    const appearNegEl = m.querySelector("#cf_appearanceTagsNegative");
    if (appearNegEl) appearNegEl.oninput = () => {
      this.appearanceTagsNegative = appearNegEl.value;
      m.querySelector("#cfAppearanceTagsNegativePreview").innerHTML = this._appearanceTagPillsHtml(this.appearanceTagsNegative, "neg");
    };
    bind("#cf_persona", "persona");
    bind("#cf_scenario", "scenario");
    bind("#cf_greeting", "greeting");
    bind("#cf_dialogue", "dialogue");
    bind("#cf_creator", "creator");
    bind("#cf_systemPrompt", "systemPrompt");
    bind("#cf_stageBg", "stageBg");
    bind("#cf_stageMusic", "stageMusic");
    bind("#cf_stageSprite", "stageSprite");
    bind("#cf_presentationHtml", "presentationHtmlValue");
    bind("#cf_genDescription", "genDescription");

    const genBtn = m.querySelector("#cgGoBtn");
    if (genBtn) genBtn.onclick = () => this.runGenerate();

    const importDrop = m.querySelector("#cImportDrop");
    const importFile = m.querySelector("#cImportFile");
    if (importDrop && importFile) {
      importDrop.onclick = () => importFile.click();
      importFile.onchange = () => { const f = importFile.files[0]; if (f) this.runImport(f); };
      importDrop.ondragover = (e) => e.preventDefault();
      importDrop.ondrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.runImport(f); };
    }

    const avaBox = m.querySelector("#cAvaBox");
    const avaFile = m.querySelector("#cAvaFile");
    if (avaBox && avaFile) {
      avaBox.onclick = (e) => { if (!e.target.closest(".grimoire-img-clear")) avaFile.click(); };
      avaFile.onchange = () => {
        const f = avaFile.files[0];
        avaFile.value = "";
        if (!f) return;
        maybeCropUpload(f, "1", 512, 512, (dataUrl, blob) => {
          this.avatarBlob = blob;
          this.avatar = dataUrl;
          this.render();
        });
      };
    }
    const avaGen = m.querySelector("#cAvaGen");
    if (avaGen) avaGen.onclick = () => _createQuickGenModal(512, 512, async (dataUrl) => {
      this.avatar = dataUrl;
      this.avatarBlob = await (await fetch(dataUrl)).blob();
      this.render();
    });

    const bannerBox = m.querySelector("#cBannerBox");
    const bannerFile = m.querySelector("#cBannerFile");
    if (bannerBox && bannerFile) {
      bannerBox.onclick = (e) => { if (!e.target.closest(".grimoire-img-clear")) bannerFile.click(); };
      bannerFile.onchange = () => {
        const f = bannerFile.files[0];
        bannerFile.value = "";
        if (!f) return;
        maybeCropUpload(f, "16/9", 1024, 576, (dataUrl, blob) => {
          this.bannerBlob = blob;
          this.banner = dataUrl;
          this.render();
        });
      };
    }
    const bannerGen = m.querySelector("#cBannerGen");
    if (bannerGen) bannerGen.onclick = () => _createQuickGenModal(1024, 576, async (dataUrl) => {
      this.banner = dataUrl;
      this.bannerBlob = await (await fetch(dataUrl)).blob();
      this.render();
    });

    const tagInput = m.querySelector("#cf_tagInput");
    if (tagInput) {
      tagInput.onkeydown = (e) => {
        if (e.key === "Backspace" && tagInput.value === "" && this.tags.length) {
          e.preventDefault();
          this.tags = this.tags.slice(0, -1);
          this.render();
          return;
        }
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        const val = tagInput.value.trim().replace(/\s+/g, "");
        if (val && !this.tags.includes(val)) { this.tags = [...this.tags, val]; this.render(); }
        else {
          if (val) toast(t("create_tag_already_added"));
          tagInput.value = "";
        }
      };
    }
    m.querySelectorAll("[data-remove-ctag]").forEach((x) => {
      x.onclick = () => { this.tags = this.tags.filter((t) => t !== x.dataset.removeCtag); this.render(); };
    });

    m.querySelectorAll("[data-alt-idx]").forEach((el) => {
      el.oninput = () => { this.altGreetings[+el.dataset.altIdx] = el.value; };
    });
    const addAltGreet = m.querySelector("#cAddAltGreet");
    if (addAltGreet) addAltGreet.onclick = () => { this.altGreetings = [...this.altGreetings, ""]; this.render(); };

    m.querySelectorAll("[data-mood-field]").forEach((el) => {
      el.oninput = () => {
        const i = +el.dataset.moodIdx;
        if (!this.moods[i]) this.moods[i] = {};
        this.moods[i][el.dataset.moodField] = el.value;
      };
    });
    const addMood = m.querySelector("#cAddMood");
    if (addMood) addMood.onclick = () => { this.moods = [...this.moods, { name: "", bg: "", music: "", sprite: "" }]; this.render(); };

    m.querySelectorAll("[data-lore-field]").forEach((el) => {
      const i = +el.dataset.loreIdx;
      const field = el.dataset.loreField;
      if (!this.pendingLore[i]) this.pendingLore[i] = {};
      const apply = () => {
        if (field === "keys") this.pendingLore[i].keys = el.value.split(",").map((k) => k.trim()).filter(Boolean);
        else if (field === "always") this.pendingLore[i].always = el.checked;
        else this.pendingLore[i][field] = el.value;
      };
      el.addEventListener(field === "always" ? "change" : "input", apply);
    });
    const addLore = m.querySelector("#cAddLore");
    if (addLore) addLore.onclick = () => {
      this.pendingLore = [...this.pendingLore, { name: "", category: "", keys: [], content: "", always: false }];
      this.render();
    };
    m.querySelector("#cLoreModeList")?.addEventListener("click", () => { this.loreViewMode = "list"; this.render(); });
    m.querySelector("#cLoreModeWeb")?.addEventListener("click", () => { this.loreViewMode = "web"; this.render(); });
    const loreWebMount = m.querySelector("#cLoreWebMount");
    if (loreWebMount && typeof WorkshopLoreWebView !== "undefined") {
      const draftCharId = this.editId || "__draft__";
      const draftEntries = this.pendingLore.map((l, i) => ({
        ...l, id: `draft-${i}`, char_id: draftCharId, outgoing_links: [], incoming_links: [],
      }));
      const webView = new WorkshopLoreWebView(draftEntries, { [draftCharId]: { id: draftCharId, name: this.name || t("create_unnamed_fallback") } });
      webView.mount(loreWebMount);
    }

    const isPublic = m.querySelector("#cf_isPublic");
    if (isPublic) isPublic.onchange = () => { this.isPublic = isPublic.checked; };
    const canBePersona = m.querySelector("#cf_canBePersona");
    if (canBePersona) canBePersona.onchange = () => { this.canBePersona = canBePersona.checked; };
    const allowDownload = m.querySelector("#cf_allowDownload");
    if (allowDownload) allowDownload.onchange = () => { this.allowDownload = allowDownload.checked; };
    const isExplicit = m.querySelector("#cf_isExplicit");
    if (isExplicit) isExplicit.onchange = () => { this.isExplicit = isExplicit.checked; };

    const presEl = m.querySelector("#cf_presentationHtml");
    const presPreview = m.querySelector("#cPresPreview");
    if (presEl && presPreview) {
      const renderPreview = () => mountSandboxedHTML(presPreview, presEl.value, { autoHeight: true });
      renderPreview();
      let presTimer;
      presEl.addEventListener("input", () => { clearTimeout(presTimer); presTimer = setTimeout(renderPreview, 300); });
    }

    const saveBtn = m.querySelector("#cSaveBtn");
    if (saveBtn) saveBtn.onclick = () => this.save();

    const cancelBtn = m.querySelector("#cCancelBtn");
    if (cancelBtn) cancelBtn.onclick = () => this.cancelEdit();

    const deleteBtn = m.querySelector("#cDeleteBtn");
    if (deleteBtn) deleteBtn.onclick = () => this.deleteCharacter();

    const reimportBtn = m.querySelector("#cReimportBtn");
    const reimportFile = m.querySelector("#cReimportFile");
    if (reimportBtn && reimportFile) {
      reimportBtn.onclick = () => reimportFile.click();
      reimportFile.onchange = () => { const f = reimportFile.files[0]; if (f) this.runReimport(f); };
    }
  }
}
