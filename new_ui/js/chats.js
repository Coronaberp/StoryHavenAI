"use strict";

function _parlanceAgo(ts) {
  const diff = Math.max(0, Date.now() / 1000 - ts);
  if (diff < 60) return t("parlance_time_just_now");
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const PARLANCE_GROUP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

class ChatsView {
  constructor() {
    this.sessions = null;
    this.chars = {};
    this.error = "";
    this.q = "";
    this.charFilters = [];
    this.collapsed = new Set();
    this.collapsedInit = false;
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
    this.render();
  }

  groupHeaderHtml(g, expanded) {
    const count = g.sessions.length;
    const hue = [...(g.char_id || g.name)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const art = g.avatar
      ? `background-image:url('${_attr(g.avatar)}')`
      : `background:linear-gradient(150deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 40% 14%))`;
    const initial = g.name[0].toUpperCase();
    const jsKey = g.key.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `
      <button type="button" class="parlance-group-header" onclick="_activeParlanceView?.toggleGroup('${_attr(jsKey)}')"
        style="width:100%;display:flex;align-items:center;gap:10px;padding:12px 4px;background:none;border:none;border-bottom:1px solid var(--color-line);cursor:pointer;text-align:left">
        <span class="parlance-group-toggle">${expanded ? "−" : "+"}</span>
        <span class="parlance-seal" style="${g.is_group ? "" : art}">${g.is_group ? (g.cast_avatars.length ? groupGridAvatar(g.cast_avatars) : PARLANCE_GROUP_ICON) : (g.avatar ? "" : _esc(initial))}</span>
        <span style="flex:1;min-width:0">
          <span class="parlance-name" style="display:block">${_esc(g.name)}${g.is_group ? ` <span class="font-mono" style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-muted);border:1px solid var(--color-line-2);border-radius:999px;padding:1px 6px;vertical-align:middle">${t("group_chat_label", "Group")}</span>` : ""}</span>
          <span class="parlance-time">${count} conversation${count === 1 ? "" : "s"}</span>
        </span>
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

  addCharFilter(name) {
    if (!this.charFilters.includes(name)) this.charFilters = [...this.charFilters, name];
    this.render();
  }

  removeCharFilter(name) {
    this.charFilters = this.charFilters.filter((c) => c !== name);
    this.render();
  }

  async mount(main) {
    this.main = main;
    window._activeParlanceView = this;
    this.render();
    try {
      this.sessions = await api("/api/sessions");
    } catch (err) {
      this.error = err.message || t("parlance_load_error");
      this.sessions = [];
    }
    this.render();
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
    this.render();
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
    return `
      <div class="parlance-row" data-sid="${_attr(s.id)}" onclick="navigate('/chats/${_attr(s.id)}')">
        <span class="parlance-seal" style="${art}">${isGroup ? PARLANCE_GROUP_ICON : (char?.avatar ? "" : _esc(initial))}</span>
        <div class="parlance-body">
          <div class="parlance-top">
            <span class="parlance-name">${sessionTitle ? _esc(sessionTitle) : _esc(name)}${s.is_multiplayer ? ` <span class="font-mono" style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-accent);border:1px solid var(--color-accent);border-radius:999px;padding:1px 6px;vertical-align:middle">${t("chat_multiplayer_badge", "Multiplayer")}${s.participant_count ? ` · ${s.participant_count}` : ""}</span>` : ""}</span>
            <span class="parlance-time">${_parlanceAgo(s.updated)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <p class="parlance-preview" style="flex:1;min-width:0">${_esc(preview || t("parlance_no_lines_exchanged"))}</p>
            ${s.message_count ? `<span class="parlance-time" style="flex:none;font-variant-numeric:tabular-nums">${t("parlance_exchange_count", "{n} exchanges").replace("{n}", Math.floor(s.message_count / 2))}</span>` : ""}
          </div>
        </div>
        <button type="button" class="parlance-delete" aria-label="${_attr(t("parlance_delete_conversation_aria"))}" onclick="event.stopPropagation();_activeParlanceView?.confirmDelete('${_attr(s.id)}', '${_attr(jsName)}')">&times;</button>
      </div>
    `;
  }

  confirmDelete(sid, name) {
    const layer = openModal(`
      <div style="padding:4px 2px 2px">
        <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("parlance_delete_confirm_title")}</h3>
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">${t("parlance_delete_confirm_body_prefix")} ${_esc(name)} ${t("parlance_delete_confirm_body_suffix")}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="parlanceCancelDel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("parlance_keep_it")}</button>
          <button type="button" class="pe-gen-btn" id="parlanceConfirmDel" style="border-color:var(--color-warn);color:var(--color-warn)">${t("parlance_delete")}</button>
        </div>
      </div>
    `);
    layer.querySelector("#parlanceCancelDel").onclick = () => closeModal(layer);
    layer.querySelector("#parlanceConfirmDel").onclick = async () => {
      closeModal(layer);
      await this.deleteSession(sid);
    };
  }

  async deleteSession(sid) {
    try {
      await api(`/api/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" });
      this.sessions = this.sessions.filter((s) => s.id !== sid);
      delete this.chars[sid];
      this.render();
      toast(t("parlance_conversation_deleted"));
    } catch (err) {
      toast(err.message || t("parlance_delete_error"));
    }
  }

  bodyHtml() {
    if (this.sessions === null) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("parlance_unsealing_correspondence")}</p>`;
    }
    if (this.error) {
      return `<p style="color:var(--color-sec);font-size:13px">${_esc(this.error)}</p>`;
    }
    if (!this.sessions.length) {
      return `
        <div class="parlance-empty">
          <div class="parlance-empty-mark">&sect;</div>
          <p class="parlance-empty-title">${t("parlance_empty_title")}</p>
          <p class="parlance-empty-sub">${t("parlance_empty_sub")}</p>
          <a href="/explore/characters" data-route="__seeall" onclick="event.preventDefault();navigate('/explore/characters')" class="parlance-empty-cta">${t("parlance_empty_cta")}</a>
        </div>
      `;
    }
    const visible = this.visibleSessions();
    if (!visible.length) {
      return `<p style="color:var(--color-sec);font-size:13px">${t("parlance_no_search_matches")}</p>`;
    }
    const groups = this.buildGroups(visible);
    if (!this.collapsedInit) {
      groups.forEach((g) => this.collapsed.add(g.key));
      this.collapsedInit = true;
    }
    const searching = !!this.q || this.charFilters.length > 0;
    return `<div class="parlance-list">${groups.map((g) => {
      const expanded = searching || !this.collapsed.has(g.key);
      const children = expanded ? `<div class="parlance-group-children">${g.sessions.map((s) => this.rowHtml(s)).join("")}</div>` : "";
      return `<div class="parlance-group">${this.groupHeaderHtml(g, expanded)}${children}</div>`;
    }).join("")}</div>`;
  }

  render() {
    this.main.innerHTML = `
      ${pageHeaderHtml("Chats", "Overview", t("ph_chats_title"), t("ph_chats_sub"))}
      ${this.sessions && this.sessions.length ? `
        <div id="parlanceSearchBox" style="position:relative;margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
          ${this.charFilters.map((c) => `
            <span class="inline-pill pill-creator">@${_esc(c)}<span class="x" data-remove-char="${_attr(c)}">&times;</span></span>
          `).join("")}
          <input type="text" id="parlanceSearch" value="${_attr(this.q)}" placeholder="${this.charFilters.length ? "" : _attr(t("parlance_search_placeholder"))}"
            style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
          <div id="parlanceSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
        </div>
      ` : ""}
      ${this.bodyHtml()}
    `;
    this.main.querySelectorAll("[data-remove-char]").forEach((x) => {
      x.onclick = (e) => { e.stopPropagation(); this.removeCharFilter(x.dataset.removeChar); };
    });
    const search = this.main.querySelector("#parlanceSearch");
    if (search) {
      let searchTimer;
      search.oninput = () => {
        this.updateCharSuggestions();
        if (search.value.startsWith("@")) return;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          this.q = search.value.trim();
          this.render();
        }, 250);
      };
      search.onkeydown = (e) => {
        if (e.key === "Backspace" && search.value === "" && this.charFilters.length) {
          e.preventDefault();
          this.charFilters = this.charFilters.slice(0, -1);
          this.render();
          return;
        }
        if (e.key !== "Enter") return;
        const val = search.value.trim();
        if (val.startsWith("@") && val.length > 1) {
          this.addCharFilter(val.slice(1));
          search.value = "";
          this.q = "";
        }
      };
    }
  }

  updateCharSuggestions() {
    const box = this.main.querySelector("#parlanceSuggest");
    const search = this.main.querySelector("#parlanceSearch");
    if (!box || !search) return;
    const val = search.value;
    if (!val.startsWith("@")) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const q = val.slice(1).toLowerCase();
    const matches = this.allCharNames().filter((n) => !this.charFilters.includes(n) && n.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { box.classList.remove("open"); box.innerHTML = ""; return; }
    box.innerHTML = matches.map((n) => `<button type="button" class="dropdown-item" data-pick-char="${_attr(n)}">@${_esc(n)}</button>`).join("");
    box.classList.add("open");
    box.querySelectorAll("[data-pick-char]").forEach((btn) => btn.onclick = () => {
      search.value = "";
      box.classList.remove("open");
      this.addCharFilter(btn.dataset.pickChar);
    });
  }
}
