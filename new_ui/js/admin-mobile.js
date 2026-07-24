"use strict";

const ADMIN_SCREENS = [
  { route: "admin", labelKey: "admin_switch_overview", fallback: "Overview" },
  { route: "admin-users", labelKey: "admin_switch_users", fallback: "Users" },
  { route: "admin-moderation", labelKey: "admin_switch_moderation", fallback: "Moderation" },
  { route: "admin-previews", labelKey: "admin_switch_previews", fallback: "Model previews" },
  { route: "admin-train", labelKey: "admin_switch_train", fallback: "Train LoRA" },
  { route: "admin-emojis", labelKey: "admin_switch_emojis", fallback: "Emojis" },
  { route: "admin-config", labelKey: "admin_switch_config", fallback: "Server config" },
  { route: "admin-health", labelKey: "admin_switch_health", fallback: "Health and logs" },
  { route: "admin-features", labelKey: "admin_switch_features", fallback: "Feature flags" },
  { route: "admin-announce", labelKey: "admin_switch_announce", fallback: "Announcements" },
];

function _adminBadgeHtml(count) {
  if (!count) return "";
  return `<span class="admin-switch-badge">${count}</span>`;
}

function adminScreenSwitcherHtml(currentRoute, badges = {}) {
  const current = ADMIN_SCREENS.find((s) => s.route === currentRoute) || ADMIN_SCREENS[0];
  const items = ADMIN_SCREENS.map((s) => `
    <button type="button" class="admin-switch-item${s.route === currentRoute ? " on" : ""}" data-admin-switch-to="${s.route}">
      ${t(s.labelKey, s.fallback)}${_adminBadgeHtml(badges[s.route])}
    </button>`).join("");
  return `
    <div class="admin-switch" data-admin-switch>
      <button type="button" class="admin-switch-current" data-admin-switch-toggle>
        <span>${t(current.labelKey, current.fallback)}${_adminBadgeHtml(badges[currentRoute])}</span>
        <span class="admin-switch-caret">▾</span>
      </button>
      <div class="admin-switch-list hidden" data-admin-switch-list>${items}</div>
    </div>`;
}

function adminAttachScreenSwitcher(root) {
  const wrap = root.querySelector("[data-admin-switch]");
  if (!wrap) return;
  const list = wrap.querySelector("[data-admin-switch-list]");
  wrap.querySelector("[data-admin-switch-toggle]").onclick = () => list.classList.toggle("hidden");
  wrap.querySelectorAll("[data-admin-switch-to]").forEach((el) => {
    el.onclick = () => navigate("/" + el.dataset.adminSwitchTo);
  });
}

function adminCardHtml({ title, pill, pillTone, facts, actions }) {
  const actionHtml = (actions || []).map((a) =>
    `<button type="button" class="admin-card-action${a.primary ? " primary" : ""}" data-admin-action="${_attr(a.id)}">${_esc(a.label)}</button>`).join("");
  return `
    <div class="admin-card">
      <div class="admin-card-top">
        <span class="admin-card-title">${_esc(title)}</span>
        ${pill ? `<span class="admin-pill ${pillTone || ""}">${_esc(pill)}</span>` : ""}
      </div>
      ${facts ? `<div class="admin-card-facts">${_esc(facts)}</div>` : ""}
      ${actionHtml ? `<div class="admin-card-actions">${actionHtml}</div>` : ""}
    </div>`;
}

function adminRowHtml({ id, title, pill, pillTone, meta }) {
  return `
    <button type="button" class="admin-row" data-admin-row="${_attr(id)}">
      <span class="admin-row-main">
        <span class="admin-row-title">${_esc(title)}</span>
        <span class="admin-row-meta">${_esc(meta || "")}</span>
      </span>
      ${pill ? `<span class="admin-pill ${pillTone || ""}">${_esc(pill)}</span>` : ""}
      <span class="admin-row-chev">›</span>
    </button>`;
}

class AdminBottomSheet {
  constructor() {
    this.node = null;
  }

  open({ title, meta, actions, onAction }) {
    this.close();
    const actionHtml = (actions || []).map((a) =>
      `<button type="button" class="admin-sheet-action${a.primary ? " primary" : ""}" data-admin-action="${_attr(a.id)}">${_esc(a.label)}</button>`).join("");
    const node = document.createElement("div");
    node.className = "admin-sheet-layer";
    node.innerHTML = `
      <div class="admin-sheet-backdrop" data-admin-sheet-close></div>
      <div class="admin-sheet">
        <div class="admin-sheet-title">${_esc(title)}</div>
        <div class="admin-sheet-meta">${_esc(meta || "")}</div>
        <div class="admin-sheet-actions">${actionHtml}</div>
      </div>`;
    node.querySelector("[data-admin-sheet-close]").onclick = () => this.close();
    node.querySelectorAll("[data-admin-action]").forEach((el) => {
      el.onclick = () => onAction(el.dataset.adminAction);
    });
    document.body.appendChild(node);
    this.node = node;
  }

  close() {
    if (this.node) {
      this.node.remove();
      this.node = null;
    }
  }
}

let _adminSparkSeq = 0;

function adminSparklineHtml() {
  _adminSparkSeq += 1;
  return `<canvas class="admin-spark" id="adminSpark${_adminSparkSeq}" width="60" height="18"></canvas>`;
}

function adminRenderSparkline(canvasId, points) {
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === "undefined") return null;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  return new Chart(el, {
    type: "line",
    data: { labels: points.map((_, i) => i), datasets: [{ data: points, borderColor: accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3 }] },
    options: { responsive: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } } },
  });
}

if (typeof window !== "undefined") {
  window.ADMIN_SCREENS = ADMIN_SCREENS;
  window.adminScreenSwitcherHtml = adminScreenSwitcherHtml;
  window.adminAttachScreenSwitcher = adminAttachScreenSwitcher;
  window.adminCardHtml = adminCardHtml;
  window.adminRowHtml = adminRowHtml;
  window.AdminBottomSheet = AdminBottomSheet;
  window.adminSparklineHtml = adminSparklineHtml;
  window.adminRenderSparkline = adminRenderSparkline;
}
