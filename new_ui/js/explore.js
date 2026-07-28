"use strict";

function _compendiumTier() {
  const w = window.innerWidth;
  if (w >= 1536) return "ultrawide";
  if (w >= 1024) return "desktop";
  if (w >= 768) return "tablet";
  return "mobile";
}

const _COMPENDIUM_LIMITS = {
  forYou: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  featured: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  creators: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  images: { mobile: 6, tablet: 9, desktop: 12, ultrawide: 18 },
  threads: { mobile: 3, tablet: 4, desktop: 6, ultrawide: 9 },
};

const _KIND_ICONS = {
  character: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1-4.5 3.5-6.5 7-6.5s6 2 7 6.5"/></svg>',
  group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  thread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v10H9l-4 3.5V15H4z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  creator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
};

function _kindIconHtml(kind) {
  return `<span class="foryou-kind-icon">${_KIND_ICONS[kind]}</span>`;
}

function _feedCardHtml(item, charCreatorProfiles) {
  if (item._kind === "character") return `<div style="position:relative">${_kindIconHtml("character")}${characterCardHtml(item, charCreatorProfiles[item.owner_username])}</div>`;
  if (item._kind === "group") return `<div style="position:relative">${_kindIconHtml("group")}${groupTileHtml(item)}</div>`;
  if (item._kind === "thread") return `<div style="position:relative">${_kindIconHtml("thread")}${threadCardHtml(item)}</div>`;
  if (item._kind === "image") return `<div style="position:relative">${_kindIconHtml("image")}${mediaFrameHtml(item, charCreatorProfiles)}</div>`;
  return `<div style="position:relative">${_kindIconHtml("creator")}${feedCreatorCardHtml(item)}</div>`;
}

function _roundRobinMerge(queues) {
  const merged = [];
  let more = true;
  let i = 0;
  while (more) {
    more = false;
    for (const q of queues) {
      if (i < q.length) { merged.push(q[i]); more = true; }
    }
    i++;
  }
  return merged;
}

class ExploreView {
  constructor() {
    this.feedKind = "foryou";
    this.charCreatorProfiles = {};
    this.feed = null;
    this._resizeTimer = null;
    this._onResize = () => {
      if (!this.main?.isConnected) { window.removeEventListener("resize", this._onResize); return; }
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.render(), 150);
    };
  }

  async mount(main) {
    this.main = main;
    this.render();
    const [forYouResult, featuredResult, creators, images, threads] = await Promise.all([
      api("/api/characters?scope=community&rank=for_you").catch(() => ({ items: [], personalized: false })),
      api("/api/characters?scope=community&rank=featured").catch(() => ({ items: [], personalized: false })),
      api("/api/users").catch(() => []),
      api("/api/imagegen/community").catch(() => []),
      api("/api/forum/threads?sort=top").catch(() => []),
    ]);
    const forYouItems = (forYouResult.items || []).map((c) => ({ ...c, _kind: c.kind === "group" ? "group" : "character" }));
    const featuredItems = (featuredResult.items || []).map((c) => ({ ...c, _kind: c.kind === "group" ? "group" : "character" }));
    const creatorItems = creators.map((a) => ({ ...a, _kind: "creator" }));
    const imageItems = images.map((i) => ({ ...i, _kind: "image" }));
    const threadItems = threads.map((th) => ({ ...th, _kind: "thread" }));

    this._forYouChars = forYouItems.slice(0, _COMPENDIUM_LIMITS.forYou.ultrawide);
    this._featuredChars = featuredItems.slice(0, _COMPENDIUM_LIMITS.featured.ultrawide);
    this._creators = creatorItems.slice(0, _COMPENDIUM_LIMITS.creators.ultrawide);
    this._images = imageItems.slice(0, _COMPENDIUM_LIMITS.images.ultrawide);
    this._threads = threadItems.slice(0, _COMPENDIUM_LIMITS.threads.ultrawide);

    this.buildFeeds();
    this.render();
    this.loadCharCreatorProfiles();
    window.addEventListener("resize", this._onResize);
  }

  buildFeeds() {
    this._forYouFeed = _roundRobinMerge([this._forYouChars, this._threads, this._creators, this._images]);
    this._trendingFeed = _roundRobinMerge([this._featuredChars, this._threads, this._creators, this._images]);
    this.applyTierLimit();
  }

  applyTierLimit() {
    const tier = _compendiumTier();
    const caps = { mobile: 12, tablet: 18, desktop: 24, ultrawide: 36 };
    const source = this.feedKind === "trending" ? this._trendingFeed : this._forYouFeed;
    this.feed = (source || []).slice(0, caps[tier]);
  }

  setFeedKind(kind) {
    this.feedKind = kind;
    this.applyTierLimit();
    this.render();
  }

  async loadCharCreatorProfiles() {
    const usernames = [...new Set([
      ...this._forYouChars.map((c) => c.owner_username),
      ...this._featuredChars.map((c) => c.owner_username),
      ...this._images.map((i) => i.owner_username),
    ].filter(Boolean))];
    if (!usernames.length) return;
    const fetched = await Promise.all(usernames.map(async (u) => {
      try { return [u, await api(`/api/users/${encodeURIComponent(u)}`)]; }
      catch { return [u, null]; }
    }));
    fetched.forEach(([u, profile]) => { if (profile) this.charCreatorProfiles[u] = profile; });
    this.render();
  }

  render() {
    if (this._forYouFeed) this.applyTierLimit();
    const loaded = this.feed !== null;
    this.main.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">
        ${pageHeaderHtml("Explore", "For You", t("ph_explore_title"), t("ph_explore_sub"))}
        ${exploreTabsHtml("foryou")}
        <div style="display:flex;gap:6px">
          <button type="button" class="feed-chip${this.feedKind === "foryou" ? " on" : ""}" data-feed="foryou">${t("explore_feed_for_you", "For You")}</button>
          <button type="button" class="feed-chip${this.feedKind === "trending" ? " on" : ""}" data-feed="trending">${t("explore_feed_trending", "Trending")}</button>
        </div>
        ${!loaded ? `<p style="color:var(--color-sec);font-size:13px">${t("compendium_loading")}</p>` : `
          <div class="foryou-feed">${this.feed.map((item) => _feedCardHtml(item, this.charCreatorProfiles)).join("")}</div>
        `}
      </div>
    `;
    this.main.querySelectorAll("[data-feed]").forEach((btn) => {
      btn.onclick = () => this.setFeedKind(btn.dataset.feed);
    });
    wireCharCardDominantColors(this.main);
  }
}

if (typeof window !== "undefined") {
  window.ExploreView = ExploreView;
}
