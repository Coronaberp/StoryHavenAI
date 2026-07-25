"use strict";

function _proxyId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

const _PROXY_CARDS_ICON_SAVE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;

function _sanitizeIconSvg(raw) {
  const stripped = (raw || "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return DOMPurify.sanitize(stripped, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style", "title", "desc"],
    ADD_ATTR: ["viewBox", "preserveAspectRatio", "xmlns", "class"],
  });
}

function _svgIconDataUri(sanitizedSvg) {
  if (!sanitizedSvg) return "";
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(sanitizedSvg)))}`;
}

function proxyIconHtml(p, size) {
  let originUrl = "";
  try { originUrl = p.base_url ? new URL(p.base_url).origin : ""; } catch (e) {  }
  if (p.icon_type === "emoji" && p.icon_value) {
    return `<span class="rounded-md flex items-center justify-center flex-none" style="width:${size}px;height:${size}px;background:var(--color-surface-2);font-size:${Math.round(size * 0.6)}px;line-height:1">${_esc(p.icon_value)}</span>`;
  }
  if (p.icon_type === "image" && p.icon_value) {
    return `<img src="${_attr(p.icon_value)}" class="rounded-md object-cover flex-none" style="width:${size}px;height:${size}px">`;
  }
  if (p.icon_type === "svg" && p.icon_value) {
    return `<div class="rounded-md flex items-center justify-center flex-none overflow-hidden" style="width:${size}px;height:${size}px;padding:${Math.round(size * 0.12)}px;background:var(--color-surface-2)"><img src="${_attr(_svgIconDataUri(_sanitizeIconSvg(p.icon_value)))}" style="width:100%;height:100%;object-fit:contain" alt=""></div>`;
  }
  return `
    <div class="relative rounded-md flex items-center justify-center flex-none" style="width:${size}px;height:${size}px;background:var(--color-surface-2)">
      <svg class="text-muted" width="${Math.round(size * 0.55)}" height="${Math.round(size * 0.55)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg>
      ${originUrl ? `<img src="${originUrl}/favicon.ico" class="absolute inset-0 w-full h-full rounded-md object-cover" onerror="this.remove()">` : ""}
    </div>
  `;
}

function readOnlyProxyCardHtml(p) {
  const label = p.name || t("proxy_cards_untitled", "Untitled profile");
  return `
    <div class="rounded-md border p-2.5 mb-2 flex items-center gap-2.5" style="border-color:${p.active ? "var(--color-accent)" : "var(--color-line)"}">
      ${proxyIconHtml(p, 36)}
      <span class="flex-1 min-w-0">
        <span class="block font-medium text-sm text-ink truncate">${_esc(label)}</span>
        <span class="block text-xs text-muted truncate">${_esc(p.model || "")}</span>
      </span>
      ${p.active ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none" style="color:var(--color-accent);border:1px solid var(--color-accent)">${t("proxy_cards_active", "Active")}</span>` : ""}
    </div>
  `;
}

function readOnlyProxyListHtml(proxies, emptyText) {
  if (!proxies || !proxies.length) return `<p class="text-xs text-muted mb-2">${_esc(emptyText)}</p>`;
  return proxies.map((p) => readOnlyProxyCardHtml(p)).join("");
}

const ProxyCardsMixin = {
  _proxyList(kind) {
    return this.proxyCardsState[kind];
  },

  proxyRowHtml(kind, p, i) {
    const global = this._proxyCardsGlobalName;
    const expanded = this.proxyCardsExpanded.has(p.id);
    const collapsedName = p.name || t("proxy_cards_untitled", "Untitled profile");
    if (!expanded) {
      return `
        <div class="rounded-md border p-2.5 mb-2 flex items-center gap-2.5 cursor-pointer" data-proxy-row="${kind}-${i}" onclick="${global}.toggleProxyExpand('${_attr(p.id)}')" style="border-color:${p.active ? "var(--color-accent)" : "var(--color-line)"}">
          ${proxyIconHtml(p, 36)}
          <span class="flex-1 min-w-0 font-medium text-sm text-ink truncate">${_esc(collapsedName)}</span>
          ${p.active ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none" style="color:var(--color-accent);border:1px solid var(--color-accent)">${t("proxy_cards_active", "Active")}</span>` : ""}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><path d="M9 6l6 6-6 6"/></svg>
        </div>
      `;
    }
    const modelPlaceholder = t("proxy_cards_model_placeholder", "Model name");
    const iconTypes = [["favicon", t("proxy_cards_icon_favicon", "Favicon")], ["image", t("proxy_cards_icon_image", "Upload")], ["emoji", t("proxy_cards_icon_emoji", "Emoji")], ["svg", t("proxy_cards_icon_svg", "SVG (logos)")]];
    return `
      <div class="rounded-md border p-2.5 mb-2" data-proxy-row="${kind}-${i}" style="border-color:${p.active ? "var(--color-accent)" : "var(--color-line)"}">
        <div class="flex items-center gap-2.5 mb-2 cursor-pointer" onclick="${global}.toggleProxyExpand('${_attr(p.id)}')">
          ${proxyIconHtml(p, 36)}
          <span class="flex-1 min-w-0 font-medium text-sm text-ink truncate">${_esc(collapsedName)}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="flex items-center gap-2 mb-1.5">
          <button type="button" onclick="${global}.setActiveProxy('${kind}', ${i})" title="${_attr(t("proxy_cards_make_active", "Use this profile"))}"
            class="w-5 h-5 rounded-full flex-none flex items-center justify-center border" style="border-color:${p.active ? "var(--color-accent)" : "var(--color-line-2)"}">
            ${p.active ? `<span class="w-2.5 h-2.5 rounded-full" style="background:var(--color-accent)"></span>` : ""}
          </button>
          <input type="text" data-proxy-name value="${_attr(p.name || "")}" placeholder="${t("proxy_cards_name_placeholder", "Profile name")}" class="flex-1 px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink text-sm font-medium">
          ${p.active ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded" style="color:var(--color-accent);border:1px solid var(--color-accent)">${t("proxy_cards_active", "Active")}</span>` : ""}
          <button type="button" onclick="${global}.removeProxyRow('${kind}', ${i})" class="px-2 py-1.5 rounded-md border text-xs flex-none" style="border-color:var(--color-warn);color:var(--color-warn)">×</button>
        </div>
        <button type="button" onclick="${global}.saveProxyCard('${kind}', ${i})" class="w-full mb-1.5 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold text-paper bg-gradient-to-br from-primary to-primary-dark">
          <span style="width:13px;height:13px">${_PROXY_CARDS_ICON_SAVE}</span>${t("proxy_cards_save", "Save profile")}
        </button>
        <input type="text" data-proxy-base value="${_attr(p.base_url || "")}" placeholder="http://host:port/v1" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <input type="password" autocomplete="new-password" data-proxy-key placeholder="${p.has_api_key ? t("proxy_cards_key_set_placeholder", "Key set — leave blank to keep") : t("proxy_cards_api_key_optional_placeholder", "API key (optional)")}" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
        <div class="flex gap-2 mb-1.5">
          <input type="text" data-proxy-model value="${_attr(p.model || "")}" placeholder="${modelPlaceholder}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <button type="button" onclick="${global}.fetchModelsForRow('${kind}', ${i})" class="px-3 py-2 rounded-md border border-line text-xs text-ink flex-none">${t("proxy_cards_fetch", "Fetch")}</button>
        </div>
        <div data-proxy-model-list="${kind}-${i}" class="flex flex-wrap gap-1.5 mb-1.5"></div>
        <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span class="text-xs text-sec">${t("proxy_cards_icon", "Icon")}</span>
          ${iconTypes.map(([type, label]) => `<button type="button" class="filter-chip${p.icon_type === type ? " on" : ""}" onclick="${global}.setProxyIconType('${kind}', ${i}, '${type}')">${label}</button>`).join("")}
        </div>
        ${p.icon_type === "image" ? `
          <label class="grimoire-img-box" style="width:72px;height:72px;border-radius:12px" onclick="event.stopPropagation()">
            ${p.icon_value
              ? `<img src="${_attr(p.icon_value)}" alt="">`
              : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`}
            <input type="file" accept="image/*" onchange="${global}.setProxyIconImage('${kind}', ${i}, this)" class="hidden">
          </label>
        ` : ""}
        ${p.icon_type === "emoji" ? `
          <button type="button" onclick="${global}.toggleProxyEmojiGrid('${kind}', ${i})" class="w-full py-2 rounded-md border border-line text-center text-sm text-ink flex items-center justify-center gap-2">
            <span style="font-size:18px">${_esc(p.icon_value || "🤖")}</span>
            <span class="text-muted">${t("proxy_cards_choose_emoji", "Choose emoji")}</span>
          </button>
          <div class="comment-picker-grid mt-1.5 rounded-md border border-line bg-surface-2${this.proxyCardsEmojiGridOpen === `${kind}-${i}` ? "" : " hidden"}" data-proxy-emoji-grid="${kind}-${i}">
            ${COMMENT_PICKER_EMOJI.map((e) => `<button type="button" class="comment-picker-cell" onclick="${global}.setProxyIconEmoji('${kind}', ${i}, '${e}')">${e}</button>`).join("")}
          </div>
        ` : ""}
        ${p.icon_type === "svg" ? `
          <div class="flex items-center gap-2">
            <div class="rounded-md border border-line bg-surface-2 flex items-center justify-center flex-none" style="height:40px;max-width:120px;padding:2px 6px" id="proxySvgPreview-${kind}-${i}">
              <img src="${_attr(p.icon_value ? _svgIconDataUri(_sanitizeIconSvg(p.icon_value)) : "")}" style="height:100%;max-width:100%;object-fit:contain;${p.icon_value ? "" : "display:none"}" alt="">
            </div>
            <textarea data-proxy-svg rows="3" oninput="${global}.previewProxyIconSvg('${kind}', ${i}, this.value)" placeholder="${_attr('<svg viewBox="0 0 24 24">...</svg>')}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-xs font-mono" style="min-height:70px">${_esc(p.icon_value || "")}</textarea>
          </div>
        ` : ""}
      </div>
    `;
  },

  proxyListHtml(kind, emptyText) {
    const list = this._proxyList(kind);
    return list.map((p, i) => this.proxyRowHtml(kind, p, i)).join("") || `<p class="text-xs text-muted mb-2">${_esc(emptyText)}</p>`;
  },

  syncProxiesFromDom(kind) {
    const list = this._proxyList(kind);
    document.querySelectorAll(`[data-proxy-row^="${kind}-"]`).forEach((row) => {
      const i = parseInt(row.dataset.proxyRow.slice(kind.length + 1), 10);
      if (!list[i]) return;
      const nameEl = row.querySelector("[data-proxy-name]");
      if (!nameEl) return;
      list[i].name = nameEl.value.trim();
      list[i].base_url = row.querySelector("[data-proxy-base]").value.trim();
      list[i].model = row.querySelector("[data-proxy-model]").value.trim();
      const key = row.querySelector("[data-proxy-key]").value;
      if (key) list[i].api_key = key;
    });
  },

  toggleProxyExpand(id) {
    if (this.proxyCardsExpanded.has(id)) this.proxyCardsExpanded.delete(id);
    else this.proxyCardsExpanded.add(id);
    this.render();
  },

  setProxyIconType(kind, i, type) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyList(kind)[i];
    if (!row) return;
    if (row.icon_type !== type) row.icon_value = "";
    row.icon_type = type;
    this.render();
    this.onProxyCardsChanged();
  },

  setProxyIconEmoji(kind, i, value) {
    const row = this._proxyList(kind)[i];
    if (!row) return;
    row.icon_value = value.trim();
    this.proxyCardsEmojiGridOpen = null;
    this.render();
    this.onProxyCardsChanged();
  },

  toggleProxyEmojiGrid(kind, i) {
    const key = `${kind}-${i}`;
    this.proxyCardsEmojiGridOpen = this.proxyCardsEmojiGridOpen === key ? null : key;
    this.render();
  },

  previewProxyIconSvg(kind, i, raw) {
    const clean = _sanitizeIconSvg(raw);
    const preview = document.getElementById(`proxySvgPreview-${kind}-${i}`);
    const img = preview?.querySelector("img");
    if (img) {
      img.src = _svgIconDataUri(clean);
      img.style.display = clean ? "" : "none";
    }
  },

  saveProxyCard(kind, i) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyList(kind)[i];
    if (!row) { errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again.")); return; }
    if (row.icon_type === "svg") {
      const raw = document.querySelector(`[data-proxy-row="${kind}-${i}"] [data-proxy-svg]`)?.value || "";
      row.icon_value = _sanitizeIconSvg(raw);
    }
    this.render();
    this.onProxyCardsChanged(true);
  },

  setProxyIconImage(kind, i, fileInput) {
    const file = fileInput.files[0];
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        const row = this._proxyList(kind)[i];
        if (row) {
          row.icon_value = canvas.toDataURL("image/webp", 0.85);
          this.render();
          this.onProxyCardsChanged();
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  },

  addProxyRow(kind) {
    this.syncProxiesFromDom(kind);
    const list = this._proxyList(kind);
    const id = _proxyId();
    list.push({ id, name: "", base_url: "", api_key: "", has_api_key: false, model: "", active: list.length === 0, icon_type: "favicon", icon_value: "" });
    this.proxyCardsExpanded.add(id);
    this.render();
  },

  async removeProxyRow(kind, i) {
    const list = this._proxyList(kind);
    const name = list[i]?.name || t("proxy_cards_untitled", "Untitled profile");
    if (!(await confirmDialog(t("proxy_cards_confirm_remove", "Delete profile \"{name}\"?").replace("{name}", name)))) return;
    this.syncProxiesFromDom(kind);
    const wasActive = list[i]?.active;
    list.splice(i, 1);
    if (wasActive && list.length) list[0].active = true;
    this.render();
    this.onProxyCardsChanged();
  },

  setActiveProxy(kind, i) {
    this.syncProxiesFromDom(kind);
    const list = this._proxyList(kind);
    list.forEach((p, idx) => { p.active = idx === i; });
    this.render();
    this.onProxyCardsChanged();
  },

  async fetchModelsForRow(kind, i) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyList(kind)[i];
    if (!row) return;
    const params = new URLSearchParams();
    if (row.base_url) params.set("base_url", row.base_url);
    if (row.api_key) params.set("api_key", row.api_key);
    try {
      const { models } = await api("/api/models" + (params.toString() ? "?" + params : ""));
      if (!models?.length) { toast(t("proxy_cards_no_models_returned", "No models returned")); return; }
      const listEl = document.querySelector(`[data-proxy-model-list="${kind}-${i}"]`);
      if (listEl) {
        listEl.innerHTML = models.map((m) => `<button type="button" class="px-2 py-1 rounded-md border border-line bg-surface-2 text-xs" onclick="${this._proxyCardsGlobalName}.pickModelForRow('${kind}', ${i}, this.dataset.m)" data-m="${_attr(m)}">${_esc(m)}</button>`).join("");
      }
    } catch (e) {
      errorToast(t("proxy_cards_fetch_failed", "Fetch failed: ") + e.message);
    }
  },

  pickModelForRow(kind, i, model) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyList(kind)[i];
    if (row) row.model = model;
    this.render();
    this.onProxyCardsChanged();
  },
};

if (typeof window !== "undefined") {
  window.ProxyCardsMixin = ProxyCardsMixin;
  window.proxyIconHtml = proxyIconHtml;
  window.readOnlyProxyListHtml = readOnlyProxyListHtml;
  window._sanitizeIconSvg = _sanitizeIconSvg;
  window._svgIconDataUri = _svgIconDataUri;
  window._proxyId = _proxyId;
}
