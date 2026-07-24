"use strict";

const RESOURCES = {
  explore: {
    index: (main) => new ExploreView().mount(main),
    characters: { index: (main) => new ExploreCharactersView().mount(main) },
    creators: { index: (main) => new ExploreCreatorsView().mount(main) },
    media: { index: (main) => new ExploreMediaView().mount(main) },
    forum: {
      index: (main) => new ExploreForumView().mount(main),
      show: (main, tid) => new ExploreForumThreadView(tid).mount(main),
    },
  },
  workshop: {
    index: (main) => new WorkshopView().mount(main),
    characters: {
      index: (main) => new ExploreCharactersView({ scope: "mine" }).mount(main),
      new: (main) => new WorkshopCharactersFormView(null).mount(main),
      edit: (main, cid) => new WorkshopCharactersFormView(cid).mount(main),
    },
    personas: { index: (main) => new WorkshopPersonasView().mount(main) },
    lore: { index: (main) => new WorkshopLoreView().mount(main) },
    media: { index: (main) => new WorkshopMediaView().mount(main) },
  },
  chats: {
    index: (main) => new ChatsView().mount(main),
    show: (main, sid) => new ChatView(sid).mount(main),
  },
};

function _resolveResource(tree, parts) {
  if (parts.length === 0) return tree.index ? { fn: tree.index, params: [] } : null;
  const [head, ...rest] = parts;
  if (tree[head] && typeof tree[head] === "object") return _resolveResource(tree[head], rest);
  if (rest.length === 0) {
    if (head === "new" && tree.new) return { fn: tree.new, params: [] };
    return tree.show ? { fn: tree.show, params: [head] } : null;
  }
  if (rest.length === 1 && rest[0] === "edit" && tree.edit) return { fn: tree.edit, params: [head] };
  return null;
}

function _resolveResourceRoute(root, parts) {
  const tree = RESOURCES[root];
  if (!tree) return null;
  return _resolveResource(tree, parts);
}

