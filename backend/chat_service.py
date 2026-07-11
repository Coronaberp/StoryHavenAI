"""Chat generation service: config/endpoint resolution, session ownership,
the SSE generation machinery (GenHandle/_start_gen), and the _run loop that
drives /chat, /regenerate, /roll, /continue.

Lore/memory retrieval and the per-turn memory extraction live in
backend/retrieval.py; NSFW image classification lives in backend/classify.py;
character/persona/image-prompt side-call generators live in backend/ai_helpers.py."""
import re
import json
import hashlib
import asyncio

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from backend import db
from backend import vectors
from backend import llm
from backend.state import CFG, log, _sanitize_exc, USER_CFG_KEYS
from backend.ssrf import _resolve_host_ip_issue
from backend.repositories import flagged_endpoints as flagged_endpoint_repo
from backend.repositories import characters
from backend.repositories import personas
from backend.repositories import chat_sessions
from backend.repositories import users as user_repo
from backend.retrieval import retrieve, remember
from backend.prompt import (build_system, think_instruction, strip_think, macro,
                    recent_text, ensure_scene_header)
from backend.sampling import build_sampling_params
from backend.mood import character_moods, parse_mood

def _eff_cfg(user_overrides: dict) -> dict:
    """Merge global CFG with user overrides (user wins, None values skipped)."""
    return {**CFG, **{k: v for k, v in user_overrides.items()
                      if k in USER_CFG_KEYS and v is not None}}


async def _endpoints(user_overrides: dict, user_id: str | None = None,
                     is_admin: bool = False) -> dict:
    """Resolve the effective chat + embed endpoints for one user.

    Chat is the only bring-your-own-endpoint surface: a user's own base_url (+
    its optional API key) overrides the global one, but only ever after it's
    passed _validate_chat_endpoint (see PUT /me/settings) — a raw stored value
    can't reach here unverified. Embeddings are never user-overridable at all:
    the vector index is shared across every user, so one user pointing it at a
    different model/dimension would corrupt search results for everyone, and
    there's no per-turn user-facing reason to need a different embed backend
    the way there is for chat. `None` values mean "use the module-level global
    config" in llm.py.

    Beyond the save-time check, every actual use re-runs the cheap IP-only
    half of that guard (_resolve_host_ip_issue) — a host that validated fine
    when saved (or was explicitly admin-approved) can still start resolving
    to a private address later via DNS rebinding or simply changing hands.
    If that happens, the request falls back to the global endpoint instead
    of silently using the now-suspicious one, and it's flagged again for
    admin review regardless of its prior approval status.
    """
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
    """Language of everything read *outside* the story flow (UI chrome, memory
    panel, character status): the user's interface language, else the admin's
    instance default."""
    return (user_overrides.get("interface_language") or "").strip() \
        or (CFG.get("default_language") or "").strip() or "English"


def _chat_language(session: dict, user_overrides: dict) -> str:
    """Language of the story itself (replies and thinking): the session's own
    talk language (the chat's 🌐 button) wins; falls back to the UI language."""
    return (session.get("language") or "").strip() or _ui_language(user_overrides)


async def _own_session(sid: str, current_user: dict) -> dict:
    """Fetch a session and enforce ownership. Raises 404 if missing/unowned."""
    s = await chat_sessions.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    if s.get("user_id") != current_user["id"]:
        raise HTTPException(404, "session not found")
    return s


