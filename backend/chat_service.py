"""Chat/generation service: config resolution, endpoint guard, retrieval,
memory, side-call extractors, the SSE generation machinery, and _run."""
import io
import re
import json
import base64
import hashlib
import asyncio

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from PIL import Image

from backend import db
from backend import vectors
from backend import llm
from backend.state import CFG, VISION_CLASSIFY, log, _sanitize_exc, USER_CFG_KEYS
from backend.ssrf import _resolve_host_ip_issue
from backend.prompt import (build_system, think_instruction, strip_think, macro,
                    build_sampling_params, character_moods, parse_mood, recent_text,
                    ensure_scene_header)

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
                await db.flag_endpoint(user_id, chat_base, chat_key or "",
                                       f"became unsafe at request time: {issue}")
            chat_base, chat_key = None, None
    return {
        "chat_base": chat_base,
        "chat_key": chat_key,
        "embed_base": None,
        "embed_key": None,
    }


def _is_animated_gif(raw: bytes | None) -> bool:
    if not raw:
        return False
    try:
        img = Image.open(io.BytesIO(raw))
        return img.format == "GIF" and getattr(img, "is_animated", False)
    except Exception:
        return False


async def classify_image_nsfw(image: bytes | str, mime: str = "image/png",
                              user_id: str | None = None, is_admin: bool = False) -> tuple[bool, int]:
    """Shared auto-NSFW classifier for every image upload/save path. `image` is
    either raw bytes or an already-built `data:image/...;base64,...` URL. Sends
    the image to the effective chat (vision) endpoint and returns
    (is_explicit, confidence_0_100). Any failure returns (False, 0) — fail-open
    on the classifier verdict itself (never blocks the save), but confidence 0
    still reads as "not confident" for callers that flag low-confidence calls.

    Animated GIFs are never actually sent to the classifier: a vision model
    is handed a single decoded frame like any other image format (there's no
    "look at the whole animation" path), so a verdict on frame 0 says nothing
    about what the other frames show. Reporting that as a confident classification
    would be worse than reporting nothing — this returns (False, 0) immediately,
    which callers already treat as "needs a human look" via on_low_confidence."""
    # Detected from the actual bytes, not the caller-supplied mime — several
    # call sites pass a hardcoded "image/png" regardless of what was actually
    # uploaded, so trusting mime here would miss real GIFs at those call sites.
    if isinstance(image, (bytes, bytearray)) and _is_animated_gif(bytes(image)):
        log.info("nsfw-classify user=%s: animated GIF, skipping unreliable single-frame classification", user_id)
        return False, 0
    if isinstance(image, (bytes, bytearray)):
        data_url = f"data:{mime};base64," + base64.b64encode(bytes(image)).decode()
    else:
        data_url = image
    if not data_url or not data_url.startswith("data:image/"):
        return False, 0
    flagged, confidence, raw = await llm.classify_image_explicit(
        data_url, VISION_CLASSIFY["model"],
        base_url=VISION_CLASSIFY["base_url"], api_key=VISION_CLASSIFY["api_key"])
    log.info("nsfw-classify user=%s flagged=%s confidence=%s raw=%r", user_id, flagged, confidence, (raw or "")[:60])
    return flagged, confidence


_bg_classify_tasks: set = set()


