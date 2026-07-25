"use strict";

class ToastManager {
  _render(message, isError) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const box = document.createElement("div");
    box.className = `toast${isError ? " error" : ""}`;
    box.innerHTML = `
      <span class="toast-msg"></span>
      <button type="button" class="toast-close" aria-label="${_attr(t("modal_close"))}">&times;</button>
    `;
    box.querySelector(".toast-msg").textContent = message;
    const dismiss = () => {
      clearTimeout(timer);
      box.classList.remove("show");
      box.addEventListener("transitionend", () => box.remove(), { once: true });
      setTimeout(() => box.remove(), 300);
    };
    box.querySelector(".toast-close").onclick = dismiss;
    container.appendChild(box);
    requestAnimationFrame(() => box.classList.add("show"));
    const timer = setTimeout(dismiss, 5000);
  }

  show(message) {
    this._render(message, false);
  }

  showError(message) {
    this._render(message, true);
  }
}

const toastManager = new ToastManager();
function toast(message) {
  return toastManager.show(message);
}
function errorToast(message) {
  return toastManager.showError(message);
}

if (typeof window !== "undefined") {
  window.toast = toast;
  window.errorToast = errorToast;
}
