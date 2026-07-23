"use strict";

function customSelectHtml(id, options, selected) {
  const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const current = norm.find((o) => o.value === selected) || norm[0] || { value: "", label: "" };
  return `
    <div class="dropdown" id="${_attr(id)}" style="width:100%">
      <button type="button" data-dropdown-toggle
        style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;cursor:pointer">
        <span data-custom-select-label style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(current.label)}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;color:var(--color-muted)"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="dropdown-menu" style="width:100%;max-height:260px;overflow-y:auto">
        ${norm.map((o) => `<button type="button" class="dropdown-item" data-custom-select-value="${_attr(o.value)}">${_esc(o.label)}</button>`).join("")}
      </div>
    </div>
  `;
}

function genPreviewBoxHtml(id, ratio) {
  return `
    <div id="${_attr(id)}" style="position:relative;width:100%;aspect-ratio:${ratio || "1 / 1"};border-radius:14px;overflow:hidden;border:1px solid var(--color-line);background:var(--color-surface);display:grid;place-items:center">
      <div style="text-align:center;color:var(--color-muted);padding:20px">
        <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>
        </div>
        <div style="font-size:13.5px;color:var(--color-sec)">${_esc(t("dropdown_image_will_appear_here"))}</div>
      </div>
    </div>
  `;
}

function setGenPreviewBox(id, { busy, image, statusText } = {}) {
  const box = document.getElementById(id);
  if (!box) return;
  if (busy && image) {
    box.innerHTML = `
      <img src="${_attr(image)}" style="width:100%;height:100%;object-fit:cover" alt="">
      <span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">${_esc(t("dropdown_generating"))}</span>
      ${statusText ? `<div style="position:absolute;bottom:10px;left:10px;font-family:var(--font-mono);font-size:10.5px;color:#fff;background:rgba(10,10,12,.5);padding:4px 9px;border-radius:8px;backdrop-filter:blur(4px)">${_esc(statusText)}</div>` : ""}
    `;
  } else if (busy) {
    box.innerHTML = `
      <div style="text-align:center;color:var(--color-muted);padding:20px">
        <div style="font-size:13.5px;color:var(--color-sec)">${_esc(t("dropdown_generating"))}</div>
        ${statusText ? `<div style="font-family:var(--font-mono);font-size:11.5px;margin-top:8px;color:var(--color-accent)">${_esc(statusText)}</div>` : ""}
      </div>
    `;
  } else if (image) {
    box.innerHTML = `<img src="${_attr(image)}" style="width:100%;height:100%;object-fit:cover" alt="">`;
    _wireZoomPan(box.querySelector("img"));
  } else {
    box.innerHTML = `
      <div style="text-align:center;color:var(--color-muted);padding:20px">
        <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:14px;border:1px solid var(--color-line-2);display:grid;place-items:center;color:var(--color-accent)">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>
        </div>
        <div style="font-size:13.5px;color:var(--color-sec)">${_esc(t("dropdown_image_will_appear_here"))}</div>
      </div>
    `;
  }
}

function wireCustomSelect(id, onChange) {
  const root = document.getElementById(id);
  if (!root) return;
  root.querySelectorAll("[data-custom-select-value]").forEach((btn) => {
    btn.onclick = () => {
      const labelEl = root.querySelector("[data-custom-select-label]");
      if (labelEl) labelEl.textContent = btn.textContent;
      root.querySelector(".dropdown-menu")?.classList.remove("open");
      onChange(btn.dataset.customSelectValue);
    };
  });
}

function refImagePickerHtml(id) {
  return `
    <div id="${_attr(id)}" data-ref-picker>
      <input type="file" accept="image/*" data-ref-file hidden>
      <div data-ref-filled style="display:none;position:relative;width:100%;aspect-ratio:1;border-radius:12px;overflow:hidden;border:1px solid var(--color-line);background:var(--color-surface-2)">
        <img data-ref-thumb-img style="width:100%;height:100%;object-fit:cover;display:block" alt="">
        <div style="position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:3">
          <button type="button" data-ref-replace style="width:30px;height:30px;border-radius:999px;background:rgba(0,0,0,.55);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
          </button>
          <button type="button" data-ref-remove style="width:30px;height:30px;border-radius:999px;background:rgba(0,0,0,.55);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
      <button type="button" data-ref-empty style="width:100%;display:flex;flex-direction:column;align-items:center;gap:7px;padding:22px;background:var(--color-surface);border:1.5px dashed var(--color-line-2);border-radius:12px;color:var(--color-sec);cursor:pointer">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        <span>${_esc(t("dropdown_add_reference_image"))}</span>
        <span style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--color-muted)">${_esc(t("dropdown_drop_or_browse"))}</span>
      </button>
    </div>
  `;
}

