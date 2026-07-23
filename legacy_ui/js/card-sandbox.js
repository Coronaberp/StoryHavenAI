"use strict";

/* Custom card HTML/CSS is untrusted and often uses a global `*` reset plus
   generic class names (.card, .text, .stat…) that would otherwise collide
   with — or stomp on — the app's own styles if injected straight into the
   page DOM. A sandboxed iframe keeps its CSS fully isolated in both
   directions. No allow-scripts, so nothing inside can execute JS even if
   something slipped past DOMPurify; allow-same-origin only lets us read
   contentDocument.body.scrollHeight to auto-size the frame. */
/* Extracted <style> text bypasses DOMPurify, so a crafted stylesheet could
   otherwise phone home via url(http://attacker/beacon) or @import. Strip any
   absolute/protocol-relative url() (keep data: and relative refs) and @import. */
/* Custom cards may only produce working links via the sanctioned placeholders
   ({{share}}, {{edit}}, {{characters}}, {{links}}) — those are substituted
   server-/client-side into real same-origin (or platform-icon) links. A user
   typing their own raw <a href="https://..."> or a CSS url(https://...) would
   bypass that and use the card to send visitors off-platform, so both are
   rejected at save time. Returns the offending URL, or null if clean. */
/* Google Fonts is the one legitimate reason a custom card's CSS ever needs an
   external reference — its stylesheet host (googleapis.com) and the actual
   font-file host its stylesheet points at (gstatic.com) are allowlisted for
   @import/url() font-loading use only. This does NOT extend to a clickable
   <a href> anywhere in the body — that's still always rejected as external,
   since a real hyperlink to fonts.googleapis.com in visible content makes no
   sense and isn't what this exception is for. */
/* Dedicated, font-only services — never general-purpose CDNs (jsDelivr, cdnjs,
   unpkg, etc. are deliberately excluded even though they sometimes host font
   files, since they can also serve arbitrary scripts/JSON/anything else
   through that same domain, which would undermine the actual point of this
   allowlist). Each entry here has no realistic path to loading something
   other than a font or font stylesheet. */
const ALLOWED_FONT_HOSTS=["fonts.googleapis.com","fonts.gstatic.com","fonts.bunny.net",
  "use.typekit.net","p.typekit.net","api.fontshare.com","cdn.fontshare.com"];
