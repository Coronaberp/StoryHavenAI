"use strict";

const ADMIN_PREVIEW_KINDS = [
  { key: "checkpoint", label: "Checkpoints", listPath: "/api/imagegen/checkpoints", listField: null, previewPath: "/api/imagegen/checkpoint-previews", adminBase: "/api/admin/checkpoint-previews", extraFields: "checkpoint", deleteKind: "ckpt", addLabel: "+ Add model" },
  { key: "lora", label: "LoRAs", listPath: "/api/imagegen/loras", listField: null, previewPath: "/api/imagegen/lora-previews", adminBase: "/api/admin/lora-previews", extraFields: "lora", deleteKind: "lora", addLabel: "+ Add LoRA" },
  { key: "sampler", label: "Samplers", listPath: "/api/imagegen/samplers", listField: "samplers", previewPath: "/api/imagegen/sampler-previews", adminBase: "/api/admin/sampler-previews", extraFields: null, deleteKind: null, addLabel: null },
  { key: "scheduler", label: "Schedulers", listPath: "/api/imagegen/samplers", listField: "schedulers", previewPath: "/api/imagegen/scheduler-previews", adminBase: "/api/admin/scheduler-previews", extraFields: null, deleteKind: null, addLabel: null },
  { key: "upscaler", label: "Upscalers", listPath: "/api/imagegen/upscalers", listField: null, previewPath: "/api/imagegen/upscaler-previews", adminBase: "/api/admin/upscaler-previews", extraFields: null, deleteKind: "upsc", addLabel: "+ Request upscaler" },
  { key: "vidgen", label: "Vidgen", listPath: "/api/imagegen/wan-unets", listField: null, previewPath: "/api/imagegen/checkpoint-previews", adminBase: "/api/admin/checkpoint-previews", extraFields: null, deleteKind: "ckpt", addLabel: "+ Request video model" },
];

const ADMIN_MODEL_CATEGORIES = ["flux_v2", "anima", "sdxl", "il", "pony"];
const ADMIN_MODEL_CATEGORY_LABELS = { flux_v2: "Flux V2", anima: "Anima", sdxl: "SDXL", il: "Illustrious", pony: "Pony" };

const ADMIN_PREVIEW_GEN_DEFAULT_PROMPT = "masterpiece, best quality, 1girl, standing, detailed background";

function _pvDataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)[1];
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

class AdminPreviewsView {
  async mount(main) {
    this.main = main;
    this.search = {};
    this.collapsed = {};
    try { this.collapsed = JSON.parse(store.get("admin_previews_collapsed", "{}")) || {}; } catch (e) { this.collapsed = {}; }
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    await this.load();
  }

  toggleSection(kindKey) {
    this.collapsed[kindKey] = !this.collapsed[kindKey];
    store.set("admin_previews_collapsed", JSON.stringify(this.collapsed));
    this.render();
  }

  async load() {
    this.data = {};
    const checkpointsPromise = api("/api/imagegen/checkpoints").catch(() => []);
    const animaUnetsPromise = api("/api/imagegen/anima-unets").catch(() => []);
    const kindPromises = ADMIN_PREVIEW_KINDS.map((kind) => {
      if (kind.key === "checkpoint") {
        return api(kind.previewPath).catch(() => ({})).then((previews) => ({ kind, previews }));
      }
      return Promise.all([
        api(kind.listPath).catch(() => ({})),
        api(kind.previewPath).catch(() => ({})),
      ]).then(([listResp, previews]) => ({ kind, listResp, previews }));
    });
    const [checkpoints, animaUnets, ...kindResults] = await Promise.all([checkpointsPromise, animaUnetsPromise, ...kindPromises]);
    this.animaNames = new Set(animaUnets);
    kindResults.forEach(({ kind, listResp, previews }) => {
      if (kind.key === "checkpoint") {
        this.data[kind.key] = { names: [...checkpoints, ...animaUnets], previews };
        return;
      }
      const names = kind.listField ? (listResp[kind.listField] || []) : (Array.isArray(listResp) ? listResp : []);
      this.data[kind.key] = { names, previews };
    });
    this.render();
  }