function wireRefImagePicker(id, onChange, initialDataUrl) {
  const root = document.getElementById(id);
  if (!root) return;
  const fileInput = root.querySelector("[data-ref-file]");
  const filledBox = root.querySelector("[data-ref-filled]");
  const emptyBtn = root.querySelector("[data-ref-empty]");
  const thumbImg = root.querySelector("[data-ref-thumb-img]");
  _wireZoomPan(thumbImg);
  if (initialDataUrl) {
    thumbImg.src = initialDataUrl;
    filledBox.style.display = "block";
    emptyBtn.style.display = "none";
  }
  const openPicker = () => fileInput.click();
  emptyBtn.onclick = openPicker;
  root.querySelector("[data-ref-replace]").onclick = (e) => { e.stopPropagation(); openPicker(); };
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    maybeCropUpload(file, "1/1", 1024, 1024, (dataUrl) => {
      thumbImg.src = dataUrl;
      thumbImg.style.transform = "";
      filledBox.style.display = "block";
      emptyBtn.style.display = "none";
      onChange(dataUrl);
    });
    fileInput.value = "";
  });
  root.querySelector("[data-ref-remove]").onclick = () => {
    fileInput.value = "";
    thumbImg.src = "";
    thumbImg.style.transform = "";
    filledBox.style.display = "none";
    emptyBtn.style.display = "flex";
    onChange(null);
  };
}

const _pickerData = {};

function _pickerTileHtml(name, meta, selected) {
  const label = meta?.display_name || name;
  const initial = _esc((label[0] || "?").toUpperCase());
  return `
    <button type="button" data-grid-tile="${_attr(name)}" title="${_attr(label)}"
      style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px;border-radius:11px;border:2px solid ${selected ? "var(--color-accent)" : "transparent"};background:var(--color-surface);cursor:pointer;min-width:0">
      <span style="position:relative;width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center;font-size:15px;color:var(--color-muted)">
        ${meta?.image ? `<img src="${_attr(meta.image)}" alt="" style="width:100%;height:100%;object-fit:cover">` : initial}
        ${selected ? `<span style="position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:50%;background:var(--color-accent);color:#000;display:grid;place-items:center;font-size:10px;line-height:1">✓</span>` : ""}
      </span>
      <span style="font-size:10.5px;color:var(--color-ink);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%">${_esc(label)}</span>
    </button>
  `;
}

function _gridPanelHtml(panelId, names, previews) {
  _pickerData[panelId] = { names, previews: previews || {} };
  return `
    <div id="${_attr(panelId)}" data-grid-panel hidden
      style="position:absolute;z-index:30;top:calc(100% + 6px);left:0;right:0;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:13px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px;max-height:min(360px, 60vh);display:flex;flex-direction:column">
      <input type="text" data-grid-search placeholder="Search…"
        style="width:100%;margin-bottom:8px;flex:none;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
      <div data-grid-tiles style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:7px;overflow-y:auto"></div>
    </div>
  `;
}

function _wireGridPanel(panelId, { isSelected, onPick, closeOnPick }) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const { names, previews } = _pickerData[panelId] || { names: [], previews: {} };
  const tilesEl = panel.querySelector("[data-grid-tiles]");
  const searchEl = panel.querySelector("[data-grid-search]");
  const paintTiles = (filter) => {
    const q = (filter || "").trim().toLowerCase();
    const shown = q
      ? names.filter((n) => (previews[n]?.display_name || n).toLowerCase().includes(q))
      : names;
    tilesEl.innerHTML = shown.length
      ? shown.map((n) => _pickerTileHtml(n, previews[n], isSelected(n))).join("")
      : `<p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);text-align:center;padding:10px 0">${_esc(t("dropdown_no_matches"))}</p>`;
    tilesEl.querySelectorAll("[data-grid-tile]").forEach((btn) => {
      btn.onclick = () => {
        onPick(btn.dataset.gridTile);
        if (closeOnPick) panel.hidden = true;
        else paintTiles(searchEl.value);
      };
    });
  };
  searchEl.oninput = () => paintTiles(searchEl.value);
  paintTiles("");
  panel._paintTiles = paintTiles;
}

