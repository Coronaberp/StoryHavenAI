import re
import json
import hashlib
import asyncio

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from backend import db
from backend import llm
from backend import live_broadcast
from backend.state import CFG, log, _sanitize_exc, USER_CFG_KEYS
from backend.ssrf import _resolve_host_ip_issue
from backend.repositories import flagged_endpoints as flagged_endpoint_repo
from backend.repositories import characters
from backend.repositories import personas
from backend.repositories import chat_sessions
from backend.repositories import session_participants
from backend.repositories import session_characters as session_char_repo
from backend.repositories import users as user_repo
from backend import group
from backend.retrieval import retrieve
from backend import memory_service
from backend import guest_quota
from backend.prompt import (build_system, think_instruction, strip_think, macro,
                    recent_text, ensure_scene_header, strip_sigil, strip_leaked_sigil,
                    LEGACY_DIRECTIVE_RE, DIRECTOR_SIGIL, strip_ai_prose_artifacts, EXPLICIT_INSTRUCTIONS,
                    reply_matches_language_script, cast_block)
from backend.sampling import build_sampling_params, RESPONSE_LENGTH_PRESETS
from backend.mood import character_moods, parse_mood

def _eff_cfg(user_overrides: dict) -> dict:
    return {**CFG, **{k: v for k, v in user_overrides.items()
                      if k in USER_CFG_KEYS and v is not None}}

def _persona_switch_note(msgs: list[dict], char_name: str) -> str | None:
    user_turns = [m for m in msgs if m["role"] == "user"]
    if len(user_turns) < 2:
        return None
    current_name = user_turns[-1].get("user_name")
    previous_name = user_turns[-2].get("user_name")
    if not current_name or not previous_name or current_name == previous_name:
        return None
    return (f"# Sudden change of speaker\n{current_name} is speaking below, not {previous_name}, "
            f"who {char_name} was just addressing. Do not treat this as {previous_name} continuing "
            f"— react as {char_name} reasonably would to a different person suddenly speaking or "
            f"interjecting, based only on what {char_name} actually knows about {current_name} "
            "(established lore, an earlier introduction in this story, or otherwise) — a total "
            "stranger if nothing establishes them as known.")

async def _endpoints(user_overrides: dict, user_id: str | None = None,
                     is_admin: bool = False) -> dict:
    chat_base = (user_overrides.get("base_url") or "").strip() or None
    chat_key = user_overrides.get("api_key") if chat_base else None
    if chat_base:
        issue = await _resolve_host_ip_issue(chat_base, is_admin)
        if issue:
            log.warning("endpoint guard: user=%s base_url=%s now unsafe (%s) — falling back to global",
                        user_id, chat_base, issue)
            if user_id:
                await flagged_endpoint_repo.create(user_id, chat_base, chat_key or "",
                                                   f"became unsafe at request time: {issue}")
            chat_base, chat_key = None, None
    return {
        "chat_base": chat_base,
        "chat_key": chat_key,
        "embed_base": None,
        "embed_key": None,
    }

def _ui_language(user_overrides: dict) -> str:
    return (user_overrides.get("interface_language") or "").strip() \
        or (CFG.get("default_language") or "").strip() or "English"

def _chat_language(session: dict, user_overrides: dict) -> str:
    return (session.get("language") or "").strip() or _ui_language(user_overrides)

async def _own_session(sid: str, current_user: dict) -> dict:
    s = await chat_sessions.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    if s.get("user_id") == current_user["id"]:
        return s
    if await session_participants.is_participant(sid, current_user["id"]):
        return s
    raise HTTPException(404, "session not found")

async def _resolve_sender_persona(s: dict, current_user: dict | None) -> tuple[dict | None, str]:
    if current_user:
        rows = await session_participants.list_for_session(s["id"])
        if rows:
            row = next((r for r in rows if r["user_id"] == current_user["id"]), None)
            if row and row.get("persona_id"):
                persona = await personas.get(row["persona_id"])
                if persona:
                    return persona, persona["name"]
                return None, "You"
            if row:
                return None, "You"
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
    user_name = (persona["name"] if persona else None) or s.get("user_name") or "You"
    return persona, user_name

class GenHandle:
    def __init__(self, sid: str):
        self.sid  = sid
        self._buf: list[str] = []
        self._subs: list[asyncio.Queue] = []
        self.done = False
        self.task: asyncio.Task | None = None

    def emit(self, raw: str):
        self._buf.append(raw)
        for q in self._subs:
            q.put_nowait(raw)
        if raw.startswith("data: "):
            try:
                parsed = json.loads(raw[len("data: "):].strip())
            except ValueError:
                parsed = None
            if parsed and parsed.get("type") == "delta":
                live_broadcast.broadcast(self.sid, "delta", {"content": parsed.get("content", "")})

    def finish(self):
        self.done = True
        for q in self._subs:
            q.put_nowait(None)
        if _active_gen.get(self.sid) is self:
            _active_gen.pop(self.sid, None)
        live_broadcast.broadcast(self.sid, "done", {})

    async def stream(self):
        for item in self._buf:
            yield item
        if self.done:
            return
        q: asyncio.Queue = asyncio.Queue()
        self._subs.append(q)
        try:
            while True:
                item = await asyncio.wait_for(q.get(), timeout=600)
                if item is None:
                    break
                yield item
        except asyncio.TimeoutError:
            log.warning("generation stalled with no event after 600s: sid=%s", self.sid)
            yield "data: " + json.dumps({"type": "error",
                                         "message": "generation stalled — no response after 10 minutes"}) + "\n\n"
        finally:
            try:
                self._subs.remove(q)
            except ValueError:
                pass

