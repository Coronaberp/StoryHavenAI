"use strict";

let APPEARANCE = (()=>{ try{ return JSON.parse(store.get("appearance","{}")); }catch(e){ return {}; } })();
// A typed font name with no comma is assumed to be a bare Google Font name
// (e.g. "Lora") rather than a full font-stack ("Georgia, serif") — those
// already resolve locally, so only single bare names get a stylesheet pulled.
function ensureGoogleFont(name){
  if(!name || name.includes(",")) return;
  const id="gf-"+name.replace(/[^a-z0-9]/gi,"-").toLowerCase();
  if(document.getElementById(id)) return;
  const link=document.createElement("link");
  link.id=id; link.rel="stylesheet";
  link.href="https://fonts.googleapis.com/css2?family="+encodeURIComponent(name).replace(/%20/g,"+")+":ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap";
  document.head.appendChild(link);
}
// Accent/text are stored per light/dark base (lightAccent/darkAccent, etc.)
// so each base keeps its own preset — e.g. dark can be Aurum while light is
// Rose Quartz — falling back to the older single accent/text keys for
// appearance data saved before this split existed.
function _curAccent(){ return APPEARANCE[THEME+"Accent"] ?? APPEARANCE.accent; }
function _curText(){ return APPEARANCE[THEME+"Text"] ?? APPEARANCE.text; }
function _curAppBg(){ return APPEARANCE[THEME+"AppBg"] ?? APPEARANCE.appBg; }
function applyAppearance(){
  const r=document.documentElement, a=APPEARANCE;
  const accent=_curAccent(), text=_curText(), appBg=_curAppBg();
  const set=(k,v)=> v ? r.style.setProperty(k,v) : r.style.removeProperty(k);
  [a.font,a.msgFont,a.narrationFont,a.dialogueFont,a.thoughtFont,a.voiceFont,a.boldFont].forEach(ensureGoogleFont);
  set("--sans", a.font);
  set("--msg-font", a.msgFont);
  set("--md-em-color", a.narrationColor);
  set("--md-em-font", a.narrationFont);
  set("--md-quote-color", a.dialogueColor);
  set("--md-quote-font", a.dialogueFont);
  set("--md-code-color", a.thoughtColor);
  set("--md-code-font", a.thoughtFont);
  set("--md-voice-color", a.voiceColor);
  set("--md-voice-font", a.voiceFont);
  set("--md-strong-color", a.boldColor);
  set("--md-strong-font", a.boldFont);
  const applyFlags=(prefix,flags)=>{
    if(flags===undefined||flags===null){ set(`--md-${prefix}-fontstyle`,null); set(`--md-${prefix}-fontweight`,null); set(`--md-${prefix}-textdecoration`,null); return; }
    set(`--md-${prefix}-fontstyle`, flags.includes("i")?"italic":"normal");
    set(`--md-${prefix}-fontweight`, flags.includes("b")?"700":"400");
    set(`--md-${prefix}-textdecoration`, [flags.includes("u")&&"underline",flags.includes("s")&&"line-through"].filter(Boolean).join(" ")||"none");
  };
  applyFlags("em", a.narrationFlags);
  applyFlags("quote", a.dialogueFlags);
  applyFlags("code", a.thoughtFlags);
  applyFlags("voice", a.voiceFlags);
  applyFlags("strong", a.boldFlags);
  // Custom text/accent/background colors are blended mostly-toward the picked
  // color (85%), with only a slight admixture of the theme's own base tone
  // (color-mix against --ink-base/--accent-base/--paper-base) so a curated
  // preset like "Azure Depths" actually reads as blue instead of a muddy
  // compromise with the default gold — a 55/45 split used to wash it out.
  set("--ink", text && `color-mix(in srgb, ${text} 85%, var(--ink-base) 15%)`);
  set("--accent", accent && `color-mix(in srgb, ${accent} 85%, var(--accent-base) 15%)`);
  set("--accent-deep", accent && `color-mix(in srgb, ${accent} 85%, var(--accent-base) 15%)`);
  // --violet/--violet-deep are a legacy name still driving primary-button
  // gradients (.btn.primary, .nav .new) — repointed to gold by default (see
  // base.css), but never repainted by a custom accent unless mirrored here too.
  set("--violet", accent && `color-mix(in srgb, ${accent} 85%, var(--accent-base) 15%)`);
  set("--violet-deep", accent && `color-mix(in srgb, ${accent} 70%, black 30%)`);
  // --accent-soft/--accent-tint are separate static alpha-tinted variables
  // (not derived from --accent) that dozens of surfaces read directly for
  // hover/active backgrounds — without overriding these too, those surfaces
  // stayed gold-tinted no matter what accent was picked.
  set("--accent-soft", accent && `color-mix(in srgb, ${accent} 14%, transparent)`);
  set("--accent-tint", accent && `color-mix(in srgb, ${accent} 7%, transparent)`);
  // appBg is per-base too (see _curAppBg) — otherwise picking a background
  // tint for dark bled into light (and vice versa) the moment either base
  // was switched to, since they'd have shared one global value. --paper-base
  // already flips per light/dark (see base.css), so tinting it with the same
  // accent hue automatically stays theme-appropriate on top of that — a pale
  // wash in light mode, a deep wash in dark mode. --surface/--surface-2
  // (sidebar, cards, toasts) and --line/--line-2 (borders, incl. the
  // scrollbar thumb's base color) are separate static gold-tinted variables
  // read all over the app — every one of them stayed gold with only --paper
  // covered.
  set("--paper", appBg && `color-mix(in srgb, ${appBg} 40%, var(--paper-base) 60%)`);
  set("--surface", appBg && `color-mix(in srgb, ${appBg} 25%, var(--paper-base) 75%)`);
  set("--surface-2", appBg && `color-mix(in srgb, ${appBg} 35%, var(--paper-base) 65%)`);
  set("--line", appBg && `color-mix(in srgb, ${appBg} 20%, var(--paper-base) 80%)`);
  set("--line-2", appBg && `color-mix(in srgb, ${appBg} 30%, var(--paper-base) 70%)`);
  set("--chat-bg", a.chatBg);   // used by the chat scene as a fallback background — scoped to the stage backdrop only, so a raw color here doesn't risk the wider theme
}
function saveAppearance(patch){ APPEARANCE={...APPEARANCE,...patch}; store.set("appearance",JSON.stringify(APPEARANCE)); applyAppearance(); }

