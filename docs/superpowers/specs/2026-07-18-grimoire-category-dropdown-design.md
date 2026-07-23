# Grimoire category dropdown + user-scoped global lore — design

**Date:** 2026-07-18 (extended same day per follow-up direction)
**Scope:** `new_ui/js/grimoire.js` entry modal + flow, plus backend changes for user-scoped global lore.

## Extension: user-scoped global lore

Global lore belongs to a *user*, not the whole site, and is not admin-gated:

- `lore.owner_id` column (set only on `char_id IS NULL` rows), added via the `ALTER TABLE ... IF NOT EXISTS` migration pattern.
- `POST /api/lore/global` — any user creates a global entry owned by them. The old admin-only `is_global` flag on the per-character create route is ignored.
- Wherever lore is resolved (`list_for_character`, `db.list_lore` → chat retrieval / imagegen appearance lookup, `/api/lore/mine`, session lore), global entries are filtered to the requesting viewer / session owner. No viewer → no global entries.
- Edit/delete/persona-toggle of a global entry: its owner (or admin) — one shared `_require_can_edit` helper in the router.
- `POST /api/lore/media` — user-scoped image upload for global entries (per-character media endpoint requires a character).
- Frontend: the add-entry flow opens a scope picker first ("Global — all your characters" / "A specific character"); the admin Global checkbox in the edit modal is gone; global entries are labeled "Global" in listings; image upload/save endpoints switch on scope. The category dropdown uses the app's `customSelectHtml`/`wireCustomSelect` themed component instead of a native `<select>`.

Legacy ownerless global rows (admin-created before this change): not visible to anyone; per user direction there are none worth migrating.

## Goal

Replace the free-text Category input in the Grimoire entry modal with a dropdown, with a "Custom…" option that reveals a free-text field below it. Mobile-first: a native `<select>` gets the OS-native picker on mobile, which is exactly the right control here — no custom dropdown widget.

## Behavior

- The `#gCategory` text input becomes a native `<select id="gCategory">` styled with the existing `.grimoire-field-input` class.
- Options, in order:
  1. `""` → "Uncategorized"
  2. Presets: Character, Location, Item, Faction, Event, World
  3. Any other categories already used in this lorebook (sourced from the already-loaded entries array, deduped case-insensitively against the presets and each other, sorted alphabetically)
  4. `__custom__` → "Custom…"
- Selecting "Custom…" shows a text input `#gCategoryCustom` (same field styling, placeholder "Type a category") directly below the select. Selecting anything else hides it and clears its value.
- A single `categoryValue()` helper resolves the effective value: the trimmed custom field text when the select is on `__custom__`, else the select's value. `collectDraftFields()`, the save body, and `updateUsableAsPersonaVisibility()` all call it.
- The "usable as persona" row visibility listens to the select's `change` and the custom field's `input` (replacing the old single `input` listener).
- On open (edit or autosave-restored draft): if the entry's category matches an option case-insensitively, preselect that option; otherwise select `__custom__`, show the custom field, and put the value there. Empty category preselects "Uncategorized".

## Testing

No JS test harness exists in this project for `new_ui/`; verification is manual against the live app (create with preset, create with custom, edit preserves an unusual category via the custom field, persona-row toggles when Character is picked, mobile viewport shows the native picker).
