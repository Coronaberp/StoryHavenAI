import asyncio
import json
import re

from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import notifications as notification_repo
from backend import vectors
from backend import llm
from backend.state import api, CFG, log
from backend.auth import get_current_user, get_admin
from backend.chat_service import (_eff_cfg, _endpoints, _ui_language, _chat_language,
                          _localize_texts, _own_session, _glossary_note, _src_hash)
from backend.repositories import content_reports as content_report_repo
from backend.repositories import localization as localization_repo
from backend.prompt import strip_think
from backend.sampling import build_sampling_params
from backend.schemas import UiTranslateIn, LocalizeIn, ContentReportIn, ResyncUiTranslationsIn

SUPPORTED_UI_LANGUAGES = [
    "Tagalog", "Spanish (Spain)", "Turkish", "Simplified Chinese (Singapore)",
    "Russian", "Portuguese (Portugal)", "Japanese", "Hindi", "Tamil", "Arabic", "Hebrew", "Dutch",
]
UI_RESYNC_CONCURRENCY = 40
_ui_resync_running = False

@api.post("/report-image")
async def report_image(body: ContentReportIn, current_user: dict = Depends(get_current_user)):
    kind = (body.kind or "").strip()[:40] or "content"
    label = (body.label or "").strip()[:200] or "an image"
    note = (body.note or "").strip()[:500]
    target_id = (body.target_id or "").strip()[:100]
    image = (body.image or "").strip()[:500]
    if target_id:
        existing = await content_report_repo.get_pending_for(current_user["id"], kind, target_id)
        if existing:
            raise HTTPException(429, "You already reported this — an admin hasn't reviewed it yet.")
    rep = await content_report_repo.create(kind, label, target_id, image, current_user["id"], note)
    await notification_repo.notify_admins(
        "admin_image_report", "Content reported for review",
        f"{current_user['username']} reported {label} — please take a look."
        + (f" Note: {note}" if note else ""),
        "/admin/moderation", related_id=rep["id"])
    log.info("report-image: created id=%s kind=%s target=%s by=%s",
             rep["id"], kind, target_id, current_user["username"])
    return {"ok": True}

@api.post("/ui-translations")
async def ui_translations(body: UiTranslateIn, current_user: dict = Depends(get_current_user)):
    lang = (body.lang or "").strip() or "English"
    if lang.lower() == "english" or not body.strings:
        return {"lang": "English", "strings": body.strings}
    keys = list(body.strings)
    translated = await _localize_texts([body.strings[k] for k in keys], lang)
    return {"lang": lang, "strings": dict(zip(keys, translated))}

UI_RESYNC_BATCH_SIZE = 1000

async def _run_ui_translation_resync(strings: dict, admin_username: str):
    global _ui_resync_running
    ep = await _endpoints({}, None, False)
    chat_model = CFG["chat_model"]
    sem = asyncio.Semaphore(UI_RESYNC_CONCURRENCY)
    hashes = {k: _src_hash(v) for k, v in strings.items()}
    all_hashes = list(set(hashes.values()))

    work_items = []
    for lang in SUPPORTED_UI_LANGUAGES:
        lang_key = lang.lower()
        cached = await db.get_localizations(all_hashes, lang_key)
        for key, h in hashes.items():
            if h not in cached:
                work_items.append((lang, key))

    log.info("admin: UI translation resync started by=%s keys=%d languages=%d missing=%d",
             admin_username, len(strings), len(SUPPORTED_UI_LANGUAGES), len(work_items))

    async def _one(lang, key):
        async with sem:
            return await translate_text_live(strings[key], lang, chat_model, ep)

    total_translated = 0
    try:
        for i in range(0, len(work_items), UI_RESYNC_BATCH_SIZE):
            batch = work_items[i:i + UI_RESYNC_BATCH_SIZE]
            results = await asyncio.gather(*[_one(lang, key) for lang, key in batch])
            ok = sum(1 for r in results if r)
            total_translated += ok
            log.info("admin: UI translation resync batch %d/%d complete: %d/%d translated",
                     i // UI_RESYNC_BATCH_SIZE + 1,
                     (len(work_items) + UI_RESYNC_BATCH_SIZE - 1) // UI_RESYNC_BATCH_SIZE,
                     ok, len(batch))
    except Exception as e:
        log.error("admin: UI translation resync failed by=%s: %s: %s",
                 admin_username, type(e).__name__, e)
    finally:
        _ui_resync_running = False
        log.info("admin: UI translation resync finished by=%s missing=%d translated=%d",
                 admin_username, len(work_items), total_translated)

@api.post("/admin/resync-ui-translations")
async def admin_resync_ui_translations(body: ResyncUiTranslationsIn, current_user: dict = Depends(get_admin)):
    global _ui_resync_running
    if not body.strings:
        raise HTTPException(400, "no strings provided")
    if _ui_resync_running:
        raise HTTPException(409, "A UI translation resync is already running.")
    _ui_resync_running = True
    asyncio.create_task(_run_ui_translation_resync(body.strings, current_user["username"]))
    return {"started": True, "keys": len(body.strings), "languages": len(SUPPORTED_UI_LANGUAGES)}

