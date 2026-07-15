"use strict";

const API = store.get("apiBase", "");
let ME = null;

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
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

function applyAvatarRing() {
  const ring = document.querySelector('[data-route="dossier"] [data-avatar-ring]');
  if (!ring) return;
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
}

const EYE_OPEN_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c7 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.3 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function applyCensorToggleVisibility() {
  const btn = document.getElementById("censorToggle");
  if (!btn) return;
  btn.classList.toggle("hidden", !ME?.nsfw_allowed);
  const censored = document.documentElement.dataset.censor === "1";
  btn.innerHTML = censored ? EYE_CLOSED_ICON : EYE_OPEN_ICON;
}

function cycleCensor() {
  const censored = document.documentElement.dataset.censor === "1";
  document.documentElement.dataset.censor = censored ? "0" : "1";
  store.set("censorMature", !censored);
  applyCensorToggleVisibility();
}

if (typeof window !== "undefined") {
  document.documentElement.dataset.censor = store.get("censorMature", false) ? "1" : "0";
}
