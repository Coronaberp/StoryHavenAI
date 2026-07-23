# Four-Tier Responsive Design (Mobile / Tablet / Desktop / Ultrawide)

## Goal

`new_ui` currently has a binary responsive system: a single breakpoint at 768px (Tailwind's `md:`) switches between a mobile layout (bottom nav + fixed header) and a desktop layout (full labeled sidebar). Tablet-sized viewports (768–1023px, e.g. iPad portrait) get the desktop treatment, which is a fixed 240px labeled sidebar designed for mouse-driven, wide-window use — cramped and mismatched for a touch device at that width. This spec adds a real tablet tier and formalizes an ultrawide tier, without changing the app's existing visual identity (colors, type, component styles).

## Breakpoints

Matches the CSS custom-media scale already declared in `new_ui/css/app.css` (`@media (width >= 40rem/48rem/64rem/80rem/96rem)`) — no new breakpoint system, just applying existing steps consistently:

| Tier | Range |
|---|---|
| Mobile | `< 768px` |
| Tablet | `768px – 1023px` |
| Desktop | `1024px – 1535px` |
| Ultrawide | `≥ 1536px` |

## Navigation per tier

**Mobile (`< 768px`) — unchanged.** Fixed bottom nav (`#bottomNav`) with 5 slots: Compendium, Parlance, elevated "+" (new character), Sanctum, My Dossier (avatar). Compendium/Sanctum/Dossier open a popover menu (`nav-menus.js`) listing their sub-destinations. Fixed mobile header (`#mobileHeader`) at top.

**Desktop (`1024px – 1535px`) — unchanged.** Full-width labeled sidebar (`#sidebar`, currently `w-60`/240px) with the same 4 top-level items, same popover-menu pattern for sub-destinations.

**Tablet (`768px – 1023px`) — new.** A fixed 64px-wide icon-only sidebar rail. Not expandable/collapsible — there is no toggle state, it is always this width at this tier. Unlike mobile and desktop, it does **not** use the popover-menu pattern: every destination except the Compendium overview page itself (`/compendium`) is shown as its own icon, since the overview page is redundant once its children are all directly visible. Destinations, top to bottom:

1. Logo mark (links to `/compendium`, same as the sidebar/mobile-header logo link today)
2. *divider*
3. Pantheon, Artisans, Pinacotheca, Symposium (today's Compendium submenu)
4. *divider*
5. Parlance
6. *divider*
7. Forge, Grimoire, Masks, Casts (today's Sanctum submenu — labeled "My Forge"/"My Grimoire"/"My Masks"/"My Casts" in the existing popover; icon rail drops the "My" prefix since there's no room and it's redundant on an icon)
8. *divider*
9. Settings, Sign out (today's Dossier submenu, minus the "Dossier" entry itself — the avatar slot below covers that)
10. My Dossier — pinned to the bottom of the rail as an avatar, mirroring the avatar-in-nav-item pattern the mobile bottom nav already uses for this slot (`data-avatar-ring`/`data-avatar-fallback`), not a divider-separated group

Each icon is a 44×44px hit target (WCAG/Apple touch-target minimum). The active route gets a left-edge accent bar (vertical counterpart to the bottom nav's ribbon-notch marker — same visual language, not a new motif). Every icon carries a `title`/tooltip-on-hover attribute and an `aria-label` showing its full label (e.g. "Pantheon", "My Grimoire") — icon rail is not just a set of unlabeled glyphs for anyone inspecting the DOM or using assistive tech, even though no text renders by default at this width.

**Ultrawide (`≥ 1536px`) — nav unchanged from desktop.** Same full labeled sidebar as desktop. Only `#main`'s content area changes: gets a `max-width` (proposed: `1600px`, i.e. content stops growing well past a comfortable reading/browsing width) with `margin-inline: auto`, so the sidebar stays flush-left and the freed width becomes centered negative space around the content column, not more columns or a busier layout.

## Grid system

`.card-grid` (`new_ui/css/app.css:2048`) is currently `grid-template-columns: repeat(2, 1fr)` unconditionally — fixed 2 columns at every viewport size today, including desktop and ultrawide. Replaced with:

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
```

One rule for all four tiers — column count emerges from available width divided by the 160px minimum card width, rather than per-tier hardcoded counts. On ultrawide, the grid lives inside `#main`'s capped `max-width`, so column count still tops out sanely rather than spreading across the full screen. The 160px minimum is chosen to roughly match existing card sizings seen elsewhere in the codebase (e.g. Forge's gallery-picker thumbnails at 130px, artisan cards); exact value confirmed/tuned during implementation against real card content (aspect-ratio 3/4 `.char-card`).

## What this spec does NOT cover

- No changes to color, typography, or component visual styling — this is a layout/breakpoint spec only.
- No changes to any individual screen's own internal layout logic beyond the shared nav chrome and `.card-grid` — screen-specific tablet/ultrawide adjustments (e.g. a chat interface split-view, Forge's generation panel width) are out of scope and would need their own follow-up spec if wanted later.
- No changes to the mobile or desktop tiers' navigation structure or behavior.
- Icon choices for the tablet rail (which SVG per destination) reuse the existing icon set already defined for the bottom nav / sidebar (`_NAV_MENU_ICONS` and friends in `nav-menus.js`) — no new iconography to design.

## Testing

- Visual/manual check at representative viewport widths for each tier (e.g. 375px, 800px, 1280px, 1920px) via Playwright viewport resizing, confirming: correct nav chrome renders per tier, tablet rail shows all expected destinations with working tooltips/aria-labels and correct active-item marking on navigation, `.card-grid` column count changes sensibly across tier boundaries, ultrawide content is visibly capped/centered.
- No backend changes, so no new pytest coverage — this is pure `new_ui/css` + `new_ui/index.html`/`new_ui/js` work.
