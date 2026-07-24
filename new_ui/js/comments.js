"use strict";

function _floatingPopupHost() {
  return document.querySelector(".modal-layer:last-child") || document.body;
}

const _commentMdRenderer = new marked.Renderer();
_commentMdRenderer.link = (href, title, text) => text;

const COMMENT_MENTION_RE = /(?<!\w)@([A-Za-z0-9_-]{2,32})/g;
const COMMENT_SHORTCODE_RE = /:([a-z0-9_]{2,32}):/g;
const COMMENT_MAX_DEPTH = 10;
const COMMENT_REACTION_EMOJI = ["👍", "👎", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥", "👀"];
const COMMENT_PICKER_EMOJI = [
  "😀", "😂", "🥰", "😍", "😎", "🤔", "😅", "😢", "😭", "😡", "🤯", "🥳",
  "👍", "👎", "👏", "🙏", "🔥", "💯", "✨", "🎉", "❤️", "💔", "👀", "🤝",
  "😇", "😈", "🙄", "😴", "🤢", "💀", "👻", "🤖", "🎃", "⭐", "⚡", "🌙",
];

let _EMOJI_CACHE = null;
const _EMOJI_COLOR_CACHE = new Map();

async function loadCustomEmojis() {
  if (_EMOJI_CACHE) return _EMOJI_CACHE;
  let all = [];
  try { all = await api("/api/emojis"); } catch { all = []; }
  const map = {};
  all.forEach((e) => { if (e.shortcode && e.image) map[e.shortcode] = e.image; });
  _EMOJI_CACHE = {
    emojis: all.filter((e) => e.kind === "emoji"),
    stickers: all.filter((e) => e.kind === "sticker"),
    map,
  };
  return _EMOJI_CACHE;
}

function renderCommentMarkdown(text) {
  const emojiMap = _EMOJI_CACHE?.map || {};
  const withMentions = String(text || "").replace(COMMENT_MENTION_RE, (whole, uname) => {
    const href = `/u/${encodeURIComponent(uname.toLowerCase() === "dev" ? "zukaarimoto" : uname)}`;
    return `<a href="${_attr(href)}" onclick="event.preventDefault();navigate('${_attr(href)}')">@${_esc(uname)}</a>`;
  }).replace(COMMENT_SHORTCODE_RE, (whole, code) => {
    const img = emojiMap[code];
    if (!img) return whole;
    return `<img class="comment-emoji" src="${_attr(img)}" alt="${_attr(":" + code + ":")}" title="${_attr(":" + code + ":")}">`;
  });
  try {
    const div = document.createElement("div");
    div.innerHTML = DOMPurify.sanitize(marked.parse(withMentions, {
      gfm: true, breaks: true, renderer: _commentMdRenderer,
    }));
    return div.innerHTML;
  } catch {
    return _esc(text);
  }
}

function commentAttachmentHtml(c) {
  if (!c.image) return "";
  if (c.attachment_kind === "video") {
    return `<video src="${_attr(c.image)}" controls style="max-width:100%;border-radius:10px;margin-top:6px;display:block"></video>`;
  }
  if (c.attachment_kind === "text") {
    return `<a href="${_attr(`/api/comments/attachment-text/${c.image}`)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12px;color:var(--color-accent)">📄 ${t("comments_view_attached_file")}</a>`;
  }
  return `<img src="${_attr(c.image)}" alt="" class="${c.image_is_explicit ? "comment-explicit-img" : ""}" style="max-width:220px;border-radius:10px;margin-top:6px;display:block">`;
}

async function extractEmojiColors(value) {
  if (_EMOJI_COLOR_CACHE.has(value)) return _EMOJI_COLOR_CACHE.get(value);
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    if (/^https?:\/\//.test(value) || value.startsWith("/media/")) {
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { ctx.drawImage(img, 0, 0, size, size); resolve(); };
        img.onerror = reject;
        img.src = value;
      });
    } else {
      ctx.font = Math.round(size * 0.75) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(value, size / 2, size / 2 + 1);
    }
    const data = ctx.getImageData(0, 0, size, size).data;
    const buckets = new Map();
    const STEP = 28;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      const key = [data[i], data[i + 1], data[i + 2]]
        .map((c) => Math.round(c / STEP) * STEP).join(",");
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    if (!buckets.size) throw new Error("no opaque pixels");
    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    const toHex = (key) => "#" + key.split(",").map((v) => Math.min(255, +v).toString(16).padStart(2, "0")).join("");
    const result = [toHex(sorted[0][0]), toHex(sorted[sorted.length - 1][0])];
    _EMOJI_COLOR_CACHE.set(value, result);
    return result;
  } catch {
    const fallback = ["var(--color-accent)", "var(--color-accent-deep)"];
    _EMOJI_COLOR_CACHE.set(value, fallback);
    return fallback;
  }
}

