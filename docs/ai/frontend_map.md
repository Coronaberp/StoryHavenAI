# Frontend map

> Part of `docs/ai/` — git-tracked, public. Code-architecture facts only. See
> `architecture.md` for the exposure rule this doc set follows.

## Directory status

The frontend was rebuilt from scratch with Tailwind CSS, mobile-first, replacing the original vanilla-JS SPA.

- `legacy_ui/` — the original vanilla-JS/CSS SPA (all `static/js/*.js` files, `static/css/*.css` files, `index.html`), kept for reference only. Not served by anything.
- `static/` — an old standalone maintenance page shown during the rebuild. No longer live, kept on disk but not served.
- `new_ui/` — the live Tailwind SPA (`index.html` + `js/*.js` + `css/*.css`). Edits to `new_ui/js/*.js`/`new_ui/css/*.css` take effect immediately, no separate dev proxy step needed.

## Tailwind build pipeline

`rebuild.sh` (repo root) compiles Tailwind output: `new_ui/css/cards.css`/`themes.css`/`input.css` are the hand-written sources, `new_ui/css/app.css` is Tailwind's **compiled output** (starts with a `tailwindcss` banner comment) — **never hand-edit `app.css` directly**, edits there are silently lost the next time anything rebuilds it; put custom chat/card/component CSS in `cards.css` instead. Run `./rebuild.sh --once` after editing source CSS to regenerate `app.css`. Builds do **not** pass `--minify` — Tailwind's minifier was found to silently strip every `[data-theme="light"]`/`[data-theme][data-accent]` override rule from the compiled CSS entirely (present in a non-minified build, absent in a minified one) — this app's CSS doesn't need minification, so this isn't worth chasing further.

## Theme system

`new_ui/css/themes.css` + `new_ui/js/theme.js`: 6 accent presets (Aurum/Azure/Crimson/Verdant/Amethyst/Rose Quartz) × 2 chrome bases (dark/light) = 12 combinations. `theme.js` only ever toggles `data-theme`/`data-accent` attributes on `<html>` and persists the choice via `store`; it holds no color values itself. `themes.css` itself is the canonical color source.

`themes.css` does three things a naive "swap the accent hex" implementation would miss:

1. **Page chrome (`--color-paper`/`--color-surface`/`--color-surface-2`/`--color-line`/`--color-line-2`) is tinted by the accent, not left neutral** — each non-default preset overrides these via `color-mix(in srgb, {accent} 40%/25%/35%/20%/30%, var(--color-paper-base) 60%/75%/65%/80%/70%)`, i.e. a wash of the accent hue blended into that mode's true black/white anchor (`--color-paper-base`, never itself overridden). This is why picking a non-default accent visibly recolors the whole page background, not just the logo/nav.
2. **Light mode's default accent is its own muted tone, not the dark-mode hex.** `--color-accent-base` differs between dark and light modes (similarly `--color-accent-deep-base`) — a custom preset's raw hex gets blended 85%/15% against *this mode-appropriate anchor* (`color-mix(in srgb, {accent} 85%, var(--color-accent-base) 15%)`), which is what keeps a bright preset color from washing out unreadable against the pale light-mode paper.
3. **Text color is a separate per-preset, per-mode value, not the accent color reused.** Each non-default preset carries a `textDark` (pale, legible on dark) and `textLight` (dark, legible on pale) hex, applied via compound `[data-theme="dark"][data-accent="X"]`/`[data-theme="light"][data-accent="X"]` selectors overriding `--color-ink` — a single fixed text color read as unreadable once the same preset was applied to the opposite mode.

The `--color-primary`/`-secondary`/`-tertiary` families (each with `-light`/base/`-dark` states) are a separate, mode-independent set used for future button/component accents — those three families don't participate in the tinting/legibility logic above, only the chrome tokens and `--color-accent`/`--color-accent-deep` do.

Any element that needs to react to theme changes must get its color from a Tailwind utility class backed by these tokens (or `currentColor` inheriting from an ancestor that does) — a hardcoded hex value or an `<img src="...svg">` reference will not react to a theme switch. Any custom CSS written outside `themes.css`/Tailwind utility classes (an inline `style="background:..."` on a screen's own markup) must reference the CSS custom properties (`var(--color-paper)`, `var(--color-accent)`, etc.), never hardcode a literal hex color.

## Naming hazard

Every `new_ui/js/*.js` file is a classic script sharing one global scope, so two files defining the same function name silently overwrite each other by load order. Before naming a new top-level function, grep for the name across `new_ui/js/`. See `architecture.md`.
