"use strict";

const routes = {
  explore: (main) => renderPlaceholder(main, "Compendium", "Browse"),
  chats: (main) => renderPlaceholder(main, "Parlance", "Conversations"),
  studio: (main) => renderPlaceholder(main, "Sanctum", "Workshop"),
  account: (main) => renderPlaceholder(main, "My Dossier", "You"),
  create: (main) => renderPlaceholder(main, "New Character", "Sanctum"),
  pantheon: (main) => new PantheonView().mount(main),
  pinacotheca: (main) => renderPlaceholder(main, "Pinacotheca", "Compendium · Media"),
  symposium: (main) => renderPlaceholder(main, "Symposium", "Compendium · Forums"),
  forge: (main) => renderPlaceholder(main, "My Forge", "Sanctum · Generate media"),
  grimoire: (main) => renderPlaceholder(main, "My Grimoire", "Sanctum · Lore"),
  masks: (main) => renderPlaceholder(main, "My Masks", "Sanctum · Personas"),
  casts: (main) => renderPlaceholder(main, "My Casts", "Sanctum · Characters"),
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const UNAUTHENTICATED_ROUTE_NAMES = ["login", "register", "onboard", "wait"];
const CHROMELESS_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const PUBLIC_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const NAV_ROUTES = ["explore", "chats", "studio", "account"];
const TAB_FOR_ROUTE = {
  pantheon: "explore",
  pinacotheca: "explore",
  symposium: "explore",
  forge: "studio",
  grimoire: "studio",
  masks: "studio",
  casts: "studio",
};

function renderPlaceholder(main, label, eyebrow) {
  main.innerHTML = `
    <div class="mb-3">
      ${eyebrow ? `<div class="font-mono text-[10px] tracking-[.14em] uppercase mb-1" style="color:var(--color-accent)">${eyebrow}</div>` : ""}
      <h1 class="font-display text-2xl font-bold text-ink">${label}</h1>
    </div>
    <div class="rounded-lg border border-line bg-surface p-6">
      <p class="text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
  `;
}

function currentRoute() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return seg && routes[seg] ? seg : "explore";
}

const MENU_ONLY_ROUTES = new Set(["explore", "studio"]);

function setActiveNav(routeName) {
  const activeTab = TAB_FOR_ROUTE[routeName] || routeName;
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === activeTab);
    el.classList.toggle("text-sec", el.dataset.route !== activeTab);
  });
  document.querySelector('[data-route="account"] [data-avatar-ring]')
    ?.classList.toggle("opacity-100", activeTab === "account");
  const ribbon = document.getElementById("navRibbon");
  const nav = document.getElementById("bottomNav");
  if (!ribbon || !nav) return;
  const idx = NAV_ROUTES.indexOf(activeTab);
  const showRibbon = idx !== -1 && !MENU_ONLY_ROUTES.has(routeName);
  ribbon.classList.toggle("hidden", !showRibbon);
  if (!showRibbon) return;
  const target = nav.querySelector(`[data-route="${activeTab}"]`);
  if (!target) return;
  const navRect = nav.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  ribbon.style.left = `${targetRect.left - navRect.left}px`;
  ribbon.style.width = `${targetRect.width}px`;
}

function hideChrome(main) {
  document.getElementById("sidebar")?.style.setProperty("display", "none");
  document.getElementById("mobileHeader")?.style.setProperty("display", "none");
  document.getElementById("bottomNav")?.style.setProperty("display", "none");
  main.style.setProperty("position", "relative");
  main.style.setProperty("overflow", "hidden");
  main.style.setProperty("padding", "0");
  main.style.setProperty("margin", "0");
}

function restoreChrome(main) {
  document.getElementById("mobileHeader")?.style.removeProperty("display");
  document.getElementById("bottomNav")?.style.removeProperty("display");
  hideHeroChrome();
  main.style.removeProperty("position");
  main.style.removeProperty("overflow");
  main.style.removeProperty("padding");
  main.style.removeProperty("margin");
}

function route() {
  const main = document.getElementById("main");
  const routeName = currentRoute();
  if (!ME && !PUBLIC_ROUTES.has(routeName)) {
    history.replaceState(null, "", "/login");
    return route();
  }
  if (ME && routeName === "login") {
    history.replaceState(null, "", "/");
    return route();
  }
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else restoreChrome(main);
  routes[routeName](main);
  setActiveNav(routeName);
  applyAvatarRing();
}

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-route]");
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", route);
