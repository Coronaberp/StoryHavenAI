"use strict";

function _pickerTileThumbHtml(item, size) {
  const style = `width:${size}px;height:${size}px;border-radius:${Math.round(size / 6)}px;flex:none;overflow:hidden;display:grid;place-items:center;background:var(--color-surface-2);border:1px solid var(--color-line)`;
  if (item.image) {
    return `<span style="${style}"><img src="${_attr(item.image)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`;
  }
  const initial = (item.label || item.name || "?")[0].toUpperCase();
  return `<span style="${style};font-family:var(--font-mono);font-size:${Math.round(size / 2.6)}px;color:var(--color-muted)">${_esc(initial)}</span>`;
}

function _pickerTileHtml(item, selected) {
  return `
    <button type="button" data-picker-name="${_attr(item.name)}"
      style="width:100%;display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:13px;cursor:pointer;text-align:left;background:${selected ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-surface))" : "var(--color-surface)"};border:1.5px solid ${selected ? "var(--color-accent)" : "var(--color-line)"}">
      ${_pickerTileThumbHtml(item, 52)}
      <span style="flex:1;min-width:0">
        <span style="display:block;font-weight:600;font-size:14px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(item.label || item.name)}</span>
        ${item.sublabel ? `<span style="display:block;font-size:11px;color:var(--color-muted);margin-top:2px">${_esc(item.sublabel)}</span>` : ""}
      </span>
    </button>
  `;
}

function openPickerSheet(opts) {
  const state = { query: "", category: "all" };
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
  const filteredItems = () => {
    const q = state.query.trim().toLowerCase();
    return opts.items.filter((item) => {
      if (state.category !== "all" && item.category !== state.category) return false;
      if (!q) return true;
      return (item.label || item.name || "").toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
    });
  };
  const renderGrid = () => {
    const grid = document.getElementById("pickerSheetGrid");
    if (!grid) return;
    const list = filteredItems();
    grid.innerHTML = list.length
      ? list.map((item) => _pickerTileHtml(item, item.name === opts.selected)).join("")
      : `<p style="font-size:12.5px;color:var(--color-muted);padding:20px 4px;text-align:center">${t("admin_picker_no_matches", "Nothing matches")}</p>`;
    grid.querySelectorAll("[data-picker-name]").forEach((b) => b.onclick = () => {
      closeTopModal();
      opts.onPick(b.dataset.pickerName);
    });
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
  openModal(`
    <h3>${_esc(opts.title)}</h3>
    <input type="text" id="pickerSheetSearch" placeholder="${t("admin_picker_search_placeholder", "Search")}"
      style="width:100%;margin:12px 0;padding:10px 13px;border-radius:11px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
    <div id="pickerSheetTabs"></div>
    <div id="pickerSheetGrid" style="display:flex;flex-direction:column;gap:9px;max-height:420px;overflow-y:auto;padding:2px"></div>
  `, { wide: true });
  document.getElementById("pickerSheetSearch").oninput = (e) => { state.query = e.target.value; renderGrid(); };
  renderTabs();
  renderGrid();
}

if (typeof window !== "undefined") {
  window.openPickerSheet = openPickerSheet;
}
