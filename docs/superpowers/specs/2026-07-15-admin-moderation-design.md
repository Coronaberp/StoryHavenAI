# Admin panel — Moderation queue — new_ui design spec

## Context

Second sub-project of the Admin panel (see `docs/superpowers/specs/2026-07-15-admin-overview-users-design.md` for the six-way split and the first sub-project, Overview + Users & roles, already shipped on this branch). This spec covers `legacy_ui/js/admin-moderation.js`'s full scope: every actionable queue an admin has to clear.

## Scope

One new route, `admin-moderation` (`AdminModerationView` — `new_ui/js/admin-moderation.js`), following the exact `AdminOverviewView`/`AdminUsersView` pattern (role-gated at the route-handler level, same as the two existing admin routes). Linked from `/admin`'s attention banner (the Overview dashboard currently has no jump link there — this sub-project adds it) and from a new "Moderation" row on `/admin`.

Seven queues, each rendered as a titled section with its own row template and action buttons, matching legacy's `_admModQueue` pattern (a queue with zero items renders a small "nothing pending" message instead of an empty section):

1. **Pending signups** — `allUsers.filter(u => u.status === "pending")` (already fetched by `/admin`, re-fetched here via `GET /api/admin/users`). Approve → `POST /api/admin/users/{uid}/approve`. Deny → `POST /api/admin/users/{uid}/deny`.
2. **Flagged endpoints** — `GET /api/admin/flagged-endpoints`. Each row shows the flagged URL, the user who triggered it, the reason, and (if present) a raw detail/network-log blob in a scrollable `<pre>`. Allow → `POST /api/admin/flagged-endpoints/{fid}/allow`. Block → `POST /api/admin/flagged-endpoints/{fid}/block`.
3. **Password reset requests** — `GET /api/admin/password-reset-requests`. Approve → `POST /api/admin/password-reset-requests/{rid}/approve`. Deny → `POST /api/admin/password-reset-requests/{rid}/deny`.
4. **Model requests** — `GET /api/admin/model-requests`, filtered to `status === "pending" || status === "approved"` (matches legacy's deliberate choice: rejected requests are done and drop out, but approved-but-not-yet-fulfilled requests stay visible as an actionable "still need to download this" reminder, not just a permanent history). Approve → `POST /api/admin/model-requests/{rid}/approve`. Reject → `POST /api/admin/model-requests/{rid}/reject`. "Done" (dismiss an approved+fulfilled row) → `POST /api/admin/model-requests/{rid}/complete`. Dev-only: when `ME.role === "dev"` and a request is `approved`, show a "Copy curl" button that builds the same download-command string legacy's `admin-previews.js`/`admin-moderation.js` construct client-side from the row's `model_name`/`source_url`/`request_type`/`vae_url`/`text_encoder_url` fields plus any resolved API keys already present on the row (`resolved_api_key`/`resolved_vae_api_key`/`resolved_text_encoder_api_key`) — this is the one queue where the model-request-hosts-allowlist design (`CLAUDE.md`'s "Model requests" section) matters: never fetch `source_url` server-side, only ever hand the admin a copyable command.
5. **Title requests** — `GET /api/admin/title-requests`. Approve → `POST /api/admin/title-requests/{uid}/approve`. Reject → `POST /api/admin/title-requests/{uid}/reject`.
6. **Image reports** — `GET /api/admin/image-reports`. Each row shows the reported image thumbnail, claimed-vs-current explicit rating, and the reporter. "Review" opens a small modal (reusing `openModal`) with a toggle for the correct explicit rating and an optional admin note, submitting `POST /api/admin/image-reports/{report_id}/resolve` with `{is_explicit, admin_note}`.
7. **Content reports** — `GET /api/admin/content-reports`. Same shape as image reports minus the thumbnail-optional case (`cr.image` may be absent for non-image content reports). "Review" opens a modal with an explicit-rating toggle, submitting `POST /api/admin/content-reports/{report_id}/resolve` with `{is_explicit}`.

An `attentionTotal` header (sum of all seven queues' item counts) is shown at the top, matching legacy's `adash-h2` + count badge.

**No backend changes.** Every endpoint above already exists and is already tested.

## Data flow & error handling

On mount, `Promise.all` across all seven list endpoints plus `GET /api/admin/users` (for the pending-signups queue), each `.catch(() => [])` individually so one failing endpoint doesn't blank the whole screen — same defensive pattern as `AdminOverviewView`. Every action button: confirm-if-destructive (deny/reject/block are not destructive in the data-loss sense, so no `confirm()` needed — they're routine queue-clearing actions, matching legacy's lack of a confirm dialog on any of these buttons), call the endpoint, `toast()` on success, `errorToast(e.message)` on failure, re-fetch the affected queue (or the whole screen — simplicity over partial refresh, matching every other admin/settings screen's established pattern) and re-render.

Every user-controlled string (usernames, flagged-endpoint URLs/reasons/detail blobs, report notes, request notes/model names) goes through `_esc()`/`_attr()` for its context — the same discipline this codebase has had to fix twice already this session. The flagged-endpoint detail blob and model-request `source_url` are both untrusted external data (the URL a user's own client reported, or a source URL a user typed in) and need the same treatment as any other field, not an exception.

## Testing

No backend changes — every consumed endpoint already exists and is already tested. No JS unit-test harness exists in `new_ui/`; verification is manual/Playwright against the running `:3001` dev server, logging in as the `claude` admin account. Verification must NOT create new user accounts (per this session's established constraint — CLAUDE.md's "DO NOT CREATE NEW ACCOUNTS" is enforced strictly, including for throwaway admin-panel test data); where a queue needs a live item to act on (e.g. approving a pending signup), verification is limited to confirming the screen renders the queue correctly and that the button wiring calls the right endpoint with the right body shape (inspectable via Playwright's network interception, e.g. `page.expect_response(...)`), without necessarily completing a real state-changing action against production data unless a genuinely empty/safe-to-mutate queue item exists.
