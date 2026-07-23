"use strict";

class AdminConfigView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    try {
      this.st = await api("/api/settings");
    } catch (e) {
      this.st = {};
      errorToast(t("admin_config_couldnt_load_settings"));
    }
    try {
      const { providers } = await api("/api/admin/oauth-providers");
      this.oauthProviders = providers.map((p) => ({ ...p, client_secret: "" }));
    } catch (e) {
      this.oauthProviders = [];
    }
    this.mrHosts = (this.st.model_request_hosts || []).map((h) => ({ host: h.host || "", api_key: "", has_api_key: !!h.has_api_key }));
    this.render();
    this.loadWanOptions();
  }

  async resyncUiTranslations() {
    const btn = document.getElementById("cfg_resync_ui_translations");
    if (btn) { btn.disabled = true; btn.textContent = t("admin_config_resync_ui_translations_starting"); }
    try {
      const r = await api("/api/admin/resync-ui-translations", { method: "POST", body: JSON.stringify({ strings: UI_STRINGS }) });
      toast(`${t("admin_config_resync_ui_translations_started_prefix")} ${r.keys} ${t("admin_config_resync_ui_translations_started_middle")} ${r.languages} ${t("admin_config_resync_ui_translations_started_suffix")}`);
    } catch (e) {
      errorToast(e.message || t("admin_config_resync_ui_translations_failed"));
    }
    if (btn) { btn.disabled = false; btn.textContent = t("admin_config_resync_ui_translations_button"); }
  }

  async loadWanOptions() {
    const fillSelect = (id, names, current) => {
      const el = document.getElementById(id);
      if (!el) return;
      const options = ["", ...names];
      el.innerHTML = options.map((n) =>
        `<option value="${_attr(n)}"${n === (current || "") ? " selected" : ""}>${n ? _esc(n) : t("admin_config_none")}</option>`
      ).join("");
    };
    const [unets, clips, vaes] = await Promise.all([
      api("/api/imagegen/wan-unets").catch(() => []),
      api("/api/imagegen/wan-clip-models").catch(() => []),
      api("/api/imagegen/vaes").catch(() => []),
    ]);
    fillSelect("cfg_wan_unet", unets, this.st.wan_unet_name);
    fillSelect("cfg_wan_clip", clips, this.st.wan_clip_name);
    fillSelect("cfg_wan_vae", vaes, this.st.wan_vae_name);
  }

  identityProviderRowHtml(p, i) {
    return `
      <div class="mb-2 p-2.5 rounded-md border border-line" data-identity-provider-row="${i}">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm text-ink font-medium">${_esc(p.label)}</span>
          <button type="button" data-identity-provider-toggle="${i}" class="settings-toggle${p.enabled ? " on" : ""}"><span class="settings-toggle-knob"></span></button>
        </div>
        <input type="text" data-identity-provider-client-id value="${_attr(p.client_id)}" placeholder="${t("admin_config_identity_provider_client_id_placeholder")}" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <input type="password" autocomplete="new-password" data-identity-provider-client-secret placeholder="${p.has_client_secret ? t("admin_config_identity_provider_client_secret_set_placeholder") : t("admin_config_identity_provider_client_secret_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <div class="mt-1.5">
          <div class="text-xs text-muted mb-1">${t("admin_config_identity_provider_callback_url_label")}</div>
          <div class="flex items-center gap-1.5">
            <input type="text" readonly value="${_attr(this.identityProviderCallbackUrl(p.provider))}" class="w-full px-2.5 py-1.5 rounded-md border border-line bg-surface-2 text-muted text-xs" onclick="this.select()">
            <button type="button" data-identity-provider-copy-callback="${i}" class="shrink-0 px-2 py-1.5 rounded-md border border-line text-xs text-ink">${t("admin_config_identity_provider_callback_url_copy_button")}</button>
          </div>
        </div>
      </div>
    `;
  }

  identityProviderCallbackUrl(provider) {
    return `${window.location.origin}/api/auth/oauth/${encodeURIComponent(provider)}/callback`;
  }

  copyIdentityProviderCallbackUrl(i) {
    const url = this.identityProviderCallbackUrl(this.oauthProviders[i].provider);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => toast(t("admin_config_identity_provider_callback_url_copied")))
        .catch(() => {
          if (copyTextFallback(url)) toast(t("admin_config_identity_provider_callback_url_copied"));
          else errorToast(t("admin_config_identity_provider_callback_url_copy_failed"));
        });
    } else if (copyTextFallback(url)) {
      toast(t("admin_config_identity_provider_callback_url_copied"));
    } else {
      errorToast(t("admin_config_identity_provider_callback_url_copy_failed"));
    }
  }

  toggleIdentityProviderEnabled(i) {
    this.syncIdentityProvidersFromDom();
    this.oauthProviders[i].enabled = !this.oauthProviders[i].enabled;
    this.render();
  }

  syncIdentityProvidersFromDom() {
    document.querySelectorAll("[data-identity-provider-row]").forEach((row) => {
      const i = parseInt(row.dataset.identityProviderRow, 10);
      if (!this.oauthProviders[i]) return;
      this.oauthProviders[i].client_id = row.querySelector("[data-identity-provider-client-id]").value.trim();
      const secret = row.querySelector("[data-identity-provider-client-secret]").value;
      if (secret) this.oauthProviders[i].client_secret = secret;
    });
  }

  async saveIdentityProviders() {
    this.syncIdentityProvidersFromDom();
    const providers = {};
    this.oauthProviders.forEach((p) => {
      providers[p.provider] = {
        client_id: p.client_id,
        client_secret: p.client_secret || null,
        enabled: !!p.enabled,
      };
    });
    try {
      await api("/api/admin/oauth-providers", { method: "PUT", body: JSON.stringify({ providers }) });
      toast(t("admin_config_identity_providers_saved"));
      const { providers: fresh } = await api("/api/admin/oauth-providers");
      this.oauthProviders = fresh.map((p) => ({ ...p, client_secret: "" }));
      this.render();
    } catch (e) {
      errorToast(t("admin_config_identity_providers_save_failed") + " " + e.message);
    }
  }

  mrHostRowHtml(row, i) {
    return `
      <div class="flex gap-2 items-center mb-1.5" data-mr-row="${i}">
        <input type="text" data-mr-host value="${_attr(row.host)}" placeholder="${t("admin_config_host_placeholder")}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <input type="password" autocomplete="new-password" data-mr-key placeholder="${row.has_api_key ? t("admin_config_key_set_placeholder") : t("admin_config_api_key_optional_placeholder")}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        <button type="button" onclick="adminConfigView.removeMrHostRow(${i})" class="px-2 py-2 rounded-md border text-xs flex-none" style="border-color:var(--color-warn);color:var(--color-warn)">×</button>
      </div>
    `;
  }

  syncMrHostsFromDom() {
    document.querySelectorAll("[data-mr-row]").forEach((row) => {
      const i = parseInt(row.dataset.mrRow, 10);
      if (!this.mrHosts[i]) return;
      this.mrHosts[i].host = row.querySelector("[data-mr-host]").value.trim();
      const key = row.querySelector("[data-mr-key]").value;
      if (key) this.mrHosts[i].api_key = key;
    });
  }

  addMrHostRow() {
    this.syncMrHostsFromDom();
    this.mrHosts.push({ host: "", api_key: "", has_api_key: false });
    this.render();
  }

  removeMrHostRow(i) {
    this.syncMrHostsFromDom();
    this.mrHosts.splice(i, 1);
    this.render();
  }

  async fetchModels() {
    const base = document.getElementById("cfg_base").value.trim();
    const key = document.getElementById("cfg_key").value.trim();
    const params = new URLSearchParams();
    if (base) params.set("base_url", base);
    if (key) params.set("api_key", key);
    try {
      const { models } = await api("/api/models" + (params.toString() ? "?" + params : ""));
      if (!models?.length) { toast(t("admin_config_no_models_returned")); return; }
      const list = document.getElementById("cfg_model_list");
      list.innerHTML = models.map((m) => `<button type="button" class="px-2 py-1 rounded-md border border-line bg-surface-2 text-xs" onclick="document.getElementById('cfg_chat_model').value=this.dataset.m" data-m="${_attr(m)}">${_esc(m)}</button>`).join("");
    } catch (e) {
      errorToast(t("admin_config_fetch_failed") + e.message);
    }
  }

  async testEmbed() {
    try {
      const body = { embed_base_url: document.getElementById("cfg_embed_base").value.trim(), embed_model: document.getElementById("cfg_embed_model").value.trim() };
      const ekey = document.getElementById("cfg_embed_key").value.trim();
      if (ekey) body.embed_api_key = ekey;
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      const r = await api("/api/settings/test-embed", { method: "POST" });
      if (r.ok) toast(`${t("admin_config_embeddings_ok")} (${r.dim} dims) at ${r.url}`);
      else errorToast(r.error || t("admin_config_embed_test_failed"));
    } catch (e) {
      errorToast(t("admin_config_test_failed") + e.message);
    }
  }

}

