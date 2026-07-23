# Multiplayer Chat (Co-op Roleplay Sessions)

## Goal

Let up to 8 people share one RPG-mode chat session against a single AI narrator — an AI-Dungeon-style co-op session, motivated by wanting to roleplay with a friend. Gated entirely behind a per-user experimental-features toggle so it ships with zero risk to the existing single-player experience: a session with no co-op participants behaves exactly as it does today, byte-for-byte.

## Non-goals (this pass)

Voice/video, spectator-only participants, transferring host role, a public browsable lobby, and any AI-side awareness of "which human said this" beyond attribution in the transcript. All explicitly deferred.

## Turn model

No fixed order — whoever acts first, acts. The moment any participant sends an in-character action, the composer locks for **every** participant (not just the sender) until the AI's reply finishes streaming; then it's open again to whoever acts first next. No action queue of any kind.

This is deliberate, not a simplification for its own sake: the existing memory pipeline (`retrieval.py`'s `_extract_turn_signal`/`remember()`) processes each turn strictly in order, extracting facts on the assumption that what came immediately before is still narratively true. A queued action that gets invalidated by the reply ahead of it in the queue would have its facts extracted against a reality that no longer holds. Keeping every turn strictly linear — one action, one reply, next action — preserves the same invariant the memory system already depends on for solo chat, just shared across a group instead of one person.

Coordination between players needs no new mechanism: the lock itself arbitrates (first to hit Send wins), and the existing OOC/offstage-band convention (`parsed.oocs` in `chat.js`) already lets players talk out-of-character inline if they want to. The dedicated party-chat channel below covers real-time coordination without overloading the story composer.

## Party chat (separate channel from the story)

A second, always-open channel, never locked, never touching `session.messages`, the LLM, or memory extraction — pure real-time chat between the humans in the session. Rendered as a slide-out panel or second tab within the session UI, not the same textarea as the story composer (overloading one input with two meanings is exactly the kind of ambiguity — "did that just get sent to the AI or not?" — this design avoids elsewhere). Persisted lightly (so a refresh doesn't lose the last few lines) via a new `party_chat_messages` table, but explicitly excluded from anything memory-related — it was never part of the story.

## Data model

New table `session_participants`:

```
session_participants
  session_id   TEXT NOT NULL, references chat_sessions.id
  user_id      TEXT NOT NULL, references users.id
  persona_id   TEXT             -- nullable, participant's chosen Mask; null = account name fallback
  role         TEXT NOT NULL    -- "host" | "member"
  joined_at    BIGINT NOT NULL
  PRIMARY KEY (session_id, user_id)
```

Max 8 rows per `session_id`, enforced at the invite-accept endpoint (reject once the 8th slot is taken).

`chat_sessions.messages` rows gain a `sender_user_id` column (nullable — null for assistant/narrator messages, matching the existing solo-chat shape where every message is implicitly "the" user's). The per-message `user_name`/`persona_avatar` fields the app already carries (originally for edit-history in solo chat) do double duty for multi-participant attribution — no new concept needed there, just populated per-sender instead of always the session owner.

New table `party_chat_messages` (`session_id`, `sender_user_id`, `content`, `created`) — separate from `chat_sessions.messages` on purpose, so nothing in the memory/retrieval code path ever has to know it exists.

`chat_service._own_session` changes from "session.user_id == caller" to "caller has a row in `session_participants` for this session" (or is the legacy sole owner, for every existing solo session that predates this feature and never gets a participants row).

## Invite & join

Two paths, both landing in `session_participants`:
- **Link invite**: host generates a signed, revocable join token (`POST /api/sessions/{id}/invite-link`). Anyone signed in who opens `/chats/{id}/join?token=...` and accepts joins immediately, capacity permitting.
- **Username invite**: host searches a user (reusing the existing creator-search pattern), `POST /api/sessions/{id}/invite/{username}` creates a notification (reusing the existing notifications inbox/bell) the invitee can accept or decline.

Both require picking a persona (or defaulting to account name) on accept, hotswappable afterward exactly like solo chat already allows any user to switch their own persona mid-session.

## Host permissions

The session creator is permanent host: only the host can generate/revoke invite links, send username invites, and remove a participant. No host-transfer in this pass (non-goal above). Every other participant is a plain member — same read/write access to the story and party chat, no elevated session-management rights.

## Real-time sync

New in-process pub/sub: a `dict[session_id, set[asyncio.Queue]]`, one queue per connected participant. New endpoint `GET /api/sessions/{id}/live` opens a long-lived SSE connection per participant, receiving broadcast events: `participant_joined`, `participant_left`, `message` (a new story action from anyone), `party_chat` (a new party-chat line), and `generating`/`done` (so every participant sees the same lock/unlock state, not just whoever triggered it). This is additive to the existing per-request chat-generation SSE stream (`POST /api/sessions/{id}/chat` etc.), which continues to stream the reply back to whoever's action triggered it exactly as today; the `/live` broadcast is what tells everyone *else* in the session the same thing happened.

## Mode restriction

Co-op sessions require an RPG-mode character. A GM-style third-person narrator naturally addresses a party ("the three of you enter the tavern"); first-person character mode assumes a single `{{user}}` and would read strangely with multiple humans in the scene. `POST /api/sessions/{id}/invite-link` and the username-invite endpoint both reject if the session's character isn't RPG mode.

## Feature gating (parity guarantee)

Everything above — every new endpoint, the new nav section, the invite UI — sits behind a new per-user boolean preference, `experimental_features_enabled` (stored alongside other simple per-user booleans like `nsfw_allowed`, not part of the `USER_CFG_KEYS` LLM-parameter overlay since it isn't a generation setting). Off by default for every account, including existing ones.

- **Settings**: a new toggle, "Enable multiplayer chat (experimental)", in Settings.
- **Nav**: when on, a new **Multiplayer** section appears (invisible otherwise) — this is the "make it a little annoying to reach" ask: no casual user stumbles into it, it's an opt-in discovered through Settings, not surfaced in the main Explore/Chats/Workshop flow.
- **Backend**: every new endpoint checks the caller's `experimental_features_enabled` flag and 404s if it's off, same posture as a feature that doesn't exist for that account yet.
- **Parity test**: a regression test asserts a solo session (zero `session_participants` rows) behaves identically whether the multiplayer code exists or not — same SSE event shape, same message shape, same memory extraction. This makes "solo chat is untouched" a checked fact, not just a claim.

## Memory extraction: per-participant attribution

`memory_service.py`'s `_transcript()` and `present_participants()` currently assume exactly one human per session — every user-role message is labeled with a single fixed `user_name` string, and `present_participants()` hardcodes `[user_name, char_name]`. Left as-is, a multiplayer session would silently blur every action under one name in the transcript fed to the extractor, corrupting fact attribution (not a crash — quietly wrong data, which is worse).

The fix mirrors a pattern this codebase already has on the character side: `_transcript()` already accepts a `names_by_id` dict (`char_id -> name`) to label each assistant line correctly for existing multi-character group sessions (`speaker = names_by_id.get(assistant_msg.get("char_id")) or char_name`). The same shape extends to the user side — `_transcript()` takes a `user_names_by_sender_id` dict (`sender_user_id -> participant display name`, sourced from `session_participants` joined with each participant's active persona) and looks up each user-role message's actual sender the same way it already looks up each assistant message's speaker, instead of a single fixed `user_name`. `present_participants()` takes the full list of currently-active participant names for that batch instead of one name, so `fact["participants"]` correctly reflects everyone actually present, not just whoever happens to hold the fixed `user_name` slot.

`build_system`/`prompt.py`'s prompt assembly needs the equivalent: each action attributed to its sender in the text fed to the model (e.g. "Mira: I push the door open" instead of a bare "I push the door open") — the model itself doesn't need new instructions beyond that, since RPG mode's existing third-person GM framing already expects to address whoever it's addressing, it just needs the transcript to actually say who's who.

## Testing

Backend: pytest for `session_participants` capacity enforcement (9th join attempt rejected), invite token validation/expiry, the solo-chat parity regression above, the SSE broadcast fan-out (a fake session with 2 subscriber queues, assert both receive the same event), and — given the real gap found above — a dedicated test asserting `_transcript()` and `present_participants()` correctly attribute a 2-participant batch's messages to their actual senders rather than collapsing onto one name. Frontend: no JS test harness (existing convention) — live Playwright with two authenticated browser contexts joined to the same session, confirming an action from one locks the composer in the other's tab and both see the same reply land, plus a party-chat message from one appearing in the other's panel without touching the story thread.