_active_gen: dict[str, GenHandle] = {}

def _extract_memory_in_background(sid: str, coro) -> None:
    async def _run():
        try:
            await coro
        except Exception as e:
            log.warning("memory extraction failed in background: session=%s error=%s", sid, e)
    asyncio.create_task(_run())

def _start_gen(sid: str, coro_fn, *args, **kwargs):
    old = _active_gen.pop(sid, None)
    if old and old.task and not old.task.done():
        old.task.cancel()

    handle = GenHandle(sid)
    _active_gen[sid] = handle

    async def _wrap():
        try:
            async for raw in coro_fn(*args, **kwargs):
                handle.emit(raw)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.error("generation task failed: sid=%s error=%s", sid, exc)
            handle.emit("data: " + json.dumps({"type": "error", "message": str(exc)}) + "\n\n")
        finally:
            handle.finish()

    handle.task = asyncio.create_task(_wrap())
    return handle

def _glossary_note(glossary: dict | None) -> str:
    if not glossary:
        return ""
    pairs = "; ".join(f"{k} → {v}" for k, v in list(glossary.items())[:200])
    return (f" Glossary — the player has pinned these renderings; use them exactly, "
            f"every single time, over any other choice: {pairs}.")

def _src_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

async def _localize_texts(texts: list[str], target_language: str) -> list[str]:
    lang = target_language.strip().lower()
    hashes = [_src_hash(t) for t in texts]
    cached = await db.get_localizations(list(set(hashes)), lang)
    return [cached.get(h, t) for t, h in zip(texts, hashes)]

MAX_GROUP_RESPONDERS = 3

def _parse_id_list(text: str, valid: set[str]) -> list[str]:
    match = re.search(r"\[.*\]", text or "", re.S)
    if not match:
        return []
    try:
        arr = json.loads(match.group(0))
    except (ValueError, TypeError):
        return []
    seen: list[str] = []
    for item in arr:
        if isinstance(item, str) and item in valid and item not in seen:
            seen.append(item)
    return seen

_ADDRESS_ALL_RE = re.compile(
    r"\b(everyone|everybody|you all|all of you|you guys|y'?all|folks|guys)\b|@all|@everyone", re.IGNORECASE)

async def next_speaker(cast, user_text, last_speaker_id, recent, model, ep) -> list[str]:
    speakers = [c for c in cast if not c.get("is_narrator") and not c.get("muted")]
    if not speakers:
        return []
    if _ADDRESS_ALL_RE.search(user_text or ""):
        return [c["char_id"] for c in speakers]
    mentioned = group.mentioned_speakers(user_text, speakers)
    if mentioned:
        return [c["char_id"] for c in mentioned]
    if len(speakers) == 1:
        return [speakers[0]["char_id"]]
    roster = "\n".join(f"- {c['char_id']}: {c.get('name') or c['char_id']}" for c in speakers)
    director_prompt = [
        {"role": "system", "content":
         "You are a turn director for a group roleplay. Given the recent scene and the latest line "
         "from the user, decide which characters would naturally respond right now. Pick only those "
         "with a real reason to react — one, or a few, never all of them unless truly warranted. "
         "Reply with ONLY a JSON array of their ids, most-relevant first, e.g. [\"aurelia\",\"bram\"]."},
        {"role": "user", "content":
         f"Cast:\n{roster}\n\nRecent scene:\n{recent}\n\nLatest from the user:\n{user_text}\n\n"
         "Which ids respond? JSON array only."},
    ]
    out = ""
    try:
        async for channel, txt in llm.chat_stream(
                director_prompt, model, {"temperature": 0.3, "max_tokens": 80},
                parse_think=False, base_url=ep["chat_base"], api_key=ep["chat_key"], pin_host=True):
            if channel == "content":
                out += txt
    except Exception as e:
        log.warning("group director call failed, using fallback: %s", _sanitize_exc(e))
    ids = _parse_id_list(out, {c["char_id"] for c in speakers})
    if not ids:
        pool = [c["char_id"] for c in speakers if c["char_id"] != last_speaker_id] or \
               [c["char_id"] for c in speakers]
        ids = [pool[0]]
    return ids[:MAX_GROUP_RESPONDERS]

