import time

import httpx
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from backend import tts
from backend.auth import get_current_user
from backend.chat_service import _own_session
from backend.feature_flags import require_feature_enabled
from backend.prompt import strip_think
from backend.ratelimit import SlidingWindow
from backend.repositories import characters as characters_repo
from backend.repositories import chat_sessions
from backend.state import CFG, api, log
from backend.tts import endpoint_cache_host

_speech_limiter = SlidingWindow(20, 60.0, "Too many voice requests, give it a moment.")
_preview_limiter = SlidingWindow(10, 60.0, "Too many previews, give it a moment.")
_voices_cache: dict = {}
_VOICES_CACHE_SECONDS = 300
_PREVIEW_SENTENCE = "The tavern falls quiet as the storyteller begins."

class VoiceOverridesIn(BaseModel):
    character_voice: str | None = None
    narrator_voice: str | None = None

class PreviewIn(BaseModel):
    voice: str

def _clean_voice(value: str | None) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    if len(value) > 64:
        raise HTTPException(400, "Voice id is too long.")
    return value

def normalize_voice_entries(entries: list) -> list[str]:
    result = []
    for entry in entries:
        voice_id = None
        if isinstance(entry, dict):
            voice_id = entry.get("id") or entry.get("name")
        elif isinstance(entry, str):
            voice_id = entry
        if isinstance(voice_id, str) and voice_id:
            result.append(voice_id)
    return result

async def _resolve_voices(session: dict, message: dict) -> tuple[str, str]:
    overrides = session.get("voice_overrides") or {}
    narrator = _clean_voice(overrides.get("narrator_voice")) or CFG.get("tts_narrator_voice") or "af_heart"
    char_voice = _clean_voice(overrides.get("character_voice"))
    if not char_voice:
        char_id = message.get("char_id") or session["char_id"]
        character = await characters_repo.get(char_id)
        char_voice = _clean_voice((character or {}).get("voice"))
    return char_voice or narrator, narrator

@api.post("/sessions/{sid}/messages/{mid}/speech", dependencies=[Depends(require_feature_enabled("tts"))])
async def speak_message(sid: str, mid: str, current_user: dict = Depends(get_current_user)):
    session = await _own_session(sid, current_user)
    _speech_limiter.check_and_record(current_user["id"])
    messages = await chat_sessions.list_messages(sid)
    message = next((m for m in messages if m["id"] == mid), None)
    if not message:
        raise HTTPException(404, "Message not found.")
    if message["role"] != "assistant":
        raise HTTPException(400, "Only character messages can be spoken.")
    spoken = strip_think(message["content"])
    if "<think>" in spoken:
        spoken = spoken.split("<think>")[0].strip()
    if not spoken:
        raise HTTPException(400, "There is nothing to speak in this message.")
    if len(spoken) > tts.MAX_TTS_CHARS:
        raise HTTPException(413, "This message is too long to speak.")
    char_voice, narrator_voice = await _resolve_voices(session, message)
    started = time.time()
    try:
        url, cached = await tts.synthesize_message(spoken, char_voice,
                                                   narrator_voice, current_user["id"])
    except tts.TTSUnavailable as exc:
        log.warning("tts: synthesis failed sid=%s mid=%s: %s", sid, mid, exc)
        raise HTTPException(502, "The voice engine is not responding right now.")
    log.info("tts: spoke sid=%s mid=%s cached=%s ms=%d", sid, mid, cached,
             int((time.time() - started) * 1000))
    return {"url": url, "cached": cached}

@api.post("/tts/preview", dependencies=[Depends(require_feature_enabled("tts"))])
async def preview_voice(body: PreviewIn, current_user: dict = Depends(get_current_user)):
    _preview_limiter.check_and_record(current_user["id"])
    voice = _clean_voice(body.voice)
    if not voice:
        raise HTTPException(400, "Pick a voice to preview.")
    try:
        url, _ = await tts.synthesize_message(_PREVIEW_SENTENCE, voice, voice, current_user["id"])
    except tts.TTSUnavailable as exc:
        log.warning("tts: preview failed voice=%s: %s", voice, exc)
        raise HTTPException(502, "The voice engine is not responding right now.")
    return {"url": url}

@api.get("/tts/voices", dependencies=[Depends(require_feature_enabled("tts"))])
async def list_voices(current_user: dict = Depends(get_current_user)):
    base_url, api_key, is_admin = await tts.resolve_endpoint(current_user["id"])
    if not base_url:
        return {"voices": []}
    now = time.time()
    endpoint_key = endpoint_cache_host(base_url)
    cached = _voices_cache.get(endpoint_key)
    if cached and now - cached["at"] < _VOICES_CACHE_SECONDS and cached["voices"]:
        return {"voices": cached["voices"]}
    try:
        pinned_base, original_host = await tts.pin_endpoint(base_url, is_admin)
    except ValueError as exc:
        log.warning("tts: voice list endpoint failed dns pinning: %s", type(exc).__name__)
        _voices_cache[endpoint_key] = {"at": now, "voices": []}
        return {"voices": []}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    extensions = {}
    if original_host:
        headers["Host"] = original_host
        extensions["sni_hostname"] = original_host
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            req = client.build_request("GET", f"{pinned_base}/audio/voices", headers=headers,
                                       extensions=extensions)
            response = await client.send(req)
        raw_voices = response.json().get("voices", []) if response.status_code == 200 else []
        voices = normalize_voice_entries(raw_voices)
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("tts: voice list failed: %s", type(exc).__name__)
        voices = []
    _voices_cache[endpoint_key] = {"at": now, "voices": voices}
    return {"voices": voices}

@api.put("/sessions/{sid}/voices")
async def set_session_voices(sid: str, body: VoiceOverridesIn,
                             current_user: dict = Depends(get_current_user)):
    await _own_session(sid, current_user)
    await chat_sessions.set_voice_overrides(sid, {
        "character_voice": _clean_voice(body.character_voice),
        "narrator_voice": _clean_voice(body.narrator_voice)})
    log.info("tts: session voices updated sid=%s by=%s", sid, current_user["username"])
    return {"ok": True}
