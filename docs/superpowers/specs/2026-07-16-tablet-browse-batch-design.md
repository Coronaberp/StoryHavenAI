# Phase 1 / Browse Batch: Tablet Layout (768–1023px)

Part of [[2026-07-16-full-responsive-rollout-roadmap]]. First sub-project — validates the "capped centered column" pattern before it's applied to the remaining batches/phases.

## Scope

Screens: Compendium, Pantheon, Artisans, Pinacotheca, Symposium, Symposium-thread, character (CharacterView), artisan-profile (ArtisanProfileView).

## Current state

- Grid screens (Pantheon, Artisans, Pinacotheca) already use `.card-grid` (`grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))`), which already adapts correctly at tablet width — no change needed here.
- Compendium is a landing/hub screen mixing a featured strip and sub-grids — same `.card-grid` coverage, no change needed.
- Symposium (thread list) and Symposium-thread (single thread + replies), character detail (CharacterView), and artisan-profile are single-column, fixed-feeling layouts with no `max-width` — content stretches edge-to-edge as viewport grows past mobile, producing overlong line lengths and awkwardly spread-out cards/buttons at tablet width.

## Pattern: capped centered column

Add a shared utility class `.content-col` (in `new_ui/css/app.css`, alongside the existing `.card-grid` rule):

```css
.content-col {
  max-width: 680px;
  margin-inline: auto;
}
```

Applied only at `≥768px` (tablet and up) — below that, mobile's existing full-width behavior is unchanged:

```css
@media (width >= 48rem) {
  .content-col { max-width: 680px; margin-inline: auto; }
}
```

680px chosen to comfortably hold Symposium's reply threads and CharacterView's lore/greeting panels without truncating their existing internal `max-width: 460px` sub-elements (e.g. `.ig-detail`), while still leaving visible margin at 768px viewport width so the cap is perceptible, not just a no-op.

Apply `.content-col` to the outermost wrapper `<div>` in:
- `symposium.js` — thread list view and the "New Thread" composer
- `symposium.js` (thread view render, if in the same file) / wherever `SymposiumThreadView` renders its root
- `character.js` — `CharacterView`'s root render
- `artisan-profile.js` — `ArtisanProfileView`'s root render

Grid screens (Pantheon/Artisans/Pinacotheca/Compendium) are explicitly **not** wrapped in `.content-col` — capping their width at tablet would reduce them to fewer visible columns than the existing `.card-grid` auto-fill already produces correctly, which would be a regression, not a fix.

## What this does NOT cover

- No desktop split-view or ultrawide capping — those are Phase 2/3, separate specs.
- No visual/token changes — reuses existing `--color-*` variables and component classes throughout.
- No change to `.card-grid` itself.

## Testing

- Playwright viewport check at 800px (representative tablet width) for each of the four affected screens: confirm content is centered with visible margin on both sides, no line/card in the affected screens exceeds ~680px, and no existing element (e.g. `.ig-detail`'s 460px cap) gets clipped or squeezed.
- Same check at 375px (mobile) confirming `.content-col` has no effect below 768px — full-width behavior is unchanged.
- Confirm Pantheon/Artisans/Pinacotheca/Compendium grids are unaffected (still auto-fill at their existing column counts at 800px).

## Execution

Per [[2026-07-16-full-responsive-rollout-roadmap]], the four affected screens (Symposium, Symposium-thread, character, artisan-profile) have no shared state and can be edited independently — dispatch via `superpowers:dispatching-parallel-agents`, one agent per screen file, each applying the same `.content-col` wrapper pattern and running its own Playwright check before reporting back.
