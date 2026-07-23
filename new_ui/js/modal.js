"use strict";

const _modalStack = [];

function openModal(innerHtml, { wide = false, onClose = null, dismissible = true } = {}) {
  const layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.innerHTML = `
    <div class="modal${wide ? " modal-wide" : ""}">
      ${dismissible ? `<button type="button" class="modal-close" aria-label="${_attr(t("modal_close"))}" data-tooltip="${_attr(t("modal_close"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ""}
      ${innerHtml}
    </div>
  `;
  document.body.appendChild(layer);
  document.body.classList.add("modal-open");

  const close = () => closeModal(layer, onClose);
  if (dismissible) {
    layer.querySelector(".modal-close").onclick = close;
    layer.addEventListener("click", (e) => {
      if (e.target === layer) close();
    });
  }

  _modalStack.push({ layer, close, dismissible });
  return layer;
}

function closeModal(layer, onClose) {
  const idx = _modalStack.findIndex((m) => m.layer === layer);
  if (idx === -1) return;
  _modalStack.splice(idx, 1);
  layer.remove();
  if (!_modalStack.length) document.body.classList.remove("modal-open");
  onClose?.();
}

function closeTopModal() {
  const top = _modalStack[_modalStack.length - 1];
  top?.close();
}

function confirmDialog(message, opts = {}) {
  const { title = t("modal_are_you_sure"), confirmLabel = t("modal_delete"), cancelLabel = t("modal_keep_it"), danger = true, icon = null } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; resolve(val); };
    const layer = openModal(`
      <div style="padding:4px 2px 2px">
        <div style="display:flex;align-items:center;gap:10px;margin:0 0 6px">
          ${icon ? `<span style="flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb, ${danger ? "var(--color-warn)" : "var(--color-accent)"} 14%, var(--color-surface));color:${danger ? "var(--color-warn)" : "var(--color-accent)"}">${icon}</span>` : ""}
          <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0">${_esc(title)}</h3>
        </div>
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px;white-space:pre-line">${_esc(message)}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="confirmDialogCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${_esc(cancelLabel)}</button>
          <button type="button" class="pe-gen-btn" id="confirmDialogOk" style="border-color:${danger ? "var(--color-warn)" : "var(--color-accent)"};color:${danger ? "var(--color-warn)" : "var(--color-accent)"}">${_esc(confirmLabel)}</button>
        </div>
      </div>
    `, { onClose: () => finish(false) });
    layer.querySelector("#confirmDialogCancel").onclick = () => { finish(false); closeModal(layer); };
    layer.querySelector("#confirmDialogOk").onclick = () => { finish(true); closeModal(layer); };
  });
}

function promptDialog(message, opts = {}) {
  const { title = "", defaultValue = "", confirmLabel = t("modal_ok"), cancelLabel = t("modal_cancel"), placeholder = "", inputType = "text" } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; resolve(val); };
    const layer = openModal(`
      <div style="padding:4px 2px 2px">
        ${title ? `<h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${_esc(title)}</h3>` : ""}
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 10px;white-space:pre-line">${_esc(message)}</p>
        <input type="${_attr(inputType)}" id="promptDialogInput" value="${_attr(defaultValue)}" placeholder="${_attr(placeholder)}"
          style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:16px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="promptDialogCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${_esc(cancelLabel)}</button>
          <button type="button" class="pe-gen-btn" id="promptDialogOk" style="border-color:var(--color-accent);color:var(--color-accent)">${_esc(confirmLabel)}</button>
        </div>
      </div>
    `, { onClose: () => finish(null) });
    const input = layer.querySelector("#promptDialogInput");
    input.focus();
    input.select();
    const submit = () => { finish(input.value); closeModal(layer); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    layer.querySelector("#promptDialogCancel").onclick = () => { finish(null); closeModal(layer); };
    layer.querySelector("#promptDialogOk").onclick = submit;
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !_modalStack.length) return;
  const top = _modalStack[_modalStack.length - 1];
  if (top.dismissible) closeTopModal();
});

if (typeof window !== "undefined") {
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.closeTopModal = closeTopModal;
  window.confirmDialog = confirmDialog;
  window.promptDialog = promptDialog;
}
