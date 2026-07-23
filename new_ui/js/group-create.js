"use strict";

class GroupCreateModal {
  constructor() {
    this.chars = [];
    this.selected = new Set();
    this.loading = true;
    this.mode = "roleplay";
  }

  _paintMode() {
    this.layer.querySelectorAll(".grp-mode-btn").forEach((b) => {
      const on = b.dataset.mode === this.mode;
      b.style.borderColor = on ? "var(--color-accent)" : "var(--color-line-2)";
      b.style.background = on ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "var(--color-surface-2)";
    });
    const chat = this.mode === "chat";
    this.layer.querySelector("#grpOpening").style.display = chat ? "none" : "";
    this.layer.querySelector("#grpChatNote").style.display = chat ? "" : "none";
    this.validate();
  }

  async open() {
    if (this.editGid) this.selected = this.presetSelected || new Set();
    this.layer = openModal(this.html(), { wide: true });
    this.layer.querySelector("#grpCreate").onclick = () => this.create();
    const opening = this.layer.querySelector("#grpOpening");
    const grow = () => { opening.style.height = "auto"; opening.style.height = Math.min(opening.scrollHeight, 220) + "px"; };
    opening.addEventListener("input", () => { grow(); this.validate(); });
    this.layer.querySelector("#grpName").addEventListener("input", () => this.validate());
    this.layer.querySelectorAll(".grp-mode-btn").forEach((b) => {
      b.onclick = () => { this.mode = b.dataset.mode; this._paintMode(); };
    });
    if (this.editGid) {
      this.layer.querySelector("#grpName").value = this.presetName || "";
      this.layer.querySelector("#grpOpening").value = this.presetOpening || "";
      this.layer.querySelector("#grpCreate").textContent = t("group_detail_save", "Save changes");
    }
    this._paintMode();
    grow();
    this.validate();
    try {
      const [community, mine] = await Promise.all([
        api("/api/characters?scope=community").catch(() => []),
        api("/api/characters?scope=mine").catch(() => []),
      ]);
      const seen = new Set();
      const all = [];
      for (const c of [...mine, ...community]) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        if (c.kind !== "group" && (c.mode || "character") !== "rpg") all.push(c);
      }
      this.chars = all;
    } catch (err) {
      console.warn("group picker load failed", err);
    }
    this.loading = false;
    this.renderGrid();
  }

  html() {
    return `
      <div style="display:flex;flex-direction:column;gap:13px;max-height:80vh">
        <div>
          <div class="font-display" style="font-size:19px;font-weight:600;color:var(--color-ink)">${t("group_create_title", "New group chat")}</div>
          <div style="font-size:12.5px;color:var(--color-sec);margin-top:2px">${t("group_create_sub", "Pick 2 to 4 characters. A group name and an opening message are required.")}</div>
        </div>
        <input id="grpName" type="text" maxlength="80" placeholder="${_attr(t("group_create_name_ph", "Group name"))}"
          style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:14px">
        <textarea id="grpOpening" rows="2" maxlength="2000" placeholder="${_attr(t("group_create_opening_ph", "Opening message that sets the scene. Each character's own greeting is ignored."))}"
          style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;resize:none"></textarea>
        <div id="grpChatNote" style="display:none;border:1px dashed var(--color-line-2);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--color-sec);background:var(--color-surface-2)">${t("group_chat_scene_note", "You're in a chat room with these characters. Only dialogue and commands are allowed.")}</div>
        <div style="display:flex;gap:8px">
          ${["roleplay", "chat"].map((m) => `
            <button type="button" class="grp-mode-btn" data-mode="${m}"
              style="flex:1;text-align:left;border:1px solid ${this.mode === m ? "var(--color-accent)" : "var(--color-line-2)"};background:${this.mode === m ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "var(--color-surface-2)"};border-radius:11px;padding:9px 11px;cursor:pointer">
              <div class="font-display" style="font-weight:600;font-size:13.5px;color:var(--color-ink)">${m === "roleplay" ? t("group_mode_roleplay", "Roleplay") : t("group_mode_chat", "Chat")}</div>
              <div style="font-size:11px;color:var(--color-sec);margin-top:1px">${m === "roleplay" ? t("group_mode_roleplay_desc", "Actions and dialogue, told with narration.") : t("group_mode_chat_desc", "Dialogue only. Actions are ignored.")}</div>
            </button>`).join("")}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="font-mono" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted)">${t("group_create_cast", "Cast")}</span>
          <span id="grpCount" class="font-mono" style="font-size:11px;color:var(--color-accent)">0 / 4</span>
        </div>
        <div id="grpGrid" style="flex:1;min-height:120px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));align-content:start;gap:10px;padding-right:2px">
          <div style="color:var(--color-muted);font-size:12px">${t("common_loading", "Loading…")}</div>
        </div>
        <button type="button" id="grpCreate" data-feature="group_chats" class="pe-gen-btn" style="width:100%;justify-content:center" disabled>${t("group_create_confirm", "Create group")}</button>
      </div>`;
  }

  tile(c) {
    const hue = [...c.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const art = c.avatar
      ? `background-image:url('${_attr(c.avatar)}')`
      : `background:linear-gradient(150deg,hsl(${hue} 55% 38%),hsl(${(hue + 40) % 360} 45% 16%))`;
    const on = this.selected.has(c.id);
    return `
      <button type="button" class="grp-tile" data-cid="${_attr(c.id)}"
        style="position:relative;display:block;width:100%;border:none;background:none;padding:0;cursor:pointer">
        <div style="width:100%;aspect-ratio:3/4"></div>
        <div style="position:absolute;inset:0;border:2px solid ${on ? "var(--color-accent)" : "var(--color-line-2)"};border-radius:12px;overflow:hidden">
          <div style="position:absolute;inset:0;${art};background-size:cover;background-position:center"></div>
          <div style="position:absolute;inset:0;background:linear-gradient(to top, rgba(0,0,0,.85), transparent 55%)"></div>
          <div style="position:absolute;left:6px;right:6px;bottom:6px;text-align:left;color:#fff;font-size:12px;font-weight:600;line-height:1.15">${_esc(c.name)}</div>
          ${on ? `<div style="position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;background:var(--color-accent);color:#12100c;display:grid;place-items:center;font-size:13px">✓</div>` : ""}
        </div>
      </button>`;
  }

  renderGrid() {
    const grid = this.layer.querySelector("#grpGrid");
    if (!grid) return;
    if (this.loading) return;
    if (!this.chars.length) {
      grid.innerHTML = `<div style="color:var(--color-muted);font-size:12px">${t("group_create_none", "No characters available.")}</div>`;
      return;
    }
    grid.innerHTML = this.chars.map((c) => this.tile(c)).join("");
    grid.querySelectorAll(".grp-tile").forEach((el) => { el.onclick = () => this.toggle(el.dataset.cid); });
    this.updateCount();
  }

  toggle(cid) {
    if (this.selected.has(cid)) {
      this.selected.delete(cid);
    } else if (this.selected.size >= 4) {
      errorToast(t("group_create_max", "Up to 4 characters in a group."));
      return;
    } else {
      this.selected.add(cid);
    }
    this.renderGrid();
  }

  updateCount() {
    this.layer.querySelector("#grpCount").textContent = `${this.selected.size} / 4`;
    this.validate();
  }

  validate() {
    const name = this.layer.querySelector("#grpName").value.trim();
    const opening = this.layer.querySelector("#grpOpening").value.trim();
    const openingOk = this.mode === "chat" || !!opening;
    this.layer.querySelector("#grpCreate").disabled = !(this.selected.size >= 2 && name && openingOk);
  }

  async create() {
    const name = this.layer.querySelector("#grpName").value.trim();
    const chat = this.mode === "chat";
    const opening = chat ? "" : this.layer.querySelector("#grpOpening").value.trim();
    const char_ids = [...this.selected];
    if (char_ids.length < 2) {
      errorToast(t("group_create_need_two", "Pick at least 2 characters."));
      return;
    }
    if (!name || (!chat && !opening)) {
      errorToast(chat ? t("group_create_need_name", "A group needs a name.") : t("group_create_need_name_opening", "A group needs a name and an opening message."));
      return;
    }
    const btn = this.layer.querySelector("#grpCreate");
    btn.disabled = true;
    const busyLabel = this.editGid ? t("group_detail_saving", "Saving…") : t("group_create_creating", "Creating…");
    const idleLabel = this.editGid ? t("group_detail_save", "Save changes") : t("group_create_confirm", "Create group");
    btn.textContent = busyLabel;
    try {
      if (this.editGid) {
        await api(`/api/groups/${encodeURIComponent(this.editGid)}`, { method: "PUT", body: JSON.stringify({ name, opening, char_ids, mode: this.mode }) });
        closeTopModal();
        navigate(`/g/${encodeURIComponent(this.editGid)}`);
        return;
      }
      const r = await api("/api/group-chats", { method: "POST", body: JSON.stringify({ name, opening, char_ids, mode: this.mode }) });
      closeTopModal();
      navigate(`/chats/${r.session_id}`);
    } catch (err) {
      errorToast(err.message || (this.editGid ? t("group_detail_save_failed", "Couldn't save that group.") : t("group_create_failed", "Couldn't create the group.")));
      btn.disabled = false;
      btn.textContent = idleLabel;
    }
  }
}

function openGroupCreate() {
  new GroupCreateModal().open();
}
