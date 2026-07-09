"""Translation/localization, summarize, health, and embed-test routes."""
import json

from fastapi import HTTPException, Depends

from backend import db
from backend import vectors
from backend import llm
from backend.state import api, CFG
from backend.auth import get_current_user
from backend.chat_service import (_eff_cfg, _endpoints, _ui_language, _chat_language,
                          _localize_texts, _own_session, _glossary_note, _src_hash)
from backend.prompt import strip_think, build_sampling_params
from backend.schemas import UiTranslateIn, LocalizeIn, TranslateIn

@api.post("/ui-translations")
async def ui_translations(body: UiTranslateIn, current_user: dict = Depends(get_current_user)):
    """Looks up the static UI chrome (nav, settings modal, buttons — see UI_STRINGS
    in app.js) in the persistent localization cache for the requested language.
    Read-only: strings not already cached (see /api/translate) come back as the
    English source unchanged."""
    lang = (body.lang or "").strip() or "English"
    if lang.lower() == "english" or not body.strings:
        return {"lang": "English", "strings": body.strings}
    keys = list(body.strings)
    translated = await _localize_texts([body.strings[k] for k in keys], lang)
    return {"lang": lang, "strings": dict(zip(keys, translated))}


@api.post("/localize")
async def localize(body: LocalizeIn, current_user: dict = Depends(get_current_user)):
    """Batch content localization lookup for user-authored display text (scenarios,
    character personas, greetings, persona descriptions) against the persistent
    localization table (see _localize_texts) — read-only, strings not already
    cached (see /api/translate) come back as source text unchanged."""
    texts = [str(t) for t in body.texts][:100]
    if any(len(t) > 20000 for t in texts):
        raise HTTPException(400, "text too long to localize")
    user_overrides = await db.get_user_settings(current_user["id"])
    # Unlike the UI chrome (whose source is always English), user-authored content can
    # be written in any language — so English is a real translation target here, not a
    # passthrough.
    lang = (body.lang or "").strip() or _ui_language(user_overrides)
    if not texts:
        return {"lang": lang, "texts": texts}
    translated = await _localize_texts(texts, lang)
    return {"lang": lang, "texts": translated}


@api.post("/translate")
async def translate_text(body: TranslateIn, current_user: dict = Depends(get_current_user)):
    """Reader-facing, on-demand translation (the 🌐 button) — translates arbitrary
    message text to a target language, localizing names to their established
    spelling (e.g. 约翰 -> John) rather than a bare transliteration. Never touches
    stored content. Results ARE persisted in the localization table (kind='translate'),
    keyed on the source text plus the session's known_names (names change what the
    correct translation is), so re-translating the same message is a pure DB read."""
    text = body.text.strip()
    if not text:
        return {"translated": text}
    target = (body.target or "").strip() or "English"
    user_overrides = await db.get_user_settings(current_user["id"]) if current_user else {}
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    chat_model = eff.get("chat_model") or CFG["chat_model"]
    known_names = []
    glossary = {}
    if body.sid:
        try:
            s = await _own_session(body.sid, current_user)
            known_names = json.loads(s.get("known_names") or "[]")
            glossary = json.loads(s.get("glossary") or "{}")
        except HTTPException:
            pass
    lang = target.lower()
    gl_fp = json.dumps(sorted(glossary.items()), ensure_ascii=False) if glossary else ""
    cache_key = _src_hash(text + "\x00" + "\x00".join(sorted(known_names)) + gl_fp)
    cached = await db.get_localizations([cache_key], lang)
    if cache_key in cached:
        return {"translated": cached[cache_key]}
    names_note = (
        f" These characters/places are established canon: {', '.join(known_names)} — "
        f"if the source text refers to one of them (even via a transliterated or phonetic rendering), "
        f"render it the way an official localization would, consistently — meaning-bearing names "
        f"translated into natural {target} names, phonetic names transliterated into {target}'s "
        f"script, never a mixed-script or one-off rendering."
    ) if known_names else ""
    msgs = [{"role": "user", "content":
             f"Translate the following text to {target}, the way a native speaker would naturally read "
             f"it. Proper names (characters, places, countries): if already written in the script "
             f"{target} uses, keep them EXACTLY as-is — never respell or phonetically adapt them. "
             f"Names in a different script come back in their natural, established {target} form — "
             f"e.g. a Chinese rendering of an English name comes back as that English name."
             f" Translate fantasy/RPG/technical terms (classes, spells, ranks, items) with the "
             f"standard term established {target} game and fantasy localizations use — the single "
             f"precise native word when one exists (e.g. an enchanter-class character is 'Efsuncu' "
             f"in Turkish, not a descriptive phrase like 'silah büyüleyen'), never a paraphrase."
             + _glossary_note(glossary) + names_note +
             " Reply with only the translation, nothing else:\n\n" + text}]
    params = build_sampling_params({"temperature": 0.3, "max_tokens": CFG.get("max_tokens", 1024)})
    result = ""
    async for channel, chunk in llm.chat_stream(msgs, chat_model, params, parse_think=True,
                                                base_url=ep["chat_base"], api_key=ep["chat_key"]):
        if channel == "content":
            result += chunk
    result = result.strip()
    if result:
        await db.set_localizations([(cache_key, text, result)], lang, kind="translate")
    return {"translated": result}


