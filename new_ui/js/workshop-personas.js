"use strict";

function _masksEditModal(persona, onSave, opts = {}) {
  const sessionId = opts.sessionId || null;
  const p = persona || { name: "", description: "", gender: "", is_default: false, is_draft: false };
  const isNewMask = !persona;
  let draftPid = persona?.is_draft ? persona.id : null;
  let autosaveTimer = null;
  let finalized = false;
  const personas = window._activeMasksView?.personas || [];
  const otherDefault = personas.find(prs => prs.is_default && prs.id !== persona?.id);
  const showDefaultWarning = !!otherDefault;

  const cleanupDraftIfAbandoned = () => {
    clearInterval(autosaveTimer);
    if (!finalized && isNewMask && draftPid) {
      api(`/api/personas/${encodeURIComponent(draftPid)}`, { method: "DELETE" }).catch(() => {});
    }
  };

  let curAvatar = p.avatar || "";
  const layer = openModal(`
    <h3>${persona ? t("masks_edit_mask_heading") : t("masks_new_mask_heading")}</h3>
    ${sessionId && !persona ? `<p style="font-size:11.5px;color:var(--color-muted);margin:0 0 14px">${t("masks_session_exclusive_hint", "This persona will only be usable in this chat, not elsewhere.")}</p>` : ""}
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("masks_name_label")}</label>
      <input type="text" id="mkName" class="grimoire-field-input" value="${_esc(p.name || "")}" placeholder="e.g. Alex">
    </div>
    <div style="margin-bottom:16px;display:flex;gap:14px;align-items:flex-end">
      <div class="grimoire-img-box" id="mkImgBox">
        ${curAvatar ? `<img id="mkImgPreview" src="${_attr(curAvatar)}" alt=""><span class="grimoire-img-clear" role="button" aria-label="${t("masks_clear_image_label")}" tabindex="0" id="mkImgClear">&times;</span>`
          : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`}
      </div>
      <input type="file" id="mkImgFile" accept="image/png,image/jpeg,image/webp" hidden>
      <button type="button" class="pe-gen-btn" id="mkImgGen">${t("masks_generate_button")}</button>
    </div>
    <div style="margin-bottom:16px">
      <label class="grimoire-field-label">${t("masks_gender_label")}</label>
      <div style="display:flex;align-items:center;gap:10px">
        <button type="button" id="mkGenderPrev" class="ig-icon-btn" aria-label="${t("masks_previous_label")}" style="position:static;flex:none">
          <svg class="icon-flip-rtl" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div id="mkGenderDisplay" class="grimoire-field-input" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;user-select:none"></div>
        <button type="button" id="mkGenderNext" class="ig-icon-btn" aria-label="${t("masks_next_label")}" style="position:static;flex:none">
          <svg class="icon-flip-rtl" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>
    <div style="margin-bottom:8px">
      <label class="grimoire-field-label">${t("masks_description_label")}</label>
      <textarea id="mkDescription" class="grimoire-field-textarea" rows="5" placeholder="${t("masks_description_placeholder")}">${_esc(p.description || "")}</textarea>
    </div>
    <button type="button" class="pe-gen-btn" id="mkExpand" style="margin-bottom:16px">${t("masks_expand_button")}</button>
    <div class="grimoire-toggle-row">
      <span style="font-size:14px;color:var(--color-ink)">${t("masks_set_as_default_label")}</span>
      <input type="checkbox" id="mkDefault" ${p.is_default ? "checked" : ""}>
    </div>
    ${showDefaultWarning ? `<p style="font-size:11px;color:var(--color-sec);margin-top:4px">${t("masks_only_one_default_warning")}</p>` : ""}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      ${persona ? `<button type="button" class="pe-gen-btn" id="mkDelete" style="border-color:var(--color-warn);color:var(--color-warn);margin-right:auto">${t("masks_delete_button")}</button>` : ""}
      <button type="button" class="pe-gen-btn" id="mkCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("masks_cancel_button")}</button>
      <button type="button" class="pe-gen-btn" id="mkSave" data-feature="personas">${t("masks_save_button")}</button>
    </div>
  `, { onClose: cleanupDraftIfAbandoned });

  const GENDER_OPTIONS = [
    { symbol: "&#9792;", label: "Female", displayKey: "masks_gender_female" },
    { symbol: "&#9794;", label: "Male", displayKey: "masks_gender_male" },
    { symbol: "&#9895;", label: "Non-binary", displayKey: "masks_gender_nonbinary" },
    { symbol: "&#9711;", label: "Unspecified", displayKey: "masks_gender_unspecified" },
  ];
  let genderIndex = Math.max(0, GENDER_OPTIONS.findIndex((g) => g.label === (p.gender || "Unspecified")));
  const renderGender = () => {
    const g = GENDER_OPTIONS[genderIndex];
    layer.querySelector("#mkGenderDisplay").innerHTML = `<span style="font-size:16px">${g.symbol}</span><span style="font-size:13.5px">${t(g.displayKey)}</span>`;
  };
  renderGender();
  layer.querySelector("#mkGenderPrev").onclick = () => {
    genderIndex = (genderIndex - 1 + GENDER_OPTIONS.length) % GENDER_OPTIONS.length;
    renderGender();
  };
  layer.querySelector("#mkGenderNext").onclick = () => {
    genderIndex = (genderIndex + 1) % GENDER_OPTIONS.length;
    renderGender();
  };

  const wireImgClear = () => {
    const btn = layer.querySelector("#mkImgClear");
    if (btn) btn.onclick = (ev) => {
      ev.stopPropagation();
      curAvatar = "";
      layer.querySelector("#mkImgBox").innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    };
  };
  wireImgClear();
  layer.querySelector("#mkImgBox").onclick = (ev) => {
    if (ev.target.closest("#mkImgClear")) return;
    layer.querySelector("#mkImgFile").click();
  };
  layer.querySelector("#mkImgGen").onclick = () => _grimoireImageGenModal((url) => {
    curAvatar = url;
    layer.querySelector("#mkImgBox").innerHTML = `<img id="mkImgPreview" src="${_attr(curAvatar)}" alt=""><span class="grimoire-img-clear" role="button" aria-label="${t("masks_clear_image_label")}" tabindex="0" id="mkImgClear">&times;</span>`;
    wireImgClear();
  });
  layer.querySelector("#mkImgFile").onchange = () => {
    const fileInput = layer.querySelector("#mkImgFile");
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    maybeCropUpload(file, "1", 512, 512, (dataUrl) => {
      curAvatar = dataUrl;
      layer.querySelector("#mkImgBox").innerHTML = `<img id="mkImgPreview" src="${_attr(curAvatar)}" alt=""><span class="grimoire-img-clear" role="button" aria-label="${t("masks_clear_image_label")}" tabindex="0" id="mkImgClear">&times;</span>`;
      wireImgClear();
    });
  };

  const collectBody = () => ({
    name: layer.querySelector("#mkName").value.trim() || "You",
    description: layer.querySelector("#mkDescription").value.trim(),
    gender: GENDER_OPTIONS[genderIndex].label === "Unspecified" ? "" : GENDER_OPTIONS[genderIndex].label,
    avatar: curAvatar.startsWith("data:") ? "" : curAvatar,
    avatar_data: curAvatar.startsWith("data:") ? curAvatar : null,
    is_default: layer.querySelector("#mkDefault").checked,
    ...(isNewMask && sessionId ? { session_id: sessionId } : {}),
  });

  let lastAutosaveSerialized = null;
  const autosaveNow = async () => {
    if (finalized || !document.body.contains(layer)) { clearInterval(autosaveTimer); return; }
    const body = collectBody();
    if (!body.name.trim() && !body.description.trim()) return;
    const serialized = JSON.stringify(body);
    if (serialized === lastAutosaveSerialized) return;
    const draftBody = { ...body, is_draft: true };
    try {
      if (draftPid) await api(`/api/personas/${encodeURIComponent(draftPid)}`, { method: "PUT", body: JSON.stringify(draftBody) });
      else {
        const np = await api("/api/personas", { method: "POST", body: JSON.stringify(draftBody) });
        draftPid = np.id;
      }
      lastAutosaveSerialized = serialized;
    } catch (err) {
      errorToast(err.message || t("masks_couldnt_autosave_draft"));
    }
  };
  if (isNewMask && !window.tutorialEngine?.active && !sessionId) autosaveTimer = setInterval(autosaveNow, 5000);

  layer.querySelector("#mkCancel").onclick = () => { cleanupDraftIfAbandoned(); closeModal(layer); onSave(); };
  layer.querySelector("#mkExpand").onclick = async () => {
    const textEl = layer.querySelector("#mkDescription");
    const text = textEl.value.trim();
    if (!text) { toast(t("masks_write_something_first")); return; }
    const btn = layer.querySelector("#mkExpand");
    btn.disabled = true;
    btn.textContent = t("masks_expanding_button");
    try {
      const r = await api("/api/personas/expand-description", { method: "POST", body: JSON.stringify({ text }) });
      textEl.value = r.description;
      autosaveNow();
    } catch (err) {
      errorToast(err.message || t("masks_couldnt_expand_that"));
    }
    btn.disabled = false;
    btn.textContent = t("masks_expand_button");
  };
  if (persona) {
    layer.querySelector("#mkDelete").onclick = () => {
      const confirmLayer = openModal(`
        <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("masks_delete_mask_confirm_heading")}</h3>
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">"${_esc(p.name)}" ${t("masks_will_be_gone_for_good")}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="mkDelCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("masks_keep_it_button")}</button>
          <button type="button" class="pe-gen-btn" id="mkDelConfirm" style="border-color:var(--color-warn);color:var(--color-warn)">${t("masks_delete_button")}</button>
        </div>
      `);
      confirmLayer.querySelector("#mkDelCancel").onclick = () => closeModal(confirmLayer);
      confirmLayer.querySelector("#mkDelConfirm").onclick = async () => {
        try {
          finalized = true;
          clearTimeout(autosaveTimer);
          await api(`/api/personas/${encodeURIComponent(persona.id)}`, { method: "DELETE" });
          closeModal(confirmLayer);
          closeModal(layer);
          toast(t("masks_deleted_toast"));
          onSave();
        } catch (err) {
          errorToast(err.message || t("masks_couldnt_delete_mask"));
        }
      };
    };
  }
  layer.querySelector("#mkSave").onclick = async () => {
    const name = layer.querySelector("#mkName").value.trim();
    if (!name) { toast(t("masks_name_required")); return; }
    clearTimeout(autosaveTimer);
    const body = { ...collectBody(), is_draft: false };
    try {
      if (persona && !persona.is_draft) await api(`/api/personas/${encodeURIComponent(persona.id)}`, { method: "PUT", body: JSON.stringify(body) });
      else if (draftPid) await api(`/api/personas/${encodeURIComponent(draftPid)}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/personas", { method: "POST", body: JSON.stringify(body) });
      finalized = true;
    } catch (err) {
      errorToast(err.message || t("masks_save_failed"));
      return;
    }
    closeModal(layer);
    toast(t("masks_saved_toast"));
    onSave();
  };
}