// Six accent presets, each usable against either the light or dark base theme
// (color-mixed onto --accent-base/--ink-base, which differ per base) — so
// picking a preset plus Light/Dark yields 12 distinct looks total. Text has
// separate light-safe (dark, high-contrast on a pale background) and
// dark-safe (pale, high-contrast on a near-black background) values per
// preset — a single fixed text color read as unreadable pink-on-pink once
// applied to light mode at strength, since it was tuned only for dark.
function THEME_PRESETS(){
  return [
    {id:"default", name:t("theme_preset_default"), swatch:"#E3BD6C", patch:{accent:"",textDark:"",textLight:"",appBg:""}},
    {id:"azure", name:t("theme_preset_azure"), swatch:"#4fb6ff", patch:{accent:"#4fb6ff",textDark:"#cfe3f2",textLight:"#0d3a5c",appBg:"#4fb6ff"}},
    {id:"crimson", name:t("theme_preset_crimson"), swatch:"#e2493d", patch:{accent:"#e2493d",textDark:"#f0dcd9",textLight:"#5c1410",appBg:"#e2493d"}},
    {id:"verdant", name:t("theme_preset_verdant"), swatch:"#3ecf8e", patch:{accent:"#3ecf8e",textDark:"#d9f0e2",textLight:"#0d3a20",appBg:"#3ecf8e"}},
    {id:"amethyst", name:t("theme_preset_amethyst"), swatch:"#a675e0", patch:{accent:"#a675e0",textDark:"#e6d9f2",textLight:"#3a1a5c",appBg:"#a675e0"}},
    {id:"rose", name:t("theme_preset_rose"), swatch:"#e07ba0", patch:{accent:"#e07ba0",textDark:"#f2dce6",textLight:"#5c1030",appBg:"#e07ba0"}},
  ];
}
function activePresetForBase(base){
  // Every relevant field has to match, not accent alone — editing just the
  // text color or app background while keeping a preset's accent used to
  // still claim that preset's name; now any manual tweak away from a
  // preset's exact values falls through to no match (i.e. Custom).
  const accent=(APPEARANCE[base+"Accent"]||"").toLowerCase();
  const text=(APPEARANCE[base+"Text"]||"").toLowerCase();
  const appBg=(APPEARANCE[base+"AppBg"]||"").toLowerCase();
  return THEME_PRESETS().find(p=>{
    const pText=(base==="dark"?p.patch.textDark:p.patch.textLight)||"";
    return accent===(p.patch.accent||"").toLowerCase()
        && text===pText.toLowerCase()
        && appBg===(p.patch.appBg||"").toLowerCase();
  }) || null;
}
function activePresetName(base){
  const p=activePresetForBase(base);
  return p ? p.name : null;
}
// True once anything under "Appearance (this device)" has drifted from
// default for this base — either no preset's colors match exactly, or any
// of the other device-local fields (font, chat background) is set. Neither
// is part of any preset's patch, so having either customized always means
// "no longer just Aurum/Azure Depths/etc" regardless of what the colors
// alone happen to match.
function themeIsCustom(base){
  const otherFieldsCustom=!!(
    (APPEARANCE.font && APPEARANCE.font.trim()) ||
    (APPEARANCE.chatBg && APPEARANCE.chatBg.trim())
  );
  return !activePresetForBase(base) || otherFieldsCustom;
}
// Two small tabs (Light/Dark), each a dot + "LIGHT THEME · AURUM"-style
// label reflecting that base's own current preset — switching between them
// swaps which base's Text/Accent/App-background fields are shown below
// (#apModeFieldsWrap), the same way the Model & Generation / Advanced tabs
// swap panels, rather than opening a picker modal.
function themeModeTabs(activeBase){
  const tab=base=>{
    const custom=themeIsCustom(base);
    const accent=APPEARANCE[base+"Accent"]||"#E3BD6C";
    const name=custom?t("theme_preset_custom"):activePresetName(base);
    const dot=custom?`<span class="theme-mode-tab-dot custom"></span>`
                    :`<span class="theme-mode-tab-dot" style="background:${esc(accent)}"></span>`;
    return `<button type="button" class="theme-mode-tab${base===activeBase?" on":""}" data-base="${base}">
      ${dot}
      <span>${esc(t(base==="dark"?"ap_theme_pills_dark":"ap_theme_pills_light"))} · ${esc(name)}</span>
    </button>`;
  };
  return `<div class="theme-mode-tabs" id="themeModeTabs">${tab("light")}${tab("dark")}</div>`;
}
// Duplicates modal-settings.js's local colorField() markup rather than
// sharing it — that helper is scoped inside the settings render closure and
// isn't reachable from here, and these three fields need to be regenerated
// from here whenever the Light/Dark tab switches.
function _apColorField(id,label,val){
  const isHex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(val||"");
  return `<div class="field ap-color-field" style="margin:0 0 12px">
    <label>${esc(label)}</label>
    <div class="ap-color-controls">
      <input type="text" id="${id}" value="${esc(val||"")}" placeholder="default">
      <button type="button" class="ap-swatch ap-color-picker ap-mode-swatch" data-for="${id}" style="background:${isHex?esc(val):"#E3BD6C"}"></button>
    </div>
  </div>`;
}
function apModeFieldsHTML(base){
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${_apColorField("ap_text",t("ap_text"), APPEARANCE[base+"Text"])}
      ${_apColorField("ap_accent",t("ap_accent"), APPEARANCE[base+"Accent"])}
    </div>
    ${_apColorField("ap_appbg",t("ap_appbg"), APPEARANCE[base+"AppBg"])}
    <button type="button" class="btn" id="ap_browse_presets" data-base="${base}" style="margin:0 0 16px">${esc(t("theme_picker_title"))}</button>`;
}
function openThemePickerModal(base, onApply){
  if(typeof base==="function"){ onApply=base; base=THEME; }   // old call sites passed just onApply
  const presets=THEME_PRESETS();
  const currentAccent=(APPEARANCE[base+"Accent"]||"").toLowerCase();
  openModal(`
    <button class="modal-close" id="tpClose">${esc(t("btn_close"))}</button>
    <h3>${esc(t("theme_picker_title"))}</h3>
    <div class="theme-preset-grid" id="tpGrid">
      ${presets.map(p=>`
        <button type="button" class="theme-preset-tile${currentAccent===(p.patch.accent||"").toLowerCase()?" on":""}" data-id="${p.id}">
          <span class="theme-preset-swatch" style="background:${p.swatch}"></span>
          <span class="theme-preset-name">${esc(p.name)}</span>
        </button>`).join("")}
    </div>`, "", {stack:true});
  $("#tpClose").onclick=closeModal;
  $("#tpGrid").querySelectorAll(".theme-preset-tile").forEach(btn=>{
    btn.onclick=()=>{
      const p=presets.find(x=>x.id===btn.dataset.id);
      // Saved under the target base explicitly, not whichever is active
      // right now — so picking from the Light pill always writes light's
      // own preset even while you're currently viewing Dark, and vice versa.
      if(p) saveAppearance({[base+"Accent"]:p.patch.accent,
        [base+"Text"]:base==="dark"?p.patch.textDark:p.patch.textLight,
        [base+"AppBg"]:p.patch.appBg});
      closeModal();
      if(onApply) onApply();
    };
  });
}

const _ICON_MOON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const _ICON_SUN='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const _ICON_EYE_OFF='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.36 18.36 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const _ICON_EYE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

function applyTheme(theme){
  THEME=theme; store.set("theme",theme);
  document.documentElement.dataset.theme = (theme==="light") ? "light" : "";
  const b=document.getElementById("themeBtn");
  if(b){
    const dark=theme==="dark", key=dark?"theme_light_mode":"theme_dark_mode";
    b.innerHTML = dark?_ICON_SUN:_ICON_MOON;
    b.title = t(key); b.setAttribute("aria-label", t(key));
    b.classList.toggle("on", !dark);
  }
  // Each base (light/dark) keeps its own accent/text preset — switching
  // bases has to re-derive --accent/--ink/etc. for whichever one is now
  // active, not just flip --paper-base/--ink-base and leave stale colors.
  if(typeof applyAppearance==="function") applyAppearance();
}
function toggleTheme(){ applyTheme(THEME==="dark"?"light":"dark"); }
applyTheme(THEME);
applyAppearance();

function applyPrivacyMode(on){
  PRIVACY_MODE=on; store.set("privacyMode", on?"1":"0");
  const b=document.getElementById("privacyBtn");
  if(b){
    const key=on?"privacy_mode_on":"privacy_mode_off";
    b.innerHTML = on?_ICON_EYE_OFF:_ICON_EYE;
    b.title = t(key); b.setAttribute("aria-label", t(key));
    b.classList.toggle("on", on);
  }
  // Every already-rendered blur decision on the page is stale the instant
  // this flips (nsfwCls() was baked into markup at render time, not live) —
  // re-run the router against the current path to redraw the current view
  // with fresh decisions, without pushing a duplicate history entry.
  if(typeof route==="function" && ME) route();
}
function togglePrivacyMode(){ applyPrivacyMode(!PRIVACY_MODE); }
applyPrivacyMode(PRIVACY_MODE);