def _assemble_system(char, s, persona, user_name, mode, language, do_think, eff, block, full_system,
                     is_multiplayer=False, other_player_names=None):
    system = build_system(char, persona, user_name, mode, language=language, full=full_system,
                          is_multiplayer=is_multiplayer, other_player_names=other_player_names)
    system += ("\n\n# Story context\n"
               "Everything below is what you actually know: established world facts, ongoing "
               "conditions, and things recalled from earlier in this story, plus the recent "
               "conversation itself. If something isn't in either, you don't clearly know or "
               "remember it — respond with in-character uncertainty rather than inventing shared "
               "history, past conversations, world details, or prior meetings.\n\n"
               + (block or "(nothing notable recalled this turn)"))
    known_names = json.loads(s.get("known_names") or "[]")
    if known_names:
        system += ("\n\n# Established characters — do not forget\n"
                   "These named characters have already been introduced in this story: "
                   + ", ".join(known_names) + ". Keep their names, identities, and established traits "
                   "consistent — never forget them, rename them, or contradict earlier facts about them, "
                   "even if they haven't appeared in the recent conversation. Spell every one of these "
                   f"names exactly as given here, in their original script, even though the rest of your "
                   f"prose is in {language} — do not transliterate them.")
    if do_think:
        system += "\n\n" + think_instruction(language)
    if eff.get("system_suffix"):
        system += "\n\n" + macro(eff["system_suffix"], char["name"], user_name)
    style_prompt = strip_sigil(s.get("style_prompt") or "").strip()
    if style_prompt:
        system += "\n\n# Response Style\n" + style_prompt
    length_preset = RESPONSE_LENGTH_PRESETS.get(s.get("length_key") or "epic", RESPONSE_LENGTH_PRESETS["epic"])
    if length_preset["instruction"]:
        system += "\n\n# Response Length\n" + length_preset["instruction"]
    if eff.get("scene_style"):
        system += ("\n\n# Scene format\n"
                   "Begin every reply with a scene header of three separate lines, each inside "
                   "backticks exactly like this:\n"
                   "`DATE: <in-story date>`\n`TIME: <in-story time>`\n`LOCATION: <current place>`\n"
                   "Keep the header consistent with the story's established timeline and advance it "
                   "as time passes. Additionally, where it adds insight, reveal a present character's "
                   "inner voice on its own line formatted as: **<Name>'s thoughts 💭:** *<one or two "
                   "short sentences in first person>* — never the player's thoughts.")
    return system, length_preset

async def _group_reply_events(s, cid, chars_by_id, cast_rows, working, eff, ep, chat_model,
                              persona, user_name, language, do_think, turn_group, query, viewer_id,
                              chat_mode=False):
    sid = s["id"]
    char = chars_by_id.get(cid)
    if not char:
        return
    others = [{"name": chars_by_id[o["char_id"]]["name"]}
              for o in cast_rows if o["char_id"] != cid and not o.get("is_narrator")
              and o["char_id"] in chars_by_id]
    keyword_lore, _rerr = await retrieve(char["id"], sid, query, recent_text(working), viewer_id=viewer_id)
    block, _u, meta_lore_lines, meta_memory_lines = await memory_service.retrieve_block(
        s, char, user_name, query, working, eff, keyword_lore, viewer_id=viewer_id,
        embed_base=ep["embed_base"], embed_key=ep["embed_key"])
    assistant_turns = sum(1 for m in working if m["role"] == "assistant")
    full_system = (assistant_turns % 4 == 0)
    system, length_preset = _assemble_system(char, s, persona, user_name, "character",
                                             language, do_think, eff, block, full_system)
    if others:
        system += "\n\n" + cast_block(char["name"], others)
    if chat_mode:
        system += ("\n\n# Shared scene\n"
                   "You and the others are together in ONE shared text chatroom with the user — "
                   "not physically in the same place, just chatting by message. Ignore the solo "
                   "physical setup on your character card: there is no room, no gestures, no "
                   "distance. You are all reachable in the same chat right now.")
    else:
        system += ("\n\n# Shared scene\n"
                   "You are together with the others in ONE shared scene, established by the opening "
                   "message and the conversation so far — not the solo setup on your character card. "
                   "Treat that shared scene as the current reality: adopt its location, time, and "
                   "situation, and stay consistent with where the others already are. Your card's "
                   "original standalone scenario tells you who you are, not where everyone is now — if "
                   "the shared scene places the group somewhere, you are there with them.")
    history = working[-eff["history_turns"]:]
    oai = [{"role": "system", "content": system}] + \
          [{"role": m["role"],
            "content": strip_think(m["content"]) if m["role"] == "assistant" else m["content"]}
           for m in history]
    if chat_mode:
        oai.append({"role": "system", "content":
                    f"Reminder: think and write only in {language}. You are {char['name']}. This is a "
                    f"live TEXT CHAT — reply as {char['name']} would type or say: spoken words only, a "
                    "natural chat message. Do NOT write any actions, gestures, expressions, narration, "
                    "or scene description, and never narrate the others. Only what "
                    f"{char['name']} actually says. Keep proper names in their original script."})
    else:
        oai.append({"role": "system", "content":
                    f"Reminder: think and write only in {language}. You are {char['name']}. "
                    f"Put {char['name']}'s spoken words in double quotes. Write {char['name']}'s OWN "
                    f"actions, gestures, and expressions in the THIRD person as a narrator would — refer "
                    f"to {char['name']} by name or as she/he/they, never in the first person (no 'I', "
                    f"'my', 'me' outside quoted dialogue). You MAY act toward and interact with the "
                    f"others — tease, touch, address, or provoke them (e.g. \"{char['name']} ruffles "
                    f"their hair\") — but only ever author {char['name']}'s own action: never write the "
                    f"other characters' or {user_name}'s replies, dialogue, reactions, feelings, or "
                    "thoughts. They respond for themselves. Keep proper names in their original script."})
    author_note = strip_sigil(s.get("author_note") or "").strip()
    if author_note:
        oai.append({"role": "system", "content":
                    f"# Author's Note — pinned reminder\n{macro(author_note, char['name'], user_name)}"})
    moods = character_moods(char)
    params = build_sampling_params(eff)
    if length_preset["max_tokens"] is not None:
        params["max_tokens"] = length_preset["max_tokens"]
    yield "data: " + json.dumps({"type": "status", "phase": "generating", "char_id": cid}) + "\n\n"
    ans, thought = [], []
    try:
        async for channel, text in llm.chat_stream(oai, chat_model, params, parse_think=do_think,
                base_url=ep["chat_base"], api_key=ep["chat_key"], pin_host=True):
            if channel == "thinking":
                thought.append(text)
                yield "data: " + json.dumps({"type": "thinking", "content": text, "char_id": cid}) + "\n\n"
            else:
                ans.append(text)
    except Exception as e:
        log.error("group generation failed session=%s char=%s: %s", sid, cid,
                  _sanitize_exc(e, ep["chat_base"], ep["chat_key"]))
        yield "data: " + json.dumps({"type": "error", "message": str(e), "char_id": cid}) + "\n\n"
        return
    reply, mood = parse_mood("".join(ans).strip(), moods)
    reply = strip_leaked_sigil(reply)
    reply = strip_ai_prose_artifacts(reply)
    if chat_mode:
        reply = re.sub(r"\*[^*]*\*", " ", reply)
        reply = re.sub(r"\s+", " ", reply).strip()
        if len(reply) >= 2 and reply[0] in "\"“" and reply[-1] in "\"”":
            reply = reply[1:-1].strip()
    if not reply:
        return
    thinking_disp = "".join(thought).strip()
    stored = (f"<think>{thinking_disp}</think>\n\n{reply}" if thinking_disp else reply)
    amsg = await chat_sessions.add_message(sid, "assistant", stored, lang=language,
                                           mood=mood or None, char_id=cid, turn_group=turn_group)
    amsg["char_name"] = char["name"]
    amsg["char_avatar"] = char.get("avatar")
    working.append(amsg)
    yield "data: " + json.dumps({"type": "delta", "content": reply, "char_id": cid}) + "\n\n"
    yield "data: " + json.dumps({"type": "message", "message": amsg, "char_id": cid, "mood": mood,
                                 "lore": meta_lore_lines, "memory": meta_memory_lines}) + "\n\n"

