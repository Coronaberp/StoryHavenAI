"use strict";

function _pickerTileThumbHtml(item, size, hasZoom) {
  const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;position:relative;background:var(--color-surface-2);border:1px solid var(--color-line)`;
  if (item.image || item.image_nsfw) {
    const label = item.label || item.name || "?";
    const inner = modelPreviewInnerHtml({ image: item.image, image_nsfw: item.image_nsfw }, label, true);
    return `<span data-picker-thumb="${_attr(item.name)}" style="${style};${hasZoom ? "cursor:zoom-in" : ""}">${inner}</span>`;
  }
  const initial = (item.label || item.name || "?")[0].toUpperCase();
  return `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(initial)}</span>`;
}

function _pickerTileTagsHtml(item) {
  if (!item.tags || !item.tags.length) return "";
  return `
    <div data-picker-tags="${_attr(item.name)}" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
      ${item.tags.map((tag) => `<span data-picker-tag="${_attr(tag)}" style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:.04em;color:var(--color-accent);background:color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));border:1px solid var(--color-accent);border-radius:6px;padding:2px 7px;cursor:pointer">${_esc(tag)}</span>`).join("")}
    </div>
  `;
}

function _pickerStrengthHtml(name, strength) {
  if (!strength) return "";
  return `
    <div data-picker-strength="${_attr(name)}" style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <input type="range" min="${strength.min}" max="${strength.max}" step="${strength.step}" value="${strength.value}" data-picker-strength-range style="flex:1">
      <input type="text" value="${strength.value.toFixed(2)}" data-picker-strength-num style="width:52px;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:6px;color:var(--color-accent);font-family:var(--font-mono);font-size:12px;text-align:center;padding:3px 4px">
    </div>
  `;
}

function _pickerTileHtml(item, selected, hasZoom) {
  return `
    <button type="button" data-picker-name="${_attr(item.name)}"
      style="width:100%;display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:13px;cursor:pointer;text-align:left;background:${selected ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-surface))" : "var(--color-surface)"};border:1.5px solid ${selected ? "var(--color-accent)" : "var(--color-line)"}">
      ${_pickerTileThumbHtml(item, 52, hasZoom)}
      <span style="flex:1;min-width:0">
        <span style="display:block;font-weight:600;font-size:14px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.label || item.name)}</span>
        ${item.sublabel ? `<span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;color:var(--color-muted);margin-top:2px">${_esc(item.sublabel)}</span>` : ""}
        ${_pickerTileTagsHtml(item)}
      </span>
    </button>
  `;
}

function _pickerDetailFooterHtml(item) {
  if (!item) return "";
  const parts = [];
  if (item.description) parts.push(`<p style="font-size:12px;color:var(--color-sec);line-height:1.55;margin:8px 0 0">${_esc(item.description)}</p>`);
  if (item.config) {
    const c = item.config;
    const slugParts = [
      c.sampler ? `<span>sampler <b style="color:var(--color-accent);font-weight:400">${_esc(c.sampler)}</b></span>` : "",
      c.scheduler ? `<span>scheduler <b style="color:var(--color-accent);font-weight:400">${_esc(c.scheduler)}</b></span>` : "",
      c.steps ? `<span>steps <b style="color:var(--color-accent);font-weight:400">${_esc(String(c.steps))}</b></span>` : "",
      c.cfg ? `<span>cfg <b style="color:var(--color-accent);font-weight:400">${_esc(String(c.cfg))}</b></span>` : "",
    ].filter(Boolean).join("");
    if (slugParts) parts.push(`<div style="display:flex;flex-wrap:wrap;gap:0 10px;margin:10px 0 0;padding-top:10px;border-top:1px solid var(--color-line);font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted)">${slugParts}</div>`);
    if (c.positiveAdd) parts.push(`<div style="font-size:11px;color:var(--color-muted);margin-top:8px;line-height:1.5"><b style="color:var(--color-sec);font-weight:600">Adds to your prompt:</b> "${_esc(c.positiveAdd)}"</div>`);
    if (c.negativeAdd) parts.push(`<div style="font-size:11px;color:var(--color-muted);margin-top:6px;line-height:1.5"><b style="color:var(--color-sec);font-weight:600">Adds to negative:</b> "${_esc(c.negativeAdd)}"</div>`);
  }
  if (!parts.length) return "";
  return `<div style="padding:0 4px 4px">${parts.join("")}</div>`;
}

function openPickerSheet(opts) {
  const multiSelect = !!opts.multiSelect;
  const selectedSet = multiSelect ? new Set(opts.selected || []) : null;
  const state = { query: "", category: "all", tab: opts.tabs?.[0]?.key || null, focused: multiSelect ? null : opts.selected };

  const currentItems = () => {
    if (opts.tabs) {
      const tab = opts.tabs.find((tb) => tb.key === state.tab);
      if (tab) {
        const items = tab.itemsForTab();
        if (items === null) return null;
        return items;
      }
    }
    return opts.items;
  };

  const isSelected = (name) => (multiSelect ? selectedSet.has(name) : name === state.focused);

  const categoryTabsHtml = () => {
    if (!opts.categories || !opts.categories.length) return "";
    const all = [{ key: "all", label: t("admin_picker_all_categories", "All") }, ...opts.categories];
    return `
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:10px;margin-bottom:2px">
        ${all.map((c) => `
          <button type="button" data-picker-category="${_attr(c.key)}"
            style="padding:6px 13px;border-radius:100px;font-size:12px;font-weight:600;white-space:nowrap;background:${state.category === c.key ? "var(--color-accent)" : "var(--color-surface-2)"};color:${state.category === c.key ? "var(--color-paper)" : "var(--color-muted)"};border:none;cursor:pointer">
            ${_esc(c.label)}
          </button>
        `).join("")}
      </div>
    `;
  };

  const mainTabsHtml = () => {
    if (!opts.tabs) return "";
    return `
      <div style="display:flex;gap:6px;margin-bottom:12px">
        ${opts.tabs.map((tb) => `
          <button type="button" data-picker-main-tab="${_attr(tb.key)}" class="filter-chip${state.tab === tb.key ? " on" : ""}">${_esc(tb.label)}</button>
        `).join("")}
      </div>
    `;
  };

  const filteredItems = () => {
    const items = currentItems();
    if (items === null) return null;
    const q = state.query.trim().toLowerCase();
    return items.filter((item) => {
      if (state.category !== "all" && item.category !== state.category) return false;
      if (!q) return true;
      return (item.label || item.name || "").toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
    });
  };

  const renderDetailFooter = () => {
    const footer = document.getElementById("pickerSheetFooter");
    if (!footer) return;
    const items = currentItems();
    if (items === null) { footer.innerHTML = ""; return; }
    const focusedName = multiSelect ? [...selectedSet].slice(-1)[0] : state.focused;
    const item = items.find((it) => it.name === focusedName);
    footer.innerHTML = _pickerDetailFooterHtml(item);
  };

  const wireStrengthRow = (row, item) => {
    const range = row.querySelector("[data-picker-strength-range]");
    const num = row.querySelector("[data-picker-strength-num]");
    if (!range || !num) return;
    const strength = opts.strengthFor(item.name);
    if (!strength) return;
    range.oninput = () => { num.value = (+range.value).toFixed(2); strength.onChange(+range.value); };
    num.onchange = () => {
      const v = Math.min(strength.max, Math.max(strength.min, +num.value || 0));
      num.value = v.toFixed(2);
      range.value = String(v);
      strength.onChange(v);
    };
  };

  const renderGrid = () => {
    const grid = document.getElementById("pickerSheetGrid");
    if (!grid) return;
    const list = filteredItems();
    if (list === null) {
      grid.innerHTML = opts.tabRenderFn ? opts.tabRenderFn(state.tab) : "";
      opts.onTabRender?.(state.tab, grid);
      renderDetailFooter();
      return;
    }
    grid.innerHTML = list.length
      ? list.map((item) => {
          const selected = isSelected(item.name);
          const row = _pickerTileHtml(item, selected, !!opts.onZoom);
          if (!multiSelect || !selected || !opts.strengthFor) return row;
          return row.replace("</button>", `${_pickerStrengthHtml(item.name, opts.strengthFor(item.name))}</button>`);
        }).join("")
      : `<p style="font-size:12.5px;color:var(--color-muted);padding:20px 4px;text-align:center">${t("admin_picker_no_matches", "Nothing matches")}</p>`;
    grid.querySelectorAll("[data-picker-name]").forEach((b) => {
      const item = list.find((it) => it.name === b.dataset.pickerName);
      b.addEventListener("click", (e) => {
        if (e.target.closest("[data-picker-strength]") || e.target.closest("[data-picker-thumb]") || e.target.closest("[data-picker-tag]")) return;
        if (multiSelect) {
          const nowSelected = !selectedSet.has(b.dataset.pickerName);
          if (nowSelected) selectedSet.add(b.dataset.pickerName); else selectedSet.delete(b.dataset.pickerName);
          opts.onPick(b.dataset.pickerName, nowSelected);
          renderGrid();
        } else {
          closeTopModal();
          opts.onPick(b.dataset.pickerName);
        }
      });
      if (!multiSelect) {
        b.addEventListener("mouseenter", () => { state.focused = b.dataset.pickerName; renderDetailFooter(); });
      }
      const strengthRow = b.querySelector("[data-picker-strength]");
      if (strengthRow && item) wireStrengthRow(strengthRow, item);
      const thumb = b.querySelector("[data-picker-thumb]");
      if (thumb && opts.onZoom && item) {
        thumb.addEventListener("click", (e) => {
          e.stopPropagation();
          const img = thumb.querySelector("img");
          if (img) opts.onZoom(item.image || item.image_nsfw, item.label || item.name, item.image_nsfw || null);
        });
      }
      b.querySelectorAll("[data-picker-tag]").forEach((tagEl) => {
        tagEl.addEventListener("click", (e) => {
          e.stopPropagation();
          opts.onTagClick?.(tagEl.dataset.pickerTag);
        });
      });
    });
    if (!state.focused && list.length && !multiSelect) state.focused = list[0].name;
    renderDetailFooter();
  };

  const renderTabs = () => {
    const wrap = document.getElementById("pickerSheetTabs");
    if (!wrap) return;
    wrap.innerHTML = categoryTabsHtml();
    wrap.querySelectorAll("[data-picker-category]").forEach((b) => b.onclick = () => {
      state.category = b.dataset.pickerCategory;
      renderTabs();
      renderGrid();
    });
  };

  const renderMainTabs = () => {
    const wrap = document.getElementById("pickerSheetMainTabs");
    if (!wrap) return;
    wrap.innerHTML = mainTabsHtml();
    wrap.querySelectorAll("[data-picker-main-tab]").forEach((b) => b.onclick = () => {
      state.tab = b.dataset.pickerMainTab;
      renderMainTabs();
      renderTabs();
      renderGrid();
    });
  };

  openModal(`
    <h3>${_esc(opts.title)}</h3>
    <div id="pickerSheetMainTabs"></div>
    <input type="text" id="pickerSheetSearch" placeholder="${t("admin_picker_search_placeholder", "Search")}"
      style="width:100%;margin:12px 0;padding:10px 13px;border-radius:11px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
    <div id="pickerSheetTabs"></div>
    <div id="pickerSheetGrid" style="display:flex;flex-direction:column;gap:9px;max-height:340px;overflow-y:auto;padding:2px"></div>
    <div id="pickerSheetFooter"></div>
  `, { wide: true });
  document.getElementById("pickerSheetSearch").oninput = (e) => { state.query = e.target.value; renderGrid(); };
  renderMainTabs();
  renderTabs();
  renderGrid();
}

if (typeof window !== "undefined") {
  window.openPickerSheet = openPickerSheet;
}
