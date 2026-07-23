# StoryHaven AI — Design System

> **Forge worlds. Remember everything.**

The brand and UI system for **StoryHaven AI** — a self-hosted AI roleplay
platform with dynamic lorebooks, unlimited semantic memory, multi-user accounts
with an admin/permissions model, and optional ComfyUI image generation. You run
the model, you own the data; characters import from the community card ecosystem
(SillyTavern / chub.ai / RisuAI / SpicyChat).

This project is a **design system**: token CSS, foundation specimen cards,
reusable React component primitives, and a full interactive UI-kit recreation of
the product — everything a designer needs to build on-brand StoryHaven surfaces.

## Sources

Built by reading the product's real source (not screenshots):

- **GitHub — `Coronaberp/StoryHavenAI`**: https://github.com/Coronaberp/StoryHavenAI
  - `static/css/base.css` — tokens (colors, type, radii), scrollbars, nav rail
  - `static/css/profile.css` — buttons, catalog cards, dossier, chat bubbles
  - `static/css/overlay.css` — modals, form fields, badges, composer
  - `static/css/pages.css` — style cards, creator cards, image-gen layout
  - `static/index.html` — app shell, nav SVG icon set
  - `README.md` / `docs/features.md` — product copy, tone, feature model

Explore the repository further to build richer or more exact StoryHaven
surfaces — the CSS files above are the ground truth for every value here.

The product is a FastAPI + PostgreSQL/pgvector backend serving a vanilla-JS SPA;
the frontend is CSS-class based (no formal component library), so the components
in this system are faithful React encapsulations of the product's actual CSS
patterns, with exact numeric values preserved.

---

## Content fundamentals

**Voice: an editorial, confident, plain-spoken guide.** Copy reads like a
well-written manual crossed with a fantasy-imprint blurb — it explains real
mechanics without hype, then lets an occasional lyrical line land.

