"""Lore/memory retrieval for a chat turn, the per-turn signal-extraction side
call that distills what to remember, and the memory-storage entry point
(remember()) that ties them together."""
import re
import json

from backend import db
from backend import vectors
from backend import llm
from backend.state import CFG, log
from backend.repositories import chat_sessions


async def index_lore(lid, char_id, content, name: str = "", category: str = ""):
    """Embeds name/category alongside the body content, not content alone —
    entries are often written assuming their own title provides context (e.g.
    a "Sunken City" entry whose content never repeats that name), so semantic
    search on content-only text can miss exactly the query it should match.
    Category groups related entries under a shared label the author chose, so
    including it helps a query for the general topic surface the right entry
    even when the content wording doesn't overlap with the query."""
    try:
        prefix = ", ".join(p for p in (category, name) if p)
        embed_text = f"{prefix}: {content}" if prefix else content
        vec = await llm.embed(embed_text, CFG["embed_model"])
        await vectors.store_lore_vector(lid, char_id, vec)
    except Exception as e:
        log.warning("lore embedding failed for %s: %s", lid, e)


async def retrieve(char_id, session_id, query, recent, exclude_mid=None, cfg: dict = None,
                   embed_base: str | None = None, embed_key: str | None = None):
    """query and recent are both plain display text in whatever language the session
    is using — memory is embedded and stored in that same language (see remember()/
    _extract_turn_signal), so matching against it needs a query in that language too.
    Lore `keys` are typically authored in the user's own language, so keyword matching
    against raw display text is the right comparison for that half."""
    if cfg is None:
        cfg = CFG
    chosen = {}
    rt = (recent or "").lower()
    for e in await db.list_lore(char_id):
        if e["always"] or any(k.lower() in rt for k in e["keys"]):
            chosen[e["id"]] = e["content"]
    mem = []
    embed_error = None
    if query:
        try:
            # embed model/dim stay global (vectors share one index), but the endpoint
            # serving that model may be the user's own (see _endpoints)
            qvec = await llm.embed(query, CFG["embed_model"],
                                   base_url=embed_base, api_key=embed_key)
        except Exception as e:
            qvec = None
            embed_error = str(e)
            log.warning("retrieval embedding failed: %s", e)
        if qvec is not None:
            ids = await vectors.search_lore_ids(char_id, qvec, cfg["top_k_lore"], cfg["lore_max_dist"])
            for e in await db.lore_by_ids(ids):
                chosen.setdefault(e["id"], e["content"])
            mem = await vectors.search_memory(session_id, qvec, cfg["top_k_memory"],
                                              cfg["mem_max_dist"], exclude_id=exclude_mid)
    lore_lines = ["- " + c.replace("\n", " ").strip() for c in list(chosen.values())[:cfg["top_k_lore"] + 2] if c]
    mem_lines = ["- " + m.replace("\n", " ").strip() for m in mem]
    return lore_lines, mem_lines, embed_error


_OOC_RE = re.compile(r'^\s*\(OOC:', re.IGNORECASE)
# every slash-command directive the frontend can produce (ooc/note/scene/time/as/roll) —
# these are meta-communication or mechanics, not story content, and shouldn't be embedded
_DIRECTIVE_RE = re.compile(
    r"^\s*(\(OOC:|\*\[Scene:|\*\[Author's Note:|\*\[Time skip|\[[^\]]+ says\]:|🎲)",
    re.IGNORECASE)


async def _extract_turn_signal(user_text: str, char_name: str, reply_text: str, language: str,
                               chat_model: str, chat_base: str | None = None,
                               chat_key: str | None = None) -> dict:
    """One side call per turn that distills: (1) key facts worth remembering long-term,
    (2) what the character is doing/where right now, and (3) any named characters
    introduced — used for memory storage, the live character-state panel, and keeping
    established names from falling out of context. key_points is written in the
    session's own language so it can be embedded and matched directly against later
    queries in that same language; proper names are never translated or altered in
    any field."""
    prompt = (
        f"Analyze this roleplay exchange between the player and {char_name}. "
        f"Reply with only a JSON object, no other text, in exactly this format:\n"
        '{"key_points": "1-3 short third-person sentences of facts worth remembering '
        f'long-term, written in {language}; empty string if nothing is worth remembering", '
        f'"doing": "a short phrase (in {language}) describing what {char_name} is doing or '
        'experiencing right now, or empty string", '
        f'"location": "a short phrase (in {language}) describing where the current scene is '
        'taking place, or empty string", '
        f'"npcs": ["proper names of named characters mentioned in this exchange, excluding '
        f'{char_name} and the player — empty array if none"]}}\n'
        "Never translate, transliterate, or alter proper names in any field — copy them exactly "
        "as they appear in the text below.\n\n"
        f"Player: {user_text}\n{char_name}: {reply_text}"
    )
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": prompt}], chat_model, parse_think=True,
            base_url=chat_base, api_key=chat_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    try:
        data = json.loads(llm.strip_json_fence("".join(out)))
    except Exception:
        return {"key_points": "", "doing": "", "location": "", "npcs": []}
    return {
        "key_points": str(data.get("key_points") or "").strip(),
        "doing": str(data.get("doing") or "").strip(),
        "location": str(data.get("location") or "").strip(),
        "npcs": [str(n).strip() for n in (data.get("npcs") or []) if str(n).strip()],
    }


async def remember(char_id, char_name, session_id, user_mid, user_text, reply_text, language,
                   chat_model, prev_session: dict = None,
                   embed_base: str | None = None, embed_key: str | None = None,
                   chat_base: str | None = None, chat_key: str | None = None):
    """Memory is stored in the session's own display language — there is no separate
    canon language anymore."""
    if not (user_text and reply_text):
        return None
    # commands/meta exchanges are not story content — don't pollute semantic memory
    # or the character-state tracker
    if _DIRECTIVE_RE.match(user_text) or _OOC_RE.match(reply_text):
        return None
    try:
        signal = await _extract_turn_signal(user_text, char_name, reply_text, language, chat_model,
                                            chat_base=chat_base, chat_key=chat_key)
    except Exception as e:
        log.warning("turn-signal extraction failed for turn %s: %s", user_mid, e)
        signal = {"key_points": "", "doing": "", "location": "", "npcs": []}

    prev = prev_session or {}
    try:
        known = set(json.loads(prev.get("known_names") or "[]"))
        known.update(signal["npcs"])
        await chat_sessions.set_char_state(
            session_id,
            doing=signal["doing"] or prev.get("char_doing"),
            location=signal["location"] or prev.get("char_location"),
            known_names=sorted(known))
    except Exception as e:
        log.warning("character-state update failed for turn %s: %s", user_mid, e)

    if not signal["key_points"]:
        return None
    try:
        vec = await llm.embed(signal["key_points"], CFG["embed_model"],  # model is global; endpoint may be the user's
                              base_url=embed_base, api_key=embed_key)
    except Exception as e:
        log.warning("memory embedding failed for turn %s: %s", user_mid, e)
        return str(e)
    await vectors.store_memory(char_id, session_id, signal["key_points"], vec, mem_id=user_mid)
    return None
