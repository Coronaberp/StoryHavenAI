"use strict";

const SCROLL_TOP_THRESHOLD = 400;

function initScrollTopButton() {
  const btn = document.createElement("button");
  btn.id = "scrollTopBtn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Scroll to top");
  btn.className = "scroll-top-btn md:hidden";
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5"/>
      <path d="M6 11l6-6 6 6"/>
    </svg>
  `;
  document.body.appendChild(btn);

  btn.onclick = () => {
    const main = document.getElementById("main");
    if (!main) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    main.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  window.addEventListener("scroll", (e) => {
    const main = document.getElementById("main");
    if (!main || e.target !== main) return;
    btn.classList.toggle("scroll-top-btn-visible", main.scrollTop > SCROLL_TOP_THRESHOLD);
  }, true);
}

initScrollTopButton();
