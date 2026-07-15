"use strict";

const _modalStack = [];

function openModal(innerHtml, { wide = false, onClose = null } = {}) {
  const layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.innerHTML = `
    <div class="modal${wide ? " modal-wide" : ""}">
      <button type="button" class="modal-close" aria-label="Close">Close</button>
      ${innerHtml}
    </div>
  `;
  document.body.appendChild(layer);
  document.body.classList.add("modal-open");

  const close = () => closeModal(layer, onClose);
  layer.querySelector(".modal-close").onclick = close;
  layer.addEventListener("click", (e) => {
    if (e.target === layer) close();
  });

  _modalStack.push({ layer, close });
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _modalStack.length) closeTopModal();
});

if (typeof window !== "undefined") {
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.closeTopModal = closeTopModal;
}
