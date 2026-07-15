# Bottom Nav Rework Design

## Goal

Replace the current 5-item bottom bar (Library / Community / Personas / Creations / Forum) with the new information architecture: **Explore / Chats / [+] / Studio / Account**. This pass wires the bar, the router, and the account avatar ring — it does not build real Explore/Chats/Studio/Account/Create screen content, which stays as placeholders.

## Scope

In scope:
- New route names and router wiring: `explore`, `chats`, `studio`, `account`, `create`.
- New bottom-nav markup: 4 flat tabs (Explore, Chats, Studio, Account) + 1 raised center seal button.
- New Chats icon (candle).
- Account tab renders the user's avatar in a ring instead of an icon.
- Ribbon-bookmark active-indicator repositioned to measure real element geometry (`offsetLeft`/`offsetWidth`) instead of assuming 5 equal-width flex children, since the center seal is now a fixed-width sibling.
- The `+` seal button navigates to `/create`, which renders a placeholder screen ("New Character — not built yet").

Out of scope (explicitly deferred, not stubbed beyond a route existing):
- Real Explore/Chats/Studio/Account/Create screen content — each renders via the existing `renderPlaceholder(main, label)` helper.
- Personas as a modal — noted for a future pass, no route or trigger added this pass.
- Forum/Community placement — routes stay registered in `router.js` (unlinked from the bar) so nothing currently pointing at them breaks; no new entry point is added.

## Routes

`new_ui/js/router.js`'s `routes` map changes:

| Old key | New key | Screen (placeholder label) |
|---|---|---|
| `library` | `explore` | "Explore" |
| — | `chats` | "Chats" (new) |
| `images` | `studio` | "Studio" |
| — | `account` | "Account" (new) |
| — | `create` | "New Character" (new, FAB target) |
| `community` | *(unchanged, unlinked)* | — |
| `personas` | *(unchanged, unlinked)* | — |
| `forum` | *(unchanged, unlinked)* | — |

`currentRoute()`'s fallback default changes from `"library"` to `"explore"`.

`NAV_ROUTES` (drives the ribbon indicator) becomes `["explore", "chats", "studio", "account"]` — 4 entries, not 5. `create` is reachable only via the seal button, not part of the ribbon-highlighted set (tapping it doesn't move the ribbon, since it's a modal-like jump rather than a tab).

`CHROMELESS_ROUTES`/`PUBLIC_ROUTES` are unaffected — `create` gets full chrome (bottom nav stays visible so the user can back out via any tab), same as `explore`/`chats`/`studio`/`account`.

## Bottom nav layout

Row order, left to right: **Explore, Chats, [seal], Studio, Account**. The seal is `flex: none`, fixed 54×54px, pulled up via negative top margin so it pokes above the dashed stitch seam (same construction as the current ribbon, just larger and always-raised rather than sliding). The other four are `flex: 1`, evenly sharing the remaining width.

### Ribbon indicator (existing tabs)