  kindSectionHtml(kind) {
    const { names, previews } = this.data[kind.key];
    const search = (this.search[kind.key] || "").toLowerCase();
    const filtered = names.filter((n) => {
      if (!search) return true;
      const meta = previews[n] || {};
      const haystack = [n, meta.display_name, meta.description, ...(meta.keywords || [])].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(search);
    });
    const cards = filtered.map((name) => {
      const meta = previews[name] || {};
      const cats = meta.model_category || [];
      const badges = cats.length ? `<div class="flex flex-wrap gap-1 mt-1">${cats.map((c) => `<span class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-line text-muted">${_esc(ADMIN_MODEL_CATEGORY_LABELS[c] || c)}</span>`).join("")}</div>` : "";
      const unpublished = kind.key === "lora" && meta.is_published === false;
      const isVideoPreview = kind.key === "vidgen" && /\.(mp4|webm)(\?|$)/i.test(meta.image || "");
      const mediaHtml = isVideoPreview
        ? `<video src="${_attr(meta.image)}" class="w-full h-full object-cover" autoplay loop muted playsinline></video>`
        : (meta.image ? `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover">` : `<span class="text-xs text-muted">${_esc(t("admin_previews_no_preview"))}</span>`);
      return `
        <div class="rounded-[13px] border border-line bg-surface p-2.5 cursor-pointer" onclick="adminPreviewsView.openEdit(${_attr(JSON.stringify(kind.key))}, ${_attr(JSON.stringify(name))})">
          <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-2 grid place-items-center">
            ${mediaHtml}
          </div>
          <div class="text-xs text-ink truncate">${_esc(meta.display_name || name)}</div>
          ${unpublished ? `<div class="text-[10px] text-warn mt-0.5">${t("admin_previews_unpublished")}</div>` : ""}
          ${badges}
        </div>
      `;
    }).join("");
    const isCollapsed = !!this.collapsed[kind.key];
    return `
      <div class="mb-6">
        <div class="flex items-center justify-between gap-2 mb-2.5">
          <button type="button" onclick="adminPreviewsView.toggleSection(${_attr(JSON.stringify(kind.key))})" class="flex items-center gap-1.5 font-display font-semibold text-base text-ink">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${isCollapsed ? "-90deg" : "0deg"});transition:transform .15s"><path d="M6 9l6 6 6-6"/></svg>
            ${_esc(kind.label)} <span class="text-xs text-muted font-normal">(${names.length})</span>
          </button>
          ${kind.addLabel ? `<button type="button" onclick="event.stopPropagation();adminPreviewsView.openAddRequest(${_attr(JSON.stringify(kind.key))})" class="text-xs font-semibold px-2.5 py-1.5 rounded-md text-paper bg-gradient-to-br from-primary to-primary-dark">${_esc(kind.addLabel)}</button>` : ""}
        </div>
        ${isCollapsed ? "" : `
          <input type="text" id="pv_search_${_attr(kind.key)}" placeholder="${t("admin_previews_search_placeholder")} ${_attr(kind.label.toLowerCase())}…" value="${_attr(this.search[kind.key] || "")}" oninput="adminPreviewsView.setSearch(${_attr(JSON.stringify(kind.key))}, this.value)"
            class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          <div class="grid grid-cols-3 gap-2.5">${cards || `<p class="text-sm text-muted col-span-3">${t("admin_previews_no_models_found")}</p>`}</div>
        `}
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_previews_title"), t("ph_admin_previews_sub"))}
      ${ADMIN_PREVIEW_KINDS.map((k) => this.kindSectionHtml(k)).join("")}
      </div>
    `;
  }

  setSearch(kindKey, value) {
    this.search[kindKey] = value;
    this.render();
    const input = document.getElementById(`pv_search_${kindKey}`);
    if (input) {
      input.focus();
      input.setSelectionRange(value.length, value.length);
    }
  }

