"use strict";

const routes = {
  compendium: (main) => new CompendiumView().mount(main),
  parlance: (main) => renderPlaceholder(main, "Parlance", "Overview", "Parlance",
    "Every conversation you're having, gathered in one place."),
  sanctum: (main) => renderPlaceholder(main, "Sanctum", "Overview", "Sanctum",
    "Your workshop with everything you've made, or are making."),
  dossier: (main) => renderPlaceholder(main, "My Dossier", "Overview", "My Dossier",
    "Your profile, your record, your entry in the archive."),
  create: (main) => renderPlaceholder(main, "Sanctum", "New Character", "New Character",
    "Bind a new character into being."),
  pantheon: (main) => new PantheonView().mount(main),
  artisans: (main) => new ArtisansView().mount(main),
  "artisan-profile": (main) => new ArtisanProfileView().mount(main),
  pinacotheca: (main) => renderPlaceholder(main, "Compendium", "Media", "Pinacotheca",
    "Every image and video the community has shared."),
  symposium: (main) => renderPlaceholder(main, "Compendium", "Forums", "Symposium",
    "Where the community gathers to talk."),
  forge: (main) => renderPlaceholder(main, "Sanctum", "Generate media", "My Forge",
    "Conjure new images and video from nothing but a prompt or your own existing images."),
  grimoire: (main) => renderPlaceholder(main, "Sanctum", "Lore", "My Grimoire",
    "The lore entries that shape your worlds."),
  masks: (main) => renderPlaceholder(main, "Sanctum", "Personas", "My Masks",
    "The faces you wear when you step into a story."),
  casts: (main) => renderPlaceholder(main, "Sanctum", "Characters", "My Casts",
    "Characters you've created or imported, private to you."),
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const UNAUTHENTICATED_ROUTE_NAMES = ["login", "register", "onboard", "wait"];
const CHROMELESS_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const PUBLIC_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const NAV_ROUTES = ["compendium", "parlance", "sanctum", "dossier"];
const TAB_FOR_ROUTE = {
  pantheon: "compendium",
  artisans: "compendium",
  "artisan-profile": "compendium",
  pinacotheca: "compendium",
  symposium: "compendium",
  forge: "sanctum",
  grimoire: "sanctum",
  masks: "sanctum",
  casts: "sanctum",
};

const NAV_LABEL_ROUTES = {
  "Compendium": "compendium",
  "Sanctum": "sanctum",
  "Parlance": "parlance",
  "My Dossier": "dossier",
};

function pageHeaderHtml(nav, subnav, title, subtitle) {
  const navRoute = NAV_LABEL_ROUTES[nav];
  const navHtml = navRoute
    ? `<span style="cursor:pointer" onclick="navigate('/${navRoute}')">${nav}</span>`
    : nav;
  return `
    <div class="mb-3">
      <div class="font-mono text-[10px] tracking-[.14em] uppercase mb-1" style="color:var(--color-accent)">${navHtml} · ${subnav}</div>
      <h1 class="font-display text-2xl font-bold text-ink">${title}</h1>
      ${subtitle ? `<h2 class="text-sm font-normal mt-1" style="color:var(--color-sec)">${subtitle}</h2>` : ""}
    </div>
  `;
}

function renderPlaceholder(main, nav, subnav, title, subtitle) {
  main.innerHTML = `
    ${pageHeaderHtml(nav, subnav, title, subtitle)}
    <div class="rounded-lg border border-line bg-surface p-6">
      <p class="text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
  `;
}

function currentRoute() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  if (seg === "u") return "artisan-profile";
  return seg && routes[seg] ? seg : "compendium";
}

const MENU_ONLY_ROUTES = new Set(["compendium", "sanctum"]);

function setActiveNav(routeName) {
  const activeTab = TAB_FOR_ROUTE[routeName] || routeName;
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === activeTab);
    el.classList.toggle("text-sec", el.dataset.route !== activeTab);
  });
  document.querySelector('[data-route="dossier"] [data-avatar-ring]')
    ?.classList.toggle("opacity-100", activeTab === "dossier");
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