function _openGridPanel(root, panelId) {
  document.querySelectorAll("[data-grid-panel]").forEach((p) => { if (p.id !== panelId) p.hidden = true; });
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) panel._paintTiles?.("");
}

function checkpointPickerHtml(id, names, previews, selected) {
  const current = (previews || {})[selected] ? selected : (names.includes(selected) ? selected : names[0] || "");
  const meta = (previews || {})[current] || {};
  const label = meta.display_name || current || "Choose a checkpoint";
  return `
    <div id="${_attr(id)}" data-checkpoint-picker style="position:relative">
      <button type="button" data-checkpoint-trigger
        style="width:100%;display:flex;align-items:center;gap:10px;padding:7px;border-radius:11px;border:1px solid var(--color-line);background:var(--color-surface-2);cursor:pointer;text-align:left;min-height:52px">
        <span style="width:38px;height:38px;flex:none;border-radius:9px;overflow:hidden;background:var(--color-surface);display:grid;place-items:center;font-size:14px;color:var(--color-muted)">
          ${meta.image ? `<img src="${_attr(meta.image)}" alt="" style="width:100%;height:100%;object-fit:cover">` : _esc((label[0] || "?").toUpperCase())}
        </span>
        <span style="flex:1;min-width:0">
          <span data-checkpoint-label style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;color:var(--color-ink)">${_esc(label)}</span>
          <span data-checkpoint-desc style="display:${meta.description ? "block" : "none"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--color-muted)">${_esc(meta.description || "")}</span>
        </span>
        <span style="font-size:11.5px;color:var(--color-accent);flex:none;font-weight:600">${_esc(t("dropdown_change"))}</span>
      </button>
      ${_gridPanelHtml(`${id}_panel`, names, previews)}
    </div>
  `;
}

function wireCheckpointPicker(id, onChange) {
  const root = document.getElementById(id);
  if (!root) return;
  const panelId = `${id}_panel`;
  const trigger = root.querySelector("[data-checkpoint-trigger]");
  const labelEl = root.querySelector("[data-checkpoint-label]");
  const descEl = root.querySelector("[data-checkpoint-desc]");
  const thumbEl = trigger.querySelector("span");
  let current = null;
  trigger.onclick = (e) => { e.stopPropagation(); _openGridPanel(root, panelId); };
  _wireGridPanel(panelId, {
    isSelected: (n) => n === current,
    onPick: (name) => {
      current = name;
      const { previews } = _pickerData[panelId];
      const meta = (previews || {})[name] || {};
      const label = meta.display_name || name;
      labelEl.textContent = label;
      if (meta.description) { descEl.textContent = meta.description; descEl.style.display = "block"; }
      else { descEl.style.display = "none"; }
      thumbEl.innerHTML = meta.image
        ? `<img src="${_attr(meta.image)}" alt="" style="width:100%;height:100%;object-fit:cover">`
        : _esc((label[0] || "?").toUpperCase());
      onChange(name);
    },
  });
  document.addEventListener("click", (e) => {
    const liveRoot = document.getElementById(id);
    if (!liveRoot || !liveRoot.contains(e.target)) { const p = document.getElementById(panelId); if (p) p.hidden = true; }
  });
}

const _loraPickerState = {};

function loraPickerHtml(id, allLoraNames, initial, previews) {
  _loraPickerState[id] = new Map((initial || []).map((l) => [l.name, l.strength ?? 1.0]));
  _loraPickerState[`${id}:previews`] = previews || {};
  return `
    <div id="${_attr(id)}" data-lora-picker>
      <div data-lora-rows></div>
      ${allLoraNames.length ? `
        <div style="position:relative;margin-top:6px">
          <button type="button" data-lora-add-trigger
            style="width:100%;padding:9px 11px;border-radius:9px;border:1px dashed var(--color-line-2);background:var(--color-surface-2);color:var(--color-accent);font-size:13px;font-weight:600;cursor:pointer;min-height:44px">
            + Add LoRA
          </button>
          ${_gridPanelHtml(`${id}_addpanel`, allLoraNames, previews)}
        </div>
      ` : ""}
    </div>
  `;
}