function isAllowedFontHost(v){
  try{
    const u=new URL(String(v||"").trim().replace(/^\/\//, "https://"), location.origin);
    return ALLOWED_FONT_HOSTS.includes(u.hostname);
  }catch(e){ return false; }
}
function findExternalCardLink(html){
  let doc;
  try{ doc=new DOMParser().parseFromString(html||"", "text/html"); }catch(e){ return null; }
  for(const a of doc.querySelectorAll("a[href]")){
    const href=(a.getAttribute("href")||"").trim();
    if(/^(https?:)?\/\//i.test(href)){
      try{
        const u=new URL(href, location.origin);
        if(u.origin!==location.origin) return href;
      }catch(e){ return href; }
    }
  }
  /* Off-origin <img>/<svg><image>/<source> are the same "phone home to an
     external server on view" problem external <a href> and CSS url() are
     already blocked for — an unguarded remote image silently beacons every
     viewer's IP/UA to an attacker-controlled host, and DOMPurify's default
     config passes these attributes through untouched. */
  for(const el of doc.querySelectorAll("img[src], source[src], [poster], image")){
    for(const attr of ["src","poster","href","xlink:href"]){
      const val=(el.getAttribute(attr)||"").trim();
      if(!val || !/^(https?:)?\/\//i.test(val)) continue;
      if(isAllowedFontHost(val)) continue;
      try{
        const u=new URL(val, location.origin);
        if(u.origin!==location.origin) return val;
      }catch(e){ return val; }
    }
  }
  for(const styleEl of doc.querySelectorAll("style")){
    const text=styleEl.textContent||"";
    const importRe=/@import\s+(?:url\(\s*(['"]?)([^)'"]*)\1\s*\)|(['"])([^'"]*)\3)/gi;
    let im;
    while((im=importRe.exec(text))){
      const target=im[2]||im[4]||"";
      if(target && /^(https?:)?\/\//i.test(target) && !isAllowedFontHost(target)) return target;
    }
    const urlRe=/url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/gi;
    let m;
    while((m=urlRe.exec(text))){
      if(isAllowedFontHost(m[2])) continue;
      try{
        const u=new URL(m[2]);
        if(u.origin!==location.origin) return m[2];
      }catch(e){ return m[2]; }
    }
  }
  return null;
}
function sanitizeCardCSS(css){
  /* The @import target itself (url(...) or a bare quoted string) must be
     bounded by its own closing quote/paren, NOT by the next semicolon — a
     real Google Fonts URL requesting multiple weights (e.g.
     "wght@500;600;700;800") contains literal semicolons inside the query
     string, and a naive /@import[^;]*;?/ stops at the first one, truncating
     the import mid-URL into garbage that then gets left dangling as stray
     text. Only the trailing media-query list (if any), after the properly-
     bounded target, is scanned up to the real terminating semicolon. */
  let out=String(css||"").replace(/@import\s+(?:url\(\s*(['"]?)([^)'"]*)\1\s*\)|(['"])([^'"]*)\3)[^;]*;?/gi, (m,_q1,urlTarget,_q2,strTarget)=>{
    const target=urlTarget||strTarget||"";
    return (target && isAllowedFontHost(target)) ? m : "";
  });
  out=out.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m,_q,u)=>{
    const v=u.trim();
    if(/^data:/i.test(v)) return m;
    if(isAllowedFontHost(v)) return m;
    if(/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//")) return "none";
    if(v.includes("\\")) return "none";
    return m;
  });
  return out;
}
function mountSandboxedHTML(container, html, {autoHeight=true, onReady}={}){
  const ifr=document.createElement("iframe");
  // allow-same-origin alone blocks ALL top-level navigation, including a plain
  // <a href> a card author put in their own markup. allow-top-navigation-by-
  // user-activation looks like the fix on paper, but for a srcdoc-loaded frame
  // (as opposed to a real src="...") real-browser testing showed it doesn't
  // reliably target the TOP browsing context — the click instead navigates
  // the iframe itself to the destination URL, which then fails to render
  // (that destination is a full SPA page requiring JS, and this frame still
  // has no allow-scripts) leaving a dead, blank iframe. So instead: no
  // top-navigation sandbox token at all (clicks the interceptor below misses
  // are simply inert, never mis-navigate), and the parent page — which has
  // full script access to this document via allow-same-origin, independent
  // of the iframe's own script sandboxing — intercepts internal link clicks
  // itself and drives the SPA's real navigate() (see wireCardInternalLinks).
  ifr.sandbox="allow-same-origin";
  ifr.style.cssText="width:100%;border:0;display:block;background:#000;"+(autoHeight?"":"height:100%;");
  // Custom cards render against a fixed black backdrop regardless of the
  // app's own light/dark theme — most are designed on dark backgrounds and
  // otherwise flash/show through as white in light mode before (or unless)
  // the card's own CSS paints a background.
  // Pull <style> blocks out before sanitizing — DOMPurify's HTML parser can
  // mangle raw CSS text (@import, selectors with special chars) even with
  // ADD_TAGS:["style"]. Plain CSS text has no script-execution vector, so
  // it's safe to carry over untouched while the actual markup still goes
  // through DOMPurify.
  const styles=[];
  const markup=(html||"").replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m,css)=>{ styles.push(sanitizeCardCSS(css)); return ""; });
  // Same "no phone-home to an external host" rule CSS url()/@import and <a
  // href> already enforce, applied to resource-loading attributes DOMPurify
  // otherwise passes through untouched (img/source src, svg xlink:href,
  // video poster) — an unguarded remote image silently beacons every
  // viewer's IP/UA to an attacker-controlled host on render. Render-time
  // net for content saved before findExternalCardLink covered this too.
  const stripOffOriginResource=node=>{
    for(const attr of ["src","poster","href","xlink:href"]){
      const v=node.getAttribute && node.getAttribute(attr);
      if(!v || !/^(https?:)?\/\//i.test(v.trim())) continue;
      if(isAllowedFontHost(v)) continue;
      try{
        if(new URL(v, location.origin).origin===location.origin) continue;
      }catch(e){}
      node.removeAttribute(attr);
    }
  };
  DOMPurify.addHook("afterSanitizeAttributes", stripOffOriginResource);
  const cleanBody=DOMPurify.sanitize(markup, {});
  DOMPurify.removeHook("afterSanitizeAttributes", stripOffOriginResource);
  // This is a fully separate document (srcdoc), so the parent page's own
  // themed scrollbar CSS doesn't reach in here — without this the browser's
  // plain default scrollbar shows instead, clashing against the dark
  // backdrop above (most visible in the small presentation-HTML preview
  // pane, which scrolls almost immediately).
  const scrollbarCss="html,body{margin:0;background:#000;scrollbar-color:#555 transparent;scrollbar-width:thin;}"+
    "::-webkit-scrollbar{width:10px;height:10px;}::-webkit-scrollbar-track{background:transparent;}"+
    "::-webkit-scrollbar-thumb{background:#555;border-radius:8px;border:2px solid #000;}"+
    "::-webkit-scrollbar-thumb:hover{background:#888;}";
  ifr.srcdoc=`<!doctype html><html><head><style>${scrollbarCss}\n${styles.join("\n")}</style></head><body>${cleanBody}</body></html>`;
  ifr.onload=()=>{ try{
    if(autoHeight) ifr.style.height=ifr.contentDocument.body.scrollHeight+"px";
    wireCardInternalLinks(ifr.contentDocument);
    onReady&&onReady(ifr.contentDocument);
  }catch(e){} };
  container.innerHTML="";
  container.appendChild(ifr);
  return ifr;
}
/* Same-origin <a href="/..."> links a card author writes directly (or that a
   placeholder like {{characters}} generates) can't rely on real cross-document
   top-navigation from inside a sandboxed srcdoc iframe (see the sandbox
   comment in mountSandboxedHTML) — so the parent intercepts the click itself
   and drives the SPA router directly. This also means it's a real client-side
   transition instead of a hard reload, matching how every other in-app link
   already behaves. External links never reach here — findExternalCardLink
   already blocks those at save time and DOMPurify still applies regardless. */
function wireCardInternalLinks(doc){
  doc.querySelectorAll("a[href]").forEach(a=>{
    const href=a.getAttribute("href")||"";
    if(!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const isSpaRoute = href.startsWith("/") && !href.startsWith("/api/") && !href.startsWith("/media/");
    a.addEventListener("click", e=>{
      if(e.defaultPrevented) return;
      e.preventDefault();
      if(isSpaRoute && e.button===0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey){ navigate(href); return; }
      // Everything else (external URLs, /media//api/ direct links, or an SPA
      // route opened with a modifier key) can't just navigate on its own —
      // the card iframe is sandboxed with no allow-popups/allow-top-navigation
      // token at all (see mountSandboxedHTML), so the click is otherwise
      // silently swallowed with no error and nothing visibly happens. The
      // parent window carries none of that restriction, so open it from here.
      window.open(href, "_blank", "noopener,noreferrer");
    });
  });
}

/* Shared SSE reader: invokes onEvent for each parsed `data:` event object,
   buffering partial frames split across chunk boundaries (split on the
   blank-line separator). */
async function sseEvents(response, onEvent){
  const reader=response.body.getReader(), dec=new TextDecoder(); let buf="";
  while(true){
    const {value,done}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    const parts=buf.split("\n\n"); buf=parts.pop();
    for(const p of parts){
      const line=p.trim(); if(!line.startsWith("data:")) continue;
      let ev; try{ ev=JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
      await onEvent(ev);
    }
  }
}
