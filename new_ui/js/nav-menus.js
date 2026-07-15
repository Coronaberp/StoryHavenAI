"use strict";

const _NAV_MENU_ICONS = {
  pantheon: '<circle cx="12" cy="8.5" r="3.3"/><path d="M6 19c.8-3.6 3-5.3 6-5.3s5.2 1.7 6 5.3"/>',
  artisans: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5A2.5 2.5 0 0 1 16 14h2a3 3 0 0 0 3-3c0-4.4-4-8-9-8z"/><circle cx="8" cy="11" r="1"/><circle cx="8" cy="15" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/>',
  pinacotheca: '<rect x="4" y="5" width="16" height="13" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4 15.5l4.5-4.5c.6-.6 1.4-.6 2 0L17 17.5"/>',
  symposium: '<path d="M5 6h14v9H9l-4 3.5V15H5z"/>',
  forge: '<path d="M6 18l7-7"/><path d="M14.5 4.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M17.5 12.5l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7z"/>',
  grimoire: '<path d="M6 5.5c2-1 4-1.3 6 0v13c-2-1.3-4-1-6 0z"/><path d="M18 5.5c-2-1-4-1.3-6 0v13c2-1.3 4-1 6 0z"/>',
  masks: '<circle cx="9.5" cy="10" r="4.2"/><path d="M12.8 8.2A4.2 4.2 0 1 1 12.8 15.8"/>',
  casts: '<circle cx="9" cy="8.5" r="2.6"/><path d="M4.5 18c.6-3 2.2-4.6 4.5-4.6s3.9 1.6 4.5 4.6"/><circle cx="16" cy="9.5" r="2.1"/><path d="M14.3 13.2c1.8.2 3 1.5 3.4 3.5"/>',
};

function _navMenuRow(route, title, subtitle) {
  const icon = _NAV_MENU_ICONS[route] || "";
  return `
    <button type="button" class="dropdown-item" style="display:flex;align-items:center;gap:12px;padding:11px 8px"
      onclick="closeTopModal(); navigate('/${route}')">
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
    <h3 style="cursor:pointer" onclick="closeTopModal();navigate('/explore')">Compendium</h3>
    <p style="margin:-6px 0 12px;font-style:italic">Everything worth discovering, catalogued.</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("pantheon", "Pantheon", "Characters")}
      ${_navMenuRow("artisans", "Artisans", "Creators")}
      ${_navMenuRow("pinacotheca", "Pinacotheca", "Media")}
      ${_navMenuRow("symposium", "Symposium", "Forums")}
    </div>
  `);
}

function openSanctumMenu() {
  openModal(`
    <h3>Sanctum</h3>
    <p style="margin:-6px 0 12px;font-style:italic">Your workshop — everything you've made or are making.</p>
    <div style="display:flex;flex-direction:column;gap:3px">
      ${_navMenuRow("forge", "My Forge", "Generate media")}
      ${_navMenuRow("grimoire", "My Grimoire", "Lore")}
      ${_navMenuRow("masks", "My Masks", "Personas")}
      ${_navMenuRow("casts", "My Casts", "Characters")}
    </div>
  `);
}

if (typeof window !== "undefined") {
  window.openCompendiumMenu = openCompendiumMenu;
  window.openSanctumMenu = openSanctumMenu;
}
