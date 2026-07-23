"use strict";

const _CARD_COMMENTS_CSS = `.gl-comments{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;font-size:13px;cursor:pointer;border:1px solid rgba(255,255,255,.15);font-family:inherit;}
.gl-comments:hover{background:rgba(255,255,255,.15);}`;

function _substituteCharacterTemplate(html, cid) {
  const map = {
    "{{comments}}": `<button class="gl-comments" type="button" data-comments="1">\u{1F4AC} Comments</button>`,
  };
  const out = (html || "").replace(/\{\{[a-z_]+\}\}/g, (m) => (map[m] !== undefined ? map[m] : m));
  return `<style>${_CARD_COMMENTS_CSS}</style>${out}`;
}

function _substMacros(text, charName, userName) {
  return (text || "").replace(/\{\{char\}\}/gi, charName).replace(/\{\{user\}\}/gi, userName);
}

class CharacterView {
  constructor(cid) {
    this.cid = cid;
    this.char = null;
    this.lore = [];
    this.creatorProfile = null;
    this.error = "";
    this.revealed = false;
    this.presentationOpen = false;
    this.lorePage = 0;
    this.loreCategory = "__all";
    this.loreCategoryMenuOpen = false;
    this.loreViewMode = "list";
    this.exportMenuOpen = false;
  }

