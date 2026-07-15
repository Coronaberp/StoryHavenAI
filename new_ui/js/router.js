"use strict";

const routes = {
  explore: (main) => renderPlaceholder(main, "Explore"),
  chats: (main) => renderPlaceholder(main, "Chats"),
  studio: (main) => renderPlaceholder(main, "Studio"),
  account: (main) => renderPlaceholder(main, "Account"),
  create: (main) => renderPlaceholder(main, "New Character"),
  community: (main) => renderPlaceholder(main, "Community"),
  personas: (main) => renderPlaceholder(main, "Personas"),
  forum: (main) => renderPlaceholder(main, "Forum"),
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const UNAUTHENTICATED_ROUTE_NAMES = ["login", "register", "onboard", "wait"];
const CHROMELESS_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const PUBLIC_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const NAV_ROUTES = ["explore", "chats", "studio", "account"];

function renderPlaceholder(main, label) {
  main.innerHTML = `
    <div class="rounded-lg border border-line bg-surface p-6">
      <h1 class="font-display text-xl font-semibold text-ink">${label}</h1>
      <p class="mt-2 text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
  `;
}

function currentRoute() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return seg && routes[seg] ? seg : "explore";
}

function setActiveNav(routeName) {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === routeName);
    el.classList.toggle("text-sec", el.dataset.route !== routeName);
  });
  document.querySelector('[data-route="account"] [data-avatar-ring]')
    ?.classList.toggle("opacity-100", routeName === "account");
  const ribbon = document.getElementById("navRibbon");
  const nav = document.getElementById("bottomNav");
  if (!ribbon || !nav) return;
  const idx = NAV_ROUTES.indexOf(routeName);
  ribbon.classList.toggle("hidden", idx === -1);
  if (idx === -1) return;
  const target = nav.querySelector(`[data-route="${routeName}"]`);
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
