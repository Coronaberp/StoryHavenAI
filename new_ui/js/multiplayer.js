"use strict";

class MultiplayerView {
  async mount(main) {
    this.main = main;
    this.render();
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml(t("multiplayer_back_link_settings", "Settings"))}
      ${pageHeaderHtml(t("nav_settings"), t("multiplayer_page_title", "Multiplayer"), t("multiplayer_page_title", "Multiplayer"), t("multiplayer_page_subheading", "Share an RPG chat with up to 8 people. No fixed turn order — whoever acts first, acts. Nobody's action gets lost, the story just waits for one reply at a time."))}
      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="padding:16px;border-radius:14px;border:1px solid var(--color-line);background:var(--color-surface)">
          <div class="font-display" style="font-weight:600;font-size:15px;color:var(--color-ink);margin-bottom:6px">${t("multiplayer_how_title", "How to start one")}</div>
          <p style="font-size:13px;line-height:1.6;color:var(--color-sec);margin:0">${t("multiplayer_how_body", "Open any chat with an RPG-mode character, then use its menu to generate an invite link or invite someone by username. Only RPG-mode characters support multiplayer, since a third-person narrator can address a whole party the way a first-person character can't.")}</p>
        </div>
        <div style="padding:16px;border-radius:14px;border:1px solid var(--color-line);background:var(--color-surface)">
          <div class="font-display" style="font-weight:600;font-size:15px;color:var(--color-ink);margin-bottom:6px">${t("multiplayer_rules_title", "How turns work")}</div>
          <p style="font-size:13px;line-height:1.6;color:var(--color-sec);margin:0">${t("multiplayer_rules_body", "Anyone can act at any time. The moment someone does, the composer locks for the whole party until the reply lands, then it opens back up to whoever acts first next. There's a separate party chat for coordinating out loud without it ever touching the story.")}</p>
        </div>
      </div>
      </div>
    `;
  }
}

if (typeof window !== "undefined") {
  window.MultiplayerView = MultiplayerView;
}
