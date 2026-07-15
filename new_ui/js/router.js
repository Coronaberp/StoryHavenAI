"use strict";

const routes = {
  library: (main) => renderPlaceholder(main, "Library"),
  community: (main) => renderPlaceholder(main, "Community"),
  personas: (main) => renderPlaceholder(main, "Personas"),
  images: (main) => renderPlaceholder(main, "Creations"),
  forum: (main) => renderPlaceholder(main, "Forum"),
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const CHROMELESS_ROUTES = new Set(["login", "register", "onboard", "wait"]);

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
  return seg && routes[seg] ? seg : "library";
}

function setActiveNav(routeName) {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === routeName);
    el.classList.toggle("text-sec", el.dataset.route !== routeName);
  });
}

function hideChrome(main) {
  document.getElementById("sidebar")?.style.setProperty("display", "none");
  document.getElementById("mobileHeader")?.style.setProperty("display", "none");
  document.getElementById("bottomNav")?.style.setProperty("display", "none");
  main.classList.add("!p-0", "relative", "overflow-hidden", "-m-4", "md:-m-0");
}

function restoreChrome(main) {
  document.getElementById("sidebar")?.style.removeProperty("display");
  document.getElementById("mobileHeader")?.style.removeProperty("display");
  document.getElementById("bottomNav")?.style.removeProperty("display");
  main.classList.remove("!p-0", "relative", "overflow-hidden", "-m-4", "md:-m-0");
}

function route() {
  const main = document.getElementById("main");
  const routeName = currentRoute();
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else restoreChrome(main);
  routes[routeName](main);
  setActiveNav(routeName);
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
