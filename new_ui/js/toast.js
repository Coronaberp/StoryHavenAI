"use strict";

class ToastManager {
  constructor() {
    this.timer = null;
    this.queue = [];
    this.showing = false;
  }

  _render(message, isError) {
    const box = document.getElementById("toast");
    if (!box) return;
    clearTimeout(this.timer);
    box.classList.toggle("error", isError);
    box.innerHTML = `
      <span class="toast-msg"></span>
      <button type="button" class="toast-close" aria-label="${_attr(t("modal_close"))}">&times;</button>
    `;
    box.querySelector(".toast-msg").textContent = message;
    box.querySelector(".toast-close").onclick = () => {
      clearTimeout(this.timer);
      box.classList.remove("show");
      this.showing = false;
      this._dequeue();
    };
    box.classList.add("show");
    this.showing = true;
    this.timer = setTimeout(() => {
      box.classList.remove("show", "error");
      this.showing = false;
      this._dequeue();
    }, 10000);
  }

  _dequeue() {
    if (this.queue.length > 0) {
      const { message, kind } = this.queue.shift();
      this._render(message, kind === "error");
    }
  }

  show(message) {
    if (this.showing) {
      this.queue.push({ message, kind: "normal" });
    } else {
      this._render(message, false);
    }
  }

  showError(message) {
    if (this.showing) {
      this.queue.push({ message, kind: "error" });
    } else {
      this._render(message, true);
    }
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
