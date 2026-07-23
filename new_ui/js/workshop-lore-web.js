"use strict";

class WorkshopLoreWebView {
  constructor(entries, chars) {
    this.entries = entries || [];
    this.chars = chars || {};
    this.selectedCharId = Object.keys(this.chars)[0] || "";
    this.categoryFilter = "";
    this.frozen = false;
    this.network = null;
  }

  visibleEntries() {
    return this.entries.filter((e) => {
      if (e.char_id !== null && e.char_id !== this.selectedCharId) return false;
      if (this.categoryFilter && (e.category || "Uncategorized") !== this.categoryFilter) return false;
      return true;
    });
  }

  categoryOptions() {
    const cats = [...new Set(this.visibleEntriesUnfiltered().map((e) => e.category || "Uncategorized"))].sort();
    return [{ value: "", label: t("grimoire_all_categories_option") }, ...cats.map((c) => ({ value: c, label: c }))];
  }

  visibleEntriesUnfiltered() {
    return this.entries.filter((e) => e.char_id === null || e.char_id === this.selectedCharId);
  }

  degreeMap(visible) {
    const ids = new Set(visible.map((e) => e.id));
    const degree = {};
    visible.forEach((e) => { degree[e.id] = 0; });
    visible.forEach((e) => {
      (e.outgoing_links || []).forEach((l) => {
        if (!ids.has(l.target_id)) return;
        degree[e.id] += 1;
        degree[l.target_id] += 1;
      });
    });
    return degree;
  }

  nodeRadius(degree) {
    const base = 18;
    const max = 40;
    return Math.min(max, base + degree * 4);
  }

