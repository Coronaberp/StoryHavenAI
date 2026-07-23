"use strict";

function symposiumMd(text) {
  try {
    const div = document.createElement("div");
    div.innerHTML = DOMPurify.sanitize(marked.parse(String(text || ""), { gfm: true, breaks: true }));
    return div.innerHTML;
  } catch {
    return _esc(text);
  }
}

function timeAgo(ts) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [label, secs] of units) {
    const n = Math.floor(seconds / secs);
    if (n >= 1) return `${n}${label} ago`;
  }
  return t("symposium_time_just_now");
}

const SYM_HOT_THRESHOLD = 5;

class ExploreForumView {
  constructor() {
    this.threads = [];
    this.categories = [];
    this.category = "";
    this.loading = true;
    this.error = "";
    this.sort = "new";
    this.pollId = null;
    this.q = "";
    this.authorFilters = [];
  }

  allAuthors() {
    return [...new Set(this.threads.map((t) => t.author_username).filter(Boolean))].sort();
  }

  visibleThreads() {
    return this.threads.filter((th) => {
      if (this.authorFilters.length && !this.authorFilters.includes(th.author_username)) return false;
      if (!this.q) return true;
      const q = this.q.toLowerCase();
      return (th.title || "").toLowerCase().includes(q) || (th.content || "").toLowerCase().includes(q);
    });
  }

  addAuthorFilter(name) {
    if (!this.authorFilters.includes(name)) this.authorFilters = [...this.authorFilters, name];
    this.render();
  }

  removeAuthorFilter(name) {
    this.authorFilters = this.authorFilters.filter((a) => a !== name);
    this.render();
  }

  async mount(main) {
    this.main = main;
    this.render();
    await this.load();
    this.pollId = setInterval(() => this.silentRefresh(), 12000);
  }

  async silentRefresh() {
    if (!document.body.contains(this.main)) { clearInterval(this.pollId); return; }
    try {
      const params = new URLSearchParams({ sort: this.sort });
      if (this.category) params.set("category", this.category);
      const fresh = await api(`/api/forum/threads?${params}`);
      const byId = new Map(fresh.map((t) => [t.id, t]));
      this.threads.forEach((th) => {
        const f = byId.get(th.id);
        if (!f) return;
        th.score = f.score;
        th.reply_count = f.reply_count;
        th.my_vote = f.my_vote;
        this.paintVote(this.main, th);
        const replyCount = this.main.querySelector(`[data-reply-count="${CSS.escape(th.id)}"]`);
        if (replyCount) replyCount.textContent = th.reply_count;
      });
    } catch {}
  }

