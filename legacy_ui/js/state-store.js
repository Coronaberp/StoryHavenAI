"use strict";

const SPARKLE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><defs><linearGradient id="geminiGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4285f4"/><stop offset="45%" stop-color="#9b5de5"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><path fill="url(#geminiGrad)" d="M12 1c.4 4.7 2.3 6.6 7 7-4.7.4-6.6 2.3-7 7-.4-4.7-2.3-6.6-7-7 4.7-.4 6.6-2.3 7-7Z"/></svg>`;

const store = (() => {
  let ok=false; try{localStorage.setItem("_t","1");localStorage.removeItem("_t");ok=true;}catch(e){}
  const m={};
  return {get:(k,d)=>{try{return (ok?localStorage.getItem(k):m[k])??d;}catch(e){return m[k]??d;}},
          set:(k,v)=>{try{ok?localStorage.setItem(k,v):m[k]=v;}catch(e){m[k]=v;}}};
})();

// One-time cleanup: the admin quick-generate panel's "remember last used"
// steps value was saved under the old 30-step default — since that default
// just changed to 20, strip the stale saved steps once so it actually picks
// up the new default instead of silently keeping showing 30 forever.
if(store.get("igAdminStepsMigration1")!=="1"){
  try{
    const saved=JSON.parse(localStorage.getItem("ig_admin_gen_state")||"null");
    if(saved && typeof saved==="object"){ delete saved.steps; localStorage.setItem("ig_admin_gen_state", JSON.stringify(saved)); }
  }catch(e){}
  store.set("igAdminStepsMigration1","1");
}
