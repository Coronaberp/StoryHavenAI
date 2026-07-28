"use strict";

const CHATS_PAGE_SIZE = 20;

function _chatsAgo(ts) {
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return t("chats_time_just_now");
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const CHATS_GROUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const CHATS_PEOPLE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>`;
const CHATS_EXCHANGE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const CHATS_SELECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;

class ChatsView {
  constructor() {
    this.sessions = null;
    this.total = 0;
    this.page = 1;
    this.chars = {};
    this.error = "";
    this.q = "";
    this.charFilters = [];
    this.collapsed = new Set();
    this.collapsedInit = false;
    this.selectMode = false;
    this.selected = new Set();
  }

  groupKey(s) {
    if (s.is_group) return "group:" + s.id;
    return s.char_id || ("title:" + (s.title || "Untitled"));
  }

  buildGroups(sessions) {
    const map = new Map();
    for (const s of sessions) {
      const isGroup = !!s.is_group;
      const char = this.chars[s.char_id];
      const key = this.groupKey(s);
      if (!map.has(key)) {
        map.set(key, { key, char_id: isGroup ? null : s.char_id, is_group: isGroup,
          name: isGroup ? (s.title || t("group_chat_label", "Group")) : (char?.name || s.title || "Untitled"),
          avatar: isGroup ? "" : (char?.avatar || ""),
          cast_avatars: isGroup ? (s.cast_avatars || []) : [], sessions: [] });
      }
      const g = map.get(key);
      g.sessions.push(s);
      if (!isGroup && char?.name) g.name = char.name;
      if (!isGroup && char?.avatar) g.avatar = char.avatar;
    }
    const groups = [...map.values()];
    for (const g of groups) g.sessions.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    groups.sort((a, b) => (b.sessions[0].updated || 0) - (a.sessions[0].updated || 0));
    return groups;
  }

  toggleGroup(key) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.renderResults();
  }

  toggleSelectMode() {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) this.selected.clear();
    document.body.classList.toggle("chats-select-mode", this.selectMode);
    this.renderResults();
  }

  toggleSelect(sid) {
    if (this.selected.has(sid)) this.selected.delete(sid);
    else this.selected.add(sid);
    this.renderResults();
  }

  confirmBulkDelete() {
    const count = this.selected.size;
    if (!count) return;
    const layer = openModal(`
      <div style="padding:4px 2px 2px">
        <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("chats_bulk_delete_confirm_title", "Delete conversations?")}</h3>
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">${t("chats_bulk_delete_confirm_body", "{n} conversations will be deleted. This can't be undone.").replace("{n}", count)}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="chatsCancelBulkDel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("chats_keep_it")}</button>
          <button type="button" class="pe-gen-btn" id="chatsConfirmBulkDel" style="border-color:var(--color-warn);color:var(--color-warn)">${t("chats_delete")}</button>
        </div>
      </div>
    `);
    layer.querySelector("#chatsCancelBulkDel").onclick = () => closeModal(layer);
    layer.querySelector("#chatsConfirmBulkDel").onclick = async () => {
      closeModal(layer);
      await this.bulkDelete();
    };
  }

  async bulkDelete() {
    const ids = [...this.selected];
    const results = await Promise.allSettled(ids.map((sid) => api(`/api/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected").length;
    const deleted = new Set(ids.filter((_, i) => results[i].status === "fulfilled"));
    this.sessions = this.sessions.filter((s) => !deleted.has(s.id));
    deleted.forEach((sid) => delete this.chars[sid]);
    this.selected.clear();
    this.selectMode = false;
    document.body.classList.remove("chats-select-mode");
    this.renderResults();
    toast(failed ? t("chats_bulk_delete_partial_error", "Some conversations couldn't be deleted.") : t("chats_conversation_deleted"));
  }

  groupHeaderHtml(g, expanded) {
    const count = g.sessions.length;
    const hue = [...(g.char_id || g.name)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const art = g.avatar
      ? `background-image:url('${_attr(g.avatar)}')`
      : `background:linear-gradient(150deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 40% 14%))`;
    const initial = g.name[0].toUpperCase();
    const jsKey = g.key.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const groupTag = g.is_group ? `<span class="chats-tag-group">${CHATS_GROUP_ICON}${t("group_chat_label", "Group")}</span>` : "";
    return `
      <button type="button" class="chats-group-header" data-expanded="${expanded ? "true" : "false"}" onclick="_activeChatsView?.toggleGroup('${_attr(jsKey)}')">
        <span class="chats-group-toggle">▾</span>
        <span class="chats-seal" style="${g.is_group ? "" : art}">${g.is_group ? (g.cast_avatars.length ? groupGridAvatar(g.cast_avatars) : CHATS_GROUP_ICON) : (g.avatar ? "" : _esc(initial))}</span>
        <span style="flex:1;min-width:0">
          <span class="chats-name">${_esc(g.name)}${groupTag}</span>
          <span class="chats-time" style="display:block;margin-top:2px">${count} ${count === 1 ? t("chats_conversation_singular", "conversation") : t("chats_conversation_plural", "conversations")}</span>
        </span>
        <span class="chats-group-rule"></span>
      </button>
    `;
  }

  allCharNames() {
    return [...new Set(Object.values(this.chars).map((c) => c.name).filter(Boolean))].sort();
  }

  visibleSessions() {
    return (this.sessions || []).filter((s) => {
      const name = s.is_group ? (s.title || "") : (this.chars[s.char_id]?.name || s.title || "");
      if (this.charFilters.length && !this.charFilters.includes(name)) return false;
      if (!this.q) return true;
      const q = this.q.toLowerCase();
      return name.toLowerCase().includes(q) || (s.preview || "").toLowerCase().includes(q);
    });
  }

  async mount(main) {
    this.main = main;
    this.selectMode = false;
    this.selected.clear();
    document.body.classList.remove("chats-select-mode");
    window._activeChatsView = this;
    onPaginate("chats", () => { this.page = paginatePage("chats"); this.load(); });
    this.render();
    await this.load();
  }

  async load() {
    this.error = "";
    try {
      const page = await api(`/api/sessions?paged=1&limit=${CHATS_PAGE_SIZE}&offset=${(this.page - 1) * CHATS_PAGE_SIZE}`);
      this.sessions = page.sessions;
      this.total = page.total;
    } catch (err) {
      this.error = err.message || t("chats_load_error");
      this.sessions = [];
    }
    this.renderResults();
    this.loadChars();
  }

  async loadChars() {
    const ids = [...new Set(this.sessions.map((s) => s.char_id).filter(Boolean))];
    if (!ids.length) return;
    const fetched = await Promise.all(ids.map(async (cid) => {
      try { return [cid, await api(`/api/characters/${encodeURIComponent(cid)}`)]; }
      catch { return [cid, null]; }
    }));
    fetched.forEach(([cid, c]) => { if (c) this.chars[cid] = c; });
    this.renderResults();
  }

  rowHtml(s) {
    const isGroup = !!s.is_group;
    const char = this.chars[s.char_id];
    const name = isGroup ? (s.title || t("group_chat_label", "Group")) : (char?.name || s.title || "Untitled");
    const sessionTitle = isGroup ? "" : (s.title && s.title.trim() && s.title !== char?.name ? s.title.trim() : "");
    const hue = [...(s.char_id || name)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const art = (!isGroup && char?.avatar)
      ? `background-image:url('${_attr(char.avatar)}')`
      : `background:linear-gradient(150deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 40% 14%))`;
    const initial = name[0].toUpperCase();
    const preview = (s.preview || "").replace(/\s+/g, " ").trim();
    const jsName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const exchanges = s.message_count ? Math.floor(s.message_count / 2) : 0;
    const multiplayerTag = s.is_multiplayer
      ? `<span class="chats-tag-multiplayer">${CHATS_PEOPLE_ICON}${t("chat_multiplayer_badge", "Multiplayer")}${s.participant_count ? ` · ${s.participant_count}` : ""}</span>`
      : "";
    const checked = this.selected.has(s.id);
    return `
      <div class="chats-row" data-sid="${_attr(s.id)}" onclick="_activeChatsView?.rowClick('${_attr(s.id)}')">
        <span class="chats-check" data-checked="${checked ? "true" : "false"}"></span>
        <span class="chats-seal" style="${art}">${isGroup ? CHATS_GROUP_ICON : (char?.avatar ? "" : _esc(initial))}</span>
        <div class="chats-body">
          <div class="chats-top">
            <span class="chats-name">${sessionTitle ? _esc(sessionTitle) : _esc(name)}${multiplayerTag}</span>
            <span class="chats-time">${_chatsAgo(s.updated)}</span>
          </div>
          <div class="chats-preview-row">
            <p class="chats-preview">${_esc(preview || t("chats_no_lines_exchanged"))}</p>
            ${s.message_count ? `<span class="chats-exchanges" title="${_attr(t("chats_exchange_count", "{n} exchanges").replace("{n}", exchanges))}">${CHATS_EXCHANGE_ICON}${exchanges}</span>` : ""}
          </div>
        </div>
        <button type="button" class="chats-delete" aria-label="${_attr(t("chats_delete_conversation_aria"))}" onclick="event.stopPropagation();_activeChatsView?.confirmDelete('${_attr(s.id)}', '${_attr(jsName)}')">&times;</button>
      </div>
    `;
  }

  rowClick(sid) {
    if (this.selectMode) { this.toggleSelect(sid); return; }
    navigate(`/chats/${sid}`);
  }

  confirmDelete(sid, name) {
    const layer = openModal(`
      <div style="padding:4px 2px 2px">
        <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("chats_delete_confirm_title")}</h3>
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">${t("chats_delete_confirm_body_prefix")} ${_esc(name)} ${t("chats_delete_confirm_body_suffix")}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="chatsCancelDel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("chats_keep_it")}</button>
          <button type="button" class="pe-gen-btn" id="chatsConfirmDel" style="border-color:var(--color-warn);color:var(--color-warn)">${t("chats_delete")}</button>
        </div>
      </div>
    `);
    layer.querySelector("#chatsCancelDel").onclick = () => closeModal(layer);
    layer.querySelector("#chatsConfirmDel").onclick = async () => {
      closeModal(layer);
      await this.deleteSession(sid);
    };
  }

  async deleteSession(sid) {
    try {
      await api(`/api/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" });
      this.sessions = this.sessions.filter((s) => s.id !== sid);
      delete this.chars[sid];
      this.renderResults();
      toast(t("chats_conversation_deleted"));
    } catch (err) {
      toast(err.message || t("chats_delete_error"));
    }
  }

  bodyHtml() {
    if (this.sessions === null) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("chats_unsealing_correspondence")}</p>`;
    }
    if (this.error) {
      return `<p style="color:var(--color-sec);font-size:13px">${_esc(this.error)}</p>`;
    }
    if (!this.sessions.length) {
      return `
        <div class="chats-empty">
          <div class="chats-empty-mark">&sect;</div>
          <p class="chats-empty-title">${t("chats_empty_title")}</p>
          <p class="chats-empty-sub">${t("chats_empty_sub")}</p>
          <a href="/explore/characters" data-route="__seeall" onclick="event.preventDefault();navigate('/explore/characters')" class="chats-empty-cta">${t("chats_empty_cta")}</a>
        </div>
      `;
    }
    const visible = this.visibleSessions();
    if (!visible.length) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("chats_no_search_matches")}</p>`;
    }
    const groups = this.buildGroups(visible);
    if (!this.collapsedInit) {
      groups.forEach((g) => this.collapsed.add(g.key));
      this.collapsedInit = true;
    }
    const searching = !!this.q || this.charFilters.length > 0;
    return `<div class="chats-list">${groups.map((g) => {
      const expanded = searching || !this.collapsed.has(g.key);
      const children = expanded ? `<div class="chats-group-children">${g.sessions.map((s) => this.rowHtml(s)).join("")}</div>` : "";
      return `<div class="chats-group">${this.groupHeaderHtml(g, expanded)}${children}</div>`;
    }).join("")}</div>`;
  }

  toolbarHtml() {
    if (!this.selectMode) return "";
    const count = this.selected.size;
    return `
      <div class="chats-toolbar">
        <span><b>${count}</b> ${count === 1 ? t("chats_selected_singular", "selected") : t("chats_selected_plural", "selected")}</span>
        <div class="chats-toolbar-actions">
          <button type="button" class="chats-toolbar-btn chats-toolbar-btn-danger" id="chatsBulkDelete" ${count ? "" : "disabled"}>${t("chats_delete")}</button>
          <button type="button" class="chats-toolbar-btn chats-toolbar-btn-link" id="chatsBulkCancel">${t("chats_select_mode_cancel", "Cancel")}</button>
        </div>
      </div>
    `;
  }

  render() {
    this.main.innerHTML = `
      ${pageHeaderHtml("Chats", "Overview", t("ph_chats_title"), t("ph_chats_sub"))}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <div id="chatsSearchBox" style="flex:1;min-width:0"></div>
        <div id="chatsToggleSlot"></div>
      </div>
      <div id="chatsResultsArea"></div>
    `;
    const searchContainer = this.main.querySelector("#chatsSearchBox");
    this._searchBox = new SearchBox({
      container: searchContainer,
      mode: "client",
      tokens: [
        {
          prefix: "@", param: "characters",
          suggest: (q) => this.allCharNames().filter((n) => n.toLowerCase().includes(q)),
        },
      ],
      placeholder: t("chats_search_placeholder"),
      onChange: (query, tokenValues) => {
        this.q = query.trim();
        this.charFilters = tokenValues.characters;
        this.renderResults();
      },
    });
    this._searchBox.setState({ query: this.q, tokenValues: { characters: [...this.charFilters] } });
    this.renderResults();
  }

  renderResults() {
    const toggleSlot = this.main.querySelector("#chatsToggleSlot");
    toggleSlot.innerHTML = this.sessions && this.sessions.length
      ? `<button type="button" class="chats-select-toggle" id="chatsSelectToggle" aria-label="${_attr(t("chats_select_conversations", "Select conversations"))}" data-tooltip="${_attr(t("chats_select_conversations", "Select conversations"))}">${CHATS_SELECT_ICON}</button>`
      : "";
    const selectToggle = toggleSlot.querySelector("#chatsSelectToggle");
    if (selectToggle) selectToggle.onclick = () => this.toggleSelectMode();
    const resultsArea = this.main.querySelector("#chatsResultsArea");
    resultsArea.innerHTML = `
      ${this.toolbarHtml()}
      ${this.bodyHtml()}
      ${paginationHtml("chats", { rows: this.sessions || [], page: this.page, pages: Math.max(1, Math.ceil((this.total || 0) / CHATS_PAGE_SIZE)), total: this.total || 0, start: (this.page - 1) * CHATS_PAGE_SIZE, pageSize: CHATS_PAGE_SIZE })}
    `;
    const bulkDeleteBtn = resultsArea.querySelector("#chatsBulkDelete");
    if (bulkDeleteBtn) bulkDeleteBtn.onclick = () => this.confirmBulkDelete();
    const bulkCancelBtn = resultsArea.querySelector("#chatsBulkCancel");
    if (bulkCancelBtn) bulkCancelBtn.onclick = () => this.toggleSelectMode();
  }
}