  async load() {
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const params = new URLSearchParams({ sort: this.sort });
      if (this.category) params.set("category", this.category);
      this.threads = await api(`/api/forum/threads?${params}`);
      if (!this.category) {
        this.categories = [...new Set(this.threads.map((t) => t.category).filter(Boolean))];
      }
    } catch (err) {
      this.error = err.message || t("symposium_load_error");
      this.threads = [];
    }
    this.loading = false;
    this.render();
  }

  async castVote(th, value, container) {
    if (!ME) return;
    const prevVote = th.my_vote;
    const nextVote = prevVote === value ? 0 : value;
    th.score += nextVote - prevVote;
    th.my_vote = nextVote;
    this.paintVote(container, th);
    try {
      if (nextVote === 0) await api(`/api/forum/threads/${encodeURIComponent(th.id)}/unvote`, { method: "POST" });
      else await api(`/api/forum/threads/${encodeURIComponent(th.id)}/vote`, { method: "POST", body: JSON.stringify({ value: nextVote }) });
    } catch (err) {
      th.score += prevVote - nextVote;
      th.my_vote = prevVote;
      this.paintVote(container, th);
      toast(err.message || t("symposium_vote_update_error"));
    }
  }

  paintVote(container, th) {
    const up = container.querySelector(`[data-vote-up="${CSS.escape(th.id)}"]`);
    const down = container.querySelector(`[data-vote-down="${CSS.escape(th.id)}"]`);
    up?.classList.toggle("on", th.my_vote === 1);
    down?.classList.toggle("on", th.my_vote === -1);
    const score = container.querySelector(`[data-score="${CSS.escape(th.id)}"]`);
    if (score) score.textContent = th.score;
  }

  voteBlockHtml(th) {
    return `
      <div class="sym-votes">
        <button type="button" class="sym-vote-btn${th.my_vote === 1 ? " on" : ""}" data-vote-up="${_esc(th.id)}" aria-label="${_attr(t("symposium_upvote_aria"))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l7 8h-4.5v6h-5v-6H5z"/></svg>
        </button>
        <span class="sym-vote-score" data-score="${_esc(th.id)}">${th.score}</span>
        <button type="button" class="sym-vote-btn${th.my_vote === -1 ? " on down" : ""}" data-vote-down="${_esc(th.id)}" aria-label="${_attr(t("symposium_downvote_aria"))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l-7-8h4.5V5h5v6H19z"/></svg>
        </button>
      </div>
    `;
  }

  rowHtml(th) {
    const hot = th.score >= SYM_HOT_THRESHOLD;
    return `
      <div class="sym-card" data-tid="${_esc(th.id)}">
        ${this.voteBlockHtml(th)}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${th.category ? `<span class="sym-tag">${_esc(th.category)}</span>` : ""}
            ${hot ? `<span class="sym-hot">▲ ${t("symposium_hot_badge")}</span>` : ""}
          </div>
          <div class="sym-row-title">${_esc(th.title)}</div>
          <div class="sym-meta" style="display:flex;align-items:center;gap:5px">
            <span>@${_esc(th.author_username)}</span>
            <span>·</span>
            <span>${timeAgo(th.created)}</span>
            <span style="display:inline-flex;align-items:center;gap:3px;margin-left:4px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><path d="M4 5h16v10H9l-4 3.5V15H4z"/></svg>
              <span data-reply-count="${_esc(th.id)}">${th.reply_count}</span>
            </span>
          </div>
        </div>
      </div>
    `;
  }

  newThreadModalHtml() {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;max-width:480px">
        <div class="font-display" style="font-size:17px;font-weight:600;color:var(--color-ink)">${t("symposium_new_thread")}</div>
        <input id="symTitle" type="text" placeholder="${_attr(t("symposium_title_placeholder"))}" maxlength="200"
          style="padding:10px 12px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
        <input id="symCategory" type="text" placeholder="${_attr(t("symposium_category_optional_placeholder"))}" maxlength="40"
          style="padding:10px 12px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
        <textarea id="symBody" placeholder="${_attr(t("symposium_body_placeholder"))}" rows="6" maxlength="10000"
          style="padding:10px 12px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px;resize:vertical"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button type="button" id="symCancel" class="tool" style="border:1px solid var(--color-line-2);border-radius:8px;padding:7px 14px">${t("symposium_cancel")}</button>
          <button type="button" id="symPost" class="tool" data-feature="forum" style="border:1px solid var(--color-accent);border-radius:8px;padding:7px 14px;background:var(--color-accent);color:var(--color-paper-base,#0C0C0E);font-weight:600">${t("symposium_post")}</button>
        </div>
      </div>
    `;
  }

  openNewThreadModal() {
    openModal(this.newThreadModalHtml());
    document.getElementById("symCancel").onclick = () => closeTopModal();
    document.getElementById("symPost").onclick = async () => {
      const title = document.getElementById("symTitle").value.trim();
      const category = document.getElementById("symCategory").value.trim();
      const content = document.getElementById("symBody").value.trim();
      if (!title || !content) { toast(t("symposium_title_body_required")); return; }
      const postBtn = document.getElementById("symPost");
      if (postBtn.disabled) return;
      postBtn.disabled = true;
      try {
        const th = await api("/api/forum/threads", {
          method: "POST",
          body: JSON.stringify({ title, content, category }),
        });
        closeTopModal();
        navigate(`/explore/forum/${th.id}`);
      } catch (err) {
        toast(err.message || t("symposium_post_thread_error"));
      } finally {
        postBtn.disabled = false;
      }
    };
  }

  render() {
    const visible = this.visibleThreads();
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        ${pageHeaderHtml("Explore", "Forum", t("ph_forum_title"), t("ph_forum_sub"))}
        ${ME ? `
          <button type="button" id="symNewBtn" class="sym-cta">
            <span class="sym-cta-icon">+</span>
            <span>${t("symposium_start_a_discussion")}</span>
          </button>
        ` : ""}
        <div id="symSearchBox" style="position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
          ${this.authorFilters.map((a) => `
            <span class="inline-pill pill-creator">@${_esc(a)}<span class="x" data-remove-author="${_esc(a)}">&times;</span></span>
          `).join("")}
          <input type="text" id="symSearch" value="${_esc(this.q)}" placeholder="${this.authorFilters.length ? "" : _attr(t("symposium_search_placeholder"))}"
            style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
          <div id="symSuggest" class="dropdown-menu" style="left:0;right:0;top:calc(100% + 4px)"></div>
        </div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">
          <button type="button" class="filter-chip${this.category === "" ? " on" : ""}" data-category="">${t("symposium_all")}</button>
          ${this.categories.map((c) => `<button type="button" class="filter-chip${this.category === c ? " on" : ""}" data-category="${_esc(c)}">${_esc(c)}</button>`).join("")}
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" data-sort="new" class="tool" style="border:1px solid var(--color-line-2);border-radius:999px;padding:5px 12px;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;${this.sort === "new" ? "background:var(--color-accent);color:var(--color-paper-base,#0C0C0E);border-color:var(--color-accent)" : "color:var(--color-sec)"}">${t("symposium_sort_new")}</button>
          <button type="button" data-sort="top" class="tool" style="border:1px solid var(--color-line-2);border-radius:999px;padding:5px 12px;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;${this.sort === "top" ? "background:var(--color-accent);color:var(--color-paper-base,#0C0C0E);border-color:var(--color-accent)" : "color:var(--color-sec)"}">${t("symposium_sort_top")}</button>
        </div>
        ${this.loading ? `<p style="color:var(--color-sec);font-size:13px">${t("symposium_loading")}</p>` : ""}
        ${this.error ? `<p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>` : ""}
        ${!this.loading && !this.error && !visible.length ? `<p style="color:var(--color-sec);font-size:13px">${this.threads.length ? t("symposium_no_search_matches") : t("symposium_no_threads_yet")}</p>` : ""}
        <div style="display:flex;flex-direction:column;gap:10px">${visible.map((th) => this.rowHtml(th)).join("")}</div>
      </div>
    `;
    this.main.querySelectorAll("[data-sort]").forEach((btn) => {
      btn.onclick = () => {
        this.sort = btn.dataset.sort;
        this.load();
      };
    });
    this.main.querySelectorAll("[data-category]").forEach((btn) => {
      btn.onclick = () => {
        this.category = btn.dataset.category;
        this.load();
      };
    });
    this.main.querySelectorAll("[data-remove-author]").forEach((x) => {
      x.onclick = (e) => { e.stopPropagation(); this.removeAuthorFilter(x.dataset.removeAuthor); };
    });
    const search = this.main.querySelector("#symSearch");
    let searchTimer;
    search.oninput = () => {
      this.updateAuthorSuggestions();
      if (search.value.startsWith("@")) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.q = search.value.trim();
        this.render();
      }, 250);
    };
    search.onkeydown = (e) => {
      if (e.key === "Backspace" && search.value === "" && this.authorFilters.length) {
        e.preventDefault();
        const removed = this.authorFilters[this.authorFilters.length - 1];
        this.authorFilters = this.authorFilters.slice(0, -1);
        toast(`Removed @${removed} filter`);
        this.render();
        return;
      }
      if (e.key !== "Enter") return;
      const val = search.value.trim();
      if (val.startsWith("@") && val.length > 1) {
        this.addAuthorFilter(val.slice(1));
        search.value = "";
        this.q = "";
      }
    };
    this.main.querySelectorAll(".sym-card").forEach((el) => {
      el.onclick = () => navigate(`/explore/forum/${el.dataset.tid}`);
    });
    this.main.querySelectorAll("[data-vote-up]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const th = this.threads.find((t) => t.id === btn.dataset.voteUp);
        if (th) this.castVote(th, 1, this.main);
      };
    });
    this.main.querySelectorAll("[data-vote-down]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const th = this.threads.find((t) => t.id === btn.dataset.voteDown);
        if (th) this.castVote(th, -1, this.main);
      };
    });
    const newBtn = document.getElementById("symNewBtn");
    if (newBtn) newBtn.onclick = () => this.openNewThreadModal();
  }

  updateAuthorSuggestions() {
    const box = this.main.querySelector("#symSuggest");
    const search = this.main.querySelector("#symSearch");
    if (!box || !search) return;
    const val = search.value;
    if (!val.startsWith("@")) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const q = val.slice(1).toLowerCase();
    const matches = this.allAuthors().filter((a) => !this.authorFilters.includes(a) && a.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { box.classList.remove("open"); box.innerHTML = ""; return; }
    box.innerHTML = matches.map((a) => `<button type="button" class="dropdown-item" data-pick-author="${_esc(a)}">@${_esc(a)}</button>`).join("");
    box.classList.add("open");
    box.querySelectorAll("[data-pick-author]").forEach((btn) => btn.onclick = () => {
      search.value = "";
      box.classList.remove("open");
      this.addAuthorFilter(btn.dataset.pickAuthor);
    });
  }
}

