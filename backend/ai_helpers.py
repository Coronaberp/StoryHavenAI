"""Side-call generators that turn free-form text into structured output via a
single instruct call each: image generation prompts, full character definitions
from a description, and persona expansion. Same pattern as the turn-signal
extractor in retrieval.py, but these aren't part of the chat turn itself —
they're invoked directly from routers (characters, personas, imagegen)."""
import json

from fastapi import HTTPException

from backend import llm
from backend.state import log, _sanitize_exc


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
        data = json.loads(llm.strip_json_fence("".join(out)))
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
        '"dialogue": "example exchanges as ONE plain string with real '
        "newlines between lines, alternating {{user}}: and {{char}}: — e.g. "
        '{{user}}: Hello, how are you? (newline) {{char}}: *adjusts glasses* '
        'Doing well, thanks for asking. — NEVER a JSON array of lines", '
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
        data = json.loads(llm.strip_json_fence("".join(out)))
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
        "dialogue": _normalize_dialogue(data.get("dialogue")),
        "tags": [str(t).strip() for t in tags if str(t).strip()],
        "mode": mode,
    }


def _normalize_dialogue(raw) -> str:
    if isinstance(raw, list):
        return "\n".join(str(line).strip() for line in raw if str(line).strip())
    text = str(raw or "").strip()
    if text.startswith("[") and text.endswith("]"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return "\n".join(str(line).strip() for line in parsed if str(line).strip())
        except (json.JSONDecodeError, TypeError):
            pass
    return text


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
    result = llm.strip_json_fence("".join(out)).strip().strip('"').strip()
    if not result:
        raise HTTPException(502, "The model did not return a usable persona. Try again or rephrase.")
    return result
