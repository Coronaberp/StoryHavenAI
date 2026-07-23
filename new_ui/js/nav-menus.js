"use strict";

const _NAV_MENU_ICONS = {
  characters: '<circle cx="12" cy="8.5" r="3.3"/><path d="M6 19c.8-3.6 3-5.3 6-5.3s5.2 1.7 6 5.3"/>',
  creators: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5A2.5 2.5 0 0 1 16 14h2a3 3 0 0 0 3-3c0-4.4-4-8-9-8z"/><circle cx="8" cy="11" r="1"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/>',
  media: '<rect x="4" y="5" width="16" height="13" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4 15.5l4.5-4.5c.6-.6 1.4-.6 2 0L17 17.5"/>',
  forum: '<path d="M5 6h14v9H9l-4 3.5V15H5z"/>',
  generate: '<path d="M6 18l7-7"/><path d="M14.5 4.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M17.5 12.5l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7z"/>',
  lorebook: '<path d="M6 5.5c2-1 4-1.3 6 0v13c-2-1.3-4-1-6 0z"/><path d="M18 5.5c-2-1-4-1.3-6 0v13c2-1.3 4-1 6 0z"/>',
  personas: '<circle cx="9.5" cy="10" r="4.2"/><path d="M12.8 8.2A4.2 4.2 0 1 1 12.8 15.8"/>',
  mycharacters: '<circle cx="9" cy="8.5" r="2.6"/><path d="M4.5 18c.6-3 2.2-4.6 4.5-4.6s3.9 1.6 4.5 4.6"/><circle cx="16" cy="9.5" r="2.1"/><path d="M14.3 13.2c1.8.2 3 1.5 3.4 3.5"/>',
  profile: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1-4.5 3.5-6.5 7-6.5s6 2 7 6.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  tutorial: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 1.8-2.3 3.5"/><circle cx="12" cy="16.7" r=".3" fill="currentColor"/>',
  signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
};

function _navMenuRow(route, title, subtitle, onclickOverride) {
  const icon = _NAV_MENU_ICONS[route] || "";
  const onclick = onclickOverride || `navigate('/${route}')`;
  const mediaGenAttr = route === "generate" ? " data-media-gen" : "";
  return `
    <button type="button" class="dropdown-item"${mediaGenAttr} style="display:flex;align-items:center;gap:12px;padding:11px 8px"
      onclick="closeTopModal(); setTimeout(() => { ${onclick} }, 0)">
      <span style="flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--color-paper-base);background:linear-gradient(150deg, var(--color-accent), var(--color-accent-deep))">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </span>
      <span style="display:flex;flex-direction:column;align-items:flex-start;gap:1px">
        <span class="font-display" style="font-weight:600;font-size:14px;color:var(--color-ink)">${title}</span>
        <span style="color:var(--color-muted);font-size:11.5px">${subtitle}</span>
      </span>
    </button>
  `;
}

function openCompendiumMenu() {
  openModal(`
    <h3 style="cursor:pointer" onclick="closeTopModal();navigate('/explore')">${t("nav_menu_explore")}</h3>
    <p style="margin:-6px 0 12px;font-style:italic">${t("nav_menu_explore_subtitle")}</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("characters", t("nav_menu_characters"), t("nav_menu_browse_all_characters"), `navigate('/explore/characters')`)}
      ${_navMenuRow("creators", t("nav_menu_creators"), t("nav_menu_browse_creators"), `navigate('/explore/creators')`)}
      ${_navMenuRow("media", t("nav_menu_media_gallery"), t("nav_menu_images_and_video"), `navigate('/explore/media')`)}
      ${_navMenuRow("forum", t("nav_menu_forum"), t("nav_menu_community_discussion"), `navigate('/explore/forum')`)}
    </div>
  `);
}

function openSanctumMenu() {
  openModal(`
    <h3 style="cursor:pointer" onclick="closeTopModal();navigate('/workshop')">${t("nav_menu_workshop")}</h3>
    <p style="margin:-6px 0 12px;font-style:italic">${t("nav_menu_workshop_subtitle")}</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("generate", t("nav_menu_generate"), t("nav_menu_generate_media"), `navigate('/workshop/media')`)}
      ${_navMenuRow("lorebook", t("nav_menu_lorebook"), t("nav_menu_lore"), `navigate('/workshop/lore')`)}
      ${_navMenuRow("personas", t("nav_menu_personas"), t("nav_menu_personas"), `navigate('/workshop/personas')`)}
      ${_navMenuRow("mycharacters", t("nav_menu_my_characters"), t("nav_menu_characters"), `navigate('/workshop/characters')`)}
    </div>
  `);
}

function openCreateMenu() {
  const isGuest = ME?.tier === "guest";
  openModal(`
    <h3>${t("nav_menu_create")}</h3>
    <p style="margin:-6px 0 12px;font-style:italic">${t("nav_menu_create_subtitle")}</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${isGuest ? "" : _navMenuRow("mycharacters", t("nav_menu_new_character"), t("nav_menu_new_character_sub"), `navigate('/workshop/characters/new')`)}
      ${isGuest ? "" : _navMenuRow("lorebook", t("nav_menu_new_lore"), t("nav_menu_new_lore_sub"), `sessionStorage.setItem('openGrimoireAdd', '1'); navigate('/workshop/lore')`)}
      ${_navMenuRow("generate", t("nav_menu_new_media"), t("nav_menu_new_media_sub"), `navigate('/workshop/media')`)}
    </div>
    ${isGuest ? `<p style="margin:10px 0 0;font-size:12px;color:var(--color-muted)">${t("nav_menu_guest_note", "Guest accounts play existing characters - creating your own comes with a full account.")}</p>` : ""}
  `);
}

function openDossierMenu() {
  const isDesktopSidebar = window.matchMedia("(min-width: 1024px)").matches;
  openModal(`
    <h3>${t("nav_menu_my_dossier")}</h3>
    <p style="margin:-6px 0 12px;font-style:italic">${t("nav_menu_my_dossier_subtitle")}</p>
    ${guestQuotaBoxHtml()}
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("profile", t("nav_menu_dossier"), t("nav_menu_my_page"), `navigate('/u/${encodeURIComponent(ME?.username || "")}')`)}
      ${_navMenuRow("settings", t("nav_menu_settings"), t("nav_menu_account_and_preferences"), `navigate('/settings')`)}
      ${_navMenuRow("tutorial", t("nav_menu_tutorial"), t("nav_menu_how_to_use_everything"), `navigate('/tutorial')`)}
      ${isDesktopSidebar ? "" : _navMenuRow("signout", t("nav_menu_sign_out"), t("nav_menu_end_this_session"), `confirmSignOut()`)}
    </div>
  `);
  refreshGuestQuotaBoxes();
}

function setSidebarGroupOpen(name) {
  document.querySelectorAll("#sidebar [data-sidebar-group]").forEach((group) => {
    const isTarget = group.dataset.sidebarGroup === name;
    group.classList.toggle("sidebar-group-open", isTarget);
  });
}

if (typeof window !== "undefined") {
  window.openCompendiumMenu = openCompendiumMenu;
  window.openSanctumMenu = openSanctumMenu;
  window.openDossierMenu = openDossierMenu;
  window.setSidebarGroupOpen = setSidebarGroupOpen;
}