class ExploreForumThreadView {
  constructor(tid) {
    this.tid = tid;
    this.thread = null;
    this.error = "";
    this.repliesLoading = true;
    this.pollId = null;
    this.commentsPanel = new CommentsPanel("thread", tid);
    this.commentsPanel.uid = `sym_${tid}`;
  }

  async mount(main) {
    this.main = main;
    this.render();
    try {
      this.thread = await api(`/api/forum/threads/${encodeURIComponent(this.tid)}`);
    } catch (err) {
      this.error = err.message || t("symposium_thread_not_found");
      this.render();
      return;
    }
    this.render();
    this.loadReplies();
    this.pollId = setInterval(() => this.silentRefresh(), 12000);
  }

  async silentRefresh() {
    if (!document.body.contains(this.main)) { clearInterval(this.pollId); return; }
    try {
      const fresh = await api(`/api/forum/threads/${encodeURIComponent(this.tid)}`);
      this.thread.score = fresh.score;
      this.thread.my_vote = fresh.my_vote;
      this.thread.reply_count = fresh.reply_count;
      const scoreEl = this.main.querySelector("#symVoteScore");
      if (scoreEl) scoreEl.textContent = this.thread.score;
      this.main.querySelector("#symVoteUp")?.classList.toggle("on", this.thread.my_vote === 1);
      this.main.querySelector("#symVoteDown")?.classList.toggle("on", this.thread.my_vote === -1);
      const replyMeta = this.main.querySelector("#symReplyCount");
      if (replyMeta) replyMeta.textContent = `${this.thread.reply_count} ${this.thread.reply_count === 1 ? "reply" : "replies"}`;
    } catch {}
  }