  resolvedColor(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  glowColor(hex, alpha) {
    const clean = hex.replace("#", "");
    const bytes = clean.length === 3 ? clean.split("").map((c) => c + c) : [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)];
    const [r, g, b] = bytes.map((h) => parseInt(h, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  nodeColor(background, border, selectedBorder) {
    return {
      background, border,
      highlight: { background, border: selectedBorder },
      hover: { background, border: selectedBorder },
    };
  }

  categoryNodeId(cat) {
    return `cat:${cat}`;
  }

  categoryPalette() {
    return [
      { bg: this.resolvedColor("--color-primary"), border: this.resolvedColor("--color-primary-dark") },
      { bg: this.resolvedColor("--color-secondary"), border: this.resolvedColor("--color-secondary-dark") },
      { bg: this.resolvedColor("--color-tertiary-light"), border: this.resolvedColor("--color-tertiary-dark") },
      { bg: this.resolvedColor("--color-cmd-purple"), border: this.resolvedColor("--color-line-2") },
      { bg: this.resolvedColor("--color-cmd-yellow"), border: this.resolvedColor("--color-line-2") },
      { bg: this.resolvedColor("--color-success"), border: this.resolvedColor("--color-line-2") },
    ];
  }

  categoryColor(cat, palette) {
    let hash = 0;
    for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  }

  buildDatasets() {
    const visible = this.visibleEntries();
    const degree = this.degreeMap(visible);
    const accent = this.resolvedColor("--color-accent");
    const accentDeep = this.resolvedColor("--color-accent-deep");
    const inkColor = this.resolvedColor("--color-ink");
    const sec = this.resolvedColor("--color-sec");
    const palette = this.categoryPalette();

    const nodes = [];
    const edges = [];
    const charRootId = `root:${this.selectedCharId}`;
    const globalRootId = "root:global";
    const char = this.chars[this.selectedCharId];
    const hasCharEntries = visible.some((e) => e.char_id === this.selectedCharId);
    const hasGlobalEntries = visible.some((e) => e.char_id === null);

    if (hasCharEntries) {
      nodes.push({
        id: charRootId, label: char ? char.name : t("grimoire_lorebook_label"), shape: "dot", size: 46,
        font: { color: inkColor, size: 16 },
        color: this.nodeColor(accent, accentDeep, accent),
        shadow: { enabled: true, color: this.glowColor(accent, 0.65), size: 44, x: 0, y: 0 },
      });
    }
    if (hasGlobalEntries) {
      nodes.push({
        id: globalRootId, label: t("grimoire_global_lore_label"), shape: "dot", size: 46,
        font: { color: inkColor, size: 16 },
        color: this.nodeColor(accentDeep, accent, accent),
        shadow: { enabled: true, color: this.glowColor(accentDeep, 0.65), size: 44, x: 0, y: 0 },
      });
    }

    const categoryRoots = new Map();
    visible.forEach((e) => {
      const cat = e.category || "Uncategorized";
      const rootId = e.char_id === null ? globalRootId : charRootId;
      if (!categoryRoots.has(cat)) categoryRoots.set(cat, new Set());
      categoryRoots.get(cat).add(rootId);
    });
    categoryRoots.forEach((roots, cat) => {
      const catId = this.categoryNodeId(cat);
      const { bg, border } = this.categoryColor(cat, palette);
      nodes.push({
        id: catId, label: cat, shape: "dot", size: 26,
        font: { color: inkColor, size: 12.5 },
        color: this.nodeColor(bg, border, accent),
        shadow: { enabled: true, color: this.glowColor(bg, 0.5), size: 20, x: 0, y: 0 },
      });
      roots.forEach((rootId) => {
        edges.push({ from: rootId, to: catId, color: { color: accent, opacity: 0.85 }, width: 2.5 });
      });
    });

    visible.forEach((e) => {
      const radius = this.nodeRadius(degree[e.id] || 0);
      const cat = e.category || "Uncategorized";
      const { bg, border } = this.categoryColor(cat, palette);
      const base = {
        id: e.id,
        label: _grimoireEntryTitle(e),
        font: { color: inkColor },
        shadow: { enabled: true, color: this.glowColor(bg, 0.55), size: radius, x: 0, y: 0 },
      };
      const entryBorder = e.char_id === null ? accent : border;
      if (e.image) {
        nodes.push({
          ...base,
          shape: "circularImage",
          image: e.image,
          size: radius,
          borderWidth: e.char_id === null ? 4 : 3,
          color: this.nodeColor(bg, entryBorder, accent),
          shapeProperties: { useBorderWithImage: true },
        });
      } else {
        nodes.push({
          ...base,
          shape: "dot",
          value: radius,
          borderWidth: e.char_id === null ? 3 : 2,
          color: this.nodeColor(bg, entryBorder, accent),
        });
      }
      const catId = this.categoryNodeId(cat);
      edges.push({ from: catId, to: e.id, color: { color: border, opacity: 0.9 }, width: 2 });
    });

    const visibleIds = new Set(visible.map((e) => e.id));
    visible.forEach((e) => {
      (e.outgoing_links || []).forEach((l) => {
        if (!visibleIds.has(l.target_id)) return;
        edges.push({
          from: e.id, to: l.target_id,
          label: l.label || undefined,
          font: { color: sec, size: 10.5, strokeWidth: 3, strokeColor: this.resolvedColor("--color-paper"), align: "top" },
          arrows: { to: { enabled: true, scaleFactor: 0.6 } },
          color: { color: sec, opacity: 0.9 },
          dashes: true, width: 2, smooth: { type: "curvedCW", roundness: 0.15 },
        });
      });
    });
    return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  }

  legendHtml() {
    const cats = [...new Set(this.visibleEntriesUnfiltered().map((e) => e.category || "Uncategorized"))].sort();
    if (!cats.length) return "";
    const palette = this.categoryPalette();
    return `
      <div class="grimoire-web-legend">
        ${cats.map((cat) => {
          const { bg } = this.categoryColor(cat, palette);
          return `<span class="grimoire-web-legend-item"><span class="grimoire-web-legend-dot" style="background:${_attr(bg)}"></span>${_esc(cat)}</span>`;
        }).join("")}
      </div>
    `;
  }

  mount(container) {
    this.container = container;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="grimoire-web-controls">
        ${Object.keys(this.chars).length > 1 ? `<div style="flex:1;min-width:0">${customSelectHtml("gwCharSelect", Object.values(this.chars).map((c) => ({ value: c.id, label: c.name })), this.selectedCharId)}</div>` : ""}
        <div style="flex:1;min-width:0">${customSelectHtml("gwCategorySelect", this.categoryOptions(), this.categoryFilter)}</div>
      </div>
      <div class="grimoire-web-controls">
        <button type="button" class="pe-gen-btn" id="gwReset" style="flex:1;justify-content:center">${t("grimoire_reset_view_button")}</button>
        <button type="button" class="pe-gen-btn" id="gwFreeze" style="flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}">${this.frozen ? t("grimoire_unfreeze_layout_button") : t("grimoire_freeze_layout_button")}</button>
      </div>
      ${this.legendHtml()}
      <div id="gwStage" class="grimoire-web-stage">
        <div id="gwCanvas" class="grimoire-web-canvas"></div>
      </div>
      <p class="grimoire-web-hint">${t("grimoire_tap_node_to_read_hint")}</p>
      <details class="grimoire-web-help">
        <summary>${t("grimoire_how_to_read_web_summary")}</summary>
        <ul>
          <li>${t("grimoire_help_item_lorebook")}</li>
          <li>${t("grimoire_help_item_categories")}</li>
          <li>${t("grimoire_help_item_entries")}</li>
          <li>${t("grimoire_help_item_arrows")}</li>
          <li>${t("grimoire_help_item_spotlight")}</li>
          <li>${t("grimoire_help_item_drag")}</li>
          <li>${t("grimoire_help_item_freeze_reset")}</li>
        </ul>
      </details>
      <div id="gwDetail" class="grimoire-web-detail" hidden></div>
    `;
    if (!Object.keys(this.chars).length) {
      this.container.innerHTML = `<p style="color:var(--color-sec);font-size:13px">${t("grimoire_create_character_first_hint")}</p>`;
      return;
    }
    if (Object.keys(this.chars).length > 1) {
      wireCustomSelect("gwCharSelect", (v) => { this.selectedCharId = v; this.categoryFilter = ""; this.render(); });
    }
    wireCustomSelect("gwCategorySelect", (v) => { this.categoryFilter = v; this.render(); });
    this.container.querySelector("#gwReset").onclick = () => {
      this.hideDetail();
      this.network?.fit();
    };
    this.container.querySelector("#gwFreeze").onclick = () => {
      this.frozen = !this.frozen;
      this.network?.setOptions({ physics: { enabled: !this.frozen } });
      const btn = this.container.querySelector("#gwFreeze");
      btn.textContent = this.frozen ? t("grimoire_unfreeze_layout_button") : t("grimoire_freeze_layout_button");
      btn.style.cssText = `flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}`;
    };
    const canvas = this.container.querySelector("#gwCanvas");
    const { nodes, edges } = this.buildDatasets();
    this.nodesDataSet = nodes;
    this.edgesDataSet = edges;
    this.network = new vis.Network(canvas, { nodes, edges }, {
      physics: {
        enabled: !this.frozen,
        solver: "forceAtlas2Based",
        forceAtlas2Based: { avoidOverlap: 1, springLength: 140, gravitationalConstant: -80 },
        stabilization: { enabled: true, iterations: 150, fit: true },
      },
      interaction: { hover: true, dragNodes: true, dragView: true, zoomView: true },
      nodes: {
        scaling: { min: 18, max: 40 },
        font: { size: 15, strokeWidth: 3, strokeColor: this.resolvedColor("--color-paper") },
      },
      edges: { smooth: { type: "continuous" } },
    });
    this.network.once("stabilizationIterationsDone", () => this.network.fit({ animation: false }));
    this.network.fit({ animation: false });
    this.network.on("click", (params) => {
      if (!params.nodes.length) { this.hideDetail(); return; }
      const nodeId = params.nodes[0];
      if (nodeId === this.selectedNodeId) {
        this.hideDetail();
        return;
      }
      const entry = this.entries.find((e) => e.id === nodeId);
      if (!entry) { this.hideDetail(); return; }
      const neighborhood = [nodeId, ...this.network.getConnectedNodes(nodeId)];
      this.isolateNeighborhood(neighborhood);
      this.network.fit({ nodes: neighborhood, animation: { duration: 400, easingFunction: "easeInOutQuad" } });
      this.selectedNodeId = nodeId;
      this.showDetail(entry);
    });
  }

  isolateNeighborhood(keepIds) {
    const keep = new Set(keepIds);
    this.nodesDataSet.get().forEach((n) => {
      this.nodesDataSet.update({ id: n.id, hidden: !keep.has(n.id) });
    });
    this.edgesDataSet.get().forEach((e) => {
      this.edgesDataSet.update({ id: e.id, hidden: !(keep.has(e.from) && keep.has(e.to)) });
    });
  }

  restoreAll() {
    if (!this.nodesDataSet) return;
    this.nodesDataSet.get().forEach((n) => { if (n.hidden) this.nodesDataSet.update({ id: n.id, hidden: false }); });
    this.edgesDataSet.get().forEach((e) => { if (e.hidden) this.edgesDataSet.update({ id: e.id, hidden: false }); });
  }

  hideDetail() {
    const panel = this.container.querySelector("#gwDetail");
    if (panel) panel.hidden = true;
    this.restoreAll();
    this.selectedNodeId = null;
    this.network?.unselectAll();
  }

  showDetail(entry) {
    const panel = this.container.querySelector("#gwDetail");
    const charName = this.chars[entry.char_id]?.name || t("grimoire_global_label");
    const title = _grimoireEntryTitle(entry);
    panel.innerHTML = `
      <div class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px">${_esc(entry.category || "Uncategorized")} &middot; ${_esc(charName)}</div>
      ${entry.image ? `<img src="${_attr(entry.image)}" alt="" ${entry.is_explicit ? 'data-explicit="1"' : ""} style="width:100%;height:auto;border-radius:10px;margin:6px 0 14px;${entry.is_explicit && !ME?.nsfw_allowed ? "filter:blur(14px) saturate(60%)" : ""}">` : ""}
      <h3 class="font-display" style="margin:0 0 10px">${_esc(title)}</h3>
      ${(entry.keys || []).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${entry.keys.map((k) => `<span class="grimoire-tag" style="border:1px solid var(--color-line-2);border-radius:999px;padding:3px 9px">${_esc(k)}</span>`).join("")}</div>` : ""}
      <p style="font-size:14px;color:var(--color-ink);line-height:1.6;white-space:pre-wrap">${_esc(entry.content)}</p>
      <div style="display:flex;gap:16px;margin-top:16px;font-size:12px;color:var(--color-sec)">
        <span>${t("grimoire_always_label")} <b style="color:var(--color-ink)">${entry.always ? t("grimoire_yes_word") : t("grimoire_no_word")}</b></span>
        <span>${t("grimoire_global_label")} <b style="color:var(--color-ink)">${entry.char_id === null ? t("grimoire_yes_word") : t("grimoire_no_word")}</b></span>
      </div>
      ${_grimoireRelationshipsHtml(entry, this.entries)}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
        <button type="button" class="pe-gen-btn" id="gwDetailEdit">${t("grimoire_edit_button")}</button>
        <button type="button" class="pe-gen-btn" id="gwDetailDelete" style="border-color:var(--color-warn);color:var(--color-warn)">${t("grimoire_delete_button")}</button>
      </div>
    `;
    panel.hidden = false;
    panel.querySelector("#gwDetailEdit").onclick = () => _grimoireEditModal(entry.char_id, entry, this.entries, () => {
      window._activeGrimoireView?.mount(window._activeGrimoireView.main);
    });
    panel.querySelector("#gwDetailDelete").onclick = () => this.showDeleteConfirm(panel, entry, title);
  }

  showDeleteConfirm(panel, entry, title) {
    panel.innerHTML = `
      <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("grimoire_delete_entry_confirm_heading")}</h3>
      <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">"${_esc(title)}" ${t("grimoire_will_be_gone_for_good_with_links")}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="gwDetailCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("grimoire_keep_it_button")}</button>
        <button type="button" class="pe-gen-btn" id="gwDetailConfirmDelete" style="border-color:var(--color-warn);color:var(--color-warn)">${t("grimoire_delete_button")}</button>
      </div>
    `;
    panel.querySelector("#gwDetailCancel").onclick = () => this.hideDetail();
    panel.querySelector("#gwDetailConfirmDelete").onclick = async () => {
      try {
        await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
        toast(t("grimoire_deleted_toast"));
        window._activeGrimoireView?.mount(window._activeGrimoireView.main);
      } catch (err) {
        errorToast(err.message || t("grimoire_couldnt_delete_entry"));
      }
    };
  }
}
