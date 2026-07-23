"use strict";

// ComfyUI errors arrive as the raw Python dict string (nested
// 'execution_error' messages, full tracebacks) — showing that verbatim in
// the plain toast is what used to render as a giant unstyled wall of text.
// Pull out just the human-readable exception_message when present instead of
// dumping the whole thing.
function _summarizeGenError(msg){
  msg=String(msg||"");
  const m=msg.match(/'exception_message':\s*'([^']*(?:\\.[^']*)*)'/) || msg.match(/"exception_message":\s*"([^"]*(?:\\.[^"]*)*)"/);
  if(m) return m[1].replace(/\\n/g," ").trim();
  return msg.length>300 ? msg.slice(0,300)+"…" : msg;
}

class ToastManager{
  constructor(){
    this.timer=null;
  }
  show(m){
    const box=$("#toast");
    clearTimeout(this.timer);
    box.classList.remove("error");
    box.innerHTML=`<span class="toast-error-msg"></span><button type="button" class="toast-error-close" aria-label="${esc(t("btn_close"))}">×</button>`;
    box.querySelector(".toast-error-msg").textContent=trNow(m);
    box.querySelector(".toast-error-close").onclick=()=>{ clearTimeout(this.timer); box.classList.remove("show"); };
    box.classList.add("show");
    // Matches errorToast's dismiss window — now that every toast has a real
    // [x] close button, there's no reason a plain one should vanish 4x faster
    // than an error before it's even been read.
    this.timer=setTimeout(()=>box.classList.remove("show"),10000);
  }
  // Distinct styled alert for errors — bounded width, scrollable for longer
  // text, a real close button (manual dismiss, since a long error shouldn't
  // vanish on the same short timer as a one-line "Saved." toast), warn-colored
  // border instead of the plain toast's swapped ink/paper colors.
  showError(m){
    const box=$("#toast");
    clearTimeout(this.timer);
    box.classList.add("error");
    box.innerHTML=`<span class="toast-error-msg"></span><button type="button" class="toast-error-close" aria-label="${esc(t("btn_close"))}">×</button>`;
    box.querySelector(".toast-error-msg").textContent=_summarizeGenError(trNow(m));
    box.querySelector(".toast-error-close").onclick=()=>{ clearTimeout(this.timer); box.classList.remove("show","error"); };
    box.classList.add("show");
    this.timer=setTimeout(()=>box.classList.remove("show","error"),10000);
  }
}
const toastManager = new ToastManager();
function toast(m){ return toastManager.show(m); }
function errorToast(m){ return toastManager.showError(m); }