  async loadReplies() {
    this.repliesLoading = true;
    try {
      await this.commentsPanel.load();
      this.thread.reply_count = this.commentsPanel.count;
      const replyMeta = this.main.querySelector("#symReplyCount");
      if (replyMeta) replyMeta.textContent = `${this.thread.reply_count} ${this.thread.reply_count === 1 ? "reply" : "replies"}`;
    } catch (err) {
      toast(err.message || t("symposium_load_replies_error"));
      this.commentsPanel.comments = [];
    }
    this.repliesLoading = false;
    this.render();
  }

  async castVote(value) {
    if (!ME) return;
    const th = this.thread;
    const prevVote = th.my_vote;
    const nextVote = prevVote === value ? 0 : value;
    th.score += nextVote - prevVote;
    th.my_vote = nextVote;
    this.render();
    try {
      if (nextVote === 0) await api(`/api/forum/threads/${encodeURIComponent(this.tid)}/unvote`, { method: "POST" });
      else await api(`/api/forum/threads/${encodeURIComponent(this.tid)}/vote`, { method: "POST", body: JSON.stringify({ value: nextVote }) });
    } catch (err) {
      th.score += prevVote - nextVote;
      th.my_vote = prevVote;
      this.render();
      toast(err.message || t("symposium_vote_update_error"));
    }
  }

