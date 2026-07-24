"use strict";

function adminQueueSectionHtml(title, count, rows) {
  const empty = !rows.length;
  return `
    <div class="mb-5">
      <div class="flex items-center gap-2 mb-2.5">
        <div class="font-display font-semibold text-base text-ink">${title}</div>
        ${count > 0 ? `<span class="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style="background:var(--color-warn);color:var(--color-paper)">${count}</span>` : ""}
      </div>
      ${empty ? `<p class="text-sm text-muted py-1">${t("admin_moderation_nothing_pending")}</p>` : `
        <div class="md:hidden">${rows.map((r) => r.card).join("")}</div>
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <tbody>${rows.map((r) => r.tr).join("")}</tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function adminQueueRowHtml(bodyHtml, actionsHtml, cardOpts) {
  const cardMarkup = cardOpts
    ? `<div data-admin-card-id="${_attr(cardOpts.id)}" data-admin-queue="${_attr(cardOpts.queue)}" class="mb-2">${adminCardHtml(cardOpts)}</div>`
    : `
      <div class="flex items-start justify-between gap-3 p-3 rounded-[13px] border border-line bg-surface mb-2">
        <div class="min-w-0 flex-1">${bodyHtml}</div>
        <div class="flex flex-wrap gap-1.5 flex-none">${actionsHtml}</div>
      </div>
    `;
  return {
    card: cardMarkup,
    tr: `
      <tr class="border-b border-line align-top">
        <td class="py-2.5 pr-4">${bodyHtml}</td>
        <td class="py-2.5"><div class="flex flex-wrap gap-1.5 max-w-[320px]">${actionsHtml}</div></td>
      </tr>
    `,
  };
}

class AdminModerationView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `<div class="text-sm text-muted">${_esc(t("common_loading"))}</div>`;
    await this.load();
  }

  async load() {
    const [users, flagged, resetReqs, modelReqs, titleReqs, imageReports, contentReports, inviteCodes] = await Promise.all([
      api("/api/admin/users").catch(() => []),
      api("/api/admin/flagged-endpoints").catch(() => []),
      api("/api/admin/password-reset-requests").catch(() => []),
      api("/api/admin/model-requests").catch(() => []),
      api("/api/admin/title-requests").catch(() => []),
      api("/api/admin/image-reports").catch(() => []),
      api("/api/admin/content-reports").catch(() => []),
      api("/api/admin/invite-codes").catch(() => []),
    ]);
    this.inviteCodes = inviteCodes;
    this.pending = users.filter((u) => u.status === "pending");
    this.flagged = flagged;
    this.resetReqs = resetReqs;
    this.modelReqs = modelReqs.filter((r) => r.status === "pending" || r.status === "approved");
    this.titleReqs = titleReqs;
    this.imageReports = imageReports;
    this.contentReports = contentReports;
    this.render();
  }

  attentionTotal() {
    return this.pending.length + this.flagged.length + this.resetReqs.length +
      this.modelReqs.filter((r) => r.status === "pending").length + this.titleReqs.length +
      this.imageReports.length + this.contentReports.length;
  }

  pendingSignupsHtml() {
    const rows = this.pending.map((u) => adminQueueRowHtml(
      `<div class="font-display font-semibold text-sm text-ink">${_esc(u.username)}</div><div class="text-xs text-muted mt-0.5">${t("admin_moderation_awaiting_approval")}</div>`,
      `<button type="button" onclick="adminModerationView.approveUser('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_approve")}</button>
       <button type="button" onclick="adminModerationView.denyUser('${_attr(u.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_moderation_deny")}</button>`,
      {
        id: u.id,
        queue: "pending",
        title: u.username,
        facts: t("admin_moderation_awaiting_approval"),
        actions: [
          { id: "approve", label: t("admin_moderation_approve"), primary: true },
          { id: "deny", label: t("admin_moderation_deny") },
        ],
      }
    ));
    return adminQueueSectionHtml(t("admin_moderation_pending_signups"), this.pending.length, rows);
  }

  inviteCodesHtml() {
    const live = this.inviteCodes.filter((c) => !c.disabled && c.uses < c.max_uses
      && (!c.expires || c.expires * 1000 > Date.now()));
    const rows = this.inviteCodes.map((c) => {
      const spent = c.disabled || c.uses >= c.max_uses || (c.expires && c.expires * 1000 < Date.now());
      return adminQueueRowHtml(
        `<div class="font-mono text-sm ${spent ? "text-muted line-through" : "text-ink"}">${_esc(c.code)}</div>
         <div class="text-xs text-muted mt-0.5">${c.tier === "guest" ? "guest · " : ""}${c.uses}/${c.max_uses} used${c.expires ? " · expires " + new Date(c.expires * 1000).toLocaleDateString() : ""}${c.note ? " · " + _esc(c.note) : ""}${c.redeemed_by?.length ? " · joined: " + c.redeemed_by.map(_esc).join(", ") : ""}</div>`,
        `${spent ? "" : `<button type="button" onclick="adminModerationView.copyInviteCode('${_attr(c.code)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_invite_copy", "Copy")}</button>
         <button type="button" onclick="adminModerationView.disableInviteCode('${_attr(c.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_invite_disable", "Disable")}</button>`}
         ${spent ? `<button type="button" onclick="adminModerationView.deleteInviteCode('${_attr(c.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("admin_invite_delete", "Delete")}</button>` : ""}`
      );
    });
    const creator = `
      <div class="flex items-center gap-2 mb-2 flex-wrap">
        <select id="invTier" class="px-2 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
          <option value="full">${t("admin_invite_tier_full", "Full")}</option>
          <option value="guest">${t("admin_invite_tier_guest", "Guest")}</option>
        </select>
        <input type="number" id="invMaxUses" min="1" max="100" value="1" class="w-20 px-2 py-1.5 rounded-md border border-line bg-surface text-ink text-xs" title="${t("admin_invite_max_uses", "Max uses")}">
        <input type="number" id="invDays" min="1" max="365" placeholder="${t("admin_invite_days_ph", "days (opt.)")}" class="w-24 px-2 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
        <input type="text" id="invNote" maxlength="120" placeholder="${t("admin_invite_note_ph", "note, e.g. Discord giveaway")}" class="flex-1 min-w-[120px] px-2 py-1.5 rounded-md border border-line bg-surface text-ink text-xs">
        <button type="button" onclick="adminModerationView.createInviteCode()" class="px-3 py-1.5 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_invite_new", "New code")}</button>
      </div>`;
    return `
      <div class="mb-5">
        <div class="flex items-center gap-2 mb-2.5">
          <div class="font-display font-semibold text-base text-ink">${t("admin_invite_codes", "Invite codes")}</div>
          ${live.length ? `<span class="font-mono text-[10px] px-1.5 py-0.5 rounded-full" style="background:var(--color-surface-2);color:var(--color-sec)">${live.length}</span>` : ""}
        </div>
        ${creator}
        ${rows.length ? `
          <div class="lg:hidden">${rows.map((r) => r.card).join("")}</div>
          <div class="hidden lg:block overflow-x-auto">
            <table class="w-full text-left border-collapse"><tbody>${rows.map((r) => r.tr).join("")}</tbody></table>
          </div>
        ` : `<p class="text-sm text-muted py-1">${t("admin_invite_none", "No codes yet.")}</p>`}
      </div>
    `;
  }

  async createInviteCode() {
    const maxUses = Number(document.getElementById("invMaxUses")?.value) || 1;
    const days = Number(document.getElementById("invDays")?.value) || null;
    const note = document.getElementById("invNote")?.value?.trim() || null;
    try {
      const code = await api("/api/admin/invite-codes", {
        method: "POST",
        body: JSON.stringify({ max_uses: maxUses, expires_days: days, note,
                               tier: document.getElementById("invTier")?.value || "full" }),
      });
      await navigator.clipboard?.writeText(code.code).catch(() => {});
      toast(t("admin_invite_created", "Code created and copied: ") + code.code);
      this.load();
    } catch (e) {
      errorToast(e.message);
    }
  }

  async copyInviteCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      toast(t("admin_invite_copied", "Copied."));
    } catch {
      toast(code);
    }
  }

  async disableInviteCode(cid) {
    try {
      await api(`/api/admin/invite-codes/${encodeURIComponent(cid)}/disable`, { method: "POST" });
      this.load();
    } catch (e) {
      errorToast(e.message);
    }
  }

  async deleteInviteCode(cid) {
    try {
      await api(`/api/admin/invite-codes/${encodeURIComponent(cid)}`, { method: "DELETE" });
      this.load();
    } catch (e) {
      errorToast(e.message);
    }
  }

  flaggedEndpointsHtml() {
    const rows = this.flagged.map((fl) => adminQueueRowHtml(
      `<div class="font-mono text-xs text-ink break-all">${_esc(fl.url)}</div>
       <div class="text-xs text-muted mt-1">${_esc(fl.username || fl.user_id)} · ${_esc(fl.reason)}</div>
       ${fl.detail ? `<pre class="font-mono text-[11px] whitespace-pre-wrap break-words mt-2 p-2 rounded-md max-h-[220px] overflow-auto" style="background:var(--color-surface-2)">${_esc(fl.detail)}</pre>` : ""}`,
      `<button type="button" onclick="adminModerationView.allowEndpoint('${_attr(fl.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_moderation_allow")}</button>
       <button type="button" onclick="adminModerationView.blockEndpoint('${_attr(fl.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_moderation_block")}</button>`,
      {
        id: fl.id,
        queue: "flagged",
        title: fl.url,
        facts: `${fl.username || fl.user_id} · ${fl.reason}`,
        actions: [
          { id: "allow", label: t("admin_moderation_allow") },
          { id: "block", label: t("admin_moderation_block"), primary: true },
        ],
      }
    ));
    return adminQueueSectionHtml(t("admin_moderation_flagged_endpoints"), this.flagged.length, rows);
  }

  async approveUser(uid) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/approve`, { method: "POST" });
      toast(t("admin_moderation_user_approved"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_approve_user"));
    }
  }

  async denyUser(uid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_deny_signup"), { confirmLabel: t("admin_moderation_deny") }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(uid)}/deny`, { method: "POST" });
      toast(t("admin_moderation_user_denied"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_deny_user"));
    }
  }

  async allowEndpoint(fid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_allow_endpoint"), { confirmLabel: t("admin_moderation_allow"), danger: false }))) return;
    try {
      await api(`/api/admin/flagged-endpoints/${encodeURIComponent(fid)}/allow`, { method: "POST" });
      toast(t("admin_moderation_endpoint_allowed"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_allow_endpoint"));
    }
  }

  async blockEndpoint(fid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_block_endpoint"), { confirmLabel: t("admin_moderation_block") }))) return;
    try {
      await api(`/api/admin/flagged-endpoints/${encodeURIComponent(fid)}/block`, { method: "POST" });
      toast(t("admin_moderation_endpoint_blocked"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_block_endpoint"));
    }
  }
}

const ADMIN_MR_TYPE_LABELS = { lora: "LoRA", upscaler: "Upscaler", anima: "Anima", wan: "Wan Video" };
const ADMIN_MR_SUBDIRS = { checkpoint: "checkpoints", lora: "loras", upscaler: "upscale_models", anima: "diffusion_models", wan: "diffusion_models" };
const ADMIN_MR_BASE_DIR = "/var/mnt/storage/podman/volumes/sillytavern_comfyui_models/_data";
const ADMIN_MR_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function adminMrExtFor(url, reqType) {
  const knownExts = [".safetensors", ".ckpt", ".pt", ".pth"];
  let urlPath;
  try { urlPath = new URL(url).pathname.toLowerCase(); } catch (e) { urlPath = url.toLowerCase(); }
  return knownExts.find((ext) => urlPath.endsWith(ext)) || (reqType === "upscaler" ? ".pth" : ".safetensors");
}

function shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function adminMrDownloadBlock(dir, url, fname, apiKey) {
  const tmp = fname + ".dl";
  const extractDir = fname + "_extract";
  const authPart = apiKey ? ` -H ${shQuote("Authorization: Bearer " + apiKey)}` : "";
  return `cd ${shQuote(ADMIN_MR_BASE_DIR + "/" + dir)} && sudo curl -L -A ${shQuote(ADMIN_MR_UA)}${authPart} ${shQuote(url)} -o ${shQuote(tmp)} && ` +
    `if [ "$(head -c2 ${shQuote(tmp)} 2>/dev/null)" = "PK" ] && ! unzip -l ${shQuote(tmp)} 2>/dev/null | grep -q '/data\\.pkl$'; then ` +
      `sudo mkdir -p ${shQuote(extractDir)} && sudo unzip -o ${shQuote(tmp)} -d ${shQuote(extractDir)} && ` +
      `sudo find ${shQuote(extractDir)} -type f \\( -iname "*.safetensors" -o -iname "*.ckpt" -o -iname "*.pt" -o -iname "*.pth" \\) -exec mv {} . \\; && ` +
      `sudo chown 525287:525287 *.safetensors *.ckpt *.pt *.pth 2>/dev/null; ` +
      `sudo rm -rf ${shQuote(tmp)} ${shQuote(extractDir)}; ` +
    `else ` +
      `sudo mv ${shQuote(tmp)} ${shQuote(fname)} && sudo chown 525287:525287 ${shQuote(fname)}; ` +
    `fi`;
}

Object.assign(AdminModerationView.prototype, {
  passwordResetsHtml() {
    const rows = this.resetReqs.map((r) => adminQueueRowHtml(
      `<div class="font-display font-semibold text-sm text-ink">${_esc(r.username)}</div>
       <div class="font-mono text-xs text-muted mt-0.5">${t("admin_moderation_requested")} ${_esc(new Date(r.created * 1000).toLocaleString())}</div>`,
      `<button type="button" onclick="adminModerationView.approveResetRequest('${_attr(r.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_approve")}</button>
       <button type="button" onclick="adminModerationView.denyResetRequest('${_attr(r.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_moderation_deny")}</button>`,
      {
        id: r.id,
        queue: "resets",
        title: r.username,
        facts: `${t("admin_moderation_requested")} ${new Date(r.created * 1000).toLocaleString()}`,
        actions: [
          { id: "approve", label: t("admin_moderation_approve"), primary: true },
          { id: "deny", label: t("admin_moderation_deny") },
        ],
      }
    ));
    return adminQueueSectionHtml(t("admin_moderation_password_reset_requests"), this.resetReqs.length, rows);
  },

  modelRequestsHtml() {
    const rows = this.modelReqs.map((mr) => {
      const typeLabel = ADMIN_MR_TYPE_LABELS[mr.request_type] || t("admin_moderation_model");
      const actions = [];
      if (mr.status === "pending") {
        actions.push(`<button type="button" onclick="adminModerationView.approveModelRequest('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_approve")}</button>`);
        actions.push(`<button type="button" onclick="adminModerationView.rejectModelRequest('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_moderation_reject")}</button>`);
      }
      if (ME.role === "dev" && mr.status === "approved") {
        actions.push(`<button type="button" onclick="adminModerationView.copyModelRequestCurl('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_moderation_copy_curl")}</button>`);
      }
      if (mr.status === "approved") {
        actions.push(`<button type="button" onclick="adminModerationView.completeModelRequest('${_attr(mr.id)}')" class="px-2.5 py-1 rounded-md border border-line text-xs text-ink">${t("admin_moderation_done")}</button>`);
      }
      const cardActions = [];
      if (mr.status === "pending") {
        cardActions.push({ id: "approve", label: t("admin_moderation_approve"), primary: true });
        cardActions.push({ id: "reject", label: t("admin_moderation_reject") });
      }
      if (ME.role === "dev" && mr.status === "approved") {
        cardActions.push({ id: "copy_curl", label: t("admin_moderation_copy_curl") });
      }
      if (mr.status === "approved") {
        cardActions.push({ id: "complete", label: t("admin_moderation_done") });
      }
      return adminQueueRowHtml(
        `<div class="font-display font-semibold text-sm text-ink">
           <span class="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded-md mr-1" style="background:var(--color-surface-2);color:var(--color-muted)">${_esc(typeLabel)}</span>
           ${_esc(mr.model_name)}
         </div>
         <div class="text-xs text-muted mt-1">${_esc(mr.username || mr.user_id)} · <a href="${_attr(mr.source_url)}" target="_blank" rel="noopener noreferrer" class="font-mono underline">${_esc(mr.source_url)}</a>${mr.note ? ` · ${_esc(mr.note)}` : ""}</div>`,
        actions.join(""),
        {
          id: mr.id,
          queue: "models",
          title: mr.model_name,
          pill: typeLabel,
          facts: `${mr.username || mr.user_id} · ${mr.source_url}${mr.note ? " · " + mr.note : ""}`,
          actions: cardActions,
        }
      );
    });
    return adminQueueSectionHtml(t("admin_moderation_model_requests"), this.modelReqs.filter((r) => r.status === "pending").length, rows);
  },
});

Object.assign(AdminModerationView.prototype, {
  async approveResetRequest(rid) {
    try {
      const r = await api(`/api/admin/password-reset-requests/${encodeURIComponent(rid)}/approve`, { method: "POST" });
      openModal(`
        <h3>${t("admin_moderation_new_password")}</h3>
        <p class="text-sm text-sec mb-3">${t("admin_moderation_give_this_to")} ${_esc(r.username)}:</p>
        <input type="text" readonly value="${_attr(r.password)}" class="w-full font-mono text-sm px-2.5 py-2 rounded-md border border-line bg-surface text-ink mb-3">
        <button type="button" id="reset_pw_copy" class="w-full py-2.5 rounded-xl border border-line text-sm text-ink">${t("admin_moderation_copy")}</button>
      `);
      document.getElementById("reset_pw_copy").onclick = () => {
        navigator.clipboard?.writeText(r.password);
        toast(t("admin_moderation_copied"));
      };
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_approve_reset"));
    }
  },

  async denyResetRequest(rid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_deny_reset"), { confirmLabel: t("admin_moderation_deny") }))) return;
    try {
      await api(`/api/admin/password-reset-requests/${encodeURIComponent(rid)}/deny`, { method: "POST" });
      toast(t("admin_moderation_request_denied"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_deny_request"));
    }
  },

  async approveModelRequest(rid) {
    try {
      await api(`/api/admin/model-requests/${encodeURIComponent(rid)}/approve`, { method: "POST" });
      toast(t("admin_moderation_model_request_approved"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_approve_model_request"));
    }
  },

  async rejectModelRequest(rid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_reject_model_request"), { confirmLabel: t("admin_moderation_reject") }))) return;
    try {
      await api(`/api/admin/model-requests/${encodeURIComponent(rid)}/reject`, { method: "POST" });
      toast(t("admin_moderation_model_request_rejected"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_reject_model_request"));
    }
  },

  async completeModelRequest(rid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_mark_installed"), { confirmLabel: t("admin_moderation_mark_installed"), danger: false }))) return;
    try {
      await api(`/api/admin/model-requests/${encodeURIComponent(rid)}/complete`, { method: "POST" });
      toast(t("admin_moderation_marked_installed"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_mark_done"));
    }
  },

  copyModelRequestCurl(rid) {
    const mr = this.modelReqs.find((r) => r.id === rid);
    if (!mr) return;
    const type = mr.request_type || "checkpoint";
    const base = (mr.model_name || "model").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "model";
    const subdir = ADMIN_MR_SUBDIRS[type] || "checkpoints";
    const slug = base + adminMrExtFor(mr.source_url, type);
    const cmds = [adminMrDownloadBlock(subdir, mr.source_url, slug, mr.resolved_api_key)];
    if ((type === "anima" || type === "wan") && mr.vae_url) cmds.push(adminMrDownloadBlock("vae", mr.vae_url, base + "_vae" + adminMrExtFor(mr.vae_url, type), mr.resolved_vae_api_key));
    if ((type === "anima" || type === "wan") && mr.text_encoder_url) cmds.push(adminMrDownloadBlock("text_encoders", mr.text_encoder_url, base + "_text_encoder" + adminMrExtFor(mr.text_encoder_url, type), mr.resolved_text_encoder_api_key));
    navigator.clipboard?.writeText(cmds.join(" && "));
    toast(t("admin_moderation_command_copied"));
  },
});

Object.assign(AdminModerationView.prototype, {
  titleRequestsHtml() {
    const rows = this.titleReqs.map((tr) => adminQueueRowHtml(
      `<div class="font-display font-semibold text-sm text-ink">"${_esc(tr.title || "")}" - ${_esc(tr.display_name || tr.username)}</div>
       <div class="text-xs text-muted mt-0.5">${t("admin_moderation_requested_by")} @${_esc(tr.username)}</div>`,
      `<button type="button" onclick="adminModerationView.approveTitleRequest('${_attr(tr.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_approve")}</button>
       <button type="button" onclick="adminModerationView.rejectTitleRequest('${_attr(tr.id)}')" class="px-2.5 py-1 rounded-md border text-xs" style="border-color:var(--color-warn);color:var(--color-warn)">${t("admin_moderation_reject")}</button>`,
      {
        id: tr.id,
        queue: "titles",
        title: `"${tr.title || ""}" - ${tr.display_name || tr.username}`,
        facts: `${t("admin_moderation_requested_by")} @${tr.username}`,
        actions: [
          { id: "approve", label: t("admin_moderation_approve"), primary: true },
          { id: "reject", label: t("admin_moderation_reject") },
        ],
      }
    ));
    return adminQueueSectionHtml(t("admin_moderation_title_requests"), this.titleReqs.length, rows);
  },

  imageReportsHtml() {
    const rows = this.imageReports.map((ir) => adminQueueRowHtml(
      `<div class="flex gap-3 items-center">
         ${ir.image ? `<img src="${_attr(ir.image)}" alt="" class="w-14 h-14 rounded-lg object-cover flex-none">` : ""}
         <div class="min-w-0">
           <div class="text-sm text-ink">${t("admin_moderation_claimed")}: ${ir.claimed_explicit ? t("admin_moderation_nsfw") : t("admin_moderation_sfw")} <span class="text-muted text-xs">(${t("admin_moderation_current")}: ${ir.current_explicit ? t("admin_moderation_nsfw") : t("admin_moderation_sfw")})</span></div>
           <div class="text-xs text-muted mt-0.5">${_esc(ir.reporter_username || ir.reporter_id)}${ir.note ? ` · ${_esc(ir.note)}` : ""}</div>
         </div>
       </div>`,
      `<button type="button" onclick="adminModerationView.reviewImageReport('${_attr(ir.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_review")}</button>`,
      {
        id: ir.id,
        queue: "imageReports",
        title: `${t("admin_moderation_claimed")}: ${ir.claimed_explicit ? t("admin_moderation_nsfw") : t("admin_moderation_sfw")}`,
        pill: ir.current_explicit ? t("admin_moderation_nsfw") : t("admin_moderation_sfw"),
        facts: `${ir.reporter_username || ir.reporter_id}${ir.note ? " · " + ir.note : ""}`,
        actions: [{ id: "review", label: t("admin_moderation_review"), primary: true }],
      }
    ));
    return adminQueueSectionHtml(t("admin_moderation_image_reports"), this.imageReports.length, rows);
  },

  contentReportsHtml() {
    const rows = this.contentReports.map((cr) => adminQueueRowHtml(
      `<div class="flex gap-3 items-center">
         ${cr.image ? `<img src="${_attr(cr.image)}" alt="" class="w-14 h-14 rounded-lg object-cover flex-none">` : ""}
         <div class="min-w-0">
           <div class="text-sm text-ink">${_esc(cr.label || cr.kind)}</div>
           <div class="text-xs text-muted mt-0.5">${_esc(cr.reporter_username || cr.reporter_id)}${cr.note ? ` · ${_esc(cr.note)}` : ""}</div>
         </div>
       </div>`,
      `<button type="button" onclick="adminModerationView.reviewContentReport('${_attr(cr.id)}')" class="px-2.5 py-1 rounded-md text-xs text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_review")}</button>`,
      {
        id: cr.id,
        queue: "contentReports",
        title: cr.label || cr.kind,
        facts: `${cr.reporter_username || cr.reporter_id}${cr.note ? " · " + cr.note : ""}`,
        actions: [{ id: "review", label: t("admin_moderation_review"), primary: true }],
      }
    ));
    return adminQueueSectionHtml(t("admin_moderation_content_reports"), this.contentReports.length, rows);
  },
});

Object.assign(AdminModerationView.prototype, {
  async approveTitleRequest(uid) {
    try {
      await api(`/api/admin/title-requests/${encodeURIComponent(uid)}/approve`, { method: "POST" });
      toast(t("admin_moderation_title_approved"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_approve_title"));
    }
  },

  async rejectTitleRequest(uid) {
    if (!(await confirmDialog(t("admin_moderation_confirm_reject_title"), { confirmLabel: t("admin_moderation_reject") }))) return;
    try {
      await api(`/api/admin/title-requests/${encodeURIComponent(uid)}/reject`, { method: "POST" });
      toast(t("admin_moderation_title_rejected"));
      await this.load();
    } catch (e) {
      errorToast(e.message || t("admin_moderation_couldnt_reject_title"));
    }
  },

  reviewImageReport(rid) {
    const report = this.imageReports.find((r) => r.id === rid);
    if (!report) return;
    openModal(`
      <h3>${t("admin_moderation_review_image_report")}</h3>
      ${report.image ? `<img src="${_attr(report.image)}" alt="" class="w-full max-h-[420px] object-contain rounded-lg border border-line bg-surface-2 mb-3">` : `<p class="text-xs text-muted mb-3">${t("admin_moderation_image_no_longer_exists")}</p>`}
      <p class="text-sm text-sec mb-3">${t("admin_moderation_claimed")}: ${report.claimed_explicit ? t("admin_moderation_nsfw") : t("admin_moderation_sfw")} · ${t("admin_moderation_current")}: ${report.current_explicit ? t("admin_moderation_nsfw") : t("admin_moderation_sfw")}</p>
      <label class="flex items-center gap-2.5 mb-3 text-sm text-ink">
        <input type="checkbox" id="ir_explicit" ${report.current_explicit ? "checked" : ""}>
        ${t("admin_moderation_mark_as_explicit")}
      </label>
      <textarea id="ir_note" placeholder="${t("admin_moderation_admin_note_optional")}" class="w-full px-2.5 py-2 rounded-md border border-line bg-surface text-ink text-sm mb-3" style="min-height:60px"></textarea>
      <button type="button" id="ir_submit" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_save")}</button>
    `);
    document.getElementById("ir_submit").onclick = async () => {
      const isExplicit = document.getElementById("ir_explicit").checked;
      const adminNote = document.getElementById("ir_note").value.trim() || null;
      try {
        await api(`/api/admin/image-reports/${encodeURIComponent(rid)}/resolve`, { method: "POST", body: JSON.stringify({ is_explicit: isExplicit, admin_note: adminNote }) });
        toast(t("admin_moderation_report_resolved"));
        closeTopModal();
        await this.load();
      } catch (e) {
        errorToast(e.message || t("admin_moderation_couldnt_resolve_report"));
      }
    };
  },

  reviewContentReport(rid) {
    const report = this.contentReports.find((r) => r.id === rid);
    if (!report) return;
    openModal(`
      <h3>${t("admin_moderation_review_content_report")}</h3>
      ${report.image ? `<img src="${_attr(report.image)}" alt="" class="w-full max-h-[420px] object-contain rounded-lg border border-line bg-surface-2 mb-3">` : `<p class="text-xs text-muted mb-3">${t("admin_moderation_image_no_longer_exists")}</p>`}
      <p class="text-sm text-sec mb-3">${_esc(report.label || report.kind)}</p>
      <label class="flex items-center gap-2.5 mb-4 text-sm text-ink">
        <input type="checkbox" id="cr_explicit">
        ${t("admin_moderation_mark_as_explicit")}
      </label>
      <button type="button" id="cr_submit" class="w-full py-2.5 rounded-xl font-semibold text-sm text-paper bg-gradient-to-br from-primary to-primary-dark">${t("admin_moderation_save")}</button>
    `);
    document.getElementById("cr_submit").onclick = async () => {
      const isExplicit = document.getElementById("cr_explicit").checked;
      try {
        await api(`/api/admin/content-reports/${encodeURIComponent(rid)}/resolve`, { method: "POST", body: JSON.stringify({ is_explicit: isExplicit }) });
        toast(t("admin_moderation_report_resolved"));
        closeTopModal();
        await this.load();
      } catch (e) {
        errorToast(e.message || t("admin_moderation_couldnt_resolve_report"));
      }
    };
  },
});

AdminModerationView.prototype.mobileCardActionMap = function () {
  return {
    pending: { approve: (id) => this.approveUser(id), deny: (id) => this.denyUser(id) },
    flagged: { allow: (id) => this.allowEndpoint(id), block: (id) => this.blockEndpoint(id) },
    resets: { approve: (id) => this.approveResetRequest(id), deny: (id) => this.denyResetRequest(id) },
    models: {
      approve: (id) => this.approveModelRequest(id),
      reject: (id) => this.rejectModelRequest(id),
      copy_curl: (id) => this.copyModelRequestCurl(id),
      complete: (id) => this.completeModelRequest(id),
    },
    titles: { approve: (id) => this.approveTitleRequest(id), reject: (id) => this.rejectTitleRequest(id) },
    imageReports: { review: (id) => this.reviewImageReport(id) },
    contentReports: { review: (id) => this.reviewContentReport(id) },
  };
};

AdminModerationView.prototype.attachMobileCardActions = function () {
  const actionMap = this.mobileCardActionMap();
  this.main.querySelectorAll("[data-admin-card-id]").forEach((card) => {
    const queue = card.dataset.adminQueue;
    const id = card.dataset.adminCardId;
    const handlers = actionMap[queue];
    if (!handlers) return;
    card.querySelectorAll("[data-admin-action]").forEach((btn) => {
      const handler = handlers[btn.dataset.adminAction];
      if (!handler) return;
      btn.onclick = () => handler(id);
    });
  });
};

AdminModerationView.prototype.render = function () {
  this.main.innerHTML = `
    <div class="content-col admin-moderation-content">
    ${adminScreenSwitcherHtml("admin-moderation", window._adminSwitcherBadges || {})}
    ${backLinkHtml("Admin")}
    ${pageHeaderHtml("My Dossier", "Admin", t("ph_admin_moderation_title"), `${this.attentionTotal()} items need attention`)}
    ${this.pendingSignupsHtml()}
    ${this.inviteCodesHtml()}
    ${this.flaggedEndpointsHtml()}
    ${this.passwordResetsHtml()}
    ${this.modelRequestsHtml()}
    ${this.titleRequestsHtml()}
    ${this.imageReportsHtml()}
    ${this.contentReportsHtml()}
    </div>
  `;
  adminAttachScreenSwitcher(this.main);
  this.attachMobileCardActions();
};

if (typeof window !== "undefined") {
  window.AdminModerationView = AdminModerationView;
}
