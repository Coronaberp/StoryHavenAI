"use strict";

const THEME_BASES = ["dark", "light"];
const ACCENT_IDS = ["aurum", "azure", "crimson", "verdant", "amethyst", "rose"];
const ACCENT_NAMES = {
  aurum: "Aurum", azure: "Azure", crimson: "Crimson",
  verdant: "Verdant", amethyst: "Amethyst", rose: "Rose Quartz",
};
const ACCENT_SEED_HEX = {
  aurum: "#E3BD6C", azure: "#4FB6FF", crimson: "#E2493D",
  verdant: "#3ECF8E", amethyst: "#A675E0", rose: "#E07BA0",
};


const OVERRIDE_CSS_VAR = {
  accent: "--color-accent", text: "--color-ink", appBg: "--color-paper",
  cmdPurple: "--color-cmd-purple", cmdYellow: "--color-cmd-yellow",
};
const ACCENT_OVERRIDE_KEYS = ["accent", "text", "appBg"];

function _defaultThemeState() {
  return {
    activeBase: "dark",
    dark: { accentId: "aurum", overrides: {} },
    light: { accentId: "aurum", overrides: {} },
  };
}

function _loadThemeState() {
  const saved = store.get("themeState", null);
  if (saved && saved.dark && saved.light && saved.activeBase) return saved;
  const legacyIndex = store.get("themeIndex", null);
  if (legacyIndex !== null && Number.isInteger(legacyIndex)) {
    const perBase = ACCENT_IDS.length;
    const base = THEME_BASES[Math.floor(legacyIndex / perBase) % THEME_BASES.length];
    const accentId = ACCENT_IDS[legacyIndex % perBase] || "aurum";
    return { activeBase: base, dark: { accentId, overrides: {} }, light: { accentId, overrides: {} } };
  }
  return _defaultThemeState();
}

let THEME_STATE = _loadThemeState();

function getThemeState() {
  return THEME_STATE;
}

function applyTheme() {
  const root = document.documentElement;
  const base = THEME_STATE.activeBase;
  const baseState = THEME_STATE[base];
  root.dataset.theme = base;
  root.dataset.accent = baseState.accentId;
  Object.entries(OVERRIDE_CSS_VAR).forEach(([key, cssVar]) => {
    const value = baseState.overrides[key];
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  });
  store.set("themeState", THEME_STATE);
}

function setThemeBase(base) {
  THEME_STATE.activeBase = base;
  applyTheme();
}

function setThemeAccent(base, accentId) {
  THEME_STATE[base] = { accentId, overrides: {} };
  applyTheme();
}

function setThemeOverride(base, key, hexValue) {
  if (ACCENT_OVERRIDE_KEYS.includes(key)) THEME_STATE[base].accentId = "custom";
  THEME_STATE[base].overrides[key] = hexValue;
  applyTheme();
}

function resetCmdColorOverrides(base) {
  delete THEME_STATE[base].overrides.cmdPurple;
  delete THEME_STATE[base].overrides.cmdYellow;
  applyTheme();
}

function clearThemeOverrides(base) {
  const fallbackAccent = THEME_STATE[base].accentId === "custom" ? "aurum" : THEME_STATE[base].accentId;
  THEME_STATE[base] = { accentId: fallbackAccent, overrides: {} };
  applyTheme();
}

applyTheme();
