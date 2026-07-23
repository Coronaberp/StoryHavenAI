# Admin Feature Kill-Switch Design

## Problem

There is no way for an admin to take a single module of the app offline for
maintenance without either leaving it broken (users hit real errors) or
taking the whole site down. The only existing precedent is image
generation's `media-gen-down` state (`new_ui/js/media-gen.js`,
`new_ui/css/app.css:8102-8107`) — but that's automatic, driven by a live
ComfyUI health check, not something an admin decides. There's no equivalent
for chat, LoRA training, comments, forum, or any other module.

## Scope boundary

Image generation is explicitly out of scope and unchanged. Its shutoff
reflects real infrastructure availability and applies to every role
including Dev. This design adds a second, parallel mechanism: an admin
*decision* to disable a specific module, which Dev bypasses (Dev is the one
testing the feature being worked on) but every other role — including
regular admins — sees exactly like a normal user would.

## 1. Feature keys

A fixed Python constant, `backend/feature_flags.py`:

```python
FEATURE_KEYS = {
    "chat": "Chat & Roleplay",
    "lora_training": "LoRA Training",
    "comments": "Comments",
    "forum": "Forum",
}
```

This is the single source of truth for what's toggleable. New toggleable
features are added here as code, not invented ad hoc through the admin UI.
The exact starting set of keys is chosen by whoever wires up each router in
the implementation plan — the mechanism doesn't hardcode which modules exist
beyond this dict.

## 2. Schema

New table, `backend/repositories/feature_flags.py` (new file, matching the
one-file-per-domain repository pattern):

```
feature_flags
  key             TEXT PRIMARY KEY   -- must be a FEATURE_KEYS key
  enabled         BOOLEAN NOT NULL DEFAULT true
  message         TEXT               -- admin's custom reason, nullable
  disabled_at     BIGINT             -- unix timestamp, set when flipped off
  eta_minutes     INTEGER            -- admin's estimated downtime, nullable
  updated_by      TEXT               -- admin user id who last changed it
  updated_by_name TEXT               -- admin's username at time of change, denormalized
  updated_by_role TEXT               -- "admin" or "dev" at time of change
  updated_ts      BIGINT NOT NULL
```

`updated_by_name` is denormalized (copied at write time, not joined at read
time) so the disabled-feature modal and notification text keep showing who
made the change even if that admin account is later renamed or deleted.

