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
