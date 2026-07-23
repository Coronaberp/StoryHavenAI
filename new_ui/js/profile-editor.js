"use strict";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PE_GEN_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>`;

const PROFILE_EDITOR_PLACEHOLDERS = [
  "{{display_name}}", "{{bio}}", "{{rank}}", "{{title}}", "{{avatar_url}}", "{{banner_url}}",
  "{{character_count}}", "{{chat_count}}", "{{member_since}}", "{{characters}}", "{{links}}",
  "{{share}}", "{{edit}}", "{{comments}}", "{{block}}", "{{report}}", "{{follow}}",
];

function _profileEditorFieldLabel(label, hint) {
  return `
    <label class="block font-mono text-[9px] tracking-[.18em] uppercase text-muted mb-1.5">${label}</label>
    ${hint ? `<p class="text-[11px] text-sec mb-1.5">${hint}</p>` : ""}
  `;
}

function _profileEditorTextInput(id, value, placeholder = "") {
  return `<input type="text" id="${id}" value="${_esc(value || "")}" placeholder="${_esc(placeholder)}"
    class="w-full py-2 px-0.5 bg-transparent text-ink text-sm outline-none border-0 border-b-[1.5px] border-line-2 focus:border-primary transition-colors">`;
}

function _profileEditorSocialRow(sp, links) {
  return `
    <div class="mb-3">
      <label class="block font-mono text-[9px] tracking-[.18em] uppercase text-muted mb-1.5">${sp.key}</label>
      <input type="text" id="pe_soc_${sp.key}" value="${_esc(links?.[sp.key] || "")}" placeholder="${_esc(sp.ph || "")}"
        class="w-full py-2 px-0.5 bg-transparent text-ink text-sm outline-none border-0 border-b-[1.5px] border-line-2 focus:border-primary transition-colors">
    </div>
  `;
}

function openProfileEditor(p, onSave) {
  const layer = openModal(`
    <h3>${t("profile_edit_profile")}</h3>
    <p style="margin:-6px 0 14px;font-style:italic;font-size:13px;color:var(--color-sec)">${t("profile_how_archive_sees_you")}</p>

    <div class="mb-4">${_profileEditorFieldLabel(t("profile_display_name"))}${_profileEditorTextInput("pe_dn", p.display_name)}</div>
    <div class="mb-4">
      <label class="block font-mono text-[9px] tracking-[.18em] uppercase text-muted mb-1.5">${t("profile_bio")}</label>
      <textarea id="pe_bio" rows="3" placeholder="${t("profile_bio_placeholder")}"
        class="w-full py-2 px-2 rounded-lg text-ink text-sm outline-none border border-line-2 bg-surface-2 focus:border-primary transition-colors resize-y">${_esc(p.bio || "")}</textarea>
    </div>
    <div class="mb-5">
      ${_profileEditorFieldLabel(t("profile_custom_title"), t("profile_custom_title_hint"))}
      ${_profileEditorTextInput("pe_title", p.title_status === "approved" ? p.title : (p.title || ""))}
      ${p.title_status === "pending" ? `<p class="text-[11px] mt-1" style="color:var(--color-accent)">${t("profile_pending_admin_approval")}</p>` : ""}
    </div>

    <div class="mb-5">
      <div class="flex items-baseline gap-2 mb-2">
        <label class="font-mono text-[9px] tracking-[.18em] uppercase text-muted">${t("profile_change_avatar")}</label>
        <span class="text-[11px] text-sec">${t("profile_avatar_hint")}</span>
      </div>
      <div class="flex gap-2.5 items-start">
        <div id="pe_avatar_box" data-feature="profile" class="relative flex-none rounded-full overflow-hidden cursor-pointer"
          style="width:64px;height:64px;border:1.5px dashed var(--color-line-2);background:var(--color-surface-2)">
          ${p.avatar
            ? `<img src="${_esc(p.avatar)}" style="width:100%;height:100%;object-fit:cover" alt="">
               <button type="button" id="pe_avatar_clear" class="absolute" style="top:6px;right:6px;width:20px;height:20px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:20px;text-align:center">✕</button>`
            : `<div class="w-full h-full grid place-items-center text-muted"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>`}
        </div>
        <div class="flex-1 flex flex-col gap-2">
          <button type="button" id="pe_avatar_gen_btn" class="pe-gen-btn self-start">${PE_GEN_ICON} ${t("profile_generate")}</button>
          ${_profileEditorTextInput("pe_avatar_url", p.avatar, t("profile_avatar_url_placeholder"))}
        </div>
      </div>
      <input type="file" id="pe_avatar_file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    </div>
    <div class="mb-5">
      <div class="flex items-baseline gap-2 mb-2">
        <label class="font-mono text-[9px] tracking-[.18em] uppercase text-muted">${t("profile_banner_image")}</label>
        <span class="text-[11px] text-sec">${t("profile_banner_hint")}</span>
      </div>
      <div id="pe_banner_box" data-feature="profile" class="relative rounded-lg overflow-hidden cursor-pointer"
        style="height:110px;border:1.5px dashed var(--color-line-2);background:${p.banner_img ? `var(--color-surface-2) url('${_esc(p.banner_img)}') center/cover no-repeat` : "var(--color-surface-2)"}">
        ${p.banner_img
          ? `<button type="button" id="pe_banner_clear" class="absolute" style="top:8px;right:8px;width:20px;height:20px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:20px;text-align:center">✕</button>`
          : `<div class="w-full h-full grid place-items-center text-muted"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>`}
      </div>
      <button type="button" id="pe_banner_gen_btn" class="pe-gen-btn mt-2">${PE_GEN_ICON} ${t("profile_generate")}</button>
      <input type="file" id="pe_banner_file" accept="image/png,image/jpeg,image/webp" hidden>
    </div>

    <div class="mb-5">
      ${_profileEditorFieldLabel(t("profile_colors"))}
      <div class="flex gap-2.5 items-center">
        <button type="button" id="pe_bc_swatch" aria-label="${_attr(t("color_picker_choose_color"))}" style="width:52px;height:36px;border:1px solid var(--color-line-2);border-radius:8px;background:${_esc(p.banner_color || "#E3BD6C")};cursor:pointer;padding:0"></button>
        <input type="hidden" id="pe_bc" value="${_esc(p.banner_color || "#E3BD6C")}">
        <button type="button" id="pe_ac_swatch" aria-label="${_attr(t("color_picker_choose_color"))}" style="width:52px;height:36px;border:1px solid var(--color-line-2);border-radius:8px;background:${_esc(p.accent_color || p.banner_color || "#A97F2C")};cursor:pointer;padding:0"></button>
        <input type="hidden" id="pe_ac" value="${_esc(p.accent_color || p.banner_color || "#A97F2C")}">
        <div id="pe_grad_preview" style="flex:1;height:36px;border-radius:8px;border:1px solid var(--color-line-2)"></div>
      </div>
    </div>

    <div class="mb-5">
      ${_profileEditorFieldLabel(t("profile_social_links"))}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
        ${SOCIAL_PLATFORMS.map((sp) => _profileEditorSocialRow(sp, p.social_links)).join("")}
      </div>
    </div>

    <details style="margin-top:18px" ${((p.profile_html || "").trim() || (p.card_html || "").trim()) ? "open" : ""}>
      <summary style="cursor:pointer;font-family:var(--font-display);font-weight:600;font-size:14px;color:var(--color-ink);display:flex;align-items:center;gap:8px">
        ${t("profile_custom_html_css")}
        <button type="button" id="pe_html_copy_instr" data-tooltip="${t("profile_copy_instructions")}" aria-label="${t("profile_copy_instructions")}"
          style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-sec);cursor:pointer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
        </button>
      </summary>
      <div id="pe_card_instructions" data-instr-pane="card" class="hidden" style="margin-top:10px;font-size:12px;line-height:1.7;color:var(--color-sec)">
        <p>${t("profile_card_instr_intro", "This is your card in Explore - a fixed-size preview of you. Style it however you like; it always stays 230px tall, so anything taller is cropped and the grid never breaks.")}</p>
        <p>${t("profile_instr_no_external_links")}</p>
        <p><b>${t("profile_card_instr_placeholders_label", "Placeholders:")}</b> <code style="font-size:11px">{{avatar}} {{name}} {{handle}} {{bio}} {{characters}} {{followers}}</code> ${t("profile_card_instr_placeholders_desc", "- avatar image, display name, @handle, bio text, public character count, and follower count.")}</p>
        <p><b>${t("profile_card_instr_size_label", "Size:")}</b> ${t("profile_card_instr_size_desc", "the card fills the width of its grid column and is 230px tall. Leave it blank to keep the default card.")}</p>
        <p>${t("profile_card_instr_note_static", "Note: the card is a static preview, not interactive — it links to your full creator page when clicked, so a working Follow button only belongs on the Creator page tab, not here.")}</p>
        <p>${t("profile_card_instr_example", "Example:")}<br>
          <code style="font-size:11px;display:block;margin-top:4px;white-space:pre-wrap">&lt;style&gt;body{background:radial-gradient(#2a1d4a,#0d0a18);color:#e9deff;padding:16px}&lt;/style&gt;
&lt;div style="width:44px;height:44px;border-radius:50%;overflow:hidden"&gt;{{avatar}}&lt;/div&gt;
&lt;h3&gt;{{name}}&lt;/h3&gt;&lt;span&gt;{{handle}} · {{characters}} characters · {{followers}} followers&lt;/span&gt;</code></p>
      </div>
      <div id="pe_html_instructions" data-instr-pane="page" style="margin-top:10px;font-size:12px;line-height:1.7;color:var(--color-sec)">
        <p>${t("profile_instr_optional")}</p>

        <p>${t("profile_instr_no_external_links")}</p>

        <p><b>${t("profile_instr_text_placeholders_label")}</b> ${t("profile_instr_text_placeholders_desc")}<br>
          <code style="font-size:11px">${PROFILE_EDITOR_PLACEHOLDERS.slice(0, 9).join(" ")}</code></p>

        <p><b>${t("profile_instr_custom_title_label")}</b> ${t("profile_instr_custom_title_desc")}</p>

        <p>${t("profile_instr_wrapper_example")}<br>
          <code style="font-size:11px;display:block;margin-top:4px;white-space:pre-wrap">&lt;span class="my-title-badge"&gt;{{title}}&lt;/span&gt; &lt;!-- blank if no admin-approved title --&gt;
&lt;style&gt;.my-title-badge{background:var(--accent);color:#000;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase}&lt;/style&gt;</code></p>

        <p><b>${t("profile_instr_character_cards_label")}</b> ${t("profile_instr_character_cards_desc")}</p>

        <p><b>${t("profile_instr_links_label")}</b> ${t("profile_instr_links_desc")}</p>

        <p><b>${t("profile_instr_share_button_label")}</b> ${t("profile_instr_share_button_desc")}</p>

        <p><b>${t("profile_instr_edit_button_label")}</b> ${t("profile_instr_edit_button_desc")}</p>

        <p><b>${t("profile_instr_comments_button_label")}</b> ${t("profile_instr_comments_button_desc")}</p>

        <p><b>${t("profile_instr_block_button_label")}</b> ${t("profile_instr_block_button_desc")}</p>

        <p><b>${t("profile_instr_report_button_label")}</b> ${t("profile_instr_report_button_desc")}</p>

        <p><b>${t("profile_instr_follow_button_label")}</b> ${t("profile_instr_follow_button_desc")}</p>

        <p style="color:var(--color-warn,#e0a800)">${t("profile_instr_height_warning")}</p>

        <p><b>${t("profile_instr_css_variables_label")}</b> ${t("profile_instr_css_variables_desc")}</p>

        <p><b>${t("profile_instr_example_label")}</b><br>
          <code style="font-size:11px;display:block;margin-top:4px;white-space:pre-wrap">&lt;style&gt;body{display:grid;grid-template-columns:200px 1fr;gap:24px;padding:24px}&lt;/style&gt;
&lt;h1&gt;{{display_name}}&lt;/h1&gt;&lt;p&gt;{{bio}}&lt;/p&gt;{{share}} {{edit}} {{comments}} {{block}} {{report}}&lt;h2&gt;Cast&lt;/h2&gt;{{characters}}</code></p>
      </div>
      <div class="flex gap-1 mt-3 mb-2" style="background:var(--color-surface-2);border:1px solid var(--color-line);border-radius:10px;padding:3px;width:fit-content">
        <button type="button" id="pe_tab_page" class="filter-chip on" data-html-tab="page">${t("profile_tab_creator_page", "Creator page")}</button>
        <button type="button" id="pe_tab_card" class="filter-chip" data-html-tab="card">${t("profile_tab_creator_card", "Creator card")}</button>
      </div>
      <div class="relative">
        <div class="absolute flex gap-1.5" style="top:8px;right:8px;z-index:1">
          <button type="button" id="pe_html_upload_btn" data-tooltip="${t("profile_upload_a_file")}" aria-label="${t("profile_upload_a_file")}"
            style="width:26px;height:26px;border-radius:6px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-sec);cursor:pointer;display:inline-flex;align-items:center;justify-content:center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <button type="button" id="pe_html_download_btn" data-tooltip="${t("profile_download_as_a_file")}" aria-label="${t("profile_download_as_a_file")}"
            style="width:26px;height:26px;border-radius:6px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-sec);cursor:pointer;display:inline-flex;align-items:center;justify-content:center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button type="button" id="pe_html_clear_btn" data-tooltip="${t("profile_clear")}" aria-label="${t("profile_clear")}"
            style="width:26px;height:26px;border-radius:6px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-warn,#e0a800);cursor:pointer;display:inline-flex;align-items:center;justify-content:center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
        <textarea id="pe_html_in" data-html-pane="page" rows="10" placeholder="<style>…</style>&#10;<h1>{{display_name}}</h1>&#10;{{share}} {{edit}} {{comments}} {{block}} {{report}}"
          style="font-family:var(--font-mono, monospace);font-size:12px;width:100%;padding:12px 96px 12px 12px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);resize:vertical">${_esc(p.profile_html || "")}</textarea>
        <textarea id="pe_card_in" data-html-pane="card" rows="10" class="hidden" placeholder="<style>.card{background:#1a1030}</style>&#10;{{avatar}} <h3>{{name}}</h3>&#10;{{handle}} · {{characters}} characters"
          style="font-family:var(--font-mono, monospace);font-size:12px;width:100%;padding:12px 96px 12px 12px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);resize:vertical">${_esc(p.card_html || "")}</textarea>
      </div>
      <input type="file" id="pe_html_file" accept=".html,.css,.txt" hidden>

      <button type="button" id="pe_html_preview_btn" class="pe-gen-btn mt-3">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
        ${t("profile_live_preview")}
      </button>
    </details>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button type="button" id="pe_cancel" class="dropdown-item" style="border:1px solid var(--color-line-2);padding:9px 16px">${t("profile_cancel")}</button>
      <button type="button" id="pe_save" class="dropdown-item" style="border:1px solid var(--color-accent);color:var(--color-paper-base);background:var(--color-accent);padding:9px 16px">${t("profile_save")}</button>
    </div>
  `, { wide: true });

  let curAvatar = p.avatar || "";
  let curBanner = p.banner_img || "";
  let dirty = false;
  layer.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("input", () => { dirty = true; });
  });

  layer.querySelector("#pe_cancel").onclick = async () => {
    if (dirty && !(await confirmDialog(t("profile_discard_unsaved_changes")))) return;
    closeModal(layer);
  };

  layer.querySelector("#pe_html_copy_instr").onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = layer.querySelector("[data-instr-pane]:not(.hidden)").innerText;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast(t("profile_instructions_copied")))
        .catch(() => {
          if (copyTextFallback(text)) toast(t("profile_instructions_copied"));
          else errorToast(t("profile_couldnt_copy_instructions"));
        });
    } else if (copyTextFallback(text)) {
      toast(t("profile_instructions_copied"));
    } else {
      errorToast(t("profile_couldnt_copy_instructions"));
    }
  };

  const grad = layer.querySelector("#pe_grad_preview");
  const syncGrad = () => {
    grad.style.background = `linear-gradient(100deg, ${layer.querySelector("#pe_bc").value}, ${layer.querySelector("#pe_ac").value})`;
  };
  const wireColorSwatch = (swatchId, inputId) => {
    const swatch = layer.querySelector(swatchId);
    const input = layer.querySelector(inputId);
    swatch.onclick = () => openColorPicker(input.value, (hex) => {
      input.value = hex;
      swatch.style.background = hex;
      syncGrad();
    });
  };
  wireColorSwatch("#pe_bc_swatch", "#pe_bc");
  wireColorSwatch("#pe_ac_swatch", "#pe_ac");
  syncGrad();

  const UPLOAD_ICON_SVG = `<div class="w-full h-full grid place-items-center text-muted"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>`;

  const renderAvatarBox = () => {
    const box = layer.querySelector("#pe_avatar_box");
    box.innerHTML = curAvatar
      ? `<img src="${_esc(curAvatar)}" style="width:100%;height:100%;object-fit:cover" alt="">
         <button type="button" id="pe_avatar_clear" class="absolute" style="top:6px;right:6px;width:20px;height:20px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:20px;text-align:center">✕</button>`
      : UPLOAD_ICON_SVG;
    layer.querySelector("#pe_avatar_clear")?.addEventListener("click", (e) => {
      e.stopPropagation();
      curAvatar = "";
      layer.querySelector("#pe_avatar_url").value = "";
      renderAvatarBox();
    });
  };
  layer.querySelector("#pe_avatar_box").addEventListener("click", (e) => {
    if (e.target.closest("#pe_avatar_clear")) return;
    layer.querySelector("#pe_avatar_file").click();
  });
  renderAvatarBox();
  layer.querySelector("#pe_avatar_file").onchange = () => {
    const fileInput = layer.querySelector("#pe_avatar_file");
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) { errorToast(t("profile_image_must_be_under_10mb")); fileInput.value = ""; return; }
    const doUpload = async (blob) => {
      const fd = new FormData();
      fd.append("file", blob, f.name);
      try {
        const r = await api("/api/me/avatar", { method: "POST", body: fd });
        curAvatar = r.avatar;
        layer.querySelector("#pe_avatar_url").value = curAvatar;
        renderAvatarBox();
        toast(t("profile_avatar_uploaded"));
      } catch (err) {
        errorToast(err.message || t("profile_upload_failed"));
      }
    };
    isAnimatedImageFile(f).then(async (animated) => {
      if (animated) {
        const objectUrl = URL.createObjectURL(f);
        const ok = await confirmDialog(t("profile_confirm_animated_avatar"),
          { title: t("profile_confirm_avatar_title"), confirmLabel: t("profile_use_it"), cancelLabel: t("profile_cancel"), danger: false,
            icon: `<img src="${objectUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:9px">` });
        URL.revokeObjectURL(objectUrl);
        if (!ok) { fileInput.value = ""; return; }
        doUpload(f);
        return;
      }
      maybeCropUpload(f, "1/1", 1024, 1024, (dataUrl, blob) => doUpload(blob));
    });
    fileInput.value = "";
  };
  layer.querySelector("#pe_avatar_url").addEventListener("blur", (e) => {
    curAvatar = e.target.value.trim();
    renderAvatarBox();
  });
  layer.querySelector("#pe_avatar_gen_btn").onclick = () => _grimoireImageGenModal((url) => {
    curAvatar = url;
    layer.querySelector("#pe_avatar_url").value = curAvatar;
    renderAvatarBox();
  });

  const renderBannerBox = () => {
    const box = layer.querySelector("#pe_banner_box");
    box.style.background = curBanner
      ? `var(--color-surface-2) url('${curBanner.replace(/'/g, "%27")}') center/cover no-repeat`
      : "var(--color-surface-2)";
    box.innerHTML = curBanner
      ? `<button type="button" id="pe_banner_clear" class="absolute" style="top:8px;right:8px;width:20px;height:20px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:20px;text-align:center">✕</button>`
      : `<div class="w-full h-full grid place-items-center text-muted"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>`;
    layer.querySelector("#pe_banner_clear")?.addEventListener("click", (e) => {
      e.stopPropagation();
      curBanner = "";
      layer.querySelector("#pe_banner_url").value = "";
      renderBannerBox();
    });
  };
  layer.querySelector("#pe_banner_box").addEventListener("click", (e) => {
    if (e.target.closest("#pe_banner_clear")) return;
    layer.querySelector("#pe_banner_file").click();
  });
  renderBannerBox();
  layer.querySelector("#pe_banner_file").onchange = () => {
    const fileInput = layer.querySelector("#pe_banner_file");
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) { errorToast(t("profile_image_must_be_under_10mb")); fileInput.value = ""; return; }
    maybeCropUpload(f, "3/1", 1500, 500, async (dataUrl, blob) => {
      const fd = new FormData();
      fd.append("file", blob, f.name);
      try {
        const r = await api("/api/me/banner", { method: "POST", body: fd });
        curBanner = r.banner_img;
        renderBannerBox();
        toast(t("profile_banner_uploaded"));
      } catch (err) {
        errorToast(err.message || t("profile_upload_failed"));
      }
    });
    fileInput.value = "";
  };
  layer.querySelector("#pe_banner_gen_btn").onclick = () => _grimoireImageGenModal((url) => {
    curBanner = url;
    renderBannerBox();
  });

  const collectSocialLinks = () => {
    const links = {};
    SOCIAL_PLATFORMS.forEach((sp) => {
      const v = layer.querySelector(`#pe_soc_${sp.key}`).value.trim();
      if (v) links[sp.key] = v;
    });
    return links;
  };

  const activeHtmlPane = () => layer.querySelector("[data-html-pane]:not(.hidden)");
  const activeTab = () => layer.querySelector("[data-html-tab].on")?.dataset.htmlTab || "page";
  layer.querySelectorAll("[data-html-tab]").forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.htmlTab;
      layer.querySelectorAll("[data-html-tab]").forEach((b) => b.classList.toggle("on", b === btn));
      layer.querySelectorAll("[data-html-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.htmlPane !== tab));
      layer.querySelectorAll("[data-instr-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.instrPane !== tab));
    };
  });

  const openHtmlPreviewModal = () => {
    const html = activeHtmlPane().value;
    if (!html.trim()) { errorToast(t("profile_nothing_to_preview_yet")); return; }
    const isCard = activeTab() === "card";
    const previewLayer = openModal(`
      <h3>${t("profile_live_preview")}</h3>
      <div id="pe_html_preview" style="margin-top:10px;border-radius:10px;overflow:hidden;border:1px solid var(--color-line-2);min-height:0;max-height:70vh;overflow-y:auto;pointer-events:none${isCard ? ";width:240px;height:230px;margin-left:auto;margin-right:auto" : ""}"></div>
    `, { wide: !isCard });
    const previewP = {
      ...p,
      display_name: layer.querySelector("#pe_dn").value,
      bio: layer.querySelector("#pe_bio").value,
      avatar: curAvatar,
      banner_img: curBanner,
      banner_color: layer.querySelector("#pe_bc").value,
      accent_color: layer.querySelector("#pe_ac").value,
      social_links: collectSocialLinks(),
    };
    if (isCard) {
      const cardA = { username: p.username, display_name: previewP.display_name, avatar: curAvatar,
        bio: previewP.bio, public_characters: p.stats?.characters ?? 0,
        banner_img: curBanner, banner_color: previewP.banner_color, accent_color: previewP.accent_color };
      mountSandboxedHTML(previewLayer.querySelector("#pe_html_preview"), substituteCardTemplate(html, cardA), { autoHeight: false });
    } else {
      mountSandboxedHTML(previewLayer.querySelector("#pe_html_preview"), substituteProfileTemplate(html, previewP, true));
    }
  };
  layer.querySelector("#pe_html_preview_btn").onclick = openHtmlPreviewModal;

  layer.querySelector("#pe_html_upload_btn").onclick = () => layer.querySelector("#pe_html_file").click();
  layer.querySelector("#pe_html_file").onchange = () => {
    const f = layer.querySelector("#pe_html_file").files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      activeHtmlPane().value = reader.result;
      renderHtmlPreview();
    };
    reader.readAsText(f);
    layer.querySelector("#pe_html_file").value = "";
  };
  layer.querySelector("#pe_html_download_btn").onclick = () => {
    const content = activeHtmlPane().value;
    if (!content.trim()) return;
    const blob = new Blob([content], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(p.username || "profile").replace(/[^a-z0-9]+/gi, "-")}-profile.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  layer.querySelector("#pe_html_clear_btn").onclick = async () => {
    const input = activeHtmlPane();
    if (!input.value.trim()) return;
    if (!(await confirmDialog(t("profile_clear_custom_html_css")))) return;
    input.value = "";
    renderHtmlPreview();
  };

  const initialHtml = p.profile_html || "";
  layer.querySelector("#pe_save").onclick = async () => {
    const htmlIn = layer.querySelector("#pe_html_in").value;
    const cardIn = layer.querySelector("#pe_card_in").value;
    if (htmlIn.trim() && htmlIn !== initialHtml) {
      for (const ph of ["{{share}}", "{{edit}}", "{{comments}}", "{{block}}", "{{report}}", "{{follow}}"]) {
        if (!htmlIn.includes(ph)) { errorToast(`${t("profile_custom_html_must_include_placeholder")} ${ph}`); return; }
      }
      const issues = cardComplianceIssues(htmlIn);
      if (issues.length) { errorToast(issues[0]); return; }
    }
    if (cardIn.trim()) {
      const badUrl = findExternalCardLink(cardIn);
      if (badUrl) { errorToast(`${t("compliance_external_link_not_allowed_prefix")} ${badUrl}`); return; }
    }
    try {
      await api("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          display_name: layer.querySelector("#pe_dn").value.trim(),
          bio: layer.querySelector("#pe_bio").value,
          banner_color: layer.querySelector("#pe_bc").value,
          accent_color: layer.querySelector("#pe_ac").value,
          title: layer.querySelector("#pe_title").value,
          avatar: curAvatar,
          banner_img: curBanner,
          social_links: collectSocialLinks(),
          profile_html: htmlIn,
          card_html: cardIn,
        }),
      });
      closeModal(layer);
      toast(t("profile_profile_saved"));
      if (ME) Object.assign(ME, { avatar: curAvatar });
      onSave?.();
    } catch (err) {
      errorToast(err.message || t("profile_couldnt_save_profile"));
    }
  };
}

if (typeof window !== "undefined") {
  window.openProfileEditor = openProfileEditor;
}
