# Remove Debug Theme Toggle, Keep and Polish Privacy Blur

## Goal

Both the top-right theme-cycle button and the privacy-blur button in `new_ui`'s global chrome were originally scaffolding ("the temporary top-right icon button... stands in for that Settings UI until it exists," per `CLAUDE.md`). Theme now has a full real home at `/settings-appearance`. Remove the theme button entirely. Privacy-blur is different: it's a quick "someone's looking at my screen in public" panic-button, not a settings preference — it must stay instantly reachable, one tap, no navigation. Keep it, just drop any leftover debug/temp framing.

## Theme-cycle button removal

- Delete `#tempThemeCycle` (`new_ui/index.html`).
- Delete `cycleTheme()` from `new_ui/js/theme.js` — it has exactly one caller (the button's `onclick`), safe to remove outright.
- Remove the `[data-theme-icon]` sun/moon-swap block inside `applyTheme()` (`new_ui/js/theme.js`, ~lines 62-63) — dead code once the icon element it targets no longer exists; `document.querySelector` returning `null` there was already a safe no-op, but removing the dead reference is cleaner than leaving it.
- `setThemeBase`/`setThemeAccent`/`setThemeOverride`/`resetCmdColorOverrides`/`clearThemeOverrides`/`applyTheme()` — the real API `AppearanceSettingsView` (`/settings-appearance`) already uses — are untouched. Theme switching remains fully functional, just reachable only through Settings now.

## Privacy-blur button: keep, repolish

- Stays in the same `<div class="fixed top-[58px] right-2 md:top-2 z-[9999] ...">` toolbar position in `new_ui/index.html`, same one-tap `onclick="cycleCensor()"` behavior — already fully implemented (`new_ui/js/app-session.js`'s `cycleCensor()`/`applyCensorToggleVisibility()`, persists via `store.set("censorMature", ...)`, already the same underlying state Settings' own "Privacy blur" toggle (`settingsView.togglePrivacy()`) reads/writes — confirmed no state duplication, this is one shared toggle with two access points by design, not two competing ones).
- Cosmetic-only change: update `data-tooltip`/`aria-label` from `"Censor mature content"` to `"Blur mature content"`, matching the wording already used for this same control in Settings, for consistency.
- No change to `applyCensorToggleVisibility()`'s existing gate (`btn.classList.toggle("hidden", !ME?.nsfw_allowed)`) — the button is already correctly hidden entirely for users who've never enabled mature content, since there's nothing for them to blur.

## What this spec does NOT cover

- No changes to `AppearanceSettingsView`/`/settings-appearance` itself.
- No changes to the "Enable mature content" (NSFW-allowed) toggle in Settings — a separate, permanent preference from privacy-blur, already correctly distinct in the existing code.
- No changes to `cycleCensor()`'s actual blur/persistence logic — purely a tooltip/label wording change plus the removal of its now-solo-occupied neighbor.

## Testing

- No JS test harness in this codebase (established convention) — verify via balance-check + live curl + Playwright: confirm `#tempThemeCycle` and `cycleTheme` are gone from served `index.html`/`theme.js`, confirm the privacy button still renders and toggles blur correctly for an NSFW-enabled test account, confirm `/settings-appearance` still functions unaffected (theme switching wasn't touched, but worth a regression check given `theme.js` was edited).
