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

function medallionHtml(fallbackSvg, originUrl) {
  let cleanOrigin = "";
  if (originUrl) { try { cleanOrigin = new URL(originUrl).origin; } catch (e) {  } }
  return `
    <span class="relative w-8 h-8 rounded-full flex items-center justify-center flex-none overflow-hidden" style="background:radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--color-accent) 30%, var(--color-surface-2)), var(--color-surface-2) 70%);border:1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-line-2));color:var(--color-accent)">
      <span style="width:16px;height:16px">${fallbackSvg}</span>
      ${cleanOrigin ? `<img src="${_attr(cleanOrigin)}/favicon.ico" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()">` : ""}
    </span>
  `;
}

function statusDotHtml(tone) {
  return `<span class="w-1.5 h-1.5 rounded-full flex-none" style="background:${tone === "warn" ? "var(--color-warn)" : tone === "off" ? "var(--color-line-2)" : "var(--color-success)"}"></span>`;
}

function dossierCardHtml(opts) {
  return `
    <div class="rounded-xl border border-line-2 bg-paper mb-3 overflow-hidden">
      <button type="button" onclick="${opts.globalName}.toggleCard('${opts.cardKey}')" class="w-full flex items-start gap-2.5 p-3.5 text-left">
        ${medallionHtml(opts.icon, opts.logoOrigin)}
        <div class="min-w-0 flex-1">
          <div class="font-display font-semibold text-sm text-ink leading-tight">${opts.title}</div>
          ${opts.subtitle ? `<div class="font-mono text-[10px] text-muted leading-snug mt-0.5">${opts.subtitle}</div>` : ""}
          ${opts.status ? `<div class="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[.04em] text-muted mt-1.5">${statusDotHtml(opts.statusTone)}${opts.status}</div>` : ""}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${opts.isCollapsed ? "-90deg" : "0deg"});transition:transform .15s;flex:none;color:var(--color-muted);margin-top:2px"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="px-3.5 pb-3.5${opts.isCollapsed ? " hidden" : ""}">
        <hr class="mb-3" style="border:none;border-top:1px dashed var(--color-line-2)">
        ${opts.innerHtml}
      </div>
    </div>
  `;
}

function addProxyProfileButtonHtml(globalName, kind) {
  return `<button type="button" onclick="${globalName}.addProxyRow('${kind}')" class="w-full mt-1 py-2 rounded-md border border-line text-xs text-ink" style="border-style:dashed">${t("proxy_cards_add_profile", "+ Add profile")}</button>`;
}

function readOnlyProxyCardHtml(p, isDefault) {
  const label = p.name || t("proxy_cards_untitled", "Untitled profile");
  const highlighted = isDefault !== undefined ? isDefault : p.active;
  return `
    <div class="rounded-md border p-2.5 mb-2 flex items-center gap-2.5" style="border-color:${highlighted ? "var(--color-accent)" : "var(--color-line)"}">
      ${proxyIconHtml(p, 36)}
      <span class="flex-1 min-w-0">
        <span class="block font-medium text-sm text-ink truncate">${_esc(label)}</span>
        <span class="block text-xs text-muted truncate">${_esc(p.model || "")}</span>
      </span>
      ${isDefault === undefined ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none text-muted" style="border:1px solid var(--color-line)" title="${_attr(t("proxy_cards_priority_hint", "Lower numbers are tried first if a higher-priority endpoint fails."))}">${t("proxy_cards_priority_short", "P")}${p.priority ?? 0}</span>` : ""}
      ${highlighted ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none" style="color:var(--color-accent);border:1px solid var(--color-accent)">${isDefault !== undefined ? t("proxy_cards_default", "Default") : t("proxy_cards_active", "Active")}</span>` : ""}
    </div>
  `;
}

function readOnlyProxyListHtml(proxies, emptyText, usePriority) {
  if (!proxies || !proxies.length) return `<p class="text-xs text-muted mb-2">${_esc(emptyText)}</p>`;
  if (!usePriority) return proxies.map((p) => readOnlyProxyCardHtml(p)).join("");
  const ordered = [...proxies].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  return ordered.map((p, i) => readOnlyProxyCardHtml(p, i === 0)).join("");
}

const ProxyCardsMixin = {
  _proxyList(kind) {
    return this.proxyCardsState[kind];
  },

  _proxyById(kind, id) {
    return this._proxyList(kind).find((p) => p.id === id);
  },

  proxyRowHtml(kind, p) {
    const global = this._proxyCardsGlobalName;
    const id = _attr(p.id);
    const expanded = this.proxyCardsExpanded.has(`${kind}:${p.id}`);
    const collapsedName = p.name || t("proxy_cards_untitled", "Untitled profile");
    const isChat = kind === "chat";
    const isDefault = isChat && [...this._proxyList(kind)].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0]?.id === p.id;
    const dragAttrs = "";
    const dragHandle = isChat
      ? `<span style="cursor:grab;color:var(--color-muted);flex:none;touch-action:none" title="${_attr(t("proxy_cards_drag_hint", "Drag to reorder"))}" onpointerdown="${global}.onProxyHandlePointerDown(event, '${kind}', '${id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="pointer-events:none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>`
      : "";
    const priorityChip = isChat
      ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none ${isDefault ? "" : "text-muted border border-line"}" style="${isDefault ? "color:var(--color-accent);border:1px solid var(--color-accent)" : ""}" title="${_attr(t("proxy_cards_priority_hint", "Lower numbers are tried first if a higher-priority endpoint fails."))}">${isDefault ? t("proxy_cards_default", "Default") : `${t("proxy_cards_priority_short", "P")}${p.priority ?? 0}`}</span>`
      : "";
    if (!expanded) {
      return `
        <div class="rounded-md border p-2.5 mb-2 flex items-center gap-2.5 cursor-pointer" data-proxy-row="${kind}-${id}" ${dragAttrs} onclick="${global}.toggleProxyExpand('${kind}', '${id}')" style="border-color:${(p.active && !isChat) || (isChat && isDefault) ? "var(--color-accent)" : "var(--color-line)"}">
          ${dragHandle}
          ${proxyIconHtml(p, 36)}
          <span class="flex-1 min-w-0 font-medium text-sm text-ink truncate">${_esc(collapsedName)}</span>
          ${priorityChip}
          ${p.active && !isChat ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none" style="color:var(--color-accent);border:1px solid var(--color-accent)">${kind === "gif" ? t("proxy_cards_checked_first", "Checked first") : t("proxy_cards_active", "Active")}</span>` : ""}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><path d="M9 6l6 6-6 6"/></svg>
        </div>
      `;
    }
    const modelPlaceholder = t("proxy_cards_model_placeholder", "Model name");
    const iconTypes = [["favicon", t("proxy_cards_icon_favicon", "Favicon")], ["image", t("proxy_cards_icon_image", "Upload")], ["emoji", t("proxy_cards_icon_emoji", "Emoji")], ["svg", t("proxy_cards_icon_svg", "SVG (logos)")]];
    return `
      <div class="rounded-md border p-2.5 mb-2" data-proxy-row="${kind}-${id}" ${dragAttrs} style="border-color:${(p.active && !isChat) || (isChat && isDefault) ? "var(--color-accent)" : "var(--color-line)"}">
        <div class="flex items-center gap-2.5 mb-2 cursor-pointer" onclick="${global}.toggleProxyExpand('${kind}', '${id}')">
          ${dragHandle}
          ${proxyIconHtml(p, 36)}
          <span class="flex-1 min-w-0 font-medium text-sm text-ink truncate">${_esc(collapsedName)}</span>
          ${priorityChip}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted flex-none"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="flex items-center gap-2 mb-1.5">
          <input type="text" data-proxy-name value="${_attr(p.name || "")}" placeholder="${t("proxy_cards_name_placeholder", "Profile name")}" class="flex-1 px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink text-sm font-medium">
          ${isChat
            ? (isDefault
              ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none" style="color:var(--color-accent);border:1px solid var(--color-accent)">${t("proxy_cards_default", "Default")}</span>`
              : `<button type="button" onclick="${global}.promoteProxyToDefault('${kind}', '${id}')" class="px-2.5 py-1.5 rounded-md border border-line text-xs text-ink flex-none">${t("proxy_cards_set_active", "Use this")}</button>`)
            : (p.active
              ? `<span class="font-mono text-[9px] uppercase tracking-[.06em] px-1.5 py-0.5 rounded flex-none" style="color:var(--color-accent);border:1px solid var(--color-accent)">${kind === "gif" ? t("proxy_cards_checked_first", "Checked first") : t("proxy_cards_active", "Active")}</span>`
              : `<button type="button" onclick="${global}.setActiveProxy('${kind}', '${id}')" class="px-2.5 py-1.5 rounded-md border border-line text-xs text-ink flex-none">${kind === "gif" ? t("proxy_cards_check_first", "Check first") : t("proxy_cards_set_active", "Use this")}</button>`)}
          ${kind === "image" || kind === "video" || kind === "gif" ? "" : `<button type="button" onclick="${global}.removeProxyRow('${kind}', '${id}')" class="px-2 py-1.5 rounded-md border text-xs flex-none" style="border-color:var(--color-warn);color:var(--color-warn)">×</button>`}
        </div>
        <button type="button" onclick="${global}.saveProxyCard('${kind}', '${id}')" class="w-full mb-1.5 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold text-paper bg-gradient-to-br from-primary to-primary-dark">
          <span style="width:13px;height:13px">${_PROXY_CARDS_ICON_SAVE}</span>${t("proxy_cards_save", "Save profile")}
        </button>
        ${isChat ? `
          <label class="block text-xs text-sec mb-1">${t("proxy_cards_priority_label", "Priority (0 = default, tried first)")}</label>
          <div class="flex items-stretch mb-1.5 rounded-md border border-line overflow-hidden">
            <button type="button" onclick="${global}.stepProxyPriority('${kind}', '${id}', -1)" class="w-10 flex-none flex items-center justify-center text-ink bg-surface-2 border-e border-line" style="font-size:16px;line-height:1">−</button>
            <input type="number" data-proxy-priority value="${_attr(p.priority ?? 0)}" min="0" step="1" class="w-full px-2.5 py-2 bg-surface-2 text-ink text-sm text-center" style="-moz-appearance:textfield">
            <button type="button" onclick="${global}.stepProxyPriority('${kind}', '${id}', 1)" class="w-10 flex-none flex items-center justify-center text-ink bg-surface-2 border-s border-line" style="font-size:16px;line-height:1">+</button>
          </div>
          <p class="text-xs text-muted mb-1.5">${t("proxy_cards_priority_explainer", "The profile at priority 0 is the default - every reply tries it first. If it doesn't answer (down, rate-limited, or refuses the request), the server automatically retries the next-lowest number, no action needed. Drag a profile's row to reorder it, or type a number directly - either way updates its priority. Two profiles with the same number: whichever the server checks first wins, so keep numbers unique if the order matters.")}</p>
        ` : ""}
        ${kind === "video" && id === "comfyui" ? `
          <p class="text-xs text-muted mb-1.5">${t("proxy_cards_video_comfyui_hint", "Uses the same ComfyUI instance configured on the Image generation card.")}</p>
          ${this.videoComfyuiExtraHtml ? this.videoComfyuiExtraHtml() : ""}
        ` : kind === "gif" ? `
          <input type="password" autocomplete="new-password" data-proxy-key placeholder="${p.has_api_key ? t("proxy_cards_key_set_placeholder", "Key set — leave blank to keep") : t("proxy_cards_api_key_optional_placeholder", "API key (optional)")}" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          ${id === "klipy" ? `<input type="text" data-proxy-base value="${_attr(p.base_url || "")}" placeholder="${t("proxy_cards_klipy_customer_id_placeholder", "Customer ID")}" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">` : ""}
        ` : `
          <input type="text" data-proxy-base value="${_attr(p.base_url || "")}" placeholder="http://host:port/v1" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <input type="password" autocomplete="new-password" data-proxy-key placeholder="${p.has_api_key ? t("proxy_cards_key_set_placeholder", "Key set — leave blank to keep") : t("proxy_cards_api_key_optional_placeholder", "API key (optional)")}" class="w-full mb-1.5 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
          <div class="flex gap-2 mb-1.5">
            <input type="text" data-proxy-model value="${_attr(p.model || "")}" placeholder="${modelPlaceholder}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-sm">
            <button type="button" onclick="${global}.fetchModelsForRow('${kind}', '${id}')" class="px-3 py-2 rounded-md border border-line text-xs text-ink flex-none">${t("proxy_cards_fetch", "Fetch")}</button>
          </div>
          <div data-proxy-model-list="${kind}-${id}" class="flex flex-wrap gap-1.5 mb-1.5"></div>
        `}
        <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span class="text-xs text-sec">${t("proxy_cards_icon", "Icon")}</span>
          ${iconTypes.map(([type, label]) => `<button type="button" class="filter-chip${p.icon_type === type ? " on" : ""}" onclick="${global}.setProxyIconType('${kind}', '${id}', '${type}')">${label}</button>`).join("")}
        </div>
        ${p.icon_type === "image" ? `
          <label class="grimoire-img-box" style="width:72px;height:72px;border-radius:12px" onclick="event.stopPropagation()">
            ${p.icon_value
              ? `<img src="${_attr(p.icon_value)}" alt="">`
              : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`}
            <input type="file" accept="image/*" onchange="${global}.setProxyIconImage('${kind}', '${id}', this)" class="hidden">
          </label>
        ` : ""}
        ${p.icon_type === "emoji" ? `
          <button type="button" onclick="${global}.toggleProxyEmojiGrid('${kind}', '${id}')" class="w-full py-2 rounded-md border border-line text-center text-sm text-ink flex items-center justify-center gap-2">
            <span style="font-size:18px">${_esc(p.icon_value || "🤖")}</span>
            <span class="text-muted">${t("proxy_cards_choose_emoji", "Choose emoji")}</span>
          </button>
          <div class="comment-picker-grid mt-1.5 rounded-md border border-line bg-surface-2${this.proxyCardsEmojiGridOpen === `${kind}-${p.id}` ? "" : " hidden"}" data-proxy-emoji-grid="${kind}-${id}">
            ${COMMENT_PICKER_EMOJI.map((e) => `<button type="button" class="comment-picker-cell" onclick="${global}.setProxyIconEmoji('${kind}', '${id}', '${e}')">${e}</button>`).join("")}
          </div>
        ` : ""}
        ${p.icon_type === "svg" ? `
          <div class="flex items-center gap-2">
            <div class="rounded-md border border-line bg-surface-2 flex items-center justify-center flex-none" style="height:40px;max-width:120px;padding:2px 6px" id="proxySvgPreview-${kind}-${id}">
              <img src="${_attr(p.icon_value ? _svgIconDataUri(_sanitizeIconSvg(p.icon_value)) : "")}" style="height:100%;max-width:100%;object-fit:contain;${p.icon_value ? "" : "display:none"}" alt="">
            </div>
            <textarea data-proxy-svg rows="3" oninput="${global}.previewProxyIconSvg('${kind}', '${id}', this.value)" placeholder="${_attr('<svg viewBox="0 0 24 24">...</svg>')}" class="flex-1 px-2.5 py-2 rounded-md border border-line bg-surface-2 text-ink text-xs font-mono" style="min-height:70px">${_esc(p.icon_value || "")}</textarea>
          </div>
        ` : ""}
      </div>
    `;
  },

  proxyListHtml(kind, emptyText) {
    const list = this._proxyList(kind);
    const ordered = kind === "chat" ? [...list].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)) : list;
    return ordered.map((p) => this.proxyRowHtml(kind, p)).join("") || `<p class="text-xs text-muted">${_esc(emptyText)}</p>`;
  },

  onProxyHandlePointerDown(ev, kind, id) {
    ev.preventDefault();
    ev.stopPropagation();
    this.syncProxiesFromDom(kind);
    this._proxyDrag = { kind, id, lastTargetId: id };
    const row = this.main?.querySelector(`[data-proxy-row="${kind}-${id}"]`);
    if (row) row.style.opacity = "0.5";
    const move = (e) => this._onProxyPointerMove(e);
    const up = (e) => this._onProxyPointerUp(e, move, up);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
    document.addEventListener("pointercancel", up, { once: true });
  },

  _onProxyPointerMove(ev) {
    const drag = this._proxyDrag;
    if (!drag) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const row = el?.closest(`[data-proxy-row^="${drag.kind}-"]`);
    if (!row) return;
    const targetId = row.dataset.proxyRow.slice(drag.kind.length + 1);
    if (targetId === drag.lastTargetId) return;
    drag.lastTargetId = targetId;
    const list = this._proxyList(drag.kind);
    const ordered = [...list].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const fromIdx = ordered.findIndex((p) => p.id === drag.id);
    const toIdx = ordered.findIndex((p) => p.id === targetId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    ordered.forEach((p, i) => { p.priority = i; });
    this.render();
    const row2 = this.main?.querySelector(`[data-proxy-row="${drag.kind}-${drag.id}"]`);
    if (row2) row2.style.opacity = "0.5";
  },

  _onProxyPointerUp(ev, move, up) {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointercancel", up);
    const drag = this._proxyDrag;
    this._proxyDrag = null;
    if (!drag) return;
    const row = this.main?.querySelector(`[data-proxy-row="${drag.kind}-${drag.id}"]`);
    if (row) row.style.opacity = "";
    this.onProxyCardsChanged(true);
  },

  promoteProxyToDefault(kind, id) {
    this.syncProxiesFromDom(kind);
    const list = this._proxyList(kind);
    const ordered = [...list].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const idx = ordered.findIndex((p) => p.id === id);
    if (idx <= 0) return;
    const [moved] = ordered.splice(idx, 1);
    ordered.unshift(moved);
    ordered.forEach((p, i) => { p.priority = i; });
    this.render();
    this.onProxyCardsChanged(true);
  },

  syncProxiesFromDom(kind) {
    document.querySelectorAll(`[data-proxy-row^="${kind}-"]`).forEach((row) => {
      const id = row.dataset.proxyRow.slice(kind.length + 1);
      const item = this._proxyById(kind, id);
      if (!item) return;
      const nameEl = row.querySelector("[data-proxy-name]");
      if (!nameEl) return;
      item.name = nameEl.value.trim();
      item.base_url = row.querySelector("[data-proxy-base]")?.value.trim() ?? item.base_url;
      item.model = row.querySelector("[data-proxy-model]")?.value.trim() ?? item.model;
      const key = row.querySelector("[data-proxy-key]")?.value;
      if (key) item.api_key = key;
      const priorityEl = row.querySelector("[data-proxy-priority]");
      if (priorityEl) item.priority = parseInt(priorityEl.value, 10) || 0;
    });
  },

  toggleProxyExpand(kind, id) {
    const key = `${kind}:${id}`;
    if (this.proxyCardsExpanded.has(key)) this.proxyCardsExpanded.delete(key);
    else this.proxyCardsExpanded.add(key);
    this.render();
  },

  setProxyIconType(kind, id, type) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyById(kind, id);
    if (!row) { errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again.")); return; }
    if (row.icon_type !== type) row.icon_value = "";
    row.icon_type = type;
    this.render();
    this.onProxyCardsChanged();
  },

  setProxyIconEmoji(kind, id, value) {
    const row = this._proxyById(kind, id);
    if (!row) { errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again.")); return; }
    row.icon_value = value.trim();
    this.proxyCardsEmojiGridOpen = null;
    this.render();
    this.onProxyCardsChanged();
  },

  toggleProxyEmojiGrid(kind, id) {
    const key = `${kind}-${id}`;
    this.proxyCardsEmojiGridOpen = this.proxyCardsEmojiGridOpen === key ? null : key;
    this.render();
  },

  previewProxyIconSvg(kind, id, raw) {
    const clean = _sanitizeIconSvg(raw);
    const preview = document.getElementById(`proxySvgPreview-${kind}-${id}`);
    const img = preview?.querySelector("img");
    if (img) {
      img.src = _svgIconDataUri(clean);
      img.style.display = clean ? "" : "none";
    }
  },

  stepProxyPriority(kind, id, delta) {
    const el = this.main.querySelector(`[data-proxy-row="${kind}-${id}"] [data-proxy-priority]`);
    if (!el) return;
    el.value = Math.max(0, (parseInt(el.value, 10) || 0) + delta);
  },

  saveProxyCard(kind, id) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyById(kind, id);
    if (!row) { errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again.")); return; }
    if (row.icon_type === "svg") {
      const raw = this.main.querySelector(`[data-proxy-row="${kind}-${id}"] [data-proxy-svg]`)?.value || "";
      row.icon_value = _sanitizeIconSvg(raw);
    }
    if (kind === "chat") this._cascadeProxyPriorities(kind, id);
    this.render();
    this.onProxyCardsChanged(true);
  },

  _cascadeProxyPriorities(kind, preferredId) {
    const list = this._proxyList(kind);
    const ordered = [...list].sort((a, b) => {
      const pa = a.priority ?? 0, pb = b.priority ?? 0;
      if (pa !== pb) return pa - pb;
      if (a.id === preferredId) return -1;
      if (b.id === preferredId) return 1;
      return 0;
    });
    ordered.forEach((p, i) => { p.priority = i; });
  },

  setProxyIconImage(kind, id, fileInput) {
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
        const row = this._proxyById(kind, id);
        if (row) {
          row.icon_value = canvas.toDataURL("image/webp", 0.85);
          this.render();
          this.onProxyCardsChanged();
        } else {
          errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again."));
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
    list.push({ id, name: "", base_url: "", api_key: "", has_api_key: false, model: "", active: list.length === 0, icon_type: "favicon", icon_value: "", priority: list.length });
    this.proxyCardsExpanded.add(`${kind}:${id}`);
    this.render();
  },

  async removeProxyRow(kind, id) {
    const list = this._proxyList(kind);
    const row = this._proxyById(kind, id);
    if (!row) { errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again.")); return; }
    const name = row.name || t("proxy_cards_untitled", "Untitled profile");
    if (!(await confirmDialog(t("proxy_cards_confirm_remove", "Delete profile \"{name}\"?").replace("{name}", name)))) return;
    this.syncProxiesFromDom(kind);
    const wasActive = row.active;
    const idx = list.findIndex((p) => p.id === id);
    if (idx !== -1) list.splice(idx, 1);
    if (wasActive && list.length) list[0].active = true;
    this.render();
    this.onProxyCardsChanged();
  },

  setActiveProxy(kind, id) {
    this.syncProxiesFromDom(kind);
    const list = this._proxyList(kind);
    list.forEach((p) => { p.active = p.id === id; });
    this.render();
    this.onProxyCardsChanged();
  },

  async fetchModelsForRow(kind, id) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyById(kind, id);
    if (!row) { errorToast(t("proxy_cards_row_missing", "This profile card is out of sync — collapse and reopen it, then try again.")); return; }
    const params = new URLSearchParams();
    if (row.base_url) params.set("base_url", row.base_url);
    if (row.api_key) params.set("api_key", row.api_key);
    try {
      const { models } = await api("/api/models" + (params.toString() ? "?" + params : ""));
      if (!models?.length) { toast(t("proxy_cards_no_models_returned", "No models returned")); return; }
      const listEl = document.querySelector(`[data-proxy-model-list="${kind}-${id}"]`);
      if (listEl) {
        listEl.innerHTML = models.map((m) => `<button type="button" class="px-2 py-1 rounded-md border border-line bg-surface-2 text-xs" onclick="${this._proxyCardsGlobalName}.pickModelForRow('${kind}', '${id}', this.dataset.m)" data-m="${_attr(m)}">${_esc(m)}</button>`).join("");
      }
    } catch (e) {
      errorToast(t("proxy_cards_fetch_failed", "Fetch failed: ") + e.message);
    }
  },

  pickModelForRow(kind, id, model) {
    this.syncProxiesFromDom(kind);
    const row = this._proxyById(kind, id);
    if (row) row.model = model;
    this.render();
    this.onProxyCardsChanged();
  },
};

if (typeof window !== "undefined") {
  window.ProxyCardsMixin = ProxyCardsMixin;
  window.proxyIconHtml = proxyIconHtml;
  window.medallionHtml = medallionHtml;
  window.statusDotHtml = statusDotHtml;
  window.dossierCardHtml = dossierCardHtml;
  window.addProxyProfileButtonHtml = addProxyProfileButtonHtml;
  window.readOnlyProxyListHtml = readOnlyProxyListHtml;
  window._sanitizeIconSvg = _sanitizeIconSvg;
  window._svgIconDataUri = _svgIconDataUri;
  window._proxyId = _proxyId;
}