  async downloadCard(spec) {
    try {
      const res = await fetch(`/api/characters/${encodeURIComponent(this.char.id)}/export?spec=${spec}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || t("char_export_failed"));
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${this.char.name || "character"}.${spec}.card.json`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      toast(err.message || t("char_couldnt_export_that_card"));
    }
  }

  async deleteCharacter() {
    if (!(await confirmDialog(`${t("char_delete_confirm_prefix")} "${this.char.name}"${t("char_delete_confirm_suffix")}`))) return;
    try {
      await api(`/api/characters/${encodeURIComponent(this.char.id)}`, { method: "DELETE" });
      toast(t("char_deleted"));
      navigate("/workshop/characters");
    } catch (err) {
      toast(err.message || t("char_couldnt_delete_that_character"));
    }
  }

  async mount(main) {
    this.main = main;
    this.render();
    try {
      this.char = await api(`/api/characters/${encodeURIComponent(this.cid)}`);
    } catch (err) {
      this.error = err.message || t("char_character_not_found");
      this.render();
      return;
    }
    this.render();
    if (ME && this.char.owner_id === ME.id) setActiveNav("character", "workshop");
    this.loadExtras();
  }

  async loadExtras() {
    const [lore, profile, featuringGroups] = await Promise.all([
      api(`/api/characters/${encodeURIComponent(this.cid)}/lore`).catch(() => []),
      this.char.owner_username
        ? api(`/api/users/${encodeURIComponent(this.char.owner_username)}`).catch(() => null)
        : Promise.resolve(null),
      api(`/api/characters/${encodeURIComponent(this.cid)}/groups`).catch(() => []),
    ]);
    this.lore = lore;
    this.creatorProfile = profile;
    this.featuringGroups = featuringGroups;
    this.render();
  }

  statPill(value, label) {
    return `<span class="char-stat-pill"><b>${value}</b>${label}</span>`;
  }

  _creatorRingGradient() {
    return this.creatorProfile?.accent_color
      ? `linear-gradient(135deg, ${this.creatorProfile.accent_color}, ${this.creatorProfile.banner_color || this.creatorProfile.accent_color})`
      : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
  }

  async _defaultPersonaName() {
    if (!ME) return t("char_you_fallback_name");
    try {
      const personas = await api("/api/personas");
      const def = personas.find((p) => p.is_default);
      return def?.name || t("char_you_fallback_name");
    } catch {
      return t("char_you_fallback_name");
    }
  }

  async startMultiplayer() {
    let session;
    try {
      session = await api(`/api/characters/${encodeURIComponent(this.char.id)}/sessions`, { method: "POST", body: JSON.stringify({}) });
    } catch (e) {
      errorToast(e.message || t("chat_multiplayer_start_failed", "Couldn't start that session."));
      return;
    }
    navigate(`/chats/${encodeURIComponent(session.id)}`);
    setTimeout(() => { window._activeChatView?.openInviteModal?.(); }, 300);
  }

  async openStartChatModal() {
    const c = this.char;
    const assets = c.assets || {};
    const spriteUrl = pickStageAsset(assets.sprites, null);
    const stageBgUrl = pickStageAsset(assets.stage, null);
    const hasStage = !!(stageBgUrl || spriteUrl);
    const fallbackBg = !hasStage && ME?.chat_background_img ? ME.chat_background_img : null;
    const greetings = [c.greeting, ...(c.alt_greetings || [])].filter((g) => (g || "").trim());
    let idx = 0;
    const userName = await this._defaultPersonaName();
    const pfpHtml = spriteUrl
      ? `<div class="chat-pfp chat-pfp-char" style="background-image:url('${_esc(spriteUrl)}')"></div>`
      : c.avatar
        ? `<div class="chat-pfp chat-pfp-char" style="background-image:url('${_esc(c.avatar)}')"></div>`
        : `<div class="chat-pfp chat-pfp-char chat-pfp-fallback">${_esc(c.name?.[0]?.toUpperCase() || "?")}</div>`;
    const bubble = (g, i) => `
      <div class="chat-turn ai">
        <div class="chat-turn-body">
          <div class="chat-msg-row">
            ${pfpHtml}
            <div class="chat-bubble">
              <div class="sym-body">${chatMd(_substMacros(g, c.name, userName))}</div>
            </div>
          </div>
          <div class="chat-name-label">
            ${_esc(c.name)}${greetings.length > 1 ? ` · ${t("char_variant_label")} ${i + 1}/${greetings.length}` : ""}
          </div>
        </div>
      </div>
    `;
    const pagerHtml = greetings.length > 1 ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:-6px">
        <button type="button" id="startChatPgPrev" class="ig-icon-btn icon-flip-rtl" aria-label="${t("char_previous")}" style="position:static">‹</button>
        <span style="display:flex;gap:5px">
          ${greetings.map((_, i) => `<span class="char-pg-dot${i === 0 ? " on" : ""}" data-i="${i}"></span>`).join("")}
        </span>
        <button type="button" id="startChatPgNext" class="ig-icon-btn icon-flip-rtl" aria-label="${t("char_next")}" style="position:static">›</button>
      </div>
    ` : "";
    const footer = ME ? `
      <div style="border-top:1px solid var(--color-line);padding-top:14px">
        <button type="button" id="startChatConfirm" class="pe-gen-btn" style="width:100%;justify-content:center">${c.mode === "rpg" ? t("char_begin_campaign") : t("char_start_chat")}</button>
      </div>
    ` : `
      <div style="border-top:1px solid var(--color-line);padding-top:14px;display:flex;flex-direction:column;gap:8px">
        <p style="font-size:12.5px;color:var(--color-sec);margin:0">${t("char_sign_in_to_continue_prefix")} ${_esc(c.name)}.</p>
        <a href="/login" onclick="event.preventDefault();closeTopModal();navigate('/login')" class="pe-gen-btn" style="width:100%;text-align:center;text-decoration:none;display:block">${t("char_sign_in")}</a>
      </div>
    `;
    const stageHtml = hasStage ? `
      <div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">
        <div style="position:absolute;inset:0;background-image:url('${_esc(stageBgUrl || spriteUrl)}');background-size:cover;background-position:center"></div>
        <div style="position:absolute;inset:0;background:linear-gradient(to bottom, transparent 30%, color-mix(in srgb, var(--color-paper) 60%, transparent) 80%, var(--color-paper) 98%)"></div>
      </div>
    ` : fallbackBg ? `
      <div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">
        <div style="position:absolute;inset:0;background-image:url('${_esc(fallbackBg)}');background-size:cover;background-position:center;opacity:.4"></div>
        <div style="position:absolute;inset:0;background:linear-gradient(to bottom, transparent 40%, color-mix(in srgb, var(--color-paper) 55%, transparent) 75%, var(--color-paper) 98%)"></div>
      </div>
    ` : "";
    openModal(`
      <div style="display:flex;flex-direction:column;gap:14px;border-radius:14px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:999px;overflow:hidden;flex:none;background:var(--color-surface-2)">
            ${c.avatar ? `<img src="${_esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">` : ""}
          </div>
          <div class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${_esc(c.name)}</div>
        </div>
        ${greetings.length ? `
          <div style="position:relative;border-radius:12px;overflow:hidden">
            ${stageHtml}
            <div id="startChatPgThread" class="chat-stage-glass" style="position:relative;padding:14px">${bubble(greetings[0], 0)}</div>
          </div>
          ${pagerHtml}
        ` : ""}
        ${footer}
      </div>
    `, { wide: true });
    const layer = document.querySelector(".modal-layer:last-child");
    if (greetings.length > 1) {
      const rerender = () => {
        layer.querySelector("#startChatPgThread").innerHTML = bubble(greetings[idx], idx);
        layer.querySelectorAll(".char-pg-dot").forEach((d, i) => d.classList.toggle("on", i === idx));
      };
      layer.querySelector("#startChatPgPrev").onclick = () => { idx = (idx - 1 + greetings.length) % greetings.length; rerender(); };
      layer.querySelector("#startChatPgNext").onclick = () => { idx = (idx + 1) % greetings.length; rerender(); };
      layer.querySelectorAll(".char-pg-dot").forEach((d) => {
        d.onclick = () => { idx = Number(d.dataset.i); rerender(); };
      });
    }
    if (!ME) return;
    layer.querySelector("#startChatConfirm").onclick = () => {
      closeTopModal();
      navigate(`/c/${encodeURIComponent(c.id)}/new-chat`);
    };
  }

  mountPresentation() {
    const box = this.main.querySelector("#charPresentation");
    if (!box) return;
    mountSandboxedHTML(box, _substituteCharacterTemplate(this.char.presentation_html, this.char.id), {
      onReady: (doc) => {
        doc.querySelectorAll("[data-comments='1']").forEach((btn) => {
          btn.addEventListener("click", (e) => { e.preventDefault(); openCommentsModal("character", this.char.id); });
        });
      },
    });
  }

  loreCategories() {
    return [...new Set(this.lore.map((e) => e.category).filter(Boolean))].sort();
  }

  filteredLore() {
    if (this.loreCategory === "__all") return this.lore;
    if (this.loreCategory === "__untagged") return this.lore.filter((e) => !e.category);
    return this.lore.filter((e) => e.category === this.loreCategory);
  }

  loreEntryName(e) {
    return e.name || (e.keys && e.keys[0]) || e.category || t("char_untitled_lore_entry");
  }

  loreCategoryMenuHtml() {
    const cats = this.loreCategories();
    if (!cats.length) return "";
    const label = this.loreCategory === "__all" ? t("char_all")
      : this.loreCategory === "__untagged" ? t("char_untagged") : this.loreCategory;
    return `
      <div style="position:relative;flex:none">
        <button type="button" id="charLoreCatBtn" class="filter-chip" style="display:inline-flex;align-items:center;gap:5px">
          ${_esc(label)}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        ${this.loreCategoryMenuOpen ? `
          <div style="position:absolute;top:calc(100% + 4px);right:0;z-index:5;min-width:140px;background:var(--color-surface);border:1px solid var(--color-line-2);border-radius:10px;padding:4px;box-shadow:0 8px 24px -8px rgba(0,0,0,.4)">
            <button type="button" class="dropdown-item" data-lore-cat="__all">${t("char_all")}</button>
            ${cats.map((c) => `<button type="button" class="dropdown-item" data-lore-cat="${_esc(c)}">${_esc(c)}</button>`).join("")}
            ${this.lore.some((e) => !e.category) ? `<button type="button" class="dropdown-item" data-lore-cat="__untagged">${t("char_untagged")}</button>` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }

  loreCardHtml() {
    if (!this.lore.length) {
      return `<p style="padding:24px 0;text-align:center;font-size:13px;color:var(--color-muted)">${t("char_no_lore_entries_yet")}</p>`;
    }
    const isOwner = ME && this.char.owner_id === ME.id;
    const filtered = this.filteredLore();
    if (!filtered.length) {
      return `<p style="padding:24px 0;text-align:center;font-size:13px;color:var(--color-muted)">${t("char_no_lore_entries_in_this_category")}</p>`;
    }
    const perPage = 10;
    const pageCount = Math.ceil(filtered.length / perPage);
    const page = Math.min(this.lorePage, pageCount - 1);
    const pageItems = filtered.slice(page * perPage, page * perPage + perPage);
    const pagerHtml = pageCount > 1 ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 0 2px">
        <button type="button" id="charLorePrev" class="tool icon-flip-rtl" style="border:1px solid var(--color-line-2);border-radius:8px;padding:4px 10px;${page === 0 ? "opacity:.4;pointer-events:none" : ""}">‹</button>
        <span class="font-mono" style="font-size:11px;color:var(--color-muted)">${page + 1} / ${pageCount}</span>
        <button type="button" id="charLoreNext" class="tool icon-flip-rtl" style="border:1px solid var(--color-line-2);border-radius:8px;padding:4px 10px;${page === pageCount - 1 ? "opacity:.4;pointer-events:none" : ""}">›</button>
      </div>
    ` : "";
    return `
      <div style="display:flex;flex-direction:column">
        ${pageItems.map((e, i) => `
          <div class="char-lore-row" data-lore-id="${_esc(e.id)}" style="display:flex;gap:10px;align-items:flex-start;padding:11px 0;cursor:pointer;${i < pageItems.length - 1 ? "border-bottom:1px solid var(--color-line)" : ""}">
            ${e.image ? `
              <div style="width:40px;height:40px;border-radius:9px;flex:none;padding:2px;background:${this._creatorRingGradient()}">
                <div style="width:100%;height:100%;border-radius:7px;overflow:hidden">
                  <img src="${_esc(e.image)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;${e.is_explicit && !ME?.nsfw_allowed ? "filter:blur(8px) saturate(60%)" : ""}">
                </div>
              </div>
            ` : ""}
            <div style="min-width:0;flex:1">
              <div style="font-weight:600;font-size:13.5px;color:var(--color-ink);margin-bottom:3px">${_esc(this.loreEntryName(e))}</div>
              <div style="font-size:12.5px;line-height:1.5;color:var(--color-sec)">${_esc((e.content || "").slice(0, 160))}${(e.content || "").length > 160 ? "…" : ""}</div>
            </div>
            ${ME && (e.category || "").toLowerCase() === "character" && (isOwner || (e.usable_as_persona && !e.hidden)) ? `
              <button type="button" data-lore-persona-btn="${_esc(e.id)}" class="ig-icon-btn" style="position:static;flex:none;width:30px;height:30px" aria-label="${t("char_use_as_your_mask")}" data-tooltip="${t("char_use_as_your_mask")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px">${SETTINGS_ICONS.masks}</svg>
              </button>
            ` : ""}
          </div>
        `).join("")}
      </div>
      ${pagerHtml}
    `;
  }

  openLoreEntryModal(e) {
    const isOwner = ME && this.char.owner_id === ME.id;
    const title = this.loreEntryName(e);
    const eyebrow = (e.category || t("char_lore_fallback")).toUpperCase();
    const hiddenFromViewer = e.hidden && !isOwner;
    const boolsHtml = `
      <div style="display:flex;gap:14px;padding-top:10px">
        <span class="sym-meta">${t("char_always_active_label")} <b style="color:var(--color-ink)">${e.always ? t("char_yes") : t("char_no")}</b></span>
        <span class="sym-meta">${t("char_global_label")} <b style="color:var(--color-ink)">${e.global ? t("char_yes") : t("char_no")}</b></span>
      </div>
    `;
    openModal(`
      <div class="ig-detail">
        ${e.image ? `
          <div class="ig-detail-img" style="border:none;border-radius:0;display:flex;flex-direction:column;gap:0">
            <div style="padding:3px;border-radius:6px;background:${this._creatorRingGradient()}">
              <div style="border-radius:4px;overflow:hidden">
                <img src="${_esc(e.image)}" alt="" ${e.is_explicit ? 'data-explicit="1"' : ""} ${e.is_explicit && !ME?.nsfw_allowed ? 'style="filter:blur(14px) saturate(60%)"' : ""}>
              </div>
            </div>
            <div class="lore-modal-bools-under-img" style="border-top:1px solid var(--color-line);margin-top:10px">${boolsHtml}</div>
          </div>
        ` : ""}
        <div class="ig-detail-body">
          <div class="ig-detail-eyebrow">${_esc(eyebrow)}</div>
          <div class="font-display" style="font-size:19px;font-weight:600;color:var(--color-ink)">${_esc(title)}</div>
          ${(e.keys || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${e.keys.map((k) => `<span class="sym-tag">${_esc(k)}</span>`).join("")}</div>` : ""}
          <div class="ig-tags-label">${t("char_content_label")}</div>
          <div class="sym-body" style="font-size:13.5px;line-height:1.6;${hiddenFromViewer ? "font-style:italic;color:var(--color-muted)" : ""}">
            ${hiddenFromViewer ? t("char_entry_hidden_by_creator") : symposiumMd(e.content || "")}
          </div>
          <div class="${e.image ? "lore-modal-bools-inline" : ""}" style="border-top:1px solid var(--color-line)">${boolsHtml}</div>
        </div>
      </div>
    `, { wide: true });
  }

  render() {
    if (this.error) {
      this.main.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px;padding:16px">
          ${pageHeaderHtml("Explore", "Characters", t("ph_character_title"), "")}
          <p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>
        </div>
      `;
      return;
    }
    if (!this.char) {
      this.main.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px;padding:16px">
          ${pageHeaderHtml("Explore", "Characters", t("ph_character_title"), "")}
          <p style="color:var(--color-sec);font-size:13px">${t("char_consulting_the_archive")}</p>
        </div>
      `;
      return;
    }
    const c = this.char;
    const isOwner = ME && c.owner_id === ME.id;
    const hue = [...c.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const dom = `hsl(${hue} 45% 20%)`;
    const bannerArt = c.assets?.banner
      ? `background-image:url('${_esc(c.assets.banner)}');background-size:cover;background-position:center`
      : `background:linear-gradient(150deg, hsl(${hue} 46% 34%), hsl(${hue} 48% 12%))`;
    const censored = c.is_explicit && !ME?.nsfw_allowed && !this.revealed;
    const creatorName = this.creatorProfile?.display_name || c.owner_username || c.creator || "Unknown creator";
    const avatarInner = this.creatorProfile?.avatar
      ? `<img src="${_esc(this.creatorProfile.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`
      : `<span>${creatorName[0]?.toUpperCase() || "?"}</span>`;
    const creatorRingGradient = this._creatorRingGradient();
    const code = `CHA-${c.id.slice(0, 3).toUpperCase()}${c.mode === "rpg" ? "-GM" : ""}`;
    const created = c.created ? new Date(c.created * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
    const greetingCount = 1 + (c.alt_greetings?.length || 0);
    const hasCustom = (c.presentation_html || "").trim().length > 0;

    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column">
        <div class="char-hero artisan-hero-bleed" style="margin-bottom:0">
          <div style="position:relative;height:190px;overflow:hidden;${bannerArt}">
            <div style="position:absolute;top:10px;left:10px;right:10px;display:flex;justify-content:space-between;align-items:center;z-index:2">
              <button type="button" id="charBack" class="ig-icon-btn" aria-label="${t("char_back")}">
                <svg class="icon-flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
            </div>
            ${!c.assets?.banner ? `<div style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--font-display);font-size:120px;color:rgba(255,255,255,.16)">${_esc(c.name?.[0]?.toUpperCase() || "?")}</div>` : ""}
            <div style="position:absolute;inset:0;background:linear-gradient(180deg, transparent 35%, var(--color-paper) 100%)"></div>
          </div>
        </div>
        <div style="padding:0 16px 24px">
          <div style="position:relative;margin:-40px 0 0;background:var(--color-surface-2);border:1px solid var(--color-line);border-radius:14px;padding:16px 18px;display:flex;gap:16px;align-items:flex-start;box-shadow:0 14px 32px -16px rgba(0,0,0,.5);margin-bottom:16px">
            <div style="position:relative;width:72px;height:72px;border-radius:12px;flex:none;padding:2.5px;background:${creatorRingGradient};--dom:${dom}">
              <div style="position:relative;width:100%;height:100%;border-radius:10px;overflow:hidden">
                ${c.avatar
                  ? `<img src="${_esc(c.avatar)}" alt="" ${c.is_explicit ? 'data-explicit="1"' : ""} style="width:100%;height:100%;object-fit:cover${censored ? ";filter:blur(14px) saturate(60%)" : ""}">`
                  : `<div style="width:100%;height:100%;background:linear-gradient(150deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 45% 16%));display:grid;place-items:center;font-family:var(--font-display);font-size:26px;color:#fff">${_esc(c.name?.[0]?.toUpperCase() || "?")}</div>`}
                ${censored ? `<button type="button" class="ig-reveal-btn" data-act="reveal-avatar"><span style="font-size:9px">NSFW</span></button>` : ""}
              </div>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px">
                ${MODE_ICONS[c.mode] ? `<span style="color:var(--color-accent);width:12px;height:12px;display:inline-flex;flex:none">${MODE_ICONS[c.mode]}</span>` : ""}
                <span class="font-mono" style="font-size:11px;letter-spacing:.06em;color:var(--color-accent)">${_esc(code)}</span>
              </div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:2px">
                <h1 class="font-display" style="font-weight:600;font-size:22px;letter-spacing:-.01em;color:var(--color-ink);margin:0;line-height:1.2">${_esc(c.name)}</h1>
                <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                  <button type="button" id="charComments" class="ig-icon-btn" aria-label="${t("char_comments")}" data-tooltip="${t("char_comments")}" style="position:static;width:30px;height:30px">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </button>
                  <button type="button" id="charShare" class="ig-icon-btn" aria-label="${t("char_copy_link")}" data-tooltip="${t("char_copy_link")}" style="position:static;width:30px;height:30px">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  </button>
                  ${this.featuringGroups?.length ? `
                    <div style="position:relative">
                      <button type="button" id="charGroupsBtn" class="ig-icon-btn" aria-label="${t("char_groups_button", "Appears in groups")}" data-tooltip="${t("char_groups_button", "Appears in groups")}" style="position:static;width:30px;height:30px">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </button>
                      ${this.groupsMenuOpen ? `
                        <div style="position:absolute;top:calc(100% + 4px);right:0;z-index:5;min-width:170px;max-width:240px;background:var(--color-surface);border:1px solid var(--color-line-2);border-radius:10px;padding:4px;box-shadow:0 8px 24px -8px rgba(0,0,0,.4)">
                          ${this.featuringGroups.map((group) => `<button type="button" class="dropdown-item" data-group-id="${_esc(group.id)}">${_esc(group.name)}</button>`).join("")}
                        </div>
                      ` : ""}
                    </div>
                  ` : ""}
                  ${ME && c.can_be_persona ? `
                    <button type="button" id="charAddPersona" class="ig-icon-btn" aria-label="${t("char_let_others_play_as_this_character")}" data-tooltip="${t("char_add_to_my_masks")}" style="position:static;width:30px;height:30px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="9.5" cy="10" r="4.2"/><path d="M12.8 8.2A4.2 4.2 0 1 1 12.8 15.8"/><path d="M4 21c.5-3 2.5-4.6 5.5-4.6"/></svg>
                    </button>
                  ` : ""}
                  ${(ME && isOwner) || c.allow_download ? `
                    <div style="position:relative">
                      <button type="button" id="charExport" class="ig-icon-btn" aria-label="${t("char_export_card")}" data-tooltip="${t("char_export_card")}" style="position:static;width:30px;height:30px">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </button>
                      ${this.exportMenuOpen ? `
                        <div style="position:absolute;top:calc(100% + 4px);right:0;z-index:5;min-width:150px;background:var(--color-surface);border:1px solid var(--color-line-2);border-radius:10px;padding:4px;box-shadow:0 8px 24px -8px rgba(0,0,0,.4)">
                          <button type="button" class="dropdown-item" data-export-spec="v2">${t("char_character_card_v2")}</button>
                          <button type="button" class="dropdown-item" data-export-spec="v3">${t("char_character_card_v3")}</button>
                          <button type="button" class="dropdown-item" data-export-spec="storyhaven">${t("char_storyhaven_format")}</button>
                        </div>
                      ` : ""}
                    </div>
                  ` : ""}
                  ${isOwner ? `
                    <button type="button" id="charEdit" class="ig-icon-btn" aria-label="${t("char_edit")}" data-tooltip="${t("char_edit")}" style="position:static;width:30px;height:30px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                    </button>
                    <button type="button" id="charDelete" class="ig-icon-btn danger" aria-label="${t("char_delete")}" data-tooltip="${t("char_delete")}" style="position:static;width:30px;height:30px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  ` : ""}
                  <button type="button" id="charStartChat" class="ig-icon-btn" aria-label="${c.mode === "rpg" ? t("char_begin_campaign") : t("char_start_chat")}" data-tooltip="${c.mode === "rpg" ? t("char_begin_campaign") : t("char_start_chat")}" style="position:static;width:30px;height:30px;border-color:var(--color-accent);color:var(--color-accent)">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:13px;height:13px;margin-left:1px"><path d="M6 4l14 8-14 8V4z"/></svg>
                  </button>
                  ${ME?.experimental_features_enabled && c.mode === "rpg" ? `
                    <button type="button" id="charStartMultiplayer" class="ig-icon-btn" aria-label="${t("chat_multiplayer_start_button", "Start multiplayer")}" data-tooltip="${t("chat_multiplayer_start_button", "Start multiplayer")}" style="position:static;width:30px;height:30px">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    </button>
                  ` : ""}
                </div>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
                ${(c.tags || []).map((tg) => `<span class="sym-tag" data-tag="${_attr(tg)}" style="cursor:pointer">${_esc(tg)}</span>`).join("")}
              </div>
              ${c.owner_username ? `
                <div style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer" data-owner="${encodeURIComponent(c.owner_username)}">
                  <span style="width:28px;height:28px;border-radius:999px;padding:2px;flex:none;background:${creatorRingGradient}">
                    <span style="width:100%;height:100%;border-radius:999px;background:var(--color-surface-2);overflow:hidden;display:grid;place-items:center;font-family:var(--font-mono);font-size:11px;color:var(--color-ink)">${avatarInner}</span>
                  </span>
                  <span style="display:flex;flex-direction:column;line-height:1.25">
                    <span class="font-mono" style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-muted)">${t("char_created_by")}</span>
                    <span class="font-sans" style="font-size:13.5px;font-weight:600;color:var(--color-ink)">${_esc(creatorName)}</span>
                  </span>
                </div>
              ` : ""}
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
                ${this.statPill(this.lore.length, " " + t("char_lore_suffix"))}
                ${this.statPill(greetingCount, greetingCount === 1 ? " " + t("char_greeting_suffix") : " " + t("char_greetings_suffix"))}
                ${this.statPill(c.chats > 999 ? (c.chats / 1000).toFixed(1) + "k" : (c.chats || 0), " " + t("char_chats_suffix"))}
              </div>
              ${created ? `<div class="font-mono" style="font-size:11px;color:var(--color-muted);margin-top:8px">${t("char_created_prefix")} ${created}</div>` : ""}
              ${c.description ? `
                <p id="charDesc" class="char-desc-clamped" style="font-size:13.5px;line-height:1.5;color:var(--color-sec);margin:10px 0 0">${_esc(c.description)}</p>
                <button type="button" id="charDescToggle" style="display:none;margin-top:4px;background:none;border:none;padding:0;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--color-accent);cursor:pointer">${t("char_expand")}</button>
              ` : ""}
            </div>
          </div>
        </div>
        </div>
        <div class="char-details-grid${hasCustom ? "" : " char-details-grid-single"}" style="padding:0 16px 24px">
          ${hasCustom ? `
          <div class="char-details-col">
              <div style="background:var(--color-surface);border:1px solid var(--color-line);border-radius:15px;overflow:hidden;margin-bottom:22px">
                <button type="button" id="charPresentationToggle" style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:none;border:none;cursor:pointer;text-align:left">
                  <span class="font-display" style="font-weight:600;font-size:15px;color:var(--color-ink)">${t("char_custom_card")}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;color:var(--color-muted);transition:transform .15s ease;${this.presentationOpen ? "transform:rotate(180deg)" : ""}"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                <div id="charPresentation" style="${this.presentationOpen ? "" : "display:none"};border-top:1px solid var(--color-line)"></div>
              </div>
          </div>
          ` : ""}
          <div class="char-details-col">
            <div style="background:var(--color-surface);border:1px solid var(--color-line);border-radius:15px;overflow:hidden;margin-bottom:22px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--color-line)">
                <span class="font-display" style="font-weight:600;font-size:15px;color:var(--color-ink)">${t("char_key_lore")}</span>
                <div style="display:flex;align-items:center;gap:6px">
                  ${isOwner ? `<button type="button" id="charLoreAdd" class="filter-chip">+ ${t("char_add_lore_item")}</button>` : ""}
                  ${this.loreCategoryMenuHtml()}
                </div>
              </div>
              ${this.lore.length ? `
              <div style="display:flex;gap:5px;background:var(--color-surface);border-bottom:1px solid var(--color-line);padding:10px 16px 0">
                <button type="button" class="filter-chip${this.loreViewMode === "list" ? " on" : ""}" id="charLoreModeList">${t("grimoire_list_tab")}</button>
                <button type="button" class="filter-chip${this.loreViewMode === "web" ? " on" : ""}" id="charLoreModeWeb">${t("grimoire_web_tab")}</button>
              </div>
              ` : ""}
              <div style="padding:0 16px">${this.loreViewMode === "web" && this.lore.length ? `<div id="charLoreWebMount"></div>` : this.loreCardHtml()}</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("charBack").onclick = () => (history.length > 1 ? history.back() : navigate("/explore"));
    const descEl = document.getElementById("charDesc");
    const descToggleEl = document.getElementById("charDescToggle");
    if (descEl && descToggleEl && descEl.scrollHeight > descEl.clientHeight + 1) descToggleEl.style.display = "";
    document.getElementById("charDescToggle")?.addEventListener("click", () => {
      const desc = document.getElementById("charDesc");
      const btn = document.getElementById("charDescToggle");
      const expanded = desc.classList.toggle("char-desc-clamped") === false;
      btn.textContent = expanded ? t("char_collapse") : t("char_expand");
    });
    this.main.querySelectorAll("[data-tag]").forEach((el) => {
      el.onclick = () => searchByTag(el.dataset.tag);
    });
    document.getElementById("charComments").onclick = () => openCommentsModal("character", c.id);
    document.getElementById("charShare").onclick = () => copyShareUrl(`${location.origin}/c/${encodeURIComponent(c.id)}`);
    document.getElementById("charGroupsBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.groupsMenuOpen = !this.groupsMenuOpen;
      this.render();
    });
    this.main.querySelectorAll("[data-group-id]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.groupsMenuOpen = false;
        navigate(`/g/${encodeURIComponent(btn.dataset.groupId)}`);
      };
    });
    if (this.groupsMenuOpen) {
      document.addEventListener("click", () => {
        this.groupsMenuOpen = false;
        this.render();
      }, { once: true });
    }
    document.getElementById("charAddPersona")?.addEventListener("click", async () => {
      try {
        await api(`/api/characters/${encodeURIComponent(c.id)}/persona`, { method: "POST" });
        toast(t("char_added_to_your_masks"));
      } catch (err) {
        errorToast(err.message || t("char_couldnt_add_character_to_masks"));
      }
    });
    document.getElementById("charStartChat").onclick = () => this.openStartChatModal();
    document.getElementById("charStartMultiplayer")?.addEventListener("click", () => this.startMultiplayer());
    document.getElementById("charEdit")?.addEventListener("click", () => navigate(`/workshop/characters/${encodeURIComponent(c.id)}/edit`));
    document.getElementById("charDelete")?.addEventListener("click", () => this.deleteCharacter());
    document.getElementById("charExport")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.exportMenuOpen = !this.exportMenuOpen;
      this.render();
    });
    this.main.querySelectorAll("[data-export-spec]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.exportMenuOpen = false;
        this.downloadCard(btn.dataset.exportSpec);
        this.render();
      };
    });
    if (this.exportMenuOpen) {
      document.addEventListener("click", () => {
        this.exportMenuOpen = false;
        this.render();
      }, { once: true });
    }
    this.main.querySelector("[data-act='reveal-avatar']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.revealed = true;
      this.render();
    });
    this.main.querySelector("[data-owner]")?.addEventListener("click", () => {
      navigate(`/u/${this.main.querySelector("[data-owner]").dataset.owner}`);
    });
    document.getElementById("charPresentationToggle")?.addEventListener("click", () => {
      this.presentationOpen = !this.presentationOpen;
      this.render();
    });
    document.getElementById("charLoreCatBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.loreCategoryMenuOpen = !this.loreCategoryMenuOpen;
      this.render();
    });
    this.main.querySelectorAll("[data-lore-cat]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.loreCategory = btn.dataset.loreCat;
        this.loreCategoryMenuOpen = false;
        this.lorePage = 0;
        this.render();
      };
    });
    if (this.loreCategoryMenuOpen) {
      document.addEventListener("click", () => {
        this.loreCategoryMenuOpen = false;
        this.render();
      }, { once: true });
    }
    document.getElementById("charLoreAdd")?.addEventListener("click", () => {
      _grimoireEditModal(this.char.id, null, this.lore, () => this.loadExtras());
    });
    document.getElementById("charLoreModeList")?.addEventListener("click", () => {
      this.loreViewMode = "list";
      this.render();
    });
    document.getElementById("charLoreModeWeb")?.addEventListener("click", () => {
      this.loreViewMode = "web";
      this.render();
    });
    const charLoreWebMount = document.getElementById("charLoreWebMount");
    if (charLoreWebMount && typeof WorkshopLoreWebView !== "undefined") {
      const webView = new WorkshopLoreWebView(this.lore, { [this.char.id]: this.char });
      webView.mount(charLoreWebMount);
    }
    document.getElementById("charLorePrev")?.addEventListener("click", () => {
      this.lorePage = Math.max(0, this.lorePage - 1);
      this.render();
    });
    document.getElementById("charLoreNext")?.addEventListener("click", () => {
      this.lorePage += 1;
      this.render();
    });
    this.main.querySelectorAll("[data-lore-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const entry = this.lore.find((e) => e.id === row.dataset.loreId);
        if (!entry) return;
        if (ME && this.char.owner_id === ME.id) {
          _grimoireViewModal(entry, this.char.name, this.lore, {
            onEdit: () => _grimoireEditModal(this.char.id, entry, this.lore, () => this.loadExtras()),
            onDelete: async () => {
              try {
                await api(`/api/lore/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
                toast(t("char_deleted"));
                this.loadExtras();
              } catch (err) {
                errorToast(err.message || t("char_couldnt_delete_that_entry"));
              }
            },
          });
          return;
        }
        this.openLoreEntryModal(entry);
      });
    });
    this.main.querySelectorAll("[data-lore-persona-btn]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const entry = this.lore.find((x) => x.id === btn.dataset.lorePersonaBtn);
        if (!entry) return;
        try {
          await api(`/api/lore/${encodeURIComponent(entry.id)}/persona`, { method: "POST" });
          toast(t("char_added_to_your_masks"));
        } catch (err) {
          errorToast(err.message || t("char_couldnt_add_to_masks"));
        }
      });
    });
    if (hasCustom && this.presentationOpen) this.mountPresentation();
  }
}

if (typeof window !== "undefined") {
  window.CharacterView = CharacterView;
}