def classify_image_background(image: bytes | str, mime: str, user_id: str | None,
                             is_admin: bool, apply, on_done=None, on_low_confidence=None,
                             review_context: str = "an uploaded image"):
    """Fire-and-forget NSFW classification. Runs the ~1.7s vision round-trip off
    the request path so an upload returns immediately, then calls `apply` (an
    async no-arg callable that flags the just-saved row explicit) only if the
    model flags it. The image is briefly visible unblurred until this resolves;
    acceptable because every upload is private or owner-only at save time
    (standalone images stay private until an explicit separate share, chat images
    are session-scoped, a profile/character/lore image is the owner's own), and
    the classifier was always fail-open (never a hard guarantee).
    on_done, if given, is an async callable(explicit: bool) invoked regardless
    of the outcome (including on a classification failure, with explicit=False)
    — for callers that need to know classification actually ran, not just that
    it flagged something (e.g. gating a share action on "has been rated").
    on_low_confidence, if given, is an async callable(explicit: bool, confidence:
    int) invoked only when the model's own reported confidence is below 80 —
    the verdict is still applied as usual either way (confidence never changes
    what gets stored), this is purely for surfacing a "might be worth a second
    look" flag to admins on top of that.
    review_context is a short human-readable label ("a profile avatar", "a lore
    image", ...) used only for the fallback admin notification below — callers
    that already pass on_low_confidence with their own queue-entry logic aren't
    affected by it."""
    async def _run():
        explicit = False
        confidence = 0
        try:
            explicit, confidence = await classify_image_nsfw(image, mime, user_id, is_admin)
            if explicit:
                await apply()
            if confidence < 80:
                if on_low_confidence:
                    await on_low_confidence(explicit, confidence)
                elif isinstance(image, (bytes, bytearray)) and _is_animated_gif(bytes(image)):
                    # Callers that don't wire up their own review-queue entry (most
                    # upload paths besides standalone imagegen saves) still get a
                    # best-effort admin ping for GIFs specifically — the classifier
                    # only ever sees frame 0 of an animation (see classify_image_nsfw),
                    # so this is the only signal a human ever gets that this upload
                    # wasn't meaningfully vetted at all.
                    await db.notify_admins(
                        "admin_image_report", "Animated GIF needs manual rating",
                        f"{review_context.capitalize()} was uploaded as an animated GIF — "
                        "the NSFW classifier can't reliably judge animations, so this was "
                        "never actually rated. Please review it directly.",
                        "/admin/moderation")
        except Exception as e:
            log.warning("background nsfw classify failed: %s", e)
        if on_done:
            try:
                await on_done(explicit)
            except Exception as e:
                log.warning("background nsfw classify on_done failed: %s", e)
    task = asyncio.create_task(_run())
    _bg_classify_tasks.add(task)
    task.add_done_callback(_bg_classify_tasks.discard)


def _data_url_to_bytes(data_url: str) -> tuple[bytes, str] | tuple[None, None]:
    """(bytes, mime) from a data:image/...;base64,... URL, or (None, None)."""
    if not data_url or not data_url.startswith("data:image/"):
        return None, None
    try:
        header, b64 = data_url.split(",", 1)
        mime = header.split(":", 1)[1].split(";", 1)[0]
        return base64.b64decode(b64), mime
    except Exception:
        return None, None


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


def _strip_json_fence(raw: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.IGNORECASE).strip()


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
        data = json.loads(_strip_json_fence("".join(out)))
    except Exception:
        return {"key_points": "", "doing": "", "location": "", "npcs": []}
    return {
        "key_points": str(data.get("key_points") or "").strip(),
        "doing": str(data.get("doing") or "").strip(),
        "location": str(data.get("location") or "").strip(),
        "npcs": [str(n).strip() for n in (data.get("npcs") or []) if str(n).strip()],
    }


_DEFAULT_NEGATIVE_TAGS = "worst quality, low quality, blurry, watermark, signature, bad anatomy, extra limbs, deformed"