const ADMIN_CFG_SAMPLING_FIELDS = [
  { id: "temperature", label: "Temperature", min: 0, max: 2, step: 0.01, fallback: 0.85 },
  { id: "top_p", label: "Top-p", min: 0, max: 1, step: 0.01, fallback: 0.9 },
  { id: "top_k", label: "Top-k", min: 0, max: 100, step: 1, fallback: 0 },
  { id: "min_p", label: "Min-p", min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: "top_a", label: "Top-a", min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: "typical_p", label: "Typical-p", min: 0, max: 1, step: 0.01, fallback: 1 },
  { id: "tfs", label: "TFS", min: 0, max: 1, step: 0.01, fallback: 1 },
  { id: "repetition_penalty", label: "Repetition penalty", min: 0.5, max: 2, step: 0.01, fallback: 1 },
  { id: "repetition_penalty_range", label: "Rep. penalty range", min: 0, max: 2048, step: 16, fallback: 0 },
  { id: "frequency_penalty", label: "Frequency penalty", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "presence_penalty", label: "Presence penalty", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "smoothing_factor", label: "Smoothing", min: 0, max: 5, step: 0.01, fallback: 0 },
  { id: "dynatemp_low", label: "DynaTemp low", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "dynatemp_high", label: "DynaTemp high", min: 0, max: 2, step: 0.01, fallback: 0 },
  { id: "mirostat_tau", label: "Mirostat τ", min: 0, max: 10, step: 0.1, fallback: 5 },
  { id: "mirostat_eta", label: "Mirostat η", min: 0, max: 1, step: 0.01, fallback: 0.1 },
  { id: "dry_multiplier", label: "DRY multiplier", min: 0, max: 5, step: 0.01, fallback: 0 },
  { id: "dry_base", label: "DRY base", min: 0, max: 3, step: 0.01, fallback: 1.75 },
  { id: "dry_allowed_length", label: "DRY allowed length", min: 0, max: 50, step: 1, fallback: 2 },
  { id: "xtc_threshold", label: "XTC threshold", min: 0, max: 1, step: 0.01, fallback: 0.1 },
  { id: "xtc_probability", label: "XTC probability", min: 0, max: 1, step: 0.01, fallback: 0 },
];