class CommentsPanel {
  constructor(targetType, targetId) {
    this.targetType = targetType;
    this.targetId = targetId;
    this.comments = [];
    this.replyTo = null;
    this.editing = null;
    this.pendingAttachment = null;
    this.sending = false;
    this.container = null;
    this.uid = "cp" + Math.random().toString(36).slice(2, 9);
  }

  mount(container) {
    this.container = container;
    container.innerHTML = `
      <div class="comment-list" id="${this.uid}_list"><p style="color:var(--color-sec);font-size:13px">${t("comments_loading")}</p></div>
      ${ME ? this.composerHtml() : ""}
    `;
    if (ME) this.wireComposer();
    window._activeCommentsPanel = this;
    this.load();
    return this;
  }

  remount(container) {
    this.container = container;
    container.innerHTML = `
      <div class="comment-list" id="${this.uid}_list"></div>
      ${ME ? this.composerHtml() : ""}
    `;
    if (ME) this.wireComposer();
    window._activeCommentsPanel = this;
    this.renderList();
    return this;
  }

  async load() {
    const [comments] = await Promise.all([
      api(`/api/comments?target_type=${this.targetType}&target_id=${encodeURIComponent(this.targetId)}`),
      loadCustomEmojis(),
    ]);
    this.comments = comments;
    this.renderList();
    return this;
  }

  get count() {
    return this.comments.reduce((n, root) => n + 1 + (root.replies || []).length, 0);
  }

  renderList() {
    const list = this.container?.querySelector(`#${this.uid}_list`);
    if (!list) return;
    list.innerHTML = this.comments.length
      ? this.comments.map((root) => this.threadHtml(root)).join("")
      : `<p style="color:var(--color-sec);font-size:13px;padding:12px 0">${t("comments_no_comments_yet")}</p>`;
    this.wireRows();
    document.querySelectorAll(`[data-comment-count="${this.uid}"]`).forEach((el) => {
      el.textContent = this.count ? `(${this.count})` : "";
    });
  }

