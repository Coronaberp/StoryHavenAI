"use strict";

const TUTORIAL_CHAT_SID = "__tutorial__";

function tutorialDemoChat() {
  return {
    char: {
      id: "__tutorial__",
      name: "The Ghost of Onboarding",
      mode: "rpg",
      avatar: "",
      assets: {
        stage: { default: "/img/tutorial-demo.svg" },
        sprites: { default: "/img/tutorial-demo.svg", moods: { neutral: "/img/tutorial-demo.svg" } },
        music: "",
      },
    },
    session: {
      id: TUTORIAL_CHAT_SID,
      char_id: "__tutorial__",
      title: "A conversation that never happened",
      user_name: "You",
      messages: [
        {
          id: "__tutorial_greeting__",
          role: "assistant",
          lang: "English",
          content: "*materializes, unimpressed* Oh good, a live one. This is a chat. You type in the box, you hit send, something replies. Try not to overthink the two hardest buttons you'll press all week.",
        },
        {
          id: "__tutorial_reply__",
          role: "assistant",
          lang: "English",
          mood: "neutral",
          content: "*sighs, tapping a translucent foot* Fine, here's a second line, purely so the Regenerate and Continue buttons have something to point at. Riveting stuff.",
        },
      ],
    },
  };
}

const DIALOGUE_QUOTE_RE = /["“「『]([^"“”「」『』\n]+)["”」』]/g;

function wrapQuotedDialogue(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest("code, .chat-md-quote")) return NodeFilter.FILTER_REJECT;
      DIALOGUE_QUOTE_RE.lastIndex = 0;
      return DIALOGUE_QUOTE_RE.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach((node) => {
    const re = new RegExp(DIALOGUE_QUOTE_RE.source, "g");
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = "chat-md-quote";
      span.textContent = `"${m[1]}"`;
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
}

function chatMd(text) {
  try {
    const div = document.createElement("div");
    div.innerHTML = DOMPurify.sanitize(marked.parse(String(text || ""), { gfm: true, breaks: true }));
    wrapQuotedDialogue(div);
    return div.innerHTML;
  } catch {
    return _esc(text);
  }
}

function stripMood(text) {
  return String(text || "").replace(/\[mood:\s*[a-z0-9 _-]+\]/gi, "").replace(/[ \t]+\n/g, "\n").trim();
}

const _personalBgLoadCache = new Map();
function checkPersonalBgLoads(url) {
  if (_personalBgLoadCache.has(url)) return Promise.resolve(_personalBgLoadCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { _personalBgLoadCache.set(url, true); resolve(true); };
    img.onerror = () => { _personalBgLoadCache.set(url, false); resolve(false); };
    img.src = url;
  });
}

const DIRECTOR_SIGIL = "╾━╤デ╦︻";
const DIRECTIVE_RE = new RegExp(`^\\(${DIRECTOR_SIGIL}:\\[(\\w+)(?:\\s+([^\\]]+))?\\]\\s*([\\s\\S]*)\\)$`);
const INLINE_DIRECTIVE_SENT_RE = new RegExp(`\\(${DIRECTOR_SIGIL}:\\[(\\w+)(?:\\s+([^\\]]+))?\\]\\)`, "g");
const INLINE_DIRECTIVE_TYPED_RE = /\{(\w+):\s*([^}]*)\}/g;
const DIRECTIVE_LABELS = { ooc: "OOC", scene: "Scene", note: "Author's Note", time: "Time skip", roll: "Roll", as: "As" };

function directiveToEditable(text) {
  const raw = String(text || "");
  const whole = raw.match(DIRECTIVE_RE);
  if (whole) {
    const [, cmd, arg, content] = whole;
    return `/${cmd}${arg ? " " + arg : ""}${content ? " " + content : ""}`.trim();
  }
  return raw.replace(INLINE_DIRECTIVE_SENT_RE, (m, cmd, arg) => arg ? `{${cmd}: ${arg}}` : `{${cmd}}`)
    .split(DIRECTOR_SIGIL).join("");
}
const SLASH_COMMAND_RE = /^\/(ooc|scene|note|time|as)\b\s*([\s\S]*)$/i;
const INLINE_DIRECTIVE_WORDS = new Set(["ooc", "scene", "note", "time", "as"]);

function directiveToSigil(directive, arg, content) {
  const tag = arg ? `[${directive} ${arg}]` : `[${directive}]`;
  return `(${DIRECTOR_SIGIL}:${tag}${content ? " " + content : ""})`;
}

function inlineToSigil(raw) {
  return String(raw || "").replace(/\{(\w+):\s*([^}]*)\}/g, (m, word, args) => {
    word = word.toLowerCase();
    if (word === "roll" || !["ooc", "scene", "note", "time", "as"].includes(word)) return m;
    return directiveToSigil(word, args.trim(), "");
  });
}

const SIGIL_DIRECTIVE_G = new RegExp(`\\(${DIRECTOR_SIGIL}:\\[(\\w+)(?:\\s+([^\\]]+))?\\]\\s*([^)]*)\\)`, "g");
const ROLL_RESULT_G = /🎲\s*([^\n]*?=\s*\*\*\d+\*\*)/g;
const AI_OOC_G = /(?:^|\n)[ \t]*(?:\(OOC:\s*([\s\S]*)\)|\[ooc:\s*([^\]]*)\])[ \t]*/gi;

function parseCommandedMessage(raw, role) {
  let text = String(raw || "");
  const scenes = [], times = [], actions = [];
  let asName = null;
  if (role === "user") {
    text = text.replace(SIGIL_DIRECTIVE_G, (m, cmd, arg, content) => {
      cmd = cmd.toLowerCase();
      const val = [arg, content].filter(Boolean).join(" ").trim();
      if (cmd === "scene") { scenes.push(val); return ""; }
      if (cmd === "time") { times.push(val); return ""; }
      if (cmd === "ooc") { if (val) actions.push({ kind: "ooc", detail: val }); return ""; }
      if (cmd === "note") { actions.push({ kind: "note", detail: val }); return ""; }
      if (cmd === "as") { asName = (arg || val).trim(); return content || ""; }
      return content || "";
    });
    text = text.replace(ROLL_RESULT_G, (m, roll) => { actions.push({ kind: "roll", detail: roll.trim() }); return ""; });
  } else {
    text = text.replace(SIGIL_DIRECTIVE_G, (m, cmd, arg, content) => {
      cmd = cmd.toLowerCase();
      const val = [arg, content].filter(Boolean).join(" ").trim();
      if (cmd === "ooc" && val) actions.push({ kind: "ooc", detail: val });
      return "";
    });
    text = text.replace(AI_OOC_G, (m, a, b) => { const v = (a || b || "").trim(); if (v) actions.push({ kind: "ooc", detail: v }); return ""; });
  }
  const prose = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { scenes, times, actions, asName, prose };
}

function cmdBreakHtml(kind, text) {
  if (kind === "time") return `<div class="cmd-break cmd-break-time"><span class="cmd-break-ln"></span><span class="cmd-break-lbl">⏳ ${_esc(text)}</span><span class="cmd-break-ln"></span></div>`;
  return `<div class="cmd-break cmd-break-scene"><span class="cmd-break-ln"></span><span class="cmd-break-lbl">✦ ${_esc(text)} ✦</span><span class="cmd-break-ln"></span></div>`;
}

function pureOocDetail(msg) {
  const { body: raw } = msg.role === "user" ? { body: stripMood(msg.content) } : splitThink(msg.content);
  const parsed = parseCommandedMessage(raw, msg.role);
  if (parsed.prose || parsed.scenes.length || parsed.times.length) return null;
  const oocActions = parsed.actions.filter((a) => a.kind === "ooc");
  if (oocActions.length !== 1 || parsed.actions.length !== 1) return null;
  return oocActions[0].detail;
}

function oocExchangeHtml(userName, userText, charName, charText) {
  return `
    <div class="cmd-break" style="flex-direction:column;gap:5px;align-items:stretch;margin:12px auto 14px;max-width:92%;width:fit-content;min-width:min(360px, 100%);padding:11px 15px;border-radius:12px;background:color-mix(in srgb, var(--color-surface) 55%, transparent);border:1px solid var(--color-line);backdrop-filter:blur(16px) saturate(140%);-webkit-backdrop-filter:blur(16px) saturate(140%)">
      <div style="display:flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--color-muted);text-align:start">💬 ${t("chat_ooc_label", "OOC")}</div>
      <div style="font-size:13px;color:var(--color-ink);text-align:start"><b>${_esc(userName)}:</b> ${chatMd(userText)}</div>
      <div style="font-size:13px;color:var(--color-ink);text-align:start"><b>${_esc(charName)}:</b> ${chatMd(charText)}</div>
    </div>
  `;
}

const CMD_CARD_META = { note: { icon: "📌", label: "Note" }, ooc: { icon: "💬", label: "OOC" } };

function actionCardHtml(a) {
  if (a.kind === "roll") return rollCardHtml(a.detail);
  const meta = CMD_CARD_META[a.kind] || { icon: "•", label: a.kind };
  const label = t("chat_" + a.kind + "_label", meta.label);
  return `<div class="roll-card act-card"><div class="roll-card-top"><span class="roll-card-label">${meta.icon} ${_esc(label)}</span></div><div class="act-card-body">${chatMd(a.detail)}</div></div>`;
}

function cmdTrayHtml(mid, actions) {
  const cards = actions.map(actionCardHtml).join("");
  const n = actions.length;
  return `<div class="cmd-tray-wrap" data-cmd-tray="${_esc(mid)}"><button type="button" class="cmd-tray-toggle" data-cmd-tray-toggle="${_esc(mid)}">⚙ ${n} ${n === 1 ? t("chat_action_singular", "action") : t("chat_action_plural", "actions")} <span class="cmd-tray-caret">›</span></button><div class="cmd-tray-body hidden">${cards}</div></div>`;
}

function cmdAsBadgeHtml(name) {
  return `<span class="cmd-as-badge">🎭 ${t("chat_speaking_as", "speaking as")} ${_esc(name)}</span>`;
}

function rollCardHtml(detail) {
  const totalM = detail.match(/\*\*(\d+)\*\*\s*$/);
  const total = totalM ? totalM[1] : "";
  let body = detail.replace(/\s*=\s*\*\*\d+\*\*\s*$/, "").trim();
  let label = t("chat_roll_label_default", "Roll");
  const labelM = body.match(/^(.*?):\s+([\s\S]+)$/);
  if (labelM) { label = labelM[1]; body = labelM[2]; }
  const bodyHtml = body.replace(/\[([^\]]*)\]/g, (m, nums) =>
    `<span class="roll-pips">${nums.split(",").map((n) => `<span class="roll-die">${_esc(n.trim())}</span>`).join("")}</span>`);
  return `<div class="roll-card"><div class="roll-card-top"><span class="roll-card-label">🎲 ${_esc(label)}</span><span class="roll-card-total">${_esc(total)}</span></div><div class="roll-card-expr">${bodyHtml}</div></div>`;
}