Object.assign(AdminConfigView.prototype, {
  extraSectionsHtml() {
    const st = this.st;
    const sliderRows = ADMIN_CFG_SAMPLING_FIELDS.map((f) => `
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${f.label}</label>
        <div class="flex items-center gap-2">
          <input type="range" id="cfg_${f.id}_range" min="${f.min}" max="${f.max}" step="${f.step}" value="${st[f.id] ?? f.fallback}"
            oninput="document.getElementById('cfg_${f.id}').value = this.value" class="flex-1">
          <input type="number" id="cfg_${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${st[f.id] ?? f.fallback}"
            oninput="document.getElementById('cfg_${f.id}_range').value = this.value" class="w-20 px-2 py-1 rounded-md border border-line bg-surface text-ink text-xs font-mono">
        </div>
      </div>
    `).join("");

    return `
      <div class="mb-2 font-display font-semibold text-base text-ink">${t("admin_config_sampling_defaults")}</div>
      <p class="text-xs text-muted mb-3">${t("admin_config_sampling_defaults_description")}</p>
      <div class="grid grid-cols-2 gap-x-4 mb-3">${sliderRows}</div>
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label class="block text-xs text-sec mb-1">${t("admin_config_mirostat_mode")}</label>
          <input type="text" id="cfg_mirostat_mode" value="${_attr(st.mirostat_mode ?? 0)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
        <div>
          <label class="block text-xs text-sec mb-1">${t("admin_config_seed")} <span class="text-muted">${t("admin_config_seed_random_hint")}</span></label>
          <input type="text" id="cfg_seed" value="${_attr(st.seed ?? -1)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
        </div>
      </div>
      <div class="mb-4">
        <label class="block text-xs text-sec mb-1">${t("admin_config_stop_sequences")} <span class="text-muted">${t("admin_config_one_per_line_hint")}</span></label>
        <textarea id="cfg_stop" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-xs font-mono" style="min-height:52px">${_esc((st.stop || []).join("\n"))}</textarea>
      </div>
      <div class="mb-5">
        <label class="block text-xs text-sec mb-1">${t("admin_config_extra_params")} <span class="text-muted">${t("admin_config_json_hint")}</span></label>
        <textarea id="cfg_extra" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-xs font-mono" style="min-height:52px">${Object.keys(st.extra_params || {}).length ? _esc(JSON.stringify(st.extra_params, null, 2)) : ""}</textarea>
      </div>

      <div class="mb-2 font-display font-semibold text-base text-ink">${t("admin_config_prompt_injection")}</div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_config_system_suffix")}</label>
        <textarea id="cfg_suffix" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(st.system_suffix || "")}</textarea>
      </div>
      <div class="mb-5">
        <label class="block text-xs text-sec mb-1">${t("admin_config_post_history_instructions")}</label>
        <textarea id="cfg_posthist" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(st.post_history || "")}</textarea>
      </div>

      <div class="mb-2 font-display font-semibold text-base text-ink">${t("admin_config_backend")}</div>
      <p class="text-xs text-muted mb-2">${t("admin_config_backend_description")}</p>
      <div class="mb-5">
        <input type="text" id="cfg_api" value="${_attr(store.get("apiBase", ""))}" placeholder="${t("admin_config_same_origin_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>

      <button type="button" onclick="adminConfigView.save()" class="w-full py-3 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">
        ${t("admin_config_save_configuration")}
      </button>
    `;
  },

  numOrFallback(id, fallback) {
    const el = document.getElementById(id);
    const v = parseFloat(el?.value ?? "");
    if (isNaN(v)) return fallback;
    const min = el?.min !== undefined && el.min !== "" ? parseFloat(el.min) : -Infinity;
    const max = el?.max !== undefined && el.max !== "" ? parseFloat(el.max) : Infinity;
    return Math.min(max, Math.max(min, v));
  },

  intOrFallback(id, fallback) {
    const el = document.getElementById(id);
    const v = parseInt(el?.value ?? "", 10);
    if (isNaN(v)) return fallback;
    const min = el?.min !== undefined && el.min !== "" ? parseInt(el.min, 10) : -Infinity;
    const max = el?.max !== undefined && el.max !== "" ? parseInt(el.max, 10) : Infinity;
    return Math.min(max, Math.max(min, v));
  },

  async save() {
    this.syncMrHostsFromDom();
    const extraText = document.getElementById("cfg_extra").value.trim();
    let extra = {};
    if (extraText) {
      try { extra = JSON.parse(extraText); } catch (e) {
        errorToast("Extra params JSON is invalid - fix it before saving.");
        return;
      }
    }
    const newEmbedDim = this.intOrFallback("cfg_dim", 768);
    const originalEmbedDim = this.st.embed_dim ?? 768;
    if (newEmbedDim !== originalEmbedDim) {
      if (!(await confirmDialog(t("admin_config_confirm_change_embed_dim")))) {
        return;
      }
    }
    const urlFields = [["cfg_base", t("admin_config_chat_endpoint")], ["cfg_embed_base", t("admin_config_embed_endpoint")], ["cfg_comfy_url", "ComfyUI"]];
    for (const [id, label] of urlFields) {
      const value = document.getElementById(id).value.trim();
      if (!value) continue;
      try { new URL(value); } catch (e) {
        errorToast(`${label} ${t("admin_config_must_be_valid_url")}`);
        return;
      }
    }
    const strOrNull = (id) => document.getElementById(id).value.trim() || null;
    const body = {
      default_language: strOrNull("cfg_deflang") || "English",
      base_url: strOrNull("cfg_base"),
      chat_model: strOrNull("cfg_chat_model"),
      embed_base_url: strOrNull("cfg_embed_base"),
      embed_model: strOrNull("cfg_embed_model"),
      embed_dim: newEmbedDim,
      comfyui_url: strOrNull("cfg_comfy_url"),
      comfyui_checkpoint: strOrNull("cfg_comfy_ckpt"),
      wan_unet_name: strOrNull("cfg_wan_unet") || "",
      wan_clip_name: strOrNull("cfg_wan_clip") || "",
      wan_vae_name: strOrNull("cfg_wan_vae") || "",
      model_request_hosts: this.mrHosts.filter((h) => h.host).map((h) => ({ host: h.host, api_key: h.api_key || "" })),
      embed_link_hosts: (document.getElementById("cfg_embed_hosts").value || "").split("\n").map((s) => s.trim()).filter(Boolean),
      history_turns: this.intOrFallback("cfg_hist", 16),
      max_tokens: this.intOrFallback("cfg_max", 4096),
      enable_thinking: !!document.getElementById("cfg_think").checked,
      temperature: this.numOrFallback("cfg_temperature", 0.85),
      top_p: this.numOrFallback("cfg_top_p", 0.9),
      top_k: this.intOrFallback("cfg_top_k", 0),
      min_p: this.numOrFallback("cfg_min_p", 0),
      top_a: this.numOrFallback("cfg_top_a", 0),
      typical_p: this.numOrFallback("cfg_typical_p", 1),
      tfs: this.numOrFallback("cfg_tfs", 1),
      repetition_penalty: this.numOrFallback("cfg_repetition_penalty", 1),
      repetition_penalty_range: this.intOrFallback("cfg_repetition_penalty_range", 0),
      frequency_penalty: this.numOrFallback("cfg_frequency_penalty", 0),
      presence_penalty: this.numOrFallback("cfg_presence_penalty", 0),
      smoothing_factor: this.numOrFallback("cfg_smoothing_factor", 0),
      dynatemp_low: this.numOrFallback("cfg_dynatemp_low", 0),
      dynatemp_high: this.numOrFallback("cfg_dynatemp_high", 0),
      mirostat_mode: this.intOrFallback("cfg_mirostat_mode", 0),
      mirostat_tau: this.numOrFallback("cfg_mirostat_tau", 5),
      mirostat_eta: this.numOrFallback("cfg_mirostat_eta", 0.1),
      dry_multiplier: this.numOrFallback("cfg_dry_multiplier", 0),
      dry_base: this.numOrFallback("cfg_dry_base", 1.75),
      dry_allowed_length: this.intOrFallback("cfg_dry_allowed_length", 2),
      xtc_threshold: this.numOrFallback("cfg_xtc_threshold", 0.1),
      xtc_probability: this.numOrFallback("cfg_xtc_probability", 0),
      seed: this.intOrFallback("cfg_seed", -1),
      stop: (document.getElementById("cfg_stop").value || "").split("\n").map((s) => s.trim()).filter(Boolean),
      extra_params: extra,
      system_suffix: document.getElementById("cfg_suffix").value || null,
      post_history: document.getElementById("cfg_posthist").value || null,
    };
    const key = document.getElementById("cfg_key").value.trim();
    if (key) body.api_key = key;
    const ekey = document.getElementById("cfg_embed_key").value.trim();
    if (ekey) body.embed_api_key = ekey;
    const gkey = document.getElementById("cfg_giphy_key").value.trim();
    if (gkey) body.giphy_api_key = gkey;

    const newApiBase = document.getElementById("cfg_api").value.trim();
    if (newApiBase) {
      try { new URL(newApiBase); } catch (e) {
        errorToast(t("admin_config_backend_url_must_be_valid"));
        return;
      }
    }
    const apiBaseChanged = newApiBase !== store.get("apiBase", "");

    try {
      const r = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      if (apiBaseChanged) store.set("apiBase", newApiBase);
      this.st = r;
      this.mrHosts = (r.model_request_hosts || []).map((h) => ({ host: h.host || "", api_key: "", has_api_key: !!h.has_api_key }));
      toast(r.reindexed ? t("admin_config_saved_vector_index_rebuilt") : (apiBaseChanged ? t("admin_config_saved_reload_for_backend") : t("admin_config_configuration_saved")));
      this.render();
      this.loadWanOptions();
    } catch (e) {
      errorToast(t("admin_config_save_failed") + e.message);
    }
  },
});

