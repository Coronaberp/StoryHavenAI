"use strict";

async function boot() {
  try {
    ME = await api("/api/auth/me");
  } catch {
    ME = null;
  }
  route();
}

boot();