const GROUP_QUOTE_RE = /["“”]([^"“”]+)["“”]/g;

function groupSplitSpeech(raw) {
  const text = String(raw || "").trim();
  const dialogue = [...text.matchAll(GROUP_QUOTE_RE)].map((m) => m[1].trim()).join(" ").trim();
  let action = text.replace(GROUP_QUOTE_RE, " ").replace(/\*/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^[-,;:.\s]+|[-,;:\s]+$/g, "").trim();
  if (action && !/[.!?]$/.test(action)) action += ".";
  return { dialogue, action };
}

function grpCmdCard(a) {
  if (a.kind === "roll") return rollCardHtml(a.detail);
  const ooc = a.kind === "ooc";
  const icon = ooc ? "💬" : "📌";
  const label = ooc ? t("chat_ooc_label", "OOC") : t("chat_note_label", "Note");
  return `<div class="grp-cmd-card${ooc ? " grp-ooc-card" : ""}"><div class="grp-cmd-lbl">${icon} ${_esc(label)}</div><div class="grp-cmd-body">${chatMd(a.detail)}</div></div>`;
}

function formatDirective(text) {
  const raw = String(text || "");
  const whole = raw.match(DIRECTIVE_RE);
  if (whole) {
    const [, directive, arg, content] = whole;
    if (directive === "as" && arg) return `*[as ${arg}]* ${content}`;
    const label = DIRECTIVE_LABELS[directive] || directive.toUpperCase();
    return arg ? `*(${label}: ${arg} - ${content})*` : `*(${label}: ${content})*`;
  }
  if (!raw.includes(DIRECTOR_SIGIL)) return raw;
  return raw.replace(INLINE_DIRECTIVE_SENT_RE, (full, directive, arg) => {
    if (directive === "as" && arg) return `*[as ${arg}]*`;
    const label = DIRECTIVE_LABELS[directive] || directive.toUpperCase();
    return arg ? `*[${label}: ${arg}]*` : `*[${label}]*`;
  });
}

function parseSlashCommand(raw) {
  const m = String(raw || "").match(SLASH_COMMAND_RE);
  if (!m) return null;
  const directive = m[1].toLowerCase();
  let rest = m[2] || "";
  let directiveArg = null;
  if (directive === "as") {
    const am = rest.match(/^(\S+)\s*([\s\S]*)$/);
    if (am) { directiveArg = am[1]; rest = am[2] || ""; }
  }
  return { directive, directiveArg, content: rest.trim() };
}

function detectCommands(raw) {
  if (/^\/help\s*$/i.test(String(raw || ""))) {
    return [{ kind: "whole", directive: "help", arg: null, content: "show all commands" }];
  }
  const rollM = String(raw || "").match(/^\/roll\s+(\S+)\s*([\s\S]*)$/i);
  if (rollM) {
    return [{ kind: "whole", directive: "roll", arg: null, content: `${rollM[1]}${rollM[2] ? " " + rollM[2].trim() : ""}` }];
  }
  const whole = String(raw || "").match(SLASH_COMMAND_RE);
  if (whole) {
    const parsed = parseSlashCommand(raw);
    return [{ kind: "whole", directive: parsed.directive, arg: parsed.directiveArg, content: parsed.content }];
  }
  const out = [];
  let m;
  INLINE_DIRECTIVE_TYPED_RE.lastIndex = 0;
  while ((m = INLINE_DIRECTIVE_TYPED_RE.exec(raw))) {
    const word = m[1].toLowerCase();
    if (!INLINE_DIRECTIVE_WORDS.has(word) && word !== "roll") continue;
    out.push({ kind: "inline", directive: word, arg: null, content: m[2].trim() });
  }
  return out;
}

function splitThink(content) {
  const m = String(content || "").match(/<think>([\s\S]*?)<\/think>/);
  const think = m ? m[1].trim() : null;
  const body = stripMood(String(content || "").replace(/<think>[\s\S]*?<\/think>/, "")).trim();
  return { think, body };
}

function exportChat(c, s) {
  const lines = [`# ${c.name}`, `Session: ${s.title || s.id}`, `Exported: ${new Date().toLocaleString()}`, "", ...s.messages.map((m) => {
    const { body: rawBody } = splitThink(m.content || "");
    const body = m.role === "user" ? formatDirective(rawBody) : rawBody;
    const who = m.role === "assistant" ? c.name : (m.user_name || s.user_name || "You");
    return `**${who}**\n${body}\n`;
  })];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${c.name.replace(/[^a-z0-9]+/gi, "-")}-${s.id.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const CHAT_STYLES = [
  { key: "unspecified", emoji: "🖋️", label: "Unspecified", desc: "Creator's intended voice", prompt: "" },
  { key: "roleplay", emoji: "🎮", label: "Roleplay", desc: "Narrative-driven and immersive", prompt: "Write in a rich, immersive narrative style. Use vivid prose descriptions, advance the scene organically, and maintain deep character voice throughout." },
  { key: "lust", emoji: "😍", label: "Lust", desc: "Flirtatious, suggestive, NSFW", prompt: "Respond in an explicit, sensual, NSFW manner. Be bold about physical desire, use evocative sensory language, and don't shy away from graphic detail." },
  { key: "romance", emoji: "❤️", label: "Romance", desc: "Warm, intimate, affectionate", prompt: "Respond with tenderness, emotional warmth, and romantic intimacy. Focus on feelings, connection, vulnerability, and the small moments between characters." },
  { key: "casual", emoji: "🤙", label: "Casual", desc: "Short, relaxed, to the point", prompt: "Keep responses short and casual. Skip flowery prose - just natural, snappy dialogue and minimal action beats." },
];

function getCustomChatStyles() {
  return store.get("customChatStyles", []);
}

function setCustomChatStyles(styles) {
  store.set("customChatStyles", styles);
}

function getAllChatStyles() {
  return [...CHAT_STYLES, ...getCustomChatStyles()];
}

const RESPONSE_LENGTHS = [
  { key: "brief", emoji: "✂️", label: "Brief", desc: "Two to four sentences" },
  { key: "short", emoji: "📝", label: "Short", desc: "A compact paragraph or two" },
  { key: "default", emoji: "🎚️", label: "Default", desc: "Creator's intended length" },
  { key: "long", emoji: "📖", label: "Long", desc: "Developed, room for scene detail" },
  { key: "epic", emoji: "📜", label: "Epic", desc: "Extensive, richly detailed" },
];

const CHAT_COMMON_LANGUAGES = ["Spanish", "French", "German", "Japanese", "Korean", "Portuguese", "Italian", "Russian", "Mandarin Chinese", "Arabic"];

function checkIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function pickStageAsset(section, mood) {
  if (!section) return "";
  const moods = section.moods || {};
  if (mood && moods[mood]) return moods[mood];
  return section.default || "";
}

function hasStageImage(section) {
  if (!section) return false;
  if (section.default) return true;
  return Object.values(section.moods || {}).some((url) => !!url);
}

function clientMacro(text, charName, userName) {
  return String(text || "")
    .replace(/\{\{char\}\}|<BOT>/gi, charName)
    .replace(/\{\{user\}\}|<USER>/gi, userName);
}

class ChatView {
  constructor(sid, draftCharId) {
    this.sid = sid;
    this.draftCharId = draftCharId || null;
    this.session = null;
    this.char = null;
    this.error = "";
    this.streaming = false;
    this.abortController = null;
    this.continuePromptOpen = false;
    this.moreMenuOpen = false;
    this.toolsMenuOpen = false;
    this.personalBgOk = false;
    this.diceRolledThisTurn = false;
    this.sessionLoreViewMode = "list";
    this.memTab = "memory";
    this.currentMood = null;
    this.muted = true;
    this.railHidden = store.get("chatRailHidden", false);
    this.personaAvatar = "";
    this.selectMode = false;
    this.selectedIds = new Set();
    this.multiplayer = null;
    this.multiplayerLocked = false;
    this.multiplayerLockedBy = null;
    this.multiplayerTypingBy = null;
    this.partyChatMessages = [];
    this.partyChatUnread = 0;
    this._pcMentionOpen = false;
    this._pcMentionMatches = [];
    this._pcMentionIndex = 0;
    this._pcMentionMenu = null;
  }

  async mount(main) {
    this.main = main;
    this.render();
    if (this.sid === TUTORIAL_CHAT_SID) {
      const demo = tutorialDemoChat();
      this.char = demo.char;
      this.session = demo.session;
      this.render();
      this.scrollToBottom();
      return;
    }
    if (this.draftCharId) {
      try {
        this.char = await api(`/api/characters/${encodeURIComponent(this.draftCharId)}`);
      } catch (err) {
        this.error = err.message || t("chat_conversation_not_found");
        this.render();
        return;
      }
      this.greetingIndex = 0;
      this.buildDraftSession();
      this.render();
      this.scrollToBottom();
      return;
    }
    const joinParams = new URLSearchParams(location.search);
    const joinToken = joinParams.get("token");
    const mpInvite = joinParams.get("mpinvite");
    try {
      this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
    } catch (err) {
      if (joinToken || mpInvite) {
        try {
          if (joinToken) {
            await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/join`, { method: "POST", body: JSON.stringify({ token: joinToken }) });
          } else {
            await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/accept`, { method: "POST", body: JSON.stringify({}) });
          }
          this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
        } catch (joinErr) {
          this.error = joinErr.message || t("chat_multiplayer_join_failed", "Couldn't join this session.");
          this.render();
          return;
        }
      } else {
        this.error = t("chat_conversation_not_found_or_needs_invite", "This chat isn't available, or you might need an invite link to join it.");
        this.render();
        return;
      }
    }
    try {
      this.char = await api(`/api/characters/${encodeURIComponent(this.session.char_id)}`);
    } catch (err) {
      this.error = err.message || t("chat_conversation_not_found");
      this.render();
      return;
    }
    this.loadPersonaAvatar();
    this.render();
    this.scrollToBottom();
    this.pollPendingGreeting();
    if (ME?.experimental_features_enabled) this._loadMultiplayer();
  }

  async _loadMultiplayer() {
    let participants;
    try {
      participants = await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/participants`);
    } catch {
      return;
    }
    if (!participants || !participants.length) return;
    this.multiplayer = { participants };
    this.loadPersonaAvatar();
    this.render();
    this._openMultiplayerLive();
  }

  async _openMultiplayerLive() {
    if (this._liveStarted) return;
    this._liveStarted = true;
    while (this.multiplayer && window._activeChatView === this) {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/live`, { credentials: "include" });
        if (!res.ok || !res.body) break;
        await sseEvents(res, async (ev) => this._handleMultiplayerEvent(ev));
      } catch {
        // connection dropped, loop retries below
      }
      if (window._activeChatView !== this) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async _handleMultiplayerEvent(ev) {
    if (window._activeChatView !== this) return;
    if (ev.type === "generating") {
      this.multiplayerLocked = true;
      this.multiplayerLockedBy = ev.sender_user_id;
      if (ev.content && ev.sender_user_id !== ME?.id) {
        this.session.messages.push({
          id: `pending-remote-${Date.now()}`, role: "user", content: ev.content,
          user_name: ev.user_name || null, persona_avatar: ev.persona_avatar || null,
          sender_user_id: ev.sender_user_id || null,
        });
      }
      this.render();
      this.scrollToBottom();
    } else if (ev.type === "delta") {
      if (this.streaming) return;
      await this._revealIncomingDelta(ev.content || "");
    } else if (ev.type === "typing") {
      if (ev.user_id === ME?.id) return;
      this.multiplayerTypingBy = ev.user_id;
      this.render();
      clearTimeout(this._typingClearTimer);
      this._typingClearTimer = setTimeout(() => { this.multiplayerTypingBy = null; this.render(); }, 4000);
    } else if (ev.type === "done") {
      this.multiplayerLocked = false;
      this.multiplayerLockedBy = null;
      try { this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`); } catch { return; }
      this.render();
      this.scrollToBottom();
    } else if (ev.type === "participant_joined" || ev.type === "participant_left" || ev.type === "participant_updated") {
      try {
        this.multiplayer.participants = await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/participants`);
      } catch { return; }
      this.render();
    } else if (ev.type === "session_updated") {
      try { this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`); } catch { return; }
      this.render();
      this.scrollToBottom();
    } else if (ev.type === "party_chat") {
      this.partyChatMessages.push(ev);
      if (this.partyChatModalEl) {
        this._renderPartyChatMessages();
      } else if (ev.sender_user_id !== ME?.id) {
        this.partyChatUnread = (this.partyChatUnread || 0) + 1;
        this.render();
      }
    }
  }

  buildDraftSession() {
    const greetings = [this.char.greeting, ...(this.char.alt_greetings || [])].filter((g) => (g || "").trim());
    const userName = t("chat_you_fallback_name");
    const greeting = clientMacro(greetings[this.greetingIndex] || greetings[0] || "", this.char.name, userName);
    this.session = {
      id: null, char_id: this.char.id, title: this.char.name, user_name: userName,
      persona_id: null, char_doing: null, char_location: null,
      messages: greeting ? [{ id: "__draft_greeting__", role: "assistant", lang: null, content: greeting }] : [],
    };
  }

  pollPendingGreeting(tries = 0) {
    const msgs = this.session?.messages || [];
    const pending = msgs.length === 1 && msgs[0].role === "assistant" && !msgs[0].lang;
    if (!pending) return;
    if (tries === 0) toast(t("chat_setting_up_greeting_translating"));
    if (tries >= 40) { toast(t("chat_still_translating_reload")); return; }
    setTimeout(async () => {
      try {
        const fresh = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
        const stillPending = fresh.messages.length === 1 && fresh.messages[0].role === "assistant" && !fresh.messages[0].lang;
        if (!stillPending) { this.session = fresh; this.render(); this.scrollToBottom(); return; }
      } catch {}
      this.pollPendingGreeting(tries + 1);
    }, 3000);
  }

  scrollToBottom() {
    const thread = this.main.querySelector("#chatThread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  selectionBarHtml() {
    const n = this.selectedIds.size;
    return `
      <div style="flex:none;padding-top:env(safe-area-inset-top,0px);background:var(--color-surface-2);border-bottom:1px solid var(--color-line)">
        <div style="display:flex;align-items:center;gap:11px;padding:8px 14px 11px">
          <button type="button" id="chatSelectCancel" class="ig-icon-btn" aria-label="${t("chat_cancel_selection")}" data-tooltip="${t("chat_cancel_selection")}" style="position:static">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div style="flex:1;font-size:14px;color:var(--color-ink)">${n} ${t("chat_selected_suffix")}</div>
          <button type="button" id="chatSelectDelete" class="ig-icon-btn danger" aria-label="${t("chat_delete_selected")}" data-tooltip="${t("chat_delete_selected")}" style="position:static" ${n ? "" : "disabled"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  headerHtml() {
    if (this.selectMode) return this.selectionBarHtml();
    const c = this.char;
    const hue = [...c.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const rpg = c.mode === "rpg";
    const assets = c.assets || {};
    const hasStage = !this.session.is_group && (hasStageImage(assets.stage) || hasStageImage(assets.sprites));
    const canToggleStage = hasStage && !!this.personalBgOk;
    const avatarInner = c.avatar
      ? `<img src="${_esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;background:linear-gradient(150deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 45% 16%));display:grid;place-items:center;font-family:var(--font-display);font-size:16px;color:#fff">${_esc(c.name?.[0]?.toUpperCase() || "?")}</div>`;
    return `
      <div style="flex:none;padding-top:env(safe-area-inset-top,0px);background:var(--color-surface-2);border-bottom:1px solid var(--color-line)">
        <div style="display:flex;align-items:center;gap:11px;padding:8px 14px 11px">
          <button type="button" id="chatBack" class="ig-icon-btn" aria-label="${t("chat_back")}" data-tooltip="${t("chat_back")}" style="position:static">
            <svg class="icon-flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button type="button" id="chatCharLink" style="display:flex;align-items:center;gap:11px;flex:1;min-width:0;background:none;border:none;padding:0;cursor:pointer;text-align:left" aria-label="${t("chat_open_prefix")} ${_esc(c.name)}">
            <span style="width:38px;height:38px;flex:none;border-radius:11px;overflow:hidden">${this.session.is_group ? this._groupHeaderAvatar() : avatarInner}</span>
            <div style="flex:1;min-width:0">
              <div class="font-display" style="font-weight:600;font-size:15.5px;color:var(--color-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${this.session.is_group ? _esc((this.session.title || "Group").trim()) : `${_esc(c.name)}${this.session.title && this.session.title.trim() && this.session.title !== c.name ? ` <span style="font-weight:400;color:var(--color-muted)">· ${_esc(this.session.title.trim())}</span>` : ""}`}
              </div>
              <div style="font-size:11px;color:var(--color-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px">
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.session.is_group ? _esc((this.session.cast || []).map((m) => m.name).join(", ")) : _esc(this.session.char_doing || this.session.char_location || "")}</span>
                <span style="flex:none;font-variant-numeric:tabular-nums">${t("chat_exchange_count", "Exchange {n}").replace("{n}", Math.floor((this.session.messages || []).length / 2))}</span>
              </div>
            </div>
          </button>
          ${canToggleStage ? `
            <button type="button" id="chatStageToggle" class="ig-icon-btn" aria-label="${t("chat_toggle_stage_art")}" data-tooltip="${t("chat_toggle_stage_art")}" style="position:static">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            </button>
          ` : ""}
          ${hasStage && hasStageImage(assets.music) ? `
            <button type="button" id="chatMuteToggle" class="ig-icon-btn" aria-label="${this.muted ? t("chat_unmute_music") : t("chat_mute_music")}" data-tooltip="${this.muted ? t("chat_unmute_music") : t("chat_mute_music")}" style="position:static">
              ${this.muted
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`}
            </button>
          ` : ""}
          <button type="button" id="chatRailToggle" class="ig-icon-btn hidden lg:flex" aria-label="${this.railHidden ? t("chat_show_session_info") : t("chat_hide_session_info")}" data-tooltip="${this.railHidden ? t("chat_show_session_info") : t("chat_hide_session_info")}" style="position:static">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
          </button>
          <div style="position:relative;flex:none" class="lg:hidden">
            <button type="button" id="chatMoreBtn" class="ig-icon-btn" aria-label="${t("chat_more")}" data-tooltip="${t("chat_more")}" style="position:static">
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:16px;height:16px"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
            </button>
            ${this.moreMenuOpen ? `
              <div style="position:absolute;top:calc(100% + 6px);right:0;z-index:20;min-width:190px;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:11px;box-shadow:0 8px 22px rgba(0,0,0,.3);overflow:hidden">
                <button type="button" class="dropdown-item" data-menu="newchat" style="display:flex;align-items:center;gap:9px">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>
                  ${t("chat_start_new_chat")}
                </button>
                <button type="button" class="dropdown-item" data-menu="memory" style="display:flex;align-items:center;gap:9px">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a5 5 0 0 0-5 5c0 2 1 3 1 5a4 4 0 0 0 8 0c0-2 1-3 1-5a5 5 0 0 0-5-5z"/><path d="M9.5 18h5M10 21h4"/></svg>
                  ${t("chat_view_memory")}
                </button>
                <button type="button" class="dropdown-item" data-menu="rename" style="display:flex;align-items:center;gap:9px">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L7 21l-4 1 1-4z"/></svg>
                  ${t("chat_rename_session")}
                </button>
                ${this.canChangeLanguage() ? `
                  <button type="button" class="dropdown-item" data-menu="language" style="display:flex;align-items:center;gap:9px">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>
                    ${t("chat_reply_language")}
                  </button>
                ` : ""}
                <button type="button" class="dropdown-item" data-menu="hideooc" style="display:flex;align-items:center;gap:9px">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c7 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.3 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
                  ${t("chat_hide_ooc", "Hide OOC")}${store.get("hideOoc", false) ? ` <span style="margin-left:auto;color:var(--color-accent)">✓</span>` : ""}
                </button>
                <button type="button" class="dropdown-item" data-menu="export" style="display:flex;align-items:center;gap:9px">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  ${t("chat_export_chat")}
                </button>
                ${this.multiplayer ? `
                  <button type="button" class="dropdown-item" data-menu="invite" style="display:flex;align-items:center;gap:9px">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    ${t("chat_multiplayer_invite_menu", "Invite to this chat")}
                  </button>
                  <button type="button" class="dropdown-item" data-menu="partychat" style="display:flex;align-items:center;gap:9px">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    ${t("chat_multiplayer_party_chat_menu", "Party chat")}
                  </button>
                ` : ""}
                ${this.session.is_group ? `
                  <button type="button" class="dropdown-item" data-menu="publishgroup" data-feature="groups" style="display:flex;align-items:center;gap:9px">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                    ${t("group_publish_action", "Publish as group")}
                  </button>
                ` : ""}
                <button type="button" class="dropdown-item" data-menu="delete" style="color:var(--color-warn);display:flex;align-items:center;gap:9px">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  ${t("chat_delete_this_chat")}
                </button>
              </div>
            ` : ""}
          </div>
        </div>
        ${this.multiplayer ? this.participantStripHtml() : ""}
      </div>
    `;
  }

  async _revealIncomingDelta(content) {
    const thread = this.main?.querySelector("#chatThread");
    if (!thread) return;
    this._passiveRevealController?.abort();
    const controller = new AbortController();
    this._passiveRevealController = controller;
    const render = (partial) => {
      const bubbleInner = `
        <div class="chat-msg-row">
        ${this.pfpHtml(false, { mood: this.currentMood })}
        ${!partial ? `<div class="chat-writing"><span class="chat-writing-dot"></span>${_esc(this.char.name)} ${t("chat_is_thinking_suffix")}</div>` : ""}
        ${partial ? `<div class="chat-bubble"><div class="sym-body">${chatMd(stripMood(partial))}</div></div>` : ""}
        </div>
        <div class="chat-name-label">${_esc(this.char.name)}</div>
      `;
      let node = thread.querySelector("[data-pending-ai]");
      if (!node) {
        thread.insertAdjacentHTML("beforeend", `<div class="chat-turn ai" data-pending-ai><div class="chat-turn-body"></div></div>`);
        node = thread.querySelector("[data-pending-ai]");
      }
      node.querySelector(".chat-turn-body").innerHTML = bubbleInner;
      this.scrollToBottom();
    };
    render("");
    await this.revealTyping(content, controller.signal, render);
  }

  _lockedByLabel() {
    const uid = this.multiplayerLockedBy;
    const generic = t("chat_multiplayer_locked_label_generic", "Someone's acting — the composer opens back up once the reply lands.");
    if (!uid) return generic;
    const isMe = uid === ME?.id;
    const p = this.multiplayer?.participants?.find((row) => row.user_id === uid);
    const name = isMe ? (ME?.display_name || ME?.username) : (p?.user_display_name || p?.username);
    if (!name) return generic;
    const persona = p?.persona_name || null;
    const who = persona ? `${name} (${persona})` : name;
    return t("chat_multiplayer_locked_label", "{who} is acting — the composer opens back up once the reply lands.").replace("{who}", who);
  }

  participantStripHtml() {
    const colors = ["#7DBEF0", "#C4A0FF", "#7BD88F", "#F0788F", "#F2CE87", "#E3BD6C", "#B8892B", "#8B7A6E"];
    const rows = this.multiplayer.participants.map((p, i) => {
      const isMe = p.user_id === ME?.id;
      const name = isMe ? (ME?.display_name || ME?.username || t("chat_you_fallback_name")) : (p.user_display_name || p.username || t("chat_multiplayer_unknown_participant", "Someone"));
      const personaName = p.persona_name || null;
      const initial = _esc((name[0] || "?").toUpperCase());
      const avatarInner = p.avatar
        ? `<img src="${_esc(p.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:999px">`
        : initial;
      return `
        <button type="button" onclick="_activeChatView.openParticipantPersonaModal('${_esc(p.user_id)}')" ${personaName ? "" : "disabled"} style="flex:none;display:flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:999px;background:var(--color-surface-2);border:1px solid var(--color-line-2);cursor:${personaName ? "pointer" : "default"};font:inherit;text-align:left">
          <span style="width:22px;height:22px;border-radius:999px;display:grid;place-items:center;font-family:var(--font-display);font-weight:600;font-size:10.5px;color:var(--color-paper-base);background:${colors[i % colors.length]};overflow:hidden">${avatarInner}</span>
          <span style="line-height:1.25">
            <span style="display:block;font-size:12px;color:${isMe ? "var(--color-accent)" : "var(--color-ink)"}">${_esc(name)}${isMe ? ` ${t("chat_you_fallback_name_suffix", "(you)")}` : ""}</span>
            ${personaName ? `<span style="display:block;font-size:10px;color:var(--color-muted)">${_esc(personaName)}</span>` : ""}
          </span>
        </button>
      `;
    }).join("");
    return `
      <div style="flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--color-surface);border-bottom:1px solid var(--color-line);overflow-x:auto">
        <span style="flex:none;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted)">${t("chat_multiplayer_party_label", "Party")}</span>
        ${rows}
        <button type="button" onclick="_activeChatView.openPartyChatModal()" style="flex:none;position:relative;background:none;border:1px dashed var(--color-line-2);color:var(--color-sec);font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer">
          ${t("chat_multiplayer_party_chat_button", "Party chat")}
          ${this.partyChatUnread ? `<span style="position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--color-accent);color:var(--color-paper-base);font-family:var(--font-mono);font-size:10px;font-weight:600;display:grid;place-items:center;line-height:1">${this.partyChatUnread > 9 ? "9+" : this.partyChatUnread}</span>` : ""}
        </button>
      </div>
      ${this.multiplayerLocked ? `
        <div style="flex:none;padding:6px 14px;font-family:var(--font-mono);font-size:11px;color:var(--color-accent);background:color-mix(in srgb, var(--color-accent) 10%, var(--color-surface));border-bottom:1px solid var(--color-line)">
          🔒 ${this._lockedByLabel()}
        </div>
      ` : (!this.multiplayerLocked && this.multiplayerTypingBy ? `
        <div style="flex:none;padding:6px 14px;font-family:var(--font-mono);font-size:11px;color:var(--color-muted);border-bottom:1px solid var(--color-line)">
          ${this._typingByLabel()}
        </div>
      ` : "")}
    `;
  }

  _typingByLabel() {
    const p = this.multiplayer?.participants?.find((row) => row.user_id === this.multiplayerTypingBy);
    const name = p?.user_display_name || p?.username || t("chat_multiplayer_unknown_participant", "Someone");
    return t("chat_multiplayer_typing_label", "{who} is typing…").replace("{who}", name);
  }

  async openParticipantPersonaModal(userId) {
    const participant = this.multiplayer?.participants?.find((p) => p.user_id === userId);
    if (!participant?.persona_name) return;
    openModal(`<h3>${_esc(participant.persona_name)}</h3><div id="participantPersonaBody" style="color:var(--color-muted)">${t("chat_loading")}</div>`);
    const layer = document.querySelector(".modal-layer:last-child");
    const body = layer.querySelector("#participantPersonaBody");
    let persona;
    try {
      persona = await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/participants/${encodeURIComponent(userId)}/persona`);
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || t("chat_multiplayer_persona_load_failed", "Couldn't load that persona."))}</p>`;
      return;
    }
    const ownerName = participant.user_id === ME?.id ? (ME?.display_name || ME?.username) : (participant.user_display_name || participant.username);
    body.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
        <span style="width:52px;height:52px;flex:none;border-radius:999px;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center;font-family:var(--font-display);font-weight:600;font-size:18px">
          ${persona.avatar ? `<img src="${_esc(persona.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">` : _esc((persona.name || "?")[0].toUpperCase())}
        </span>
        <div>
          <div style="font-size:15px;color:var(--color-ink);font-weight:600">${_esc(persona.name)}</div>
          ${ownerName ? `<div style="font-size:12px;color:var(--color-muted)">${t("chat_multiplayer_played_by_prefix", "Played by")} ${_esc(ownerName)}</div>` : ""}
        </div>
      </div>
      ${persona.gender ? `<p style="font-size:12px;color:var(--color-muted);margin:0 0 8px">${_esc(persona.gender)}</p>` : ""}
      <p style="font-size:13.5px;color:var(--color-ink);white-space:pre-wrap">${_esc(persona.description || t("chat_multiplayer_persona_no_description", "No description provided."))}</p>
    `;
  }

  async openInviteModal() {
    if (!this.session?.id) {
      toast(t("chat_multiplayer_needs_real_session", "Send a message first, then invite people to this chat."));
      return;
    }
    let linkResult;
    try {
      linkResult = await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/invite-link`, { method: "POST" });
    } catch (e) {
      errorToast(e.message || t("chat_multiplayer_invite_link_failed", "Couldn't create an invite link."));
      return;
    }
    if (!this.multiplayer) await this._loadMultiplayer();
    const joinUrl = `${location.origin}/chats/${encodeURIComponent(this.sid)}?token=${encodeURIComponent(linkResult.token)}`;
    const layer = openModal(`
      <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("chat_multiplayer_invite_heading", "Invite someone to this chat")}</h3>
      <p style="font-size:12.5px;color:var(--color-sec);margin:0 0 10px">${t("chat_multiplayer_invite_link_hint", "Anyone with this link can join, up to 8 people total.")}</p>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input type="text" readonly value="${_attr(joinUrl)}" id="mpInviteLinkInput" style="flex:1;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:12.5px">
        <button type="button" class="pe-gen-btn" id="mpCopyLink">${t("chat_multiplayer_copy_link_button", "Copy")}</button>
      </div>
      <p style="font-size:12.5px;color:var(--color-sec);margin:0 0 8px">${t("chat_multiplayer_invite_username_hint", "Or invite someone by username:")}</p>
      <div style="position:relative">
        <div style="display:flex;gap:8px">
          <input type="text" id="mpInviteUsername" autocomplete="off" placeholder="${t("chat_multiplayer_username_placeholder", "username")}" style="flex:1;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px">
          <button type="button" class="pe-gen-btn" id="mpSendInvite">${t("chat_multiplayer_send_invite_button", "Send")}</button>
        </div>
        <div id="mpInviteSuggest" class="dropdown-menu" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:5"></div>
      </div>
    `);
    layer.querySelector("#mpCopyLink").onclick = async () => {
      try {
        await navigator.clipboard.writeText(joinUrl);
        toast(t("chat_multiplayer_link_copied", "Link copied."));
      } catch {
        layer.querySelector("#mpInviteLinkInput").select();
      }
    };
    const usernameInput = layer.querySelector("#mpInviteUsername");
    const suggest = layer.querySelector("#mpInviteSuggest");
    const closeSuggest = () => { suggest.classList.remove("open"); suggest.innerHTML = ""; };
    let searchTimer;
    usernameInput.oninput = () => {
      clearTimeout(searchTimer);
      const q = usernameInput.value.trim();
      if (!q) { closeSuggest(); return; }
      searchTimer = setTimeout(async () => {
        let users;
        try {
          users = await api(`/api/users?${new URLSearchParams({ q })}`);
        } catch {
          closeSuggest();
          return;
        }
        const alreadyIn = new Set((this.multiplayer?.participants || []).map((p) => p.username));
        const matches = users.filter((u) => u.username !== ME?.username && !alreadyIn.has(u.username)).slice(0, 6);
        if (!matches.length) { closeSuggest(); return; }
        suggest.innerHTML = matches.map((u) => `
          <button type="button" class="dropdown-item" data-pick-username="${_attr(u.username)}" style="display:flex;gap:8px;align-items:center">
            <span style="width:22px;height:22px;flex:none;border-radius:999px;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center;font-family:var(--font-mono);font-size:10px">
              ${u.avatar ? `<img src="${_esc(u.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">` : _esc((u.display_name || u.username)[0].toUpperCase())}
            </span>
            <span style="font-size:13px">${_esc(u.display_name || u.username)}</span>
            <span style="font-size:11px;color:var(--color-muted)">@${_esc(u.username)}</span>
          </button>
        `).join("");
        suggest.classList.add("open");
        suggest.querySelectorAll("[data-pick-username]").forEach((btn) => {
          btn.onclick = () => {
            usernameInput.value = btn.dataset.pickUsername;
            closeSuggest();
            usernameInput.focus();
          };
        });
      }, 250);
    };
    usernameInput.addEventListener("blur", () => setTimeout(closeSuggest, 150));
    layer.querySelector("#mpSendInvite").onclick = async () => {
      const username = usernameInput.value.trim();
      if (!username) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/invite/${encodeURIComponent(username)}`, { method: "POST" });
        toast(t("chat_multiplayer_invite_sent", "Invite sent."));
        closeModal(layer);
      } catch (e) {
        errorToast(e.message || t("chat_multiplayer_invite_send_failed", "Couldn't send that invite."));
      }
    };
  }

  async openPartyChatModal() {
    this.partyChatUnread = 0;
    this.render();
    try {
      this.partyChatMessages = await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/party-chat`);
    } catch { this.partyChatMessages = []; }
    const layer = openModal(`
      <h3 class="font-display" style="font-size:16px;font-weight:600;color:var(--color-ink);margin:0 0 10px">${t("chat_multiplayer_party_chat_heading", "Party chat")}</h3>
      <p style="font-size:11.5px;color:var(--color-muted);margin:0 0 10px">${t("chat_multiplayer_party_chat_hint", "For coordinating out loud. This never touches the story or the AI.")}</p>
      <div class="comment-list" id="mpPartyChatList" style="max-height:320px;overflow-y:auto;margin-bottom:0"></div>
      <div class="comment-composer">
        <span class="comment-avatar">${ME?.avatar ? `<img src="${_attr(ME.avatar)}" alt="">` : `<span>${_esc((ME?.display_name || ME?.username || "?")[0]?.toUpperCase() || "?")}</span>`}</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
          <div class="comment-composer-pill">
            <input type="text" id="mpPartyChatInput" class="comment-composer-input" placeholder="${t("chat_multiplayer_party_chat_placeholder", "Say something to the party...")}">
            <button type="button" id="mpPartyChatEmoji" class="comment-composer-emoji" data-tooltip="${t("comments_emoji_gifs_and_stickers")}" aria-label="${t("comments_emoji_gifs_and_stickers")}">🙂</button>
          </div>
          <div id="mpPartyChatMedia"></div>
        </div>
        <button type="button" id="mpPartyChatSend" class="comment-composer-send" data-tooltip="${t("comments_send", "Send")}" aria-label="${t("comments_send", "Send")}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    `, { onClose: () => { this.partyChatModalEl = null; } });
    this.partyChatModalEl = layer;
    this._renderPartyChatMessages();
    const input = layer.querySelector("#mpPartyChatInput");
    const submit = async (attachment) => {
      const content = input.value.trim();
      if (!content && !attachment) return;
      input.value = "";
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/party-chat`, {
          method: "POST",
          body: JSON.stringify({ content, ...(attachment || {}) }),
        });
      } catch (e) {
        errorToast(e.message || t("chat_multiplayer_party_chat_send_failed", "That message didn't send."));
      }
    };
    layer.querySelector("#mpPartyChatSend").onclick = () => submit();
    input.addEventListener("keydown", (e) => {
      if (this._pcMentionOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        this._pcHandleMentionKey(e);
        return;
      }
      if (e.key === "Enter") submit();
    });
    input.addEventListener("input", () => this._pcUpdateMentionMenu(input));
    input.addEventListener("blur", () => setTimeout(() => this._pcCloseMentionMenu(), 150));
    layer.querySelector("#mpPartyChatEmoji").onclick = () => this._pcToggleMediaPanel(input, submit);
  }

  _pcCloseMediaPanel() {
    const host = this.partyChatModalEl?.querySelector("#mpPartyChatMedia");
    if (host) { host.innerHTML = ""; host.dataset.open = "0"; }
  }

  async _pcToggleMediaPanel(input, submit) {
    const host = this.partyChatModalEl.querySelector("#mpPartyChatMedia");
    if (!host) return;
    if (host.dataset.open === "1") {
      host.innerHTML = "";
      host.dataset.open = "0";
      return;
    }
    host.dataset.open = "1";
    await loadCustomEmojis();
    if (host.dataset.open !== "1") return;
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
      panel.querySelectorAll(".comment-media-tab").forEach((tb) => tb.classList.toggle("active", tb === btn));
      this._pcLoadMediaTab(panel, btn.dataset.tab, input, submit);
    });
    this._pcLoadMediaTab(panel, "gif", input, submit);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  _pcLoadMediaTab(panel, tab, input, submit) {
    const body = panel.querySelector(".comment-media-body");
    if (tab === "gif") {
      body.innerHTML = `
        <div class="comment-media-search"><input type="text" id="mpPartyChatGifSearch" placeholder="${t("comments_search_giphy_placeholder")}"></div>
        <div class="comment-gif-grid" id="mpPartyChatGifGrid"><p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);padding:8px">${t("comments_loading")}</p></div>
        <div class="comment-media-footer"><span>${t("comments_powered_by_giphy")}</span><span>${t("comments_rated_pg13")}</span></div>
      `;
      this._pcLoadGifs(panel, "", submit);
      body.querySelector("#mpPartyChatGifSearch").oninput = (e) => this._pcLoadGifs(panel, e.target.value, submit);
    } else if (tab === "sticker") {
      const cache = _EMOJI_CACHE || { stickers: [] };
      body.innerHTML = cache.stickers.length
        ? `<div class="comment-picker-grid">${cache.stickers.map((s) =>
            `<button type="button" class="comment-picker-cell" data-sticker="${_attr(s.image)}" title="${_attr(":" + s.shortcode + ":")}"><img src="${_attr(s.image)}" alt=""></button>`
          ).join("")}</div>`
        : `<p style="font-size:12px;color:var(--color-muted);padding:12px">${t("comments_no_stickers_available_yet")}</p>`;
      body.querySelectorAll("[data-sticker]").forEach((b) => b.onclick = async () => {
        await submit({ image: b.dataset.sticker, attachment_kind: "image" });
        this._pcCloseMediaPanel();
      });
    } else {
      const cache = _EMOJI_CACHE || { emojis: [] };
      const unicode = COMMENT_PICKER_EMOJI.map((e) =>
        `<button type="button" class="comment-picker-cell" data-emoji="${_attr(e)}">${e}</button>`).join("");
      const custom = cache.emojis.map((em) =>
        `<button type="button" class="comment-picker-cell" data-shortcode="${_attr(":" + em.shortcode + ":")}" title="${_attr(":" + em.shortcode + ":")}"><img src="${_attr(em.image)}" alt=""></button>`).join("");
      body.innerHTML = `<div class="comment-picker-grid">${unicode}${custom}</div>`;
      body.querySelectorAll("[data-emoji]").forEach((b) => b.onclick = () => { input.value += b.dataset.emoji; input.focus(); });
      body.querySelectorAll("[data-shortcode]").forEach((b) => b.onclick = () => { input.value += `${b.dataset.shortcode} `; input.focus(); });
    }
  }

  async _pcLoadGifs(panel, q, submit) {
    const grid = panel.querySelector("#mpPartyChatGifGrid");
    if (!grid) return;
    const token = (this._pcGifToken = (this._pcGifToken || 0) + 1);
    grid.innerHTML = `<p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);padding:8px">${t("comments_loading")}</p>`;
    try {
      const query = q.trim();
      const endpoint = query ? `/api/comments/giphy/search?q=${encodeURIComponent(query)}` : `/api/comments/giphy/trending`;
      const { results } = await api(endpoint);
      if (token !== this._pcGifToken || !grid.isConnected) return;
      grid.innerHTML = results.length
        ? results.map((g) => `<button type="button" class="comment-gif-cell" data-gif-id="${_attr(g.id)}"><img src="${_attr(g.preview_url)}" alt="${_attr(g.title)}" loading="lazy"></button>`).join("")
        : `<p style="grid-column:1/-1;font-size:12px;color:var(--color-muted);padding:8px">${t("comments_no_results")}</p>`;
      grid.querySelectorAll("[data-gif-id]").forEach((b) => b.onclick = async () => {
        grid.style.opacity = ".5";
        try {
          const res = await api("/api/comments/giphy/send", { method: "POST", body: JSON.stringify({ id: b.dataset.gifId }) });
          await submit(res);
          this._pcCloseMediaPanel();
        } catch (err) {
          errorToast(err.message || t("comments_couldnt_send_that_gif"));
          grid.style.opacity = "";
        }
      });
    } catch (err) {
      if (token !== this._pcGifToken) return;
      grid.innerHTML = `<p style="grid-column:1/-1;font-size:12px;color:var(--color-warn)">${_esc(err.message || t("comments_couldnt_load_gifs"))}</p>`;
    }
  }

  _pcUpdateMentionMenu(input) {
    const upto = input.value.slice(0, input.selectionStart);
    const m = upto.match(/(?:^|\s)@([A-Za-z0-9_-]{0,32})$/);
    if (!m) { this._pcCloseMentionMenu(); return; }
    const query = m[1].toLowerCase();
    const matches = (this.multiplayer?.participants || [])
      .filter((p) => p.user_id !== ME?.id && p.username)
      .map((p) => ({ username: p.username, display_name: p.user_display_name, avatar: p.avatar }))
      .filter((u) => u.username.toLowerCase().includes(query) || (u.display_name || "").toLowerCase().includes(query))
      .slice(0, 6);
    if (!matches.length) { this._pcCloseMentionMenu(); return; }
    this._pcShowMentionMenu(input, matches);
  }

  _pcShowMentionMenu(input, matches) {
    this._pcCloseMentionMenu();
    this._pcMentionMatches = matches;
    this._pcMentionIndex = 0;
    this._pcMentionOpen = true;
    const rect = input.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "dropdown-menu open";
    menu.style.cssText = `position:fixed;top:auto;right:auto;left:${rect.left}px;bottom:${window.innerHeight - rect.top + 4}px;min-width:${Math.max(180, rect.width / 2)}px;max-height:220px;overflow-y:auto;z-index:10050`;
    menu.innerHTML = matches.map((u, i) => `
      <button type="button" class="dropdown-item${i === 0 ? " active" : ""}" data-pc-mention-pick="${_attr(u.username)}" style="display:flex;align-items:center;gap:8px">
        <span class="comment-avatar" style="width:22px;height:22px;flex:none">${u.avatar ? `<img src="${_attr(u.avatar)}" alt="">` : `<span>${_esc((u.display_name || u.username)[0]?.toUpperCase() || "?")}</span>`}</span>
        <span style="min-width:0"><span class="text-ink">${_esc(u.display_name || u.username)}</span> <span class="text-muted" style="font-size:11px">@${_esc(u.username)}</span></span>
      </button>
    `).join("");
    menu.querySelectorAll("[data-pc-mention-pick]").forEach((btn) => {
      btn.onmousedown = (e) => { e.preventDefault(); this._pcPickMention(input, btn.dataset.pcMentionPick); };
    });
    _floatingPopupHost().appendChild(menu);
    this._pcMentionMenu = menu;
  }

  _pcHandleMentionKey(e) {
    if (e.key === "Escape") { e.preventDefault(); this._pcCloseMentionMenu(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this._pcMoveMention(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); this._pcMoveMention(-1); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const input = this.partyChatModalEl.querySelector("#mpPartyChatInput");
      this._pcPickMention(input, this._pcMentionMatches[this._pcMentionIndex].username);
    }
  }

  _pcMoveMention(delta) {
    if (!this._pcMentionMenu) return;
    const items = [...this._pcMentionMenu.querySelectorAll("[data-pc-mention-pick]")];
    items[this._pcMentionIndex]?.classList.remove("active");
    this._pcMentionIndex = (this._pcMentionIndex + delta + items.length) % items.length;
    items[this._pcMentionIndex]?.classList.add("active");
    items[this._pcMentionIndex]?.scrollIntoView({ block: "nearest" });
  }

  _pcPickMention(input, username) {
    const start = input.selectionStart;
    const before = input.value.slice(0, start).replace(/@([A-Za-z0-9_-]{0,32})$/, `@${username} `);
    input.value = before + input.value.slice(start);
    const pos = before.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    this._pcCloseMentionMenu();
  }

  _pcCloseMentionMenu() {
    this._pcMentionOpen = false;
    this._pcMentionMenu?.remove();
    this._pcMentionMenu = null;
  }

  _renderPartyChatMessages() {
    const list = this.partyChatModalEl?.querySelector("#mpPartyChatList");
    if (!list) return;
    list.innerHTML = this.partyChatMessages.map((m) => {
      const isMe = m.sender_user_id === ME?.id;
      const participant = this.multiplayer?.participants?.find((p) => p.user_id === m.sender_user_id);
      const name = isMe ? (ME?.display_name || ME?.username || t("chat_you_fallback_name")) : (participant?.user_display_name || participant?.username || t("chat_multiplayer_unknown_participant", "Someone"));
      const avatar = isMe ? ME?.avatar : participant?.avatar;
      const when = m.created ? timeAgo(m.created) : "";
      return `
        <div class="comment-row">
          <span class="comment-avatar">${avatar ? `<img src="${_attr(avatar)}" alt="">` : `<span>${_esc((name[0] || "?").toUpperCase())}</span>`}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:6px">
              <span class="comment-name">${_esc(name)}</span>
              ${when ? `<span class="comment-meta">${_esc(when)}</span>` : ""}
            </div>
            ${m.content ? `<div class="comment-body">${renderCommentMarkdown(m.content)}</div>` : ""}
            ${m.image ? `<img src="${_attr(m.image)}" alt="" style="max-width:180px;border-radius:10px;margin-top:6px;display:block">` : ""}
          </div>
        </div>
      `;
    }).join("");
    list.scrollTop = list.scrollHeight;
  }

  railHtml() {
    if (this.railHidden) return "";
    const isGroup = !!this.session?.is_group;
    const c = this.char || {};
    const hue = [...(c.id || "x")].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    const soloAvatar = c.avatar
      ? `<img src="${_esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">`
      : `<div style="width:100%;height:100%;background:linear-gradient(150deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 45% 16%));display:grid;place-items:center;font-family:var(--font-display);font-size:28px;color:#fff">${_esc(c.name?.[0]?.toUpperCase() || "?")}</div>`;
    const avatarInner = isGroup ? groupGridAvatar(this.session.cast) : soloAvatar;
    const headerName = isGroup ? (this.session.title || t("group_chat_label", "Group")) : c.name;
    const headerSub = isGroup ? (this.session.cast || []).map((m) => m.name).join(", ") : (this.session.char_doing || this.session.char_location || "");
    return `
      <div id="chatInfoRail" class="hidden lg:flex" style="flex:none;width:280px;border-left:1px solid var(--color-line);background:var(--color-surface-2);flex-direction:column;overflow-y:auto">
        <div style="padding:20px 16px;text-align:center;border-bottom:1px solid var(--color-line)">
          <div style="width:72px;height:72px;margin:0 auto 10px;border-radius:16px;overflow:hidden">${avatarInner}</div>
          <div class="font-display" style="font-weight:600;font-size:16px;color:var(--color-ink)">${_esc(headerName)}</div>
          <div style="font-size:11px;color:var(--color-muted);margin-top:3px">${_esc(headerSub)}</div>
        </div>
        <div style="padding:8px">
          <button type="button" id="chatRailNewChat" data-menu="newchat" class="settings-row" style="cursor:pointer;width:100%">
            <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>
            </span>
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[14.5px] text-ink">${t("chat_start_new_chat")}</span>
            </span>
          </button>
          <button type="button" id="chatRailMemory" data-menu="memory" class="settings-row" style="cursor:pointer;width:100%">
            <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a5 5 0 0 0-5 5c0 2 1 3 1 5a4 4 0 0 0 8 0c0-2 1-3 1-5a5 5 0 0 0-5-5z"/><path d="M9.5 18h5M10 21h4"/></svg>
            </span>
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[14.5px] text-ink">${t("chat_view_memory")}</span>
            </span>
          </button>
          <button type="button" id="chatRailRename" data-menu="rename" class="settings-row" style="cursor:pointer;width:100%">
            <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L7 21l-4 1 1-4z"/></svg>
            </span>
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[14.5px] text-ink">${t("chat_rename_session")}</span>
            </span>
          </button>
          ${this.canChangeLanguage() ? `
            <button type="button" id="chatRailLanguage" data-menu="language" class="settings-row" style="cursor:pointer;width:100%">
              <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/></svg>
              </span>
              <span class="flex-1 min-w-0 text-left">
                <span class="block text-[14.5px] text-ink">${t("chat_reply_language")}</span>
              </span>
            </button>
          ` : ""}
          <button type="button" id="chatRailHideOoc" data-menu="hideooc" class="settings-row" style="cursor:pointer;width:100%">
            <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c7 0 10.5 7 10.5 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 1.5 12 1.5 12s3.5 7 10.5 7c1.4 0 2.6-.3 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
            </span>
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[14.5px] text-ink">${t("chat_hide_ooc", "Hide OOC")}</span>
            </span>
            <span class="settings-toggle${store.get("hideOoc", false) ? " on" : ""}" style="flex:none;pointer-events:none"><span class="settings-toggle-knob"></span></span>
          </button>
          <button type="button" id="chatRailExport" data-menu="export" class="settings-row" style="cursor:pointer;width:100%">
            <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </span>
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[14.5px] text-ink">${t("chat_export_chat")}</span>
            </span>
          </button>
          ${this.multiplayer ? `
            <button type="button" id="chatRailInvite" data-menu="invite" class="settings-row" style="cursor:pointer;width:100%">
              <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              </span>
              <span class="flex-1 min-w-0 text-left">
                <span class="block text-[14.5px] text-ink">${t("chat_multiplayer_invite_menu", "Invite to this chat")}</span>
              </span>
            </button>
          ` : ""}
          ${this.multiplayer ? `
            <button type="button" id="chatRailPartyChat" data-menu="partychat" class="settings-row" style="cursor:pointer;width:100%">
              <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </span>
              <span class="flex-1 min-w-0 text-left">
                <span class="block text-[14.5px] text-ink">${t("chat_multiplayer_party_chat_menu", "Party chat")}</span>
              </span>
            </button>
          ` : ""}
          ${this.session.is_group ? `
            <button type="button" id="chatRailPublishGroup" data-menu="publishgroup" data-feature="groups" class="settings-row" style="cursor:pointer;width:100%">
              <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center text-sec">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              </span>
              <span class="flex-1 min-w-0 text-left">
                <span class="block text-[14.5px] text-ink">${t("group_publish_action", "Publish as group")}</span>
              </span>
            </button>
          ` : ""}
          <button type="button" id="chatRailDelete" data-menu="delete" class="settings-row" style="cursor:pointer;color:var(--color-warn);width:100%">
            <span class="flex-none w-[34px] h-[34px] rounded-[10px] bg-surface border border-line grid place-items-center" style="color:var(--color-warn)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </span>
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[14.5px]">${t("chat_delete_this_chat")}</span>
            </span>
          </button>
        </div>
      </div>
    `;
  }

  _groupChar(cid) {
    return (this.session?.cast || []).find((c) => c.char_id === cid) || null;
  }

  _grpColor(cid) {
    const hue = [...String(cid)].reduce((h, ch) => h + ch.charCodeAt(0), 0) % 360;
    return `hsl(${hue} 55% 62%)`;
  }

  async groupStreamAction(url) {
    if (this.streaming) { toast(t("chat_still_generating_wait")); return; }
    this.streaming = true; this.render(); this.scrollToBottom();
    try {
      const res = await fetch(url, { method: "POST", credentials: "include" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || t("chat_that_turn_failed")); }
      const controller = new AbortController();
      await sseEvents(res, async (ev) => {
        if (ev.type === "status" && ev.char_id) { this._groupPending(ev.char_id, "", "", true); }
        else if (ev.type === "delta" && ev.char_id) {
          const chatMode = this.session.group_mode === "chat";
          const split = chatMode ? { dialogue: ev.content, action: "" } : groupSplitSpeech(ev.content);
          await this.revealTyping(split.dialogue || ev.content, controller.signal, (partial) => {
            this._groupPending(ev.char_id, partial, split.action, false);
          });
        } else if (ev.type === "message" && ev.message) {
          this.main.querySelector(`#chatThread [data-pending-grp="${CSS.escape(ev.char_id || "")}"]`)?.remove();
          if (ev.lore?.length || ev.memory?.length) {
            this.recallByMid = this.recallByMid || {};
            this.recallByMid[ev.message.id] = { lore: ev.lore, memory: ev.memory };
          }
          this.session.messages.push(ev.message); this.render(); this.scrollToBottom();
        }
        else if (ev.type === "error") throw new Error(ev.message || t("chat_generation_failed_fallback"));
        else if (ev.type === "done") { this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`); }
      });
    } catch (err) {
      toast(err.message || t("chat_that_turn_failed"));
      try { this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`); } catch (e) { /* keep local */ }
    } finally {
      this.streaming = false; this.render(); this.scrollToBottom();
    }
  }

  groupPoke(cid) { this.groupStreamAction(`/api/sessions/${encodeURIComponent(this.sid)}/speak/${encodeURIComponent(cid)}`); }
  groupReassign(mid, cid) { this.groupStreamAction(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(mid)}/reassign/${encodeURIComponent(cid)}`); }

  async groupToggleMute(cid) {
    const m = this._groupChar(cid); if (!m) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}/cast/${encodeURIComponent(cid)}/mute`, { method: "PUT", body: JSON.stringify({ muted: !m.muted }) });
      m.muted = !m.muted; this.render();
    } catch (e) { errorToast(e.message); }
  }

  _grpMenu(anchor, items) {
    document.querySelector(".grp-menu")?.remove();
    const r = anchor.getBoundingClientRect();
    const m = document.createElement("div");
    m.className = "grp-menu";
    m.style.cssText = `position:fixed;z-index:60;top:${r.bottom + 4}px;left:${Math.max(8, Math.min(r.left, window.innerWidth - 200))}px;min-width:180px;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:11px;padding:5px;box-shadow:0 14px 34px -12px rgba(0,0,0,.6)`;
    m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" style="width:100%;text-align:left;background:none;border:none;color:var(--color-ink);font-size:12.5px;font-family:inherit;padding:8px 10px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px">${it.label}</button>`).join("");
    m.querySelectorAll("button").forEach((b, i) => { b.onclick = (e) => { e.stopPropagation(); m.remove(); items[i].onClick(); }; });
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }), 0);
  }

  openRosterMenu(cid, anchor) {
    const m = this._groupChar(cid); if (!m) return;
    this._grpMenu(anchor, [
      { label: `👉 ${t("chat_group_make_speak", "Make")} ${_esc(m.name)} ${t("chat_group_speak", "speak")}`, onClick: () => this.groupPoke(cid) },
      { label: m.muted ? `🔊 ${t("chat_group_unmute", "Unmute")}` : `🔇 ${t("chat_group_mute", "Mute (skip in auto-pick)")}`, onClick: () => this.groupToggleMute(cid) },
    ]);
  }

  openReassignMenu(msg, anchor) {
    const items = (this.session.cast || []).map((m) => ({
      label: `<span style="width:10px;height:10px;border-radius:3px;background:${this._grpColor(m.char_id)};flex:none"></span> ${_esc(m.name)}${m.char_id === msg.char_id ? " ·" : ""}`,
      onClick: () => this.groupReassign(msg.id, m.char_id),
    }));
    this._grpMenu(anchor, items);
  }

  groupRosterHtml() {
    const cast = this.session.cast || [];
    if (!cast.length) return "";
    return `<div class="grp-roster">${cast.map((m) => {
      const bg = m.avatar ? `background-image:url('${_esc(m.avatar)}');background-size:cover;background-position:center` : `background:linear-gradient(150deg,${this._grpColor(m.char_id)},#00000088)`;
      return `<button type="button" class="grp-roster-av${m.muted ? " muted" : ""}" data-roster="${_esc(m.char_id)}" style="${bg}" title="${_esc(m.name)}" aria-label="${_esc(m.name)}">${m.muted ? "🔇" : ""}</button>`;
    }).join("")}</div>`;
  }

  groupVoicesHtml() {
    if (this.streaming) return "";
    const cast = (this.session.cast || []).filter((m) => !m.muted);
    const msgs = this.session.messages || [];
    const lastTg = [...msgs].reverse().find((m) => m.role === "assistant" && m.turn_group)?.turn_group;
    if (!lastTg) return "";
    const spoke = new Set(msgs.filter((m) => m.turn_group === lastTg && m.char_id).map((m) => m.char_id));
    const remaining = cast.filter((m) => !spoke.has(m.char_id));
    if (!remaining.length) return "";
    return `<div class="grp-voices"><span class="grp-voices-lbl">${t("chat_add_a_voice", "add a voice")}</span>${remaining.map((m) =>
      `<button type="button" class="grp-voice-chip" data-voice="${_esc(m.char_id)}" style="--vc:${this._grpColor(m.char_id)}"><span class="grp-voice-dot"></span>${_esc(m.name)}</button>`).join("")}</div>`;
  }

  _groupHeaderAvatar() {
    return groupGridAvatar(this.session.cast);
  }

  pfpHtml(you, msg) {
    const c = this.char;
    if (you) {
      const name = msg.user_name || this._myPersonaName();
      const avatar = msg.user_name ? msg.persona_avatar : this.personaAvatar;
      const initial = _esc(name[0]?.toUpperCase() || "?");
      return avatar
        ? `<div class="chat-pfp chat-pfp-user" style="background-image:url('${_esc(avatar)}')"></div>`
        : `<div class="chat-pfp chat-pfp-user chat-pfp-fallback">${initial}</div>`;
    }
    const member = (this.session?.is_group && msg.char_id) ? this._groupChar(msg.char_id) : null;
    if (member) {
      const gi = _esc((member.name || "?")[0].toUpperCase());
      const memberSprite = pickStageAsset(member.sprites, msg.mood);
      if (memberSprite) {
        return `<div class="chat-pfp chat-pfp-char" style="background-image:url('${_esc(memberSprite)}')" data-tooltip="${_esc(member.name)}${msg.mood ? " · " + _esc(msg.mood) : ""}"></div>`;
      }
      return member.avatar
        ? `<div class="chat-pfp chat-pfp-char" style="background-image:url('${_esc(member.avatar)}')" data-tooltip="${_esc(member.name)}"></div>`
        : `<div class="chat-pfp chat-pfp-char chat-pfp-fallback" data-tooltip="${_esc(member.name)}">${gi}</div>`;
    }
    const spriteUrl = pickStageAsset((c.assets || {}).sprites, msg.mood);
    if (spriteUrl) {
      return `<div class="chat-pfp chat-pfp-char" style="background-image:url('${_esc(spriteUrl)}')" data-tooltip="${_esc(msg.mood || "")}"></div>`;
    }
    const initial = _esc(c.name?.[0]?.toUpperCase() || "?");
    return c.avatar
      ? `<div class="chat-pfp chat-pfp-char" style="background-image:url('${_esc(c.avatar)}')"></div>`
      : `<div class="chat-pfp chat-pfp-char chat-pfp-fallback">${initial}</div>`;
  }

  _multiplayerNameLabelHtml(msg, personaName) {
    if (!this.multiplayer || msg.role !== "user") return null;
    const isMe = msg.sender_user_id ? msg.sender_user_id === ME?.id : true;
    const participant = this.multiplayer.participants?.find((p) => p.user_id === msg.sender_user_id);
    const username = isMe ? (ME?.display_name || ME?.username) : (participant?.user_display_name || participant?.username);
    if (!username) return null;
    const hasPersona = isMe ? !!this._myPersonaId() : !!participant?.persona_id;
    return `<div class="chat-name-label" style="text-transform:none">${_esc(username)}${hasPersona && personaName ? ` <span style="text-transform:uppercase;color:var(--color-accent)">· ${_esc(personaName)}</span>` : ""}</div>`;
  }

  turnHtml(msg, isLastAssistant, isSwappableGreeting, isGreeting, greetingIndex, greetingCount) {
    const you = msg.role === "user";
    const { body: rawBody } = you ? { body: stripMood(msg.content) } : splitThink(msg.content);
    const parsed = parseCommandedMessage(rawBody, msg.role);
    const groupMember = (!you && this.session?.is_group && msg.char_id) ? this._groupChar(msg.char_id) : null;
    const name = you ? (msg.user_name || this._myPersonaName())
                     : (groupMember ? groupMember.name : this.char.name);
    const selected = this.selectedIds.has(msg.id);
    const hideOoc = store.get("hideOoc", false);
    const isGroup = !!this.session?.is_group;
    const trayActions = hideOoc ? parsed.actions.filter((a) => a.kind !== "ooc") : parsed.actions;
    const asBadge = parsed.asName ? cmdAsBadgeHtml(parsed.asName) : "";
    const memberCol = groupMember ? this._grpColor(groupMember.char_id) : "var(--color-accent)";
    let breaks = [...parsed.scenes.map((s) => cmdBreakHtml("scene", s)), ...parsed.times.map((s) => cmdBreakHtml("time", s))].join("");
    let narrHtml = "";
    let hasBubble, bubbleInner, trayRow;
    const imgHtml = msg.image ? `<img src="${_esc(msg.image)}" alt="" style="max-width:100%;border-radius:10px;margin-top:8px;display:block${msg.image_is_explicit ? ";filter:blur(20px) saturate(60%)" : ""}">` : "";
    if (isGroup) {
      trayRow = trayActions.length ? `<div class="grp-cmd-row">${trayActions.map((a) => grpCmdCard(a)).join("")}</div>` : "";
      const chatMode = this.session?.group_mode === "chat";
      if (!you && !msg.char_id) {
        narrHtml = chatMode
          ? `<div class="grp-narr">${_esc(t("group_chat_scene_note", "You're in a chat room with these characters. Only dialogue and commands are allowed."))}</div>`
          : `<div class="grp-narr">${chatMd(parsed.prose || rawBody)}</div>`;
        hasBubble = false; bubbleInner = "";
      } else if (chatMode) {
        hasBubble = !!(parsed.prose || msg.image);
        bubbleInner = !hasBubble ? "" : `
        <div class="chat-msg-row">
        ${!you ? this.pfpHtml(you, msg) : ""}
        <div class="chat-bubble" data-toggle-actions="${_esc(msg.id)}"><div class="sym-body">${chatMd(parsed.prose)}</div>${imgHtml}</div>
        ${you ? this.pfpHtml(you, msg) : ""}
        </div>`;
      } else {
        const sp = groupSplitSpeech(parsed.prose);
        narrHtml = sp.action ? `<div class="grp-narr">${chatMd(sp.action)}</div>` : "";
        hasBubble = !!(sp.dialogue || msg.image);
        bubbleInner = !hasBubble ? "" : `
        <div class="chat-msg-row">
        ${!you ? this.pfpHtml(you, msg) : ""}
        <div class="chat-bubble" data-toggle-actions="${_esc(msg.id)}"><div class="sym-body">${chatMd(sp.dialogue)}</div>${imgHtml}</div>
        ${you ? this.pfpHtml(you, msg) : ""}
        </div>`;
      }
    } else {
      const trayH = trayActions.length ? cmdTrayHtml(msg.id, trayActions) : "";
      trayRow = trayH ? `<div class="cmd-tray-row" style="display:flex;justify-content:${you ? "flex-end" : "flex-start"}">${trayH}</div>` : "";
      hasBubble = !!(parsed.prose || msg.image);
      bubbleInner = !hasBubble ? "" : `
        <div class="chat-msg-row">
        ${!you ? this.pfpHtml(you, msg) : ""}
        <div class="chat-bubble" data-toggle-actions="${_esc(msg.id)}">
          ${asBadge}
          <div class="sym-body">${chatMd(parsed.prose)}</div>
          ${imgHtml}
        </div>
        ${you ? this.pfpHtml(you, msg) : ""}
        </div>`;
    }
    const bare = !hasBubble && !trayRow && !breaks && !narrHtml;
    return `
      <div class="chat-turn ${you ? "you" : "ai"}${bare ? " chat-turn-offstage" : ""}${this.selectMode && !isGreeting ? " selectable" : ""}${selected ? " selected" : ""}" data-mid="${_esc(msg.id)}">
        ${this.selectMode && !isGreeting ? `<div class="chat-select-check" data-select-check="${_esc(msg.id)}">${selected ? checkIconSvg() : ""}</div>` : ""}
        <div class="chat-turn-body">
        ${breaks}
        ${narrHtml}
        ${trayRow}
        ${bubbleInner}
        ${hasBubble ? (this._multiplayerNameLabelHtml(msg, name) || `<div class="chat-name-label"${isGroup && groupMember ? ` style="color:${memberCol}"` : ""}>${_esc(name)}</div>`) : ""}
        ${this.recallHtml(msg.id)}
        <div class="chat-actions-row" data-actions-for="${_esc(msg.id)}">
          <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="copy" aria-label="${t("chat_copy")}" data-tooltip="${t("chat_copy")}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="edit" aria-label="${t("chat_edit")}" data-tooltip="${t("chat_edit")}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          ${!isGreeting ? `
            <button type="button" class="ig-icon-btn danger" style="position:static;width:26px;height:26px" data-act="delete" aria-label="${t("chat_delete")}" data-tooltip="${t("chat_delete")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          ` : ""}
          <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="branch" aria-label="${t("chat_branch_chat_from_here")}" data-tooltip="${t("chat_branch_from_here")}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
          </button>
          ${this.session?.is_group && !you && !isGreeting ? `
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="reassign" aria-label="${t("chat_group_reassign", "Reassign speaker")}" data-tooltip="${t("chat_group_reassign", "Reassign speaker")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
            </button>
          ` : ""}
          ${!you ? `
            <button type="button" class="ig-icon-btn" data-media-gen style="position:static;width:26px;height:26px" data-act="image" aria-label="${msg.image ? t("chat_regenerate_image") : t("chat_generate_image")}" data-tooltip="${msg.image ? t("chat_regenerate_image") : t("chat_generate_image")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            </button>
          ` : ""}
          ${isSwappableGreeting ? `
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="greeting-prev" aria-label="${t("chat_previous_greeting")}" data-tooltip="${t("chat_previous_greeting")}">
              <svg class="icon-flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style="font-size:10.5px;color:var(--color-muted);align-self:center;font-variant-numeric:tabular-nums">${greetingIndex + 1}/${greetingCount}</span>
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="greeting-next" aria-label="${t("chat_next_greeting")}" data-tooltip="${t("chat_next_greeting")}">
              <svg class="icon-flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          ` : isLastAssistant ? `
            ${(msg.swipe_count || 1) > 1 ? `
              <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="swipe-prev" aria-label="${t("chat_previous_reply")}" data-tooltip="${t("chat_previous_reply")}">
                <svg class="icon-flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span style="font-size:10.5px;color:var(--color-muted);align-self:center;font-variant-numeric:tabular-nums">${(msg.swipe_index || 0) + 1}/${msg.swipe_count}</span>
              <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="swipe-next" aria-label="${t("chat_next_reply")}" data-tooltip="${t("chat_next_reply")}">
                <svg class="icon-flip-rtl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            ` : ""}
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="regenerate" aria-label="${t("chat_regenerate")}" data-tooltip="${t("chat_regenerate")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <button type="button" class="ig-icon-btn" style="position:static;width:26px;height:26px" data-act="continue" aria-label="${t("chat_continue")}" data-tooltip="${t("chat_continue")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
            </button>
          ` : ""}
        </div>
        </div>
      </div>
    `;
  }

  recallHtml(mid) {
    const meta = this.recallByMid?.[mid];
    if (!meta || (!meta.lore?.length && !meta.memory?.length)) return "";
    const block = (label, items) => items?.length ? `<div style="margin-top:6px"><div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--color-muted)">${label}</div>${items.map((i) => `<div style="font-size:12px;color:var(--color-sec);padding:2px 0">${_esc(typeof i === "string" ? i : i.text || "")}</div>`).join("")}</div>` : "";
    return `
      <details class="chat-think" style="margin-top:4px">
        <summary>${t("chat_drew_on_prefix")} ${(meta.lore?.length || 0) + (meta.memory?.length || 0)} ${((meta.lore?.length || 0) + (meta.memory?.length || 0)) === 1 ? t("chat_entry_singular") : t("chat_entries_plural")}</summary>
        <div class="chat-think-body">${block(t("chat_lore_label"), meta.lore)}${block(t("chat_memory_label"), meta.memory)}</div>
      </details>
    `;
  }

  threadHtml() {
    if (!this.session.messages.length) {
      return `<p style="color:var(--color-sec);font-size:13px;text-align:center;padding:24px 0">${t("chat_no_lines_exchanged_yet")}</p>`;
    }
    const lastAssistantId = [...this.session.messages].reverse().find((m) => m.role === "assistant")?.id;
    const isGreeting = this.session.messages[0].role === "assistant";
    const isSwappableGreeting = isGreeting && this.session.messages.length === 1
      && (this.char.alt_greetings || []).length > 0;
    const greetingCount = 1 + (this.char.alt_greetings || []).length;
    if (this.greetingIndex === undefined) this.greetingIndex = 0;
    const hideOoc = store.get("hideOoc", false);
    const msgs = this.session.messages;
    let html = "";
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const next = msgs[i + 1];
      if (!hideOoc && m.role === "user" && next?.role === "assistant") {
        const userOoc = pureOocDetail(m);
        const charOoc = userOoc !== null ? pureOocDetail(next) : null;
        if (userOoc !== null && charOoc !== null) {
          const userName = m.user_name || this.session.user_name || t("chat_you_fallback_name");
          html += oocExchangeHtml(userName, userOoc, this.char.name, charOoc);
          i++;
          continue;
        }
      }
      html += this.turnHtml(m, m.id === lastAssistantId,
        isSwappableGreeting && i === 0, isGreeting && i === 0, this.greetingIndex, greetingCount);
    }
    return html + this.stoppedTurnHtml();
  }

  stoppedTurnHtml() {
    if (!this.stoppedTurn) return "";
    const { name, body } = this.stoppedTurn;
    return `
      <div class="chat-turn ai">
        <div class="chat-name-label">${_esc(name)}</div>
        <div class="chat-bubble"><div class="sym-body">${body ? chatMd(stripMood(body)) + " " : ""}<em>${t("chat_stopped_suffix")}</em></div></div>
      </div>
    `;
  }

  ensurePersonalBgChecked() {
    const url = ME?.chat_background_img;
    if (!url) { this.personalBgOk = false; return; }
    if (_personalBgLoadCache.has(url)) { this.personalBgOk = _personalBgLoadCache.get(url); return; }
    this.personalBgOk = false;
    checkPersonalBgLoads(url).then((ok) => {
      if (ok) { this.personalBgOk = true; this.render(); }
    });
  }

  render() {
    window._activeChatView = this;
    const prevScrollTop = this.main.querySelector("#chatThread")?.scrollTop;
    if (this.error) {
      this.main.innerHTML = `
        <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <p style="color:var(--color-warn);font-size:13px">${_esc(this.error)}</p>
          <a href="/chats" onclick="event.preventDefault();navigate('/chats')" class="font-mono" style="font-size:11px;color:var(--color-accent)">${dirMark("&larr;", "&rarr;")} ${t("chat_back_to_chats")}</a>
        </div>
      `;
      return;
    }
    if (!this.session || !this.char) {
      this.main.innerHTML = `<p style="padding:16px;color:var(--color-sec);font-size:13px">${t("chat_unsealing_correspondence")}</p>`;
      return;
    }
    const rpg = this.char.mode === "rpg";
    const assets = this.char.assets || {};
    const hasStage = !this.session.is_group && (hasStageImage(assets.stage) || hasStageImage(assets.sprites));
    this.ensurePersonalBgChecked();
    const hasPersonalBg = this.personalBgOk;
    const canToggleStage = hasStage && hasPersonalBg;
    const stageHiddenKey = `stageHidden:${this.char.id}`;
    const stageHidden = canToggleStage && store.get(stageHiddenKey, false);
    this.main.innerHTML = `
      <div class="chat-screen-root">
        ${this.headerHtml()}
        ${this.session.is_group ? this.groupRosterHtml() : ""}
        <div id="chatBody" style="position:relative;flex:1;min-height:0;display:flex">
        <div id="chatMainCol" class="chat-stage-glass" style="position:relative;flex:1;min-width:0;display:flex;flex-direction:column">
        <div style="position:relative;flex:1;min-height:0">
          <div id="chatAmbientBg" class="chat-ambient-gradient"></div>
          ${hasStage ? `
            <div id="chatStage" style="position:absolute;inset:0;overflow:hidden;pointer-events:none;display:${stageHidden ? "none" : "block"}">
              <div id="chatStageBg" style="position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;transition:opacity .4s"></div>
              <img id="chatStageSprite" alt="" style="position:absolute;bottom:0;right:6%;max-height:88%;max-width:60%;object-fit:contain;opacity:0;transition:opacity .4s">
              <div style="position:absolute;inset:0;background:linear-gradient(to bottom, transparent 40%, color-mix(in srgb, var(--color-paper) 55%, transparent) 75%, var(--color-paper) 98%)"></div>
            </div>
            <audio id="chatStageAudio" loop></audio>
          ` : ""}
          ${hasPersonalBg ? `
            <div id="chatFallbackBg" style="position:absolute;inset:0;overflow:hidden;pointer-events:none;display:${(!hasStage || stageHidden) ? "block" : "none"}">
              <div style="position:absolute;inset:0;background-image:url('${_esc(ME.chat_background_img)}');background-size:cover;background-position:center;opacity:.4"></div>
              <div style="position:absolute;inset:0;background:linear-gradient(to bottom, transparent 40%, color-mix(in srgb, var(--color-paper) 55%, transparent) 75%, var(--color-paper) 98%)"></div>
            </div>
          ` : ""}
          <div id="chatThread" style="position:absolute;inset:0;overflow-y:auto;padding:22px 16px 56px">
            <div class="chat-thread-inner">
              ${this.threadHtml()}
              ${this.session.is_group && !this.streaming ? this.groupVoicesHtml() : ""}
              ${this.streaming && !this.session.is_group ? `<div class="chat-writing"><span class="chat-writing-dot"></span>${_esc(this.char.name)} ${t("chat_is_writing_suffix")}</div>` : ""}
            </div>
          </div>
          <button type="button" id="chatScrollFab" aria-label="${t("chat_scroll_to_latest")}" data-tooltip="${t("chat_scroll_to_latest")}" style="display:none;position:absolute;right:14px;bottom:14px;width:38px;height:38px;border-radius:999px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.25)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        ${this.continuePromptOpen ? `
          <div style="flex:none;display:flex;gap:8px;align-items:center;padding:9px 14px;border-top:1px solid var(--color-line);background:var(--color-surface-2)">
            <input type="text" id="chatContinueInput" placeholder="${t("chat_continue_input_placeholder")}" style="flex:1;min-width:0;padding:9px 11px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px">
            <button type="button" id="chatContinueCancel" class="chat-composer-btn" aria-label="${t("chat_cancel")}" data-tooltip="${t("chat_cancel")}" style="width:36px;height:36px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        ` : ""}
        <div style="position:relative;flex:none">
          <div id="chatCmdChips" class="chat-cmd-chips"></div>
          <div class="chat-composer">
            <div class="chat-composer-card">
              <div style="position:relative">
                <textarea id="chatInput" rows="2" class="${rpg ? "chat-input-has-dice" : ""}" placeholder="${this.multiplayerLocked ? t("chat_multiplayer_locked_placeholder", "Someone's acting — hang tight.") : (rpg ? t("chat_composer_placeholder_rpg") : t("chat_composer_placeholder_normal"))}" ${this.streaming || this.multiplayerLocked ? "disabled" : ""}></textarea>
                ${rpg ? `
                  <button type="button" id="chatDiceBtn" class="chat-dice-emoji-btn" aria-label="${t("chat_roll_dice")}" data-tooltip="${t("chat_roll_dice")}" ${this.diceRolledThisTurn || this.streaming ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>
                  </button>
                ` : ""}
              </div>
              <button type="button" id="chatExplicitBtn" class="chat-explicit-btn${this.session.explicit_mode ? " on" : ""}" aria-label="${t("chat_explicit_inject")}" data-tooltip="${t("chat_explicit_inject")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 3.5l-2 2M15 6l3 3-8.5 8.5-4-4L14 4.5l1-1"/><path d="M13 8l3 3"/><path d="M6.5 14.5L4 21l6.5-2.5"/></svg>
                <span>${t("chat_explicit_inject")}</span>
              </button>
              <div class="chat-composer-row">
                <div id="chatDesktopTools" style="align-items:center;gap:8px">
                  <button type="button" id="chatPersonaBtn" class="chat-composer-btn chat-composer-btn-labeled chat-composer-mask" aria-label="${t("chat_switch_mask_prefix")} (${_esc(this._myPersonaName())})" data-tooltip="${t("chat_switch_mask_prefix")} (${_esc(this._myPersonaName())})">
                    ${svgIcon("masks")}
                    <span>${_esc(this._myPersonaName())}</span>
                  </button>
                  <button type="button" id="chatStyleBtn" class="chat-composer-btn chat-composer-btn-labeled" aria-label="${t("chat_message_styles")}" data-tooltip="${t("chat_message_styles")}">
                    ${(() => {
                      const s = getAllChatStyles().find((x) => x.key === (this.session.style_key || "unspecified")) || CHAT_STYLES[0];
                      return `<span style="font-size:16px;line-height:1">${s.emoji}</span><span>${_esc(s.label)}</span>`;
                    })()}
                  </button>
                  <button type="button" id="chatLengthBtn" class="chat-composer-btn chat-composer-btn-labeled" aria-label="${t("chat_response_length")}" data-tooltip="${t("chat_response_length")}">
                    ${(() => {
                      const l = RESPONSE_LENGTHS.find((x) => x.key === (this.session.length_key || "epic")) || RESPONSE_LENGTHS[4];
                      return `<span style="font-size:16px;line-height:1">${l.emoji}</span><span>${_esc(l.label)}</span>`;
                    })()}
                  </button>
                </div>
                <div id="chatToolsWrap" style="position:relative">
                  <button type="button" id="chatToolsBtn" class="chat-composer-btn" aria-label="${t("chat_chat_tools")}" data-tooltip="${t("chat_chat_tools")}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.2 2.2-2-2z"/></svg>
                  </button>
                  ${this.toolsMenuOpen ? `
                    <div id="chatToolsMenu" style="position:absolute;bottom:calc(100% + 8px);left:0;z-index:20;min-width:210px;background:var(--color-surface-2);border:1px solid var(--color-line-2);border-radius:11px;box-shadow:0 8px 22px rgba(0,0,0,.3);overflow:hidden">
                      <button type="button" class="dropdown-item" data-tools-act="persona" style="display:flex;align-items:center;gap:9px">${svgIcon("masks")} ${t("chat_switch_mask")}</button>
                      <button type="button" class="dropdown-item" data-tools-act="style" style="display:flex;align-items:center;gap:9px">${(getAllChatStyles().find((x) => x.key === (this.session.style_key || "unspecified")) || CHAT_STYLES[0]).emoji} ${t("chat_message_style")}</button>
                      <button type="button" class="dropdown-item" data-tools-act="length" style="display:flex;align-items:center;gap:9px">${(RESPONSE_LENGTHS.find((x) => x.key === (this.session.length_key || "epic")) || RESPONSE_LENGTHS[4]).emoji} ${t("chat_response_length")}</button>
                      <button type="button" class="dropdown-item" data-tools-act="explicit" style="display:flex;align-items:center;gap:9px;${this.session.explicit_mode ? "color:var(--color-warn)" : ""}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 3.5l-2 2M15 6l3 3-8.5 8.5-4-4L14 4.5l1-1"/><path d="M13 8l3 3"/><path d="M6.5 14.5L4 21l6.5-2.5"/></svg>
                        ${t("chat_explicit_inject")}${this.session.explicit_mode ? ` ${t("chat_armed_suffix")}` : ""}
                      </button>
                    </div>
                  ` : ""}
                </div>
                ${this.streaming ? `
                  <button type="button" id="chatStop" class="chat-composer-pill" aria-label="${t("chat_stop_generating")}">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width:13px;height:13px"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                    ${t("chat_stop")}
                  </button>
                ` : `
                  <button type="button" id="chatSend" class="chat-composer-pill" data-feature="chat" aria-label="${t("chat_send")}" ${this.multiplayerLocked ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    ${t("chat_send")}
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>
        </div>
        ${this.railHtml()}
        </div>
      </div>
    `;
    if (this.selectMode) {
      document.getElementById("chatSelectCancel").onclick = () => {
        this.selectMode = false;
        this.selectedIds.clear();
        this.render();
      };
      document.getElementById("chatSelectDelete").onclick = () => this.deleteSelectedMessages();
    } else {
      document.getElementById("chatBack").onclick = () => navigate("/chats");
      document.getElementById("chatCharLink").onclick = () => {
        if (this.session.is_group) {
          if (this.session.source_group_id) navigate(`/g/${encodeURIComponent(this.session.source_group_id)}`);
          return;
        }
        navigate(`/c/${this.char.id}`);
      };
      document.getElementById("chatRailToggle").onclick = () => {
        this.railHidden = !this.railHidden;
        store.set("chatRailHidden", this.railHidden);
        this.render();
      };
    }
    this.wireComposer();
    this.wireTurnActions();
    this.wireContinuePrompt();
    this.wireScrollFab();
    this.wireMoreMenu();
    this.wireToolsMenu();
    if (hasStage) {
      this.paintStage();
      const stageToggle = document.getElementById("chatStageToggle");
      if (stageToggle) stageToggle.onclick = () => {
        const stage = document.getElementById("chatStage");
        const hidden = stage.style.display !== "none";
        stage.style.display = hidden ? "none" : "block";
        store.set(stageHiddenKey, hidden);
        const fallback = document.getElementById("chatFallbackBg");
        if (fallback) fallback.style.display = hidden ? "block" : "none";
      };
    }
    const muteToggle = document.getElementById("chatMuteToggle");
    if (muteToggle) muteToggle.onclick = () => this.toggleMute();
    const diceBtn = this.main.querySelector("#chatDiceBtn");
    if (diceBtn) diceBtn.onclick = () => this.openDiceModal();
    const explicitBtn = this.main.querySelector("#chatExplicitBtn");
    if (explicitBtn) explicitBtn.onclick = () => this.toggleExplicitMode();
    if (prevScrollTop != null) {
      const thread = this.main.querySelector("#chatThread");
      if (thread) thread.scrollTop = prevScrollTop;
    }
  }

  wireMoreMenu() {
    const btn = document.getElementById("chatMoreBtn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.moreMenuOpen = !this.moreMenuOpen;
      this.render();
    });
    if (this.moreMenuOpen && !this._moreMenuCloseListener) {
      this._moreMenuCloseListener = () => {
        this._moreMenuCloseListener = null;
        this.moreMenuOpen = false;
        this.render();
      };
      document.addEventListener("click", this._moreMenuCloseListener, { once: true });
    } else if (!this.moreMenuOpen && this._moreMenuCloseListener) {
      document.removeEventListener("click", this._moreMenuCloseListener);
      this._moreMenuCloseListener = null;
    }
    this.main.querySelectorAll("[data-menu]").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.moreMenuOpen = false;
        const which = item.dataset.menu;
        if (which === "memory") this.openMemoryModal();
        else if (which === "rename") this.renameChat();
        else if (which === "charstate") this.openCharStateModal();
        else if (which === "sessionlore") this.openSessionLoreModal();
        else if (which === "persona") this.openPersonaSwitchModal();
        else if (which === "style") this.openStyleModal();
        else if (which === "language") this.openLanguageModal();
        else if (which === "glossary") this.openGlossaryModal();
        else if (which === "note") this.openAuthorNoteModal();
        else if (which === "language") this.openLanguageModal();
        else if (which === "hideooc") this.toggleHideOoc();
        else if (which === "export") exportChat(this.char, this.session);
        else if (which === "mute") this.toggleMute();
        else if (which === "publishgroup") this.publishGroup();
        else if (which === "newchat") this.startNewChat();
        else if (which === "delete") this.deleteChat();
        else if (which === "invite") this.openInviteModal();
        else if (which === "partychat") this.openPartyChatModal();
      });
    });
  }

  wireToolsMenu() {
    const btn = document.getElementById("chatToolsBtn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toolsMenuOpen = !this.toolsMenuOpen;
      this.render();
    });
    if (this.toolsMenuOpen && !this._toolsMenuCloseListener) {
      this._toolsMenuCloseListener = () => {
        this._toolsMenuCloseListener = null;
        this.toolsMenuOpen = false;
        this.render();
      };
      document.addEventListener("click", this._toolsMenuCloseListener, { once: true });
    } else if (!this.toolsMenuOpen && this._toolsMenuCloseListener) {
      document.removeEventListener("click", this._toolsMenuCloseListener);
      this._toolsMenuCloseListener = null;
    }
    this.main.querySelectorAll("[data-tools-act]").forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toolsMenuOpen = false;
        const which = item.dataset.toolsAct;
        if (which === "persona") this.openPersonaSwitchModal();
        else if (which === "style") this.openStyleModal();
        else if (which === "length") this.openLengthModal();
        else if (which === "explicit") this.toggleExplicitMode();
      });
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    const audio = this.main.querySelector("#chatStageAudio");
    if (audio) {
      audio.muted = this.muted;
      if (!this.muted) audio.play().catch(() => {});
    }
    toast(this.muted ? t("chat_music_muted") : t("chat_music_unmuted"));
    this.render();
  }

  async renameChat() {
    const title = await promptDialog(t("chat_rename_session_prompt"), {
      title: t("chat_rename_session_title"),
      defaultValue: this.session.title || this.char.name,
      confirmLabel: t("chat_rename_session_save"),
    });
    if (title == null) return;
    const trimmed = title.trim();
    if (!trimmed || trimmed === this.session.title) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}`, { method: "PATCH", body: JSON.stringify({ title: trimmed }) });
      this.session.title = trimmed;
      this.render();
      toast(t("chat_session_renamed"));
    } catch (err) {
      errorToast(err.message || t("chat_couldnt_rename_session"));
    }
  }

  async publishGroup() {
    try {
      const r = await api("/api/groups", { method: "POST", body: JSON.stringify({ session_id: this.sid }) });
      toast(t("group_publish_done", "Published. Anyone can start this group now."));
      navigate(`/g/${r.id}`);
    } catch (err) {
      errorToast(err.message || t("group_publish_failed", "Couldn't publish that group."));
    }
  }

  async deleteChat() {
    if (!(await confirmDialog(`${t("chat_delete_chat_confirm_prefix")} ${this.char.name}${t("chat_delete_chat_confirm_suffix")}`))) return;
    if (this.draftCharId) { navigate("/chats"); return; }
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}`, { method: "DELETE" });
      toast(t("chat_chat_deleted"));
      navigate("/chats");
    } catch (err) {
      errorToast(err.message || t("chat_couldnt_delete_this_chat"));
    }
  }

  async startNewChat() {
    if (this.session.is_group) {
      if (!(await confirmDialog(t("chat_start_fresh_group_confirm", "Start a fresh group chat with the same cast?"), { confirmLabel: t("chat_start_new_chat"), danger: false }))) return;
      try {
        const char_ids = (this.session.cast || []).map((c) => c.char_id);
        const opening = this.session.messages?.[0]?.role === "assistant" && !this.session.messages[0].char_id
          ? this.session.messages[0].content : "";
        const r = await api("/api/group-chats", { method: "POST", body: JSON.stringify({ name: this.session.title || "Group", opening, char_ids, mode: this.session.group_mode || "roleplay" }) });
        navigate(`/chats/${encodeURIComponent(r.session_id)}`);
      } catch (e) { errorToast(e.message || t("group_create_failed", "Couldn't create the group.")); }
      return;
    }
    if (!(await confirmDialog(`${t("chat_start_fresh_chat_confirm_prefix")} ${this.char.name}${t("chat_start_fresh_chat_confirm_suffix")}`, { confirmLabel: t("chat_start_new_chat"), danger: false }))) return;
    navigate(`/c/${encodeURIComponent(this.char.id)}/new-chat`);
  }

  async openMemoryModal(query = "") {
    this.memoryPage = 0;
    openModal(`
      <h3>${query ? `${t("chat_search_memory_prefix")} "${_esc(query)}"` : t("chat_memory_heading")}</h3>
      <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;width:fit-content;margin-bottom:10px">
        <button type="button" class="filter-chip${this.memTab === "memory" ? " on" : ""}" id="memTabMemory">${t("chat_memory_tab")}</button>
        <button type="button" class="filter-chip${this.memTab === "lore" ? " on" : ""}" id="memTabLore">${t("chat_session_lore_tab")}</button>
      </div>
      ${this.memTab === "lore" ? `
        <div style="display:flex;gap:5px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:12px;padding:4px;width:fit-content;margin-bottom:14px">
          <button type="button" class="filter-chip${this.sessionLoreViewMode !== "web" ? " on" : ""}" id="slModeList">${t("chat_list_view")}</button>
          <button type="button" class="filter-chip${this.sessionLoreViewMode === "web" ? " on" : ""}" id="slModeWeb">${t("chat_web_view")}</button>
        </div>
      ` : ""}
      <div id="memBody" style="color:var(--color-muted)">${t("chat_loading")}</div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const tabMemoryBtn = layer.querySelector("#memTabMemory");
    const tabLoreBtn = layer.querySelector("#memTabLore");
    tabMemoryBtn.onclick = () => { this.memTab = "memory"; closeTopModal(); this.openMemoryModal(query); };
    tabLoreBtn.onclick = () => { this.memTab = "lore"; closeTopModal(); this.openMemoryModal(query); };
    if (this.memTab === "lore") {
      const modeListBtn = layer.querySelector("#slModeList");
      const modeWebBtn = layer.querySelector("#slModeWeb");
      modeListBtn.onclick = () => { this.sessionLoreViewMode = "list"; closeTopModal(); this.openMemoryModal(query); };
      modeWebBtn.onclick = () => { this.sessionLoreViewMode = "web"; closeTopModal(); this.openMemoryModal(query); };
      await this.renderMemoryLoreBody(layer.querySelector("#memBody"));
      return;
    }
    let mem = null;
    let memTotal = 0;
    const loadMem = async () => {
      const qs = query ? `q=${encodeURIComponent(query)}&k=20` : "";
      const res = await api(`/api/sessions/${encodeURIComponent(this.sid)}/memory${qs ? `?${qs}` : ""}`);
      mem = res.items;
      memTotal = res.total;
    };
    const render = async () => {
      const body = layer.querySelector("#memBody");
      if (mem === null) {
        try {
          await loadMem();
        } catch (err) {
          body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || t("chat_couldnt_load_memory"))}</p>`;
          return;
        }
      }
      if (!mem.length) {
        body.innerHTML = `<p style="color:var(--color-sec);font-size:13px;padding:6px 0 16px">${query ? t("chat_no_matches") : t("chat_no_memories_yet")}</p>`;
        return;
      }
      body.innerHTML = this.memoryListHtml(mem, memTotal);
      this.wireMemoryBody(body, render, () => { mem = null; });
    };
    await render();
  }

  async renderMemoryLoreBody(body) {
    let entries;
    try {
      entries = await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore`);
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || t("chat_couldnt_load_session_lore"))}</p>`;
      return;
    }
    if (this.sessionLoreViewMode === "web") this.renderSessionLoreWeb(body, entries);
    else this.renderSessionLoreList(body, entries);
  }

  memoryListHtml(mem, memTotal) {
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(mem.length / pageSize));
    const page = Math.min(this.memoryPage || 0, pageCount - 1);
    const pageItems = mem.slice(page * pageSize, page * pageSize + pageSize);
    const total = memTotal || mem.length;
    const countLabel = `${total} ${total === 1 ? t("chat_remembered_fact_singular") : t("chat_remembered_fact_plural")}`
      + (total > mem.length ? ` ${t("chat_remembered_facts_truncated", "(showing latest {n})").replace("{n}", mem.length)}` : "");
    return `
      <p style="font-size:12px;color:var(--color-muted);margin:0 0 10px">${countLabel}</p>
      ${pageItems.map((m) => `
        <div data-mid="${_esc(m.id)}" style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--color-line)">
          <div style="flex:1;font-size:13px;color:var(--color-ink)">${_esc(m.text)}</div>
          <button type="button" class="ig-icon-btn danger" data-mem-del style="position:static;width:22px;height:22px" aria-label="${t("chat_delete")}" data-tooltip="${t("chat_delete")}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `).join("")}
      ${pageCount > 1 ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px">
          <button type="button" id="memPagePrev" class="filter-chip" ${page === 0 ? "disabled" : ""}>${t("chat_page_prev", "Prev")}</button>
          <span style="font-size:12px;color:var(--color-muted)">${t("chat_page_indicator", "Page {page} of {total}").replace("{page}", page + 1).replace("{total}", pageCount)}</span>
          <button type="button" id="memPageNext" class="filter-chip" ${page >= pageCount - 1 ? "disabled" : ""}>${t("chat_page_next", "Next")}</button>
        </div>
      ` : ""}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button type="button" id="memClearAll" class="dropdown-item" style="flex:1;border:1px solid var(--color-warn);color:var(--color-warn)">${t("chat_clear_all_memory")}</button>
      </div>
    `;
  }

  renderSessionLoreWeb(body, entries) {
    const view = new SessionLoreWebView(entries, (entry) => {
      this.openSessionLoreEditor(body, entries, entry.id);
    });
    view.mount(body);
  }

  wireMemoryBody(body, render, invalidate) {
    body.querySelectorAll("[data-mem-del]").forEach((delBtn) => {
      delBtn.onclick = async () => {
        const mid = delBtn.closest("[data-mid]").dataset.mid;
        try {
          await api(`/api/sessions/${encodeURIComponent(this.sid)}/memory/${encodeURIComponent(mid)}`, { method: "DELETE" });
          invalidate();
          render();
        } catch (err) {
          errorToast(err.message || t("chat_couldnt_delete_that_memory"));
        }
      };
    });
    const clearAll = body.querySelector("#memClearAll");
    if (clearAll) clearAll.onclick = async () => {
      if (!(await confirmDialog(t("chat_clear_all_memory_confirm"), { confirmLabel: t("chat_clear") }))) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/memory`, { method: "DELETE" });
        toast(t("chat_memory_cleared"));
        this.memoryPage = 0;
        invalidate();
        render();
      } catch (err) {
        errorToast(err.message || t("chat_couldnt_clear_memory"));
      }
    };
    const pagePrev = body.querySelector("#memPagePrev");
    const pageNext = body.querySelector("#memPageNext");
    if (pagePrev) pagePrev.onclick = () => { this.memoryPage = Math.max(0, (this.memoryPage || 0) - 1); render(); };
    if (pageNext) pageNext.onclick = () => { this.memoryPage = (this.memoryPage || 0) + 1; render(); };
  }

  async openCharStateModal() {
    openModal(`<h3>${_esc(this.char.name)} ${t("chat_right_now_suffix")}</h3><div id="csBody" style="color:var(--color-muted)">${t("chat_loading")}</div>`);
    const layer = document.querySelector(".modal-layer:last-child");
    const body = layer.querySelector("#csBody");
    try {
      const st = await api(`/api/sessions/${encodeURIComponent(this.sid)}/state`);
      const rows = [];
      if (st.doing) rows.push(`<div style="margin:0 0 14px"><h4 style="margin:0 0 4px;font-size:12.5px;color:var(--color-muted)">${t("chat_doing_label")}</h4><div style="font-size:14px;color:var(--color-ink)">${_esc(st.doing)}</div></div>`);
      if (st.location) rows.push(`<div style="margin:0 0 14px"><h4 style="margin:0 0 4px;font-size:12.5px;color:var(--color-muted)">${t("chat_location_label")}</h4><div style="font-size:14px;color:var(--color-ink)">${_esc(st.location)}</div></div>`);
      if (st.known_names?.length) rows.push(`<div><h4 style="margin:0 0 6px;font-size:12.5px;color:var(--color-muted)">${t("chat_established_names_prefix")} (${st.known_names.length})</h4><div style="display:flex;flex-wrap:wrap;gap:6px">${st.known_names.map((n) => `<span class="char-stat-pill">${_esc(n)}</span>`).join("")}</div></div>`);
      body.innerHTML = rows.length ? rows.join("") : `<p style="color:var(--color-sec);font-size:13px;padding:6px 0 16px">${t("chat_nothing_established_yet")}</p>`;
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || t("chat_couldnt_load_character_state"))}</p>`;
    }
  }

  openSessionLoreModal() {
    this.memTab = "lore";
    return this.openMemoryModal();
  }

  renderSessionLoreList(body, entries) {
    body.innerHTML = entries.length ? entries.map((e) => `
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--color-line)">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px">
          <h4 style="margin:0;font-size:14px;color:var(--color-ink)">${_esc(e.name || e.category || t("chat_untitled_lore_entry"))}</h4>
          ${e.player_edited ? `<span style="font-family:var(--font-mono);font-size:9.5px;color:var(--color-accent);text-transform:uppercase;letter-spacing:.06em">${t("chat_edited_badge")}</span>` : ""}
        </div>
        <p style="font-size:13px;color:var(--color-sec);line-height:1.55;white-space:pre-wrap;margin:0 0 10px">${_esc(e.content)}</p>
        <div style="display:flex;gap:8px">
          <button type="button" class="dropdown-item" data-sl-edit="${_attr(e.id)}" style="flex:1;text-align:center">${t("chat_edit")}</button>
        </div>
      </div>
    `).join("") : `<p style="color:var(--color-sec);font-size:13px;padding:6px 0 16px">${t("chat_nothing_revealed_yet")}</p>`;
    body.querySelectorAll("[data-sl-edit]").forEach((btn) => {
      btn.onclick = () => this.openSessionLoreEditor(body, entries, btn.dataset.slEdit);
    });
  }

  openSessionLoreEditor(body, entries, lid) {
    const entry = entries.find((e) => e.id === lid);
    body.innerHTML = `
      <h4 style="margin:0 0 10px;font-size:14px;color:var(--color-ink)">${_esc(entry.name || t("chat_edit"))}</h4>
      <textarea id="slEditText" class="grimoire-field-textarea" rows="5" style="width:100%;margin-bottom:12px">${_esc(entry.content)}</textarea>
      <div class="grimoire-web-detail" style="border-color:var(--color-warn);margin:0 0 14px;padding:12px 16px">
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--color-warn);margin:0 0 6px">${t("chat_session_lore_warning_1")}</p>
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--color-warn);margin:0 0 6px">${t("chat_session_lore_warning_2")}</p>
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--color-warn);margin:0">${t("chat_session_lore_warning_3")}</p>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="pe-gen-btn" id="slEditCancel" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("chat_cancel")}</button>
        ${entry.player_edited ? `<button type="button" class="pe-gen-btn" id="slEditClear" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("chat_clear_override")}</button>` : ""}
        <button type="button" class="pe-gen-btn" id="slEditSave">${t("chat_save")}</button>
      </div>
    `;
    body.querySelector("#slEditCancel").onclick = () => this.renderMemoryLoreBody(body);
    const clearBtn = body.querySelector("#slEditClear");
    if (clearBtn) clearBtn.onclick = async () => {
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/${encodeURIComponent(lid)}/override`,
          { method: "PUT", body: JSON.stringify({ content: null }) });
        toast(t("chat_override_cleared"));
        this.renderMemoryLoreBody(body);
      } catch (err) {
        errorToast(err.message || t("chat_couldnt_clear_the_override"));
      }
    };
    body.querySelector("#slEditSave").onclick = async () => {
      const content = body.querySelector("#slEditText").value.trim();
      if (!content) { toast(t("chat_content_required")); return; }
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/lore/${encodeURIComponent(lid)}/override`,
          { method: "PUT", body: JSON.stringify({ content }) });
        toast(t("chat_saved"));
        this.renderMemoryLoreBody(body);
      } catch (err) {
        errorToast(err.message || t("chat_couldnt_save_this_override"));
      }
    };
  }

  async openPersonaSwitchModal() {
    openModal(`<h3>${t("chat_switch_mask")}</h3><div id="personaBody" style="color:var(--color-muted)">${t("chat_loading")}</div>`);
    const layer = document.querySelector(".modal-layer:last-child");
    const body = layer.querySelector("#personaBody");
    let personas;
    try {
      personas = this.multiplayer
        ? await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/my-personas`)
        : await api("/api/personas");
    } catch (err) {
      body.innerHTML = `<p style="color:var(--color-warn);font-size:13px">${_esc(err.message || t("chat_couldnt_load_masks"))}</p>`;
      return;
    }
    const renderRows = () => {
      const currentName = this._myPersonaName();
      const rowHtml = (id, name, avatar, sessionExclusive) => `
        <div style="display:flex;gap:6px;align-items:stretch">
          <button type="button" class="dropdown-item" data-persona-id="${id === null ? "" : _esc(id)}" style="flex:1;display:flex;gap:10px;align-items:center;text-align:left;border:1px solid ${name === currentName ? "var(--color-accent)" : "var(--color-line-2)"}">
            <span style="width:28px;height:28px;flex:none;border-radius:999px;overflow:hidden;background:var(--color-surface-2);display:grid;place-items:center;font-family:var(--font-mono);font-size:11px">
              ${avatar ? `<img src="${_esc(avatar)}" alt="" style="width:100%;height:100%;object-fit:cover">` : _esc(name[0]?.toUpperCase() || "?")}
            </span>
            <span style="font-size:13.5px">${_esc(name)}${name === currentName ? ` ${t("chat_current_suffix")}` : ""}</span>
            ${sessionExclusive ? `<span style="font-family:var(--font-mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--color-muted);border:1px solid var(--color-line-2);border-radius:999px;padding:2px 6px">${t("chat_multiplayer_session_only_badge", "Session only")}</span>` : ""}
          </button>
          ${this.multiplayer && id !== null ? `
            <button type="button" class="ig-icon-btn" style="position:static;width:34px" data-edit-persona="${_esc(id)}" aria-label="${t("chat_edit")}" data-tooltip="${t("chat_edit")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
            </button>
            <button type="button" class="ig-icon-btn danger" style="position:static;width:34px" data-delete-persona="${_esc(id)}" aria-label="${t("chat_delete")}" data-tooltip="${t("chat_delete")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          ` : ""}
        </div>
      `;
      body.innerHTML = `
        <p style="margin:0 0 14px;font-size:13px;color:var(--color-muted)">${t("chat_switch_mask_description")}</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:${this.multiplayer ? "12px" : "0"}">
          ${rowHtml(null, t("chat_you_fallback_name"), null, false)}
          ${personas.map((p) => rowHtml(p.id, p.name, p.avatar, !!p.session_id)).join("")}
        </div>
        ${this.multiplayer ? `<button type="button" class="pe-gen-btn" id="mpCreatePersona" style="width:100%">+ ${t("chat_multiplayer_create_persona_button", "New persona")}</button>` : ""}
      `;
      body.querySelectorAll("[data-persona-id]").forEach((btn) => {
        btn.onclick = async () => {
          const personaId = btn.dataset.personaId || null;
          if (!this.sid) {
            const picked = personaId ? personas.find((p) => p.id === personaId) : null;
            this.session.persona_id = personaId;
            this.session.user_name = picked ? picked.name : t("chat_you_fallback_name");
            this.loadPersonaAvatar();
            this.render();
            renderRows();
            toast(`${t("chat_now_playing_as_prefix")} ${this.session.user_name}.`);
            return;
          }
          try {
            const r = await api(`/api/sessions/${encodeURIComponent(this.sid)}/persona`, { method: "PUT", body: JSON.stringify({ persona_id: personaId }) });
            const mine = this._myParticipant();
            if (mine) {
              const picked = personaId ? personas.find((p) => p.id === personaId) : null;
              mine.persona_id = personaId;
              mine.persona_name = picked ? picked.name : null;
              mine.avatar = picked ? (picked.avatar || null) : (ME?.avatar || null);
            } else {
              this.session.persona_id = personaId;
              this.session.user_name = r.user_name;
            }
            this.loadPersonaAvatar();
            this.render();
            renderRows();
            toast(`${t("chat_now_playing_as_prefix")} ${r.user_name}.`);
          } catch (err) {
            errorToast(err.message || t("chat_couldnt_switch_mask"));
          }
        };
      });
      body.querySelectorAll("[data-edit-persona]").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          closeModal(layer);
          this._openMultiplayerPersonaEditor(personas.find((p) => p.id === btn.dataset.editPersona));
        };
      });
      body.querySelectorAll("[data-delete-persona]").forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const pid = btn.dataset.deletePersona;
          if (!await confirmDialog(t("chat_multiplayer_delete_persona_confirm", "Delete this persona? This cannot be undone."), { confirmLabel: t("chat_delete"), danger: true })) return;
          try {
            await api(`/api/personas/${encodeURIComponent(pid)}`, { method: "DELETE" });
            personas = personas.filter((p) => p.id !== pid);
            if (this._myPersonaId() === pid) {
              await api(`/api/sessions/${encodeURIComponent(this.sid)}/persona`, { method: "PUT", body: JSON.stringify({ persona_id: null }) });
              const mine = this._myParticipant();
              if (mine) { mine.persona_id = null; mine.persona_name = null; mine.avatar = ME?.avatar || null; }
              this.loadPersonaAvatar();
              this.render();
            }
            renderRows();
            toast(t("chat_multiplayer_persona_deleted", "Persona deleted."));
          } catch (err) {
            errorToast(err.message || t("chat_multiplayer_persona_delete_failed", "Couldn't delete that persona."));
          }
        };
      });
      const createBtn = body.querySelector("#mpCreatePersona");
      if (createBtn) createBtn.onclick = () => {
        closeModal(layer);
        this._openMultiplayerPersonaEditor(null);
      };
    };
    renderRows();
  }

  _openMultiplayerPersonaEditor(existing) {
    _masksEditModal(existing, async () => {
      let personas;
      try {
        personas = await api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/my-personas`);
      } catch {
        return;
      }
      const mine = this._myParticipant();
      if (mine && mine.persona_id) {
        const current = personas.find((p) => p.id === mine.persona_id);
        if (current) { mine.persona_name = current.name; mine.avatar = current.avatar || null; }
        else { mine.persona_id = null; mine.persona_name = null; mine.avatar = ME?.avatar || null; }
      }
      this.loadPersonaAvatar();
      this.render();
      this.openPersonaSwitchModal();
    }, { sessionId: existing ? null : this.sid });
  }

  openDiceModal() {
    const presets = ["d4", "d6", "d8", "d20", "2d6"];
    openModal(`
      <h3>${t("chat_roll_dice")}</h3>
      <div style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;margin-bottom:12px;border-radius:10px;border:1px solid var(--color-warn);background:color-mix(in srgb, var(--color-warn) 12%, transparent)">
        <span style="flex:none;font-size:15px">⚠️</span>
        <span style="font-size:12px;color:var(--color-warn);line-height:1.45">${t("chat_dice_warning")}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        ${presets.map((d) => `<button type="button" class="chat-dice-chip" data-dice-preset="${_esc(d)}">${d}</button>`).join("")}
      </div>
      <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:4px">${t("chat_roll_label")}</label>
      <input type="text" id="diceExpr" value="1d20" placeholder="${t("chat_dice_expr_placeholder")}" style="width:100%;margin-bottom:10px;padding:9px 11px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:14px">
      <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:4px">${t("chat_dice_note_label")}</label>
      <textarea id="diceNote" rows="2" placeholder="${t("chat_dice_note_placeholder")}" style="width:100%;margin-bottom:12px;padding:9px 11px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);font-size:13.5px;resize:vertical"></textarea>
      <button type="button" id="diceRollBtn" class="pe-gen-btn" style="width:100%;justify-content:center">${t("chat_roll_final_answer")}</button>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const exprInput = layer.querySelector("#diceExpr");
    layer.querySelectorAll("[data-dice-preset]").forEach((chip) => {
      chip.onclick = () => { exprInput.value = chip.dataset.dicePreset.replace(/^d/, "1d"); };
    });
    layer.querySelector("#diceRollBtn").onclick = () => {
      if (this.diceRolledThisTurn) { toast(t("chat_already_rolled_this_turn")); return; }
      const expr = exprInput.value.trim();
      if (!expr) { toast(t("chat_enter_dice_expression")); return; }
      const note = layer.querySelector("#diceNote").value.trim();
      this.diceRolledThisTurn = true;
      closeTopModal();
      this.sendTurn("roll", { expr, note });
    };
  }

  async toggleExplicitMode() {
    const next = !this.session.explicit_mode;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}/explicit-mode`, { method: "PUT", body: JSON.stringify({ enabled: next }) });
      this.session.explicit_mode = next;
      toast(next ? t("chat_explicit_armed") : t("chat_explicit_off"));
      this.render();
    } catch (err) {
      errorToast(err.message || t("chat_couldnt_change_that_setting"));
    }
  }

  async openStyleModal() {
    openModal(`
      <h3>${t("chat_response_style_heading")}</h3>
      <div id="styleList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
      <button type="button" id="styleAddBtn" class="dropdown-item" style="text-align:center;color:var(--color-accent)">+ ${t("chat_add_custom_style")}</button>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const list = layer.querySelector("#styleList");
    const renderList = () => {
      const current = this.session.style_key || "unspecified";
      list.innerHTML = getAllChatStyles().map((s) => `
        <div style="display:flex;gap:6px;align-items:stretch">
          <button type="button" data-style="${_esc(s.key)}" class="dropdown-item" style="flex:1;display:flex;gap:10px;align-items:center;text-align:left;border:1px solid ${s.key === current ? "var(--color-accent)" : "var(--color-line-2)"}">
            <span style="font-size:18px">${s.emoji}</span>
            <span>
              <div style="font-weight:600;font-size:13.5px">${_esc(s.label)}${s.key === current ? " ✓" : ""}</div>
              <div style="font-size:11.5px;color:var(--color-muted)">${_esc(s.desc)}</div>
            </span>
          </button>
          ${s.custom ? `
            <button type="button" data-remove-style="${_esc(s.key)}" class="ig-icon-btn danger" style="position:static;width:38px" aria-label="${t("chat_remove")}" data-tooltip="${t("chat_remove")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          ` : ""}
        </div>
      `).join("");
      list.querySelectorAll("[data-style]").forEach((btn) => {
        btn.onclick = async () => {
          const s = getAllChatStyles().find((x) => x.key === btn.dataset.style);
          try {
            await api(`/api/sessions/${encodeURIComponent(this.sid)}/style`, { method: "PUT", body: JSON.stringify({ key: s.key, prompt: s.prompt || null }) });
            this.session.style_key = s.key;
            this.session.style_prompt = s.prompt;
            renderList();
            this.refreshStyleBtn();
            toast(`${t("chat_style_set_to_prefix")} ${s.label}.`);
          } catch (err) {
            errorToast(err.message || t("chat_couldnt_set_style"));
          }
        };
      });
      list.querySelectorAll("[data-remove-style]").forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          setCustomChatStyles(getCustomChatStyles().filter((s) => s.key !== btn.dataset.removeStyle));
          renderList();
        };
      });
    };
    renderList();
    layer.querySelector("#styleAddBtn").onclick = () => this.openCustomStyleEditor(() => { renderList(); });
  }

  openCustomStyleEditor(onSaved) {
    openModal(`
      <h3>${t("chat_custom_style_heading")}</h3>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:4px">${t("chat_emoji_label")}</label>
          <button type="button" id="csEmojiBtn" data-emoji="✨" style="width:56px;height:44px;text-align:center;font-size:18px;padding:8px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);cursor:pointer">✨</button>
          <div id="csEmojiPicker" style="display:none;margin-top:8px;grid-template-columns:repeat(8, 1fr);gap:4px;max-width:280px">
            ${COMMENT_PICKER_EMOJI.map((e) => `<button type="button" class="comment-picker-cell" data-emoji-pick="${_attr(e)}">${e}</button>`).join("")}
          </div>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:4px">${t("chat_name_label")}</label>
          <input type="text" id="csLabel" placeholder="${t("chat_name_placeholder")}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink)">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--color-muted);margin-bottom:4px">${t("chat_style_instructions_label")}</label>
          <textarea id="csPrompt" rows="4" placeholder="${t("chat_style_instructions_placeholder")}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface);color:var(--color-ink);resize:vertical"></textarea>
        </div>
        <button type="button" id="csSave" class="pe-gen-btn" style="width:100%;justify-content:center">${t("chat_save_style")}</button>
      </div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const emojiBtn = layer.querySelector("#csEmojiBtn");
    const emojiPicker = layer.querySelector("#csEmojiPicker");
    emojiBtn.onclick = () => {
      emojiPicker.style.display = emojiPicker.style.display === "none" ? "grid" : "none";
    };
    emojiPicker.querySelectorAll("[data-emoji-pick]").forEach((cell) => {
      cell.onclick = () => {
        emojiBtn.textContent = cell.dataset.emojiPick;
        emojiBtn.dataset.emoji = cell.dataset.emojiPick;
        emojiPicker.style.display = "none";
      };
    });
    layer.querySelector("#csSave").onclick = () => {
      const emoji = emojiBtn.dataset.emoji || "✨";
      const label = layer.querySelector("#csLabel").value.trim();
      const prompt = layer.querySelector("#csPrompt").value.trim();
      if (!label || !prompt) { toast(t("chat_name_and_instructions_required")); return; }
      const styles = getCustomChatStyles();
      styles.push({
        key: `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        emoji, label, desc: "Custom style", prompt, custom: true,
      });
      setCustomChatStyles(styles);
      closeTopModal();
      onSaved?.();
    };
  }

  refreshStyleBtn() {
    const btn = this.main?.querySelector("#chatStyleBtn");
    if (!btn) return;
    const current = getAllChatStyles().find((s) => s.key === (this.session.style_key || "unspecified")) || CHAT_STYLES[0];
    btn.innerHTML = `<span style="font-size:16px;line-height:1">${current.emoji}</span><span class="hidden md:inline">${_esc(current.label)}</span>`;
  }

  async openLengthModal() {
    openModal(`
      <h3>${t("chat_response_length")}</h3>
      <div id="lengthList" style="display:flex;flex-direction:column;gap:8px"></div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const list = layer.querySelector("#lengthList");
    const renderList = () => {
      const current = this.session.length_key || "epic";
      list.innerHTML = RESPONSE_LENGTHS.map((l) => `
        <button type="button" data-length="${_esc(l.key)}" class="dropdown-item" style="display:flex;gap:10px;align-items:center;text-align:left;border:1px solid ${l.key === current ? "var(--color-accent)" : "var(--color-line-2)"}">
          <span style="font-size:18px">${l.emoji}</span>
          <span>
            <div style="font-weight:600;font-size:13.5px">${_esc(l.label)}${l.key === current ? " ✓" : ""}</div>
            <div style="font-size:11.5px;color:var(--color-muted)">${_esc(l.desc)}</div>
          </span>
        </button>
      `).join("");
      list.querySelectorAll("[data-length]").forEach((btn) => {
        btn.onclick = async () => {
          const l = RESPONSE_LENGTHS.find((x) => x.key === btn.dataset.length);
          try {
            await api(`/api/sessions/${encodeURIComponent(this.sid)}/length`, { method: "PUT", body: JSON.stringify({ key: l.key }) });
            this.session.length_key = l.key;
            renderList();
            this.refreshLengthBtn();
            toast(`${t("chat_length_set_to_prefix")} ${l.label}.`);
          } catch (err) {
            errorToast(err.message || t("chat_couldnt_set_response_length"));
          }
        };
      });
    };
    renderList();
  }

  refreshLengthBtn() {
    const btn = this.main?.querySelector("#chatLengthBtn");
    if (!btn) return;
    const current = RESPONSE_LENGTHS.find((l) => l.key === (this.session.length_key || "epic")) || RESPONSE_LENGTHS[4];
    btn.innerHTML = `<span style="font-size:16px;line-height:1">${current.emoji}</span><span class="hidden md:inline">${_esc(current.label)}</span>`;
  }

  canChangeLanguage() {
    return !(this.session.messages || []).some((m) => m.role === "user");
  }

  async openLanguageModal() {
    openModal(`
      <h3>${t("chat_reply_language")}</h3>
      <p style="margin:0 0 14px;font-size:13px;color:var(--color-muted)">${t("chat_language_modal_description")}</p>
      <input type="text" id="langInput" value="${_esc(this.session.language || "")}" placeholder="${t("chat_language_placeholder")}"
        style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:10px">
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
        ${CHAT_COMMON_LANGUAGES.map((l) => `<button type="button" class="dropdown-item" data-lang="${_esc(l)}" style="width:auto;padding:5px 10px">${_esc(l)}</button>`).join("")}
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" id="langCancel" class="dropdown-item" style="flex:1">${t("chat_cancel")}</button>
        <button type="button" id="langSave" class="dropdown-item" style="flex:1;border-color:var(--color-accent);color:var(--color-accent)">${t("chat_start_chat_in_this_language")}</button>
      </div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const input = layer.querySelector("#langInput");
    layer.querySelectorAll("[data-lang]").forEach((chip) => { chip.onclick = () => { input.value = chip.dataset.lang; input.focus(); }; });
    layer.querySelector("#langCancel").onclick = () => closeTopModal();
    layer.querySelector("#langSave").onclick = async () => {
      const lang = input.value.trim();
      if (!lang) { toast(t("chat_enter_a_language")); return; }
      const modalBox = layer.querySelector(".modal");
      modalBox.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px 8px;text-align:center">
          <div class="chat-writing-dot" style="width:14px;height:14px;border-radius:7px"></div>
          <div style="font-size:14px;color:var(--color-ink)">${t("chat_reinitializing_chat")}</div>
        </div>
      `;
      try {
        const fresh = await api(`/api/characters/${encodeURIComponent(this.char.id)}/sessions`, {
          method: "POST",
          body: JSON.stringify({ persona_id: this.session.persona_id || null, greeting_index: 0, language: lang }),
        });
        const oldSid = this.sid;
        closeTopModal();
        navigate(`/chats/${fresh.id}`);
        try { await api(`/api/sessions/${encodeURIComponent(oldSid)}`, { method: "DELETE" }); } catch {}
      } catch (err) {
        closeTopModal();
        errorToast(err.message || t("chat_couldnt_start_that_chat"));
      }
    };
  }

  async openGlossaryModal() {
    const entries = Object.entries(this.session.glossary || {});
    const rowHtml = (k = "", v = "") => `
      <div class="gl-row" style="display:flex;gap:8px;margin-bottom:8px">
        <input class="gl-k" value="${_esc(k)}" placeholder="${t("chat_term_placeholder")}" style="flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px">
        <input class="gl-v" value="${_esc(v)}" placeholder="${t("chat_rendering_placeholder")}" style="flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px">
        <button type="button" class="ig-icon-btn danger gl-x" style="position:static;width:26px;height:26px" aria-label="${t("chat_remove")}" data-tooltip="${t("chat_remove")}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    openModal(`
      <h3>${t("chat_glossary_heading")}</h3>
      <p style="margin:0 0 14px;font-size:13px;color:var(--color-muted)">${t("chat_glossary_description")}</p>
      <div id="glRows">${entries.length ? entries.map(([k, v]) => rowHtml(k, v)).join("") : rowHtml()}</div>
      <button type="button" id="glAdd" class="dropdown-item" style="margin-bottom:14px">+ ${t("chat_add_term")}</button>
      <div style="display:flex;gap:8px">
        <button type="button" id="glCancel" class="dropdown-item" style="flex:1">${t("chat_cancel")}</button>
        <button type="button" id="glSave" class="dropdown-item" style="flex:1;border-color:var(--color-accent);color:var(--color-accent)">${t("chat_save")}</button>
      </div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const rows = layer.querySelector("#glRows");
    rows.addEventListener("click", (e) => { const x = e.target.closest(".gl-x"); if (x) x.closest(".gl-row").remove(); });
    layer.querySelector("#glAdd").onclick = () => { rows.insertAdjacentHTML("beforeend", rowHtml()); rows.lastElementChild.querySelector(".gl-k").focus(); };
    layer.querySelector("#glCancel").onclick = closeTopModal;
    layer.querySelector("#glSave").onclick = async () => {
      const glossary = {};
      rows.querySelectorAll(".gl-row").forEach((r) => {
        const k = r.querySelector(".gl-k").value.trim();
        const v = r.querySelector(".gl-v").value.trim();
        if (k && v) glossary[k] = v;
      });
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/glossary`, { method: "PUT", body: JSON.stringify({ glossary }) });
        this.session.glossary = glossary;
        closeTopModal();
        toast(t("chat_glossary_saved"));
      } catch (err) {
        errorToast(err.message || t("chat_couldnt_save_glossary"));
      }
    };
  }

  async openAuthorNoteModal() {
    openModal(`
      <h3>${t("chat_authors_note_heading")}</h3>
      <p style="margin:0 0 14px;font-size:13px;color:var(--color-muted)">${t("chat_authors_note_description")}</p>
      <textarea id="noteInput" rows="5" placeholder="${t("chat_authors_note_placeholder")}"
        style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13.5px;margin-bottom:14px">${_esc(this.session.author_note || "")}</textarea>
      <div style="display:flex;gap:8px">
        <button type="button" id="noteClear" class="dropdown-item" style="flex:1">${t("chat_clear")}</button>
        <button type="button" id="noteSave" class="dropdown-item" style="flex:1;border-color:var(--color-accent);color:var(--color-accent)">${t("chat_save")}</button>
      </div>
    `);
    const layer = document.querySelector(".modal-layer:last-child");
    const input = layer.querySelector("#noteInput");
    const apply = async (note) => {
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/note`, { method: "PUT", body: JSON.stringify({ note: note || null }) });
        this.session.author_note = note || null;
        closeTopModal();
        toast(note ? t("chat_authors_note_pinned") : t("chat_authors_note_cleared"));
      } catch (err) {
        errorToast(err.message || t("chat_couldnt_save_authors_note"));
      }
    };
    layer.querySelector("#noteClear").onclick = () => apply("");
    layer.querySelector("#noteSave").onclick = () => apply(input.value.trim());
  }

  wireScrollFab() {
    const thread = this.main.querySelector("#chatThread");
    const fab = document.getElementById("chatScrollFab");
    if (!thread || !fab) return;
    const update = () => {
      const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
      fab.style.display = nearBottom ? "none" : "flex";
    };
    thread.addEventListener("scroll", update);
    fab.onclick = () => this.scrollToBottom();
    update();
  }

  toggleHideOoc() {
    store.set("hideOoc", !store.get("hideOoc", false));
    this.render();
  }

  wireTurnActions() {
    this.main.querySelectorAll("[data-cmd-tray-toggle]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wrap = btn.closest(".cmd-tray-wrap");
        wrap.querySelector(".cmd-tray-body")?.classList.toggle("hidden");
        wrap.classList.toggle("cmd-tray-open");
      });
    });
    const LONG_PRESS_MS = 500;
    const MOVE_TOLERANCE = 24;
    const greetingId = this.session.messages[0]?.role === "assistant" ? this.session.messages[0].id : null;
    this.main.querySelectorAll("[data-select-check]").forEach((check) => {
      check.onclick = () => {
        const mid = check.dataset.selectCheck;
        if (this.selectedIds.has(mid)) this.selectedIds.delete(mid);
        else this.selectedIds.add(mid);
        if (this.selectedIds.size === 0) this.selectMode = false;
        this.render();
      };
    });
    this.main.querySelectorAll("[data-toggle-actions]").forEach((bubble) => {
      const turn = bubble.closest(".chat-turn");
      let timer = null;
      let firedLongPress = false;
      let startX = 0;
      let startY = 0;
      const clearTimer = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        turn?.classList.remove("pressing");
      };
      bubble.addEventListener("pointerdown", (e) => {
        firedLongPress = false;
        startX = e.clientX;
        startY = e.clientY;
        turn?.classList.add("pressing");
        timer = setTimeout(() => {
          firedLongPress = true;
          this.selectMode = true;
          const mid = bubble.dataset.toggleActions;
          const idx = this.session.messages.findIndex((m) => m.id === mid);
          const from = idx === -1 ? [mid] : this.session.messages.slice(idx).map((m) => m.id);
          from.filter((id) => id !== greetingId).forEach((id) => this.selectedIds.add(id));
          this.render();
        }, LONG_PRESS_MS);
      });
      bubble.addEventListener("pointermove", (e) => {
        if (!timer) return;
        if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) clearTimer();
      });
      bubble.addEventListener("pointerup", clearTimer);
      bubble.addEventListener("pointercancel", clearTimer);
      bubble.addEventListener("pointerleave", clearTimer);
      bubble.onclick = () => {
        if (firedLongPress) { firedLongPress = false; return; }
        const mid = bubble.dataset.toggleActions;
        if (this.selectMode) {
          if (mid === greetingId) return;
          if (this.selectedIds.has(mid)) this.selectedIds.delete(mid);
          else this.selectedIds.add(mid);
          if (this.selectedIds.size === 0) this.selectMode = false;
          this.render();
          return;
        }
        if (!turn) return;
        const wasOpen = turn.classList.contains("actions-open");
        this.main.querySelectorAll(".chat-turn.actions-open").forEach((t) => t.classList.remove("actions-open"));
        if (!wasOpen) turn.classList.add("actions-open");
      };
    });
    this.main.querySelectorAll("[data-voice]").forEach((chip) => {
      chip.addEventListener("click", (e) => { e.stopPropagation(); this.groupPoke(chip.dataset.voice); });
    });
    this.main.querySelectorAll("[data-roster]").forEach((av) => {
      av.addEventListener("click", (e) => { e.stopPropagation(); this.openRosterMenu(av.dataset.roster, av); });
    });
    this.main.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const mid = btn.closest("[data-actions-for]")?.dataset.actionsFor;
        const msg = this.session.messages.find((m) => m.id === mid);
        if (!msg) return;
        const act = btn.dataset.act;
        if (act === "copy") this.copyMessage(msg);
        else if (act === "edit") this.beginEditMessage(msg);
        else if (act === "delete") this.deleteMessage(msg);
        else if (act === "branch") this.branchFrom(msg);
        else if (act === "reassign") this.openReassignMenu(msg, btn);
        else if (act === "image") this.openImageGenModal(msg);
        else if (act === "regenerate") {
          if (this.streaming) { toast(t("chat_still_generating_wait")); return; }
          if (await confirmDialog(t("chat_regenerate_confirm"), { confirmLabel: t("chat_regenerate"), danger: false })) this.sendTurn("regenerate", {});
        }
        else if (act === "continue") {
          if (this.streaming) { toast(t("chat_still_generating_wait")); return; }
          this.openContinuePrompt();
        }
        else if (act === "greeting-prev") this.swapGreeting("prev");
        else if (act === "greeting-next") this.swapGreeting("next");
        else if (act === "swipe-prev") this.swipeMessage(mid, "prev");
        else if (act === "swipe-next") this.swipeMessage(mid, "next");
      });
    });
  }

  async swipeMessage(mid, direction) {
    if (this.streaming || this._swiping) return;
    this._swiping = true;
    try {
      await api(`/api/sessions/${this.session.id}/messages/${encodeURIComponent(mid)}/swipe/${direction}`, { method: "POST" });
      const fresh = await api(`/api/sessions/${this.session.id}`);
      this.session = fresh;
      this.render();
      this.scrollToBottom();
    } catch (err) {
      errorToast(err.message || t("chat_couldnt_swap_the_greeting"));
    } finally {
      this._swiping = false;
    }
  }

  async swapGreeting(direction) {
    if (this.streaming || this._swappingGreeting) return;
    if (this.draftCharId) {
      const count = 1 + (this.char.alt_greetings || []).length;
      this.greetingIndex = (this.greetingIndex + (direction === "next" ? 1 : -1) + count) % count;
      this.buildDraftSession();
      this.render();
      return;
    }
    this._swappingGreeting = true;
    try {
      const result = await api(`/api/sessions/${this.session.id}/greeting/${direction}`, { method: "POST" });
      this.greetingIndex = result.greeting_index;
      const fresh = await api(`/api/sessions/${this.session.id}`);
      this.session = fresh;
      this.render();
    } catch (err) {
      errorToast(err.message || t("chat_couldnt_swap_the_greeting"));
    } finally {
      this._swappingGreeting = false;
    }
  }

  copyMessage(msg) {
    const body = msg.role === "user" ? formatDirective(stripMood(msg.content)) : splitThink(msg.content).body;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(body)
        .then(() => toast(t("chat_copied")))
        .catch(() => { if (copyTextFallback(body)) toast(t("chat_copied")); else errorToast(t("chat_couldnt_copy")); });
      return;
    }
    if (copyTextFallback(body)) toast(t("chat_copied"));
    else errorToast(t("chat_couldnt_copy"));
  }

  beginEditMessage(msg) {
    const turnNode = this.main.querySelector(`[data-mid="${CSS.escape(msg.id)}"]`);
    const bubble = turnNode?.querySelector(".chat-bubble");
    const bubbleBody = bubble?.querySelector(".sym-body");
    if (!bubbleBody) return;
    const msgRow = turnNode.querySelector(".chat-msg-row");
    const turnBody = turnNode.querySelector(".chat-turn-body");
    if (turnBody) turnBody.style.width = "100%";
    if (msgRow) { msgRow.style.width = "100%"; msgRow.style.maxWidth = "none"; }
    bubble.style.width = "100%";
    bubble.style.maxWidth = "none";
    const { body } = msg.role === "user" ? { body: directiveToEditable(stripMood(msg.content)) } : splitThink(msg.content);
    bubbleBody.innerHTML = `
      <textarea style="box-sizing:border-box;width:100%;min-height:120px;resize:vertical;background:transparent;border:1px solid var(--color-line-2);border-radius:8px;padding:8px;color:inherit;font-family:inherit;font-size:inherit">${_esc(body)}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button type="button" class="tool" data-edit-save style="border:1px solid var(--color-accent);border-radius:8px;padding:4px 10px;color:var(--color-accent)">${t("chat_save")}</button>
        <button type="button" class="tool" data-edit-cancel style="border:1px solid var(--color-line-2);border-radius:8px;padding:4px 10px">${t("chat_cancel")}</button>
      </div>
    `;
    bubbleBody.querySelector("[data-edit-cancel]").onclick = (e) => { e.stopPropagation(); this.render(); };
    bubbleBody.querySelector("[data-edit-save]").onclick = async (e) => {
      e.stopPropagation();
      const newContent = bubbleBody.querySelector("textarea").value.trim();
      if (!newContent) return;
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ content: newContent }),
        });
        this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
        this.render();
        toast(t("chat_saved"));
      } catch (err) {
        toast(err.message || t("chat_couldnt_save_that_edit"));
      }
    };
    const textarea = bubbleBody.querySelector("textarea");
    textarea.focus();
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); this.render(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); bubbleBody.querySelector("[data-edit-save]").click(); }
    });
  }

  openContinuePrompt() {
    this.continuePromptOpen = true;
    this.render();
    const input = document.getElementById("chatContinueInput");
    input?.focus();
  }

  closeContinuePrompt() {
    this.continuePromptOpen = false;
    this.render();
  }

  submitContinuePrompt() {
    const input = document.getElementById("chatContinueInput");
    const direction = input ? input.value.trim() : "";
    this.continuePromptOpen = false;
    this.sendTurn("continue", direction ? { content: direction } : {});
  }

  wireContinuePrompt() {
    const input = document.getElementById("chatContinueInput");
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.submitContinuePrompt(); }
      else if (e.key === "Escape") { e.preventDefault(); this.closeContinuePrompt(); }
    });
    document.getElementById("chatContinueCancel").onclick = () => this.closeContinuePrompt();
  }

  async branchFrom(msg) {
    if (!(await confirmDialog(t("chat_branch_confirm"), { confirmLabel: t("chat_branch_label"), danger: false }))) return;
    try {
      const branched = await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}/branch`, { method: "POST" });
      toast(t("chat_branched"));
      navigate(`/chats/${branched.id}`);
    } catch (err) {
      toast(err.message || t("chat_couldnt_branch_that_conversation"));
    }
  }

  async openImageGenModal(msg) {
    let checkpoints, animaUnets, loras, loraPreviews, checkpointPreviews, samplerData;
    try {
      [checkpoints, animaUnets, loras, loraPreviews, checkpointPreviews, samplerData] = await Promise.all([
        api("/api/imagegen/checkpoints"),
        api("/api/imagegen/anima-unets").catch(() => []),
        api("/api/imagegen/loras"),
        api("/api/imagegen/lora-previews").catch(() => ({})),
        api("/api/imagegen/checkpoint-previews").catch(() => ({})),
        api("/api/imagegen/samplers").catch(() => ({ samplers: [], schedulers: [] })),
      ]);
    } catch (err) {
      errorToast(err.message || t("chat_couldnt_load_imagegen_options"));
      return;
    }
    if (!checkpoints.length && !animaUnets.length) { toast(t("chat_no_comfyui_checkpoints")); return; }
    let architecture = "sdxl";
    let advanced = false;
    let modalLayer = null;
    let selectedCheckpoint = null;
    let selectedSampler = null;
    let selectedScheduler = null;
    let selectedSteps = 20;
    let selectedCfg = 7.0;
    let selectedDenoise = 0.6;
    let refDataUrl = null;
    let promptFilled = false;
    let positiveText = "";
    let negativeText = "";

    const modelsFor = () => architecture === "anima" ? animaUnets : checkpoints;
    const defaultCheckpointFor = (models) => models.find((m) => m.toLowerCase().includes("realskin")) || models[0] || null;

    const renderModal = () => {
      const models = modelsFor();
      const html = `
        <h3>${t("chat_generate_image_heading")}</h3>
        <div class="imggen-grid">
        <div class="imggen-settings">
          <div style="display:flex;gap:6px">
            <button type="button" id="igSimpleTab" class="filter-chip${!advanced ? " on" : ""}" style="flex:1">${t("chat_simple_tab")}</button>
            <button type="button" id="igAdvancedTab" class="filter-chip${advanced ? " on" : ""}" style="flex:1">${t("chat_advanced_tab")}</button>
          </div>
          ${animaUnets.length ? `
            <div>
              <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_architecture_label")}</label>
              ${customSelectHtml("igArch", [{ value: "sdxl", label: t("chat_legacy_option") }, { value: "anima", label: t("chat_current_option") }], architecture)}
            </div>
          ` : ""}
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_checkpoint_label")}</label>
            ${checkpointPickerHtml("igCheckpoint", models, checkpointPreviews, selectedCheckpoint)}
          </div>
          ${loras.length ? `
            <div>
              <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_loras_label")}</label>
              ${loraPickerHtml("igLoras", loras, _loraPickerState.igLoras ? getLoraPickerValues("igLoras") : [], loraPreviews)}
            </div>
          ` : ""}
          ${advanced ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_sampler_label")}</label>
                ${customSelectHtml("igSampler", samplerData.samplers, selectedSampler || samplerData.samplers[0])}
              </div>
              <div>
                <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_scheduler_label")}</label>
                ${customSelectHtml("igScheduler", samplerData.schedulers, selectedScheduler || samplerData.schedulers[0])}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11.5px;color:var(--color-muted);width:40px">${t("chat_steps_label")}</span>
              <input type="range" id="igSteps" min="5" max="60" step="1" value="${selectedSteps}" style="flex:1">
              <span id="igStepsVal" style="font-size:11.5px;color:var(--color-muted);width:24px;text-align:right">${selectedSteps}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11.5px;color:var(--color-muted);width:40px">${t("chat_cfg_label")}</span>
              <input type="range" id="igCfg" min="1" max="15" step="0.5" value="${selectedCfg}" style="flex:1">
              <span id="igCfgVal" style="font-size:11.5px;color:var(--color-muted);width:24px;text-align:right">${selectedCfg.toFixed(1)}</span>
            </div>
          ` : ""}
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_reference_image_label")}</label>
            ${refImagePickerHtml("igRefPicker")}
            <div id="igDenoiseRow" style="display:${refDataUrl ? "flex" : "none"};margin-top:8px;align-items:center;gap:8px">
              <span style="font-size:11.5px;color:var(--color-muted)">${t("chat_denoise_label")}</span>
              <input type="range" id="igDenoise" min="0.05" max="1" step="0.05" value="${selectedDenoise}" style="flex:1">
              <span id="igDenoiseVal" style="font-size:11.5px;color:var(--color-muted);width:32px;text-align:right">${selectedDenoise.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_positive_prompt_label")}</label>
            <textarea id="igPositive" rows="2" disabled placeholder="${t("chat_generating_prompt_placeholder")}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px"></textarea>
          </div>
          <div>
            <label style="font-size:11.5px;color:var(--color-muted);display:block;margin-bottom:4px">${t("chat_negative_prompt_label")}</label>
            <textarea id="igNegative" rows="2" disabled placeholder="${t("chat_generating_prompt_placeholder")}" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--color-line-2);background:var(--color-surface-2);color:var(--color-ink);font-size:13px"></textarea>
          </div>
        </div>
        <div class="imggen-preview">
          ${genPreviewBoxHtml("igPreviewBox", "1 / 1")}
          <div class="imggen-actions">
            <button type="button" id="igCancel" class="pe-gen-btn" style="flex:1;justify-content:center;border-color:var(--color-line-2);color:var(--color-sec)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              ${t("chat_cancel")}
            </button>
            <button type="button" id="igGo" class="pe-gen-btn" style="flex:1;justify-content:center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l1.9 5.8L20 9.5l-6.1 1.7L12 17l-1.9-5.8L4 9.5l6.1-1.7L12 2z"/></svg>
              ${t("chat_generate")}
            </button>
          </div>
        </div>
        </div>
      `;
      if (!modalLayer) {
        modalLayer = openModal(html, { wide: true });
      } else {
        const modalDiv = modalLayer.querySelector(".modal");
        modalDiv.innerHTML = `<button type="button" class="modal-close" aria-label="${t("chat_close")}">${t("chat_close")}</button>${html}`;
        modalDiv.querySelector(".modal-close").onclick = () => closeModal(modalLayer);
      }
      const layer = modalLayer;
      const posEl = layer.querySelector("#igPositive");
      const negEl = layer.querySelector("#igNegative");
      posEl.value = positiveText;
      negEl.value = negativeText;
      posEl.addEventListener("input", () => { positiveText = posEl.value; });
      negEl.addEventListener("input", () => { negativeText = negEl.value; });
      if (!promptFilled) {
        api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}/image-prompt`, { method: "POST" }).then((r) => {
          positiveText = r.positive || "";
          negativeText = r.negative || "";
          posEl.value = positiveText;
          negEl.value = negativeText;
          posEl.disabled = negEl.disabled = false;
          promptFilled = true;
        }).catch(() => {
          posEl.placeholder = negEl.placeholder = t("chat_couldnt_auto_generate");
          posEl.disabled = negEl.disabled = false;
        });
      } else {
        posEl.disabled = negEl.disabled = false;
      }
      selectedCheckpoint = selectedCheckpoint && models.includes(selectedCheckpoint) ? selectedCheckpoint : defaultCheckpointFor(models);
      wireCheckpointPicker("igCheckpoint", (v) => { selectedCheckpoint = v; });
      if (loras.length) wireLoraPicker("igLoras", { onKeywordClick: (kw) => {
        positiveText = positiveText.trim() ? `${positiveText.trim()}, ${kw}` : kw;
        posEl.value = positiveText;
      } });
      if (advanced) {
        selectedSampler = selectedSampler || samplerData.samplers[0] || null;
        selectedScheduler = selectedScheduler || samplerData.schedulers[0] || null;
        wireCustomSelect("igSampler", (v) => { selectedSampler = v; });
        wireCustomSelect("igScheduler", (v) => { selectedScheduler = v; });
        const steps = layer.querySelector("#igSteps");
        const stepsVal = layer.querySelector("#igStepsVal");
        steps.addEventListener("input", () => { selectedSteps = Number(steps.value); stepsVal.textContent = steps.value; });
        const cfg = layer.querySelector("#igCfg");
        const cfgVal = layer.querySelector("#igCfgVal");
        cfg.addEventListener("input", () => { selectedCfg = Number(cfg.value); cfgVal.textContent = Number(cfg.value).toFixed(1); });
      }
      layer.querySelector("#igSimpleTab").onclick = () => { advanced = false; renderModal(); };
      layer.querySelector("#igAdvancedTab").onclick = () => { advanced = true; renderModal(); };
      if (animaUnets.length) {
        wireCustomSelect("igArch", (v) => { architecture = v; selectedCheckpoint = null; renderModal(); });
      }
      const denoiseRow = layer.querySelector("#igDenoiseRow");
      const denoise = layer.querySelector("#igDenoise");
      const denoiseVal = layer.querySelector("#igDenoiseVal");
      if (refDataUrl) denoiseRow.style.display = "flex";
      denoise.addEventListener("input", () => { selectedDenoise = Number(denoise.value); denoiseVal.textContent = selectedDenoise.toFixed(2); });
      wireRefImagePicker("igRefPicker", (dataUrl) => {
        refDataUrl = dataUrl;
        denoiseRow.style.display = dataUrl ? "flex" : "none";
      }, refDataUrl);
      layer.querySelector("#igCancel").onclick = () => closeModal(modalLayer);
      layer.querySelector("#igGo").onclick = async () => {
        const body = {
          checkpoint: selectedCheckpoint,
          architecture,
          loras: loras.length ? getLoraPickerValues("igLoras") : [],
          positive: posEl.value.trim() || null,
          negative: negEl.value.trim() || null,
          reference_image: refDataUrl,
          denoise: selectedDenoise,
          sampler: selectedSampler,
          scheduler: selectedScheduler,
          steps: advanced ? selectedSteps : 28,
          cfg: advanced ? selectedCfg : 6.0,
        };
        const goBtn = layer.querySelector("#igGo");
        goBtn.disabled = true;
        setGenPreviewBox("igPreviewBox", { busy: true });
        try {
          const r = await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}/image`, { method: "POST", body: JSON.stringify(body) });
          setGenPreviewBox("igPreviewBox", { image: r.image });
          msg.image = r.image;
          this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
          this.render();
          closeModal(modalLayer);
          toast(t("chat_image_generated"));
        } catch (err) {
          errorToast(err.message || t("chat_image_generation_failed"));
          setGenPreviewBox("igPreviewBox", {});
          goBtn.disabled = false;
        }
      };
    };
    renderModal();
  }

  async deleteMessage(msg) {
    if (!(await confirmDialog(t("chat_delete_message_confirm")))) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
      this.session.messages = this.session.messages.filter((m) => m.id !== msg.id);
      this.render();
      toast(t("chat_deleted"));
    } catch (err) {
      toast(err.message || t("chat_couldnt_delete_that_message"));
    }
  }

  async deleteSelectedMessages() {
    const n = this.selectedIds.size;
    if (!n) return;
    if (!(await confirmDialog(`${t("chat_delete_prefix")} ${n} ${n === 1 ? t("chat_message_singular") : t("chat_message_plural")}${t("chat_confirm_undo_suffix")}`))) return;
    const ids = [...this.selectedIds];
    const failed = [];
    for (const mid of ids) {
      try {
        await api(`/api/sessions/${encodeURIComponent(this.sid)}/messages/${encodeURIComponent(mid)}`, { method: "DELETE" });
      } catch {
        failed.push(mid);
      }
    }
    this.session.messages = this.session.messages.filter((m) => failed.includes(m.id) || !ids.includes(m.id));
    this.selectMode = false;
    this.selectedIds.clear();
    this.render();
    if (failed.length) errorToast(`${t("chat_deleted_of_prefix")} ${n - failed.length} ${t("chat_deleted_of_middle")} ${n}${t("chat_some_failed_suffix")}`);
    else toast(`${t("chat_deleted_prefix")} ${n} ${n === 1 ? t("chat_message_singular") : t("chat_message_plural")}.`);
  }

  renderCmdChips(raw) {
    const chips = document.getElementById("chatCmdChips");
    if (!chips) return;
    const suggestions = this.commandSuggestions(raw);
    if (suggestions) {
      chips.innerHTML = suggestions;
      chips.querySelectorAll("[data-cmd-pick]").forEach((btn) => {
        btn.onclick = () => {
          const input = document.getElementById("chatInput");
          input.value = btn.dataset.cmdInline
            ? input.value.replace(/\{[a-z]*$/i, btn.dataset.cmdPick)
            : btn.dataset.cmdPick + " ";
          input.focus();
          this.renderCmdChips(input.value);
        };
      });
      return;
    }
    const found = detectCommands(raw);
    chips.innerHTML = found.map((f) => `
      <div class="chat-cmd-chip">
        <span class="chat-cmd-chip-kind">${f.kind}</span>
        <span class="chat-cmd-chip-word">/${_esc(f.directive)}</span>
        <span class="chat-cmd-chip-arg">${_esc(f.content || "")}</span>
      </div>
    `).join("");
  }

  commandSuggestions(raw) {
    const text = String(raw || "");
    const slash = text.match(/^\/([a-z]*)$/i);
    const inline = text.match(/\{([a-z]*)$/i);
    if (!slash && !inline) return null;
    const typed = (slash ? slash[1] : inline[1]).toLowerCase();
    const commands = slash ? [
      ["/ooc", "talk to the AI outside the story", "/ooc can you slow the pacing down?"],
      ["/scene", "set or change the scene", "/scene a rainy rooftop at midnight"],
      ["/note", "standing instruction for the story", "/note keep replies short"],
      ["/time", "skip time", "/time three days pass"],
      ["/as", "speak as someone else", "/as Mira What did you find?"],
      ["/roll", "roll dice, with an optional reason", "/roll 2d6 sneak attack"],
      ["/help", "show all commands", "/help"],
    ] : [
      ["{ooc: }", "aside to the AI, mid-message", "{ooc: keep her hostile}"],
      ["{scene: }", "change the scene mid-message", "{scene: the tavern, later}"],
      ["{note: }", "standing instruction, mid-message", "{note: slow burn}"],
      ["{time: }", "skip time mid-message", "{time: next morning}"],
      ["{as: }", "speak as someone else", "{as: Mira}"],
      ["{roll: }", "roll dice mid-message", "{roll: d20+2}"],
    ];
    const matched = commands.filter(([cmd]) => cmd.replace(/[^a-z]/g, "").startsWith(typed));
    if (!matched.length) return null;
    return matched.map(([cmd, desc, example]) => `
      <button type="button" class="chat-cmd-suggest" data-cmd-pick="${_attr(slash ? cmd : cmd.slice(0, -1))}" ${slash ? "" : 'data-cmd-inline="1"'}>
        <span class="chat-cmd-chip-word">${_esc(cmd)}</span>
        <span class="chat-cmd-suggest-desc">${_esc(desc)}</span>
        <span class="chat-cmd-suggest-example">${_esc(example)}</span>
      </button>
    `).join("");
  }

  wireComposer() {
    const input = document.getElementById("chatInput");
    document.getElementById("chatPersonaBtn").onclick = () => this.openPersonaSwitchModal();
    document.getElementById("chatStyleBtn").onclick = () => this.openStyleModal();
    document.getElementById("chatLengthBtn").onclick = () => this.openLengthModal();
    if (this.streaming) {
      document.getElementById("chatStop").onclick = () => this.abortController?.abort();
      return;
    }
    if (!input) return;
    const draft = store.get(`draft:${this.sid}`, "");
    if (draft) input.value = draft;
    this.renderCmdChips(input.value);
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
      store.set(`draft:${this.sid}`, input.value);
      this.renderCmdChips(input.value);
      if (this.multiplayer && input.value.trim()) {
        const now = Date.now();
        if (!this._lastTypingPing || now - this._lastTypingPing > 3000) {
          this._lastTypingPing = now;
          api(`/api/sessions/${encodeURIComponent(this.sid)}/multiplayer/typing`, { method: "POST" }).catch(() => {});
        }
      }
    });
    input.addEventListener("keydown", (e) => {
      if (this.session?.is_group && this._mentionOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        this.handleCharMentionKey(e, input);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.submitComposer();
      }
    });
    if (this.session?.is_group) {
      input.addEventListener("input", () => this.updateCharMention(input));
      input.addEventListener("blur", () => setTimeout(() => this.closeCharMention(), 150));
    }
    document.getElementById("chatSend").onclick = () => this.submitComposer();
  }

  _mentionCast() {
    return (this.session?.cast || []).filter((c) => !c.is_narrator);
  }

  updateCharMention(input) {
    const upto = input.value.slice(0, input.selectionStart);
    const match = upto.match(/(?:^|\s)@([^\s@]{0,32})$/);
    if (!match) { this.closeCharMention(); return; }
    const query = match[1].toLowerCase();
    const matches = this._mentionCast()
      .filter((c) => !query || (c.name || "").toLowerCase().includes(query))
      .slice(0, 8);
    if (!matches.length) { this.closeCharMention(); return; }
    this.showCharMention(input, matches);
  }

  showCharMention(input, matches) {
    this.closeCharMention();
    this._mentionMatches = matches;
    this._mentionIndex = 0;
    this._mentionOpen = true;
    const rect = input.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "dropdown-menu open";
    menu.style.cssText = `position:fixed;top:auto;right:auto;left:${rect.left}px;bottom:${window.innerHeight - rect.top + 4}px;min-width:${Math.max(180, rect.width / 2)}px;max-height:220px;overflow-y:auto;z-index:10050`;
    menu.innerHTML = matches.map((c, i) => `
      <button type="button" class="dropdown-item${i === 0 ? " active" : ""}" data-mention-pick="${_attr(c.char_id)}" style="display:flex;align-items:center;gap:8px">
        <span class="chat-pfp chat-pfp-char" style="width:22px;height:22px;flex:none;${c.avatar ? `background-image:url('${_attr(c.avatar)}');background-size:cover;background-position:center` : `background:linear-gradient(150deg,${this._grpColor(c.char_id)},#00000088)`}"></span>
        <span class="text-ink" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(c.name)}</span>
      </button>`).join("");
    menu.querySelectorAll("[data-mention-pick]").forEach((btn) => {
      btn.onmousedown = (e) => { e.preventDefault(); this.pickCharMention(input, btn.dataset.mentionPick); };
    });
    _floatingPopupHost().appendChild(menu);
    this._mentionMenu = menu;
  }

  handleCharMentionKey(e, input) {
    if (e.key === "Escape") { e.preventDefault(); this.closeCharMention(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this.moveCharMention(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); this.moveCharMention(-1); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.pickCharMention(input, this._mentionMatches[this._mentionIndex].char_id);
    }
  }

  moveCharMention(delta) {
    if (!this._mentionMenu) return;
    const items = [...this._mentionMenu.querySelectorAll("[data-mention-pick]")];
    items[this._mentionIndex]?.classList.remove("active");
    this._mentionIndex = (this._mentionIndex + delta + items.length) % items.length;
    items[this._mentionIndex]?.classList.add("active");
    items[this._mentionIndex]?.scrollIntoView({ block: "nearest" });
  }

  pickCharMention(input, charId) {
    const member = this._mentionCast().find((c) => c.char_id === charId);
    if (!member) { this.closeCharMention(); return; }
    const start = input.selectionStart;
    const titles = new Set(["the", "a", "an", "de", "la", "le", "von", "van", "dr", "mr", "mrs", "ms", "sir", "lady", "lord", "miss"]);
    const tokens = (member.name || "").split(/[\s\-–—_,./]+/).filter(Boolean);
    const firstName = tokens.find((tok) => tok.length >= 2 && !titles.has(tok.toLowerCase())) || tokens[0] || member.name;
    const before = input.value.slice(0, start).replace(/@([^\s@]{0,32})$/, `@${firstName} `);
    input.value = before + input.value.slice(start);
    const pos = before.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    input.dispatchEvent(new Event("input"));
    this.closeCharMention();
  }

  closeCharMention() {
    this._mentionOpen = false;
    this._mentionMenu?.remove();
    this._mentionMenu = null;
  }

  openCommandHelp() {
    openModal(`
      <h3>${t("chat_chat_commands_heading")}</h3>
      <p style="margin:-6px 0 12px;font-style:italic;font-size:13px;color:var(--color-sec)">${t("chat_chat_commands_description")}</p>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--color-ink)">
        ${[
          ["/ooc", t("chat_cmd_desc_ooc")],
          ["/scene", t("chat_cmd_desc_scene")],
          ["/note", t("chat_cmd_desc_note")],
          ["/time", t("chat_cmd_desc_time")],
          ["/as Name", t("chat_cmd_desc_as")],
          ["/help", t("chat_cmd_desc_help")],
        ].map(([cmd, desc]) => `
          <div style="display:flex;gap:10px;align-items:baseline">
            <code class="font-mono" style="flex:none;min-width:76px;font-size:12px;color:var(--color-accent)">${cmd}</code>
            <span style="color:var(--color-sec)">${desc}</span>
          </div>
        `).join("")}
        <div style="display:flex;gap:10px;align-items:baseline">
          <code class="font-mono" style="flex:none;min-width:76px;font-size:12px;color:var(--color-accent)">/roll 2d6</code>
          <span style="color:var(--color-sec)">${t("chat_cmd_desc_roll")}</span>
        </div>
      </div>
    `);
  }

  async submitComposer() {
    const input = document.getElementById("chatInput");
    const raw = input.value.trim();
    if (!raw || this.streaming) return;
    this.diceRolledThisTurn = false;
    if (/^\/help\s*$/i.test(raw)) {
      input.value = "";
      store.set(`draft:${this.sid}`, "");
      this.renderCmdChips("");
      this.openCommandHelp();
      return;
    }
    const rollMatch = raw.match(/^\/roll\s+(\S+)\s*([\s\S]*)$/i);
    if (rollMatch) {
      input.value = "";
      input.style.height = "auto";
      store.set(`draft:${this.sid}`, "");
      this.renderCmdChips("");
      if (this.diceRolledThisTurn) { toast(t("chat_already_rolled_this_turn")); return; }
      this.diceRolledThisTurn = true;
      this.sendTurn("roll", { expr: rollMatch[1], note: rollMatch[2].trim() });
      return;
    }
    input.value = "";
    input.style.height = "auto";
    store.set(`draft:${this.sid}`, "");
    this.renderCmdChips("");
    const parsed = parseSlashCommand(raw);
    if (parsed) {
      const optimistic = directiveToSigil(parsed.directive, parsed.directiveArg, parsed.content);
      this.sendTurn("chat", { content: parsed.content, directive: parsed.directive, directive_arg: parsed.directiveArg },
                    { optimisticUser: optimistic });
      return;
    }
    this.sendTurn("chat", { content: raw }, { optimisticUser: inlineToSigil(raw) });
  }

  _myParticipant() {
    if (!this.multiplayer) return null;
    return this.multiplayer.participants?.find((p) => p.user_id === ME?.id) || null;
  }

  _myPersonaId() {
    const mine = this._myParticipant();
    return mine ? (mine.persona_id || null) : (this.session?.persona_id || null);
  }

  _myPersonaName() {
    const mine = this._myParticipant();
    if (mine) return mine.persona_name || ME?.display_name || ME?.username || t("chat_you_fallback_name");
    return this.session?.user_name || t("chat_you_fallback_name");
  }

  async loadPersonaAvatar() {
    const mine = this._myParticipant();
    if (mine) { this.personaAvatar = mine.avatar || ""; this.render(); return; }
    if (!this.session?.persona_id) { this.personaAvatar = ""; return; }
    try {
      const personas = await api("/api/personas");
      this.personaAvatar = personas.find((p) => p.id === this.session.persona_id)?.avatar || "";
    } catch {
      this.personaAvatar = "";
    }
    this.render();
  }

  paintStage() {
    const assets = this.char.assets || {};
    const bg = this.main.querySelector("#chatStageBg");
    const sprite = this.main.querySelector("#chatStageSprite");
    const audio = this.main.querySelector("#chatStageAudio");
    if (bg) {
      const url = pickStageAsset(assets.stage, this.currentMood);
      if (url) { bg.style.backgroundImage = `url("${url}")`; bg.style.opacity = "1"; }
      else bg.style.opacity = "0";
    }
    if (sprite) {
      const url = pickStageAsset(assets.sprites, this.currentMood);
      if (url) { sprite.src = url; sprite.style.opacity = "1"; }
      else { sprite.removeAttribute("src"); sprite.style.opacity = "0"; }
    }
    if (audio) {
      const url = pickStageAsset(assets.music, this.currentMood);
      if (url) {
        if (audio.dataset.src !== url) { audio.dataset.src = url; audio.src = url; }
        audio.muted = this.muted;
        if (!this.muted) audio.play().catch(() => {});
      }
    }
  }

  _groupPending(charId, bodyAcc, narrText, thinking) {
    const thread = this.main.querySelector("#chatThread");
    if (!thread) return;
    const member = this._groupChar(charId) || { char_id: charId, name: "?" };
    const col = this._grpColor(charId);
    const pfp = this.pfpHtml(false, { char_id: charId });
    const narr = narrText ? `<div class="grp-narr">${chatMd(narrText)}</div>` : "";
    let row = "";
    if (bodyAcc) {
      row = `<div class="chat-msg-row">${pfp}<div class="chat-bubble"><div class="sym-body">${chatMd(bodyAcc)}</div></div></div>`;
    } else if (thinking && !narr) {
      row = `<div class="chat-msg-row">${pfp}<div class="chat-writing"><span class="chat-writing-dot"></span>${_esc(member.name)} ${t("chat_is_thinking_suffix")}</div></div>`;
    }
    const label = (bodyAcc || narr) ? `<div class="chat-name-label" style="color:${col}">${_esc(member.name)}</div>` : "";
    let node = thread.querySelector(`[data-pending-grp="${CSS.escape(charId)}"]`);
    if (!node) {
      thread.insertAdjacentHTML("beforeend", `<div class="chat-turn ai" data-pending-grp="${_esc(charId)}"><div class="chat-turn-body"></div></div>`);
      node = thread.querySelector(`[data-pending-grp="${CSS.escape(charId)}"]`);
    }
    node.querySelector(".chat-turn-body").innerHTML = `${narr}${row}${label}`;
    this.scrollToBottom();
  }

  async revealTyping(fullText, signal, onTick) {
    const TICK_MS = 12;
    const TOTAL_TICKS = 120;
    const chunk = Math.max(1, Math.ceil(fullText.length / TOTAL_TICKS));
    for (let i = chunk; i < fullText.length; i += chunk) {
      if (signal.aborted) return;
      onTick(fullText.slice(0, i));
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
    if (!signal.aborted) onTick(fullText);
  }

  async sendTurn(endpoint, body, { optimisticUser } = {}) {
    if (this.streaming) return;
    if (this.draftCharId) {
      try {
        const created = await api(`/api/characters/${encodeURIComponent(this.draftCharId)}/sessions`, {
          method: "POST",
          body: JSON.stringify({ persona_id: this.session?.persona_id || null, greeting_index: this.greetingIndex || 0 }),
        });
        this.sid = created.id;
        this.session = created;
        this.draftCharId = null;
        history.replaceState(null, "", `/chats/${created.id}`);
        this.loadPersonaAvatar();
      } catch (err) {
        errorToast(err.message || t("chat_couldnt_start_that_chat"));
        return;
      }
    }
    body = { ...body, think: false };
    this.stoppedTurn = null;
    this.streaming = true;
    if (optimisticUser) {
      this.session.messages.push({
        id: `pending-user-${Date.now()}`, role: "user", content: optimisticUser,
        user_name: this.multiplayer ? this._myPersonaName() : null,
        persona_avatar: this.multiplayer ? this.personaAvatar : null,
        sender_user_id: this.multiplayer ? ME?.id : null,
      });
    }
    this.render();
    this.scrollToBottom();

    let bodyAcc = "";
    let gotDone = false;
    const isRegen = endpoint === "regenerate";
    const regenTargetId = isRegen
      ? [...this.session.messages].reverse().find((m) => m.role === "assistant")?.id
      : null;

    const upsertPlaceholder = () => {
      const thread = this.main.querySelector("#chatThread");
      if (!thread) return;
      const bubbleInner = `
        <div class="chat-msg-row">
        ${this.pfpHtml(false, { mood: this.currentMood })}
        ${!bodyAcc ? `<div class="chat-writing"><span class="chat-writing-dot"></span>${_esc(this.char.name)} ${t("chat_is_thinking_suffix")}</div>` : ""}
        ${bodyAcc ? `<div class="chat-bubble"><div class="sym-body">${chatMd(stripMood(bodyAcc))}</div></div>` : ""}
        </div>
        <div class="chat-name-label">${_esc(this.char.name)}</div>
      `;
      if (regenTargetId) {
        const existing = thread.querySelector(`[data-mid="${CSS.escape(regenTargetId)}"]`);
        if (existing) {
          existing.querySelector(".chat-turn-body").innerHTML = bubbleInner;
          this.scrollToBottom();
          return;
        }
      }
      let node = thread.querySelector("[data-pending-ai]");
      if (!node) {
        thread.insertAdjacentHTML("beforeend", `<div class="chat-turn ai" data-pending-ai><div class="chat-turn-body"><div class="chat-name-label">${_esc(this.char.name)}</div></div></div>`);
        node = thread.querySelector("[data-pending-ai]");
      }
      node.innerHTML = `<div class="chat-turn-body">${bubbleInner}</div>`;
      this.scrollToBottom();
    };

    const controller = new AbortController();
    this.abortController = controller;

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(this.sid)}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Request failed (${res.status})`);
      }
      let turnMeta = null;
      await sseEvents(res, async (ev) => {
        if (ev.type === "meta") {
          turnMeta = ev;
          if (ev.retrieve_error) toast(`${t("chat_lore_memory_lookup_failed_prefix")} ${ev.retrieve_error}`);
          if (ev.user_mid) {
            const pending = this.session.messages.find((m) => String(m.id).startsWith("pending-user-"));
            if (pending) pending.id = ev.user_mid;
          }
        } else if (ev.type === "status") {
          if (this.session.is_group && ev.char_id) this._groupPending(ev.char_id, "", "", true);
        } else if (ev.type === "message") {
          if (this.session.is_group && ev.message) {
            this.main.querySelector(`#chatThread [data-pending-grp="${CSS.escape(ev.char_id || "")}"]`)?.remove();
            this.main.querySelector("#chatThread [data-pending-ai]")?.remove();
            if (ev.lore?.length || ev.memory?.length) {
              this.recallByMid = this.recallByMid || {};
              this.recallByMid[ev.message.id] = { lore: ev.lore, memory: ev.memory };
            }
            this.session.messages.push(ev.message);
            this.render();
            this.scrollToBottom();
          }
        } else if (ev.type === "delta") {
          if (this.session.is_group) {
            const chatMode = this.session.group_mode === "chat";
            const split = chatMode ? { dialogue: ev.content, action: "" } : groupSplitSpeech(ev.content);
            await this.revealTyping(split.dialogue || ev.content, controller.signal, (partial) => {
              this._groupPending(ev.char_id, partial, split.action, false);
            });
            return;
          }
          await this.revealTyping(ev.content, controller.signal, (partial) => {
            bodyAcc = partial;
            upsertPlaceholder();
          });
        } else if (ev.type === "error") {
          throw new Error(ev.message || t("chat_generation_failed_fallback"));
        } else if (ev.type === "done") {
          gotDone = true;
          this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`);
          await this.maybeAutoTitle(endpoint, ev.message);
          if (ev.mood) this.currentMood = ev.mood;
          if (ev.memory_error) toast(`${t("chat_turn_not_saved_to_memory_prefix")} ${ev.memory_error}`);
          if (turnMeta && ev.message && (turnMeta.lore?.length || turnMeta.memory?.length)) {
            this.recallByMid = this.recallByMid || {};
            this.recallByMid[ev.message.id] = turnMeta;
          }
        }
      });
      if (!gotDone) throw new Error(t("chat_connection_lost"));
    } catch (err) {
      if (err.name === "AbortError") {
        this.stoppedTurn = null;
      } else {
        toast(err.message || t("chat_that_turn_failed"));
        if (!gotDone) {
          try { this.session = await api(`/api/sessions/${encodeURIComponent(this.sid)}`); } catch {}
        }
      }
    } finally {
      this.streaming = false;
      this.abortController = null;
      this.render();
      this.scrollToBottom();
    }
  }

  async maybeAutoTitle(endpoint, doneMessage) {
    if (endpoint !== "chat") return;
    if (!this.session || this.session.title !== this.char.name) return;
    const stripped = String(doneMessage?.content || "").replace(/<think>[\s\S]*?<\/think>/, "");
    const parsed = parseCommandedMessage(stripped, "assistant");
    const raw = parsed.prose.split(DIRECTOR_SIGIL).join("");
    const title = raw
      .replace(/<[^>]+>|\(OOC:[^)]*\)|[*_`#>[\]()~]/g, "")
      .trim()
      .split(/[.!?\n]/)[0]
      .trim()
      .slice(0, 60)
      .replace(/\s+\S{0,15}$/, "")
      .trim();
    if (!title) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(this.sid)}`, { method: "PATCH", body: JSON.stringify({ title }) });
      this.session.title = title;
    } catch {}
  }
}

if (typeof window !== "undefined") {
  window.ChatView = ChatView;
}