AdminConfigView.prototype.render = function () {
  const st = this.st;
  this.main.innerHTML = `
    <div class="content-col">
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_config_title"), t("ph_admin_config_sub"))}

    <div class="mb-3">
      <label class="block text-xs text-sec mb-1">${t("admin_config_default_interface_language")}</label>
      <input type="text" id="cfg_deflang" value="${_attr(st.default_language || "English")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-1">${t("admin_config_resync_ui_translations_title")}</div>
      <p class="text-xs text-muted mb-3">${t("admin_config_resync_ui_translations_description")}</p>
      <button type="button" id="cfg_resync_ui_translations" onclick="adminConfigView.resyncUiTranslations()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_config_resync_ui_translations_button")}</button>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-1">${t("admin_config_identity_providers_title")}</div>
      <p class="text-xs text-muted mb-3">${t("admin_config_identity_providers_description")}</p>
      ${this.oauthProviders.map((p, i) => this.identityProviderRowHtml(p, i)).join("")}
      <button type="button" onclick="adminConfigView.saveIdentityProviders()" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark mt-1">${t("admin_config_identity_providers_save_button")}</button>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">${t("admin_config_chat_endpoint")}</div>
      <input type="text" id="cfg_base" value="${_attr(st.base_url || "")}" placeholder="http://koboldcpp:5001/v1" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <input type="password" autocomplete="new-password" id="cfg_key" placeholder="${st.has_api_key ? t("admin_config_key_set_placeholder") : t("admin_config_api_key_optional_placeholder")}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <div class="flex gap-2 mb-2">
        <input type="text" id="cfg_chat_model" value="${_attr(st.chat_model || "")}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <button type="button" onclick="adminConfigView.fetchModels()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_config_fetch")}</button>
      </div>
      <div id="cfg_model_list" class="flex flex-wrap gap-1.5"></div>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">${t("admin_config_embed_endpoint")} <span class="text-xs text-muted font-normal">${t("admin_config_blank_reuse_chat_endpoint")}</span></div>
      <input type="text" id="cfg_embed_base" value="${_attr(st.embed_base_url || "")}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <input type="password" autocomplete="new-password" id="cfg_embed_key" placeholder="${st.has_embed_api_key ? t("admin_config_key_set_placeholder") : t("admin_config_api_key_optional_placeholder")}" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <div class="grid grid-cols-2 gap-2 mb-2">
        <input type="text" id="cfg_embed_model" value="${_attr(st.embed_model || "")}" placeholder="nomic-embed-text" class="px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <input type="text" id="cfg_dim" value="${_attr(st.embed_dim ?? 768)}" class="px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      </div>
      <button type="button" onclick="adminConfigView.testEmbed()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_config_test")}</button>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">ComfyUI</div>
      <input type="text" id="cfg_comfy_url" value="${_attr(st.comfyui_url || "")}" placeholder="http://comfyui:8188" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
      <input type="text" id="cfg_comfy_ckpt" value="${_attr(st.comfyui_checkpoint || "")}" placeholder="${t("admin_config_default_checkpoint_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">${t("admin_config_wan_video_model")}</div>
      <p class="text-xs text-muted mb-2">${t("admin_config_wan_video_model_description")}</p>
      <label class="block text-xs text-sec mb-1">${t("admin_config_unet_file")}</label>
      <select id="cfg_wan_unet" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm"><option value="">${t("admin_config_loading")}</option></select>
      <label class="block text-xs text-sec mb-1">${t("admin_config_clip_text_encoder_file")}</label>
      <select id="cfg_wan_clip" class="w-full mb-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm"><option value="">${t("admin_config_loading")}</option></select>
      <label class="block text-xs text-sec mb-1">${t("admin_config_vae_file")}</label>
      <select id="cfg_wan_vae" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm"><option value="">${t("admin_config_loading")}</option></select>
    </div>

    <div class="rounded-[13px] border border-line bg-surface p-3.5 mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-3">Giphy</div>
      <p class="text-xs text-muted mb-2">${t("admin_config_giphy_description")}</p>
      <input type="password" autocomplete="new-password" id="cfg_giphy_key" placeholder="${st.has_giphy_api_key ? t("admin_config_key_set_placeholder") : t("admin_config_giphy_api_key_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
    </div>

    <div class="mb-4">
      <div class="font-display font-semibold text-sm text-ink mb-2">${t("admin_config_model_request_hosts")}</div>
      <p class="text-xs text-muted mb-2">${t("admin_config_model_request_hosts_description")}</p>
      <div id="cfg_mr_hosts">${this.mrHosts.map((h, i) => this.mrHostRowHtml(h, i)).join("")}</div>
      <button type="button" onclick="adminConfigView.addMrHostRow()" class="text-xs mt-1" style="color:var(--color-accent)">${t("admin_config_add_host")}</button>
    </div>

    <div class="mb-4">
      <label class="block text-xs text-sec mb-1">${t("admin_config_embed_link_preview_hosts")} <span class="text-muted">${t("admin_config_one_per_line_hint")}</span></label>
      <textarea id="cfg_embed_hosts" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm font-mono" style="min-height:60px">${_esc((st.embed_link_hosts || []).join("\n"))}</textarea>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_past_messages_remembered")}</label>
        <input type="text" id="cfg_hist" value="${_attr(st.history_turns ?? 16)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_max_reply_tokens")}</label>
        <input type="text" id="cfg_max" value="${_attr(st.max_tokens ?? 4096)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
    </div>
    <label class="flex items-center gap-2.5 mb-5 text-sm text-ink">
      <input type="checkbox" id="cfg_think" ${st.enable_thinking ? "checked" : ""}>
      ${t("admin_config_enable_thinking_by_default")}
    </label>

    ${this.extraSectionsHtml()}
    </div>
  `;
    document.querySelectorAll("[data-identity-provider-toggle]").forEach((btn) => {
      btn.onclick = () => this.toggleIdentityProviderEnabled(parseInt(btn.dataset.identityProviderToggle, 10));
    });
    document.querySelectorAll("[data-identity-provider-copy-callback]").forEach((btn) => {
      btn.onclick = () => this.copyIdentityProviderCallbackUrl(parseInt(btn.dataset.identityProviderCopyCallback, 10));
    });
};

if (typeof window !== "undefined") {
  window.AdminConfigView = AdminConfigView;
}