No row for a key means enabled (same "absence means default" convention as
the rest of this app's settings). A row only needs to exist once a key has
ever been toggled off at least once.

## 3. Backend enforcement

`backend/feature_flags.py` exposes a FastAPI dependency factory:

```python
def require_feature_enabled(key: str):
    async def _check(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") == "dev":
            return
        flag = await feature_flags_repo.get(key)
        if flag and not flag["enabled"]:
            raise HTTPException(status_code=503, detail={
                "feature": key,
                "label": FEATURE_KEYS[key],
                "message": flag["message"],
                "eta_minutes": flag["eta_minutes"],
                "disabled_at": flag["disabled_at"],
            })
    return _check
```

Each router adds `Depends(require_feature_enabled("chat"))` to the specific
routes that should be gated (mutating/action routes — e.g. sending a chat
message, starting a training job — not necessarily read-only routes like
listing existing sessions). 503 Service Unavailable is the status code:
distinct from 403 (permission) and 404 (not found), and matches "temporarily
down."

## 4. Frontend discovery

`GET /api/feature-status` (public, no auth barrier — the flag state itself
isn't secret) returns every currently-disabled flag, with one exception: if
the caller is a Dev, the endpoint returns an empty set, so the Dev's own
frontend never learns a flag is off and renders everything normally with no
client-side special-casing needed.

```json
{"chat": {"label": "Chat & Roleplay", "message": "...", "eta_minutes": 20, "disabled_at": 1234567890}}
```

Polled the same way `media-gen-status` already is — a new
`new_ui/js/feature-flags.js` module, 5-minute interval plus
visibilitychange-triggered refresh, mirroring `MediaGenAvailability`'s
existing `start()`/`refresh()` shape in `media-gen.js`.

## 5. Frontend rendering

Generalizes the existing single-purpose CSS class into one class per key:
`feature-disabled-<key>` added to `<html>` for each disabled flag. Any
element tagged `data-feature="<key>"` gets the disabled treatment via one
attribute-selector CSS rule scoped per key, plus the amber pulse animation
(section 8). Clicking a disabled element opens the same modal shape as
`MediaGenAvailability.showUnavailable()` (`media-gen.js:47-60`, built on the
existing `openModal()`/`closeTopModal()` helpers), populated with the
feature's label, the admin's custom message (falling back to a generic
"This feature is temporarily disabled" if blank), and a live countdown.

The countdown text ("back in ~N minutes") is computed client-side from
`disabled_at + eta_minutes * 60`, re-evaluated each time the modal opens and
once a minute while it stays open — not a static string baked in at fetch
time, so it stays accurate the longer a feature stays flagged off. If
`eta_minutes` is null, show "No estimated return time" instead of a
countdown. The modal also shows "Disabled by Dev/Admin `<updated_by_name>`"
(role-prefixed per section 14).

## 6. Admin UI

A new `new_ui/js/admin-features.js` panel (kept separate from
`admin-config.js` per this project's keep-files-small convention), listing
every `FEATURE_KEYS` entry with its current state, a per-row checkbox, and
two bulk-action buttons above the list: "Disable selected" and "Enable
selected" (each disabled/greyed until at least one row is checked, and each
only ever acts on rows whose current state matches the direction — you
can't "enable" an already-enabled row by selecting it). A single-feature
toggle is just the same flow with one row pre-checked — see section 13.
Reads/writes through new admin-only endpoints:

- `GET /admin/feature-flags` — list all keys with current state
- `PUT /admin/feature-flags/batch` — see section 13

## 7. Dev bypass

Already covered by sections 3 and 4: the backend dependency skips the check
entirely for `role == "dev"`, and the status endpoint hides disabled flags
from a Dev's own frontend. No other role gets a bypass, including regular
admins — an admin flips a switch for everyone else, but still experiences
the same disabled state as any other user unless they're also Dev.

## 8. Broadcast notification on toggle

New `notify_all_users(type, title, body, related_id, exclude_dev=True)` in
`backend/repositories/notifications.py`, mirroring the existing
`notify_admins()` loop-and-insert pattern (`notifications.py:33-46`) but
over active, non-Dev users (new `list_active_non_dev_user_ids()` in
`backend/repositories/users.py`, mirroring the existing
`list_admin_user_ids()` shape). Fired once per batch operation from the
`PUT /admin/feature-flags/batch` handler, after the state change actually
applies:

- On disable: `type="feature_disabled"`, `related_id` is a comma-joined list
  of the affected keys, title/body list every affected feature's label, the
  admin's message, the ETA if set, and the admin's own name (section 14).
- On re-enable: `type="feature_restored"`, same shape, listing every
  restored feature.

Dev users are excluded from both — they already see the feature working
normally, so a notification about it being "down" would be noise.

## 9. Notification click behavior

`notifications.js`'s click handler (`notifications.js:188-202`) currently
always navigates via the notification's `link` field, ignoring `type`. This
adds the first type-based branch: for `type === "feature_disabled"` or
`"feature_restored"`, clicking opens the same modal as section 5 (extended
to list multiple features when the notification covers a batch), populated
from the notification's own stored message/ETA/admin-name (not a fresh
`/api/feature-status` fetch) — so a `feature_restored` notification clicked
later still shows what happened, and an old `feature_disabled` notification
doesn't silently show current (possibly already-restored) state. Every
other existing notification type keeps today's navigate-on-click behavior
unchanged.

## 10. Amber animated disabled state

Reuses `--color-cmd-yellow` (`new_ui/css/themes.css:20` dark `#F5D76E`,
line 55 light `#8A6D00`) — already mode-aware and accent-preset-independent,
so it reads consistently regardless of the user's chosen accent color. New
CSS in `cards.css` (not hand-edited into the compiled `app.css`):

```css
[class*="feature-disabled-"] [data-feature] {
  cursor: not-allowed;
  outline: 1.5px solid var(--color-cmd-yellow);
  animation: feature-disabled-pulse 2.2s ease-in-out infinite;
}

@keyframes feature-disabled-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-cmd-yellow) 35%, transparent); }
  50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-cmd-yellow) 0%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  [class*="feature-disabled-"] [data-feature] {
    animation: none;
  }
}
```

Distinct on sight from image-gen's plain grey/desaturate treatment — reads
as "paused, coming back" rather than "broken."

## 11. Admin confirmation gate: a non-skippable 7-step wizard

Neither toggle direction applies from a single click or a single
confirmation. Clicking "Disable selected"/"Enable selected" (or a
single-row toggle, which is the same flow — section 13) launches a 7-step
wizard. No step can be skipped, closed, or dismissed early: the wizard
modal is opened with the new `dismissible: false` option (section 12), so
there is no close button, backdrop click, or Escape-to-close on any step
but the last. The only way out before the final step is that step's
explicit "Cancel" button, which aborts the entire operation — nothing is
applied, no notification sent, no partial state written.

**Disable wizard steps:**

1. **Selection review** — lists every feature about to be disabled.
   Requires checking "I have reviewed this list" before "Next" enables.
2. **Impact** — plain-language description of what breaks for users, per
   feature, from a new `FEATURE_IMPACT_DESCRIPTIONS` dict alongside
   `FEATURE_KEYS` (e.g. `"chat": "Users will be unable to send new
   messages in any chat, existing or new"`).
3. **Message + ETA entry** — one shared message/ETA for the whole batch.
   Leaving the message blank requires an explicit "leave blank, use
   generic message" toggle rather than silently accepting empty text.
4. **Type-to-confirm** — the admin must type the exact feature key (single)
   or a fixed batch confirmation phrase (multi-select), matched exactly,
   before "Next" enables.
5. **Who's unaffected** — shows the live count of Dev users who'll keep
   using every selected feature normally. Informational, single
   acknowledgement button.
6. **Broadcast warning** — states the real, live count from
   `list_active_non_dev_user_ids()`, fetched at this step: "This will
   immediately notify N active users."
7. **Final confirm** — explicit "CONFIRM SHUTDOWN" button plus "Cancel."
   Nothing is applied until this exact click; this is the step that fires
   `PUT /admin/feature-flags/batch`.

**Enable wizard steps** mirror this with adjusted copy: (1) selection
review of features being re-enabled, (2) what becomes available again,
(3) confirms any existing message/ETA on each selected feature will be
cleared, (4) type-to-confirm, (5) who already had it working normally
(Dev), (6) broadcast warning ("this notifies N users it's back"),
(7) "CONFIRM RESTORE" / "Cancel."

## 12. Non-dismissible modal support

`openModal()` (`new_ui/js/modal.js:5`) gains a `dismissible = true` option.
When `false`: the close (×) button isn't rendered, the backdrop-click
handler (`modal.js:19-21`) is a no-op, and the global Escape listener
(`modal.js:91-93`) checks the top stack entry's dismissible flag before
closing — added by storing `dismissible` alongside `layer`/`close` in
`_modalStack`. This is a strictly additive change (default `true` preserves
every existing caller's behavior unchanged); only the feature-kill-switch
wizard ever passes `false`.

## 13. Batch selection is the only code path

There is no separate single-feature toggle implementation. Checking one row
and clicking "Disable selected" runs the exact same wizard and the exact
same `PUT /admin/feature-flags/batch` endpoint as checking ten rows — the
batch size is just 1. This avoids maintaining two parallel toggle flows
(single vs. batch) that could drift out of sync.

`PUT /admin/feature-flags/batch` — admin-only, body:
```json
{"keys": ["chat", "lora_training"], "enabled": false, "message": "...", "eta_minutes": 20}
```
Applied atomically: all keys succeed together or none are changed. Returns
the updated rows. The handler is what triggers the single combined
broadcast notification (section 8) and stamps `updated_by`/`updated_by_name`
(section 14) on every affected row.

## 14. Attribution: who did this is visible everywhere

`updated_by`/`updated_by_name` (section 2) are written on every batch
apply, alongside a third column `updated_by_role` (`"admin"` or `"dev"`,
whichever the acting user held at the moment of the change). The
user-facing label is `"Dev"` when `updated_by_role == "dev"`, otherwise
`"Admin"` — surfaced in two places: the broadcast notification ("Dev `<name>`
disabled Chat & Roleplay and LoRA Training" / "Admin `<name>` disabled...")
and the disabled-feature modal a regular user sees when clicking a
greyed-out element ("Disabled by Dev `<name>`" / "Disabled by Admin
`<name>`", section 5). A Dev is still just an admin one tier up (per this
app's existing RBAC — every Dev is an admin in every other respect), so
this is purely a label choice, not a different permission path: the same
batch endpoint accepts the action from either role identically.

## Testing

- `backend/tests/test_feature_flags_repo.py` (new): CRUD for
  `feature_flags`, default-enabled-when-no-row behavior, batch apply
  atomicity (all-or-nothing on a partially-invalid key list).
- `backend/tests/test_feature_flags.py` (new, or wherever
  `require_feature_enabled` lives): Dev bypass, disabled-flag 503 with the
  correct detail shape, enabled-flag pass-through.
- `backend/tests/test_notifications_repo.py`: extend for
  `notify_all_users`, verifying Dev exclusion and the loop-and-insert
  pattern, following the existing `notify_admins` test shape.
- `backend/tests/test_users_repo.py`: extend for
  `list_active_non_dev_user_ids`.
- Frontend: no existing JS test harness covers `notifications.js`/
  `media-gen.js`-style modules in this project — manual verification against
  the live app (per this project's established browser-verification
  discipline), covering: a disabled feature's amber pulse rendering, modal
  countdown updating live, Dev's own view staying fully functional, every
  step of both wizard directions for both a single feature and a multi-row
  batch (including that Cancel at any step applies nothing and that no step
  before the last can be dismissed via backdrop/Escape/close button), and
  the broadcast notification appearing/click-opening the modal for a
  non-Dev test account with the correct admin attribution shown.

## Non-goals

- No arbitrary admin-defined flag keys — the set is fixed in code
  (`FEATURE_KEYS`).
- No change to image generation's existing, separate health-check-driven
  availability mechanism.
- No per-user or per-role granularity beyond the Dev bypass — a flag is
  either on for everyone (minus Dev) or off for everyone (minus Dev), not
  targeted at specific users/roles.
- No "back" navigation within the wizard — forward or cancel-the-whole-thing
  are the only two directions once a wizard is open.
- No scheduling ("disable this at 3pm") — toggles take effect immediately
  when confirmed.