@api.post("/sessions/{sid}/summarize")
async def summarize_session(sid: str, current_user: dict = Depends(get_current_user)):
    """One-off recap: reads the transcript and returns a summary WITHOUT touching
    session history or memory — nothing here is persisted, so it never pollutes
    the story with meta/OOC turns."""
    await _own_session(sid, current_user)
    user_overrides = await db.get_user_settings(current_user["id"]) if current_user else {}
    eff = _eff_cfg(user_overrides)
    ep = await _endpoints(user_overrides, current_user["id"] if current_user else None,
                          bool(current_user and current_user.get("is_admin")))
    eff_chat_base, eff_api_key = ep["chat_base"], ep["chat_key"]

    s = await db.get_session(sid)
    if not s:
        raise HTTPException(404, "session not found")
    char = await db.get_character(s["char_id"])
    if not char:
        raise HTTPException(404, "character not found")
    persona = await db.get_persona(s["persona_id"]) if s.get("persona_id") else None
    user_name = (persona["name"] if persona else None) or s.get("user_name") or "You"
    language = _chat_language(s, user_overrides)

    msgs = await db.get_messages(sid)
    if not msgs:
        return {"summary": "Nothing has happened yet — the story hasn't started."}

    lines = []
    for m in msgs[-80:]:
        who = char["name"] if m["role"] == "assistant" else user_name
        body = strip_think(m["content"]).strip()
        if body:
            lines.append(f"{who}: {body}")
    transcript = "\n".join(lines)

    system = (f"You are summarizing a roleplay story between {user_name} and {char['name']}. "
              "Read the transcript and write a brief recap in 2-3 short paragraphs covering "
              "the key events, decisions, and the current situation. Write it as a narrator "
              "would, in plain prose — no meta-commentary, no headers, no bullet points. "
              f"Write the recap entirely in {language}, regardless of what language the transcript "
              "below is written in.")
    oai_messages = [{"role": "system", "content": system}, {"role": "user", "content": transcript}]
    chat_model = eff.get("chat_model") or CFG["chat_model"]
    params = build_sampling_params(eff)

    result = []
    try:
        async for channel, chunk in llm.chat_stream(
                oai_messages, chat_model, params, parse_think=True,
                base_url=eff_chat_base, api_key=eff_api_key):
            if channel == "content":
                result.append(chunk)
    except Exception as e:
        raise HTTPException(502, f"summarize failed: {e}")
    return {"summary": "".join(result).strip()}


@api.get("/health")
async def health(_: dict = Depends(get_current_user)):
    out = {"ok": True, "chat_model": CFG["chat_model"], "embed_model": CFG["embed_model"],
           "base_url": CFG["base_url"]}
    out.update(await vectors.stats())
    try:
        out["characters"] = len(await db.list_characters())
    except Exception as e:
        out["ok"] = False
        out["db_error"] = str(e)
    try:
        vec = await llm.embed("connection test", CFG["embed_model"])
        out["embeddings"] = {"ok": True, "dim": len(vec)}
        if len(vec) != CFG["embed_dim"]:
            out["embeddings"]["warning"] = (
                f"embedding returned {len(vec)} dims but embed_dim is set to "
                f"{CFG['embed_dim']} — update Embed dim in Settings or memory search will fail.")
    except Exception as e:
        out["embeddings"] = {"ok": False, "error": str(e)}
    return out


@api.post("/settings/test-embed")
async def test_embed(_: dict = Depends(get_current_user)):
    try:
        vec = await llm.embed("connection test", CFG["embed_model"])
        return {"ok": True, "dim": len(vec), "url": llm.embed_url()}
    except Exception as e:
        return {"ok": False, "error": str(e), "url": llm.embed_url()}

