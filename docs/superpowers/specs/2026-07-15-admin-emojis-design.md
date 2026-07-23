# Admin panel — Emoji/sticker moderation — new_ui design spec

## Context

Fourth sub-project of the Admin panel (see `docs/superpowers/specs/2026-07-15-admin-overview-users-design.md` for the six-way split; sub-projects 1-3 already shipped). Covers `legacy_ui/js/admin-emojis.js`'s scope: managing custom emoji/stickers, including the mandatory manual review queue for animated GIFs (the NSFW classifier only sees one static frame, so animated uploads always land in review regardless of what it scores).

## Scope

One new route, `admin-emojis` (`AdminEmojisView` — `new_ui/js/admin-emojis.js`), role-gated identically to the other admin routes, linked from `/admin`.

- **Add new** (admin upload — goes live immediately, no review hold, per `POST /api/emojis` with an admin session already bypassing the pending-review path server-side): shortcode text input, kind select (emoji/sticker), file picker, Add button → `POST /api/emojis` with `FormData` (`shortcode`, `kind`, `file`). Legacy's "🎨 Generate with AI" button (opening an image-gen picker) is dropped from this sub-project's scope — `new_ui/` has no equivalent picker component yet; file upload only.
- **Pending review queue** (`allEmojis.filter(e => e.is_explicit)`, from `GET /api/admin/emojis`): each card shows the real (unblurred, since `admin_view=true`) image, shortcode, kind, uploader. Two actions: Approve (`POST /api/admin/emojis/{eid}/approve`) or Delete (`DELETE /api/emojis/{eid}`) — legacy's separate "review modal" is simplified to these two direct actions on the card, since the backend only exposes approve/delete, no other review-specific state.
- **Approved queue** (`allEmojis.filter(e => !e.is_explicit)`): each card shows image, shortcode, kind, uploader, and Edit (opens a small modal to change shortcode/kind, `PATCH /api/admin/emojis/{eid}`) / Delete actions. Legacy's "zoom preview" tool button is dropped — the card's own thumbnail is already the full unblurred image via `admin_view=true`, a separate zoom affordance adds little value without a lightbox component this project doesn't have yet.

**No backend changes.** Every endpoint above already exists and is already tested.

## Data flow & error handling

On mount, fetch `GET /api/admin/emojis` once, split client-side into pending/approved by `is_explicit`. Every mutation (approve/delete/edit/add) re-fetches the full list and re-renders — same pattern as every other admin screen this session. Every user-controlled string (`shortcode`, `uploader_username`) goes through `_esc()`/`_attr()` for its context.

## Testing

No backend changes. No JS unit-test harness; Playwright verification against the running `:3001` server logging in as `claude`. Verification does not create a new user account; it may exercise the real add-emoji upload/edit/delete cycle against a genuinely new, admin-created throwaway emoji (not a user account — this project's no-new-accounts rule is specifically about login credentials, not content records), cleaning it up via delete at the end of verification.
