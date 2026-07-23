"use strict";
/* ============================ LIVE UPDATE CHECK ============================
   A SPA tab never re-fetches the js/css bundle on its own — client-side routing
   only swaps #main's innerHTML, it doesn't reload <script>/<link> tags. So even
   with no-cache headers on those files (see server.py), a tab left open across
   a deploy keeps running the JS it loaded at page-open time. This polls a tiny
   fingerprint of the served static files and offers a one-click reload the
   moment they change, instead of relying on the user to remember to hard-refresh. */
let _siteVersion=null;
async function _fetchVersionInfo(){
  try{ const r=await fetch("/version",{cache:"no-store"}); if(r.ok) return await r.json(); }
  catch(e){ /* offline or mid-deploy — just try again next tick */ }
  return null;
}
async function _fetchVersion(){
  const info=await _fetchVersionInfo();
  return info?info.v:null;
}
function _showUpdateBanner(){
  if($("#updateBanner")) return;
  // Auto-reloads instead of waiting on a click — nothing of the user's is
  // actually at risk: chat drafts (see the "draft:"+sid persistence above),
  // Create-panel state, and similar in-progress work are all already
  // continuously saved to localStorage as the user types/selects, which
  // survives a reload the same as any other page load. Still gives visible
  // notice + a countdown rather than yanking the page out from under them
  // with zero warning.
  let secs=15;
  const b=el(`<div id="updateBanner" class="update-banner">A new version is available — reloading in <span id="updateBannerSecs">${secs}</span>s.<button type="button" id="updateReload">Reload now</button></div>`);
  document.body.appendChild(b);
  $("#updateReload").onclick=()=>location.reload();
  const timer=setInterval(()=>{
    secs--;
    const s=$("#updateBannerSecs"); if(s) s.textContent=secs;
    if(secs<=0){ clearInterval(timer); location.reload(); }
  },1000);
}
async function startVersionWatch(){
  const info=await _fetchVersionInfo();
  _siteVersion=info?info.v:null;
  const tag=$("#railAppVersion");
  if(tag && info?.app_version) tag.textContent="v"+info.app_version;
  const check=async()=>{
    const v=await _fetchVersion();
    if(v && _siteVersion && v!==_siteVersion) _showUpdateBanner();
  };
  setInterval(check, 60000);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") check(); });
}
