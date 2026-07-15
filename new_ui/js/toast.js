"use strict";

class ToastManager {
  constructor() {
    this.timer = null;
  }

  _render(message, isError) {
    const box = document.getElementById("toast");
    if (!box) return;
    clearTimeout(this.timer);
    box.classList.toggle("error", isError);
    box.innerHTML = `
      <span class="toast-msg"></span>
      <button type="button" class="toast-close" aria-label="Close">&times;</button>
    `;
    box.querySelector(".toast-msg").textContent = message;
    box.querySelector(".toast-close").onclick = () => {
      clearTimeout(this.timer);
      box.classList.remove("show");
    };
    box.classList.add("show");
    this.timer = setTimeout(() => box.classList.remove("show", "error"), 10000);
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