class GenHandle:
    """
    One per active generation (keyed by session id).

    The background asyncio.Task calls emit() for each raw SSE string and
    finish() when done.  Any number of HTTP clients can subscribe(); each gets
    a personal asyncio.Queue.  Reconnecting clients replay the buffer first,
    then receive live events exactly once.
    """
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

    def finish(self):
        self.done = True
        for q in self._subs:
            q.put_nowait(None)          # sentinel — stream() exits its loop
        if _active_gen.get(self.sid) is self:
            _active_gen.pop(self.sid, None)

    async def stream(self):
        """Async generator consumed by StreamingResponse."""
        for item in self._buf:         # replay what already arrived
            yield item
        if self.done:
            return
        q: asyncio.Queue = asyncio.Queue()
        self._subs.append(q)
        try:
            while True:
                item = await asyncio.wait_for(q.get(), timeout=600)
                if item is None:       # finish() sentinel
                    break
                yield item
        except asyncio.TimeoutError:
            # 10 minutes with no event at all — the generation is stuck (or
            # the underlying task died without calling finish()). Emitting an
            # explicit error here matters: without it, this generator just
            # returns and the HTTP connection closes with zero terminal SSE
            # event, leaving the client's stream parser with no signal that
            # anything happened at all.
            log.warning("generation stalled with no event after 600s: sid=%s", self.sid)
            yield "data: " + json.dumps({"type": "error",
                                         "message": "generation stalled — no response after 10 minutes"}) + "\n\n"
        finally:
            try:
                self._subs.remove(q)
            except ValueError:
                pass


_active_gen: dict[str, GenHandle] = {}


def _start_gen(sid: str, coro_fn, *args, **kwargs):
    """
    Cancel any existing generation for sid, create a new GenHandle, launch a
    background task, and return the handle so the caller can stream from it.
    """
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
    """Read-through cache lookup against the persistent `localization` table — never
    calls the LLM. Anything not already cached (e.g. by the on-demand /api/translate
    button) is returned as source text unchanged."""
    lang = target_language.strip().lower()
    hashes = [_src_hash(t) for t in texts]
    cached = await db.get_localizations(list(set(hashes)), lang)
    return [cached.get(h, t) for t, h in zip(texts, hashes)]


