# Group chats — design spec

Multi-character conversations in one session. Additive to the existing single-character chat: a split-and-route pass in front of the existing `_run`, not a rewrite. Legacy 1:1 chats are a cast of one.

## Rules (agreed)

- **Character-mode only.** RPG/GM characters cannot join a group — RPG mode is already a one-bot group, a different implementation. The cast picker filters to `mode == "character"`.
- **The director picks the fitting voices — one or several, never the whole cast.** Explicit `@name`/name mentions win (all mentioned reply, in mention order). Otherwise one side-LLM call returns whoever would react, skipping muted seats and (for dialogue) the narrator.
- **Dialogue vs action split.** Each speaker's raw output is split: quoted `"..."` text is dialogue → that speaker's bubble; everything else is action → folded into the Narrator's prose, prefixed with the actor's display name. This applies to characters **and** the player/persona.
- **Narrator seat.** A GM seat that owns all action/scene narration. Character bots emit dialogue only; the Narrator emits action/scene, never a character's voice. All narrator prose (standalone beats and folded action) renders centered like a command break, no header label.
- **Mood → pfp.** `parse_mood` already strips `[mood:X]`; in a group it swaps the speaking character's displayed pfp (expression variant). Never shown as a tag.
- **Reassign on regen.** Regenerating a reply lets the user force a different speaker; the whole turn group (bubble + folded action) is re-rendered as the chosen character.
- **Add a voice.** Present characters who didn't auto-reply are offered as chips to pull into the same turn.
- **Commands render inline, no action tray.** The full sigil set (scene / time / note / roll / as / ooc), both leading `/cmd` and inline `{cmd: args}`, renders exactly like 1:1 chat **except** there is no collapsible action tray in a group — cards render inline, in a centered row. `roll` is narrated as a story beat (`{{actor}} rolls for <label>.`) above its result card. The **only** toggle is Hide-OOC, which hides OOC cards.
- **Follows user formatting.** Each responder's generation reuses the exact same effective-config assembly the single-char `_run` applies — response-length preset, style prompt, scene format (`scene_style`), prose guards, `system_suffix`/`post_history`, thinking, author's note, and the resolved chat language. A group reply is formatted identically to a 1:1 reply for that user; only the cast block and dialogue/action split are added on top.
- **Localization consistent.** Narrator prose and folded action are story content in the session chat language (like every reply). New UI chrome uses `t()` / `UI_STRINGS` + the admin resync. Attributed names are proper names, never translated. RTL mirrors the thread; folded prose stays name-first.

## Creation

- **Entry points:** a "Create new group" button in **Explore** and on the user's **own profile/dossier page**. It opens a selectable-character-cards picker modeled on the forge model-picker (multi-select cards).
- **Cast:** add **up to 10** characters (`mode == "character"` only).
- **Editable fields are exactly two:** the **group name** and the **opening message**. Nothing else is configurable at creation (no per-character greeting, style, persona-per-char, etc.).
- **Greeting:** each character's own opening greeting is **ignored** in a group. The group's single opening message is seeded as the first (assistant/narrator) message and is the only greeting.

## Data model (additive)

- New table `session_characters(id, session_id, char_id, position, muted, is_narrator, added)`, unique on `(session_id, char_id)`.
- `messages.char_id` — which cast member spoke (null = the player / legacy single-char).
- `messages.turn_group` — ties a multi-voice turn's rows (bubble + folded action) together for reassign.
- `sessions.is_group` — 0 for legacy; 1 for a group. `sessions.char_id` stays as the primary/first cast member for backward compatibility with all code reading `s["char_id"]`.

## Flow

1. **User sends.** Persist as a normal user message (unchanged path).
2. **Split the player output** — quotes → the user bubble, action → a Narrator turn prefixed "{{user}} …".
3. **`next_speaker()`** — `group.mentioned_speakers()` (pure) first; if none, the LLM director scores who reacts. Returns an ordered list, capped, excluding muted (and the narrator for dialogue).
4. For each responder: `build_system` with a dialogue-only instruction + an "others present" cast block; stream via the same SSE `_run`; split the reply (quotes → bubble tagged `char_id`, action → narrator); each reply in the group sees the ones before it. Same `turn_group`.
5. **Mood → pfp**, **reassign** re-rolls a turn group as a chosen char, **add-a-voice** appends another present character into the same `turn_group`.

## Modules

- `backend/group.py` — pure helpers: `split_speech(raw) -> (dialogue, action)`, `mentioned_speakers(text, cast) -> [cast]`. No I/O.
- `backend/repositories/session_characters.py` — cast CRUD.
- `backend/chat_service.py` — `next_speaker` (LLM director) + the group turn loop wrapping `_run`.
- `backend/prompt.py` — cast block + dialogue-only / narrator prompt variants.
- `backend/routers/sessions.py` — create-group + add/remove/mute participant endpoints.
- `new_ui/js/chat.js` — roster, per-message char attribution, centered narrator prose, split rendering, inline command cards + Hide-OOC, reassign, add-a-voice, mood→pfp.
- `new_ui/js/translations.js` — new `UI_STRINGS` keys.
