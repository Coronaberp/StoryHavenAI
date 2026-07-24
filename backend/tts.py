import hashlib
import io
import os
import re
import uuid
import wave

import httpx

from backend import db
from backend.state import CFG, MEDIA_DIR, log

MAX_TTS_CHARS = 4000
TTS_TIMEOUT_SECONDS = 120

class TTSUnavailable(Exception):
    pass

_DIALOGUE_RE = re.compile("\"([^\"]*)\"|“([^”]*)”")
_OPEN_QUOTES = {'"', chr(0x201c)}

def segment_speech(text: str) -> list[tuple[str, str]]:
    segments = []
    pos = 0
    for match in _DIALOGUE_RE.finditer(text):
        narration = text[pos:match.start()].strip()
        if narration:
            segments.append(("narration", narration))
        dialogue = (match.group(1) or match.group(2) or "").strip()
        if dialogue:
            segments.append(("dialogue", dialogue))
        pos = match.end()
    tail = text[pos:].strip()
    if not tail:
        return segments
    unclosed_quote_idx = -1
    for i, char in enumerate(tail):
        if char in _OPEN_QUOTES:
            unclosed_quote_idx = i
            break
    if unclosed_quote_idx >= 0:
        narration = tail[:unclosed_quote_idx].strip()
        if narration:
            segments.append(("narration", narration))
        dialogue = tail[unclosed_quote_idx + 1:].strip()
        if dialogue:
            segments.append(("dialogue", dialogue))
        return segments
    segments.append(("narration", tail))
    return segments

def concat_wavs(blobs: list[bytes]) -> bytes:
    params = None
    frames = []
    for blob in blobs:
        with wave.open(io.BytesIO(blob)) as reader:
            current = (reader.getnchannels(), reader.getsampwidth(), reader.getframerate())
            if params is None:
                params = current
            elif current != params:
                raise ValueError("tts segments have mismatched audio parameters")
            frames.append(reader.readframes(reader.getnframes()))
    out = io.BytesIO()
    with wave.open(out, "wb") as writer:
        writer.setnchannels(params[0])
        writer.setsampwidth(params[1])
        writer.setframerate(params[2])
        for frame in frames:
            writer.writeframes(frame)
    return out.getvalue()

def endpoint_cache_host(base_url: str) -> str:
    parsed = httpx.URL(base_url)
    return f"{parsed.host}:{parsed.port}" if parsed.host else base_url

def speech_cache_key(content: str, char_voice: str, narrator_voice: str, endpoint_host: str) -> str:
    material = "\x00".join([content, char_voice, narrator_voice, endpoint_host])
    return hashlib.sha256(material.encode()).hexdigest()

async def resolve_endpoint(user_id: str | None) -> tuple[str, str, bool]:
    overrides = await db.get_user_settings(user_id) if user_id else {}
    user_url = (overrides.get("tts_base_url") or "").strip()
    if user_url:
        return user_url.rstrip("/"), (overrides.get("tts_api_key") or "").strip(), False
    return (CFG.get("tts_base_url") or "").strip().rstrip("/"), (CFG.get("tts_api_key") or "").strip(), True

async def pin_endpoint(base_url: str, is_admin: bool) -> tuple[str, str | None]:
    from backend import ssrf
    return await ssrf.resolve_pinned_host(base_url, is_admin)

async def _synth_segment(client: httpx.AsyncClient, base_url: str, api_key: str, text: str,
                         voice: str, original_host: str | None = None) -> bytes:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    extensions = {}
    if original_host:
        headers["Host"] = original_host
        extensions["sni_hostname"] = original_host
    req = client.build_request("POST", f"{base_url}/audio/speech", headers=headers,
                               json={"model": "kokoro", "input": text, "voice": voice,
                                     "response_format": "wav"},
                               extensions=extensions)
    response = await client.send(req)
    if response.status_code != 200:
        raise TTSUnavailable(f"tts backend returned {response.status_code}")
    return response.content

async def synthesize_message(content: str, char_voice: str, narrator_voice: str,
                             user_id: str | None) -> tuple[str, bool]:
    base_url, api_key, is_admin = await resolve_endpoint(user_id)
    if not base_url:
        raise TTSUnavailable("no tts endpoint configured")
    host = endpoint_cache_host(base_url)
    key = speech_cache_key(content, char_voice, narrator_voice, host)
    rel_path = f"tts/{key}.wav"
    abs_path = os.path.join(MEDIA_DIR, rel_path)
    if os.path.exists(abs_path):
        return f"/media/{rel_path}", True
    segments = segment_speech(content)
    if not segments:
        raise TTSUnavailable("nothing to speak")
    try:
        pinned_base, original_host = await pin_endpoint(base_url, is_admin)
    except ValueError as exc:
        log.warning("tts: endpoint failed dns pinning host=%s: %s", host, exc)
        raise TTSUnavailable("tts endpoint failed a safety check") from exc
    blobs = []
    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT_SECONDS) as client:
            for role, text in segments:
                voice = char_voice if role == "dialogue" else narrator_voice
                blobs.append(await _synth_segment(client, pinned_base, api_key, text, voice, original_host))
    except httpx.HTTPError as exc:
        raise TTSUnavailable(f"tts backend unreachable: {type(exc).__name__}") from exc
    audio = concat_wavs(blobs)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    tmp_path = abs_path + "." + uuid.uuid4().hex + ".tmp"
    with open(tmp_path, "wb") as f:
        f.write(audio)
    os.replace(tmp_path, abs_path)
    log.info(f"tts synthesized cache_key={key} segments={len(segments)}")
    return f"/media/{rel_path}", False