class WorkshopPersonasView {
  constructor() {
    this.personas = null;
    this.drafts = [];
    this.tab = "masks";
    this.error = "";
  }

  async mount(main) {
    this.main = main;
    window._activeMasksView = this;
    this.render();
    try {
      const [ps, drafts] = await Promise.all([api("/api/personas"), api("/api/personas/drafts")]);
      this.personas = ps;
      this.drafts = drafts;
    } catch (err) {
      this.error = err.message || t("masks_couldnt_load_masks");
      this.personas = [];
      this.drafts = [];
    }
    this.render();
  }

  setTab(tab) {
    this.tab = tab;
    this.render();
  }

  rowHtml(p) {
    const initial = (p.name || "?")[0].toUpperCase();
    return `
      <div class="sanctum-feed-row" onclick="_activeMasksView.openEdit('${_attr(p.id)}')">
        <span class="sanctum-specimen" style="${p.avatar ? `background-image:url('${_attr(p.avatar)}');background-size:cover;background-position:center` : "background:var(--color-surface-2)"}">${p.avatar ? "" : initial}</span>
        <div class="sanctum-feed-body">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="sanctum-feed-title">${_esc(p.name)}</span>
            ${p.is_default ? `<span class="grimoire-tag" style="border:1px solid var(--color-accent);border-radius:999px;padding:2px 8px;color:var(--color-accent)">${t("masks_default_badge")}</span>` : ""}
            ${p.is_draft ? `<span class="grimoire-tag" style="border:1px solid var(--color-muted);border-radius:999px;padding:2px 8px;color:var(--color-muted)">${t("masks_draft_badge")}</span>` : ""}
          </div>
          <span class="grimoire-tag">${_esc((p.description || t("masks_no_description_yet")).slice(0, 80))}</span>
        </div>
      </div>
    `;
  }