async def _load_group_cast(sid):
    cast_rows = await session_char_repo.list_cast(sid)
    chars_by_id = {}
    for row in cast_rows:
        c = await characters.get(row["char_id"])
        if c:
            chars_by_id[row["char_id"]] = c
    return cast_rows, chars_by_id

async def _group_single(s, eff, ep, chat_model, cid, current_user, think, user_overrides, replace_mid=None):
    sid = s["id"]
    cast_rows, chars_by_id = await _load_group_cast(sid)
    if cid not in chars_by_id:
        raise HTTPException(404, "character is not in this group")
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
    user_name = (persona["name"] if persona else None) or s.get("user_name") or "You"
    language = _chat_language(s, user_overrides)
    do_think = eff["enable_thinking"] if think is None else bool(think)
    viewer_id = current_user["id"] if current_user else None

    turn_group = db.nid("tg")
    if replace_mid:
        msgs = await chat_sessions.list_messages(sid)
        target = next((m for m in msgs if m["id"] == replace_mid), None)
        if not target or target["role"] != "assistant":
            raise HTTPException(404, "message not found")
        turn_group = target.get("turn_group") or turn_group
        try:
            names_by_id = {char_id: c["name"] for char_id, c in chars_by_id.items()}
            await memory_service.rollback_discarded_turn(sid, msgs, replace_mid, names_by_id=names_by_id)
        except Exception as e:
            log.warning("memory rollback failed for group reassign: session=%s message=%s: %s: %s",
                       sid, replace_mid, type(e).__name__, e)
        await chat_sessions.delete_message(sid, replace_mid)
    else:
        last_asst = None
        for m in reversed(await chat_sessions.list_messages(sid)):
            if m["role"] == "assistant" and m.get("turn_group"):
                last_asst = m
                break
        turn_group = (last_asst or {}).get("turn_group") or turn_group

    msgs = await chat_sessions.list_messages(sid)
    user_turn = next((m for m in reversed(msgs) if m["role"] == "user"), None)
    query = user_turn["content"] if user_turn else ""
    log.info("group %s: session=%s char=%s", "reassign" if replace_mid else "speak", sid, cid)

    async def gen():
        yield "data: " + json.dumps({"type": "meta", "turn_group": turn_group, "think": do_think}) + "\n\n"
        working = list(msgs)
        async for ev in _group_reply_events(s, cid, chars_by_id, cast_rows, working, eff, ep, chat_model,
                                            persona, user_name, language, do_think, turn_group, query, viewer_id,
                                            chat_mode=(s.get("group_mode") == "chat")):
            yield ev
        yield "data: " + json.dumps({"type": "done", "turn_group": turn_group, "replaced": replace_mid}) + "\n\n"

    handle = _start_gen(sid, gen)
    return StreamingResponse(handle.stream(), media_type="text/event-stream")

