"use strict";

async function boot() {
  if (sessionStorage.getItem("sh_known_anon") === "1") {
    ME = null;
    route();
    return;
  }
  try {
    ME = await api("/api/auth/me");
  } catch {
    ME = null;
    sessionStorage.setItem("sh_known_anon", "1");
  }
  if (ME) await initInterfaceTranslations();
  route();
  if (ME) checkOwnProfileComplianceOnBoot();
  if (typeof featureFlags !== "undefined") featureFlags.start();
}

boot();
