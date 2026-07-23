"use strict";

function _hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return { r: 227, g: 189, b: 108 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function _rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function _rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function _hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function colorSwatchButtonHtml(id, hex, label) {
  return `<button type="button" id="${_attr(id)}" data-color-swatch-button aria-label="${_attr(label || t("color_picker_choose_color"))}" style="width:32px;height:32px;border-radius:8px;border:1px solid var(--color-line-2);background:${_attr(hex)};cursor:pointer;padding:0"></button>`;
}

function openColorPicker(currentHex, onPick) {
  const start = _hexToRgb(currentHex);
  const startHsv = _rgbToHsv(start.r, start.g, start.b);
  let h = startHsv.h, s = startHsv.s, v = startHsv.v;

  const layer = openModal(`
    <div style="padding:4px 2px 2px">
      <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 14px">${t("color_picker_title")}</h3>
      <div id="cpSatVal" style="position:relative;width:100%;aspect-ratio:1.6;border-radius:10px;overflow:hidden;cursor:crosshair;touch-action:none">
        <canvas id="cpSatValCanvas" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>
        <div id="cpSatValThumb" style="position:absolute;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);transform:translate(-50%,-50%);pointer-events:none"></div>
      </div>
      <div id="cpHue" style="position:relative;width:100%;height:16px;margin-top:12px;border-radius:8px;overflow:hidden;cursor:pointer;touch-action:none;background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)">
        <div id="cpHueThumb" style="position:absolute;top:50%;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);transform:translate(-50%,-50%);pointer-events:none"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:16px">
        <div id="cpPreview" style="flex:none;width:36px;height:36px;border-radius:9px;border:1px solid var(--color-line-2)"></div>
        <input type="text" id="cpHexInput" maxlength="7" style="flex:1;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;font-family:monospace">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button type="button" class="pe-gen-btn" id="cpCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("modal_cancel")}</button>
        <button type="button" class="pe-gen-btn" id="cpApply" style="border-color:var(--color-accent);color:var(--color-accent)">${t("color_picker_apply")}</button>
      </div>
    </div>
  `);

  const satValEl = layer.querySelector("#cpSatVal");
  const canvas = layer.querySelector("#cpSatValCanvas");
  const satValThumb = layer.querySelector("#cpSatValThumb");
  const hueEl = layer.querySelector("#cpHue");
  const hueThumb = layer.querySelector("#cpHueThumb");
  const preview = layer.querySelector("#cpPreview");
  const hexInput = layer.querySelector("#cpHexInput");

  const drawSatVal = () => {
    const w = satValEl.clientWidth, hgt = satValEl.clientHeight;
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext("2d");
    const hueRgb = _hsvToRgb(h, 1, 1);
    ctx.fillStyle = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
    ctx.fillRect(0, 0, w, hgt);
    const satGrad = ctx.createLinearGradient(0, 0, w, 0);
    satGrad.addColorStop(0, "rgba(255,255,255,1)");
    satGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, w, hgt);
    const valGrad = ctx.createLinearGradient(0, 0, 0, hgt);
    valGrad.addColorStop(0, "rgba(0,0,0,0)");
    valGrad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = valGrad;
    ctx.fillRect(0, 0, w, hgt);
  };

  const updateFromHsv = ({ skipHex = false } = {}) => {
    const rgb = _hsvToRgb(h, s, v);
    const hex = _rgbToHex(rgb.r, rgb.g, rgb.b);
    preview.style.background = hex;
    if (!skipHex) hexInput.value = hex;
    satValThumb.style.left = `${s * 100}%`;
    satValThumb.style.top = `${(1 - v) * 100}%`;
    hueThumb.style.left = `${(h / 360) * 100}%`;
  };

  const setFromHex = (hex) => {
    const rgb = _hexToRgb(hex);
    const hsv = _rgbToHsv(rgb.r, rgb.g, rgb.b);
    h = hsv.h; s = hsv.s; v = hsv.v;
    drawSatVal();
    updateFromHsv({ skipHex: true });
    hexInput.value = _rgbToHex(rgb.r, rgb.g, rgb.b);
  };

  const pointFromEvent = (el, e) => {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  let draggingSatVal = false, draggingHue = false;
  satValEl.onpointerdown = (e) => { draggingSatVal = true; satValEl.setPointerCapture(e.pointerId); const p = pointFromEvent(satValEl, e); s = p.x; v = 1 - p.y; updateFromHsv(); };
  satValEl.onpointermove = (e) => { if (!draggingSatVal) return; const p = pointFromEvent(satValEl, e); s = p.x; v = 1 - p.y; updateFromHsv(); };
  satValEl.onpointerup = satValEl.onpointercancel = () => { draggingSatVal = false; };

  hueEl.onpointerdown = (e) => { draggingHue = true; hueEl.setPointerCapture(e.pointerId); const p = pointFromEvent(hueEl, e); h = p.x * 360; drawSatVal(); updateFromHsv(); };
  hueEl.onpointermove = (e) => { if (!draggingHue) return; const p = pointFromEvent(hueEl, e); h = p.x * 360; drawSatVal(); updateFromHsv(); };
  hueEl.onpointerup = hueEl.onpointercancel = () => { draggingHue = false; };

  hexInput.addEventListener("change", () => {
    if (/^#?[0-9a-fA-F]{6}$/.test(hexInput.value)) {
      setFromHex(hexInput.value.startsWith("#") ? hexInput.value : "#" + hexInput.value);
    } else {
      hexInput.value = preview.style.background;
    }
  });

  requestAnimationFrame(() => { drawSatVal(); updateFromHsv(); });

  layer.querySelector("#cpCancel").onclick = () => closeModal(layer);
  layer.querySelector("#cpApply").onclick = () => {
    onPick(hexInput.value);
    closeModal(layer);
  };
}

if (typeof window !== "undefined") {
  window.openColorPicker = openColorPicker;
  window.colorSwatchButtonHtml = colorSwatchButtonHtml;
}
