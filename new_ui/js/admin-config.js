"use strict";

class AdminConfigView {
  async mount(main) {
    this.main = main;
    this.autosaveTimer = null;
    this.saveStatus = "";
    this.collapsed = {};
    try { this.collapsed = JSON.parse(store.get("admin_config_collapsed", "{}")) || {}; } catch (e) { this.collapsed = {}; }
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
    this.chatProxies = (this.st.chat_proxies || []).map((p) => ({ ...p, api_key: "" }));
    this.embedProxies = (this.st.embed_proxies || []).map((p) => ({ ...p, api_key: "" }));
    this.proxyCardsState = {
      chat: this.chatProxies, embed: this.embedProxies,
      image: this.buildProviderProxyList("image", this.st),
      video: this.buildProviderProxyList("video", this.st),
      gif: this.buildProviderProxyList("gif", this.st),
    };
    this.proxyCardsExpanded = new Set();
    this.proxyCardsEmojiGridOpen = null;
    this._proxyCardsGlobalName = "adminConfigView";
    this.render();
    this.loadWanOptions();
  }

  _providerLabels(kind) {
    if (kind === "image") return [
      ["comfyui", t("admin_config_image_provider_comfyui", "ComfyUI (self-hosted)")],
      ["openai", t("admin_config_image_provider_openai", "OpenAI-compatible API")],
      ["stability", t("admin_config_image_provider_stability", "Stability AI")],
      ["novelai", t("admin_config_image_provider_novelai", "NovelAI")],
      ["a1111", t("admin_config_image_provider_a1111", "AUTOMATIC1111")],
    ];
    if (kind === "video") return [
      ["comfyui", t("admin_config_video_provider_comfyui", "ComfyUI (Wan, self-hosted)")],
      ["gemini_veo", t("admin_config_video_provider_gemini_veo", "Google Gemini Veo")],
      ["qwen_wan", t("admin_config_video_provider_qwen_wan", "Qwen Wan (hosted)")],
      ["openrouter", t("admin_config_video_provider_openrouter", "OpenRouter")],
    ];
    return [["giphy", "Giphy"], ["tenor", "Tenor"], ["klipy", "Klipy"]];
  }

  buildProviderProxyList(kind, st) {
    if (kind === "gif") {
      const active = st.gif_provider || "giphy";
      return this._providerLabels("gif").map(([id, label]) => ({
        id, name: label, active: active === id, priority: 0,
        icon_type: "favicon", icon_value: "",
        base_url: id === "klipy" ? (st.klipy_customer_id || "") : "",
        model: "", api_key: "",
        has_api_key: id === "giphy" ? !!st.has_giphy_api_key : id === "tenor" ? !!st.has_tenor_api_key : !!st.has_klipy_api_key,
      }));
    }
    const configs = (kind === "image" ? st.image_provider_configs : st.video_provider_configs) || {};
    const active = (kind === "image" ? st.image_provider : st.video_provider) || "comfyui";
    return this._providerLabels(kind).map(([id, label]) => {
      const cfg = configs[id] || {};
      if (id === "comfyui") {
        return {
          id, name: label, active: active === id, priority: 0,
          icon_type: cfg.icon_type || "favicon", icon_value: cfg.icon_value || "",
          base_url: kind === "image" ? (st.comfyui_url || "") : "",
          model: kind === "image" ? (st.comfyui_checkpoint || "") : "",
          api_key: "", has_api_key: false,
        };
      }
      return {
        id, name: label, active: active === id, priority: 0,
        icon_type: cfg.icon_type || "favicon", icon_value: cfg.icon_value || "",
        base_url: cfg.url || "", model: cfg.model || "", api_key: "", has_api_key: !!cfg.has_key,
      };
    });
  }

  providerProxiesToBody(kind) {
    const list = this.proxyCardsState[kind] || [];
    const active = list.find((p) => p.active) || list[0];
    if (kind === "gif") {
      const out = { gif_provider: active ? active.id : "giphy" };
      const giphy = list.find((p) => p.id === "giphy");
      const tenor = list.find((p) => p.id === "tenor");
      const klipy = list.find((p) => p.id === "klipy");
      if (giphy?.api_key) out.giphy_api_key = giphy.api_key;
      if (tenor?.api_key) out.tenor_api_key = tenor.api_key;
      if (klipy?.api_key) out.klipy_api_key = klipy.api_key;
      out.klipy_customer_id = klipy?.base_url || "";
      return out;
    }
    const configs = {};
    for (const p of list) {
      configs[p.id] = {
        url: p.id === "comfyui" ? "" : (p.base_url || ""),
        model: p.id === "comfyui" ? "" : (p.model || ""),
        key: p.id === "comfyui" ? "" : (p.api_key || ""),
        icon_type: p.icon_type || "favicon", icon_value: p.icon_value || "",
      };
    }
    const provField = kind === "image" ? "image_provider" : "video_provider";
    const configsField = kind === "image" ? "image_provider_configs" : "video_provider_configs";
    const out = { [provField]: active ? active.id : "comfyui", [configsField]: configs };
    if (kind === "image") {
      const comfy = list.find((p) => p.id === "comfyui");
      out.comfyui_url = comfy?.base_url || "";
      out.comfyui_checkpoint = comfy?.model || "";
    }
    return out;
  }

