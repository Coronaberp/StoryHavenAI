"use strict";

/* Served same-origin from the backend, so API base is empty by default. */
let API = store.get("api","").replace(/\/+$/,"");
let THINK = store.get("think","1")==="1";
let THEME = store.get("theme","dark");
let ME = null;
let _showingLogin = false;
let _settingsFocusNsfw = false;
// Public/shared-screen toggle: forces every NSFW-eligible image to stay
// blurred regardless of the viewer's own nsfw_allowed setting, with a
// click-to-reveal-just-this-one escape hatch (see the document click
// handler below) rather than making them re-run the whole opt-in flow.
// Defaults on — the whole point is protecting a screen someone else might
// be looking at, so it should default to the safer state, not silently
// show everything until a user remembers to flip it on themselves.
let PRIVACY_MODE = store.get("privacyMode","1")==="1";
function nsfwCanShow(c){
  if(!c) return true;
  // Standalone images carry an explicit classified:true/false flag (other
  // content types don't have this field at all, so this only ever fires for
  // them) — until classification actually confirms SFW, treat it as NSFW
  // rather than trusting the pre-classification is_explicit=false default.
  // Fail-safe over fail-open: better to briefly over-blur a real SFW image
  // than to ever show something before it's actually been rated. But this
  // must still respect an already-opted-in viewer the same way a confirmed
  // is_explicit does below — otherwise a user who enabled mature content
  // still can't see their own freshly-generated images for a few seconds.
  if(c.classified===false) return !!(ME && ME.nsfw_allowed) && !PRIVACY_MODE;
  if(!c.is_explicit) return true;
  if(PRIVACY_MODE) return false;
  if(ME && ME.nsfw_allowed) return true;
  return false;
}
function nsfwCls(c){ return nsfwCanShow(c) ? "" : " nsfw-blur"; }
function ratingBadge(c){
  if(c&&c.classified===false){
    return `<span class="rating-badge rb-nsfw" title="${esc(t("rating_pending_tip"))}">${esc(t("rating_pending_label"))}</span>`;
  }
  const explicit=!!(c&&c.is_explicit);
  const reviewed=!!(c&&c.human_reviewed);
  const lbl=explicit?"NSFW":"SFW";
  const tip=reviewed?t("rating_human_tip"):t("rating_ai_tip");
  return `<span class="rating-badge ${explicit?"rb-nsfw":"rb-sfw"}" title="${esc(tip)}">${lbl}</span>`;
}
function openNsfwGate(){
  // Deliberately no one-click "show for this session" bypass — the only way to see
  // mature content is the real, disclaimer-backed confirmation chain in Settings
  // (or being logged in at all, for the sign-in prompt below). A casual one-tap
  // reveal here would undermine the whole point of that confirmation chain.
  openModal(`<div class="nsfw-gate">
    <h3>${esc(t("nsfw_gate_title"))}</h3>
    <p>${esc(t("nsfw_gate_body"))}</p>
    <div class="nsfw-gate-actions" style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
      ${ME ? `<button type="button" class="btn primary" id="nsfwOpenSettings">${esc(t("nsfw_gate_permanent"))}</button>`
           : `<a class="btn primary" href="/">${esc(t("explore_signin_to_chat"))}</a>`}
      <button type="button" class="btn" id="nsfwGateClose" style="margin-top:4px;">${esc(t("btn_cancel"))}</button>
    </div>
  </div>`);
  if(ME) $("#nsfwOpenSettings").onclick=()=>{ closeModal(); _settingsFocusNsfw=true; $("#settingsBtn").click(); };
  $("#nsfwGateClose").onclick=()=>closeModal();
}
document.addEventListener("click", e=>{
  const blurred = e.target.closest && e.target.closest(".nsfw-blur");
  if(!blurred) return;
  e.preventDefault(); e.stopPropagation();
  // If the viewer is genuinely not opted into mature content, this is the
  // real permanent gate — always show it. But if they HAVE opted in and the
  // only reason this is blurred is Privacy Mode being on, clicking reveals
  // just this one image in place instead — a quick peek, not a setting
  // change. It naturally re-blurs on the next render since nsfwCls() is
  // re-evaluated from scratch every time.
  if(PRIVACY_MODE && ME && ME.nsfw_allowed){ blurred.classList.remove("nsfw-blur"); return; }
  openNsfwGate();
}, true);

// FastAPI's error bodies are JSON — {"detail": "..."} for a plain HTTPException,
// or {"detail": [{"loc":[...], "msg":"...", ...}, ...]} for a 422 validation
// error. Every call site's catch block does `errorToast(err.message)`, so
// without unwrapping this here, users saw the raw JSON string (braces, quotes,
// "detail" key and all) instead of a readable sentence. Falls back to the raw
// response text for non-JSON error bodies (proxy/gateway error pages, etc.).
async function _apiErrorMessage(res){
  const text = await res.text();
  const ct = res.headers.get("content-type")||"";
  if(ct.includes("json")){
    try{
      const body = JSON.parse(text);
      const d = body && body.detail;
      if(typeof d === "string") return d;
      if(Array.isArray(d)) return d.map(e=>e && e.msg ? e.msg : JSON.stringify(e)).join("; ") || res.statusText || String(res.status);
      if(d && typeof d === "object" && typeof d.msg === "string") return d.msg;
    }catch(e){ /* not actually valid JSON despite the header — fall through */ }
  }
  // An HTML error page (proxy/gateway timeout, size limit, etc.) instead of
  // a JSON API error — dumping its raw markup into a toast is unreadable
  // noise, so fall back to just the HTTP status in that case.
  if(ct.includes("html") || text.trim().startsWith("<")) return `HTTP ${res.status} ${res.statusText||""}`.trim();
  return text.slice(0,200) || res.statusText || String(res.status);
}
async function api(path, opts){
  const res = await fetch(API+path, opts);
  if(res.status === 401){
    // /explore is deliberately reachable with no session — a stray 401 from
    // some endpoint there shouldn't blow away the explore page and force
    // the login form back over it.
    const onExplorePage = pathSegments()[0]==="explore";
    if(!onExplorePage) showLoginScreen();
    throw new Error("Not authenticated");
  }
  if(!res.ok){ throw new Error(await _apiErrorMessage(res)); }
  const ct = res.headers.get("content-type")||"";
  return ct.includes("json") ? res.json() : res.text();
}
const j = (method, body) => ({method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
function mediaURL(p){
  if(!p) return "";
  if(p.startsWith("/media")) return API+p;
  // User-pasted external URLs (avatars, lore images, banners) — only http(s) is
  // ever a legitimate image/link source here; anything else (javascript:, data:,
  // vbscript:, etc) is rejected rather than passed through into a src/href attr.
  return /^https?:\/\//i.test(p) ? p : "";
}
