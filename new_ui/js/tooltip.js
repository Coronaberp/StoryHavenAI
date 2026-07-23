"use strict";

const _tooltipEl = document.createElement("div");
_tooltipEl.className = "js-tooltip";
document.body.appendChild(_tooltipEl);

let _tooltipTarget = null;

function _positionTooltip(target) {
  const rect = target.getBoundingClientRect();
  const margin = 8;
  _tooltipEl.style.left = "0px";
  _tooltipEl.style.top = "0px";
  const tw = _tooltipEl.offsetWidth;
  const th = _tooltipEl.offsetHeight;
  let left = rect.left + rect.width / 2 - tw / 2;
  let top = rect.top - th - margin;
  if (top < margin) top = rect.bottom + margin;
  left = Math.min(Math.max(left, margin), window.innerWidth - tw - margin);
  top = Math.min(Math.max(top, margin), window.innerHeight - th - margin);
  _tooltipEl.style.left = `${left}px`;
  _tooltipEl.style.top = `${top}px`;
}

function _showTooltip(target) {
  const text = target.dataset.tooltip;
  if (!text) return;
  _tooltipTarget = target;
  _tooltipEl.textContent = text;
  _tooltipEl.classList.add("show");
  _positionTooltip(target);
}

function _hideTooltip() {
  _tooltipTarget = null;
  _tooltipEl.classList.remove("show");
}

document.addEventListener("mouseover", (e) => {
  const target = e.target.closest("[data-tooltip]");
  if (target) _showTooltip(target);
});
document.addEventListener("mouseout", (e) => {
  const target = e.target.closest("[data-tooltip]");
  if (target && target === _tooltipTarget) _hideTooltip();
});
document.addEventListener("focusin", (e) => {
  const target = e.target.closest("[data-tooltip]");
  if (target) _showTooltip(target);
});
document.addEventListener("focusout", (e) => {
  const target = e.target.closest("[data-tooltip]");
  if (target && target === _tooltipTarget) _hideTooltip();
});
window.addEventListener("scroll", _hideTooltip, true);
document.addEventListener("click", _hideTooltip, true);
