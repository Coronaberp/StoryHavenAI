"use strict";

class GroupDetailView {
  constructor(gid) { this.gid = gid; }

  async mount(main) {
    this.main = main;
    try {
      this.group = await api(`/api/groups/${encodeURIComponent(this.gid)}`);
    } catch (err) {
      main.innerHTML = `<p style="color:var(--color-warn);font-size:13px;padding:24px">${_esc(err.message || t("group_detail_not_found", "That group couldn't be found."))}</p>`;
      return;
    }
    this.render();
  }

  render() {
    const g = this.group;
    const modeLabel = g.group_mode === "chat" ? t("group_mode_chat", "Chat") : t("group_mode_roleplay", "Roleplay");
    const cast = (g.cast || []).map((m) => {
      if (m.hidden || !m.name) {
        const lockAv = `<span class="gd-cast-av gd-cast-av-empty gd-cast-av-locked"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>`;
        const privateInner = `${lockAv}<span class="gd-cast-name">${t("group_cast_private", "Private character")}</span>`;
        return `<span class="gd-cast gd-cast-off">${privateInner}</span>`;
      }
      const initial = _esc((m.name || "?")[0].toUpperCase());
      const av = m.avatar
        ? `<span class="gd-cast-av" style="background-image:url('${_attr(m.avatar)}')"></span>`
        : `<span class="gd-cast-av gd-cast-av-empty">${initial}</span>`;
      const inner = `${av}<span class="gd-cast-name">${_esc(m.name)}</span>`;
      return m.linkable
        ? `<a class="gd-cast" href="/c/${encodeURIComponent(m.char_id)}" onclick="event.preventDefault();navigate('/c/${encodeURIComponent(m.char_id)}')">${inner}</a>`
        : `<span class="gd-cast gd-cast-off">${inner}</span>`;
    }).join("");
    const castCount = (g.cast || []).length;
    const owner = g.owner?.display_name || g.owner?.username || "";
    this.main.innerHTML = `
      <div class="gd-wrap">
        <div class="gd-head">
          <div class="gd-head-top">
            <span class="gd-badge">${modeLabel}</span>
            <span class="gd-kind">${t("group_detail_kind", "Group")}</span>
          </div>
          <h1 class="gd-title">${_esc(g.name)}</h1>
          ${owner ? `<div class="gd-owner">${t("group_detail_by", "by")} ${_esc(owner)}</div>` : ""}
        </div>
        <div class="gd-cast-block">
          <div class="gd-section-label">${t("group_detail_cast", "Cast")} <span class="gd-count">${castCount}</span></div>
          <div class="gd-cast-row">${cast}</div>
        </div>
        ${g.opening ? `<div class="gd-opening-block"><div class="gd-section-label">${t("group_detail_opening", "Opening scene")}</div><p class="gd-opening">${_esc(g.opening)}</p></div>` : ""}
        <div class="gd-actions">
          <button type="button" id="gdStart" class="pe-gen-btn gd-start">${t("group_detail_start", "Start chat")}</button>
          ${g.is_owner ? `<button type="button" id="gdEdit" class="gd-sec-btn">${t("group_detail_edit", "Edit")}</button>` : ""}
          ${g.is_owner ? `<button type="button" id="gdDelete" class="gd-sec-btn gd-sec-danger">${t("group_detail_delete", "Delete")}</button>` : ""}
        </div>
      </div>`;
    this.main.querySelector("#gdStart").onclick = () => this.start();
    const edit = this.main.querySelector("#gdEdit");
    if (edit) edit.onclick = () => this.openEdit();
    const del = this.main.querySelector("#gdDelete");
    if (del) del.onclick = () => this.remove();
  }

  async openEdit() {
    const modal = new GroupCreateModal();
    modal.editGid = this.gid;
    modal.presetName = this.group.name;
    modal.presetOpening = this.group.opening;
    modal.mode = this.group.group_mode;
    modal.presetSelected = new Set((this.group.cast || []).map((m) => m.char_id));
    await modal.open();
  }

  async start() {
    if (!ME) { navigate("/login"); return; }
    const btn = this.main.querySelector("#gdStart");
    btn.disabled = true;
    try {
      const r = await api(`/api/groups/${encodeURIComponent(this.gid)}/sessions`, { method: "POST" });
      navigate(`/chats/${r.session_id}`);
    } catch (err) {
      errorToast(err.message || t("group_detail_start_failed", "Couldn't start that chat."));
      btn.disabled = false;
    }
  }

  async remove() {
    if (!(await confirmDialog(t("group_detail_delete_confirm", "Delete this published group?"), { danger: true }))) return;
    try {
      await api(`/api/groups/${encodeURIComponent(this.gid)}`, { method: "DELETE" });
      navigate("/explore/characters");
    } catch (err) {
      errorToast(err.message || t("group_detail_delete_failed", "Couldn't delete that group."));
    }
  }
}

if (typeof window !== "undefined") window.GroupDetailView = GroupDetailView;
