"use strict";

function _loadVendorScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vendor="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.vendor = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}

const DIA_BIGPICTURE = `flowchart TD
  You(["You, in your browser"]) --> App["The app you see and click"]
  App --> Auth["Login check: confirms it is really you"]
  Auth --> Chat["Chat engine: runs the conversation"]
  Auth --> Data["Data layer: reads and writes your data"]
  Chat --> Mem["Memory: keeps track of your story and world"]
  Data --> DB[("Database: where everything is stored")]
  Mem --> DB`;

const DIA_MESSAGEFLOW = `flowchart TD
  A["1. You type a message and hit send"] --> B["2. The app confirms it is really you"]
  B --> C["3. It gathers what matters: memories and world facts"]
  C --> D["4. It writes a private briefing for the AI"]
  D --> E["5. The AI writes the reply, streamed to you live"]
  E --> F["6. You read it"]
  F --> G["7. A little later, the app quietly updates its memory"]`;

const DIA_MEM_MAKE = `flowchart TD
  Chat["You and the character talk for a while"] --> Pause["Every few exchanges it pauses to take notes"]
  Pause --> Read["It reads back what just happened"]
  Read --> Facts["It writes down the facts worth keeping"]
  Facts --> Seen{"Seen this before?"}
  Seen -->|"Brand new"| Add["Add it"]
  Seen -->|"Same thing again"| Keep["Strengthen it"]
  Seen -->|"It changed"| Swap["Replace the old version"]
  Add --> Filed[("Filed in memory")]
  Keep --> Filed
  Swap --> Filed`;

const DIA_MEM_RECALL = `flowchart TD
  Now["What was just said"] --> Find["Find related memories and world facts"]
  Find --> Score["Score them: recent, important and repeated win"]
  Score --> Fit["Keep only what fits the limited space"]
  Fit --> Brief["Add them to the AI's briefing"]`;

const DIA_LORE = `flowchart TD
  Book["Your lorebook: facts about your world"] --> Topic["A topic comes up in the chat"]
  Topic --> KW["Name match: an entry mentions that thing"]
  Topic --> Mean["Meaning match: an entry is about that idea"]
  KW --> Pool["Shortlist of matching entries"]
  Mean --> Pool
  Pool --> Pick["Pick the most relevant few"]
  Pick --> Show["Show them to the AI"]`;

const DIA_GROUPS = `flowchart TD
  Msg["You say something to the group"] --> Dir{"Who would naturally react?"}
  Dir -->|"You named someone"| Named["Those characters answer"]
  Dir -->|"You addressed everyone"| All["Everyone answers"]
  Dir -->|"Open room"| Some["It picks who fits, one or a few"]
  Named --> Reply["Each answers in turn, in character"]
  All --> Reply
  Some --> Reply`;

class DocsSettingsView {
  async mount(main) {
    this.main = main;
    this.render();
    try { this.cfg = await api("/api/docs/live-config"); } catch { this.cfg = null; }
    this.render();
    this.renderDiagrams();
  }

  cfgLine(label, key, fallback) {
    const v = this.cfg && this.cfg[key] != null ? this.cfg[key] : fallback;
    return `<div class="docs-cfg-row"><span>${_esc(label)}</span><span class="font-mono">${_esc(String(v))}</span></div>`;
  }