async def _generate_image_prompt(scene_text: str, char_name: str, chat_model: str,
                                 appearance_lines: list[str] | None = None,
                                 direct_tags: list[str] | None = None,
                                 direct_negative_tags: list[str] | None = None,
                                 chat_base: str | None = None,
                                 chat_key: str | None = None) -> tuple[str, str]:
    """SDXL/Illustrious-family checkpoints are trained on Danbooru-style comma-separated
    tags, not prose — so the scene text is run through a dedicated instruct call that
    distills it into positive and negative tag lists, the same side-call pattern as
    _extract_turn_signal.

    appearance_lines carries any lore entries whose keyword(s) matched the scene (same
    keyword-trigger logic as retrieve()'s chat-context lore lookup) plus the character's
    own persona/description — without this, the model has to guess what a named character
    or place actually looks like instead of using what's already been established.

    direct_tags/direct_negative_tags carry pre-written Danbooru tags (from each lore
    entry's own Appearance tags fields) that are prepended verbatim ahead of the model's
    own tags — earlier tags carry more weight in most SD samplers, so when an author has
    hand-written the exact tags for a character, those take priority over the model's
    paraphrase."""
    context_block = ""
    if appearance_lines:
        context_block = ("\nEstablished appearance/setting details — use these, don't invent "
                         "conflicting ones, for anyone/anything named below:\n" +
                         "\n".join(appearance_lines) + "\n")
    instruct = (
        "You convert roleplay scene text into a Danbooru-style image generation prompt "
        "for a Stable Diffusion XL / Illustrious model. Reply with only a JSON object, no "
        "other text, in exactly this format:\n"
        '{"positive": "comma-separated tags describing subject (character appearance, pose, '
        'expression), setting/background, lighting/mood, and style — under 60 tags", '
        '"negative": "comma-separated tags for things to avoid (bad anatomy, extra limbs, '
        'low quality, artifacts, anything that contradicts the scene) — under 30 tags"}\n'
        "Use lowercase tags the way Danbooru itself writes them (e.g. \"long hair\", "
        "\"looking at viewer\", \"outdoors\", \"dramatic lighting\"). If a named character or "
        "place below has established appearance details, translate those specifically into "
        "tags rather than generic ones.\n"
        f"{context_block}\n"
        f"Scene, centered on {char_name}:\n{scene_text}"
    )
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": instruct}], chat_model, parse_think=True,
            base_url=chat_base, api_key=chat_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    try:
        data = json.loads(_strip_json_fence("".join(out)))
        positive = str(data.get("positive") or "").strip()
        negative = str(data.get("negative") or "").strip()
    except Exception:
        positive, negative = "", ""
    if not positive:
        positive = scene_text[:300]
    if not negative:
        negative = _DEFAULT_NEGATIVE_TAGS
    if direct_tags:
        positive = ", ".join(direct_tags) + (", " + positive if positive else "")
    if direct_negative_tags:
        negative = ", ".join(direct_negative_tags) + (", " + negative if negative else "")
    return positive, negative


async def generate_character_from_description(description: str, chat_model: str,
                                              chat_base: str | None = None,
                                              chat_key: str | None = None) -> dict:
    """Expand a free-form plaintext character description into structured
    editor fields via one instruct call, same side-call pattern as
    _generate_image_prompt. No lore/lorebook entries are produced. Raises
    HTTPException(502) if the model's reply can't be parsed as JSON."""
    instruct = (
        "You are a character designer for a roleplay platform. Expand the "
        "user's free-form description below into a complete, structured "
        "character definition. Reply with ONLY a JSON object, no other text, "
        "in exactly this format:\n"
        '{"name": "the character\'s name", '
        '"persona": "the character\'s core personality, background, traits, '
        'quirks, and speaking style — this is the main internal definition the '
        'model roleplays from; write it in detail as prose or bullet points", '
        '"scenario": "the setting/situation the roleplay opens in", '
        '"greeting": "the character\'s first message to the user, written '
        'in-character", '
        '"dialogue": "a few example lines demonstrating how the character '
        'speaks (their voice, tone, verbal tics)", '
        '"tags": ["short", "relevant", "tags"], '
        '"mode": "character or rpg"}\n'
        "Field meaning: persona is the internal personality/background the "
        "model uses to play the character; scenario is the opening "
        "situation/setting; greeting is the literal first message; dialogue is "
        "example speech samples. Do NOT invent a public blurb or system prompt "
        "— only fill the fields above.\n"
        "Write greeting and dialogue using this app's runtime formatting "
        "convention: *italics* for actions and physical reactions, \"quotes\" "
        "for spoken dialogue.\n"
        "Choose mode = \"rpg\" if the description implies a game-master/narrator "
        "style with a world, multiple NPCs, and third-person narrated events; "
        "choose mode = \"character\" if it implies a single character speaking "
        "directly to the user in first person.\n\n"
        f"Description:\n{description}"
    )
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": instruct}], chat_model, parse_think=True,
            base_url=chat_base, api_key=chat_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    try:
        data = json.loads(_strip_json_fence("".join(out)))
    except Exception as e:
        log.warning("character generation: unparseable model reply: %s", _sanitize_exc(e))
        raise HTTPException(502, "The model did not return a usable character. Try again or rephrase.")
    if not isinstance(data, dict):
        raise HTTPException(502, "The model did not return a usable character. Try again or rephrase.")
    tags = data.get("tags") or []
    if not isinstance(tags, list):
        tags = [t.strip() for t in str(tags).split(",") if t.strip()]
    mode = data.get("mode") if data.get("mode") in ("character", "rpg") else "character"
    return {
        "name": str(data.get("name") or "").strip() or "Unnamed",
        "persona": str(data.get("persona") or "").strip(),
        "scenario": str(data.get("scenario") or "").strip(),
        "greeting": str(data.get("greeting") or "").strip(),
        "dialogue": str(data.get("dialogue") or "").strip(),
        "tags": [str(t).strip() for t in tags if str(t).strip()],
        "mode": mode,
    }