  onProxyCardsChanged(immediate) {
    if (immediate) this.autosave();
    else this.scheduleAutosave();
  }

  toggleSection(key) {
    this.collapsed[key] = !this.collapsed[key];
    store.set("admin_config_collapsed", JSON.stringify(this.collapsed));
    this.render();
  }

  toggleCard(key) {
    const storeKey = `card:${key}`;
    this.collapsed[storeKey] = !this.collapsed[storeKey];
    store.set("admin_config_collapsed", JSON.stringify(this.collapsed));
    this.render();
  }

  sectionHtml(key, title, contentHtml) {
    const isCollapsed = !!this.collapsed[key];
    return `
      <div class="rounded-[13px] border border-line bg-surface mb-3">
        <button type="button" onclick="adminConfigView.toggleSection('${key}')" class="w-full flex items-center gap-2 px-3.5 py-3 text-left rounded-[13px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${isCollapsed ? "-90deg" : "0deg"});transition:transform .15s;flex:none;color:var(--color-muted)"><path d="M6 9l6 6 6-6"/></svg>
          <span class="font-display font-semibold text-sm text-ink flex-1">${title}</span>
        </button>
        <div class="px-3.5 pb-3.5${isCollapsed ? " hidden" : ""}" data-section-content="${key}">${contentHtml}</div>
      </div>
    `;
  }

