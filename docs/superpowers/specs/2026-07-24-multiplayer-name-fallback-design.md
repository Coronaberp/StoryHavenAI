# Multiplayer participant name fallback

## Problem

In a multiplayer session, any participant without a persona is named the
literal string "You" (`_resolve_sender_persona` in `backend/chat_service.py`).
With two or more persona-less players this makes speakers indistinguishable in
the transcript and to the model. Worse, the `other_player_names` list built for
the GM prompt skips persona-less participants entirely, so the model does not
know those players exist.

## Decision

A persona-less participant in a multiplayer session is named by their profile
display name, falling back to their login username. Solo sessions keep "You",
which is correct second-person there. Chosen over forcing persona selection at
join (friction) and over a per-session nickname column or auto-created
personas (new state for no gain). Renames propagate automatically because the
name is resolved at use time, never stored.

## Changes

One new plain function, the single source of truth for participant naming:

- `participant_display_name(row, user_row) -> str` in `backend/chat_service.py`
  (or a small helper module if chat_service is not importable from the
  multiplayer router without cycles): persona name if the row has a resolvable
  persona, else `user_row["display_name"] or user_row["username"]`.

Call sites updated to use it:

1. `_resolve_sender_persona` — when a participant row exists (multiplayer),
   return the resolved fallback instead of "You". The solo path (no
   participant rows) is unchanged.
2. The `other_player_names` loop in the chat generation path — include
   persona-less participants by resolved name instead of skipping them.
3. `GET /sessions/{sid}/multiplayer/participants`
   (`backend/routers/multiplayer.py`) — each row carries the resolved
   `name` so the UI shows the same name the story uses.

No schema changes. Existing messages already stamped with "You" are left
untouched.

## Edge cases

- Guests have generated usernames and resolve normally.
- Two accounts with the same display name can still be conflated by the
  model, same as two identically named personas today. Accepted.
- Host without a persona resolves the same way as members.
- A participant row pointing at a deleted persona falls through to the
  account-name fallback instead of "You".

## Tests

In `backend/tests/` following the existing multiplayer/chat_service patterns:

- Persona-less participant resolves to display name.
- Empty display name falls back to username.
- Solo session (no participant rows) still resolves to "You".
- `other_player_names` includes persona-less participants by resolved name.
- Participants endpoint returns the resolved name per row.
- Deleted-persona row falls back to the account name.

## Logging

No new phases; existing multiplayer logging is unchanged. The resolution
helper is pure and needs no log lines.