The current implementation assumes 5 equal 20%-wide flex children and moves the ribbon via `translateX(index * 100%)`. With the seal now occupying a fixed-width slot between Chats and Studio, the four real tabs are no longer uniform 25% either (browser layout still makes them equal to each other, since they're the only `flex:1` children — but no longer expressible as a clean fraction against seal width, and hardcoding the seal's pixel width into that math is fragile if the seal's size ever changes).

Fix: `setActiveNav(routeName)` in `router.js` measures the target tab's actual box instead of assuming a fraction:

```js
function setActiveNav(routeName) {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.classList.toggle("text-primary", el.dataset.route === routeName);
    el.classList.toggle("text-sec", el.dataset.route !== routeName);
  });
  const ribbon = document.getElementById("navRibbon");
  const nav = document.getElementById("bottomNav");
  if (!ribbon || !nav) return;
  const idx = NAV_ROUTES.indexOf(routeName);
  ribbon.classList.toggle("hidden", idx === -1);
  if (idx === -1) return;
  const target = nav.querySelector(`[data-route="${routeName}"]`);
  if (!target) return;
  const navRect = nav.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  ribbon.style.left = `${targetRect.left - navRect.left}px`;
  ribbon.style.width = `${targetRect.width}px`;
}
```

The ribbon element's Tailwind classes drop `w-1/5` (now set inline via `style.width`) and `left-0` becomes dynamic (`style.left`), but keep `-top-2.5`, `h-[18px]`, `transition-transform`... — **transition must move to `transition-[left]` (or `transition-all` scoped to `left,width`) since the animated property is now `left`/`width`, not `transform`.** `motion-reduce:transition-none` stays to respect reduced-motion.

### Icons

- **Explore**: unchanged open-book path (`M12 6.5c-1.8-1.3-4-1.8-6-1.5v12c2-.3 4.2.2 6 1.5...`), reused verbatim from the current Library icon.
- **Chats** (new): a lit taper candle — flame + candle body + a small drip, distinct from the campfire (which is leaving the bar with Community). SVG (viewBox 0 0 24 24, stroke currentColor, stroke-width 1.7):
  ```html
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 4c.9 1.1.9 2-.1 3.1-.7.8-.7 1.5 0 2.2"/>
    <rect x="10" y="9.3" width="4" height="9.2" rx="0.6"/>
    <path d="M7 18.5h10"/>
  </svg>
  ```
- **Studio**: unchanged sparked-photo-frame path, reused verbatim from the current Creations icon.
- **Account**: no icon — see avatar ring below.

### Account avatar ring

Replaces the icon+label pattern for this one tab. Renders:

```html
<a href="/account" data-route="account" class="flex flex-1 flex-col items-center gap-1 py-2.5 text-sec">
  <span class="relative block w-[22px] h-[22px] rounded-full p-[2px]" style="background:var(--nav-avatar-ring, linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark)))">
    <span class="block w-full h-full rounded-full overflow-hidden bg-surface-2 grid place-items-center">
      <!-- <img> if ME.avatar is set, else initial-letter fallback -->
    </span>
  </span>
  <span class="font-mono text-[9px] tracking-[.12em] uppercase">Account</span>
</a>
```

Ring source: a JS-computed CSS custom property `--nav-avatar-ring`, set once after `ME` resolves (in `boot.js`, after `ME = await api("/api/auth/me")`) and re-set on login/logout:

```js
function applyAvatarRing() {
  const el = document.querySelector('[data-route="account"] > span');
  if (!el) return;
  if (ME?.accent_color) {
    el.style.setProperty("--nav-avatar-ring", `linear-gradient(135deg, ${ME.accent_color}, ${ME.banner_color || ME.accent_color})`);
  } else {
    el.style.removeProperty("--nav-avatar-ring");
  }
}
```

Falls back to the CSS default (`--color-primary-light → --color-primary-dark`) when `ME.accent_color` is empty — matching how `_user_row` already returns `accent_color: ""` for a user who never set one (`backend/routers/profile.py`, `backend/db.py`'s `_user_row`). These two custom properties are not a fixed gold value: they're the same tokens `themes.css`'s `[data-accent="X"]` blocks already override per accent preset, and the same ones the ribbon/CTA buttons read — so the fallback always tracks whichever app theme (or, if a custom-accent picker is added later, whatever custom accent) is currently active on `<html data-accent>`, not a hardcoded default. No backend changes: `GET /api/auth/me` already returns `avatar`/`accent_color`/`banner_color` via `_user_row`.

Avatar image: `<img src="${ME.avatar}">` when `ME.avatar` is truthy, else a single uppercase initial (`ME.username[0]`) centered in `bg-surface-2` — same empty-state convention as the rest of the app (no placeholder image asset needed).

Active-state treatment: when `routeName === "account"`, `setActiveNav` (already toggling `text-primary`/`text-sec` on every `[data-route]` element including this one) additionally needs the ring itself to brighten — done via existing `text-primary`/`text-sec` toggle having no effect on a `background` gradient, so add one more explicit toggle:

```js
document.querySelector('[data-route="account"] > span')
  ?.classList.toggle("opacity-100", routeName === "account");
```

with the ring wrapper's base class including `opacity-70` (dims when inactive, full brightness when active) — cheaper than a second gradient variant and keeps the "your own colors" identity intact in both states.

### The seal (`+`)

Fixed, always-visible, not part of `NAV_ROUTES` (never highlighted/moved by the ribbon):

```html
<button type="button" onclick="navigate('/create')" title="New character"
  class="flex-none -mt-[22px] w-[54px] h-[54px] rounded-2xl grid place-items-center text-paper"
  style="background:linear-gradient(150deg, var(--color-secondary-light), var(--color-secondary-dark));box-shadow:0 8px 18px -6px color-mix(in srgb, var(--color-secondary) 55%, transparent)">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
</button>
```

Uses `--color-secondary` (the terracotta/red family) rather than introducing a new violet token — this is the same family the wax-seal motif on `/wait` already uses, so the seal reads as "press to create/seal something new," consistent with the app's own established visual language rather than the old static mockup's arbitrary violet.

### `/create` placeholder

`routes.create = (main) => renderPlaceholder(main, "New Character")` — identical construction to every other unbuilt screen this pass. No sheet, no form; per the confirmed answer, the seal jumps straight to this placeholder.

## Files touched

- `new_ui/index.html` — bottom nav markup (5-slot row: 4 tabs + seal), remove old Library/Community/Personas/Creations/Forum tab markup.
- `new_ui/js/router.js` — routes map, `NAV_ROUTES`, `currentRoute()` default, `setActiveNav()` (geometry-based ribbon + avatar-ring active toggle).
- `new_ui/js/boot.js` — call `applyAvatarRing()` after `ME` resolves (success and failure/logout paths both need it: failure clears to the default gradient since `ME` becomes `null`).
- `new_ui/js/app-session.js` or a new small `new_ui/js/nav-avatar.js` — home for `applyAvatarRing()`. Given it's a single ~8-line function with no state of its own, and `app-session.js` already owns `ME`/`api()`, it belongs there rather than a new file (avoids a one-function file for something this small; revisit if Account tab logic grows).

## Testing

No backend changes, so no `pytest` additions. Frontend verification via Playwright against the running `:3001` dev server (per this repo's established testing convention — never a second parallel instance):
- Navigating to each of `/explore`, `/chats`, `/studio`, `/account`, `/create` renders the correct placeholder label and moves/hides the ribbon correctly (hidden on `/create`, since it's outside `NAV_ROUTES`).
- Ribbon `left`/`width` after navigating to each of the 4 tabs matches that tab's actual `getBoundingClientRect()` (regression guard for the seal's fixed-width slot skewing the old percentage math).
- Account ring reflects `ME.accent_color`/`banner_color` when mocked/set, and falls back to the active app theme's accent (`--color-primary-light`/`-dark`, verified across at least two different `data-accent` presets) when absent.
- Both dark and light theme, since none of this should hardcode a literal color (existing project rule).