  extraFieldsHtml(kind, name, meta) {
    if (kind.extraFields === "checkpoint") {
      const isAnima = this.animaNames.has(name);
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_type")}</label>
          <input type="text" id="pv_model_type" value="${_attr(meta.model_type || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_default_steps")}</label>
          <input type="number" id="pv_default_steps" value="${_attr(meta.default_steps ?? "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        ${isAnima ? `
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_anima_clip_override")}</label>
            <select id="pv_anima_clip" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm"><option value="">${t("admin_previews_loading")}</option></select>
          </div>
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_anima_vae_override")}</label>
            <select id="pv_anima_vae" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm"><option value="">${t("admin_previews_loading")}</option></select>
          </div>
        ` : ""}
      `;
    }
    if (kind.extraFields === "lora") {
      const cats = meta.model_category || [];
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_categories")}</label>
          <div class="flex flex-wrap gap-1.5">
            ${ADMIN_MODEL_CATEGORIES.map((c) => `
              <button type="button" data-cat="${_attr(c)}" class="px-2.5 py-1 rounded-md border text-xs ${cats.includes(c) ? "on" : ""}" style="border-color:var(--color-line);background:${cats.includes(c) ? "var(--color-accent)" : "var(--color-surface)"};color:${cats.includes(c) ? "var(--color-paper)" : "var(--color-ink)"}">${_esc(ADMIN_MODEL_CATEGORY_LABELS[c] || c)}</button>
            `).join("")}
          </div>
        </div>
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${t("admin_previews_keywords")} <span class="text-muted">${t("admin_previews_keywords_hint")}</span></label>
          <input type="text" id="pv_keywords" value="${_attr((meta.keywords || []).join(", "))}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        ${meta.is_published === false ? `
          <div class="mb-3 p-2.5 rounded-md border border-line flex items-center justify-between gap-2">
            <span class="text-xs text-warn">${t("admin_previews_unpublished_hidden")}</span>
            <button type="button" id="pv_publish" class="px-2.5 py-1 rounded-md text-xs font-semibold text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_publish")}</button>
          </div>
        ` : ""}
      `;
    }
    return "";
  }

  async openEdit(kindKey, name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === kindKey);
    const meta = this.data[kindKey].previews[name] || {};
    openModal(`
      <h3>${_esc(meta.display_name || name)}</h3>
      <p class="font-mono text-xs text-muted mb-3 break-all">${_esc(name)}</p>
      <div class="w-full aspect-video rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center cursor-zoom-in" id="pv_zoom_trigger">
        ${meta.image ? `<img src="${_attr(meta.image)}" alt="" class="w-full h-full object-cover">` : `<span class="text-xs text-muted">${_esc(t("admin_previews_no_preview"))}</span>`}
      </div>
      <div class="flex gap-2 mb-4">
        <button type="button" id="pv_generate" class="flex-1 py-2 rounded-md border border-line text-center text-sm text-ink cursor-pointer">${_esc(t("admin_previews_generate_preview_button"))}</button>
        <label class="flex-1 py-2 rounded-md border border-line text-center text-sm text-ink cursor-pointer">
          Upload image
          <input type="file" id="pv_file" accept="image/*" class="hidden">
        </label>
      </div>
      ${meta.image ? `<button type="button" id="pv_clear_image" class="w-full mb-4 py-2 rounded-md border text-sm" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_previews_clear_preview_image")}</button>` : ""}
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_display_name")}</label>
        <input type="text" id="pv_display_name" value="${_attr(meta.display_name || "")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_description")}</label>
        <textarea id="pv_description" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(meta.description || "")}</textarea>
      </div>
      ${this.extraFieldsHtml(kind, name, meta)}
      <div class="flex gap-2">
        <button type="button" id="pv_save" class="flex-1 py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_save")}</button>
        ${kind.deleteKind ? `<button type="button" id="pv_delete_file" class="px-4 py-2.5 rounded-xl font-semibold text-sm border" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_previews_delete_file")}</button>` : ""}
      </div>
    `);

    if (kind.extraFields === "checkpoint" && this.animaNames.has(name)) {
      const [clipModels, vaeModels] = await Promise.all([
        api("/api/imagegen/clip-models").catch(() => []),
        api("/api/imagegen/vaes").catch(() => []),
      ]);
      const clipSel = document.getElementById("pv_anima_clip");
      const vaeSel = document.getElementById("pv_anima_vae");
      if (clipSel) {
        clipSel.innerHTML = `<option value="">${t("admin_previews_default_option")}</option>${clipModels.map((m) => `<option value="${_attr(m)}"${m === meta.anima_clip_name ? " selected" : ""}>${_esc(m)}</option>`).join("")}`;
      }
      if (vaeSel) {
        vaeSel.innerHTML = `<option value="">${t("admin_previews_default_option")}</option>${vaeModels.map((m) => `<option value="${_attr(m)}"${m === meta.anima_vae_name ? " selected" : ""}>${_esc(m)}</option>`).join("")}`;
      }
    }

    document.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.onclick = () => {
        btn.classList.toggle("on");
        const isOn = btn.classList.contains("on");
        btn.style.background = isOn ? "var(--color-accent)" : "var(--color-surface)";
        btn.style.color = isOn ? "var(--color-paper)" : "var(--color-ink)";
      };
    });

    const zoomTrigger = document.getElementById("pv_zoom_trigger");
    if (zoomTrigger && meta.image) zoomTrigger.onclick = () => {
      openModal(`<img src="${_attr(meta.image)}" alt="" class="w-full rounded-lg">`, { wide: true });
    };

    document.getElementById("pv_generate").onclick = () => this.openGeneratePreview(kind, name, meta);

    document.getElementById("pv_file").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { errorToast(t("admin_previews_file_too_large")); return; }
      const fd = new FormData();
      fd.append("file", file, file.name);
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      }
    };

    const clearBtn = document.getElementById("pv_clear_image");
    if (clearBtn) clearBtn.onclick = async () => {
      if (!(await confirmDialog(t("admin_previews_confirm_clear_preview")))) return;
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "DELETE" });
        toast(t("admin_previews_preview_image_cleared"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_clear_preview"));
      }
    };

    const publishBtn = document.getElementById("pv_publish");
    if (publishBtn) publishBtn.onclick = async () => {
      try {
        await api(`/api/admin/lora-previews/${encodeURIComponent(name)}/publish`, { method: "PUT", body: JSON.stringify({ published: true }) });
        toast(t("admin_previews_published_visible_to_all"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_publish_failed"));
      }
    };

    const deleteFileBtn = document.getElementById("pv_delete_file");
    if (deleteFileBtn) deleteFileBtn.onclick = async () => {
      if (!(await confirmDialog(t("admin_previews_confirm_delete_file")))) return;
      try {
        await api(`/api/admin/models/${kind.deleteKind}/${encodeURIComponent(name)}`, { method: "DELETE" });
        toast(t("admin_previews_deleted"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_delete_failed"));
      }
    };

    document.getElementById("pv_save").onclick = async () => {
      const body = {
        display_name: document.getElementById("pv_display_name").value.trim() || null,
        description: document.getElementById("pv_description").value.trim() || null,
      };
      if (kind.extraFields === "checkpoint") {
        body.model_type = document.getElementById("pv_model_type").value.trim() || null;
        const steps = document.getElementById("pv_default_steps").value.trim();
        body.default_steps = steps ? parseInt(steps, 10) : null;
        const clipSel = document.getElementById("pv_anima_clip");
        const vaeSel = document.getElementById("pv_anima_vae");
        body.anima_clip_name = clipSel ? (clipSel.value || null) : null;
        body.anima_vae_name = vaeSel ? (vaeSel.value || null) : null;
      }
      if (kind.extraFields === "lora") {
        body.model_category = [...document.querySelectorAll("[data-cat]")]
          .filter((b) => b.classList.contains("on"))
          .map((b) => b.dataset.cat);
        body.keywords = document.getElementById("pv_keywords").value.split(",").map((s) => s.trim()).filter(Boolean);
      }
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}/meta`, { method: "PUT", body: JSON.stringify(body) });
        toast(t("admin_previews_saved"));
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_save"));
      }
    };
  }

  _defaultCheckpointFor(architecture) {
    const names = this.data.checkpoint.names;
    if (architecture === "anima") return names.find((n) => this.animaNames.has(n)) || "";
    return names.find((n) => !this.animaNames.has(n)) || "";
  }

  _defaultSampler() {
    const s = this.data.sampler.names;
    return s.includes("dpmpp_2m_sde_gpu") ? "dpmpp_2m_sde_gpu" : (s.includes("euler") ? "euler" : (s[0] || "euler"));
  }

  _defaultScheduler() {
    const s = this.data.scheduler.names;
    return s.includes("karras") ? "karras" : (s.includes("normal") ? "normal" : (s[0] || "normal"));
  }

  async openGenerateVidgenPreview(name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === "vidgen");
    const st = await api("/api/settings").catch(() => ({}));
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_wan_generate_description")}</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_prompt")}</label>
        <textarea id="pvv_prompt" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(ADMIN_PREVIEW_GEN_DEFAULT_PROMPT)}</textarea>
      </div>
      <div class="w-full aspect-video rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center" id="pvv_preview">
        <span class="text-xs text-muted">${t("admin_previews_preview_will_appear_here")}</span>
      </div>
      <button type="button" id="pvv_run" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_generate")}</button>
      <button type="button" id="pvv_use" class="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border border-line text-ink hidden">${t("admin_previews_use_as_preview")}</button>
    `, { wide: true });

    const runBtn = layer.querySelector("#pvv_run");
    const useBtn = layer.querySelector("#pvv_use");
    const previewBox = layer.querySelector("#pvv_preview");
    let videoUrl = null;

    runBtn.onclick = async () => {
      runBtn.disabled = true;
      runBtn.textContent = t("admin_previews_generating");
      useBtn.classList.add("hidden");
      videoUrl = null;
      previewBox.innerHTML = `<span class="text-xs text-muted">${t("admin_previews_starting")}</span>`;
      const body = {
        positive: layer.querySelector("#pvv_prompt").value.trim(),
        negative: "",
        unet_name: name,
        clip_name: st.wan_clip_name || null,
        vae_name: st.wan_vae_name || null,
        fps: 16, num_frames: 33, width: 832, height: 480, steps: 20, cfg: 6.0,
      };
      try {
        const res = await fetch(`${API}/api/imagegen/video`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json()).detail || detail; } catch (e) {  }
          throw new Error(detail);
        }
        await sseEvents(res, (ev) => {
          if (ev.type === "status") {
            previewBox.innerHTML = `<span class="text-xs text-muted">${_esc(ev.message)}</span>`;
          } else if (ev.type === "preview") {
            let img = previewBox.querySelector("#pvv_live_preview");
            if (!img) previewBox.innerHTML = `<img id="pvv_live_preview" src="${_attr(ev.image)}" style="width:100%;height:100%;object-fit:cover">`;
            else img.src = ev.image;
          } else if (ev.type === "done") {
            videoUrl = ev.video.image;
            previewBox.innerHTML = `<video src="${_attr(videoUrl)}" style="width:100%;height:100%;object-fit:cover" controls autoplay muted loop playsinline></video>`;
            useBtn.classList.remove("hidden");
          } else if (ev.type === "error") {
            errorToast(ev.message || t("admin_previews_generation_failed"));
          }
        });
      } catch (err) {
        errorToast(err.message || t("admin_previews_generation_failed"));
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = t("admin_previews_generate");
      }
    };

    useBtn.onclick = async () => {
      if (!videoUrl) return;
      useBtn.disabled = true;
      try {
        const blob = await (await fetch(videoUrl, { credentials: "include" })).blob();
        const fd = new FormData();
        fd.append("file", blob, "preview.mp4");
        await api(`${kind.adminBase}/${encodeURIComponent(name)}/video`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_video_updated"));
        closeModal(layer);
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      } finally {
        useBtn.disabled = false;
      }
    };
  }

  openGeneratePreview(kind, name, meta) {
    if (kind.key === "upscaler") { this.openGenerateUpscalerPreview(name); return; }
    if (kind.key === "vidgen") { this.openGenerateVidgenPreview(name); return; }

    const isAnimaCkpt = kind.key === "checkpoint" && this.animaNames.has(name);
    const architecture = isAnimaCkpt ? "anima" : "sdxl";
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_generate_description_prefix")} ${_esc(kind.key)}${t("admin_previews_generate_description_suffix")}</p>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_prompt")}</label>
        <textarea id="pvg_prompt" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:60px">${_esc(ADMIN_PREVIEW_GEN_DEFAULT_PROMPT)}</textarea>
      </div>
      <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center" id="pvg_preview">
        <span class="text-xs text-muted">${t("admin_previews_preview_will_appear_here")}</span>
      </div>
      <button type="button" id="pvg_run" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_generate")}</button>
      <button type="button" id="pvg_use" class="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border border-line text-ink hidden">${t("admin_previews_use_as_preview")}</button>
    `, { wide: true });

    let resultDataUrl = null;
    const runBtn = layer.querySelector("#pvg_run");
    const useBtn = layer.querySelector("#pvg_use");
    const previewBox = layer.querySelector("#pvg_preview");

    runBtn.onclick = async () => {
      runBtn.disabled = true;
      runBtn.textContent = t("admin_previews_generating");
      useBtn.classList.add("hidden");
      resultDataUrl = null;
      const anima = architecture === "anima";
      const body = {
        positive: layer.querySelector("#pvg_prompt").value.trim(),
        negative: "",
        checkpoint: kind.key === "checkpoint" ? name : this._defaultCheckpointFor(architecture),
        loras: kind.key === "lora" ? [{ name, strength: 0.8 }] : [],
        width: 1024, height: 1024,
        sampler: kind.key === "sampler" ? name : (anima ? ANIMA_DEFAULT_SAMPLER : this._defaultSampler()),
        scheduler: kind.key === "scheduler" ? name : (anima ? ANIMA_DEFAULT_SCHEDULER : this._defaultScheduler()),
        steps: 20, cfg: anima ? ANIMA_DEFAULT_CFG : 7.0,
        architecture,
      };
      try {
        const res = await fetch(`${API}/api/imagegen/standalone/stream`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        await sseEvents(res, (ev) => {
          if (ev.type === "preview") {
            previewBox.innerHTML = `<img src="${_attr(ev.image)}" alt="" class="w-full h-full object-cover">`;
          } else if (ev.type === "done") {
            resultDataUrl = ev.image;
            previewBox.innerHTML = `<img src="${_attr(ev.image)}" alt="" class="w-full h-full object-cover">`;
            useBtn.classList.remove("hidden");
          } else if (ev.type === "error") {
            errorToast(ev.message || t("admin_previews_generation_failed"));
          }
        });
      } catch (err) {
        errorToast(err.message || t("admin_previews_generation_failed"));
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = t("admin_previews_generate");
      }
    };

    useBtn.onclick = async () => {
      if (!resultDataUrl) return;
      const fd = new FormData();
      fd.append("file", _pvDataUrlToBlob(resultDataUrl), "preview.png");
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeModal(layer);
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      }
    };
  }

  openGenerateUpscalerPreview(name) {
    const kind = ADMIN_PREVIEW_KINDS.find((k) => k.key === "upscaler");
    const layer = openModal(`
      <h3>${t("admin_previews_generate_preview")}</h3>
      <p class="text-xs text-muted mb-3">${t("admin_previews_upscaler_description")}</p>
      <label class="w-full py-2 mb-3 rounded-md border border-line text-center text-sm text-ink cursor-pointer block">
        ${t("admin_previews_choose_source_image")}
        <input type="file" id="pvu_file" accept="image/*" class="hidden">
      </label>
      <div class="w-full aspect-square rounded-lg overflow-hidden bg-surface-2 mb-3 grid place-items-center" id="pvu_preview">
        <span class="text-xs text-muted">${t("admin_previews_source_image_will_appear_here")}</span>
      </div>
      <button type="button" id="pvu_run" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark" disabled>${t("admin_previews_upscale")}</button>
      <button type="button" id="pvu_use" class="w-full mt-2 py-2.5 rounded-xl font-semibold text-sm border border-line text-ink hidden">${t("admin_previews_use_as_preview")}</button>
    `, { wide: true });

    let srcDataUrl = null, resultDataUrl = null;
    const fileInput = layer.querySelector("#pvu_file");
    const previewBox = layer.querySelector("#pvu_preview");
    const runBtn = layer.querySelector("#pvu_run");
    const useBtn = layer.querySelector("#pvu_use");

    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        srcDataUrl = reader.result;
        previewBox.innerHTML = `<img src="${_attr(srcDataUrl)}" alt="" class="w-full h-full object-cover">`;
        runBtn.disabled = false;
        useBtn.classList.add("hidden");
        resultDataUrl = null;
      };
      reader.readAsDataURL(file);
    };

    runBtn.onclick = async () => {
      if (!srcDataUrl) return;
      runBtn.disabled = true;
      runBtn.textContent = t("admin_previews_upscaling");
      try {
        const res = await api("/api/imagegen/upscale", { method: "POST", body: JSON.stringify({ image: srcDataUrl, upscaler: name }) });
        resultDataUrl = res.image;
        previewBox.innerHTML = `<img src="${_attr(resultDataUrl)}" alt="" class="w-full h-full object-cover">`;
        useBtn.classList.remove("hidden");
      } catch (err) {
        errorToast(err.message || t("admin_previews_upscale_failed"));
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = t("admin_previews_upscale_again");
      }
    };

    useBtn.onclick = async () => {
      if (!resultDataUrl) return;
      const fd = new FormData();
      fd.append("file", _pvDataUrlToBlob(resultDataUrl), "preview.png");
      try {
        await api(`${kind.adminBase}/${encodeURIComponent(name)}`, { method: "PUT", body: fd });
        toast(t("admin_previews_preview_image_updated"));
        closeModal(layer);
        closeTopModal();
        await this.load();
      } catch (err) {
        errorToast(err.message || t("admin_previews_upload_failed"));
      }
    };
  }

  openAddRequest(kindKey) {
    const requestTypeFor = { checkpoint: "checkpoint", lora: "lora", upscaler: "upscaler", vidgen: "wan" };
    const baseType = requestTypeFor[kindKey];
    const needsAux = baseType === "checkpoint" || baseType === "wan";
    const layer = openModal(`
      <h3>${t("admin_previews_request_a_model")}</h3>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_model_name")}</label>
        <input type="text" id="pvr_name" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_source_url")}</label>
        <input type="text" id="pvr_url" placeholder="https://…" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      ${baseType === "checkpoint" ? `
        <label class="flex items-center gap-2 mb-3 text-sm text-ink">
          <input type="checkbox" id="pvr_anima">
          ${t("admin_previews_this_is_anima_model")}
        </label>
      ` : ""}
      ${needsAux ? `
        <div id="pvr_aux_fields" class="${baseType === "wan" ? "" : "hidden"}">
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_vae_url_optional")}</label>
            <input type="text" id="pvr_vae_url" placeholder="https://…" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          </div>
          <div class="mb-3">
            <label class="block text-xs text-sec mb-1">${t("admin_previews_text_encoder_url_optional")}</label>
            <input type="text" id="pvr_te_url" placeholder="https://…" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
          </div>
        </div>
      ` : ""}
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_previews_note")}</label>
        <textarea id="pvr_note" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:50px"></textarea>
      </div>
      <button type="button" id="pvr_submit" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_previews_submit_request")}</button>
    `);

    const animaCheck = layer.querySelector("#pvr_anima");
    const auxFields = layer.querySelector("#pvr_aux_fields");
    if (animaCheck) animaCheck.onchange = () => auxFields.classList.toggle("hidden", !animaCheck.checked);

    layer.querySelector("#pvr_submit").onclick = async () => {
      const model_name = layer.querySelector("#pvr_name").value.trim();
      const source_url = layer.querySelector("#pvr_url").value.trim();
      if (!model_name || !source_url) { errorToast(t("admin_previews_name_and_url_required")); return; }
      const request_type = (baseType === "checkpoint" && animaCheck?.checked) ? "anima" : baseType;
      const body = {
        model_name, source_url, request_type,
        note: layer.querySelector("#pvr_note").value.trim(),
      };
      if (request_type === "anima" || request_type === "wan") {
        body.vae_url = layer.querySelector("#pvr_vae_url").value.trim() || null;
        body.text_encoder_url = layer.querySelector("#pvr_te_url").value.trim() || null;
      }
      try {
        await api("/api/imagegen/model-requests", { method: "POST", body: JSON.stringify(body) });
        toast(t("admin_previews_request_submitted"));
        closeModal(layer);
      } catch (err) {
        errorToast(err.message || t("admin_previews_couldnt_submit_request"));
      }
    };
  }
}

if (typeof window !== "undefined") {
  window.AdminPreviewsView = AdminPreviewsView;
}