async def run_group_speak(sid, char_id, current_user, think=None, replace_mid=None):
    user_overrides = await user_repo.get_user_settings(current_user["id"]) if current_user else {}
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    chat_model = eff.get("chat_model") or CFG["chat_model"]
    s = await chat_sessions.get(sid)
    if not s or not s.get("is_group"):
        raise HTTPException(404, "group session not found")
    return await _group_single(s, eff, ep, chat_model, char_id, current_user, think,
                               user_overrides, replace_mid=replace_mid)

async def _narrate_action(action, actor_name, language, chat_model, ep, gender=None):
    named = bool(actor_name and actor_name.strip() and actor_name.strip().lower() != "you")
    g = (gender or "").strip().lower()
    refer = (f'Refer to the actor as "{actor_name}" — use the name, not a generic pronoun.' if named
             else "Refer to the actor only in the third person (she/he/they), never as 'you'.")
    pron = f" When a pronoun is needed, use {g} pronouns." if g else ""
    prompt = [
        {"role": "system", "content":
         "You are a narrator in a story. Rewrite the given player action into one vivid third-person "
         f"sentence. {refer}{pron} Never use the first or second person ('I', 'my', 'me', 'you', "
         "'your'). Describe only what the actor does; do not add or narrate other characters. Output "
         "only the narration — no quotation marks, no preamble, no commentary."},
        {"role": "user", "content":
         f"Actor: {actor_name}\nWrite the narration in: {language}\nAction: {action}\n\nThird-person narration:"},
    ]
    out = ""
    try:
        async for channel, txt in llm.chat_stream(prompt, chat_model, {"temperature": 0.4, "max_tokens": 400},
                parse_think=True, base_url=ep["chat_base"], api_key=ep["chat_key"], pin_host=True):
            if channel == "content":
                out += txt
    except Exception as e:
        log.warning("player action narration failed: %s", _sanitize_exc(e, ep["chat_base"], ep["chat_key"]))
        return ""
    out = strip_think(out).strip().strip('"').strip()
    return out

_FIRST_PERSON_RE = re.compile(r"\b(I|I'm|I'll|I've|I'd|my|mine|me|myself)\b", re.IGNORECASE)

async def group_narrate_edit(s, content, current_user):
    dialogue, action = group.split_speech(content)
    if not action or not _FIRST_PERSON_RE.search(action):
        return content
    user_overrides = await user_repo.get_user_settings(current_user["id"]) if current_user else {}
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    chat_model = eff.get("chat_model") or CFG["chat_model"]
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
    user_name = (persona["name"] if persona else None) or s.get("user_name") or "You"
    language = _chat_language(s, user_overrides)
    narrated = await _narrate_action(action, user_name, language, chat_model, ep,
                                     gender=(persona or {}).get("gender"))
    if narrated:
        return f'*{narrated}* "{dialogue}"' if dialogue else f"*{narrated}*"
    return content

async def _run_group(s, eff, ep, chat_model, user_content, current_user, think, user_overrides):
    sid = s["id"]
    cast_rows = await session_char_repo.list_cast(sid)
    chars_by_id = {}
    for row in cast_rows:
        c = await characters.get(row["char_id"])
        if c:
            chars_by_id[row["char_id"]] = c
    if not chars_by_id:
        raise HTTPException(400, "group has no characters")
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
    user_name = (persona["name"] if persona else None) or s.get("user_name") or "You"
    language = _chat_language(s, user_overrides)
    do_think = eff["enable_thinking"] if think is None else bool(think)
    viewer_id = current_user["id"] if current_user else None
    chat_mode = s.get("group_mode") == "chat"

    if user_content is not None:
        if chat_mode:
            stored_user = re.sub(r"\*[^*]*\*", " ", user_content)
            stored_user = re.sub(r"\s+", " ", stored_user).strip() or user_content
        else:
            dialogue, action = group.split_speech(user_content)
            stored_user = user_content
            if action:
                narrated = await _narrate_action(action, user_name, language, chat_model, ep,
                                                 gender=(persona or {}).get("gender"))
                log.info("group player-action narrated: session=%s narrated=%s", sid, bool(narrated))
                if narrated:
                    stored_user = f'*{narrated}* "{dialogue}"' if dialogue else f"*{narrated}*"
        await chat_sessions.add_message(sid, "user", stored_user, user_name=user_name,
                                        persona_avatar=(persona or {}).get("avatar") or None)
    msgs = await chat_sessions.list_messages(sid)
    user_turn = next((m for m in reversed(msgs) if m["role"] == "user"), None)
    query = user_turn["content"] if user_turn else ""
    user_mid = user_turn["id"] if user_turn else None
    route_text = user_content if user_content is not None else query

    cast = [{**row, "name": (chars_by_id.get(row["char_id"]) or {}).get("name")} for row in cast_rows]
    last_speaker = next((m.get("char_id") for m in reversed(msgs)
                         if m["role"] == "assistant" and m.get("char_id")), None)
    responder_ids = await next_speaker(cast, route_text, last_speaker, recent_text(msgs), chat_model, ep)
    turn_group = db.nid("tg")
    log.info("group turn start: session=%s responders=%s lang=%s", sid, responder_ids, language)

    async def gen():
        yield "data: " + json.dumps({"type": "meta", "user_mid": user_mid,
                                     "responders": responder_ids, "turn_group": turn_group,
                                     "think": do_think}) + "\n\n"
        working = list(msgs)
        for cid in responder_ids:
            async for ev in _group_reply_events(s, cid, chars_by_id, cast_rows, working, eff, ep,
                                                chat_model, persona, user_name, language, do_think,
                                                turn_group, query, viewer_id, chat_mode=chat_mode):
                yield ev
        primary = chars_by_id.get(responder_ids[0]) if responder_ids else next(iter(chars_by_id.values()))
        names_by_id = {cid: c["name"] for cid, c in chars_by_id.items()}
        cast_names = [c["name"] for c in chars_by_id.values()]
        log.info("group turn done: session=%s turn_group=%s", sid, turn_group)
        yield "data: " + json.dumps({"type": "done", "turn_group": turn_group}) + "\n\n"
        _extract_memory_in_background(sid, memory_service.maybe_extract(
            s, primary, user_name, language, chat_model,
            chat_base=ep["chat_base"], chat_key=ep["chat_key"],
            embed_base=ep["embed_base"], embed_key=ep["embed_key"],
            names_by_id=names_by_id, cast_names=cast_names))

    handle = _start_gen(sid, gen)
    return StreamingResponse(handle.stream(), media_type="text/event-stream")

