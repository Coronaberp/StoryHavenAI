# Sanctum desktop/ultrawide layout pass — design

## Goal

Give Grimoire (My Grimoire, lore entries) and Masks (My Masks, personas) a desktop (1024–1535px) and ultrawide (≥1536px) layout, matching the responsive-tier work already done for Forge, Create, Chat, and Admin.

## Scope

Sanctum has four screens: Forge, Grimoire, Masks, Casts.

- **Forge** — already fully rebuilt across all four tiers in an earlier session (matches `Responsive page redesign/Forge.dc.html`). Out of scope here.
- **Casts** — reuses `PantheonView` (`pantheon.js`) scoped to `"mine"`. Its render wrapper has no `.content-col` wrapper at all; width is bounded only by the app shell's own `<main id="main">` (`2xl:max-w-[1600px] 2xl:mx-auto` in `index.html`). Its `.card-grid` already reflows via `grid-template-columns: repeat(auto-fit, minmax(...))`. **No changes needed.**
- **Grimoire** (`grimoire.js`) and **Masks** (`masks.js`) — both wrap their entire render output in the generic `.content-col` (680px cap, defined in `new_ui/css/cards.css`), which was designed for reading-width text content, not list screens. This caps both to a single narrow column at every viewport width, including desktop and ultrawide. **This is the actual gap.**

Both screens share the same structural shape and the same CSS classes:
- A flat (Masks) or category-grouped (Grimoire) list of `.sanctum-feed` containers, each holding one or more `.sanctum-feed-row` items (thumbnail + title + meta, horizontal layout, currently divided by `border-bottom`).
- Add/edit happens in a modal (`openAddFlow()` / `openAdd()`), never inline on the page — confirmed via user decision, this stays a modal on desktop/ultrawide too, not a split-view.

## Approach

Per the user's decision: **multi-column card grid**, not a Forge/Create-style split view — these are browsable lists with modal editing, not live-editing forms, so a grid matches what they already are rather than inventing new inline-editor UI.

### 1. Widen the content cap

Add two new override classes, `.grimoire-content` and `.masks-content`, alongside `.content-col` on each screen's outer wrapper (same pattern as `.forge-content`, `.create-content`, `.admin-users-content` already in `cards.css`):

```css
@media (width >= 64rem) {   /* lg: 1024px */
  .grimoire-content, .masks-content { max-width: 900px; }
}
@media (width >= 96rem) {   /* 2xl: 1536px */
  .grimoire-content, .masks-content { max-width: 1400px; }
}
```

(Exact values matched to the existing Admin/Create scale — generous but not edge-to-edge, consistent with the rest of the app.)

### 2. Turn `.sanctum-feed` into a grid at `lg:`+

One shared CSS change in `cards.css` covers both screens, since both use the identical `.sanctum-feed`/`.sanctum-feed-row` classes:

```css
@media (width >= 64rem) {
  .sanctum-feed {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 8px;
  }
  .sanctum-feed-row {
    border: 1px solid var(--color-line);
    border-radius: 12px;
    border-bottom: 1px solid var(--color-line);  /* overrides the mobile-only bottom-divider-as-separator styling */
  }
  .sanctum-feed-row:last-child {
    border-bottom: 1px solid var(--color-line);  /* every card gets a full border in grid mode, not just non-last rows */
  }
}
```

No JS or markup changes — `.sanctum-feed-row`'s internal layout (thumbnail + title + meta, horizontal flex) already works unchanged at any card width down to ~280px, so this is CSS-only.

Grimoire's per-category grouping is unaffected structurally: each category still renders its own `.sanctum-feed-header` + `.sanctum-feed` pair, so each category becomes its own independent grid section — consistent with how category grouping already reads today, just wider.

### 3. Testing

Manual verification via the running `:3001` dev server (per project convention — no existing automated visual-regression tooling for this app):
- Load `/sanctum/grimoire` and `/sanctum/masks` at 1024px, 1440px, and 1600px+ widths (desktop and ultrawide breakpoints) and confirm the grid reflows to 2–4 columns depending on width, with no items dividing the browser window's edge-to-edge line the way the old flex-column list did.
- Confirm the add-modal flow (`openAddFlow` / `openAdd`) is unaffected — this design makes no changes to modal behavior.
- Confirm mobile/tablet (<1024px) rendering is pixel-identical to before, since all changes are gated behind `@media (width >= 64rem)`.
- Confirm Grimoire's category grouping still reads correctly with multiple categories stacked vertically, each its own grid section.

## Out of scope

- Casts (already correct, no `.content-col` wrapper).
- Forge (already done in an earlier session).
- Any change to the add/edit modal itself, or to how lore/persona data is fetched or filtered.
- Any change to mobile/tablet (<1024px) layout — this is additive only, gated behind the `lg:` breakpoint.
