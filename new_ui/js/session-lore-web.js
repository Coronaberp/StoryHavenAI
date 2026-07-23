"use strict";

export function sessionLoreCategoryColor(category, palette) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export function sessionLoreDegreeMap(entries) {
  const ids = new Set(entries.map((e) => e.id));
  const degree = {};
  entries.forEach((e) => { degree[e.id] = 0; });
  entries.forEach((e) => {
    (e.links || []).forEach((link) => {
      if (!ids.has(link.target_id)) return;
      degree[e.id] += 1;
      degree[link.target_id] += 1;
    });
  });
  return degree;
}

export function sessionLoreNodeRadius(degree) {
  return Math.min(40, 18 + degree * 4);
}

class SessionLoreWebView {
  constructor(entries, onEdit) {
    this.entries = entries || [];
    this.onEdit = onEdit;
    this.frozen = window.matchMedia("(max-width: 639px)").matches;
    this.network = null;
  }

  palette() {
    return [
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-primary-dark").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-secondary").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-secondary-dark").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-tertiary-light").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-tertiary-dark").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-cmd-purple").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-line-2").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-cmd-yellow").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-line-2").trim() },
      { bg: getComputedStyle(document.documentElement).getPropertyValue("--color-success").trim(),
        border: getComputedStyle(document.documentElement).getPropertyValue("--color-line-2").trim() },
    ];
  }

  categoryNodeId(cat) {
    return `cat:${cat}`;
  }

  categoryColorAssignments(entries, palette) {
    const assignments = new Map();
    entries.forEach((e) => {
      const cat = e.category || "Uncategorized";
      if (!assignments.has(cat)) {
        assignments.set(cat, palette[assignments.size % palette.length]);
      }
    });
    return assignments;
  }

  buildDatasets() {
    const entries = this.entries;
    const degree = sessionLoreDegreeMap(entries);
    const palette = this.palette();
    const categoryColors = this.categoryColorAssignments(entries, palette);
    const inkColor = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
    const warn = getComputedStyle(document.documentElement).getPropertyValue("--color-warn").trim();
    const sec = getComputedStyle(document.documentElement).getPropertyValue("--color-sec").trim();
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--color-paper").trim();

    const nodes = [];
    const edges = [];
    const categoryIds = new Set();
    entries.forEach((e) => {
      const cat = e.category || "Uncategorized";
      const catId = this.categoryNodeId(cat);
      if (!categoryIds.has(catId)) {
        categoryIds.add(catId);
        const { bg, border } = categoryColors.get(cat);
        nodes.push({
          id: catId, label: cat, shape: "dot", size: 26,
          font: { color: inkColor, size: 12.5 },
          color: { background: bg, border, highlight: { background: bg, border: accent }, hover: { background: bg, border: accent } },
        });
      }
    });
    entries.forEach((e) => {
      const cat = e.category || "Uncategorized";
      const { bg, border } = categoryColors.get(cat);
      const radius = sessionLoreNodeRadius(degree[e.id] || 0);
      const nodeBorder = e.player_edited ? warn : border;
      nodes.push({
        id: e.id, label: e.name || cat, shape: "dot", value: radius,
        font: { color: inkColor },
        color: { background: bg, border: nodeBorder, highlight: { background: bg, border: accent }, hover: { background: bg, border: accent } },
        borderWidth: e.player_edited ? 3 : 2,
      });
      edges.push({ from: this.categoryNodeId(cat), to: e.id, color: { color: border, opacity: 0.9 }, width: 2 });
    });
    const visibleIds = new Set(entries.map((e) => e.id));
    entries.forEach((e) => {
      (e.links || []).forEach((link) => {
        if (!visibleIds.has(link.target_id)) return;
        edges.push({
          from: e.id, to: link.target_id,
          label: link.label || undefined,
          font: { color: sec, size: 10.5, strokeWidth: 3, strokeColor: paper, align: "top" },
          arrows: { to: { enabled: true, scaleFactor: 0.6 } },
          color: { color: sec, opacity: 0.9 },
          dashes: true, width: 2, smooth: { type: "curvedCW", roundness: 0.15 },
        });
      });
    });
    return { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  }

  legendHtml() {
    const cats = [...new Set(this.entries.map((e) => e.category || "Uncategorized"))].sort();
    if (!cats.length) return "";
    const palette = this.palette();
    const categoryColors = this.categoryColorAssignments(this.entries, palette);
    return `
      <div class="grimoire-web-legend">
        ${cats.map((cat) => {
          const { bg } = categoryColors.get(cat);
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
    if (!this.entries.length) {
      this.container.innerHTML = `<p style="color:var(--color-sec);font-size:13px;padding:6px 0 16px">${t("chat_nothing_revealed_yet")}</p>`;
      return;
    }
    this.container.innerHTML = `
      <div class="grimoire-web-controls">
        <button type="button" class="pe-gen-btn" id="slwReset" style="flex:1;justify-content:center">${t("grimoire_reset_view_button")}</button>
        <button type="button" class="pe-gen-btn" id="slwFreeze" style="flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}">${this.frozen ? t("grimoire_unfreeze_layout_button") : t("grimoire_freeze_layout_button")}</button>
      </div>
      ${this.legendHtml()}
      <div class="grimoire-web-stage">
        <div id="slwCanvas" class="grimoire-web-canvas"></div>
      </div>
      <p class="grimoire-web-hint">${t("grimoire_tap_node_to_read_hint")}</p>
      <div id="slwDetail" class="grimoire-web-detail" hidden></div>
    `;
    this.container.querySelector("#slwReset").onclick = () => {
      this.hideDetail();
      this.network?.fit();
    };
    this.container.querySelector("#slwFreeze").onclick = () => {
      this.frozen = !this.frozen;
      this.network?.setOptions({ physics: { enabled: !this.frozen } });
      const btn = this.container.querySelector("#slwFreeze");
      btn.textContent = this.frozen ? t("grimoire_unfreeze_layout_button") : t("grimoire_freeze_layout_button");
      btn.style.cssText = `flex:1;justify-content:center${this.frozen ? ";border-color:var(--color-accent);color:var(--color-accent)" : ""}`;
    };
    const canvas = this.container.querySelector("#slwCanvas");
    const { nodes, edges } = this.buildDatasets();
    this.nodesDataSet = nodes;
    this.edgesDataSet = edges;
    this.network = new vis.Network(canvas, { nodes, edges }, {
      physics: {
        enabled: !this.frozen,
        solver: "forceAtlas2Based",
        forceAtlas2Based: { avoidOverlap: 1, springLength: 120, gravitationalConstant: -70 },
        stabilization: { enabled: true, iterations: 150, fit: true },
      },
      interaction: { hover: true, dragNodes: true, dragView: true, zoomView: true },
      nodes: { scaling: { min: 18, max: 40 }, font: { size: 14 } },
      edges: { smooth: { type: "continuous" } },
    });
    this.network.once("stabilizationIterationsDone", () => this.network.fit({ animation: false }));
    this.network.fit({ animation: false });
    this.network.on("click", (params) => {
      if (!params.nodes.length) { this.hideDetail(); return; }
      const nodeId = params.nodes[0];
      const entry = this.entries.find((e) => e.id === nodeId);
      if (!entry) { this.hideDetail(); return; }
      if (nodeId === this.selectedNodeId) { this.hideDetail(); return; }
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

  showDetail(entry) {
    const panel = this.container.querySelector("#slwDetail");
    panel.innerHTML = `
      <div class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent);margin-bottom:4px">${_esc(entry.category || "Uncategorized")}${entry.player_edited ? ` &middot; ${t("chat_edited_badge")}` : ""}</div>
      <h3 class="font-display" style="margin:0 0 10px">${_esc(entry.name || t("chat_untitled_lore_entry"))}</h3>
      <p style="font-size:14px;color:var(--color-ink);line-height:1.6;white-space:pre-wrap">${_esc(entry.content)}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button type="button" class="pe-gen-btn" id="slwDetailEdit">${t("chat_edit")}</button>
      </div>
    `;
    panel.hidden = false;
    panel.querySelector("#slwDetailEdit").onclick = () => this.onEdit && this.onEdit(entry);
  }

  hideDetail() {
    const panel = this.container.querySelector("#slwDetail");
    if (panel) panel.hidden = true;
    this.restoreAll();
    this.selectedNodeId = null;
    this.network?.unselectAll();
  }
}

if (typeof window !== "undefined") {
  window.SessionLoreWebView = SessionLoreWebView;
}