  render() {
    this.main.innerHTML = `
      <div class="docs-wrap">
        ${backLinkHtml(t("docs_back", "Settings"))}
        <h1 class="docs-title">${t("docs_title", "How StoryHaven works")}</h1>
        <p class="docs-intro">${t("docs_intro2", "No jargon, no coding needed. This page explains, in plain English, what happens behind the scenes when you chat, how the app remembers your stories, and where your world facts come from. Read top to bottom, or jump around.")}</p>

        <section class="docs-section">
          <h2>${t("docs_bp_heading", "The big picture")}</h2>
          <p>${t("docs_bp_body", "StoryHaven is made of a few parts. Each part does one job and passes its work to the next. Everything gets saved in one place so nothing is lost.")}</p>
          <div class="docs-diagram" id="d_bigpicture"></div>
          <ul class="docs-list">
            <li><b>${t("docs_bp_desk", "Login check")}</b> ${t("docs_bp_desk_d", "makes sure it is really you before anything else happens.")}</li>
            <li><b>${t("docs_bp_writer", "Chat engine")}</b> ${t("docs_bp_writer_d", "runs the back and forth of a conversation and talks to the AI.")}</li>
            <li><b>${t("docs_bp_clerk", "Data layer")}</b> ${t("docs_bp_clerk_d", "reads and saves your data. It is the only part that touches storage, which keeps things tidy.")}</li>
            <li><b>${t("docs_bp_note", "Memory")}</b> ${t("docs_bp_note_d", "keeps track of what has happened in your story and the facts about your world.")}</li>
            <li><b>${t("docs_bp_vault", "Database")}</b> ${t("docs_bp_vault_d", "is where characters, chats, memories and world facts are stored.")}</li>
          </ul>
        </section>

        <section class="docs-section">
          <h2>${t("docs_flow_heading", "What happens when you send a message")}</h2>
          <p>${t("docs_flow_body", "A lot happens in the moment between hitting send and seeing the reply. Here are the steps.")}</p>
          <div class="docs-diagram" id="d_flow"></div>
          <p class="docs-note">${t("docs_flow_note", "The reply streams in as it is written, so you see it appear word by word. Saving new memories happens quietly afterward, so it never slows down your reply.")}</p>
        </section>

        <section class="docs-section">
          <h2>${t("docs_mem_heading", "How it remembers you")}</h2>
          <p>${t("docs_mem_body1", "A character can remember something you said much earlier in a chat. This works because the app takes notes as you go, instead of re-reading the whole conversation every time.")}</p>
          <p>${t("docs_mem_body2", "Every few exchanges the app stops and reads back what just happened. It writes down the facts worth keeping, like a promise made, a name learned, or an injury taken. Then it checks each note against what it already knows.")}</p>
          <div class="docs-diagram" id="d_memmake"></div>
          <p>${t("docs_mem_body3", "The AI can only read a limited amount of text at once. So before each reply, the app finds the memories and world facts that fit the moment, ranks them, and keeps only the most useful ones that fit in that limited space.")}</p>
          <div class="docs-diagram" id="d_memrecall"></div>
          <p>${t("docs_mem_body4", "A memory ranks higher when it is recent, marked important, or has come up more than once. Details that only happened once slowly fade, so the important parts of your story stay in view. Here are the real settings this app is using right now:")}</p>
          <div class="docs-cfg">
            ${this.cfgLine(t("docs_cfg_budget2", "Working memory size (how much fits in the briefing)"), "memory_v2_budget_tokens", 1000)}
            ${this.cfgLine(t("docs_cfg_batch2", "How often it pauses to take notes (exchanges)"), "memory_batch_size", 5)}
            ${this.cfgLine(t("docs_cfg_history2", "Recent turns kept in view"), "history_turns", 16)}
            ${this.cfgLine(t("docs_cfg_topk_mem2", "Memories pulled per reply"), "top_k_memory", 4)}
            ${this.cfgLine(t("docs_cfg_topk_lore2", "World facts pulled per reply"), "top_k_lore", 6)}
          </div>
        </section>

        <section class="docs-section">
          <h2>${t("docs_lore_heading", "How it knows your world")}</h2>
          <p>${t("docs_lore_body", "Memories are about what happened in a chat. Your world facts, the lore, are things you decide up front: kingdoms, rules of magic, a character's secret. You write these in a lorebook. When a topic comes up, the app fetches the matching entries and quietly shows them to the AI, so it stays true to your world without you repeating yourself.")}</p>
          <div class="docs-diagram" id="d_lore"></div>
          <p class="docs-note">${t("docs_lore_note", "It matches two ways at once: by name (an entry that literally mentions the thing) and by meaning (an entry that is about the same idea, even in different words). That is why the right lore shows up even when you phrase things loosely.")}</p>
        </section>

        <section class="docs-section">
          <h2>${t("docs_grp_heading", "Group chats")}</h2>
          <p>${t("docs_grp_body", "In a group, not everyone should reply every time. The app reads your message and decides who would react. Name someone and they answer. Talk to everyone and they all answer. Leave it open and it picks whoever fits, so the chat does not turn into noise.")}</p>
          <div class="docs-diagram" id="d_groups"></div>
        </section>

        <section class="docs-section">
          <h2>${t("docs_priv_heading", "Keeping it yours")}</h2>
          <p>${t("docs_priv_body", "Your private characters, chats and world facts are yours. Sensitive text is encrypted where it is stored, so it is not sitting in plain sight. Every request checks that it is really you and that you are allowed to do the thing you asked, so being able to see that a feature exists is never the same as being able to use it.")}</p>
        </section>

        <section class="docs-section">
          <h2>${t("docs_api_heading", "The raw API")}</h2>
          <p>${t("docs_api_body", "Want to see the exact commands the app sends behind the scenes? This is the same API the app itself uses, and anything you try there runs as your own logged-in account with your real permissions.")}</p>
          <button type="button" class="pe-gen-btn" style="margin-top:10px" onclick="navigate('/settings-api')">${t("docs_open_explorer", "Open API explorer")}</button>
        </section>
      </div>`;
  }