  openEdit(pid) {
    const persona = (this.tab === "drafts" ? this.drafts : this.personas).find((p) => p.id === pid);
    if (!persona) return;
    _masksEditModal(persona, () => this.mount(this.main));
  }

  openAdd() {
    _masksEditModal(null, () => this.mount(this.main));
  }

  bodyHtml() {
    if (this.personas === null) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("masks_opening_masks")}</p>`;
    }
    const list = this.tab === "drafts" ? this.drafts : this.personas;
    const tabsHtml = `
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button type="button" onclick="_activeMasksView.setTab('masks')" class="filter-chip${this.tab === "masks" ? " on" : ""}">${t("masks_masks_tab")} (${this.personas.length})</button>
        <button type="button" onclick="_activeMasksView.setTab('drafts')" class="filter-chip${this.tab === "drafts" ? " on" : ""}">${t("masks_drafts_tab")} (${this.drafts.length})</button>
      </div>
    `;
    if (!list.length) {
      return `
        ${tabsHtml}
        <div class="sanctum-empty">
          <div class="sanctum-empty-mark">&sect;</div>
          <p class="sanctum-empty-title">${this.tab === "drafts" ? t("masks_no_drafts_yet") : t("masks_no_masks_yet")}</p>
          <p class="sanctum-empty-sub">${this.tab === "drafts" ? t("masks_unfinished_masks_hint") : t("masks_create_a_face_hint")}</p>
          ${this.tab === "masks" ? `<button type="button" class="sanctum-empty-cta" style="border:none;background:none;cursor:pointer" id="masksEmptyAdd">${t("masks_create_first_mask_cta")}</button>` : ""}
        </div>
      `;
    }
    return `${tabsHtml}<div class="sanctum-feed">${list.map((p) => this.rowHtml(p)).join("")}</div>`;
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col masks-content">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">${pageHeaderHtml(t("masks_workshop_breadcrumb"), t("masks_personas_title"), t("ph_personas_title"), t("ph_personas_sub"))}</div>
        <button type="button" class="grimoire-add-btn" id="masksAddBtn" aria-label="${t("masks_add_mask_label")}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${this.error}</p>` : ""}
      ${this.bodyHtml()}
      </div>
    `;
    const addBtn = this.main.querySelector("#masksAddBtn");
    if (addBtn) addBtn.onclick = () => this.openAdd();
    const emptyAdd = this.main.querySelector("#masksEmptyAdd");
    if (emptyAdd) emptyAdd.onclick = () => this.openAdd();
  }
}