@api.post("/localize")
async def localize(body: LocalizeIn, current_user: dict = Depends(get_current_user)):
    texts = [str(t) for t in body.texts][:100]
    if any(len(t) > 20000 for t in texts):
        raise HTTPException(400, "text too long to localize")
    user_overrides = await db.get_user_settings(current_user["id"])

    lang = (body.lang or "").strip() or _ui_language(user_overrides)
    if not texts:
        return {"lang": lang, "texts": texts}
    translated = await _localize_texts(texts, lang)
    return {"lang": lang, "texts": translated}

_TRANSLATE_REFUSAL_RE = re.compile(
    r"\b(please provide|no (source )?text (was|is) provided|no text was included|"
    r"i (see|notice|apologize)|source text is missing|to translate\??$)|"
    r"(请提供|未提供|没有提供|请提供源文本)",
    re.IGNORECASE)

async def translate_text_live(text: str, target: str, chat_model: str, ep: dict,
                              glossary: dict | None = None) -> str:
    text = text.strip()
    if not text:
        return text
    target = target.strip() or "English"
    glossary = glossary or {}
    lang = target.lower()

    cache_key = (_src_hash(text) if not glossary else
                _src_hash(text + "\x00" + json.dumps(sorted(glossary.items()), ensure_ascii=False)))
    cached = await localization_repo.get([cache_key], lang)
    if cache_key in cached:
        return cached[cache_key]
    msgs = [{"role": "system", "content":
             "You are a translation engine, not a roleplay character. You never continue a story, "
             "never add commentary, never stay in character. Given any text, including narration or "
             "dialogue from a story, your only job is to output its translation, nothing else."},
            {"role": "user", "content":
             f"Translate the following text to {target}, the way a native speaker would naturally read "
             f"it. Proper names (characters, places, countries) and any other names: leave them "
             f"completely untouched, exactly as spelled in the source, in their original script. "
             f"Never transliterate, respell, or localize a name, even if it is written in a script "
             f"different from {target}."
             f" Translate fantasy/RPG/technical terms (classes, spells, ranks, items) with the "
             f"standard term established {target} game and fantasy localizations use — the single "
             f"precise native word when one exists (e.g. an enchanter-class character is 'Efsuncu' "
             f"in Turkish, not a descriptive phrase like 'silah büyüleyen'), never a paraphrase."
             f" Preserve the source's markdown formatting exactly: keep every asterisk, quotation "
             f"mark, and line break in the same place around the same words, just translated."
             + _glossary_note(glossary) +
             " Reply with only the translation, nothing else:\n\n" + text}]
    params = build_sampling_params({"temperature": 0.2, "max_tokens": CFG.get("max_tokens", 1024)})

    async def _call(messages):
        out = ""
        async for channel, chunk in llm.chat_stream(messages, chat_model, params, parse_think=True,
                                                    base_url=ep["chat_base"], api_key=ep["chat_key"]):
            if channel == "content":
                out += chunk
        return out.strip()

    result = await _call(msgs)
    is_echo = target.lower() != "english" and result.lower() == text.lower()
    if is_echo and result:
        retry_result = await _call(msgs + [
            {"role": "assistant", "content": result},
            {"role": "user", "content":
             f"That was not translated — it is identical to the English source. {target} has its own "
             f"word or phrase for this; produce it now, even if it is a short or common word. Only "
             f"repeat the English source verbatim if it is a proper name or an established loanword "
             f"native speakers actually use untranslated in {target}. Reply with only the translation, "
             "nothing else."}])
        if retry_result:
            result = retry_result
            is_echo = target.lower() != "english" and result.lower() == text.lower()
    is_refusal = bool(result) and _TRANSLATE_REFUSAL_RE.search(result)
    if not result or is_echo or is_refusal:
        log.warning("translate: model returned an untranslated echo or refusal, discarding target=%s", target)
        return ""
    await localization_repo.set([(cache_key, text, result)], lang, kind="translate")
    return result

@api.post("/sessions/{sid}/summarize")
async def summarize_session(sid: str, current_user: dict = Depends(get_current_user)):
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
        log.warning("summarize: failed sid=%s by=%s: %s: %s",
                    sid, current_user["username"], type(e).__name__, e)
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

@api.get("/docs/live-config")
async def docs_live_config(_user: dict = Depends(get_current_user)):
    from backend.memory_service import BATCH_SIZE
    return {
        "memory_v2_budget_tokens": int(CFG.get("memory_v2_budget_tokens") or 1000),
        "memory_batch_size": int(BATCH_SIZE),
        "history_turns": int(CFG.get("history_turns") or 16),
        "top_k_memory": int(CFG.get("top_k_memory") or 4),
        "top_k_lore": int(CFG.get("top_k_lore") or 6),
        "mem_max_dist": float(CFG.get("mem_max_dist") or 0.8),
        "lore_max_dist": float(CFG.get("lore_max_dist") or 0.8),
    }
