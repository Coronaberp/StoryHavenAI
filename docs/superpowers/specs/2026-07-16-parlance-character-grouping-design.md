# Parlance: Group Conversations by Character

## Goal

Restructure Parlance's flat conversation list into collapsible per-character groups, so a user with many conversations with the same character (or many different characters) can scan by who they've been talking to rather than a single undifferentiated timeline.

## Grouping

`bodyHtml()` groups `visibleSessions()` by `char_id` (sessions with no resolvable character — e.g. a deleted character — fall back to grouping by their own `title`, one group per distinct title, so no session is ever dropped from the list). Within each group, sessions sort newest-first by `s.updated`. Groups themselves sort by their own newest session's `updated` timestamp, newest group first — the character you talked to most recently sits at the top regardless of how many total conversations you have with them.

## Collapse state

`ParlanceView` gains `this.collapsed = new Set()` (keyed by `char_id`, or the fallback title-group key for characterless sessions). Every group starts collapsed the first time it's seen — added to the set on first render after `mount()`. A group header row (avatar, name, conversation count, chevron) toggles membership in the set on click and re-renders.

Collapse state persists across re-renders within the same view instance (typing in search, adding/removing a filter pill) but resets to all-collapsed on a fresh `mount()` (navigating away and back).

## Search/filter interaction

When `this.q` or `this.charFilters` is non-empty, any group containing at least one session that matches the active filter force-expands for that render, regardless of its stored collapsed state — so a search never hides its own results behind a collapsed group. With no active search, groups render exactly per the stored `this.collapsed` set.

## Rendering

- Reuses the existing `rowHtml()` for individual session rows unchanged (avatar, preview text, delete button, relative timestamp) — no changes to that function.
- New `groupHeaderHtml(charId, name, avatar, count)` renders the character's seal/avatar, name, a small "N conversations" count, and a chevron icon that rotates via a CSS class toggle (matching the existing rotate-on-open pattern already used elsewhere in `new_ui`, e.g. Sanctum's/Forge's collapsible sections) — reuses existing typography/spacing tokens, no new CSS variables needed.
- Empty state (zero sessions at all) and no-search-results state are unchanged from the current implementation.

## What this spec does NOT cover

- No backend changes — `/api/sessions` already returns everything needed (`char_id`, `updated`, `preview`, `title`).
- No changes to `rowHtml()`, `confirmDelete()`, or `deleteSession()` — session-level actions are untouched.
- No changes to the search/filter pill UI itself (`@character` filtering, backspace-removal) beyond making it aware of the new grouped structure for the auto-expand behavior above.
- No persistence of collapse state across a full page reload/re-mount — every fresh visit to Parlance starts fully collapsed, per the approved design.

## Testing

- No JS test harness in this codebase (established convention) — verification via balance-checks + live Playwright checks against the running dev server: confirm groups render collapsed by default, expand/collapse toggles correctly, groups and within-group sessions are ordered newest-first, and an active search force-expands only matching groups.
