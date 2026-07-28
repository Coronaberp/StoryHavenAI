"use strict";

const CHARACTER_PICKER_PAGE_SIZE = 12;

function _characterPickerTileHtml(c, mineOnly) {
  const mine = mineOnly || c.owner_id === ME?.id;
  return `
    <button type="button" data-cp-id="${_attr(c.id)}" class="pcp-tile">
      <span class="sanctum-specimen" style="width:44px;height:44px;${c.avatar ? `background-image:url('${_attr(c.avatar)}')` : "background:var(--color-surface-2)"}">${c.avatar ? "" : _esc((c.name || "?")[0].toUpperCase())}</span>
      <span class="pcp-tile-body">
        <span class="pcp-tile-name">${_esc(c.name)}</span>
        <span class="pcp-tile-badge ${mine ? "" : "pcp-tile-badge-explore"}">${mine ? t("masks_link_character_mine", "Yours") : t("masks_link_character_explore", "Explore")}</span>
      </span>
    </button>
  `;
}

function openCharacterPickerModal(onPick, opts = {}) {
  const title = opts.title || t("masks_link_character_heading", "Link a character");
  const state = {
    chars: null,
    query: "",
    page: 0,
    ownership: "all",
    mode: "all",
  };
  const layer = openModal(`
    <h3>${_esc(title)}</h3>
    <div style="display:flex;gap:8px;margin:12px 0 10px">
      <input type="text" id="cpSearch" placeholder="${_attr(t("masks_link_character_search_placeholder", "Search your characters or Explore"))}"
        class="pcp-search" style="margin:0;flex:1" autocomplete="off">
      <button type="button" id="cpFilterBtn" class="tool" style="flex:none;position:relative;border:1px solid var(--color-line-2);border-radius:11px;width:42px;display:grid;place-items:center" aria-label="${_attr(t("masks_link_character_filter", "Filter"))}" data-tooltip="${_attr(t("masks_link_character_filter", "Filter"))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
        <span id="cpFilterDot" style="display:none;position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:var(--color-accent)"></span>
      </button>
    </div>
    <div id="cpFilterDrawer" style="display:none;flex-wrap:wrap;gap:6px;padding-bottom:12px;border-bottom:1px solid var(--color-line);margin-bottom:10px"></div>
    <div id="cpGrid" class="pcp-grid"></div>
    <div id="cpPager"></div>
  `, { wide: true });

  const filteredChars = () => {
    if (!state.chars) return [];
    const q = state.query.trim().toLowerCase();
    return state.chars.filter((c) => {
      if (state.ownership === "mine" && c.owner_id !== ME?.id) return false;
      if (state.ownership === "explore" && c.owner_id === ME?.id) return false;
      if (state.mode !== "all" && c.mode !== state.mode) return false;
      if (q && !(c.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  };

  const renderFilterDrawer = () => {
    const drawer = layer.querySelector("#cpFilterDrawer");
    if (!drawer) return;
    const ownershipChip = (id, label) =>
      `<button type="button" class="filter-chip${state.ownership === id ? " on" : ""}" data-cp-ownership="${id}">${_esc(label)}</button>`;
    const modeChip = (id, label) =>
      `<button type="button" class="filter-chip${state.mode === id ? " on" : ""}" data-cp-mode="${id}">${_esc(label)}</button>`;
    drawer.innerHTML = `
      ${ownershipChip("all", t("masks_link_character_filter_all", "All"))}
      ${ownershipChip("mine", t("masks_link_character_mine", "Yours"))}
      ${ownershipChip("explore", t("masks_link_character_explore", "Explore"))}
      ${modeChip("all", t("compendium_filter_all", "All modes"))}
      ${modeChip("character", t("compendium_filter_character", "Character"))}
      ${modeChip("rpg", t("compendium_filter_rpg", "RPG"))}
    `;
    drawer.querySelectorAll("[data-cp-ownership]").forEach((b) => b.onclick = () => {
      state.ownership = b.dataset.cpOwnership;
      state.page = 0;
      renderFilterDrawer();
      renderGrid();
      updateFilterDot();
    });
    drawer.querySelectorAll("[data-cp-mode]").forEach((b) => b.onclick = () => {
      state.mode = b.dataset.cpMode;
      state.page = 0;
      renderFilterDrawer();
      renderGrid();
      updateFilterDot();
    });
  };

  const updateFilterDot = () => {
    const dot = layer.querySelector("#cpFilterDot");
    if (dot) dot.style.display = (state.ownership !== "all" || state.mode !== "all") ? "" : "none";
  };

  const renderPager = (pageCount, page) => {
    const pager = layer.querySelector("#cpPager");
    if (!pager) return;
    if (pageCount <= 1) { pager.innerHTML = ""; return; }
    pager.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 0 2px">
        <button type="button" id="cpPagePrev" class="tool icon-flip-rtl" style="border:1px solid var(--color-line-2);border-radius:8px;padding:4px 10px;${page === 0 ? "opacity:.4;pointer-events:none" : ""}">‹</button>
        <span class="font-mono" style="font-size:11px;color:var(--color-muted)">${page + 1} / ${pageCount}</span>
        <button type="button" id="cpPageNext" class="tool icon-flip-rtl" style="border:1px solid var(--color-line-2);border-radius:8px;padding:4px 10px;${page === pageCount - 1 ? "opacity:.4;pointer-events:none" : ""}">›</button>
      </div>
    `;
    const prev = layer.querySelector("#cpPagePrev");
    const next = layer.querySelector("#cpPageNext");
    if (prev) prev.onclick = () => { state.page = Math.max(0, state.page - 1); renderGrid(); };
    if (next) next.onclick = () => { state.page = Math.min(pageCount - 1, state.page + 1); renderGrid(); };
  };

  const renderGrid = () => {
    const grid = layer.querySelector("#cpGrid");
    if (!grid) return;
    if (state.chars === null) {
      grid.innerHTML = `<div class="pcp-loading" aria-hidden="true">${"<span></span>".repeat(4)}</div>`;
      renderPager(0, 0);
      return;
    }
    const filtered = filteredChars();
    if (!filtered.length) {
      grid.innerHTML = `<p class="pcp-empty">${t("masks_link_character_no_matches", "No characters match.")}</p>`;
      renderPager(0, 0);
      return;
    }
    const pageCount = Math.ceil(filtered.length / CHARACTER_PICKER_PAGE_SIZE);
    const page = Math.min(state.page, pageCount - 1);
    const pageItems = filtered.slice(page * CHARACTER_PICKER_PAGE_SIZE, page * CHARACTER_PICKER_PAGE_SIZE + CHARACTER_PICKER_PAGE_SIZE);
    grid.innerHTML = pageItems.map((c) => _characterPickerTileHtml(c)).join("");
    grid.querySelectorAll("[data-cp-id]").forEach((b) => b.onclick = () => {
      const char = state.chars.find((c) => c.id === b.dataset.cpId);
      closeModal(layer);
      if (char) onPick(char);
    });
    renderPager(pageCount, page);
  };

  layer.querySelector("#cpSearch").oninput = (e) => { state.query = e.target.value; state.page = 0; renderGrid(); };
  layer.querySelector("#cpFilterBtn").onclick = () => {
    const drawer = layer.querySelector("#cpFilterDrawer");
    drawer.style.display = drawer.style.display === "none" ? "flex" : "none";
  };
  renderFilterDrawer();
  renderGrid();
  updateFilterDot();
  Promise.all([
    api("/api/characters?scope=mine").catch(() => []),
    api("/api/characters?scope=community").catch(() => []),
  ]).then(([mine, community]) => {
    const seen = new Set();
    const all = [];
    for (const c of [...mine, ...community]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
    state.chars = all;
    renderGrid();
  });
}

if (typeof window !== "undefined") {
  window.openCharacterPickerModal = openCharacterPickerModal;
}