async def _regenerate_group(s, eff, ep, chat_model, current_user, think, user_overrides):
    msgs = await chat_sessions.list_messages(s["id"])
    target = next((m for m in reversed(msgs) if m["role"] == "assistant" and m.get("char_id")), None)
    if not target:
        raise HTTPException(400, "nothing to regenerate")
    return await _group_single(s, eff, ep, chat_model, target["char_id"], current_user, think,
                               user_overrides, replace_mid=target["id"])

async def _run(sid, user_content=None, regenerate=False, continue_mode=False,
               direction=None, think=None, current_user=None):
    user_overrides = {}
    if current_user:
        user_overrides = await user_repo.get_user_settings(current_user["id"])
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    chat_model = eff.get("chat_model") or CFG["chat_model"]

    s = await chat_sessions.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    participant_rows = await session_participants.list_for_session(sid)
    is_multiplayer = bool(participant_rows)
    placeholder = None
    if is_multiplayer:
        existing = _active_gen.get(sid)
        if existing and not existing.done:
            raise HTTPException(409, "Someone else is currently acting — wait for the reply to finish")
        placeholder = GenHandle(sid)
        _active_gen[sid] = placeholder
    try:
        return await _run_turn(s, participant_rows, is_multiplayer, eff, ep, chat_model, user_overrides,
                               user_content, regenerate, continue_mode, direction, think, current_user)
    except BaseException:
        if placeholder is not None and _active_gen.get(sid) is placeholder:
            _active_gen.pop(sid, None)
        raise