  threadHtml(root) {
    const byId = new Map([[root.id, root]]);
    (root.replies || []).forEach((r) => byId.set(r.id, r));
    const depthOf = (c) => {
      let depth = 0, cur = c;
      const seen = new Set();
      while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
        seen.add(cur.id);
        cur = byId.get(cur.parent_id);
        depth++;
      }
      return depth;
    };
    const rows = [this.commentRowHtml(root, 0, null)];
    (root.replies || []).forEach((r) => {
      const depth = Math.min(depthOf(r), COMMENT_MAX_DEPTH);
      const parent = byId.get(r.parent_id) || root;
      rows.push(this.commentRowHtml(r, depth, parent));
    });
    return rows.join("");
  }

  commentRowHtml(c, depth, parent) {
    const name = c.author_display_name || c.author_username;
    const when = new Date(c.created * 1000).toLocaleDateString();
    const mine = ME && ME.id === c.author_id;
    const isEditing = this.editing === c.id;
    const reactionEntries = Object.entries(c.reactions || {});
    const refHtml = depth > 0 && parent ? `
      <div class="comment-ref" data-jump="${_attr(parent.id)}">
        <span class="comment-ref-avatar">${parent.author_avatar ? `<img src="${_attr(parent.author_avatar)}" alt="">` : ""}</span>
        <span class="comment-ref-name">${_esc(parent.author_display_name || parent.author_username)}</span>
        <span class="comment-ref-text">${_esc((parent.content || "").slice(0, 80))}</span>
      </div>
    ` : "";
    const row = `
      <div class="comment-row" id="${_attr(this.uid + "_c_" + c.id)}">
        <span class="comment-avatar">${c.author_avatar ? `<img src="${_attr(c.author_avatar)}" alt="">` : `<span>${_esc(name[0]?.toUpperCase() || "?")}</span>`}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span class="comment-name">${_esc(name)}</span>
            <span class="comment-meta">${when}${c.edited_at ? " (edited)" : ""}</span>
          </div>
          ${isEditing ? `
            <textarea data-edit-input="${_attr(c.id)}" style="width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px">${_esc(c.content)}</textarea>
            <div style="display:flex;gap:8px;margin-top:6px">
              <button type="button" data-edit-save="${_attr(c.id)}" style="font-size:11.5px;color:var(--color-accent);background:none;border:none;cursor:pointer">${t("comments_save")}</button>
              <button type="button" data-edit-cancel="${_attr(c.id)}" style="font-size:11.5px;color:var(--color-muted);background:none;border:none;cursor:pointer">${t("comments_cancel")}</button>
            </div>
          ` : `
            <div class="comment-body">${renderCommentMarkdown(c.content)}</div>
            ${commentAttachmentHtml(c)}
          `}
          ${reactionEntries.length ? `
            <div class="comment-reactions">
              ${reactionEntries.map(([emoji, count]) => {
                const isSuper = (c.reaction_supers || {})[emoji];
                const isMine = (c.my_reactions || []).includes(emoji);
                if (isSuper) {
                  return `
                  <button type="button" class="comment-reaction-super" data-react-toggle="${_attr(c.id)}" data-emoji="${_attr(emoji)}" data-emoji-value="${_attr(emoji)}"
                    data-tooltip="${t("comments_long_press_to_super_react")}">
                    <span class="comment-reaction-super-coin">${emoji}</span>
                    <span class="comment-reaction-super-count">${count}</span>
                  </button>`;
                }
                return `
                <button type="button" data-react-toggle="${_attr(c.id)}" data-emoji="${_attr(emoji)}"
                  class="comment-reaction-pill${isMine ? " mine" : ""}"
                  data-tooltip="${t("comments_long_press_to_super_react")}">${emoji} ${count}</button>
              `;
              }).join("")}
            </div>
          ` : ""}
          <div class="comment-actions">
            <button type="button" class="comment-icon-btn" data-like="${_attr(c.id)}" data-tooltip="${t("comments_like")}" aria-label="${t("comments_like")}" style="color:${c.liked_by_me ? "var(--color-accent)" : "var(--color-muted)"}">
              <svg viewBox="0 0 24 24" fill="${c.liked_by_me ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
              ${c.like_count ? `<span style="font-size:11px;margin-left:3px">${c.like_count}</span>` : ""}
            </button>
            <button type="button" class="comment-icon-btn" data-react-open="${_attr(c.id)}" data-tooltip="${t("comments_react")}" aria-label="${t("comments_react")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </button>
            ${ME ? `<button type="button" class="comment-icon-btn" data-reply="${_attr(c.id)}" data-tooltip="${t("comments_reply")}" aria-label="${t("comments_reply")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            </button>` : ""}
            ${mine && !isEditing ? `
              <span class="sep"></span>
              <button type="button" class="comment-icon-btn" data-edit="${_attr(c.id)}" data-tooltip="${t("comments_edit")}" aria-label="${t("comments_edit")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            ` : ""}
            ${mine ? `
              <button type="button" class="comment-icon-btn" data-delete="${_attr(c.id)}" data-tooltip="${t("comments_delete")}" aria-label="${t("comments_delete")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            ` : ""}
          </div>
        </div>
      </div>
    `;
    return depth > 0
      ? `<div class="comment-block" data-depth="${depth}" style="--depth:${depth}">${refHtml}${row}</div>`
      : row;
  }

  wireRows() {
    const list = this.container.querySelector(`#${this.uid}_list`);
    if (!list) return;
    list.querySelectorAll("[data-like]").forEach((b) => b.onclick = () => this.toggleLike(b.dataset.like));
    list.querySelectorAll("[data-reply]").forEach((b) => b.onclick = () => this.startReply(b.dataset.reply));
    list.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { this.editing = b.dataset.edit; this.renderList(); });
    list.querySelectorAll("[data-edit-cancel]").forEach((b) => b.onclick = () => { this.editing = null; this.renderList(); });
    list.querySelectorAll("[data-edit-save]").forEach((b) => b.onclick = () => this.saveEdit(b.dataset.editSave));
    list.querySelectorAll("[data-delete]").forEach((b) => b.onclick = () => this.deleteComment(b.dataset.delete));
    list.querySelectorAll("[data-react-open]").forEach((b) => b.onclick = () => this.openReactionPicker(b.dataset.reactOpen, b));
    list.querySelectorAll("[data-react-toggle]").forEach((b) => this.wireLongPress(b, (isSuper) => this.toggleReaction(b.dataset.reactToggle, b.dataset.emoji, isSuper)));
    list.querySelectorAll("[data-jump]").forEach((b) => b.onclick = () => {
      const target = list.querySelector(`#${CSS.escape(this.uid + "_c_" + b.dataset.jump)}`);
      if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.classList.add("comment-row-flash"); setTimeout(() => target.classList.remove("comment-row-flash"), 900); }
    });
    this.paintSuperReactions();
  }

  async paintSuperReactions() {
    const list = this.container?.querySelector(`#${this.uid}_list`);
    if (!list) return;
    for (const el of list.querySelectorAll(".comment-reaction-super[data-emoji-value]")) {
      const [c1, c2] = await extractEmojiColors(el.dataset.emojiValue);
      el.style.setProperty("--c1", c1);
      el.style.setProperty("--c2", c2);
    }
  }

  findComment(cid) {
    for (const root of this.comments) {
      if (root.id === cid) return root;
      const found = (root.replies || []).find((r) => r.id === cid);
      if (found) return found;
    }
    return null;
  }

  async toggleLike(cid) {
    const c = this.findComment(cid);
    if (!c) return;
    try {
      const res = await api(`/api/comments/${encodeURIComponent(cid)}/like`, { method: c.liked_by_me ? "DELETE" : "POST" });
      c.liked_by_me = res.liked;
      c.like_count = res.like_count;
      this.renderList();
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_update_like"));
    }
  }

  openReactionPicker(cid, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    document.querySelectorAll(".comment-reaction-pop").forEach((el) => el.remove());
    const pop = document.createElement("div");
    pop.className = "comment-reaction-pop";
    pop.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;z-index:200;display:flex;gap:4px;padding:6px;border-radius:10px;background:var(--color-surface);border:1px solid var(--color-line);box-shadow:0 6px 18px rgba(0,0,0,.25)`;
    pop.innerHTML = COMMENT_REACTION_EMOJI.map((e) => `<button type="button" data-pick-emoji="${_attr(e)}" data-tooltip="${t("comments_long_press_to_super_react")}" style="font-size:16px;background:none;border:none;cursor:pointer">${e}</button>`).join("");
    _floatingPopupHost().appendChild(pop);
    pop.querySelectorAll("[data-pick-emoji]").forEach((b) => this.wireLongPress(b, (isSuper) => { this.toggleReaction(cid, b.dataset.pickEmoji, isSuper); pop.remove(); }));
    const closeOnOutside = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", closeOnOutside); } };
    setTimeout(() => document.addEventListener("click", closeOnOutside), 0);
  }

  wireLongPress(el, onFire) {
    const HOLD_MS = 450;
    let timer = null;
    let fired = false;
    const start = () => {
      fired = false;
      timer = setTimeout(() => {
        fired = true;
        el.classList.add("comment-reaction-charging");
        onFire(true);
      }, HOLD_MS);
    };
    const cancel = () => {
      clearTimeout(timer);
      el.classList.remove("comment-reaction-charging");
    };
    const end = () => {
      cancel();
      if (!fired) onFire(false);
    };
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("click", (e) => { if (fired) e.preventDefault(); });
  }

  async toggleReaction(cid, emoji, isSuper = false) {
    const c = this.findComment(cid);
    if (!c) return;
    const already = (c.my_reactions || []).includes(emoji);
    try {
      const updated = await api(`/api/comments/${encodeURIComponent(cid)}/react`, {
        method: already && !isSuper ? "DELETE" : "POST",
        body: JSON.stringify({ emoji, super: isSuper }),
      });
      Object.assign(c, updated);
      this.renderList();
      if (isSuper) toast(`⚡ ${t("comments_super_reacted_with")} ${emoji}`);
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_react"));
    }
  }

  startReply(cid) {
    this.replyTo = cid;
    const banner = this.container.querySelector(`#${this.uid}_ref`);
    if (banner) {
      const c = this.findComment(cid);
      banner.style.display = "flex";
      banner.querySelector("span").textContent = `${t("comments_replying_to")} ${c?.author_display_name || c?.author_username || t("comments_comment_fallback_noun")}`;
    }
    this.container.querySelector(`#${this.uid}_input`)?.focus();
  }

  cancelReply() {
    this.replyTo = null;
    const banner = this.container?.querySelector(`#${this.uid}_ref`);
    if (banner) banner.style.display = "none";
  }

  async saveEdit(cid) {
    const textarea = this.container.querySelector(`[data-edit-input="${cid}"]`);
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) { errorToast(t("comments_comment_cannot_be_empty")); return; }
    try {
      const updated = await api(`/api/comments/${encodeURIComponent(cid)}`, { method: "PUT", body: JSON.stringify({ content }) });
      const c = this.findComment(cid);
      if (c) Object.assign(c, updated);
      this.editing = null;
      this.renderList();
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_save_edit"));
    }
  }

  async deleteComment(cid) {
    if (!(await confirmDialog(t("comments_delete_this_comment_confirm")))) return;
    try {
      await api(`/api/comments/${encodeURIComponent(cid)}`, { method: "DELETE" });
      toast(t("comments_comment_deleted"));
      await this.load();
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_delete_comment"));
    }
  }

  composerHtml() {
    return `
      <div class="comment-composer">
        <span class="comment-avatar">${ME?.avatar ? `<img src="${_attr(ME.avatar)}" alt="">` : `<span>${_esc((ME?.display_name || ME?.username || "?")[0]?.toUpperCase() || "?")}</span>`}</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
          <div id="${this.uid}_ref" style="display:none;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:8px;background:var(--color-surface-2);font-size:12px;color:var(--color-sec)">
            <span></span>
            <button type="button" id="${this.uid}_refCancel" style="background:none;border:none;color:var(--color-muted);cursor:pointer">&times;</button>
          </div>
          <div id="${this.uid}_attach" style="display:none;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:8px;background:var(--color-surface-2);font-size:12px;color:var(--color-sec)">
            <span></span>
            <button type="button" id="${this.uid}_attachClear" style="background:none;border:none;color:var(--color-muted);cursor:pointer">&times;</button>
          </div>
          <div class="comment-composer-pill" style="position:relative">
            <label class="comment-composer-plus" data-tooltip="${t("comments_attach_a_file")}" aria-label="${t("comments_attach_a_file")}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              <input type="file" id="${this.uid}_file" accept="image/*,video/mp4,video/webm,.txt,.md,.py,.js,.ts,.json" hidden>
            </label>
            <input type="text" id="${this.uid}_input" class="comment-composer-input" placeholder="${t("comments_write_a_comment_placeholder")}">
            <button type="button" id="${this.uid}_emoji" class="comment-composer-emoji" data-tooltip="${t("comments_emoji_gifs_and_stickers")}" aria-label="${t("comments_emoji_gifs_and_stickers")}">🙂</button>
          </div>
          <div id="${this.uid}_media"></div>
        </div>
        <button type="button" id="${this.uid}_send" class="comment-composer-send" data-feature="comments" data-tooltip="${t("comments_send")}" aria-label="${t("comments_send")}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    `;
  }

  wireComposer() {
    const input = this.container.querySelector(`#${this.uid}_input`);
    const sendBtn = this.container.querySelector(`#${this.uid}_send`);
    sendBtn.onclick = () => this.send();
    input.addEventListener("keydown", (e) => {
      if (this.mentionOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        this.handleMentionKey(e);
        return;
      }
      if (e.key === "Enter") this.send();
    });
    input.addEventListener("input", () => this.updateMentionMenu(input));
    input.addEventListener("blur", () => setTimeout(() => this.closeMentionMenu(), 150));
    this.container.querySelector(`#${this.uid}_refCancel`).onclick = () => this.cancelReply();
    this.container.querySelector(`#${this.uid}_attachClear`).onclick = () => this.clearAttachment();
    this.container.querySelector(`#${this.uid}_file`).onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) this.uploadAttachment(file);
    };
    this.container.querySelector(`#${this.uid}_emoji`).onclick = () => this.toggleMediaPanel();
  }

  threadParticipants() {
    const seen = new Map();
    const walk = (list) => (list || []).forEach((c) => {
      if (c.author_username && !seen.has(c.author_username.toLowerCase())) {
        seen.set(c.author_username.toLowerCase(), {
          username: c.author_username, display_name: c.author_display_name, avatar: c.author_avatar });
      }
      walk(c.replies);
    });
    walk(this.comments);
    return [...seen.values()];
  }

  async updateMentionMenu(input) {
    const upto = input.value.slice(0, input.selectionStart);
    const m = upto.match(/(?:^|\s)@([A-Za-z0-9_-]{1,32})$/);
    if (!m) { this.closeMentionMenu(); return; }
    const query = m[1].toLowerCase();
    this.mentionQuery = query;
    const hit = (u) => u.username?.toLowerCase().includes(query) || (u.display_name || "").toLowerCase().includes(query);
    const byName = new Map();
    for (const u of this.threadParticipants()) if (hit(u)) byName.set(u.username.toLowerCase(), u);
    try {
      for (const u of await api(`/api/users?q=${encodeURIComponent(query)}`)) {
        if (hit(u) && !byName.has(u.username.toLowerCase())) byName.set(u.username.toLowerCase(), u);
      }
    } catch {}
    if (this.mentionQuery !== query) return;
    const matches = [...byName.values()].filter((u) => u.username.toLowerCase() !== ME?.username?.toLowerCase()).slice(0, 6);
    if (!matches.length) { this.closeMentionMenu(); return; }
    this.showMentionMenu(input, matches);
  }

  showMentionMenu(input, matches) {
    this.closeMentionMenu();
    this.mentionMatches = matches;
    this.mentionIndex = 0;
    this.mentionOpen = true;
    const rect = input.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "dropdown-menu open";
    menu.style.cssText = `position:fixed;top:auto;right:auto;left:${rect.left}px;bottom:${window.innerHeight - rect.top + 4}px;min-width:${Math.max(180, rect.width / 2)}px;max-height:220px;overflow-y:auto;z-index:10050`;
    menu.innerHTML = matches.map((u, i) => `
      <button type="button" class="dropdown-item${i === 0 ? " active" : ""}" data-mention-pick="${_attr(u.username)}" style="display:flex;align-items:center;gap:8px">
        <span class="comment-avatar" style="width:22px;height:22px;flex:none">${u.avatar ? `<img src="${_attr(u.avatar)}" alt="">` : `<span>${_esc((u.display_name || u.username)[0]?.toUpperCase() || "?")}</span>`}</span>
        <span style="min-width:0"><span class="text-ink">${_esc(u.display_name || u.username)}</span> <span class="text-muted" style="font-size:11px">@${_esc(u.username)}</span></span>
      </button>
    `).join("");
    menu.querySelectorAll("[data-mention-pick]").forEach((btn) => {
      btn.onmousedown = (e) => { e.preventDefault(); this.pickMention(input, btn.dataset.mentionPick); };
    });
    _floatingPopupHost().appendChild(menu);
    this.mentionMenu = menu;
  }

  handleMentionKey(e) {
    if (e.key === "Escape") { e.preventDefault(); this.closeMentionMenu(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this.moveMention(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); this.moveMention(-1); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const input = this.container.querySelector(`#${this.uid}_input`);
      this.pickMention(input, this.mentionMatches[this.mentionIndex].username);
    }
  }

  moveMention(delta) {
    if (!this.mentionMenu) return;
    const items = [...this.mentionMenu.querySelectorAll("[data-mention-pick]")];
    items[this.mentionIndex]?.classList.remove("active");
    this.mentionIndex = (this.mentionIndex + delta + items.length) % items.length;
    items[this.mentionIndex]?.classList.add("active");
    items[this.mentionIndex]?.scrollIntoView({ block: "nearest" });
  }

  pickMention(input, username) {
    const start = input.selectionStart;
    const before = input.value.slice(0, start).replace(/@([A-Za-z0-9_-]{0,32})$/, `@${username} `);
    input.value = before + input.value.slice(start);
    const pos = before.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    this.closeMentionMenu();
  }

  closeMentionMenu() {
    this.mentionOpen = false;
    this.mentionMenu?.remove();
    this.mentionMenu = null;
  }

  async uploadAttachment(file) {
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      const res = await api("/api/comments/upload-image", { method: "POST", body: fd });
      this.pendingAttachment = res;
      const preview = this.container.querySelector(`#${this.uid}_attach`);
      if (preview) {
        preview.style.display = "flex";
        preview.querySelector("span").textContent = `${t("comments_attached_prefix")} ${file.name}`;
      }
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_upload_attachment"));
    }
  }

  clearAttachment() {
    this.pendingAttachment = null;
    const preview = this.container?.querySelector(`#${this.uid}_attach`);
    if (preview) preview.style.display = "none";
  }

  async send(overrideAttachment) {
    if (this.sending) return;
    const input = this.container.querySelector(`#${this.uid}_input`);
    const content = overrideAttachment ? "" : input.value.trim();
    const attach = overrideAttachment || this.pendingAttachment;
    if (!content && !attach) return;
    const body = { target_type: this.targetType, target_id: this.targetId, content, parent_id: this.replyTo || null };
    if (attach) { body.image = attach.image; body.attachment_kind = attach.attachment_kind; }
    this.sending = true;
    const sendBtn = this.container.querySelector(`#${this.uid}_send`);
    if (sendBtn) sendBtn.disabled = true;
    input.disabled = true;
    try {
      await api("/api/comments", { method: "POST", body: JSON.stringify(body) });
      input.value = "";
      this.cancelReply();
      this.clearAttachment();
      await this.load();
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_post_comment"));
    } finally {
      this.sending = false;
      if (sendBtn) sendBtn.disabled = false;
      input.disabled = false;
    }
  }

  insertAtCursor(text) {
    const input = this.container.querySelector(`#${this.uid}_input`);
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    input.focus();
    const caret = start + text.length;
    input.setSelectionRange(caret, caret);
  }

  toggleMediaPanel() {
    const host = this.container.querySelector(`#${this.uid}_media`);
    if (!host) return;
    if (host.dataset.open === "1") {
      host.innerHTML = "";
      host.dataset.open = "0";
      return;
    }
    host.dataset.open = "1";
    host.innerHTML = `
      <div class="comment-media-panel">
        <div class="comment-media-tabs">
          <button type="button" class="comment-media-tab active" data-tab="gif">${t("comments_gifs_tab")}</button>
          <button type="button" class="comment-media-tab" data-tab="sticker">${t("comments_stickers_tab")}</button>
          <button type="button" class="comment-media-tab" data-tab="emoji">${t("comments_emoji_tab")}</button>
        </div>
        <div class="comment-media-body"></div>
      </div>
    `;
    const panel = host.querySelector(".comment-media-panel");
    panel.querySelectorAll("[data-tab]").forEach((btn) => btn.onclick = () => {
      panel.querySelectorAll(".comment-media-tab").forEach((t) => t.classList.toggle("active", t === btn));
      this.loadMediaTab(panel, btn.dataset.tab);
    });
    this.loadMediaTab(panel, "gif");
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  loadMediaTab(panel, tab) {
    const body = panel.querySelector(".comment-media-body");
    if (tab === "gif") {
      body.innerHTML = `
        <div class="comment-media-search"><input type="text" id="${this.uid}_gifSearch" placeholder="${t("comments_search_giphy_placeholder")}"></div>
        <div class="comment-gif-grid" id="${this.uid}_gifGrid"><p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);padding:8px">${t("comments_loading")}</p></div>
        <div class="comment-media-footer"><span>${t("comments_powered_by_giphy")}</span><span>${t("comments_rated_pg13")}</span></div>
      `;
      this.loadGifs(panel, "");
      body.querySelector(`#${this.uid}_gifSearch`).oninput = (e) => this.loadGifs(panel, e.target.value);
    } else if (tab === "sticker") {
      const cache = _EMOJI_CACHE || { stickers: [] };
      body.innerHTML = cache.stickers.length
        ? `<div class="comment-picker-grid">${cache.stickers.map((s) =>
            `<button type="button" class="comment-picker-cell" data-sticker="${_attr(s.image)}" title="${_attr(":" + s.shortcode + ":")}"><img src="${_attr(s.image)}" alt=""></button>`
          ).join("")}</div>`
        : `<p style="font-size:12px;color:var(--color-muted);padding:12px">${t("comments_no_stickers_available_yet")}</p>`;
      body.querySelectorAll("[data-sticker]").forEach((b) => b.onclick = () => this.sendMediaPick({ image: b.dataset.sticker, attachment_kind: "image" }));
    } else {
      const cache = _EMOJI_CACHE || { emojis: [] };
      const unicode = COMMENT_PICKER_EMOJI.map((e) =>
        `<button type="button" class="comment-picker-cell" data-emoji="${_attr(e)}">${e}</button>`).join("");
      const custom = cache.emojis.map((em) =>
        `<button type="button" class="comment-picker-cell" data-shortcode="${_attr(":" + em.shortcode + ":")}" title="${_attr(":" + em.shortcode + ":")}"><img src="${_attr(em.image)}" alt=""></button>`).join("");
      body.innerHTML = `<div class="comment-picker-grid">${unicode}${custom}</div>`;
      body.querySelectorAll("[data-emoji]").forEach((b) => b.onclick = () => this.insertAtCursor(b.dataset.emoji));
      body.querySelectorAll("[data-shortcode]").forEach((b) => b.onclick = () => this.insertAtCursor(b.dataset.shortcode + " "));
    }
  }

  async loadGifs(panel, q) {
    const grid = panel.querySelector(`#${this.uid}_gifGrid`);
    if (!grid) return;
    const token = (this._gifToken = (this._gifToken || 0) + 1);
    grid.innerHTML = `<p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);padding:8px">${t("comments_loading")}</p>`;
    try {
      const query = q.trim();
      const endpoint = query ? `/api/comments/giphy/search?q=${encodeURIComponent(query)}` : `/api/comments/giphy/trending`;
      const { results } = await api(endpoint);
      if (token !== this._gifToken || !grid.isConnected) return;
      grid.innerHTML = results.length
        ? results.map((g) => `<button type="button" class="comment-gif-cell" data-gif-id="${_attr(g.id)}"><img src="${_attr(g.preview_url)}" alt="${_attr(g.title)}" loading="lazy"></button>`).join("")
        : `<p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);padding:8px">${t("comments_no_results")}</p>`;
      grid.querySelectorAll("[data-gif-id]").forEach((b) => b.onclick = () => this.sendGif(b.dataset.gifId, panel));
    } catch (err) {
      if (token !== this._gifToken) return;
      grid.innerHTML = `<p style="grid-column:1/-1;font-size:12px;color:var(--color-warn)">${_esc(err.message || t("comments_couldnt_load_gifs"))}</p>`;
    }
  }

  async sendGif(gifId, panel) {
    if (this.sending) return;
    const grid = panel?.querySelector(`#${this.uid}_gifGrid`);
    if (grid) grid.style.opacity = ".5";
    try {
      const res = await api("/api/comments/giphy/send", { method: "POST", body: JSON.stringify({ id: gifId }) });
      await this.sendMediaPick(res);
    } catch (err) {
      errorToast(err.message || t("comments_couldnt_send_that_gif"));
      if (grid) grid.style.opacity = "";
    }
  }

  async sendMediaPick(attachment) {
    const host = this.container.querySelector(`#${this.uid}_media`);
    if (host) { host.innerHTML = ""; host.dataset.open = "0"; }
    await this.send(attachment);
  }
}

function commentCountSpanHtml(panelUid) {
  return `<span data-comment-count="${_attr(panelUid)}"></span>`;
}

async function openCommentsModal(targetType, targetId) {
  const panel = new CommentsPanel(targetType, targetId);
  const layer = openModal(`<h3>${t("comments_comments_heading")}</h3><div id="${panel.uid}_mount"></div>`);
  panel.mount(layer.querySelector(`#${panel.uid}_mount`));
}
