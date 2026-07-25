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
    this._proxyCardsGlobalName = "modelView";
    this.proxyCardsExpanded = new Set();
    this.proxyCardsEmojiGridOpen = null;
    this.collapsed = {};
    try { this.collapsed = JSON.parse(store.get("settings_model_collapsed", "{}")) || {}; } catch (e) { this.collapsed = {}; }
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.settings = await api("/api/me/settings");
    } catch (e) {
      this.settings = { overrides: {}, defaults: {}, global_chat_proxies: [], global_embed_proxies: [] };
      errorToast(t("model_settings_couldnt_load_your_settings"));
    }
    this.proxyCardsState = { chat: (this.settings.overrides?.own_chat_proxies || []).map((p) => ({ ...p, api_key: "" })) };
    this.defaultVoices = {
      character_voice: this.settings.overrides?.default_character_voice || "",
      narrator_voice: this.settings.overrides?.default_narrator_voice || "",
    };
    this.saving = false;
    this.render();
    if (location.hash === "#voice") {
      this.main.querySelector("#settingsVoiceSection")?.scrollIntoView({ block: "start" });
    }
  }

  async openDefaultVoicePicker(key) {
    const voices = await _fetchTtsVoices();
    if (!voices.length) {
      errorToast(t("model_settings_no_voices_available", "Couldn't load voices right now."));
      return;
    }
    openVoicePickerModal(voices, this.defaultVoices[key], (voiceId) => {
      this.defaultVoices[key] = voiceId;
      this.render();
    });
  }

  onProxyCardsChanged(immediate) {
    if (immediate) this.save();
  }

  toggleCard(key) {
    this.collapsed[key] = !this.collapsed[key];
    store.set("settings_model_collapsed", JSON.stringify(this.collapsed));
    this.render();
  }

  fieldValue(id) {
    const o = this.settings.overrides || {};
    return o[id] === undefined || o[id] === null ? "" : o[id];
  }

  render() {
    const o = this.settings.overrides || {};
    const d = this.settings.defaults || {};
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

    const chatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
    const serverIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="6" rx="1.5"/><rect x="2" y="14" width="20" height="6" rx="1.5"/><circle cx="6" cy="7" r="0.6" fill="currentColor" stroke="none"/><circle cx="6" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>`;
    const lowestPriority = (list) => (list || []).reduce((best, p) =>
      !best || (p.priority ?? 0) < (best.priority ?? 0) ? p : best, null);
    const globalChatActive = lowestPriority(this.settings.global_chat_proxies);
    const globalEmbedActive = (this.settings.global_embed_proxies || []).find((p) => p.active);
    const ownChatProxies = this.proxyCardsState.chat;
    const ownChatActive = lowestPriority(ownChatProxies);

    const serverEndpointsCard = dossierCardHtml({
      globalName: "modelView", cardKey: "server_endpoints", isCollapsed: !!this.collapsed["card:server_endpoints"],
      icon: serverIcon, logoOrigin: "", title: t("model_settings_global_endpoints", "Server endpoints"),
      subtitle: t("model_settings_global_endpoints_hint", "Set by an admin. Shown for reference — you can't select these directly, add your own profile below to use a different endpoint."),
      status: `${_esc(globalChatActive?.name || t("proxy_cards_untitled", "Untitled profile"))} · ${_esc(globalEmbedActive?.name || t("proxy_cards_untitled", "Untitled profile"))}`,
      statusTone: globalChatActive ? "" : "warn",
      innerHtml: `
        <div class="font-mono text-[9.5px] uppercase tracking-[.06em] text-muted mb-1.5">${t("model_settings_chat", "Chat")}</div>
        <div class="mb-3">${readOnlyProxyListHtml(this.settings.global_chat_proxies, t("model_settings_no_global_chat_proxies", "No chat endpoint configured yet."), true)}</div>
        <div class="font-mono text-[9.5px] uppercase tracking-[.06em] text-muted mb-1.5">${t("model_settings_embed", "Embedding")}</div>
        <div class="mb-2">${readOnlyProxyListHtml(this.settings.global_embed_proxies, t("model_settings_no_global_embed_proxies", "No embedding endpoint configured yet."))}</div>
        <p class="text-xs text-muted mb-2">${t("model_settings_priority_hint", "The one marked Default is tried first. If it stops responding, the server automatically tries the next one in priority order, lowest number first.")}</p>
        <p class="text-xs text-muted">${t("model_settings_embed_why_locked", "Everyone's messages share one search index, so the embedding endpoint has to stay the same for all users. Only an admin can change it.")}</p>
      `,
    });

    const myChatCard = dossierCardHtml({
      globalName: "modelView", cardKey: "my_chat_endpoint", isCollapsed: !!this.collapsed["card:my_chat_endpoint"],
      icon: chatIcon, logoOrigin: "", title: t("model_settings_my_endpoints", "My chat endpoint"),
      subtitle: t("model_settings_my_endpoints_hint", "Save your own backend profile(s) with a priority number each. Every reply starts at priority 0 - if it fails, the server automatically retries the next-lowest number for you, so a backup endpoint can quietly take over if your main one goes down."),
      status: ownChatActive
        ? `${ownChatProxies.length} ${t("proxy_cards_profiles", "profiles")} · ${_esc(ownChatActive.name || t("proxy_cards_untitled", "Untitled profile"))}`
        : t("model_settings_using_server_default", "using server default"),
      statusTone: ownChatActive ? "" : "off",
      innerHtml: `
        <div id="cfg_own_chat_proxies">${this.proxyListHtml("chat", t("model_settings_no_own_proxies", "No profiles yet — the server endpoint above is used."))}</div>
        ${addProxyProfileButtonHtml("modelView", "chat")}
      `,
    });

    const usingOwnApi = !!ownChatActive;
    const currentEndpointName = usingOwnApi
      ? (ownChatActive.name || t("proxy_cards_untitled", "Untitled profile"))
      : (globalChatActive?.name || t("proxy_cards_untitled", "Untitled profile"));
    const currentApiIconSource = usingOwnApi ? ownChatActive : globalChatActive;
    const currentApiBannerHtml = `
      <div class="rounded-xl border p-3 mb-4 flex items-center gap-2.5" style="border-color:${usingOwnApi ? "var(--color-accent)" : "var(--color-line-2)"};background:${usingOwnApi ? "color-mix(in srgb, var(--color-accent) 10%, var(--color-paper))" : "var(--color-paper)"}">
        ${proxyIconHtml(currentApiIconSource || { icon_type: "favicon", base_url: "" }, 28)}
        <div class="min-w-0 flex-1">
          <div class="font-mono text-[9.5px] uppercase tracking-[.06em]" style="color:${usingOwnApi ? "var(--color-accent)" : "var(--color-muted)"}">${usingOwnApi ? t("model_settings_currently_using_own_api", "Currently using your own API") : t("model_settings_currently_using_server_api", "Currently using the server's API")}</div>
          <div class="text-sm text-ink font-medium truncate">${_esc(currentEndpointName)}</div>
        </div>
      </div>
    `;

    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml(t("settings_row_settings"))}
      ${pageHeaderHtml("My Dossier", "Settings", t("ph_model_memory_title"), t("ph_model_memory_sub"))}
      ${currentApiBannerHtml}

      ${sEyebrowHtml(t("model_settings_models_section", "Models"))}
      ${serverEndpointsCard}
      ${myChatCard}

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

      <div id="settingsVoiceSection">${sEyebrowHtml(t("model_settings_voice", "Voice"))}</div>
      <p class="text-xs text-muted mb-2">${t("model_settings_default_voice_hint", "Used whenever a chat has no voice override of its own.")}</p>
      <div class="mb-2">
        <label class="block text-xs text-sec mb-1">${t("tts_character_voice", "Character voice")}</label>
        <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:11px;border:1px solid var(--color-line-2);background:var(--color-surface-2)">
          <span style="flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(this.defaultVoices.character_voice ? _formatVoiceName(this.defaultVoices.character_voice).name : t("tts_voice_default", "Default"))}</span>
          <button type="button" onclick="modelView.openDefaultVoicePicker('character_voice')" class="pe-gen-btn" style="padding:5px 12px;font-size:11.5px">${t("masks_link_character_change", "Change")}</button>
        </div>
      </div>
      <div class="mb-5">
        <label class="block text-xs text-sec mb-1">${t("tts_narrator_voice", "Narrator voice")}</label>
        <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:11px;border:1px solid var(--color-line-2);background:var(--color-surface-2)">
          <span style="flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(this.defaultVoices.narrator_voice ? _formatVoiceName(this.defaultVoices.narrator_voice).name : t("tts_voice_default", "Default"))}</span>
          <button type="button" onclick="modelView.openDefaultVoicePicker('narrator_voice')" class="pe-gen-btn" style="padding:5px 12px;font-size:11.5px">${t("masks_link_character_change", "Change")}</button>
        </div>
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
      default_character_voice: this.defaultVoices.character_voice || null,
      default_narrator_voice: this.defaultVoices.narrator_voice || null,
    };
    body.stop = body.stop.length ? body.stop : null;
    this.syncProxiesFromDom("chat");
    body.own_chat_proxies = this.proxyCardsState.chat.map((p) => ({
      id: p.id, name: p.name || "", base_url: p.base_url || "", api_key: p.api_key || "",
      model: p.model || "", active: !!p.active, icon_type: p.icon_type || "favicon", icon_value: p.icon_value || "",
    }));
    this.saving = true;
    this.render();
    try {
      await api("/api/me/settings", { method: "PUT", body: JSON.stringify(body) });
      this.settings = await api("/api/me/settings");
      this.proxyCardsState = { chat: (this.settings.overrides?.own_chat_proxies || []).map((p) => ({ ...p, api_key: "" })) };
      this.defaultVoices = {
        character_voice: this.settings.overrides?.default_character_voice || "",
        narrator_voice: this.settings.overrides?.default_narrator_voice || "",
      };
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
      own_chat_proxies: null,
      default_character_voice: null,
      default_narrator_voice: null,
    };
    try {
      await api("/api/me/settings", { method: "PUT", body: JSON.stringify(body) });
      this.settings = await api("/api/me/settings");
      this.proxyCardsState = { chat: [] };
      this.defaultVoices = { character_voice: "", narrator_voice: "" };
      toast(t("model_settings_reset_to_defaults"));
    } catch (e) {
      errorToast(t("model_settings_reset_failed_prefix") + e.message);
    }
    this.render();
  }
}

Object.assign(ModelSettingsView.prototype, ProxyCardsMixin);

if (typeof window !== "undefined") {
  window.ModelSettingsView = ModelSettingsView;
}
