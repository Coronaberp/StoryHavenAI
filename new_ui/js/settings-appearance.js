"use strict";

const FONT_OPTIONS = {
  display: [
    { id: "fraunces", label: "Fraunces (default)", family: "'Fraunces', 'Iowan Old Style', Georgia, serif", google: "Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700" },
    { id: "playfair", label: "Playfair Display", family: "'Playfair Display', Georgia, serif", google: "Playfair+Display:wght@500;600;700" },
    { id: "cormorant", label: "Cormorant Garamond", family: "'Cormorant Garamond', Georgia, serif", google: "Cormorant+Garamond:wght@500;600;700" },
    { id: "spectral", label: "Spectral", family: "'Spectral', Georgia, serif", google: "Spectral:wght@500;600;700" },
    { id: "baskerville", label: "Libre Baskerville", family: "'Libre Baskerville', Georgia, serif", google: "Libre+Baskerville:wght@400;700" },
    { id: "dmserif", label: "DM Serif Display", family: "'DM Serif Display', Georgia, serif", google: "DM+Serif+Display:wght@400" },
  ],
  body: [
    { id: "inter", label: "Inter (default)", family: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif", google: "Inter:wght@400;500;600;700" },
    { id: "source-sans", label: "Source Sans 3", family: "'Source Sans 3', system-ui, sans-serif", google: "Source+Sans+3:wght@400;500;600;700" },
    { id: "work-sans", label: "Work Sans", family: "'Work Sans', system-ui, sans-serif", google: "Work+Sans:wght@400;500;600;700" },
    { id: "nunito", label: "Nunito Sans", family: "'Nunito Sans', system-ui, sans-serif", google: "Nunito+Sans:wght@400;500;600;700" },
    { id: "plex", label: "IBM Plex Sans", family: "'IBM Plex Sans', system-ui, sans-serif", google: "IBM+Plex+Sans:wght@400;500;600;700" },
    { id: "lato", label: "Lato", family: "'Lato', system-ui, sans-serif", google: "Lato:wght@400;700" },
  ],
};
const FONT_CSS_VAR = { display: "--font-display", body: "--font-sans" };
const _loadedFontLinks = new Set();

function getFontChoice() {
  return store.get("fontChoice", null) || { display: "fraunces", body: "inter" };
}

function setFontChoice(role, id) {
  const choice = getFontChoice();
  choice[role] = id;
  store.set("fontChoice", choice);
  applyFontChoice();
}

function resetFontChoice() {
  store.set("fontChoice", null);
  applyFontChoice();
}

function applyFontChoice() {
  const choice = getFontChoice();
  const root = document.documentElement;
  ["display", "body"].forEach((role) => {
    const entry = FONT_OPTIONS[role].find((f) => f.id === choice[role]) || FONT_OPTIONS[role][0];
    root.style.setProperty(FONT_CSS_VAR[role], entry.family);
    if (entry.google && !_loadedFontLinks.has(entry.id)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${entry.google}&display=swap`;
      document.head.appendChild(link);
      _loadedFontLinks.add(entry.id);
    }
  });
}

applyFontChoice();

class AppearanceSettingsView {
  constructor() {
    this.editBase = getThemeState().activeBase;
  }

  mount(main) {
    this.main = main;
    this.render();
  }

  pickBase(base) {
    this.editBase = base;
    setThemeBase(base);
    this.render();
  }

  pickAccent(accentId) {
    setThemeAccent(this.editBase, accentId);
    this.render();
  }

  setOverride(key, hexValue) {
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexValue)) return;
    setThemeOverride(this.editBase, key, hexValue);
    this.render();
  }

  resetColors() {
    clearThemeOverrides(this.editBase);
    this.render();
  }

  resetCmdColors() {
    resetCmdColorOverrides(this.editBase);
    this.render();
  }

  effectiveHex(cssVar, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    return value || fallback;
  }

  themeSectionHtml() {
    const state = getThemeState();
    const baseState = state[this.editBase];
    const swatches = ACCENT_IDS.map((id) => `
      <button type="button" onclick="appearanceView.pickAccent('${id}')"
        class="settings-swatch${baseState.accentId === id ? " on" : ""}"
        style="background:${ACCENT_SEED_HEX[id]}" data-tooltip="${ACCENT_NAMES[id]}" aria-label="${ACCENT_NAMES[id]}"></button>
    `).join("");
    const customSwatch = `
      <button type="button" onclick="appearanceView.pickAccent('custom')"
        class="settings-swatch${baseState.accentId === "custom" ? " on" : ""} grid place-items-center font-mono text-[9px]"
        style="background:var(--color-surface-2);color:var(--color-muted)" data-tooltip="${t("appearance_custom")}" aria-label="${t("appearance_custom")}">?</button>
    `;
    const colorField = (label, key, cssVar, fallback) => {
      const current = baseState.overrides[key] || this.effectiveHex(cssVar, fallback);
      return `
        <div class="flex items-center justify-between gap-3 py-2">
          <span class="text-[13px] text-sec">${label}</span>
          <div class="flex items-center gap-2">
            <button type="button" onclick="openColorPicker('${_attr(current)}', (hex) => appearanceView.setOverride('${key}', hex))" style="width:32px;height:32px;border-radius:8px;border:1px solid var(--color-line-2);background:${_attr(current)};cursor:pointer;padding:0" aria-label="${_attr(t("color_picker_choose_color"))}"></button>
            <input type="text" value="${current}" onchange="appearanceView.setOverride('${key}', this.value)" class="w-24 px-2 py-1.5 rounded-md border border-line bg-surface text-ink text-xs font-mono">
          </div>
        </div>
      `;
    };
    const choice = getFontChoice();
    const fontSelect = (role, label) => `
      <div class="py-2">
        <label class="text-[13px] text-sec block mb-1.5">${label}</label>
        ${customSelectHtml(`fontSelect_${role}`, FONT_OPTIONS[role].map((f) => ({ value: f.id, label: f.label })), choice[role])}
      </div>
    `;
    return `
      ${sEyebrowHtml(t("appearance_theme"))}
      <p class="text-[12px] text-sec mb-3">${t("appearance_colors_and_typefaces_desc")}</p>
      <div class="flex gap-2 mb-4">
        <button type="button" onclick="appearanceView.pickBase('dark')" class="flex-1 py-2.5 rounded-lg text-sm font-medium border" style="border-color:var(--color-line);background:${this.editBase === "dark" ? "var(--color-surface-2)" : "transparent"};color:var(--color-ink)">${t("appearance_dark")}</button>
        <button type="button" onclick="appearanceView.pickBase('light')" class="flex-1 py-2.5 rounded-lg text-sm font-medium border" style="border-color:var(--color-line);background:${this.editBase === "light" ? "var(--color-surface-2)" : "transparent"};color:var(--color-ink)">${t("appearance_light")}</button>
      </div>
      <div class="rounded-lg border border-line bg-surface px-3 mb-1">
        ${fontSelect("display", t("appearance_display_font_headings"))}
        ${fontSelect("body", t("appearance_body_font_everything_else"))}
      </div>
      <div class="rounded-lg border border-line bg-surface-2 px-4 py-3 my-3">
        <div style="font-family:var(--font-display);font-size:19px;font-weight:600;color:var(--color-ink)">${t("appearance_specimen_heading")}</div>
        <div style="font-family:var(--font-sans);font-size:13.5px;color:var(--color-sec);margin-top:4px">${t("appearance_specimen_body")}</div>
      </div>
      <button type="button" onclick="appearanceView.resetFonts()" class="text-xs mb-4" style="color:var(--color-accent)">${t("appearance_reset_to_default_fonts")}</button>
      ${sEyebrowHtml(t("appearance_accent_prefix") + (this.editBase === "dark" ? t("appearance_dark") : t("appearance_light")) + t("appearance_mode_suffix"))}
      <div class="flex flex-wrap gap-3 mb-2">${swatches}${customSwatch}</div>
      <div class="rounded-lg border border-line bg-surface px-3 mb-1">
        ${colorField(t("appearance_accent"), "accent", "--color-accent", ACCENT_SEED_HEX.aurum)}
        ${colorField(t("appearance_text"), "text", "--color-ink", "#F3EFE4")}
        ${colorField(t("appearance_background"), "appBg", "--color-paper", "#0C0C0E")}
      </div>
      <button type="button" onclick="appearanceView.resetColors()" class="text-xs mb-4" style="color:var(--color-accent)">${t("appearance_reset_to_preset")}</button>
      ${sEyebrowHtml(t("appearance_inline_command_highlight"))}
      <p class="text-[12px] text-sec mb-3">${t("appearance_command_syntax_desc")} <code class="font-mono">{/command args}</code> ${t("appearance_command_syntax_desc_suffix")}</p>
      <div class="rounded-lg border border-line bg-surface px-3 mb-1">
        ${colorField(t("appearance_command"), "cmdPurple", "--color-cmd-purple", this.editBase === "dark" ? "#C4A0FF" : "#6E3FCF")}
        ${colorField(t("appearance_arguments"), "cmdYellow", "--color-cmd-yellow", this.editBase === "dark" ? "#F5D76E" : "#8A6D00")}
      </div>
      <div class="flex items-center gap-3 mb-4">
        <span class="font-mono text-[12px] font-bold" style="color:var(--color-cmd-purple)">{/time</span><span class="font-mono text-[12px] font-bold" style="color:var(--color-cmd-yellow)"> do something</span><span class="font-mono text-[12px] font-bold" style="color:var(--color-cmd-purple)">}</span>
      </div>
      <button type="button" onclick="appearanceView.resetCmdColors()" class="text-xs mb-4" style="color:var(--color-accent)">${t("appearance_reset_highlight_colors")}</button>
    `;
  }

  setFont(role, id) {
    setFontChoice(role, id);
    this.render();
  }

  resetFonts() {
    resetFontChoice();
    this.render();
  }

  chatBackgroundSectionHtml() {
    const bg = ME?.chat_background_img || "";
    return `
      ${sEyebrowHtml(t("appearance_chat_background", "Default chat background"))}
      <p class="text-[12px] text-sec mb-3">${t("appearance_chat_background_desc", "Shown behind the message thread whenever a character has no stage art of its own, or you've turned stage art off for one that does. Falls back to the theme background when empty.")}</p>
      <div class="flex gap-3 items-start mb-2">
        <div id="chatBgBox" data-feature="profile" class="relative flex-none rounded-lg overflow-hidden cursor-pointer"
          style="width:160px;height:90px;border:1.5px dashed var(--color-line-2);background:${bg ? `var(--color-surface-2) url('${_attr(bg)}') center/cover no-repeat` : "var(--color-surface-2)"}">
          ${bg
            ? `<button type="button" id="chatBgClear" class="absolute" style="top:5px;right:5px;width:20px;height:20px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:20px;text-align:center">&times;</button>`
            : `<div class="w-full h-full grid place-items-center text-muted"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>`}
        </div>
        <input type="file" id="chatBgFile" accept="image/png,image/jpeg,image/webp" hidden>
      </div>
    `;
  }

  wireChatBackground() {
    const box = this.main.querySelector("#chatBgBox");
    const fileInput = this.main.querySelector("#chatBgFile");
    if (!box || !fileInput) return;
    box.onclick = (e) => { if (!e.target.closest("#chatBgClear")) fileInput.click(); };
    const clearBtn = this.main.querySelector("#chatBgClear");
    if (clearBtn) clearBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await api("/api/me/profile", { method: "PUT", body: JSON.stringify({ chat_background_img: "" }) });
        if (ME) ME.chat_background_img = "";
        toast(t("appearance_chat_background_removed", "Chat background removed."));
        this.render();
      } catch (err) {
        errorToast(err.message || t("appearance_chat_background_failed", "Couldn't update the chat background."));
      }
    };
    fileInput.onchange = () => {
      const f = fileInput.files[0];
      fileInput.value = "";
      if (!f) return;
      maybeCropUpload(f, "16/9", 1024, 576, async (dataUrl, blob) => {
        const fd = new FormData();
        fd.append("file", blob, "chat-background.png");
        try {
          const r = await api("/api/me/chat-background", { method: "POST", body: fd });
          if (ME) ME.chat_background_img = r.chat_background_img;
          toast(t("appearance_chat_background_saved", "Chat background saved."));
          this.render();
        } catch (err) {
          errorToast(err.message || t("appearance_chat_background_failed", "Couldn't update the chat background."));
        }
      });
    };
  }
}

const MESSAGE_STYLE_CATEGORIES = [
  { key: "plain", label: () => t("appearance_style_plain_text"), defaultFlags: "", sample: () => t("appearance_style_sample_plain") },
  { key: "narration", label: () => t("appearance_style_narration"), defaultFlags: "i", sample: () => t("appearance_style_sample_narration") },
  { key: "dialogue", label: () => t("appearance_style_dialogue"), defaultFlags: "", sample: () => t("appearance_style_sample_dialogue") },
  { key: "thoughts", label: () => t("appearance_style_thoughts"), defaultFlags: "", sample: () => t("appearance_style_sample_thoughts") },
  { key: "voice", label: () => t("appearance_style_voice_ooc"), defaultFlags: "ib", sample: () => t("appearance_style_sample_voice") },
  { key: "bold", label: () => t("appearance_style_bold"), defaultFlags: "b", sample: () => t("appearance_style_sample_bold") },
];
const MESSAGE_STYLE_DEFAULT_COLOR = "#E3BD6C";

function _messageStyleDefaultColor(cat) {
  if (cat.key === "plain") {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim();
    return value || MESSAGE_STYLE_DEFAULT_COLOR;
  }
  return MESSAGE_STYLE_DEFAULT_COLOR;
}

function getMessageStyle() {
  const saved = store.get("messageStyle", null) || {};
  const merged = { ...saved };
  let changed = false;
  MESSAGE_STYLE_CATEGORIES.forEach((cat) => {
    if (!merged[cat.key]) {
      merged[cat.key] = { font: "", color: _messageStyleDefaultColor(cat), flags: cat.defaultFlags };
      changed = true;
    }
  });
  if (changed) store.set("messageStyle", merged);
  return merged;
}

function setMessageStyle(style) {
  store.set("messageStyle", style);
  applyMessageStyleVars();
}

function applyMessageStyleVars() {
  const style = getMessageStyle();
  const root = document.documentElement;
  MESSAGE_STYLE_CATEGORIES.forEach((cat) => {
    const entry = style[cat.key];
    const prefix = `--msg-${cat.key}`;
    root.style.setProperty(`${prefix}-color`, entry.color || MESSAGE_STYLE_DEFAULT_COLOR);
    root.style.setProperty(`${prefix}-font`, entry.font ? `'${entry.font}'` : "inherit");
    root.style.setProperty(`${prefix}-fontstyle`, entry.flags.includes("i") ? "italic" : "normal");
    root.style.setProperty(`${prefix}-fontweight`, entry.flags.includes("b") ? "700" : "400");
    root.style.setProperty(`${prefix}-textdecoration`, entry.flags.includes("u") && entry.flags.includes("s")
      ? "underline line-through"
      : entry.flags.includes("u") ? "underline" : entry.flags.includes("s") ? "line-through" : "none");
  });
}

applyMessageStyleVars();

function specimenLineStyle(entry) {
  const parts = [`color:${entry.color || MESSAGE_STYLE_DEFAULT_COLOR}`];
  if (entry.font) parts.push(`font-family:'${_attr(entry.font)}'`);
  if (entry.flags.includes("i")) parts.push("font-style:italic");
  if (entry.flags.includes("b")) parts.push("font-weight:700");
  if (entry.flags.includes("u")) parts.push("text-decoration:underline");
  if (entry.flags.includes("s")) parts.push(entry.flags.includes("u") ? "text-decoration:underline line-through" : "text-decoration:line-through");
  return parts.join(";");
}

Object.assign(AppearanceSettingsView.prototype, {
  messageStyleRowHtml(cat, entry) {
    const flagBtn = (flag, label, title) => `
      <button type="button" onclick="appearanceView.toggleFlag('${cat.key}', '${flag}')"
        class="w-7 h-7 rounded-md border text-xs font-semibold flex-none"
        style="border-color:var(--color-line);background:${entry.flags.includes(flag) ? "var(--color-accent)" : "var(--color-surface)"};color:${entry.flags.includes(flag) ? "var(--color-paper)" : "var(--color-sec)"}"
        data-tooltip="${title}" aria-label="${title}">${label}</button>
    `;
    return `
      <div class="py-3 border-b border-line">
        <div class="text-[13px] text-sec mb-2">${cat.label()}</div>
        <div class="flex items-center gap-2 flex-wrap">
          <input type="text" value="${_attr(entry.font)}" placeholder="default font" onchange="appearanceView.setMessageFont('${cat.key}', this.value)"
            class="flex-1 min-w-[110px] px-2.5 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
          ${flagBtn("i", "I", "Italic")}${flagBtn("b", "B", "Bold")}${flagBtn("u", "U", "Underline")}${flagBtn("s", "S", "Strikethrough")}
          <button type="button" onclick="openColorPicker('${_attr(entry.color)}', (hex) => appearanceView.setColor('${cat.key}', hex))" style="width:32px;height:32px;border-radius:8px;border:1px solid var(--color-line-2);background:${_attr(entry.color)};cursor:pointer;padding:0;flex:none" aria-label="${_attr(t("color_picker_choose_color"))}"></button>
        </div>
      </div>
    `;
  },

  toggleFlag(key, flag) {
    const style = getMessageStyle();
    const entry = style[key];
    entry.flags = entry.flags.includes(flag) ? entry.flags.replace(flag, "") : entry.flags + flag;
    setMessageStyle(style);
    this.render();
  },

  setMessageFont(key, font) {
    const style = getMessageStyle();
    style[key].font = font.trim();
    setMessageStyle(style);
    this.render();
  },

  setColor(key, color) {
    const style = getMessageStyle();
    style[key].color = color;
    setMessageStyle(style);
    this.render();
  },

  resetMessageStyle() {
    store.set("messageStyle", null);
    applyMessageStyleVars();
    this.render();
  },

  messageStyleSectionHtml() {
    const style = getMessageStyle();
    const rows = MESSAGE_STYLE_CATEGORIES.map((cat) => this.messageStyleRowHtml(cat, style[cat.key])).join("");
    const specimenLines = MESSAGE_STYLE_CATEGORIES.map((cat) => `
      <div class="settings-specimen-line">
        <span class="settings-specimen-tag">${cat.label()}</span>
        <span style="${specimenLineStyle(style[cat.key])}">${cat.sample()}</span>
      </div>
    `).join("");
    return `
      ${sEyebrowHtml("Message formatting")}
      <div class="settings-specimen mb-4">${specimenLines}</div>
      <div class="rounded-lg border border-line bg-surface px-3">${rows}</div>
      <button type="button" onclick="appearanceView.resetMessageStyle()" class="text-xs mt-2 mb-2" style="color:var(--color-accent)">${_esc(t("appearance_reset_message_formatting"))}</button>
    `;
  },
});

AppearanceSettingsView.prototype.render = function () {
  this.main.innerHTML = `
    <div class="content-col">
    ${backLinkHtml("Settings")}
    ${pageHeaderHtml("My Dossier", "Settings", t("ph_appearance_title"), t("ph_appearance_sub"))}
    ${this.themeSectionHtml()}
    ${this.chatBackgroundSectionHtml()}
    ${this.messageStyleSectionHtml()}
    </div>
  `;
  wireCustomSelect("fontSelect_display", (value) => this.setFont("display", value));
  wireCustomSelect("fontSelect_body", (value) => this.setFont("body", value));
  this.wireChatBackground();
};

if (typeof window !== "undefined") {
  window.AppearanceSettingsView = AppearanceSettingsView;
}