- **Person:** addresses the reader as **you** ("You run the model. You own the
  data."), refers to the product as *the app* / *StoryHaven*. First person is
  avoided.
- **Casing:** **sentence case everywhere** — headings, buttons, nav labels
  ("New character", "Start chat", "Recent chats"). The only systematic
  uppercase is the mono **eyebrow/label** device (letter-spaced, e.g.
  `SEMANTIC MEMORY`, `RECENT CHATS`).
- **Taglines are terse and paired:** the master tagline *"Forge worlds.
  Remember everything."* sets the pattern — two short imperative clauses.
- **Feature names are plain nouns:** Library, Community, Personas, Creations,
  Forum, Lorebook, Persona, Stage, Dossier. Modes are "Character" and
  "RPG · Game Master".
- **Explanatory copy is concrete and technical when it needs to be** — it will
  happily say "one vector per exchange", "cosine-distance cutoff", "encrypted
  at rest (Fernet)". It respects a technical reader.
- **Punctuation flourishes:** middot separators (`RPG · Game Master`), em
  dashes for asides, "smart" quotes in prose.
- **Emoji are used sparingly and functionally** as glyphs for features —
  🎬 Stage, 🎲 dice, 🧠 thinking, 💭 thought process, 🌐 language, ◷ memory,
  ⤓ export card, ❖ brand. They label affordances; they are **not** decorative
  and never appear in marketing headlines.
- **Roleplay content itself** uses markdown: `*italics for action/narration*`,
  `"quoted dialogue"`, `**bold for emphasis**`.

Example (from the product):
> **How memory stays "unlimited"** · Your whole history is never stuffed into
> the prompt — context windows are finite. Each exchange becomes one vector;
> each turn pulls back only the few most relevant memories.

---

## Visual foundations

**Overall vibe:** a dark, warm, editorial "candlelit library at night."
Near-black surfaces with a champagne-gold accent and a serif display face give
it a literary, premium feel — closer to a fine-press imprint than a neon
chat-app. It is unmistakably *warm* (every neutral is tinted toward gold/parchment),
never cold or bluish.

- **Color:** one accent — **champagne gold `#E3BD6C`** — does essentially
  everything (links, focus, active states, the "primary" gradient, scrollbars).
  Neutrals are warm, gold-tinted greys, not pure greys. The single non-gold hue
  is a **dusty rose `#F0788F`** reserved for warnings/destruction. Dark is the
  default theme (paints before JS to avoid a flash); a warm-ivory light theme
  mirrors every token under `[data-theme="light"]`. **Historical quirk:** the
  codebase keeps variable names `--violet*` but points them at gold — the
  "primary" gradient is `--violet → --violet-deep`.
- **Type:** three families. **Fraunces** (display serif) for headline
  touchpoints — page titles, dossier/character names, modal titles, the
  wordmark; set tight (`-.01em`). **Inter** for all body/UI. A **monospace**
  (`--mono`) for the signature uppercase, wide-tracked eyebrows and labels.
  Base 16px / line-height 1.6.
- **The core header rhythm** is **mono eyebrow → serif headline → Inter body**.
  It recurs on nearly every page and section.
- **Backgrounds:** flat warm surfaces, no busy patterns. Depth comes from three
  stacked surface tints (`--paper` → `--surface` → `--surface-2`) and hairline
  borders, not heavy shadows. Character art is the imagery — used full-bleed
  behind cards and hero banners, always under a **bottom-fade protection
  gradient** (`linear-gradient(0deg, #0C0C0E, transparent 55%)`) so overlaid
  text stays legible. Creator cards blur their own banner into pure ambient
  color.
- **Cards:** rounded (12–16px), `--surface-2` fill, 1px hairline border. The
  signature **character card** is a 3:4 tile with a **gold→black gradient
  border** (via layered `background-clip`), full-bleed art, the bottom fade,
  and title/tagline/tags overlaid at the base. Hover lifts `-1px` with a
  gold-tinted shadow.
- **Corner radii:** 7px (chips) · 10px `--r` (buttons, inputs, rows) · 12–14px
  (cards) · 16px (modals, hero) · 999px (tag/filter pills).
- **Borders & hairlines:** `--line` (#2A2A2E) for dividers, `--line-2` for
  slightly stronger edges/controls. Borders do a lot of the structural work.
- **Shadows:** soft, warm-tinted, low-spread — never harsh black. Menus/popovers
  use `0 14px 32px -12px rgba(0,0,0,.5)`; modals a gold-tinted
  `0 24px 60px -20px var(--violet-soft)`; card hover a gold `-14px` spread.
- **Buttons:** default = `--surface` + hairline, gaining a gold border + gold
  text on hover. Primary = the gold gradient with dark `--gold-ink` text.
  Destructive = rose. Radius 10px, weight 500 (600 for primary).
- **Hover states:** gold border + gold text (controls), gold-tint wash
  (`--accent-tint`) on rows/nav, `-1px`/`-3px` translate on cards.
- **Focus / active:** a 3px gold **`--accent-soft` ring** on inputs; active
  controls fill with `--accent-soft` and shift text to `--accent-deep`.
- **Press:** color-driven (fills deepen); no dramatic scale-down.
- **Transparency & blur:** used for glassy overlays — sticky topbars and
  glass-morphism profile cards use `backdrop-filter: blur()` over
  `color-mix(... transparent)` surfaces; modal scrims are `#000000b3` + blur.
- **Motion:** quick and restrained. `.12s–.22s` transitions; the signature
  ease is `cubic-bezier(.2,.7,.3,1)`. Chat turns *rise* in (6px + fade). A
  blinking caret/pulse marks streaming. No bounces, no long decorative loops.
- **Imagery color vibe:** warm, painterly character art; text-on-image is
  always gold/white over the dark protection fade.

---

## Iconography

- **Primary system: inline SVG line icons**, Feather/Lucide family —
  **16×16**, `fill:none`, `stroke:currentColor`, `stroke-width:2`, round caps
  and joins. The product hand-inlines these in `static/index.html` (library,
  users, smiley, sparkle, message, plus, bell, gear, log-out, chevrons, etc).
  This kit reproduces that exact set in `ui_kits/storyhaven-app/icons.jsx`
  (`window.SHIcons`). Icons inherit text color, so they turn gold on hover/active
  automatically.
- **When you need icons beyond the reproduced set,** use **Lucide**
  (https://lucide.dev) — it is the closest match to the product's stroke weight
  and style. Keep 16px / stroke-width 2 / round caps.
- **The brand mark is the illustrated `logo-full.png`** (`assets/`, 1254×1254,
  on black `#0C0C0E`) — a moonlit keep, gold quill, open book, and chat bubble
  wired into a circuit, over the gold/silver `StoryHavenAI` wordmark and the
  tagline. Optimized `logo-512 / 256 / 128` variants are provided for smaller
  placements. A **scalable SVG wordmark lockup** (`assets/wordmark.svg`) covers
  the type-only lockup for nav/print at any size (it uses Fraunces + the mono
  tagline face). Because the primary mark is a detailed raster illustration, it
  is **not** vectorized — a hand-trace would be larger and lower-fidelity than
  the PNG; use the optimized rasters for the full mark and the SVG for the
  wordmark.
- **The compact mark is `❖`** (U+2756) rendered in the display serif with a
  gold gradient — used where the full illustration is too detailed (collapsed
  sidebar, favicon, inline). Pair it with "StoryHaven AI" in Fraunces.
- **Functional emoji** stand in as feature glyphs in-product (🎬 🎲 🧠 💭 🌐 ◷
  ⤓). Use them only to label those specific features, matching the product.
- **Unicode glyphs** appear as tiny affordances in the source (◷ chat count,
  ❖ brand); prefer SVGs for anything that needs consistent weight.

---

## Font substitutions

- **Fraunces** and **Inter** load from Google Fonts (exactly as the product
  does) — no substitution.
- **`--mono` primary is `Aptos Mono`** (Microsoft, proprietary — no webfont).
  We keep the token pointing at `Aptos Mono` and let its fallback stack
  (`Cascadia Code`, `ui-monospace`, `SF Mono`, `Menlo`) render. **If you have
  an Aptos Mono license/webfont, drop the files in `assets/` and add a
  `@font-face` so labels match the product 1:1.** Everywhere else the mono role
  looks correct via the system monospace.

---

## Index / manifest

**Root**
- `styles.css` — the entry point consumers link (imports only).
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand).
- `assets/` — brand logo (`logo-full.png` + `logo-512/256/128`) and the
  scalable `wordmark.svg` lockup.
- `components/` — reusable React primitives (below).
- `ui_kits/storyhaven-app/` — interactive full-app recreation.
- `SKILL.md` — Agent-Skill wrapper for use in Claude Code.

**Components** (namespace `window.StoryHavenAIDesignSystem_8e6189`)
- `core/` — **Button**, **IconButton**, **Badge**, **Tag**, **Chip**
- `forms/` — **TextField**, **Select**, **SearchField**, **Switch**
- `content/` — **CharacterCard**, **StatPill**, **ModeBadge**, **Eyebrow**
- `chat/` — **ChatBubble**, **Composer**
- `feedback/` — **Modal**

Each component directory has `<Name>.jsx`, `<Name>.d.ts`, `<Name>.prompt.md`,
and one `@dsCard` HTML showing its states.

**Intentional additions** (no direct source counterpart, added for reuse):
- **Eyebrow** — the mono uppercase kicker is a pervasive text pattern in the
  product (`.page-eyebrow`, section labels); wrapping it as a component makes
  the brand's header rhythm reusable.
- **IconButton** — the product's `.rail-icon-btn` / icon controls, generalized.

**UI kit screens** — Login/Explore, Library, Dossier, Chat (see
`ui_kits/storyhaven-app/README.md`).