const routes = {
  settings: (main) => { window.settingsView = new SettingsView(); window.settingsView.mount(main); },
  "settings-appearance": (main) => { window.appearanceView = new AppearanceSettingsView(); window.appearanceView.mount(main); },
  tutorial: (main) => { window._activeTutorialView = new TutorialView(); window._activeTutorialView.mount(main); },
  "settings-model": (main) => { window.modelView = new ModelSettingsView(); window.modelView.mount(main); },
  "settings-account": (main) => { window.accountView = new AccountSettingsView(); window.accountView.mount(main); },
  multiplayer: (main) => {
    if (!ME?.experimental_features_enabled) { navigate("/settings"); return; }
    new MultiplayerView().mount(main);
  },
  "settings-blocks": (main) => { window.blockedView = new BlockedSettingsView(); window.blockedView.mount(main); },
  "settings-docs": (main) => { new DocsSettingsView().mount(main); },
  "settings-api": (main) => { new ApiExplorerView().mount(main); },
  admin: (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminOverviewView = new AdminOverviewView();
    window.adminOverviewView.mount(main);
  },
  "admin-users": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminUsersView = new AdminUsersView();
    window.adminUsersView.mount(main);
  },
  "admin-moderation": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminModerationView = new AdminModerationView();
    window.adminModerationView.mount(main);
  },
  "admin-previews": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminPreviewsView = new AdminPreviewsView();
    window.adminPreviewsView.mount(main);
  },
  "admin-train": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminTrainView = new AdminTrainView();
    window.adminTrainView.mount(main);
  },
  "admin-emojis": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminEmojisView = new AdminEmojisView();
    window.adminEmojisView.mount(main);
  },
  "admin-config": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminConfigView = new AdminConfigView();
    window.adminConfigView.mount(main);
  },
  "admin-health": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminHealthView = new AdminHealthView();
    window.adminHealthView.mount(main);
  },
  "admin-features": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminFeaturesPanel = new AdminFeaturesPanel();
    window.adminFeaturesPanel.mount(main);
  },
  "admin-announce": (main) => {
    if (!ME || (ME.role !== "admin" && ME.role !== "dev")) { navigate("/explore"); return; }
    window.adminAnnouncePanel = new AdminAnnouncePanel();
    window.adminAnnouncePanel.mount(main);
  },
  "creator-profile": (main) => new ProfileView().mount(main),
  "shared-image": async (main) => {
    const iid = location.pathname.split("/").filter(Boolean)[1];
    const view = new ExploreMediaView();
    let img;
    try {
      img = await api(`/api/imagegen/standalone/${encodeURIComponent(iid)}`);
    } catch (err) {
      main.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${err.message || "That image couldn't be found."}</p>`;
      return;
    }
    if (!ME) { view.renderStandalone(main, img); return; }
    await view.mount(main);
    openModal(view.detailHtml(img), { wide: true });
    view.wireDetailModal(img);
  },
  character: (main) => {
    const cid = location.pathname.split("/").filter(Boolean)[1];
    return new CharacterView(cid).mount(main);
  },
  "character-new-chat": (main) => {
    const cid = location.pathname.split("/").filter(Boolean)[1];
    return new ChatView(null, cid).mount(main);
  },
  group: (main) => {
    const gid = location.pathname.split("/").filter(Boolean)[1];
    return new GroupDetailView(gid).mount(main);
  },
  login: (main) => AUTH.mount(main),
  register: (main) => RegisterView.mount(main),
  onboard: (main) => OnboardView.mount(main),
  wait: (main) => waitEl(main),
};
const UNAUTHENTICATED_ROUTE_NAMES = ["login", "register", "onboard", "wait"];
const CHROMELESS_ROUTES = new Set(UNAUTHENTICATED_ROUTE_NAMES);
const PUBLIC_ROUTES = new Set([...UNAUTHENTICATED_ROUTE_NAMES, "shared-image", "character", "creator-profile", "explore/characters", "group"]);
const NAV_ROUTES = ["explore", "chats", "workshop", "dossier"];
const SUBTAB_ROUTE_KEYS = new Set(["explore/characters", "explore/creators", "explore/media", "explore/forum"]);
const SUBTAB_FOR_ROUTE = {
  "explore/characters": "explore/characters",
  "explore/creators": "explore/creators",
  "creator-profile": "explore/creators",
  "explore/media": "explore/media",
  "explore/forum": "explore/forum",
  "shared-image": "explore/media",
  character: "explore/characters",
};
const ROOT_FOR_ROUTE = {
  "explore/characters": "explore",
  "explore/creators": "explore",
  "creator-profile": "explore",
  "explore/media": "explore",
  "explore/forum": "explore",
  "shared-image": "explore",
  character: "explore",
  "character-new-chat": "chats",
  "chats/show": "chats",
  "workshop/media": "workshop",
  "workshop/lore": "workshop",
  "workshop/personas": "workshop",
  "workshop/characters": "workshop",
  settings: "dossier",
  "settings-appearance": "dossier",
  tutorial: "dossier",
  "settings-model": "dossier",
  "settings-account": "dossier",
  multiplayer: "dossier",
  "settings-blocks": "dossier",
  "settings-docs": "dossier",
  "settings-api": "dossier",
  admin: "dossier",
  "admin-users": "dossier",
  "admin-moderation": "dossier",
  "admin-previews": "dossier",
  "admin-train": "dossier",
  "admin-emojis": "dossier",
  "admin-config": "dossier",
  "admin-health": "dossier",
  "admin-features": "dossier",
  "admin-announce": "dossier",
};

const NAV_LABEL_ROUTES = {
  "Explore": "explore",
  "Workshop": "workshop",
  "Chats": "chats",
};

function pageHeaderHtml(nav, subnav, title, subtitle) {
  const navRoute = nav === "My Dossier" ? (ME?.username ? `u/${encodeURIComponent(ME.username)}` : null) : NAV_LABEL_ROUTES[nav];
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
    <div class="content-col">
    ${pageHeaderHtml(nav, subnav, title, subtitle)}
    <div class="rounded-lg border border-line bg-surface p-6">
      <p class="text-sm text-sec">This view hasn't been rebuilt yet.</p>
    </div>
    </div>
  `;
}

function _routeKeyForParts(parts) {
  if (parts[0] === "chats") return parts.length > 1 ? "chats/show" : "chats";
  if (parts.length === 1) return `${parts[0]}/index`;
  const resource = parts[1];
  const tail = parts.slice(2);
  if (tail.length === 1 && tail[0] === "new") return `${parts[0]}/${resource}/new`;
  if (tail.length === 2 && tail[1] === "edit") return `${parts[0]}/${resource}/edit`;
  return `${parts[0]}/${resource}`;
}

function currentRoute() {
  const parts = location.pathname.split("/").filter(Boolean);
  const seg = parts[0];
  if (seg === "u") return "creator-profile";
  if (seg === "i" && parts[1]) return "shared-image";
  if (seg === "c" && parts[1] && parts[2] === "new-chat") return "character-new-chat";
  if (seg === "c" && parts[1]) return "character";
  if (seg === "g" && parts[1]) return "group";
  if (routes[seg]) return seg;
  if (RESOURCES[seg]) return parts.length ? _routeKeyForParts(parts) : `${seg}/index`;
  return "explore/index";
}

function _dispatchResource(main, parts) {
  const root = parts[0];
  const resolved = _resolveResourceRoute(root, parts.slice(1));
  if (!resolved) { navigate("/explore"); return; }
  resolved.fn(main, ...resolved.params);
}

const MENU_ONLY_ROUTES = new Set(["workshop/index", "dossier"]);

function setActiveNav(routeName, tabOverride) {
  const isOwnProfile = routeName === "creator-profile"
    && decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "") === ME?.username;
  const activeTab = tabOverride || (isOwnProfile ? "dossier" : (ROOT_FOR_ROUTE[routeName] || routeName.split("/")[0]));
  const activeSubtab = SUBTAB_FOR_ROUTE[routeName] || null;
  document.querySelectorAll("[data-route]").forEach((el) => {
    const route = el.dataset.route;
    const isActive = SUBTAB_ROUTE_KEYS.has(route) ? route === activeSubtab : route === activeTab;
    el.classList.toggle("text-primary", isActive);
    el.classList.toggle("text-sec", !isActive);
  });
  document.querySelectorAll('[data-route="dossier"] [data-avatar-ring]')
    .forEach((ring) => ring.classList.toggle("opacity-100", activeTab === "dossier"));
  if (typeof setSidebarGroupOpen === "function") setSidebarGroupOpen(activeTab);
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

function setActiveTabletRail(routeName) {
  document.querySelectorAll("#tabletRail [data-route]").forEach((el) => {
    el.classList.toggle("tablet-rail-active", el.dataset.route === routeName);
  });
}

function hideChrome(main) {
  document.getElementById("sidebar")?.style.setProperty("display", "none");
  document.getElementById("mobileHeader")?.style.setProperty("display", "none");
  document.getElementById("bottomNav")?.style.setProperty("display", "none");
  document.getElementById("tabletRail")?.style.setProperty("display", "none");
  document.documentElement.classList.add("chrome-hidden");
  main.style.setProperty("position", "relative");
  main.style.setProperty("overflow", "hidden");
  main.style.setProperty("padding", "0");
  main.style.removeProperty("margin");
  main.style.setProperty("max-width", "none");
}

function restoreChrome(main) {
  document.getElementById("mobileHeader")?.style.removeProperty("display");
  document.getElementById("bottomNav")?.style.removeProperty("display");
  document.getElementById("sidebar")?.style.removeProperty("display");
  document.getElementById("tabletRail")?.style.removeProperty("display");
  document.documentElement.classList.remove("chrome-hidden");
  hideHeroChrome();
  main.style.removeProperty("position");
  main.style.removeProperty("overflow");
  main.style.removeProperty("padding");
  main.style.removeProperty("margin");
  main.style.removeProperty("max-width");
}

function hideNavOnly(main) {
  document.getElementById("sidebar")?.style.setProperty("display", "none");
  document.getElementById("mobileHeader")?.style.setProperty("display", "none");
  document.getElementById("bottomNav")?.style.setProperty("display", "none");
  document.getElementById("tabletRail")?.style.setProperty("display", "none");
  document.documentElement.classList.add("chrome-hidden");
  hideHeroChrome();
  main.style.removeProperty("position");
  main.style.removeProperty("overflow");
  main.style.setProperty("padding", "0");
  main.style.removeProperty("margin");
  main.style.setProperty("max-width", "none");
}

function hideNavKeepPadding(main) {
  document.getElementById("sidebar")?.style.setProperty("display", "none");
  document.getElementById("mobileHeader")?.style.setProperty("display", "none");
  document.getElementById("bottomNav")?.style.setProperty("display", "none");
  document.getElementById("tabletRail")?.style.setProperty("display", "none");
  document.documentElement.classList.add("chrome-hidden");
  hideHeroChrome();
  main.style.removeProperty("position");
  main.style.removeProperty("overflow");
  main.style.removeProperty("padding");
  main.style.removeProperty("margin");
  main.style.setProperty("max-width", "none");
  main.style.setProperty("padding-top", "1rem");
}

const ADMIN_ROUTES = new Set(["admin", "admin-users", "admin-moderation", "admin-previews",
  "admin-train", "admin-emojis", "admin-config", "admin-health", "admin-features", "admin-announce"]);

function _preserveScrollOnRerender(el) {
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  Object.defineProperty(el, "innerHTML", {
    configurable: true,
    get() { return desc.get.call(this); },
    set(html) {
      const top = this.scrollTop;
      desc.set.call(this, html);
      if (top) this.scrollTop = top;
    },
  });
}

let _publicFooterVersion = null;
async function ensurePublicFooterVersion() {
  const el = document.getElementById("publicFooterVersion");
  if (!el) return;
  if (_publicFooterVersion !== null) { el.textContent = _publicFooterVersion; return; }
  try {
    const res = await fetch("/version", { cache: "no-store" });
    const info = res.ok ? await res.json() : null;
    _publicFooterVersion = info?.app_version ? `v${info.app_version}` : "";
  } catch (err) {
    _publicFooterVersion = "";
    console.warn("footer version fetch failed", err);
  }
  el.textContent = _publicFooterVersion;
}

function ensurePublicHeaderContent() {
  const header = document.getElementById("publicHeader");
  if (!header || header.dataset.built) return;
  header.dataset.built = "1";
  header.innerHTML = `
    <a href="/explore" onclick="event.preventDefault();navigate('/explore')" class="flex items-center gap-2 text-primary" style="min-width:0">
      <svg viewBox="0 0 500 500" class="h-7 w-7 shrink-0"><g>${SH_LOGO_PATHS}</g></svg>
      <span class="flex flex-col leading-tight" style="min-width:0">
        <span class="font-display text-sm font-semibold tracking-wide truncate">StoryHaven AI</span>
        <span class="text-[10px] italic text-muted truncate">${t("pantheon_tagline")}</span>
      </span>
    </a>
    <div class="flex items-center gap-2" style="flex:none">
      <button type="button" onclick="setThemeBase(getThemeState().activeBase === 'dark' ? 'light' : 'dark')" aria-label="${_attr(t("nav_toggle_theme"))}" data-tooltip="${_attr(t("nav_toggle_theme"))}" class="theme-toggle-btn" style="width:38px;height:38px;border-radius:9px;display:grid;place-items:center;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);cursor:pointer">
        <svg class="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>
        <svg class="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>
      </button>
      <a href="/login" onclick="event.preventDefault();navigate('/login')" aria-label="${_attr(t("pantheon_sign_in_register"))}" class="pe-gen-btn" style="text-decoration:none;white-space:nowrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
        <span class="hidden md:inline">${t("pantheon_sign_in_register")}</span>
      </a>
    </div>`;
}

function updatePublicChrome(routeName, main) {
  const show = !ME && !CHROMELESS_ROUTES.has(routeName);
  const footer = document.getElementById("publicFooter");
  const header = document.getElementById("publicHeader");
  if (footer) { footer.classList.toggle("hidden", !show); if (show) ensurePublicFooterVersion(); }
  if (header) { header.classList.toggle("hidden", !show); if (show) ensurePublicHeaderContent(); }
  document.documentElement.classList.toggle("pub-chrome", show);
  if (show && main) main.style.setProperty("padding-top", "56px");
}

function route() {
  if (location.pathname.split("/").filter(Boolean)[0] === "dossier") {
    history.replaceState(null, "", ME?.username ? `/u/${encodeURIComponent(ME.username)}` : "/explore");
    return route();
  }
  let routeName = currentRoute();
  if (!ME && routeName === "explore/index") {
    history.replaceState(null, "", "/explore/characters");
    return route();
  }
  if (!ME && !PUBLIC_ROUTES.has(routeName)) {
    history.replaceState(null, "", "/login");
    return route();
  }
  if (ME && routeName === "login") {
    history.replaceState(null, "", "/");
    return route();
  }
  if (ADMIN_ROUTES.has(routeName) && (!ME || (ME.role !== "admin" && ME.role !== "dev"))) {
    history.replaceState(null, "", "/explore");
    routeName = "explore/index";
  }
  if (routeName === "workshop/media" && typeof mediaGen !== "undefined" && !mediaGen.available) {
    mediaGen.showUnavailable();
    return;
  }
  if (typeof window !== "undefined" && window.ttsPlayer) window.ttsPlayer.stop();
  const oldMain = document.getElementById("main");
  const main = oldMain.cloneNode(false);
  main.removeAttribute("style");
  oldMain.replaceWith(main);
  _preserveScrollOnRerender(main);
  if (CHROMELESS_ROUTES.has(routeName)) hideChrome(main);
  else if ((!ME && routeName === "shared-image") || routeName === "chats/show" || routeName === "character-new-chat") hideNavOnly(main);
  else if (!ME && (routeName === "creator-profile" || routeName === "explore/characters" || routeName === "character" || routeName === "group")) hideNavKeepPadding(main);
  else restoreChrome(main);
  const parts = location.pathname.split("/").filter(Boolean);
  if (routes[routeName]) routes[routeName](main);
  else _dispatchResource(main, parts.length ? parts : ["explore"]);
  setActiveNav(routeName);
  setActiveTabletRail(routeName);
  updatePublicChrome(routeName, main);
  if (typeof mediaGen !== "undefined" && ME) mediaGen.start();
  applyAvatarRing();
  applyCensorToggleVisibility();
  applyNotifBellVisibility();
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
