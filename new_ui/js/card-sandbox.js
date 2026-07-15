"use strict";

const ALLOWED_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "fonts.bunny.net",
  "use.typekit.net", "p.typekit.net", "api.fontshare.com", "cdn.fontshare.com"];

function isAllowedFontHost(v) {
  try {
    const u = new URL(String(v || "").trim().replace(/^\/\//, "https://"), location.origin);
    return ALLOWED_FONT_HOSTS.includes(u.hostname);
  } catch { return false; }
}

function sanitizeCardCSS(css) {
  let out = String(css || "").replace(/@import\s+(?:url\(\s*(['"]?)([^)'"]*)\1\s*\)|(['"])([^'"]*)\3)[^;]*;?/gi, (m, _q1, urlTarget, _q2, strTarget) => {
    const target = urlTarget || strTarget || "";
    return (target && isAllowedFontHost(target)) ? m : "";
  });
  out = out.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, _q, u) => {
    const v = u.trim();
    if (/^data:/i.test(v)) return m;
    if (isAllowedFontHost(v)) return m;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//")) return "none";
    if (v.includes("\\")) return "none";
    return m;
  });
  return out;
}

function mountSandboxedHTML(container, html, { autoHeight = true, onReady } = {}) {
  const ifr = document.createElement("iframe");
  ifr.sandbox = "allow-same-origin";
  ifr.style.cssText = "width:100%;border:0;display:block;background:#000;" + (autoHeight ? "" : "height:100%;");
  const styles = [];
  const markup = (html || "").replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, css) => { styles.push(sanitizeCardCSS(css)); return ""; });
  const stripOffOriginResource = (node) => {
    const attrs = node.tagName === "A" ? ["src", "poster", "xlink:href"] : ["src", "poster", "href", "xlink:href"];
    for (const attr of attrs) {
      const v = node.getAttribute && node.getAttribute(attr);
      if (!v || !/^(https?:)?\/\//i.test(v.trim())) continue;
      if (isAllowedFontHost(v)) continue;
      try {
        if (new URL(v, location.origin).origin === location.origin) continue;
      } catch {}
      node.removeAttribute(attr);
    }
  };
  DOMPurify.addHook("afterSanitizeAttributes", stripOffOriginResource);
  const cleanBody = DOMPurify.sanitize(markup, {});
  DOMPurify.removeHook("afterSanitizeAttributes", stripOffOriginResource);
  const scrollbarCss = "html,body{margin:0;background:#000;scrollbar-color:#555 transparent;scrollbar-width:thin;}" +
    "::-webkit-scrollbar{width:10px;height:10px;}::-webkit-scrollbar-track{background:transparent;}" +
    "::-webkit-scrollbar-thumb{background:#555;border-radius:8px;border:2px solid #000;}" +
    "::-webkit-scrollbar-thumb:hover{background:#888;}";
  const censorCss = 'html[data-censor="1"] [data-explicit="1"]{filter:blur(20px) saturate(45%) !important;}';
  const initialCensor = document.documentElement.dataset.censor === "1" ? "1" : "0";
  ifr.srcdoc = `<!doctype html><html data-censor="${initialCensor}"><head><style>${scrollbarCss}\n${censorCss}\n${styles.join("\n")}</style></head><body>${cleanBody}</body></html>`;
  ifr.classList.add("sandboxed-card-frame");
  ifr.onload = () => {
    try {
      if (autoHeight) ifr.style.height = ifr.contentDocument.body.scrollHeight + "px";
      wireCardInternalLinks(ifr.contentDocument);
      onReady && onReady(ifr.contentDocument);
    } catch {}
  };
  container.innerHTML = "";
  container.appendChild(ifr);
  return ifr;
}

function wireCardInternalLinks(doc) {
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const isSpaRoute = href.startsWith("/") && !href.startsWith("/api/") && !href.startsWith("/media/");
    a.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (isSpaRoute && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { navigate(href); return; }
      window.open(href, "_blank", "noopener,noreferrer");
    });
  });
}
