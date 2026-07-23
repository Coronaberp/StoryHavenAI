"use strict";

const NOTIF_POLL_MS = 15000;

const _NOTIF_LINK_MAP = [
  [/^\/forum\/(.+)$/, (m) => `/explore/forum/${m[1]}`],
  [/^\/images$/, () => "/explore/media"],
];

function notifResolveLink(link) {
  if (!link) return "";
  for (const [pattern, build] of _NOTIF_LINK_MAP) {
    const m = link.match(pattern);
    if (m) return build(m);
  }
  return link;
}

class NotificationsBell {
  constructor() {
    this.items = [];
    this.unreadCount = 0;
    this.pollTimer = null;
    this.open = false;
    this.loadFailed = false;
    this.seenIds = new Set();
    this._seenIdsPrimed = false;
  }

  start() {
    this.refreshCount();
    this.stop();
    this.pollTimer = setInterval(() => this.refreshCount(), NOTIF_POLL_MS);
  }

  stop() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unreadCount = 0;
    this._renderBadge();
    this.close();
  }

  async refreshCount() {
    if (!ME) return;
    try {
      const { count } = await api("/api/notifications/unread-count");
      const grew = count > this.unreadCount;
      this.unreadCount = count;
      this._renderBadge();
      if (grew && count > 0) await this._toastNewArrivals();
    } catch {}
  }

  async _toastNewArrivals() {
    let items;
    try {
      items = await api("/api/notifications");
    } catch {
      return;
    }
    if (!this._seenIdsPrimed) {
      // First poll after page load: every unread item is "old news" the
      // user just hasn't opened the panel for yet, not something that just
      // arrived - record them silently so only genuinely new ones toast.
      items.forEach((n) => this.seenIds.add(n.id));
      this._seenIdsPrimed = true;
      this.items = items;
      return;
    }
    const fresh = items.filter((n) => !n.read && !this.seenIds.has(n.id));
    items.forEach((n) => this.seenIds.add(n.id));
    this.items = items;
    if (this.open) this._paintList();
    if (fresh.length === 1) {
      toast(fresh[0].title || t("notif_new_notification"));
    } else if (fresh.length > 1) {
      toast(`${fresh.length} ${t("notif_new_notifications_suffix")}`);
    }
  }

  _renderBadge() {
    const badge = document.getElementById("notifBellBadge");
    if (!badge) return;
    if (this.unreadCount > 0) {
      badge.textContent = this.unreadCount > 99 ? "99+" : String(this.unreadCount);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  toggle() {
    if (this.open) this.close();
    else this.openPanel();
  }

  close() {
    document.getElementById("notifPanel")?.remove();
    this.open = false;
  }

  async openPanel() {
    this.close();
    this.open = true;
    const btn = document.getElementById("notifBellBtn");
    const panel = document.createElement("div");
    panel.id = "notifPanel";
    panel.className = "notif-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("notif_notifications_heading"));
    panel.innerHTML = `
      <div class="notif-head">
        <span>${t("notif_notifications_heading")}</span>
        <div class="notif-head-actions">
          <button type="button" class="notif-markall" id="notifMarkAll">${t("notif_mark_all_read")}</button>
          <button type="button" class="notif-markall notif-clearall" id="notifClearAll">${t("notif_clear_all")}</button>
        </div>
      </div>
      <div class="notif-list" id="notifList"><div class="notif-empty">…</div></div>
    `;
    document.body.appendChild(panel);
    if (btn) {
      const margin = 12;
      const r = btn.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const fitsBelow = r.bottom + panelRect.height + margin <= window.innerHeight;
      if (fitsBelow) {
        panel.style.top = Math.round(r.bottom + 8) + "px";
      } else {
        panel.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px";
      }
      const fitsRightAligned = r.right - panelRect.width >= margin;
      if (fitsRightAligned) {
        panel.style.right = Math.round(window.innerWidth - r.right) + "px";
      } else {
        const left = Math.min(Math.max(margin, r.left), window.innerWidth - panelRect.width - margin);
        panel.style.left = Math.round(left) + "px";
      }
    }
    panel.querySelector("#notifMarkAll").onclick = async () => {
      try { await api("/api/notifications/read-all", { method: "POST" }); } catch {}
      this.items.forEach((n) => (n.read = true));
      this.unreadCount = 0;
      this._renderBadge();
      this._paintList();
    };
    panel.querySelector("#notifClearAll").onclick = async () => {
      try { await api("/api/notifications", { method: "DELETE" }); } catch {}
      this.items = [];
      this.unreadCount = 0;
      this._renderBadge();
      this._paintList();
    };
    this.loadFailed = false;
    try {
      this.items = await api("/api/notifications");
    } catch {
      this.items = [];
      this.loadFailed = true;
    }
    this._paintList();
  }

  _paintList() {
    const list = document.getElementById("notifList");
    if (!list) return;
    if (this.loadFailed) {
      list.innerHTML = `<div class="notif-empty">${t("notif_couldnt_load_notifications")} <button type="button" class="btn" id="notifRetryBtn">${t("notif_retry")}</button></div>`;
      const retry = list.querySelector("#notifRetryBtn");
      if (retry) retry.onclick = () => this.openPanel();
      return;
    }
    if (!this.items.length) {
      list.innerHTML = `<div class="notif-empty">${t("notif_no_notifications_yet")}</div>`;
      return;
    }
    list.innerHTML = this.items.map((n) => `
      <button type="button" class="notif-item${n.read ? "" : " unread"}" data-id="${_attr(n.id)}" data-link="${_attr(notifResolveLink(n.link))}" data-type="${_attr(n.type || "")}" data-related-id="${_attr(n.related_id || "")}" data-title="${_attr(n.title || "")}" data-body="${_attr(n.body || "")}">
        <span class="notif-dot"></span>
        <span class="notif-body">
          <span class="notif-item-title">${_esc(n.title || "")}</span>
          ${n.body ? `<span class="notif-item-text">${_esc(n.body)}</span>` : ""}
          <span class="notif-item-time">${_esc(timeAgo(n.created))}</span>
        </span>
      </button>
    `).join("");
    list.querySelectorAll(".notif-item").forEach((item) => {
      item.onclick = async () => {
        const id = item.dataset.id;
        const link = item.dataset.link;
        const type = item.dataset.type;
        const relatedId = item.dataset.relatedId;
        if (item.classList.contains("unread")) {
          item.classList.remove("unread");
          const n = this.items.find((x) => x.id === id);
          if (n) n.read = true;
          try { await api(`/api/notifications/${id}/read`, { method: "POST" }); } catch {}
          this.refreshCount();
        }
        this.close();
        if (type === "feature_disabled" || type === "feature_restored") {
          const keys = (relatedId || "").split(",").filter(Boolean);
          const label = item.dataset.title || keys.join(", ");
          window.featureFlags?.showDisabledModal(keys[0] || "unknown", {
            label,
            message: item.dataset.body || null,
            eta_minutes: null,
            disabled_at: null,
            updated_by_name: null,
            updated_by_role: null,
          });
          return;
        }
        if (link) navigate(link);
      };
    });
  }
}

const notificationsBell = new NotificationsBell();

function applyNotifBellVisibility() {
  const btn = document.getElementById("notifBellBtn");
  if (!btn) return;
  if (ME) {
    const route = currentRoute();
    btn.classList.toggle("hidden", route === "chats/show" || route === "character-new-chat");
    notificationsBell.start();
  } else {
    btn.classList.add("hidden");
    notificationsBell.stop();
  }
}

document.addEventListener("click", (e) => {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;
  if (!panel.contains(e.target) && !e.target.closest("#notifBellBtn")) notificationsBell.close();
});

if (typeof window !== "undefined") {
  window.notificationsBell = notificationsBell;
  window.applyNotifBellVisibility = applyNotifBellVisibility;
}
