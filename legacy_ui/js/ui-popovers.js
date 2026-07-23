"use strict";

/* In-app confirm popover, used instead of window.confirm() for destructive
   actions triggered from inside another modal — window.confirm() is blocked
   silently (no dialog, no error) in some embedded/sandboxed browsing contexts,
   which makes the action look like a dead button with zero feedback. */
function confirmPopover(anchor, message, confirmLabel, onConfirm, onCancel){
  const pop=document.createElement("div");
  pop.className="confirm-pop";
  pop.innerHTML=`<p>${esc(trNow(message))}</p><div class="confirm-pop-actions">
    <button type="button" class="btn" id="cfPopCancel">${esc(t("btn_cancel"))}</button>
    <button type="button" class="btn danger" id="cfPopGo">${esc(confirmLabel)}</button>
  </div>`;
  pop.style.visibility="hidden";
  document.body.appendChild(pop);
  const popH=pop.offsetHeight;
  if(anchor){
    const rect=anchor.getBoundingClientRect();
    const fitsBelow=rect.bottom+6+popH <= window.innerHeight;
    pop.style.left=Math.max(8,Math.min(rect.left, window.innerWidth-268))+"px";
    pop.style.top=(fitsBelow ? rect.bottom+6 : Math.max(8,rect.top-popH-6))+window.scrollY+"px";
  }else{
    pop.style.left=Math.max(8,(window.innerWidth-260)/2)+"px";
    pop.style.top=Math.max(8,(window.innerHeight-popH)/2)+window.scrollY+"px";
  }
  pop.style.visibility="";
  let settled=false;
  const close=cancel=>{ pop.remove(); document.removeEventListener("mousedown",onOutside); document.removeEventListener("keydown",onEsc); if(cancel && !settled){ settled=true; onCancel&&onCancel(); } };
  const onOutside=e=>{ if(!pop.contains(e.target) && e.target!==anchor) close(true); };
  const onEsc=e=>{ if(e.key==="Escape") close(true); };
  pop.querySelector("#cfPopCancel").onclick=()=>close(true);
  pop.querySelector("#cfPopGo").onclick=()=>{ settled=true; close(false); onConfirm(); };
  setTimeout(()=>{ document.addEventListener("mousedown",onOutside); document.addEventListener("keydown",onEsc); },0);
}
/* Promise-based wrapper for the inline `if(!(await confirmAction(...)))return;`
   pattern that replaced native confirm(). anchor may be null to center. */
function confirmAction(anchor, message, confirmLabel){
  return new Promise(resolve=>{
    confirmPopover(anchor, message, confirmLabel||t("btn_delete"), ()=>resolve(true), ()=>resolve(false));
  });
}