  async renderDiagrams() {
    try {
      await _loadVendorScript("/js/vendor/mermaid.min.js");
    } catch { return; }
    if (typeof mermaid === "undefined") return;
    const diagrams = [
      ["d_bigpicture", DIA_BIGPICTURE],
      ["d_flow", DIA_MESSAGEFLOW],
      ["d_memmake", DIA_MEM_MAKE],
      ["d_memrecall", DIA_MEM_RECALL],
      ["d_lore", DIA_LORE],
      ["d_groups", DIA_GROUPS],
    ];
    try {
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      mermaid.initialize({ startOnLoad: false, theme: isLight ? "default" : "dark", securityLevel: "strict" });
      for (const [elId, def] of diagrams) {
        const host = this.main.querySelector("#" + elId);
        if (!host) continue;
        mermaid.render("dg_" + elId, def).then((r) => { if (host) host.innerHTML = r.svg; }).catch(() => {});
      }
    } catch (err) { console.warn("mermaid render failed", err); }
  }
}

const SCALAR_THEME_CSS = `
.scalar-app, .scalar-api-reference {
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  --scalar-background-1: var(--color-paper);
  --scalar-background-2: var(--color-surface-2);
  --scalar-background-3: var(--color-surface);
  --scalar-background-accent: color-mix(in srgb, var(--color-accent) 14%, transparent);
  --scalar-color-1: var(--color-ink);
  --scalar-color-2: var(--color-sec);
  --scalar-color-3: var(--color-muted);
  --scalar-color-accent: var(--color-accent);
  --scalar-color-green: var(--color-accent);
  --scalar-border-color: var(--color-line);
  --scalar-button-1: var(--color-accent);
  --scalar-button-1-color: var(--color-paper);
  --scalar-button-1-hover: var(--color-accent-deep);
  --scalar-sidebar-background-1: var(--color-surface-2);
  --scalar-sidebar-color-1: var(--color-ink);
  --scalar-sidebar-color-2: var(--color-sec);
  --scalar-sidebar-border-color: var(--color-line);
  --scalar-sidebar-item-hover-background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  --scalar-sidebar-item-hover-color: var(--color-ink);
  --scalar-sidebar-item-active-background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  --scalar-sidebar-color-active: var(--color-accent);
  --scalar-radius: 11px;
}`;

class ApiExplorerView {
  async mount(main) {
    this.main = main;
    main.innerHTML = `
      <div style="padding:12px 16px 0">${backLinkHtml(t("docs_back_docs", "Docs"))}
        <p class="docs-intro" style="margin:8px 0 0">${t("docs_api_intro", "This is exactly what the frontend itself calls. Try it out runs as your own logged-in session with your real permissions.")}</p>
      </div>
      <div id="scalarRoot"></div>`;
    const root = main.querySelector("#scalarRoot");
    try {
      await _loadVendorScript("/js/vendor/scalar.js");
    } catch {}
    if (typeof Scalar === "undefined") {
      root.innerHTML = `<p style="color:var(--color-warn);font-size:13px;padding:16px">${t("docs_api_unavailable", "The API explorer could not load.")}</p>`;
      return;
    }
    let schema;
    try { schema = await api("/api/openapi-schema"); }
    catch (err) {
      root.innerHTML = `<p style="color:var(--color-warn);font-size:13px;padding:16px">${_esc(err.message || t("docs_api_unavailable", "The API explorer could not load."))}</p>`;
      return;
    }
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    Scalar.createApiReference(root, {
      content: schema,
      customCss: SCALAR_THEME_CSS,
      withDefaultFonts: false,
      hideDownloadButton: true,
      forceDarkModeState: isLight ? "light" : "dark",
      hideDarkModeToggle: true,
    });
  }
}

if (typeof window !== "undefined") {
  window.DocsSettingsView = DocsSettingsView;
  window.ApiExplorerView = ApiExplorerView;
}