  deleteThread() {
    const layer = openModal(`
      <div style="padding:4px 2px 2px">
        <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 6px">${t("symposium_delete_thread_confirm_title")}</h3>
        <p style="font-size:13px;color:var(--color-sec);margin:0 0 18px">${t("symposium_cannot_be_undone")}</p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="pe-gen-btn" id="symCancelDel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("symposium_keep_it")}</button>
          <button type="button" class="pe-gen-btn" id="symConfirmDel" style="border-color:var(--color-warn);color:var(--color-warn)">${t("symposium_delete")}</button>
        </div>
      </div>
    `);
    layer.querySelector("#symCancelDel").onclick = () => closeModal(layer);
    layer.querySelector("#symConfirmDel").onclick = async () => {
      closeModal(layer);
      try {
        await api(`/api/forum/threads/${encodeURIComponent(this.tid)}`, { method: "DELETE" });
        navigate("/explore/forum");
      } catch (err) {
        toast(err.message || t("symposium_delete_thread_error"));
      }
    };
  }

  render() {
    if (this.error) {
      this.main.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          ${pageHeaderHtml("Explore", "Forum", t("ph_forum_title"), "")}
          <p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>
        </div>
      `;
      return;
    }
    if (!this.thread) {
      this.main.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          ${pageHeaderHtml("Explore", "Forum", t("ph_forum_title"), "")}
          <p style="color:var(--color-sec);font-size:13px">${t("symposium_loading")}</p>
        </div>
      `;
      return;
    }
    const th = this.thread;
    const canDelete = ME && (ME.id === th.author_id || ME.is_admin);
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <a href="/explore/forum" onclick="event.preventDefault();navigate('/explore/forum')"
          class="font-mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-accent);cursor:pointer">${dirMark("&larr;", "&rarr;")} ${t("symposium_forum_breadcrumb")}</a>
        ${th.category ? `<span class="sym-tag">${_esc(th.category)}</span>` : ""}
        <h1 class="font-display" style="font-size:24px;font-weight:700;color:var(--color-ink)">${_esc(th.title)}</h1>
        <div class="sym-meta">${t("symposium_by_prefix")} ${_esc(th.author_display_name || th.author_username)} · ${timeAgo(th.created)}</div>
        <div class="sym-body" style="font-size:14px;line-height:1.6;color:var(--color-ink)">${symposiumMd(th.content)}</div>
        <div style="display:flex;gap:10px;align-items:center;padding-top:6px;border-top:1px solid var(--color-line)">
          <div class="sym-votes" style="flex-direction:row">
            <button type="button" id="symVoteUp" class="sym-vote-btn${th.my_vote === 1 ? " on" : ""}" aria-label="${_attr(t("symposium_upvote_aria"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l7 8h-4.5v6h-5v-6H5z"/></svg>
            </button>
            <span class="sym-vote-score" id="symVoteScore">${th.score}</span>
            <button type="button" id="symVoteDown" class="sym-vote-btn${th.my_vote === -1 ? " on down" : ""}" aria-label="${_attr(t("symposium_downvote_aria"))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l-7-8h4.5V5h5v6H19z"/></svg>
            </button>
          </div>
          <span class="sym-meta" id="symReplyCount">${th.reply_count} ${th.reply_count === 1 ? "reply" : "replies"}</span>
          ${canDelete ? `<button type="button" id="symDeleteBtn" class="tool" style="margin-left:auto;border:1px solid var(--color-warn);border-radius:999px;padding:6px 12px;font-size:13px;color:var(--color-warn)">${t("symposium_delete")}</button>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;padding-top:8px">
          <div class="font-mono" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted)">${t("symposium_replies_label")}</div>
          ${this.repliesLoading ? `<p style="color:var(--color-sec);font-size:13px">${t("symposium_loading_replies")}</p>` : ""}
          <div id="symReplyMount"></div>
        </div>
      </div>
    `;
    if (!this.repliesLoading) this.commentsPanel.remount(this.main.querySelector("#symReplyMount"));
    document.getElementById("symVoteUp").onclick = () => this.castVote(1);
    document.getElementById("symVoteDown").onclick = () => this.castVote(-1);
    document.getElementById("symDeleteBtn")?.addEventListener("click", () => this.deleteThread());
  }
}

if (typeof window !== "undefined") {
  window.ExploreForumView = ExploreForumView;
  window.ExploreForumThreadView = ExploreForumThreadView;
}
