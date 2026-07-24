"use strict";

class AdminAnnouncePanel {
  async mount(main) {
    this.main = main;
    this.render();
  }

  render() {
    this.main.innerHTML = `
      <div class="content-col">
      ${backLinkHtml("Admin")}
      ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_announce_title", "Announcements"), t("ph_admin_announce_sub", "Send a notification to every active user."))}
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_title", "Title")}</span>
          <input type="text" id="announceTitle" maxlength="120" class="px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="${_attr(t("admin_announce_title_placeholder", "Service degraded"))}">
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_message", "Message")}</span>
          <textarea id="announceBody" rows="4" maxlength="1000" class="px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="${_attr(t("admin_announce_body_placeholder", "What happened, what still works, and when you expect it fixed."))}"></textarea>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-[.1em] uppercase text-muted">${t("admin_announce_field_link", "Link (optional)")}</span>
          <input type="text" id="announceLink" maxlength="300" class="px-3 py-2 rounded-[10px] border border-line bg-surface text-sm text-ink" placeholder="/forum">
        </label>
        <div class="flex justify-end">
          <button type="button" id="announceSend" class="pe-gen-btn">${t("admin_announce_send", "Send to all users")}</button>
        </div>
      </div>
      </div>
    `;
    this.main.querySelector("#announceSend").onclick = () => this.confirmAndSend();
  }

  async confirmAndSend() {
    const title = this.main.querySelector("#announceTitle").value.trim();
    const body = this.main.querySelector("#announceBody").value.trim();
    const link = this.main.querySelector("#announceLink").value.trim();
    if (!title) {
      errorToast(t("admin_announce_title_required", "A title is required."));
      return;
    }
    const count = await api("/api/admin/feature-flags/active-user-count").catch(() => null);
    const countText = count ? `${count.count} ` : "";
    const confirmed = await new Promise((resolve) => {
      const layer = openModal(`
        <div style="padding:4px 2px">
          <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("admin_announce_confirm_title", "Send this announcement?")}</h3>
          <div style="font-size:13px;color:var(--color-sec);margin:0 0 6px">${t("admin_announce_confirm_body", "It will notify")} ${countText}${t("admin_announce_confirm_body_tail", "active users and cannot be unsent.")}</div>
          <div style="font-size:13px;color:var(--color-ink);border:1px solid var(--color-line);border-radius:10px;padding:10px;margin:0 0 16px">
            <div style="font-weight:600">${_esc(title)}</div>
            ${body ? `<div style="margin-top:4px;color:var(--color-sec)">${_esc(body)}</div>` : ""}
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" id="announceConfirmCancel" class="pe-gen-btn">${t("modal_cancel", "Cancel")}</button>
            <button type="button" id="announceConfirmSend" class="pe-gen-btn">${t("admin_announce_send", "Send to all users")}</button>
          </div>
        </div>
      `, { dismissible: false });
      layer.querySelector("#announceConfirmCancel").onclick = () => { closeModal(layer); resolve(false); };
      layer.querySelector("#announceConfirmSend").onclick = () => { closeModal(layer); resolve(true); };
    });
    if (!confirmed) return;
    try {
      const result = await api("/api/admin/announce", { method: "POST", body: JSON.stringify({ title, body, link }) });
      toast(`${t("admin_announce_sent", "Announcement sent to")} ${result.sent} ${t("admin_announce_sent_tail", "users.")}`);
      this.main.querySelector("#announceTitle").value = "";
      this.main.querySelector("#announceBody").value = "";
      this.main.querySelector("#announceLink").value = "";
    } catch (err) {
      errorToast(err.message || t("admin_announce_failed", "The announcement could not be sent."));
    }
  }
}

if (typeof window !== "undefined") {
  window.AdminAnnouncePanel = AdminAnnouncePanel;
}