async def _run(sid, user_content=None, regenerate=False, continue_mode=False,
               direction=None, think=None, current_user=None):
    # Build effective config: global CFG merged with this user's overrides
    user_overrides = {}
    if current_user:
        user_overrides = await user_repo.get_user_settings(current_user["id"])
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    eff_chat_base, eff_api_key = ep["chat_base"], ep["chat_key"]
    chat_model = eff.get("chat_model") or CFG["chat_model"]

    s = await chat_sessions.get(sid)
    if not s:
        raise HTTPException(404, "session not found")
    char = await characters.get(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")
    persona = await personas.get(s["persona_id"]) if s.get("persona_id") else None
    user_name = (persona["name"] if persona else None) or s.get("user_name") or "You"
    mode = char.get("mode") or "character"
    # Story language: replies and thinking follow the chat's own selected language
    # (the 🌐 button) first — the UI chrome around them follows the interface
    # language separately (see _ui_language's callers: memory, char-state, UI i18n).
    language = _chat_language(s, user_overrides)
    do_think = eff["enable_thinking"] if think is None else bool(think)

    # Continue: extend the trailing assistant turn in place. The old turn is popped
    # and its text re-fed as an assistant message the model must pick up from; the
    # combined old+new text is stored back as ONE message, so the DB (and any
    # reload) shows a single, longer reply — never a duplicate. The optional
    # direction steers the continuation via a system line and is never persisted
    # as a user message.
    prev = None
    if continue_mode:
        _msgs0 = await chat_sessions.list_messages(sid)
        prev = next((m for m in reversed(_msgs0) if m["role"] == "assistant"), None)
        if not prev:
            raise HTTPException(400, "nothing to continue")
        await chat_sessions.pop_trailing_assistant(sid)

    if regenerate:
        await chat_sessions.pop_trailing_assistant(sid)
    elif user_content is not None:
        await chat_sessions.add_message(sid, "user", user_content)

    msgs = await chat_sessions.list_messages(sid)
    user_turn = next((m for m in reversed(msgs) if m["role"] == "user"), None)
    query = user_turn["content"] if user_turn else ""
    user_mid = user_turn["id"] if user_turn else None

    if regenerate and user_mid:
        await vectors.delete_memory(user_mid)

    lore_lines, mem_lines, retrieve_err = await retrieve(
        char["id"], sid, query, recent_text(msgs), exclude_mid=user_mid, cfg=eff,
        embed_base=ep["embed_base"], embed_key=ep["embed_key"])

    # Full system prompt costs the most tokens and is otherwise identical every turn —
    # resend it in full only every 4th reply to keep the model's grip on the rulebook
    # fresh, and send a short pointer to it on the turns in between. Author's Note,
    # the reminder, mood tag, and lore/memory/known_names stay on every turn regardless
    # — those are what keep short-turn output accurate.
    assistant_turns = sum(1 for m in msgs if m["role"] == "assistant")
    full_system = (assistant_turns % 4 == 0)
    system = build_system(char, persona, user_name, mode, language=language, full=full_system)
    if lore_lines:
        system += "\n\n# World information (lore)\nWeave these in naturally when relevant, in " \
                  f"{language} regardless of what language this reference text is written in.\n" \
                  + "\n".join(lore_lines)
    if mem_lines:
        system += "\n\n# Long-term memory (you recall these from earlier)\n" + "\n".join(mem_lines)
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
    style_prompt = (s.get("style_prompt") or "").strip()
    if style_prompt:
        system += "\n\n# Response Style\n" + style_prompt
    if eff.get("scene_style"):
        # Opt-in per user: janitor-style scene presentation. The DATE/TIME/LOCATION
        # tokens stay literal English inside code spans (they're UI chrome); the
        # values follow the story's language like the rest of the reply.
        system += ("\n\n# Scene format\n"
                   "Begin every reply with a scene header of three separate lines, each inside "
                   "backticks exactly like this:\n"
                   "`DATE: <in-story date>`\n`TIME: <in-story time>`\n`LOCATION: <current place>`\n"
                   "Keep the header consistent with the story's established timeline and advance it "
                   "as time passes. Additionally, where it adds insight, reveal a present character's "
                   "inner voice on its own line formatted as: **<Name>'s thoughts 💭:** *<one or two "
                   "short sentences in first person>* — never the player's thoughts.")

    history = msgs[-eff["history_turns"]:]
    oai_messages = [{"role": "system", "content": system}] + \
                   [{"role": m["role"],
                     "content": strip_think(m["content"]) if m["role"] == "assistant" else m["content"]}
                    for m in history]
    if eff.get("post_history"):
        oai_messages.append({"role": "system",
                             "content": macro(eff["post_history"], char["name"], user_name)})
    # Placed last so it's the most recent instruction the model reads before generating —
    # the DM-perspective rule in the system prompt gets diluted by the lore/memory/persona/
    # history text injected after it, and the model drifts into narrating from the player's
    # own perspective instead of the DM's/character's on the condensed (non-full_system)
    # turns where the detailed reasoning rules aren't resent.
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
        # Re-stated here, not just once earlier in the system prompt: this is the
        # strongest steering position (closest to generation), and formatting
        # instructions buried before a long block of lore/memory/history are the
        # first thing models drop — confirmed by live testing where the header
        # was reliably skipped when only stated once, earlier in the prompt.
        reminder += (" Every reply must begin with exactly these three lines in backticks, "
                     "before any narration: `DATE: <in-story date>` / `TIME: <in-story time>` / "
                     "`LOCATION: <current place>` — this is mandatory, never omit it.")
    oai_messages.append({"role": "system", "content": reminder})

    author_note = (s.get("author_note") or "").strip()
    if author_note:
        # Author's Note (SillyTavern-style): pinned instructions re-sent as the very last
        # message on every turn, not just once in the system prompt at position 0. Long chats
        # push the original system prompt far from the point of generation, and models drift —
        # e.g. narrating in the wrong POV or forgetting the GM/character framing after enough
        # turns. Re-injecting here, closest to generation, keeps it from being diluted.
        oai_messages.append({"role": "system", "content":
            f"# Author's Note — pinned reminder, re-sent every turn\n{macro(author_note, char['name'], user_name)}"})

    # Continuation priming: re-feed the popped turn as the model's own last message,
    # then instruct it to pick up exactly where that text stops.
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

    log.info("chat turn start: session=%s char=%s mode=%s think=%s lang=%s lore_hits=%d memory_hits=%d full_system=%s",
             sid, char["id"], mode, do_think, language, len(lore_lines), len(mem_lines), full_system)
    if retrieve_err:
        log.warning("retrieval degraded for session=%s: %s", sid, retrieve_err)

    async def gen():
        yield "data: " + json.dumps({"type": "meta", "lore": lore_lines, "memory": mem_lines,
                                     "user_mid": user_mid, "think": do_think,
                                     "retrieve_error": retrieve_err}) + "\n\n"
        yield "data: " + json.dumps({"type": "status", "phase": "generating"}) + "\n\n"
        if prev and prev_disp:
            # continue: the bubble shows the whole (old + new) turn live, and acc on
            # the client ends up matching what reload() will render from the DB
            head = prev_disp + "\n\n"
            yield "data: " + json.dumps({"type": "delta", "content": head}) + "\n\n"
        ans, thought = [], []
        try:
            async for channel, text in llm.chat_stream(
                    oai_messages, chat_model, params, parse_think=do_think,
                    base_url=eff_chat_base, api_key=eff_api_key, pin_host=True):
                if channel == "thinking":
                    thought.append(text)
                    yield "data: " + json.dumps({"type": "thinking", "content": text}) + "\n\n"
                else:
                    # Buffered rather than streamed raw: a configured character's mood
                    # tag lands at the very end of the reply and must never reach the
                    # client visibly, so the whole answer is parsed for it before any
                    # of it is shown.
                    ans.append(text)
        except Exception as e:
            log.error("chat generation failed: session=%s char=%s model=%s custom_endpoint=%s detail=%s",
                     sid, char["id"], chat_model, bool(eff_chat_base),
                     _sanitize_exc(e, eff_chat_base, eff_api_key))
            yield "data: " + json.dumps({"type": "error", "message": str(e)}) + "\n\n"
        reply, mood = parse_mood("".join(ans).strip(), moods)
        if reply and "enc:" in reply:
            # SSE replies bypass the JSON ciphertext-leak-guard middleware (it only
            # scans buffered JSON bodies) — apply the same check here so a raw
            # at-rest-encrypted value can never reach the client over the stream.
            log.warning("ciphertext-leak-guard: blanked 'enc:' value leaking from chat stream session=%s", sid)
            reply = reply.replace("enc:", "")
        if reply and eff.get("scene_style"):
            prior_replies = [strip_think(m["content"]) for m in msgs if m["role"] == "assistant"]
            reply = ensure_scene_header(reply, prior_replies)
        if reply:
            yield "data: " + json.dumps({"type": "delta", "content": reply}) + "\n\n"
        thinking_disp = "".join(thought).strip()
        if moods:
            # this is the line to check if you're debugging why the stage/sprite/music
            # isn't switching: a configured character with no mood tag in the reply
            # means the model didn't emit `[mood: X]` this turn, not a bug in parsing
            log.info("mood tag: session=%s char=%s -> %s", sid, char["id"],
                     mood if mood else "none (model did not emit a [mood: X] tag)")

        reply_disp = (prev_disp + "\n\n" + reply if reply else prev_disp) if prev else reply
        all_think = "\n\n".join(x for x in (prev_think, thinking_disp) if x) if prev else thinking_disp
        stored = (f"<think>{all_think}</think>\n\n{reply_disp}" if all_think else reply_disp)
        amsg = await chat_sessions.add_message(sid, "assistant", stored, lang=language)
        remember_err = None
        try:
            remember_err = await remember(char["id"], char["name"], sid, user_mid, query, reply_disp,
                                          language, chat_model, prev_session=s,
                                          embed_base=ep["embed_base"], embed_key=ep["embed_key"],
                                          chat_base=eff_chat_base, chat_key=eff_api_key)
        except Exception as e:
            remember_err = str(e)
            log.warning("remember() raised unexpectedly: %s", e)
        log.info("chat turn done: session=%s reply_chars=%d memory_error=%s", sid, len(reply_disp), bool(remember_err))
        yield "data: " + json.dumps({"type": "done", "message": amsg, "mood": mood,
                                     "memory_error": remember_err}) + "\n\n"

    handle = _start_gen(sid, gen)
    return StreamingResponse(handle.stream(), media_type="text/event-stream")