async def expand_persona_description(text: str, chat_model: str,
                                     chat_base: str | None = None,
                                     chat_key: str | None = None) -> str:
    """Expand/normalize a persona description via one instruct call. The input
    may already be a full, well-formed persona OR just a handful of short
    descriptor keywords/phrases; either way the model returns a single complete
    persona description as plain text — no JSON. Same side-call pattern as
    generate_character_from_description. Returns the expanded text with any
    stray code-fence/quote wrapper stripped."""
    instruct = (
        "You write player-character personas for a roleplay platform. A persona "
        "is the profile of the person the user is playing as; it is fed to the "
        "character the user chats with, under a \"Player character\" heading, so "
        "it must read naturally as a description of who the player is.\n"
        "Take the input below and turn it into ONE complete, well-written persona "
        "description. The input may already be a full persona — in that case "
        "lightly polish it and return it essentially intact, never shrink or "
        "mangle it — or it may be just a few short descriptors, in which case "
        "expand them into full, characterful prose.\n"
        "The result must be both machine-readable (works well as the actual "
        "persona text in a system prompt) AND human-readable (flowing natural "
        "prose a person enjoys reading, not a dry stat block). Write in third "
        "person, a short paragraph or two. Reply with ONLY the persona text — no "
        "preamble, no labels, no quotes, no code fences.\n\n"
        "Example — short descriptors:\n"
        "\"witty rogue, sarcastic, loyal to friends, hates authority\"\n"
        "Example — expanded persona:\n"
        "Tarion is a quick-witted rogue with a sharp tongue and sharper instincts, "
        "shaped by years of staying one step ahead of city guards who never "
        "appreciated his particular talents. He trusts institutions and authority "
        "about as far as he can throw them, but the handful of people who've earned "
        "his loyalty get it fiercely and without hesitation — he'd talk his way out "
        "of a noose for a friend before he'd admit he was ever scared. Sarcasm is "
        "his first language and his best defense; a joke comes faster to him than "
        "an honest feeling ever will.\n\n"
        f"Input:\n{text}"
    )
    out = []
    async for channel, chunk in llm.chat_stream(
            [{"role": "user", "content": instruct}], chat_model, parse_think=True,
            base_url=chat_base, api_key=chat_key, pin_host=True):
        if channel == "content":
            out.append(chunk)
    result = _strip_json_fence("".join(out)).strip().strip('"').strip()
    if not result:
        raise HTTPException(502, "The model did not return a usable persona. Try again or rephrase.")
    return result


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
        await db.set_char_state(
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


async def _own_session(sid: str, current_user: dict) -> dict:
    """Fetch a session and enforce ownership. Raises 404 if missing/unowned."""
    s = await db.get_session(sid)
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
        user_overrides = await db.get_user_settings(current_user["id"])
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    eff_chat_base, eff_api_key = ep["chat_base"], ep["chat_key"]
    chat_model = eff.get("chat_model") or CFG["chat_model"]

    s = await db.get_session(sid)
    if not s:
        raise HTTPException(404, "session not found")
    char = await db.get_character(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")
    persona = await db.get_persona(s["persona_id"]) if s.get("persona_id") else None
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
        _msgs0 = await db.get_messages(sid)
        prev = next((m for m in reversed(_msgs0) if m["role"] == "assistant"), None)
        if not prev:
            raise HTTPException(400, "nothing to continue")
        await db.pop_trailing_assistant(sid)

    if regenerate:
        await db.pop_trailing_assistant(sid)
    elif user_content is not None:
        await db.add_message(sid, "user", user_content)

    msgs = await db.get_messages(sid)
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
        amsg = await db.add_message(sid, "assistant", stored, lang=language)
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

