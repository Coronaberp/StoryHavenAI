"use strict";

const THEME_BASES = ["dark", "light"];
const ACCENT_IDS = ["aurum", "azure", "crimson", "verdant", "amethyst", "rose"];
const ACCENT_NAMES = {
  aurum: "Aurum", azure: "Azure", crimson: "Crimson",
  verdant: "Verdant", amethyst: "Amethyst", rose: "Rose Quartz",
};

const THEMES = THEME_BASES.flatMap((base) =>
  ACCENT_IDS.map((accentId) => ({ base, accentId }))
);

const SUN_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="4.2" y1="4.2" x2="5.9" y2="5.9"/><line x1="18.1" y1="18.1" x2="19.8" y2="19.8"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="19.8" x2="5.9" y2="18.1"/><line x1="18.1" y1="5.9" x2="19.8" y2="4.2"/></svg>';
const MOON_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function applyTheme(index) {
  const { base, accentId } = THEMES[index];
  const root = document.documentElement;

  root.dataset.theme = base;
  root.dataset.accent = accentId;

  store.set("themeIndex", index);
  const icon = document.querySelector("[data-theme-icon]");
  if (icon) icon.innerHTML = base === "light" ? SUN_ICON : MOON_ICON;
}

function cycleTheme() {
  const current = store.get("themeIndex", 0);
  applyTheme((current + 1) % THEMES.length);
}

applyTheme(store.get("themeIndex", 0));
