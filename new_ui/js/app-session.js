"use strict";

const API = store.get("apiBase", "");
let ME = null;

async function syncMe() {
  try {
    ME = await api("/api/auth/me");
  } catch (err) {
    console.warn("syncMe failed", err);
  }
}

function quickSearch() {
  navigate("/explore/characters");
  const main = document.getElementById("main");
  const focusSearch = () => document.getElementById("pantheonSearch")?.focus();
  focusSearch();
  if (!main) return;
  const observer = new MutationObserver(focusSearch);
  observer.observe(main, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 3000);
}

async function confirmSignOut() {
  const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
  if (!(await confirmDialog(t("session_sign_out_question"), { confirmLabel: t("session_sign_out"), cancelLabel: t("session_stay_signed_in"), icon }))) return;
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  ME = null;
  navigate("/login");
}

async function api(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(API + path, {
    credentials: "include",
    headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let message = res.statusText;
    let detail = null;
    try {
      const body = await res.json();
      detail = body.detail ?? null;
      message = typeof detail === "string" ? detail : message;
    } catch {}
    const err = new Error(message);
    err.detail = detail;
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function sseEvents(response, onEvent) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      await onEvent(ev);
    }
  }
}

function applyAvatarRing() {
  document.querySelectorAll('[data-route="dossier"] [data-avatar-ring]').forEach((ring) => {
    if (ME?.accent_color) {
      ring.style.setProperty(
        "--nav-avatar-ring",
        `linear-gradient(135deg, ${ME.accent_color}, ${ME.banner_color || ME.accent_color})`
      );
    } else {
      ring.style.removeProperty("--nav-avatar-ring");
    }
    const img = ring.querySelector("img");
    const fallback = ring.querySelector("[data-avatar-fallback]");
    if (ME?.avatar) {
      if (img) img.src = ME.avatar;
      img?.classList.remove("hidden");
      fallback?.classList.add("hidden");
    } else {
      fallback && (fallback.textContent = (ME?.username || "?")[0].toUpperCase());
      fallback?.classList.remove("hidden");
      img?.classList.add("hidden");
    }
  });
  document.querySelectorAll("[data-dossier-name]").forEach((el) => {
    el.textContent = ME?.display_name || ME?.username || "";
  });
  document.querySelectorAll("[data-dossier-handle]").forEach((el) => {
    el.textContent = ME?.username ? `@${ME.username}` : "";
  });
  document.querySelectorAll("[data-dossier-role]").forEach((el) => {
    if (ME?.role && ME.role !== "user") {
      el.textContent = ME.role === "dev" ? t("artisans_dev") : t("artisans_admin");
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });
  const adminBtn = document.getElementById("sidebarAdminBtn");
  if (adminBtn) adminBtn.hidden = !(ME?.role === "admin" || ME?.role === "dev");
}

const GUEST_LIMITS = { tokens: 1000000, images: 400, videos: 8 };

function guestQuotaBarHtml(label, used, limit) {
  const pct = Math.min(100, Math.round(used / limit * 100));
  return `
    <div class="guest-quota-row">
      <div class="guest-quota-labels">
        <span>${label}</span>
        <span class="font-mono">${used.toLocaleString()} / ${limit.toLocaleString()}</span>
      </div>
      <div class="guest-quota-track"><div class="guest-quota-fill${pct >= 90 ? " low" : ""}" style="width:${pct}%"></div></div>
    </div>
  `;
}

function guestQuotaBoxHtml() {
  if (ME?.tier !== "guest") return "";
  return `
    <div class="guest-quota-box" data-guest-quota-box>
      <div class="guest-quota-title">${t("guest_quota_title", "Guest trial allowance")}</div>
      ${guestQuotaBarHtml(t("guest_quota_tokens", "Story tokens"), Number(ME.guest_tokens_used || 0), GUEST_LIMITS.tokens)}
      ${guestQuotaBarHtml(t("guest_quota_images", "Images"), Number(ME.guest_images_used || 0), GUEST_LIMITS.images)}
      ${guestQuotaBarHtml(t("guest_quota_videos", "Videos"), Number(ME.guest_videos_used || 0), GUEST_LIMITS.videos)}
      <div class="guest-quota-note">${t("guest_quota_note", "Out of something? An admin can upgrade you - everything carries over.")}</div>
    </div>
  `;
}

async function refreshGuestQuotaBoxes() {
  if (ME?.tier !== "guest" || !document.querySelector("[data-guest-quota-box]")) return;
  try {
    ME = await api("/api/auth/me");
  } catch {
    return;
  }
  document.querySelectorAll("[data-guest-quota-box]").forEach((box) => {
    box.outerHTML = guestQuotaBoxHtml();
  });
}

const EYE_OPEN_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c7 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.3 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function applyCensorToggleVisibility() {
  document.documentElement.dataset.nsfw = ME?.nsfw_allowed ? "1" : "0";
  const btn = document.getElementById("censorToggle");
  if (!btn) return;
  const route = currentRoute();
  btn.classList.toggle("hidden", !ME?.nsfw_allowed || route === "chats/show" || route === "character-new-chat");
  const censored = document.documentElement.dataset.censor === "1";
  btn.innerHTML = censored ? EYE_CLOSED_ICON : EYE_OPEN_ICON;
}

function cycleCensor() {
  const censored = document.documentElement.dataset.censor === "1";
  const next = censored ? "0" : "1";
  document.documentElement.dataset.censor = next;
  store.set("censorMature", !censored);
  applyCensorToggleVisibility();
  document.querySelectorAll(".sandboxed-card-frame").forEach((ifr) => {
    try { ifr.contentDocument.documentElement.dataset.censor = next; } catch {}
  });
}

if (typeof window !== "undefined") {
  document.documentElement.dataset.censor = store.get("censorMature", false) ? "1" : "0";
}

const DESKTOP_SIDEBAR_QUERY = window.matchMedia("(min-width: 1024px)");
function placeRailTools() {
  const rail = document.getElementById("railTools");
  const anchor = document.getElementById("railToolsAnchor");
  const footer = document.getElementById("sidebarFooterIcons");
  if (!rail || !anchor || !footer) return;
  if (DESKTOP_SIDEBAR_QUERY.matches) {
    if (rail.parentElement !== footer) footer.prepend(rail);
  } else if (rail.parentElement !== anchor.parentElement || rail.nextSibling !== anchor) {
    anchor.parentElement.insertBefore(rail, anchor);
  }
}
DESKTOP_SIDEBAR_QUERY.addEventListener("change", placeRailTools);
document.addEventListener("DOMContentLoaded", placeRailTools);
