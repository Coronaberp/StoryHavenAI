"use strict";

const SAMPLING_FIELDS = [
  { id: "temperature", label: () => t("model_settings_temperature"), min: 0, max: 2, step: 0.01, fallback: 0.85 },
  { id: "top_p", label: () => t("model_settings_top_p"), min: 0, max: 1, step: 0.01, fallback: 0.9 },
  { id: "top_k", label: () => t("model_settings_top_k"), min: 0, max: 100, step: 1, fallback: 0 },
  { id: "min_p", label: () => t("model_settings_min_p"), min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: "top_a", label: () => t("model_settings_top_a"), min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: "typical_p", label: () => t("model_settings_typical_p"), min: 0, max: 1, step: 0.01, fallback: 1 },
  { id: "repetition_penalty", label: () => t("model_settings_repetition_penalty"), min: 0.5, max: 2, step: 0.01, fallback: 1 },
  { id: "frequency_penalty", label: () => t("model_settings_frequency_penalty"), min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "presence_penalty", label: () => t("model_settings_presence_penalty"), min: 0, max: 2, step: 0.01, fallback: 0 },
];

class ModelSettingsView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.settings = await api("/api/me/settings");
    } catch (e) {
      this.settings = { overrides: {}, defaults: {} };
      errorToast(t("model_settings_couldnt_load_your_settings"));
    }
    this.saving = false;
    this.render();
  }

  fieldValue(id) {
    const o = this.settings.overrides || {};
    return o[id] === undefined || o[id] === null ? "" : o[id];
  }

  render() {
    const o = this.settings.overrides || {};
    const d = this.settings.defaults || {};
    const useOwn = !!o.base_url;
    this.hadThinkingOverride = o.enable_thinking !== undefined;
    this.initialThinking = !!(this.hadThinkingOverride ? o.enable_thinking : d.enable_thinking);
    this.hadSceneOverride = o.scene_style !== undefined;
    this.initialScene = !!(this.hadSceneOverride ? o.scene_style : d.scene_style);
    const sliderRows = SAMPLING_FIELDS.map((f) => {
      const raw = this.fieldValue(f.id);
      const rangeVal = raw === "" ? (d[f.id] ?? f.fallback) : raw;
      return `
        <div class="mb-3">
          <label class="block text-xs text-sec mb-1">${_esc(f.label())}</label>
          <div class="flex items-center gap-2">
            <input type="range" id="model_${f.id}_range" min="${f.min}" max="${f.max}" step="${f.step}" value="${_attr(rangeVal)}"
              oninput="document.getElementById('model_${f.id}').value = this.value" class="flex-1">
            <input type="number" id="model_${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${_attr(raw)}"
              placeholder="${_attr(rangeVal)}"
              oninput="document.getElementById('model_${f.id}_range').value = this.value || ${JSON.stringify(rangeVal)}"
              class="w-20 px-2 py-1 rounded-md border border-line bg-surface text-ink text-xs font-mono">
          </div>
        </div>
      `;
    }).join("");

    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml(t("settings_row_settings"))}
      ${pageHeaderHtml("My Dossier", "Settings", t("ph_model_memory_title"), t("ph_model_memory_sub"))}

      ${sEyebrowHtml(t("model_settings_llm_endpoint"))}
      <label class="flex items-center gap-2.5 mb-3 text-sm text-ink">
        <input type="checkbox" id="model_use_own" ${useOwn ? "checked" : ""} onchange="document.getElementById('model_own_fields').style.display = this.checked ? 'block' : 'none'">
        ${t("model_settings_use_my_own_endpoint")}
      </label>
      <div id="model_own_fields" style="display:${useOwn ? "block" : "none"}" class="rounded-lg border border-line bg-surface p-3 mb-4">
        <label class="block text-xs text-sec mb-1">${t("model_settings_base_url")}</label>
        <input type="text" id="model_base_url" value="${_attr(o.base_url || "")}" placeholder="${_attr(d.base_url || "http://koboldcpp:5001/v1")}"
          class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-paper text-ink text-sm">
        <label class="block text-xs text-sec mb-1">${t("model_settings_api_key")} <span class="text-muted">${t("model_settings_optional")}</span></label>
        <input type="password" id="model_api_key" placeholder="${o.has_api_key ? t("model_settings_keep_current_key") : t("model_settings_none_set")}"
          class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-paper text-ink text-sm">
        <label class="block text-xs text-sec mb-1">${t("model_settings_chat_model")}</label>
        <div class="flex gap-2">
          <input type="text" id="model_chat_model" value="${_attr(o.chat_model || "")}" placeholder="${_attr(d.chat_model || "")}"
            class="flex-1 px-2.5 py-2 rounded-md border border-line bg-paper text-ink text-sm">
          <button type="button" onclick="modelView.fetchModels()" class="px-3 py-2 rounded-md border border-line bg-surface-2 text-xs text-ink">${t("model_settings_fetch")}</button>
        </div>
        <div id="model_model_list" class="flex flex-wrap gap-1.5 mt-2"></div>
      </div>

      ${sEyebrowHtml(t("model_settings_memory"))}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label class="block text-xs text-sec mb-1">${t("model_settings_past_messages_remembered")}</label>
          <input type="text" id="model_history_turns" value="${_attr(this.fieldValue("history_turns"))}" placeholder="${_attr(d.history_turns || 16)}"
            class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div>
          <label class="block text-xs text-sec mb-1">${t("model_settings_max_reply_tokens")}</label>
          <input type="text" id="model_max_tokens" value="${_attr(this.fieldValue("max_tokens"))}" placeholder="${_attr(d.max_tokens || 4096)}"
            class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
      </div>
      <label class="flex items-center gap-2.5 mb-2 text-sm text-ink">
        <input type="checkbox" id="model_thinking" ${this.initialThinking ? "checked" : ""}>
        ${t("model_settings_enable_thinking_by_default")}
      </label>
      <label class="flex items-center gap-2.5 mb-4 text-sm text-ink">
        <input type="checkbox" id="model_scene" ${this.initialScene ? "checked" : ""}>
        ${t("model_settings_visual_novel_scene_style")} <span class="text-muted text-xs">${t("model_settings_mood_tags_sprites")}</span>
      </label>

      ${sEyebrowHtml(t("model_settings_sampling"))}
      <p class="text-xs text-muted mb-3">${t("model_settings_blank_fields_inherit_default")}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4">${sliderRows}</div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">${t("model_settings_seed")} <span class="text-muted">${t("model_settings_blank_equals_random")}</span></label>
        <input type="text" id="model_seed" value="${_attr(this.fieldValue("seed"))}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">${t("model_settings_stop_sequences")} <span class="text-muted">${t("model_settings_one_per_line")}</span></label>
        <textarea id="model_stop" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-xs font-mono" style="min-height:52px">${_esc((o.stop || []).join("\n"))}</textarea>
      </div>

      ${sEyebrowHtml(t("model_settings_prompt_injection"))}
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("model_settings_system_suffix")}</label>
        <textarea id="model_suffix" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(o.system_suffix || "")}</textarea>
      </div>
      <div class="mb-5">
        <label class="block text-xs text-sec mb-1">${t("model_settings_post_history_instructions")}</label>
        <textarea id="model_posthist" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(o.post_history || "")}</textarea>
      </div>

      <div class="flex gap-2">
        <button type="button" onclick="modelView.save()" ${this.saving ? "disabled" : ""}
          class="flex-1 py-3 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark disabled:opacity-60">
          ${this.saving ? t("model_settings_saving") : t("model_settings_save_changes")}
        </button>
        <button type="button" onclick="modelView.resetAll()" class="px-4 py-3 rounded-xl border text-sm" style="border-color:var(--color-warn);color:var(--color-warn)">${t("model_settings_reset")}</button>
      </div>
      </div>
    `;
  }

  async fetchModels() {
    const base = document.getElementById("model_base_url")?.value.trim() || this.settings.defaults?.base_url || "";
    const key = document.getElementById("model_api_key")?.value.trim() || "";
    const params = new URLSearchParams();
    if (base) params.set("base_url", base);
    if (key) params.set("api_key", key);
    try {
      const { models } = await api("/api/models" + (params.toString() ? "?" + params : ""));
      const list = document.getElementById("model_model_list");
      if (!models?.length) { toast(t("model_settings_no_models_returned")); return; }
      list.innerHTML = models.map((m) => `<button type="button" class="px-2 py-1 rounded-md border border-line bg-surface-2 text-xs" data-model-name="${_attr(m)}" onclick="document.getElementById('model_chat_model').value=this.dataset.modelName">${_esc(m)}</button>`).join("");
    } catch (e) {
      errorToast(t("model_settings_fetch_failed_prefix") + e.message);
    }
  }

  numOrNull(id) {
    const v = parseFloat(document.getElementById(id)?.value ?? "");
    if (isNaN(v)) return null;
    const fieldId = id.replace(/^model_/, "");
    const field = SAMPLING_FIELDS.find((f) => f.id === fieldId);
    if (field) return Math.min(field.max, Math.max(field.min, v));
    return v;
  }

  intOrNull(id) {
    const v = parseInt(document.getElementById(id)?.value ?? "", 10);
    if (isNaN(v)) return null;
    const fieldId = id.replace(/^model_/, "");
    const field = SAMPLING_FIELDS.find((f) => f.id === fieldId);
    if (field) return Math.min(field.max, Math.max(field.min, v));
    return v;
  }

  checkboxOverride(id, initial, hadOverride) {
    const checked = !!document.getElementById(id)?.checked;
    if (checked !== initial) return checked;
    return hadOverride ? checked : null;
  }

  async save() {
    const body = {
      history_turns: this.intOrNull("model_history_turns"),
      max_tokens: this.intOrNull("model_max_tokens"),
      enable_thinking: this.checkboxOverride("model_thinking", this.initialThinking, this.hadThinkingOverride),
      scene_style: this.checkboxOverride("model_scene", this.initialScene, this.hadSceneOverride),
      temperature: this.numOrNull("model_temperature"),
      top_p: this.numOrNull("model_top_p"),
      top_k: this.intOrNull("model_top_k"),
      min_p: this.numOrNull("model_min_p"),
      top_a: this.numOrNull("model_top_a"),
      typical_p: this.numOrNull("model_typical_p"),
      repetition_penalty: this.numOrNull("model_repetition_penalty"),
      frequency_penalty: this.numOrNull("model_frequency_penalty"),
      presence_penalty: this.numOrNull("model_presence_penalty"),
      seed: this.intOrNull("model_seed"),
      stop: (document.getElementById("model_stop")?.value || "").split("\n").map((s) => s.trim()).filter(Boolean),
      system_suffix: document.getElementById("model_suffix")?.value.trim() || null,
      post_history: document.getElementById("model_posthist")?.value.trim() || null,
    };
    body.stop = body.stop.length ? body.stop : null;
    if (document.getElementById("model_use_own")?.checked) {
      body.base_url = document.getElementById("model_base_url")?.value.trim() || null;
      body.chat_model = document.getElementById("model_chat_model")?.value.trim() || null;
      const key = document.getElementById("model_api_key")?.value;
      if (key) body.api_key = key;
    } else {
      body.base_url = null;
      body.chat_model = null;
      body.api_key = null;
    }
    this.saving = true;
    this.render();
    try {
      await api("/api/me/settings", { method: "PUT", body: JSON.stringify(body) });
      this.settings = await api("/api/me/settings");
      toast(t("model_settings_settings_saved"));
    } catch (e) {
      errorToast(t("model_settings_save_failed_prefix") + e.message);
    }
    this.saving = false;
    this.render();
  }

  async resetAll() {
    if (!await confirmDialog(t("model_settings_reset_all_to_defaults_confirm"), { confirmLabel: t("model_settings_reset") })) return;
    const body = {
      history_turns: null,
      max_tokens: null,
      enable_thinking: null,
      scene_style: null,
      temperature: null,
      top_p: null,
      top_k: null,
      min_p: null,
      top_a: null,
      typical_p: null,
      repetition_penalty: null,
      frequency_penalty: null,
      presence_penalty: null,
      seed: null,
      stop: null,
      system_suffix: null,
      post_history: null,
      base_url: null,
      chat_model: null,
      api_key: null,
    };
    try {
      await api("/api/me/settings", { method: "PUT", body: JSON.stringify(body) });
      this.settings = await api("/api/me/settings");
      toast(t("model_settings_reset_to_defaults"));
    } catch (e) {
      errorToast(t("model_settings_reset_failed_prefix") + e.message);
    }
    this.render();
  }
}

if (typeof window !== "undefined") {
  window.ModelSettingsView = ModelSettingsView;
}
