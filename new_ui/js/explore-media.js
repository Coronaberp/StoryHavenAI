"use strict";

let _checkpointPreviewsCache = null;
let _checkpointPreviewsPromise = null;

async function _loadCheckpointPreviews() {
  if (_checkpointPreviewsCache) return _checkpointPreviewsCache;
  if (!_checkpointPreviewsPromise) _checkpointPreviewsPromise = api("/api/imagegen/checkpoint-previews").catch(() => ({}));
  _checkpointPreviewsCache = await _checkpointPreviewsPromise;
  return _checkpointPreviewsCache;
}

function _checkpointDisplayName(raw) {
  if (!raw) return raw;
  return _checkpointPreviewsCache?.[raw]?.display_name || raw;
}

function _wireZoomPan(img) {
  if (!img) return;
  const parent = img.parentElement;
  if (parent) { parent.style.overflow = "hidden"; parent.style.position = parent.style.position || "relative"; }
  const minScale = 1, clickScale = 2.5, maxScale = 10;
  let scale = 1, tx = 0, ty = 0, dragging = false, moved = false;
  let startX = 0, startY = 0, startTx = 0, startTy = 0;
  img.style.willChange = "transform";
  img.style.cursor = "zoom-in";

  const slider = document.createElement("input");
  slider.type = "range"; slider.min = String(clickScale); slider.max = String(maxScale); slider.step = "0.1";
  slider.value = String(clickScale);
  slider.className = "ig-zoom-slider";
  slider.style.cssText = "position:absolute;left:12px;right:12px;bottom:12px;width:calc(100% - 24px);display:none;z-index:2;accent-color:var(--color-accent);";
  slider.addEventListener("click", (e) => e.stopPropagation());
  slider.addEventListener("mousedown", (e) => e.stopPropagation());
  if (parent) parent.appendChild(slider);

  const syncSlider = () => {
    if (!slider.isConnected) return;
    slider.style.display = scale > minScale ? "" : "none";
    if (document.activeElement !== slider) slider.value = String(scale);
  };
  const apply = (animate) => {
    img.style.transition = animate ? "transform .15s ease" : "none";
    img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    syncSlider();
  };
  const clampPan = () => {
    const rect = img.getBoundingClientRect();
    const baseW = rect.width / scale, baseH = rect.height / scale;
    const maxX = Math.max(0, (baseW * scale - baseW) / 2), maxY = Math.max(0, (baseH * scale - baseH) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  };
  const zoomAt = (clientX, clientY, factor) => {
    const rect = img.getBoundingClientRect();
    const originX = clientX - (rect.left + rect.width / 2), originY = clientY - (rect.top + rect.height / 2);
    const newScale = Math.min(maxScale, Math.max(minScale, scale * factor));
    if (newScale === scale) return;
    const dScale = newScale / scale;
    tx = (tx - originX) * dScale + originX;
    ty = (ty - originY) * dScale + originY;
    scale = newScale;
    if (scale === minScale) { tx = 0; ty = 0; }
    clampPan();
    img.style.cursor = scale > minScale ? "grab" : "zoom-in";
    apply(true);
  };
  slider.addEventListener("input", () => {
    const newScale = Math.min(maxScale, Math.max(minScale, parseFloat(slider.value) || minScale));
    const dScale = newScale / scale;
    scale = newScale;
    tx *= dScale; ty *= dScale;
    clampPan();
    img.style.cursor = "grab";
    apply(false);
  });
  img.addEventListener("click", (e) => {
    if (moved) { moved = false; return; }
    if (scale > minScale) { scale = minScale; tx = 0; ty = 0; img.style.cursor = "zoom-in"; apply(true); return; }
    zoomAt(e.clientX, e.clientY, clickScale);
  });
  const beginDrag = (clientX, clientY) => {
    if (scale <= minScale) return;
    dragging = true; moved = false;
    startX = clientX; startY = clientY; startTx = tx; startTy = ty;
    img.style.cursor = "grabbing";
  };
  img.addEventListener("mousedown", (e) => { beginDrag(e.clientX, e.clientY); if (dragging) e.preventDefault(); });
  img.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    beginDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  const suppressNextClick = () => {
    const kill = (e) => { e.stopPropagation(); };
    document.addEventListener("click", kill, { capture: true, once: true });
  };
  const removeAll = () => {
    window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
    window.removeEventListener("touchmove", onTouchMove); window.removeEventListener("touchend", onUp);
  };
  const onMove = (e) => {
    if (!img.isConnected) { removeAll(); return; }
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    tx = startTx + dx; ty = startTy + dy;
    clampPan();
    apply(false);
  };
  const onTouchMove = (e) => {
    if (!img.isConnected) { removeAll(); return; }
    if (!dragging || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    tx = startTx + dx; ty = startTy + dy;
    clampPan();
    apply(false);
  };
  const onUp = () => {
    if (!img.isConnected) { removeAll(); return; }
    if (!dragging) return;
    dragging = false;
    img.style.cursor = scale > minScale ? "grab" : "zoom-in";
    if (moved) suppressNextClick();
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onUp);
  img.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
}

class ExploreMediaView {
  constructor() {
    this.images = [];
    this.loading = true;
    this.error = "";
    this.q = "";
    this.creatorFilters = [];
    this.creatorProfiles = {};
  }

  allCreators() {
    return [...new Set(this.images.map((i) => i.owner_username).filter(Boolean))].sort();
  }

  addCreatorFilter(name) {
    if (!this.creatorFilters.includes(name)) this.creatorFilters = [...this.creatorFilters, name];
    this.render();
  }

  removeCreatorFilter(name) {
    this.creatorFilters = this.creatorFilters.filter((c) => c !== name);
    this.render();
  }

  async mount(main) {
    this.main = main;
    this.render();
    await this.load();
  }

  async load() {
    this.loading = true;
    this.error = "";
    this.render();
    try {
      this.images = await api("/api/imagegen/community");
    } catch (err) {
      this.error = err.message || t("pinacotheca_load_error");
      this.images = [];
    }
    this.loading = false;
    this.render();
    this.loadCreatorProfiles();
  }

  async loadCreatorProfiles() {
    const usernames = [...new Set(this.images.map((i) => i.owner_username).filter(Boolean))];
    if (!usernames.length) return;
    const fetched = await Promise.all(usernames.map(async (u) => {
      try { return [u, await api(`/api/users/${encodeURIComponent(u)}`)]; }
      catch { return [u, null]; }
    }));
    fetched.forEach(([u, profile]) => { if (profile) this.creatorProfiles[u] = profile; });
    this.render();
  }

  frameHtml(img) {
    const blur = img.is_explicit && !ME?.nsfw_allowed;
    const creatorName = img.owner_display_name || img.owner_username || t("pinacotheca_you_fallback");
    const profile = this.creatorProfiles[img.owner_username];
    const avatarSrc = profile?.avatar || img.owner_avatar;
    const avatarInner = avatarSrc
      ? `<img src="${avatarSrc}" alt="">`
      : `<span>${creatorName[0].toUpperCase()}</span>`;
    const ringGradient = profile?.accent_color
      ? `linear-gradient(135deg, ${profile.accent_color}, ${profile.banner_color || profile.accent_color})`
      : "linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))";
    const hue = [...(img.id || creatorName)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const dom = `hsl(${hue} 45% 20%)`;
    return `
      <div class="pin-frame" data-iid="${_esc(img.id)}" style="--dom:${dom}" ${img.media_type !== "video" ? `data-dom-src="${_attr(img.image)}"` : ""}>
        ${mediaTagHtml(img, { style: blur ? "filter:blur(16px) saturate(60%)" : "" })}
        ${img.is_explicit ? `<span class="pin-badge">NSFW</span>` : ""}
        <div class="char-card-fade"></div>
        <div class="char-card-creator" style="position:absolute;left:8px;right:8px;bottom:7px"
          ${img.owner_username ? `onclick="event.stopPropagation();navigate('/u/${encodeURIComponent(img.owner_username)}')" style="cursor:pointer"` : ""}>
          <span class="char-card-creator-ring" style="background:${ringGradient}">
            <span class="char-card-creator-ring-inner">${avatarInner}</span>
          </span>
          <span class="char-card-creator-name">${_esc(creatorName)}</span>
        </div>
      </div>
    `;
  }

  tagsRowHtml(tags, kind) {
    const list = (tags || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!list.length) return "";
    const label = kind === "pos" ? t("pinacotheca_positive_tags") : t("pinacotheca_negative_tags");
    return `
      <div data-tags="${_esc(tags)}">
        <div class="ig-tags-label">${label} <span class="ig-tags-copy" data-act="copy-tags">${t("pinacotheca_copy")}</span></div>
        <div class="ig-tags-wrap">${list.map((tg) => `<span class="ig-tag ${kind === "pos" ? "ig-tag-pos" : "ig-tag-neg"}">${_esc(tg)}</span>`).join("")}</div>
      </div>
    `;
  }

  placardHtml(img) {
    const rows = img.media_type === "video" ? [
      [t("pinacotheca_duration"), img.fps ? `${(img.frame_count / img.fps).toFixed(1)}s` : null],
      [t("pinacotheca_frame_rate"), img.fps ? `${img.fps} fps` : null],
    ].filter(([, v]) => v) : [
      [t("pinacotheca_model"), _checkpointDisplayName(img.checkpoint), "data-checkpoint-value"],
      [t("pinacotheca_type"), img.is_img2img ? "img2img" : "txt2img"],
      [t("pinacotheca_sampler"), img.sampler],
      [t("pinacotheca_scheduler"), img.scheduler],
      [t("pinacotheca_steps"), img.steps],
      [t("pinacotheca_cfg"), img.cfg],
      [t("pinacotheca_upscaled"), img.upscaler],
    ].filter(([, v]) => v);
    if (!rows.length) return "";
    return `
      <div class="ig-placard">
        ${rows.map(([label, value, attr]) => `<span class="ig-placard-label">${_esc(label)}</span><span class="ig-placard-value" ${attr || ""}>${_esc(String(value))}</span>`).join("")}
      </div>
    `;
  }

  detailHtml(img, { hideShare = false, context = null } = {}) {
    const isOwn = ME && img.user_id === ME.id;
    const owner = img.owner_display_name || img.owner_username || t("pinacotheca_unknown_creator");
    const when = img.created ? new Date(img.created * 1000).toLocaleString() : "";
    const censored = img.is_explicit && !ME?.nsfw_allowed;
    return `
      <div class="ig-detail">
        <div class="ig-detail-img">
          <div class="ig-detail-media">
            ${mediaTagHtml(img, { style: censored ? "filter:blur(24px) saturate(60%)" : "", controls: img.media_type === "video" })}
            ${censored ? `
              <button type="button" class="ig-reveal-btn" data-act="reveal">
                <span>${t("pinacotheca_nsfw_label")}</span>
                <span class="ig-reveal-sub">${t("pinacotheca_tap_to_view")}</span>
              </button>
            ` : ""}
          </div>
          <div class="ig-detail-icons">
            <button type="button" class="ig-icon-btn" data-act="download" data-tooltip="${_attr(t("pinacotheca_download"))}" aria-label="${_attr(t("pinacotheca_download"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            ${hideShare ? "" : `
            <button type="button" class="ig-icon-btn" data-act="share" data-tooltip="${_attr(t("pinacotheca_copy_link"))}" aria-label="${_attr(t("pinacotheca_copy_link"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>
            `}
            ${img.media_type === "video" ? "" : (context === "forge" ? `
              <button type="button" class="ig-icon-btn" data-act="use-reference" data-tooltip="${_attr(t("pinacotheca_use_as_reference_image"))}" aria-label="${_attr(t("pinacotheca_use_as_reference_image"))}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-9.5 9.5a1.5 1.5 0 0 1-2.1-2.1L13 6.9M17.8 6.2L19 5"/></svg>
              </button>
            ` : ME ? `
              <button type="button" class="ig-icon-btn" data-act="studio" data-tooltip="${_attr(t("pinacotheca_send_to_studio"))}" aria-label="${_attr(t("pinacotheca_send_to_studio"))}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9l-9.5 9.5a1.5 1.5 0 0 1-2.1-2.1L13 6.9M17.8 6.2L19 5"/></svg>
              </button>
            ` : "")}
            ${context !== "forge" && ME && ME.id === img.user_id ? `
              <button type="button" class="ig-icon-btn danger" data-act="delete" data-tooltip="${_attr(t("pinacotheca_delete"))}" aria-label="${_attr(t("pinacotheca_delete"))}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            ` : ""}
          </div>
        </div>
        <div class="ig-detail-body">
          <div class="ig-detail-eyebrow">${_esc(when)}</div>
          ${isOwn ? "" : `
          <div class="ig-detail-owner" data-owner="${img.owner_username ? encodeURIComponent(img.owner_username) : ""}">
            <span class="char-card-creator-ring" style="width:26px;height:26px;background:linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))">
              <span class="char-card-creator-ring-inner">${img.owner_avatar ? `<img src="${_esc(img.owner_avatar)}" alt="">` : `<span>${_esc(owner[0]?.toUpperCase() || "?")}</span>`}</span>
            </span>
            <span class="ig-detail-owner-name">${_esc(owner)}</span>
          </div>
          `}
          <div class="ig-rating-row">
            <span class="ig-rating-badge ${img.is_explicit ? "nsfw" : "sfw"}">${img.is_explicit ? t("pinacotheca_nsfw_label") : t("pinacotheca_sfw_label")}</span>
            <span class="ig-rating-text">${t("pinacotheca_rated_prefix")} ${img.is_explicit ? t("pinacotheca_nsfw_label") : t("pinacotheca_sfw_label")} (${img.human_reviewed ? t("pinacotheca_human_verified") : t("pinacotheca_ai_rated_not_human_verified")})</span>
            ${ME ? `<span class="ig-rating-report" data-act="report">${t("pinacotheca_lodge_a_report")}</span>` : ""}
          </div>
          ${this.tagsRowHtml(img.positive, "pos")}
          ${this.tagsRowHtml(img.negative, "neg")}
          ${this.placardHtml(img)}
          <div style="display:flex;flex-direction:column;gap:12px;padding-top:6px;border-top:1px solid var(--color-line)">
            <div class="font-mono" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted)">${t("pinacotheca_comments_label")} ${commentCountSpanHtml(this._commentsUidFor(img))}</div>
            <div id="pinCommentMount_${_attr(this._commentsUidFor(img))}"></div>
          </div>
        </div>
      </div>
    `;
  }

  _commentsUidFor(img) {
    return `pin_${img.id}`;
  }

  loadDetailComments(container, img) {
    const mount = container.querySelector(`#pinCommentMount_${CSS.escape(this._commentsUidFor(img))}`);
    if (!mount) return;
    const panel = new CommentsPanel("image", img.id);
    panel.uid = this._commentsUidFor(img);
    container._commentsPanel = panel;
    panel.mount(mount);
  }

  wireDetailModal(img) {
    const layer = document.querySelector(".modal-layer:last-child");
    if (!layer) return;
    this.wireDetail(layer, img, { onNavigate: () => closeTopModal() });
  }

  wireDetail(container, img, { onNavigate } = {}) {
    this.loadDetailComments(container, img);
    if (img.media_type !== "video") _wireZoomPan(container.querySelector(".ig-detail-img img"));
    if (img.checkpoint && !_checkpointPreviewsCache) {
      _loadCheckpointPreviews().then(() => {
        const el = container.querySelector("[data-checkpoint-value]");
        if (el) el.textContent = _checkpointDisplayName(img.checkpoint);
      });
    }
    container.querySelector("[data-act='reveal']")?.addEventListener("click", (e) => {
      const revealImg = container.querySelector(".ig-detail-img img, .ig-detail-img video");
      revealImg.removeAttribute("data-censored");
      revealImg.style.filter = "";
      e.currentTarget.remove();
    });
    container.querySelector("[data-act='use-reference']")?.addEventListener("click", async () => {
      const forge = window._activeForgeView;
      if (!forge) return;
      forge.mode = "image";
      const before = forge.referenceImage;
      await forge.setReferenceFromUrl(img.image);
      if (forge.referenceImage !== before) {
        closeTopModal();
        closeTopModal();
        toast(t("pinacotheca_set_as_reference_image"));
      }
    });
    container.querySelector("[data-owner]")?.addEventListener("click", () => {
      const u = container.querySelector("[data-owner]").dataset.owner;
      if (u) { onNavigate?.(); navigate(`/u/${u}`); }
    });
    container.querySelectorAll("[data-act='copy-tags']").forEach((btn) => {
      btn.onclick = () => {
        const tags = btn.closest("[data-tags]").dataset.tags;
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(tags)
            .then(() => toast(t("pinacotheca_tags_copied")))
            .catch(() => {
              if (copyTextFallback(tags)) toast(t("pinacotheca_tags_copied"));
              else errorToast(t("pinacotheca_copy_tags_failed"));
            });
          return;
        }
        if (copyTextFallback(tags)) toast(t("pinacotheca_tags_copied"));
        else errorToast(t("pinacotheca_copy_tags_failed"));
      };
    });
    container.querySelector("[data-act='report']")?.addEventListener("click", () => this.openReportModal(img));
    container.querySelector("[data-act='download']")?.addEventListener("click", () => this.downloadImage(img));
    container.querySelector("[data-act='share']")?.addEventListener("click", () => this.copyShareLink(img));
    container.querySelector("[data-act='delete']")?.addEventListener("click", () => this.deleteImage(img));
    container.querySelector("[data-act='studio']")?.addEventListener("click", () => this.openStudioModal(img));
  }

  async downloadImage(img) {
    try {
      const blob = await (await fetch(img.image)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (img.image.split("/").pop() || "image").split("?")[0];
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      toast(t("pinacotheca_download_failed_prefix") + (err.message || t("pinacotheca_unknown_error")));
    }
  }

  copyShareLink(img) {
    const url = `${location.origin}/i/${encodeURIComponent(img.id)}`;
    copyShareUrl(url);
  }

  async deleteImage(img) {
    if (!(await confirmDialog(t("pinacotheca_delete_image_confirm")))) return;
    try {
      await api(`/api/imagegen/standalone/${encodeURIComponent(img.id)}`, { method: "DELETE" });
      closeTopModal();
      this.images = this.images.filter((i) => i.id !== img.id);
      this.render();
      toast(t("pinacotheca_image_deleted"));
    } catch (err) {
      toast(err.message || t("pinacotheca_delete_image_error"));
    }
  }

  openStudioModal(img) {
    openModal(`
      <div style="display:flex;flex-direction:column;gap:10px;max-width:420px">
        <div class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${t("pinacotheca_send_to_generate")}</div>
        <button type="button" class="tool" data-studio-use="inpaint"
          style="text-align:left;border:1px solid var(--color-line-2);border-radius:8px;padding:10px 12px;color:var(--color-ink)">
          <div style="font-weight:600;font-size:13.5px">${t("pinacotheca_use_for_inpainting")}</div>
          <div style="font-size:11.5px;color:var(--color-sec);margin-top:2px">${t("pinacotheca_use_for_inpainting_desc")}</div>
        </button>
        <button type="button" class="tool" data-studio-use="image"
          style="text-align:left;border:1px solid var(--color-line-2);border-radius:8px;padding:10px 12px;color:var(--color-ink)">
          <div style="font-weight:600;font-size:13.5px">${t("pinacotheca_use_as_reference")}</div>
          <div style="font-size:11.5px;color:var(--color-sec);margin-top:2px">${t("pinacotheca_use_as_reference_desc")}</div>
        </button>
        <div style="display:flex;justify-content:flex-end">
          <button type="button" id="pinStudioCancel" class="tool" style="border:1px solid var(--color-line-2);border-radius:8px;padding:7px 14px">${t("pinacotheca_close")}</button>
        </div>
      </div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    layer.querySelector("#pinStudioCancel").onclick = () => closeTopModal();
    layer.querySelectorAll("[data-studio-use]").forEach((btn) => {
      btn.onclick = () => {
        store.set("forgePendingReference", { url: img.image, mode: btn.dataset.studioUse });
        closeTopModal();
        closeTopModal();
        navigate("/workshop/media");
      };
    });
  }

  openReportModal(img) {
    openModal(`
      <div style="display:flex;flex-direction:column;gap:10px;max-width:420px">
        <div class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink)">${t("pinacotheca_lodge_a_report")}</div>
        <p style="font-size:12.5px;color:var(--color-sec)">${t("pinacotheca_report_desc")}</p>
        <textarea id="pinReportNote" rows="3" placeholder="${_attr(t("pinacotheca_optional_note_placeholder"))}"
          style="padding:10px 12px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13px;resize:vertical"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button type="button" id="pinReportCancel" class="tool" style="border:1px solid var(--color-line-2);border-radius:8px;padding:7px 14px">${t("pinacotheca_cancel")}</button>
          <button type="button" id="pinReportSfw" class="tool" style="border:1px solid var(--color-line-2);border-radius:8px;padding:7px 14px">${t("pinacotheca_report_as_sfw")}</button>
          <button type="button" id="pinReportNsfw" class="tool" style="border:1px solid var(--color-warn);border-radius:8px;padding:7px 14px;color:var(--color-warn)">${t("pinacotheca_report_as_nsfw")}</button>
        </div>
      </div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    layer.querySelector("#pinReportCancel").onclick = () => closeTopModal();
    const submit = async (claimed) => {
      const note = layer.querySelector("#pinReportNote").value.trim();
      try {
        await api(`/api/imagegen/standalone/${encodeURIComponent(img.id)}/report`, {
          method: "POST",
          body: JSON.stringify({ claimed_explicit: claimed, note }),
        });
        closeTopModal();
        toast(t("pinacotheca_report_sent"));
      } catch (err) {
        toast(err.message || t("pinacotheca_report_send_error"));
      }
    };
    layer.querySelector("#pinReportSfw").onclick = () => submit(false);
    layer.querySelector("#pinReportNsfw").onclick = () => submit(true);
  }

  visibleImages() {
    return this.images.filter((img) => {
      if (this.creatorFilters.length && !this.creatorFilters.includes(img.owner_username)) return false;
      if (!this.q) return true;
      return (img.positive || "").toLowerCase().includes(this.q.toLowerCase());
    });
  }

  render() {
    const visible = this.visibleImages();
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        ${pageHeaderHtml("Explore", "Media", t("ph_media_gallery_title"), t("ph_media_gallery_sub"))}
        <div id="pinSearchBox" style="position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
          ${this.creatorFilters.map((c) => `
            <span class="inline-pill pill-creator">@${_esc(c)}<span class="x" data-remove-creator="${_esc(c)}">&times;</span></span>
          `).join("")}
          <input type="text" id="pinSearch" value="${_esc(this.q)}" placeholder="${this.creatorFilters.length ? "" : _attr(t("pinacotheca_search_placeholder"))}"
            style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
          <div id="pinSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
        </div>
        ${this.loading ? `<p style="color:var(--color-sec);font-size:13px">${t("pinacotheca_loading")}</p>` : ""}
        ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>` : ""}
        ${!this.loading && !this.error && !visible.length ? `<p style="color:var(--color-sec);font-size:13px">${this.images.length ? t("pinacotheca_no_search_matches") : t("pinacotheca_no_images_shared")}</p>` : ""}
        ${!this.loading && visible.length ? `<div class="pin-wall">${visible.map((img) => this.frameHtml(img)).join("")}</div>` : ""}
      </div>
    `;
    wireCharCardDominantColors(this.main);
    this.main.querySelectorAll(".pin-frame").forEach((el) => {
      el.onclick = () => {
        const img = this.images.find((i) => i.id === el.dataset.iid);
        if (img) {
          openModal(this.detailHtml(img), { wide: true });
          this.wireDetailModal(img);
        }
      };
    });
    this.main.querySelectorAll("[data-remove-creator]").forEach((x) => {
      x.onclick = (e) => { e.stopPropagation(); this.removeCreatorFilter(x.dataset.removeCreator); };
    });
    const search = this.main.querySelector("#pinSearch");
    let searchTimer;
    search.oninput = () => {
      this.updateCreatorSuggestions();
      if (search.value.startsWith("@")) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.q = search.value.trim();
        this.render();
      }, 250);
    };
    search.onkeydown = (e) => {
      if (e.key === "Backspace" && search.value === "" && this.creatorFilters.length) {
        e.preventDefault();
        const removed = this.creatorFilters[this.creatorFilters.length - 1];
        this.creatorFilters = this.creatorFilters.slice(0, -1);
        toast(`Removed @${removed} filter`);
        this.render();
        return;
      }
      if (e.key !== "Enter") return;
      const val = search.value.trim();
      if (val.startsWith("@") && val.length > 1) {
        this.addCreatorFilter(val.slice(1));
        search.value = "";
        this.q = "";
      }
    };
  }

  updateCreatorSuggestions() {
    const box = this.main.querySelector("#pinSuggest");
    const search = this.main.querySelector("#pinSearch");
    if (!box || !search) return;
    const val = search.value;
    if (!val.startsWith("@")) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const q = val.slice(1).toLowerCase();
    const matches = this.allCreators().filter((c) => !this.creatorFilters.includes(c) && c.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { box.classList.remove("open"); box.innerHTML = ""; return; }
    box.innerHTML = matches.map((c) => `<button type="button" class="dropdown-item" data-pick-creator="${_esc(c)}">@${_esc(c)}</button>`).join("");
    box.classList.add("open");
    box.querySelectorAll("[data-pick-creator]").forEach((btn) => btn.onclick = () => {
      search.value = "";
      box.classList.remove("open");
      this.addCreatorFilter(btn.dataset.pickCreator);
    });
  }

  renderStandalone(main, img) {
    this.main = main;
    main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;max-width:640px;margin:0 auto;padding:16px">
        <div class="font-mono" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent)">${t("pinacotheca_media_gallery")}</div>
        ${this.detailHtml(img)}
        ${!ME ? `<a href="/login" onclick="event.preventDefault();navigate('/login')" class="sym-cta" style="text-decoration:none;justify-content:center">${t("pinacotheca_sign_in_to_engage")}</a>` : ""}
      </div>
    `;
    this.wireDetail(main, img);
  }
}

if (typeof window !== "undefined") {
  window.ExploreMediaView = ExploreMediaView;
}