async def _run_turn(s, participant_rows, is_multiplayer, eff, ep, chat_model, user_overrides,
                    user_content, regenerate, continue_mode, direction, think, current_user):
    sid = s["id"]
    eff_chat_base, eff_api_key = ep["chat_base"], ep["chat_key"]
    other_player_names = []
    if is_multiplayer:
        for row in participant_rows:
            if not row.get("persona_id") or row["user_id"] == (current_user["id"] if current_user else None):
                continue
            row_persona = await personas.get(row["persona_id"])
            if row_persona:
                other_player_names.append(row_persona["name"])
    persona, user_name = await _resolve_sender_persona(s, current_user)
    generating_payload = {"sender_user_id": current_user["id"] if current_user else None}
    if is_multiplayer and user_content is not None and not regenerate and not continue_mode:
        generating_payload["content"] = user_content
        generating_payload["user_name"] = user_name
        generating_payload["persona_avatar"] = (persona or {}).get("avatar") or None
    live_broadcast.broadcast(sid, "generating", generating_payload)
    if s.get("is_group"):
        if continue_mode:
            raise HTTPException(400, "continue is not supported in group chats")
        if regenerate:
            return await _regenerate_group(s, eff, ep, chat_model, current_user, think, user_overrides)
        return await _run_group(s, eff, ep, chat_model, user_content, current_user, think, user_overrides)
    char = await characters.get(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")
    mode = char.get("mode") or "character"
    language = _chat_language(s, user_overrides)
    do_think = eff["enable_thinking"] if think is None else bool(think)

    prev = None
    if continue_mode:
        _msgs0 = await chat_sessions.list_messages(sid)
        prev = next((m for m in reversed(_msgs0) if m["role"] == "assistant"), None)
        if not prev:
            raise HTTPException(400, "nothing to continue")

    regen_target = None
    if regenerate:
        _msgs0 = await chat_sessions.list_messages(sid)
        regen_target = next((m for m in reversed(_msgs0) if m["role"] == "assistant"), None)
        if regen_target:
            try:
                await memory_service.rollback_discarded_turn(sid, _msgs0, regen_target["id"])
            except Exception as e:
                log.warning("memory rollback failed for regenerate: session=%s message=%s: %s: %s",
                           sid, regen_target["id"], type(e).__name__, e)
    elif user_content is not None:
        await chat_sessions.prune_last_swipes(sid)
        await chat_sessions.add_message(sid, "user", user_content, user_name=user_name,
                                        persona_avatar=(persona or {}).get("avatar") or None,
                                        sender_user_id=current_user["id"] if current_user else None)

    msgs = await chat_sessions.list_messages(sid)
    if regen_target:
        msgs = [m for m in msgs if m["id"] != regen_target["id"]]
    if prev:
        msgs = [m for m in msgs if m["id"] != prev["id"]]
    user_turn = next((m for m in reversed(msgs) if m["role"] == "user"), None)
    query = user_turn["content"] if user_turn else ""
    user_mid = user_turn["id"] if user_turn else None

    legacy_directive = bool(user_content and LEGACY_DIRECTIVE_RE.match(user_content))
    if legacy_directive:
        log.warning("legacy text command received (unsupported with v2 prompt, treated as fiction): "
                    "session=%s — frontend must send the structured directive field instead", sid)

    keyword_lore_entries, retrieve_err = await retrieve(
        char["id"], sid, query, recent_text(msgs),
        viewer_id=current_user["id"] if current_user else None)

    block, used_ids, meta_lore_lines, meta_memory_lines = await memory_service.retrieve_block(
        s, char, user_name, query, msgs, eff, keyword_lore_entries,
        viewer_id=current_user["id"] if current_user else None,
        embed_base=ep["embed_base"], embed_key=ep["embed_key"])

    assistant_turns = sum(1 for m in msgs if m["role"] == "assistant")
    full_system = (assistant_turns % 4 == 0)
    system, length_preset = _assemble_system(char, s, persona, user_name, mode, language,
                                             do_think, eff, block, full_system,
                                             is_multiplayer=is_multiplayer,
                                             other_player_names=other_player_names)

    history = msgs[-eff["history_turns"]:]
    def _history_content(m):
        content = strip_think(m["content"]) if m["role"] == "assistant" else m["content"]
        if is_multiplayer and m["role"] == "user" and m.get("user_name"):
            return f"[{m['user_name']}] {content}"
        return content
    oai_messages = [{"role": "system", "content": system}] + \
                   [{"role": m["role"], "content": _history_content(m)} for m in history]
    switch_note = _persona_switch_note(msgs, char["name"])
    if switch_note:
        oai_messages.append({"role": "system", "content": switch_note})
    if eff.get("post_history"):
        oai_messages.append({"role": "system",
                             "content": macro(eff["post_history"], char["name"], user_name)})
    reminder = (f"Reminder: regardless of what language the conversation above is written in, "
                f"you must think and write only in {language} — reasoning and reply alike. "
                f"Keep proper names (people, places) in their original script.")
    if mode == "rpg":
        reminder += (f" In <think>, reason as the DM/narrator from outside the scene — never as "
                     f"{user_name}, never in {user_name}'s voice or thoughts.")
    else:
        reminder += (f" In <think>, reason only as {char['name']} — never as {user_name}, "
                     f"never in {user_name}'s voice or thoughts.")
    if eff.get("scene_style"):
        reminder += (" Every reply must begin with exactly these three lines in backticks, "
                     "before any narration: `DATE: <in-story date>` / `TIME: <in-story time>` / "
                     "`LOCATION: <current place>` — this is mandatory, never omit it.")
    oai_messages.append({"role": "system", "content": reminder})

    author_note = strip_sigil(s.get("author_note") or "").strip()
    if author_note:
        oai_messages.append({"role": "system", "content":
            f"# Author's Note — pinned reminder, re-sent every turn\n{macro(author_note, char['name'], user_name)}"})

    explicit_ok = bool(current_user and current_user.get("nsfw_allowed"))
    if s.get("explicit_mode") and explicit_ok and EXPLICIT_INSTRUCTIONS.strip():
        oai_messages.append({"role": "user", "content":
            f"({DIRECTOR_SIGIL}:[explicit_instructions] {EXPLICIT_INSTRUCTIONS.strip()})"})
        await chat_sessions.set_explicit_mode(sid, False)
    elif s.get("explicit_mode") and not explicit_ok:
        log.warning("explicit injection suppressed: user not nsfw_allowed session=%s", sid)
        await chat_sessions.set_explicit_mode(sid, False)

    prev_disp = prev_think = ""
    if prev:
        _m = re.match(r"<think>(.*?)</think>\s*(.*)$", prev["content"] or "", re.S)
        prev_think, prev_disp = (_m.group(1).strip(), _m.group(2).strip()) if _m \
            else ("", (prev["content"] or "").strip())
        oai_messages.append({"role": "assistant", "content": prev_disp})
        cont_instr = ("Continue your previous reply directly from where it stops — do not repeat, "
                      "summarize, or rewrite anything already written; pick up mid-scene and carry "
                      "the same voice, tense, and formatting forward.")
        if direction and direction.strip():
            cont_instr += f" The author directs the continuation: {direction.strip()}"
        oai_messages.append({"role": "system", "content": cont_instr})

    moods = character_moods(char)
    params = build_sampling_params(eff)
    if length_preset["max_tokens"] is not None:
        params["max_tokens"] = length_preset["max_tokens"]

    log.info("chat turn start: session=%s char=%s mode=%s think=%s lang=%s lore_hits=%d memory_hits=%d full_system=%s",
             sid, char["id"], mode, do_think, language, len(meta_lore_lines), len(meta_memory_lines), full_system)
    if retrieve_err:
        log.warning("retrieval degraded for session=%s: %s", sid, retrieve_err)

    async def gen():
        meta = {"type": "meta", "lore": meta_lore_lines, "memory": meta_memory_lines,
                "user_mid": user_mid, "think": do_think, "retrieve_error": retrieve_err}
        if legacy_directive:
            meta["warning"] = ("legacy text commands ((OOC:), *[Scene:], 🎲, ...) are not supported "
                               "with the v2 prompt and were treated as in-fiction speech — use the "
                               "structured 'directive' field on POST /chat instead")
        yield "data: " + json.dumps(meta) + "\n\n"
        yield "data: " + json.dumps({"type": "status", "phase": "generating"}) + "\n\n"
        ans, thought = [], []
        try:
            async for channel, text in llm.chat_stream(
                    oai_messages, chat_model, params, parse_think=do_think,
                    base_url=eff_chat_base, api_key=eff_api_key, pin_host=True):
                if channel == "thinking":
                    thought.append(text)
                    yield "data: " + json.dumps({"type": "thinking", "content": text}) + "\n\n"
                else:
                    ans.append(text)
        except Exception as e:
            log.error("chat generation failed: session=%s char=%s model=%s custom_endpoint=%s detail=%s",
                     sid, char["id"], chat_model, bool(eff_chat_base),
                     _sanitize_exc(e, eff_chat_base, eff_api_key))
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        reply, mood = parse_mood("".join(ans).strip(), moods)
        reply = strip_leaked_sigil(reply)
        reply = strip_ai_prose_artifacts(reply)
        if reply and s.get("language") and not reply_matches_language_script(reply, s["language"]):
            log.warning("language drift: reply didn't match %s script, falling back to translation "
                        "session=%s char=%s", s["language"], sid, char["id"])
            try:
                from backend.routers.misc import translate_text_live
                fixed = await translate_text_live(reply, s["language"], chat_model, ep)
                if fixed:
                    reply = fixed
            except Exception as e:
                log.error("language drift fallback translation failed: session=%s: %s: %s",
                         sid, type(e).__name__, e)
        sanctioned_ooc = bool(query and query.lstrip().startswith(f"({DIRECTOR_SIGIL}"))
        if reply and reply.lstrip().startswith("(OOC") and not sanctioned_ooc:
            log.warning("immersion break: unsanctioned OOC reply: session=%s char=%s", sid, char["id"])
        if reply and "enc:" in reply:
            log.warning("ciphertext-leak-guard: blanked 'enc:' value leaking from chat stream session=%s", sid)
            reply = reply.replace("enc:", "")
        if reply and not prev and eff.get("scene_style"):
            prior_replies = [strip_think(m["content"]) for m in msgs if m["role"] == "assistant"]
            reply = ensure_scene_header(reply, prior_replies)
        if reply:
            yield "data: " + json.dumps({"type": "delta", "content": reply}) + "\n\n"
        thinking_disp = "".join(thought).strip()
        if moods:
            log.info("mood tag: session=%s char=%s -> %s", sid, char["id"],
                     mood if mood else "none (model did not emit a [mood: X] tag)")

        stored = (f"<think>{thinking_disp}</think>\n\n{reply}" if thinking_disp else reply)
        if prev:
            merged_reply = (f"{prev_disp}\n\n{reply}" if reply else prev_disp)
            merged_think = "\n\n".join(part for part in (prev_think, thinking_disp) if part)
            stored = (f"<think>{merged_think}</think>\n\n{merged_reply}" if merged_think else merged_reply)
            await chat_sessions.edit_message(sid, prev["id"], stored)
            amsg = {**prev, "content": stored, "lang": language, "mood": mood or None}
        elif regen_target:
            swipe_info = await chat_sessions.add_swipe(sid, regen_target["id"], stored)
            amsg = {**regen_target, "content": stored, "lang": language, "mood": mood or None,
                   "swipe_index": swipe_info["index"], "swipe_count": swipe_info["count"]}
        else:
            amsg = await chat_sessions.add_message(sid, "assistant", stored, lang=language, mood=mood or None)
        if current_user:
            try:
                await guest_quota.record(current_user, "tokens", guest_quota.estimate_tokens(
                    *[m["content"] for m in oai_messages], stored))
            except Exception as e:
                log.warning("guest quota record failed session=%s: %s: %s", sid, type(e).__name__, e)
        log.info("chat turn done: session=%s reply_chars=%d", sid, len(reply))
        yield "data: " + json.dumps({"type": "done", "message": amsg, "mood": mood}) + "\n\n"
        _extract_memory_in_background(sid, memory_service.maybe_extract(
            s, char, user_name, language, chat_model,
            chat_base=eff_chat_base, chat_key=eff_api_key,
            embed_base=ep["embed_base"], embed_key=ep["embed_key"]))

    handle = _start_gen(sid, gen)
    return StreamingResponse(handle.stream(), media_type="text/event-stream")