  scheduleAutosave() {
    this.saveStatus = "saving";
    this.updateSaveStatusHtml();
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosave(), 900);
  }

  updateSaveStatusHtml() {
    const el = document.getElementById("cfgSaveStatus");
    if (!el) return;
    el.style.color = this.saveStatus === "error" ? "var(--color-warn)" : "var(--color-muted)";
    if (this.saveStatus === "saving") el.textContent = t("admin_config_saving", "Saving…");
    else if (this.saveStatus === "saved") el.textContent = t("admin_config_saved", "Saved");
    else if (this.saveStatus === "error") el.textContent = t("admin_config_save_error", "Couldn't save — check for errors");
    else el.textContent = "";
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
    let unets, clips, vaes;
    try {
      [unets, clips, vaes] = await Promise.all([
        api("/api/imagegen/wan-unets"),
        api("/api/imagegen/wan-clip-models"),
        api("/api/imagegen/vaes"),
      ]);
    } catch (e) {
      errorToast(t("admin_config_wan_options_load_failed", "Couldn't load ComfyUI's UNET/CLIP/VAE file lists: ") + e.message);
      return;
    }
    this.wanUnetOptions = unets;
    this.wanClipOptions = clips;
    this.wanVaeOptions = vaes;
    this.render();
  }

  customSelectHtml(id, names, current) {
    const options = ["", ...names];
    const currentLabel = current ? current : t("admin_config_none");
    return `
      <div class="relative" data-custom-select="${id}">
        <input type="hidden" id="${id}" value="${_attr(current || "")}">
        <button type="button" data-custom-select-trigger="${id}" class="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm text-left">
          <span data-custom-select-label="${id}" class="truncate">${_esc(currentLabel)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="dropdown-menu" data-custom-select-menu="${id}" style="left:0;inset-inline-end:auto;width:100%;max-height:240px;overflow-y:auto">
          ${options.map((n) => `<button type="button" class="dropdown-item${n === (current || "") ? " active" : ""}" data-custom-select-item="${id}" data-value="${_attr(n)}">${n ? _esc(n) : _esc(t("admin_config_none"))}</button>`).join("")}
        </div>
      </div>
    `;
  }

  fillCustomSelect(id, names, current) {
    const wrap = this.main.querySelector(`[data-custom-select="${id}"]`);
    if (!wrap) return;
    wrap.outerHTML = this.customSelectHtml(id, names, current);
    this.wireCustomSelectRow(id);
  }

  wireCustomSelectRow(id) {
    const trigger = this.main.querySelector(`[data-custom-select-trigger="${id}"]`);
    if (!trigger) return;
    trigger.onclick = (e) => {
      e.stopPropagation();
      const menu = this.main.querySelector(`[data-custom-select-menu="${id}"]`);
      const isOpen = menu.classList.contains("open");
      this.main.querySelectorAll(".dropdown-menu.open").forEach((m) => m.classList.remove("open"));
      if (!isOpen) menu.classList.add("open");
    };
    this.main.querySelectorAll(`[data-custom-select-item="${id}"]`).forEach((item) => {
      item.onclick = () => {
        const value = item.dataset.value;
        const hidden = document.getElementById(id);
        const label = this.main.querySelector(`[data-custom-select-label="${id}"]`);
        hidden.value = value;
        if (label) label.textContent = item.textContent;
        this.main.querySelectorAll(`[data-custom-select-item="${id}"]`).forEach((el) => el.classList.toggle("active", el === item));
        this.main.querySelector(`[data-custom-select-menu="${id}"]`).classList.remove("open");
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      };
    });
  }

  wireAllCustomSelects() {
    this.main.querySelectorAll("[data-custom-select]").forEach((wrap) => this.wireCustomSelectRow(wrap.dataset.customSelect));
    if (!this._customSelectCloseWired) {
      this._customSelectCloseWired = true;
      document.addEventListener("click", () => {
        document.querySelectorAll(".dropdown-menu.open").forEach((m) => m.classList.remove("open"));
      });
    }
  }

  _identityProviderIconSvg(provider) {
    const icons = {
      google: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>`,
      facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>`,
      github: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
      discord: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>`,
      twitter: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg>`,
      reddit: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg>`,
      microsoft: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 0v11.408h11.408V0zm12.594 0v11.408H24V0zM0 12.594V24h11.408V12.594zm12.594 0V24H24V12.594z"/></svg>`,
      steam: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/></svg>`,
      apple: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`,
    };
    return icons[provider] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`;
  }

  identityProviderMedallionHtml(p, size) {
    return `
      <span class="relative rounded-full flex items-center justify-center flex-none overflow-hidden" style="width:${size}px;height:${size}px;background:radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--color-accent) 30%, var(--color-surface-2)), var(--color-surface-2) 70%);border:1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-line-2));color:var(--color-accent)">
        <span style="width:${Math.round(size * 0.5)}px;height:${Math.round(size * 0.5)}px">${this._identityProviderIconSvg(p.provider)}</span>
      </span>
    `;
  }

  identityProviderLogoHtml(p, i) {
    return `
      <button type="button" onclick="adminConfigView.openIdentityProviderModal(${i})" class="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-line-2" style="background:var(--color-surface-2)">
        ${this.identityProviderMedallionHtml(p, 36)}
        <span class="text-[11px] text-ink font-medium">${_esc(p.label)}</span>
        <span class="w-1.5 h-1.5 rounded-full" style="background:${p.enabled ? "var(--color-success)" : "var(--color-line-2)"}"></span>
      </button>
    `;
  }

  openIdentityProviderModal(i) {
    const p = this.oauthProviders[i];
    if (!p) return;
    openModal(`
      <div class="flex items-center gap-2.5 mb-1">
        ${this.identityProviderMedallionHtml(p, 32)}
        <h3 class="m-0">${_esc(p.label)}</h3>
      </div>
      <label class="flex items-center justify-between gap-2 mb-3 text-sm text-ink">
        ${t("admin_config_identity_provider_enabled", "Enabled")}
        <button type="button" id="idpModalToggle" class="settings-toggle${p.enabled ? " on" : ""}"><span class="settings-toggle-knob"></span></button>
      </label>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_config_identity_provider_client_id_placeholder")}</label>
        <input type="text" id="idpModalClientId" value="${_attr(p.client_id)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_config_identity_provider_client_secret_placeholder")}</label>
        <input type="password" autocomplete="new-password" id="idpModalClientSecret" placeholder="${p.has_client_secret ? t("admin_config_identity_provider_client_secret_set_placeholder") : t("admin_config_identity_provider_client_secret_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div class="mb-4">
        <div class="text-xs text-muted mb-1">${t("admin_config_identity_provider_callback_url_label")}</div>
        <div class="flex items-center gap-1.5">
          <input type="text" readonly value="${_attr(this.identityProviderCallbackUrl(p.provider))}" class="w-full px-2.5 py-1.5 rounded-md border border-line bg-surface-2 text-muted text-xs" onclick="this.select()">
          <button type="button" id="idpModalCopy" class="shrink-0 px-2 py-1.5 rounded-md border border-line text-xs text-ink">${t("admin_config_identity_provider_callback_url_copy_button")}</button>
        </div>
      </div>
      <button type="button" id="idpModalSave" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_config_identity_providers_save_button")}</button>
    `);
    const toggle = document.getElementById("idpModalToggle");
    toggle.onclick = () => toggle.classList.toggle("on");
    document.getElementById("idpModalCopy").onclick = () => this.copyIdentityProviderCallbackUrl(i);
    document.getElementById("idpModalSave").onclick = async () => {
      p.enabled = toggle.classList.contains("on");
      p.client_id = document.getElementById("idpModalClientId").value.trim();
      const secret = document.getElementById("idpModalClientSecret").value;
      if (secret) p.client_secret = secret;
      closeTopModal();
      await this.saveIdentityProviders();
    };
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

  async saveIdentityProviders() {
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

  medallionHtml(fallbackSvg, originUrl) {
    let cleanOrigin = "";
    if (originUrl) { try { cleanOrigin = new URL(originUrl).origin; } catch (e) {  } }
    return `
      <span class="relative w-8 h-8 rounded-full flex items-center justify-center flex-none overflow-hidden" style="background:radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--color-accent) 30%, var(--color-surface-2)), var(--color-surface-2) 70%);border:1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-line-2));color:var(--color-accent)">
        <span style="width:16px;height:16px">${fallbackSvg}</span>
        ${cleanOrigin ? `<img src="${_attr(cleanOrigin)}/favicon.ico" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">` : ""}
      </span>
    `;
  }


  async testEmbed() {
    this.syncProxiesFromDom("embed");
    const active = this.embedProxies.find((p) => p.active);
    try {
      const body = { embed_base_url: active?.base_url || "", embed_model: active?.model || "" };
      if (active?.api_key) body.embed_api_key = active.api_key;
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      const r = await api("/api/settings/test-embed", { method: "POST" });
      if (r.ok) toast(`${t("admin_config_embeddings_ok")} (${r.dim} dims) at ${r.url}`);
      else errorToast(r.error || t("admin_config_embed_test_failed"));
    } catch (e) {
      errorToast(t("admin_config_test_failed") + e.message);
    }
  }

}

Object.assign(AdminConfigView.prototype, ProxyCardsMixin);

const _mixinSetActiveProxy = AdminConfigView.prototype.setActiveProxy;
const _mixinFetchModelsForRow = AdminConfigView.prototype.fetchModelsForRow;
const _mixinToggleProxyExpand = AdminConfigView.prototype.toggleProxyExpand;
Object.assign(AdminConfigView.prototype, {
  toggleProxyExpand(kind, id) {
    _mixinToggleProxyExpand.call(this, kind, id);
    if (kind === "video" && id === "comfyui" && this.proxyCardsExpanded.has(`${kind}:${id}`)) {
      this.loadWanOptions();
    }
  },

  setActiveProxy(kind, id) {
    _mixinSetActiveProxy.call(this, kind, id);
    if (kind === "image") this.st.image_provider = id;
    if (kind === "video") this.st.video_provider = id;
    if (kind === "gif") this.st.gif_provider = id;
  },

  async fetchModelsForRow(kind, id) {
    if (kind === "image" && id === "comfyui") {
      const listEl = document.querySelector(`[data-proxy-model-list="${kind}-${id}"]`);
      try {
        const unets = await api("/api/imagegen/anima-unets");
        if (!unets?.length) { toast(t("proxy_cards_no_models_returned", "No models returned")); return; }
        if (listEl) {
          listEl.innerHTML = unets.map((m) => `<button type="button" class="px-2 py-1 rounded-md border border-line bg-surface-2 text-xs" onclick="adminConfigView.pickModelForRow('${kind}', '${id}', this.dataset.m)" data-m="${_attr(m)}">${_esc(m)}</button>`).join("");
        }
      } catch (e) {
        errorToast(t("proxy_cards_fetch_failed", "Fetch failed: ") + e.message);
      }
      return;
    }
    return _mixinFetchModelsForRow.call(this, kind, id);
  },

  videoComfyuiExtraHtml() {
    const st = this.st;
    if ((st.image_provider || "comfyui") !== "comfyui") {
      return `<p class="text-xs mt-1.5" style="color:var(--color-warn)">${t("admin_config_wan_needs_comfyui_image_provider", "ComfyUI (Wan) needs Image generation's Backend set to ComfyUI too — it's currently pointed at a different provider above.")}</p>`;
    }
    return `
      <p class="text-xs text-muted mb-1.5 mt-1.5">${t("admin_config_wan_video_model_description")}</p>
      <div class="rounded-md border border-line p-2.5">
        <label class="block text-xs text-sec mb-1">${t("admin_config_unet_file")}</label>
        <div class="mb-2">${this.customSelectHtml("cfg_wan_unet", [], st.wan_unet_name)}</div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_clip_text_encoder_file")}</label>
        <div class="mb-2">${this.customSelectHtml("cfg_wan_clip", [], st.wan_clip_name)}</div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_vae_file")}</label>
        ${this.customSelectHtml("cfg_wan_vae", [], st.wan_vae_name)}
      </div>
    `;
  },
});

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
  samplingHtml() {
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
      <p class="text-xs text-muted mb-3">${t("admin_config_sampling_defaults_description")}</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 mb-3">${sliderRows}</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
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
      <div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_extra_params")} <span class="text-muted">${t("admin_config_json_hint")}</span></label>
        <textarea id="cfg_extra" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-xs font-mono" style="min-height:52px">${Object.keys(st.extra_params || {}).length ? _esc(JSON.stringify(st.extra_params, null, 2)) : ""}</textarea>
      </div>
    `;
  },

  injectionHtml() {
    const st = this.st;
    return `
      <div class="mb-3">
        <label class="block text-xs text-sec mb-1">${t("admin_config_system_suffix")}</label>
        <textarea id="cfg_suffix" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(st.system_suffix || "")}</textarea>
      </div>
      <div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_post_history_instructions")}</label>
        <textarea id="cfg_posthist" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm" style="min-height:68px">${_esc(st.post_history || "")}</textarea>
      </div>
    `;
  },

  backendHtml() {
    return `
      <p class="text-xs text-muted mb-2">${t("admin_config_backend_description")}</p>
      <input type="text" id="cfg_api" value="${_attr(store.get("apiBase", ""))}" placeholder="${t("admin_config_same_origin_placeholder")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
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

  async autosave() {
    this.syncMrHostsFromDom();
    this.syncProxiesFromDom("chat");
    this.syncProxiesFromDom("embed");
    this.syncProxiesFromDom("image");
    this.syncProxiesFromDom("video");
    this.syncProxiesFromDom("gif");
    const extraText = document.getElementById("cfg_extra").value.trim();
    let extra = {};
    if (extraText) {
      try { extra = JSON.parse(extraText); } catch (e) {
        this.saveStatus = "error";
        this.updateSaveStatusHtml();
        return;
      }
    }
    const originalEmbedDim = this.st.embed_dim ?? 768;
    const dimEl = document.getElementById("cfg_dim");
    const newEmbedDim = dimEl ? this.intOrFallback("cfg_dim", originalEmbedDim) : originalEmbedDim;
    if (newEmbedDim !== originalEmbedDim) {
      this.saveStatus = "";
      this.updateSaveStatusHtml();
      if (!(await confirmDialog(t("admin_config_confirm_change_embed_dim")))) {
        document.getElementById("cfg_dim").value = originalEmbedDim;
        return;
      }
    }
    const proxyUrlFields = [...this.chatProxies, ...this.embedProxies];
    for (const p of proxyUrlFields) {
      if (!p.base_url) continue;
      try { new URL(p.base_url); } catch (e) {
        this.saveStatus = "error";
        this.updateSaveStatusHtml();
        return;
      }
    }
    const urlFields = [["cfg_comfy_url", "ComfyUI"]];
    for (const [id, label] of urlFields) {
      const value = document.getElementById(id)?.value.trim() || "";
      if (!value) continue;
      try { new URL(value); } catch (e) {
        this.saveStatus = "error";
        this.updateSaveStatusHtml();
        return;
      }
    }
    const strOrNull = (id) => document.getElementById(id)?.value.trim() || null;
    const body = {
      default_language: strOrNull("cfg_deflang") || "English",
      chat_proxies: this.chatProxies.map((p) => ({ id: p.id, name: p.name || "", base_url: p.base_url || "", api_key: p.api_key || "", model: p.model || "", active: !!p.active, icon_type: p.icon_type || "favicon", icon_value: p.icon_value || "", priority: p.priority ?? 0 })),
      embed_proxies: this.embedProxies.map((p) => ({ id: p.id, name: p.name || "", base_url: p.base_url || "", api_key: p.api_key || "", model: p.model || "", active: !!p.active, icon_type: p.icon_type || "favicon", icon_value: p.icon_value || "" })),
      embed_dim: newEmbedDim,
      ...this.providerProxiesToBody("image"),
      ...this.providerProxiesToBody("video"),
      ...this.providerProxiesToBody("gif"),
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
    const newApiBase = document.getElementById("cfg_api").value.trim();
    if (newApiBase) {
      try { new URL(newApiBase); } catch (e) {
        this.saveStatus = "error";
        this.updateSaveStatusHtml();
        return;
      }
    }
    const apiBaseChanged = newApiBase !== store.get("apiBase", "");

    try {
      const r = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      if (apiBaseChanged) store.set("apiBase", newApiBase);
      this.st = r;
      this.mrHosts = (r.model_request_hosts || []).map((h) => ({ host: h.host || "", api_key: "", has_api_key: !!h.has_api_key }));
      this.chatProxies = (r.chat_proxies || []).map((p) => ({ ...p, api_key: "" }));
      this.embedProxies = (r.embed_proxies || []).map((p) => ({ ...p, api_key: "" }));
      this.proxyCardsState.chat = this.chatProxies;
      this.proxyCardsState.embed = this.embedProxies;
      this.proxyCardsState.image = this.buildProviderProxyList("image", r);
      this.proxyCardsState.video = this.buildProviderProxyList("video", r);
      this.proxyCardsState.gif = this.buildProviderProxyList("gif", r);
      if (r.reindexed) toast(t("admin_config_saved_vector_index_rebuilt"));
      else if (apiBaseChanged) toast(t("admin_config_saved_reload_for_backend"));
      this.saveStatus = "saved";
      this.updateSaveStatusHtml();
    } catch (e) {
      this.saveStatus = "error";
      this.updateSaveStatusHtml();
      errorToast(t("admin_config_save_failed") + e.message);
    }
  },
});

AdminConfigView.prototype.render = function () {
  const st = this.st;

  const languageContent = `
    <label class="block text-xs text-sec mb-1">${t("admin_config_default_interface_language")}</label>
    <input type="text" id="cfg_deflang" value="${_attr(st.default_language || "English")}" class="w-full mb-3 px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
    <div class="font-display font-semibold text-sm text-ink mb-1">${t("admin_config_resync_ui_translations_title")}</div>
    <p class="text-xs text-muted mb-3">${t("admin_config_resync_ui_translations_description")}</p>
    <button type="button" id="cfg_resync_ui_translations" onclick="adminConfigView.resyncUiTranslations()" class="px-3 py-2 rounded-md border border-line text-xs text-ink">${t("admin_config_resync_ui_translations_button")}</button>
  `;

  const dossierIcons = {
    identity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/></svg>`,
    gif: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10v4M11 10v4M11 12h1.5M16 10h-2v4h2M14 12h1.5"/></svg>`,
    hosts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="6" rx="1.5"/><rect x="2" y="14" width="20" height="6" rx="1.5"/><circle cx="6" cy="7" r="0.6" fill="currentColor" stroke="none"/><circle cx="6" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>`,
  };
  const statusDotHtml = (tone) => `<span class="w-1.5 h-1.5 rounded-full flex-none" style="background:${tone === "warn" ? "var(--color-warn)" : tone === "off" ? "var(--color-line-2)" : "var(--color-success)"}"></span>`;
  const dossierCardOpen = (key, fallbackIcon, logoOrigin, title, subtitle, status, statusTone) => {
    const isCollapsed = !!this.collapsed[`card:${key}`];
    return `
    <div class="rounded-xl border border-line-2 bg-paper mb-3">
      <button type="button" onclick="adminConfigView.toggleCard('${key}')" class="w-full flex items-start gap-2.5 p-3.5 text-left rounded-xl">
        ${this.medallionHtml(fallbackIcon, logoOrigin)}
        <div class="min-w-0 flex-1">
          <div class="font-display font-semibold text-sm text-ink leading-tight">${title}</div>
          ${subtitle ? `<div class="font-mono text-[10px] text-muted leading-snug mt-0.5">${subtitle}</div>` : ""}
          ${status ? `<div class="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[.04em] text-muted mt-1.5">${statusDotHtml(statusTone)}${status}</div>` : ""}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${isCollapsed ? "-90deg" : "0deg"});transition:transform .15s;flex:none;color:var(--color-muted);margin-top:2px"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="px-3.5 pb-3.5${isCollapsed ? " hidden" : ""}" data-dossier-card-content="${key}">
      <hr class="mb-3" style="border:none;border-top:1px dashed var(--color-line-2)">
  `;
  };
  const cardClose = `</div></div>`;

  const enabledIdps = this.oauthProviders.filter((p) => p.enabled).length;
  const imageOrigin = (st.image_provider || "comfyui") === "comfyui" ? st.comfyui_url : st.image_provider_url;
  const videoOrigin = (st.video_provider || "comfyui") === "comfyui" ? st.comfyui_url : st.video_provider_url;

  const integrationsContent = `
    ${dossierCardOpen("idp", dossierIcons.identity, "", t("admin_config_identity_providers_title"), t("admin_config_identity_providers_description"), enabledIdps ? `${enabledIdps} ${t("admin_config_status_enabled", "enabled")}` : t("admin_config_status_none_enabled", "none enabled"), enabledIdps ? "" : "off")}
      <div class="grid grid-cols-3 gap-2">
        ${this.oauthProviders.map((p, i) => this.identityProviderLogoHtml(p, i)).join("")}
      </div>
    ${cardClose}

    ${dossierCardOpen("image", dossierIcons.image, imageOrigin, t("admin_config_image_provider_title", "Image generation"), t("admin_config_image_provider_description", "Pick which service generates images. ComfyUI is the self-hosted default. Hosted providers use their own URL, model and key."), imageOrigin ? t("admin_config_status_configured", "configured") : t("admin_config_status_not_configured", "not configured"), imageOrigin ? "" : "warn")}
      ${this.proxyListHtml("image", t("admin_config_no_proxies", "No profiles yet."))}
    ${cardClose}

    ${dossierCardOpen("video", dossierIcons.video, videoOrigin, t("admin_config_video_provider_title", "Video generation"), t("admin_config_video_provider_description", "Pick which service generates video. ComfyUI (Wan) is the self-hosted default. Hosted providers use their own URL, model and key."), videoOrigin ? t("admin_config_status_configured", "configured") : t("admin_config_status_not_configured", "not configured"), videoOrigin ? "" : "warn")}
      ${this.proxyListHtml("video", t("admin_config_no_proxies", "No profiles yet."))}
    ${cardClose}

    ${(() => {
      const gp = st.gif_provider || "giphy";
      const gifConfigured = gp === "giphy" ? st.has_giphy_api_key : gp === "tenor" ? st.has_tenor_api_key : st.has_klipy_api_key;
      return `
    ${dossierCardOpen("giphy", dossierIcons.gif, "", t("admin_config_gif_providers_title", "GIF providers"), t("admin_config_giphy_description"), gifConfigured ? t("admin_config_status_key_set", "key set") : t("admin_config_status_no_key", "no key set"), gifConfigured ? "" : "warn")}
      ${this.proxyListHtml("gif", t("admin_config_no_proxies", "No profiles yet."))}
    ${cardClose}
      `;
    })()}

    ${dossierCardOpen("hosts", dossierIcons.hosts, "", t("admin_config_model_request_hosts"), t("admin_config_model_request_hosts_description"), `${this.mrHosts.length} ${t("admin_config_status_hosts", "hosts")}`, this.mrHosts.length ? "" : "off")}
      <div id="cfg_mr_hosts">${this.mrHosts.map((h, i) => this.mrHostRowHtml(h, i)).join("")}</div>
      <button type="button" onclick="adminConfigView.addMrHostRow()" class="text-xs mb-3" style="color:var(--color-accent)">${t("admin_config_add_host")}</button>
      <label class="block text-xs text-sec mb-1">${t("admin_config_embed_link_preview_hosts")} <span class="text-muted">${t("admin_config_one_per_line_hint")}</span></label>
      <textarea id="cfg_embed_hosts" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm font-mono" style="min-height:60px">${_esc((st.embed_link_hosts || []).join("\n"))}</textarea>
    ${cardClose}
  `;

  const chatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
  const embedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.4L15.8 4.6M8.2 7.9L11 15.8M15.8 7.9L13 15.8"/></svg>`;
  const chatActive = this.chatProxies.reduce((best, p) =>
    !best || (p.priority ?? 0) < (best.priority ?? 0) ? p : best, null);
  const embedActive = this.embedProxies.find((p) => p.active);

  const modelsContent = `
    ${dossierCardOpen("chat_endpoint", chatIcon, "", t("admin_config_chat_endpoint"), t("admin_config_proxy_multi_hint", "Save several backend profiles with a priority number each. Every reply starts at priority 0 - if that one fails, the server automatically retries the next-lowest number for you, so a paid API can quietly back up a free/local one going down."), chatActive ? `${this.chatProxies.length} ${t("admin_config_status_profiles", "profiles")} · ${_esc(chatActive.name || t("admin_config_proxy_untitled", "Untitled profile"))}` : t("admin_config_status_no_profiles", "no profiles"), chatActive ? "" : "warn")}
      <div id="cfg_chat_proxies">${this.proxyListHtml("chat", t("admin_config_no_proxies", "No profiles yet — add one."))}</div>
      <button type="button" onclick="adminConfigView.addProxyRow('chat')" class="w-full mt-1 py-2 rounded-md border border-line text-xs text-ink" style="border-style:dashed">${t("admin_config_add_proxy", "+ Add profile")}</button>
    ${cardClose}

    ${dossierCardOpen("embed_endpoint", embedIcon, "", t("admin_config_embed_endpoint"), t("admin_config_blank_reuse_chat_endpoint"), embedActive ? `${this.embedProxies.length} ${t("admin_config_status_profiles", "profiles")} · ${_esc(embedActive.name || t("admin_config_proxy_untitled", "Untitled profile"))}` : t("admin_config_status_reusing_chat", "reusing chat endpoint"), embedActive ? "" : "off")}
      <div id="cfg_embed_proxies">${this.proxyListHtml("embed", t("admin_config_no_proxies_embed", "No profiles yet — leave empty to reuse the chat endpoint, or add one."))}</div>
      <button type="button" onclick="adminConfigView.addProxyRow('embed')" class="w-full mt-1 py-2 rounded-md border border-line text-xs text-ink" style="border-style:dashed">${t("admin_config_add_proxy", "+ Add profile")}</button>
      ${this.embedProxies.length ? "" : `
        <label class="block text-xs text-sec mb-1 mt-1.5">${t("admin_config_embed_dim", "Embedding dimension")}</label>
        <div class="flex gap-2">
          <input type="text" id="cfg_dim" value="${_attr(st.embed_dim ?? 768)}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <button type="button" onclick="adminConfigView.testEmbed()" class="px-3 py-2 rounded-md border border-line text-xs text-ink flex-none">${t("admin_config_test")}</button>
        </div>
      `}
    ${cardClose}
  `;


  const behaviorContent = `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_past_messages_remembered")}</label>
        <input type="text" id="cfg_hist" value="${_attr(st.history_turns ?? 16)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
      <div>
        <label class="block text-xs text-sec mb-1">${t("admin_config_max_reply_tokens")}</label>
        <input type="text" id="cfg_max" value="${_attr(st.max_tokens ?? 4096)}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm">
      </div>
    </div>
    <label class="flex items-center gap-2.5 text-sm text-ink">
      <input type="checkbox" id="cfg_think" ${st.enable_thinking ? "checked" : ""}>
      ${t("admin_config_enable_thinking_by_default")}
    </label>
  `;

  this.main.innerHTML = `
    <div class="content-col admin-config-content">
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_config_title"), t("ph_admin_config_sub"))}
    ${adminScreenSwitcherHtml("admin-config", window._adminSwitcherBadges || {})}
    <div class="flex justify-end mb-3">
      <span id="cfgSaveStatus" class="font-mono text-[10px] tracking-[.08em] uppercase text-muted"></span>
    </div>
    <div class="admin-config-grid">
      <div class="admin-config-col">
        ${this.sectionHtml("models", t("admin_config_models_section", "Models"), modelsContent)}
        ${this.sectionHtml("integrations", t("admin_config_integrations_section", "Integrations"), integrationsContent)}
      </div>
      <div class="admin-config-col">
        ${this.sectionHtml("language", t("admin_config_language_section", "Language & translations"), languageContent)}
        ${this.sectionHtml("behavior", t("admin_config_behavior_section", "Chat behavior"), behaviorContent)}
        ${this.sectionHtml("sampling", t("admin_config_sampling_defaults"), this.samplingHtml())}
        ${this.sectionHtml("injection", t("admin_config_prompt_injection"), this.injectionHtml())}
        ${this.sectionHtml("backend", t("admin_config_backend"), this.backendHtml())}
      </div>
    </div>
    </div>
  `;
  adminAttachScreenSwitcher(this.main);
  this.updateSaveStatusHtml();
  this.wireAllCustomSelects();

  const autosaveScopes = ["models", "imagegen", "giphy", "hosts", "behavior", "sampling", "injection", "backend", "language"];
  const autosaveHandler = (e) => {
    if (e.target.closest("[data-proxy-row]")) return;
    this.scheduleAutosave();
  };
  autosaveScopes.forEach((key) => {
    const el = this.main.querySelector(`[data-section-content="${key}"]`);
    if (!el) return;
    el.addEventListener("input", autosaveHandler);
    el.addEventListener("change", autosaveHandler);
  });
};

if (typeof window !== "undefined") {
  window.AdminConfigView = AdminConfigView;
}