function _loraPickerRowsHtml(id) {
  const previews = _loraPickerState[`${id}:previews`] || {};
  return [..._loraPickerState[id]].map(([name, strength]) => {
    const meta = previews[name] || {};
    const keywords = meta.keywords || [];
    return `
    <div data-lora-row="${_attr(name)}" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="width:28px;height:28px;flex:none;border-radius:7px;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center;font-size:11px;color:var(--color-muted)">
          ${meta.image ? `<img src="${_attr(meta.image)}" alt="" style="width:100%;height:100%;object-fit:cover">` : _esc(((meta.display_name || name)[0] || "?").toUpperCase())}
        </span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:12.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(meta.display_name || name)}</span>
          ${meta.description ? `<span style="display:block;font-size:10.5px;color:var(--color-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(meta.description)}</span>` : ""}
        </span>
        <input type="range" min="-8" max="8" step="0.05" value="${strength}" data-lora-strength style="width:70px">
        <input type="number" min="-8" max="8" step="0.05" value="${strength}" data-lora-strength-num class="lora-strength-num" style="width:52px;padding:3px 5px;border-radius:6px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-family:var(--font-mono);font-size:11px">
        <button type="button" data-lora-remove style="background:none;border:none;color:var(--color-muted);cursor:pointer;font-size:18px;line-height:1;padding:6px;min-width:28px">&times;</button>
      </div>
      ${keywords.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${keywords.map((k) => `<button type="button" data-lora-keyword="${_attr(k)}" style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:var(--color-surface-2);color:var(--color-accent);border:1px solid var(--color-line-2);cursor:pointer" title="Add to prompt">+ ${_esc(k)}</button>`).join("")}</div>` : ""}
    </div>
  `;
  }).join("");
}

function wireLoraPicker(id, { onKeywordClick } = {}) {
  const root = document.getElementById(id);
  if (!root) return;
  const rowsEl = root.querySelector("[data-lora-rows]");
  const addTrigger = root.querySelector("[data-lora-add-trigger]");
  const panelId = `${id}_addpanel`;
  const repaint = () => {
    rowsEl.innerHTML = _loraPickerRowsHtml(id);
    rowsEl.querySelectorAll("[data-lora-row]").forEach((row) => {
      const name = row.dataset.loraRow;
      const slider = row.querySelector("[data-lora-strength]");
      const num = row.querySelector("[data-lora-strength-num]");
      slider.addEventListener("input", (e) => {
        _loraPickerState[id].set(name, +e.target.value);
        num.value = (+e.target.value).toFixed(2);
      });
      num.addEventListener("input", (e) => {
        const v = Math.max(-8, Math.min(8, +e.target.value || 0));
        _loraPickerState[id].set(name, v);
        slider.value = v;
      });
      row.querySelector("[data-lora-remove]").onclick = () => {
        _loraPickerState[id].delete(name);
        repaint();
        document.getElementById(panelId)?._paintTiles?.(document.getElementById(panelId).querySelector("[data-grid-search]")?.value || "");
      };
      row.querySelectorAll("[data-lora-keyword]").forEach((btn) => {
        btn.onclick = () => onKeywordClick?.(btn.dataset.loraKeyword);
      });
    });
  };
  repaint();
  if (addTrigger) {
    addTrigger.onclick = (e) => { e.stopPropagation(); _openGridPanel(root, panelId); };
    _wireGridPanel(panelId, {
      isSelected: (n) => _loraPickerState[id].has(n),
      onPick: (name) => {
        if (_loraPickerState[id].has(name)) _loraPickerState[id].delete(name);
        else _loraPickerState[id].set(name, 1.0);
        repaint();
      },
      closeOnPick: false,
    });
    document.addEventListener("click", (e) => {
      const liveRoot = document.getElementById(id);
      if (!liveRoot || !liveRoot.contains(e.target)) { const p = document.getElementById(panelId); if (p) p.hidden = true; }
    });
  }
}

function getLoraPickerValues(id) {
  return [..._loraPickerState[id]].map(([name, strength]) => ({ name, strength }));
}

function closeAllDropdowns(except) {
  document.querySelectorAll(".dropdown-menu.open").forEach((menu) => {
    if (menu !== except) menu.classList.remove("open");
  });
}

document.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-dropdown-toggle]");
  if (toggle) {
    const menu = toggle.parentElement.querySelector(".dropdown-menu");
    if (!menu) return;
    const willOpen = !menu.classList.contains("open");
    closeAllDropdowns();
    menu.classList.toggle("open", willOpen);
    return;
  }
  if (!e.target.closest(".dropdown-menu")) closeAllDropdowns();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAllDropdowns();
});
