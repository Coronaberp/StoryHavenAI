import io
import os
import wave

import pytest

from backend.tts import concat_wavs, endpoint_cache_host, segment_speech, speech_cache_key

def test_segment_pure_narration():
    assert segment_speech("She walks to the door and knocks.") == [
        ("narration", "She walks to the door and knocks.")]

def test_segment_pure_dialogue():
    assert segment_speech('"Hello there."') == [("dialogue", "Hello there.")]

def test_segment_mixed():
    assert segment_speech('She smiles. "Come in," she says, stepping aside.') == [
        ("narration", "She smiles."),
        ("dialogue", "Come in,"),
        ("narration", "she says, stepping aside.")]

def test_segment_curly_quotes():
    assert segment_speech("He nods. “Of course.”") == [
        ("narration", "He nods."),
        ("dialogue", "Of course.")]

def test_segment_closed_curly_not_tail_leak():
    assert segment_speech("“One.” and “Two.”") == [
        ("dialogue", "One."),
        ("narration", "and"),
        ("dialogue", "Two.")]

def test_segment_unclosed_quote_is_dialogue():
    assert segment_speech('She whispers. "And then everything went dark') == [
        ("narration", "She whispers."),
        ("dialogue", "And then everything went dark")]

def test_segment_adjacent_quotes():
    assert segment_speech('"One." "Two."') == [
        ("dialogue", "One."), ("dialogue", "Two.")]

def test_segment_empty_input():
    assert segment_speech("") == []
    assert segment_speech("   ") == []

def test_segment_empty_quotes_dropped():
    assert segment_speech('Before "" after.') == [
        ("narration", "Before"), ("narration", "after.")]

def _make_wav(freq_frames: bytes, rate=24000, channels=1, width=2):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(freq_frames)
    return buf.getvalue()

def test_concat_wavs_joins_frames():
    a = _make_wav(b"\x01\x02" * 10)
    b = _make_wav(b"\x03\x04" * 5)
    joined = concat_wavs([a, b])
    with wave.open(io.BytesIO(joined)) as w:
        assert w.getnframes() == 15
        assert w.getframerate() == 24000

def test_concat_wavs_mismatch_raises():
    a = _make_wav(b"\x01\x02" * 4, rate=24000)
    b = _make_wav(b"\x01\x02" * 4, rate=22050)
    with pytest.raises(ValueError):
        concat_wavs([a, b])

def test_speech_cache_key_sensitivity():
    base = speech_cache_key("hi", "af_bella", "af_heart", "kokoro:8880")
    assert base == speech_cache_key("hi", "af_bella", "af_heart", "kokoro:8880")
    assert base != speech_cache_key("hi!", "af_bella", "af_heart", "kokoro:8880")
    assert base != speech_cache_key("hi", "af_sky", "af_heart", "kokoro:8880")
    assert base != speech_cache_key("hi", "af_bella", "af_sky", "kokoro:8880")
    assert base != speech_cache_key("hi", "af_bella", "af_heart", "other:1")
    assert len(base) == 64

def test_endpoint_cache_host_includes_port():
    assert endpoint_cache_host("http://kokoro:8880/v1") != endpoint_cache_host("http://kokoro:9000/v1")
    assert endpoint_cache_host("not a url") == "not a url"

@pytest.mark.asyncio
async def test_voice_overrides_roundtrip(db_conn):
    from backend.repositories import chat_sessions
    sid = await chat_sessions.create("char-1", None, "Chat", "You", user_id=None)
    session = await chat_sessions.get(sid)
    assert session["voice_overrides"] == {}
    await chat_sessions.set_voice_overrides(sid, {"character_voice": "af_bella", "narrator_voice": None})
    session = await chat_sessions.get(sid)
    assert session["voice_overrides"]["character_voice"] == "af_bella"
    assert session["voice_overrides"]["narrator_voice"] is None

async def _seed_user_char_session(char_voice=None):
    from backend.repositories import characters as characters_repo
    from backend.repositories import chat_sessions
    from backend.repositories import users as users_repo

    owner = await users_repo.create_user("tts-owner", "pw12345678")
    other = await users_repo.create_user("tts-other", "pw12345678")
    character = await characters_repo.create({
        "name": "Speaker", "owner_id": owner["id"], "voice": char_voice})
    sid = await chat_sessions.create(character["id"], None, "Chat", "You", user_id=owner["id"])
    await chat_sessions.add_message(sid, "user", "Hello there.")
    assistant_message = await chat_sessions.add_message(sid, "assistant", "Well met, traveler.")
    return owner, other, character, sid, assistant_message

@pytest.mark.asyncio
async def test_speech_requires_ownership(db_conn):
    from fastapi import HTTPException

    from backend.routers.tts import speak_message

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    with pytest.raises(HTTPException) as exc_info:
        await speak_message(sid, assistant_message["id"], {"id": other["id"], "username": other["username"]})
    assert exc_info.value.status_code == 404

@pytest.mark.asyncio
async def test_speech_rejects_user_messages(db_conn):
    from fastapi import HTTPException

    from backend.repositories import chat_sessions
    from backend.routers.tts import speak_message

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    messages = await chat_sessions.list_messages(sid)
    user_message = next(m for m in messages if m["role"] == "user")
    with pytest.raises(HTTPException) as exc_info:
        await speak_message(sid, user_message["id"], {"id": owner["id"], "username": owner["username"]})
    assert exc_info.value.status_code == 400

@pytest.mark.asyncio
async def test_speech_size_guard(db_conn):
    from fastapi import HTTPException

    from backend import tts as tts_module
    from backend.repositories import chat_sessions
    from backend.routers.tts import speak_message

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    long_message = await chat_sessions.add_message(sid, "assistant", "x" * (tts_module.MAX_TTS_CHARS + 1))
    with pytest.raises(HTTPException) as exc_info:
        await speak_message(sid, long_message["id"], {"id": owner["id"], "username": owner["username"]})
    assert exc_info.value.status_code == 413

@pytest.mark.asyncio
async def test_speech_happy_path(db_conn, monkeypatch):
    from backend import tts as tts_module
    from backend.repositories import chat_sessions
    from backend.routers import tts as tts_router

    owner, other, character, sid, assistant_message = await _seed_user_char_session(char_voice="af_michael")
    await chat_sessions.set_voice_overrides(sid, {"character_voice": "af_bella", "narrator_voice": "af_sky"})

    captured = {}

    async def fake_synthesize_message(content, char_voice, narrator_voice, user_id):
        captured["content"] = content
        captured["char_voice"] = char_voice
        captured["narrator_voice"] = narrator_voice
        captured["user_id"] = user_id
        return "/media/tts/x.wav", False

    monkeypatch.setattr(tts_module, "synthesize_message", fake_synthesize_message)
    result = await tts_router.speak_message(sid, assistant_message["id"],
                                            {"id": owner["id"], "username": owner["username"]})
    assert result == {"url": "/media/tts/x.wav", "cached": False}
    assert captured["char_voice"] == "af_bella"
    assert captured["narrator_voice"] == "af_sky"
    assert captured["user_id"] == owner["id"]

@pytest.mark.asyncio
async def test_speech_uses_character_voice_when_no_override(db_conn, monkeypatch):
    from backend import tts as tts_module
    from backend.routers import tts as tts_router

    owner, other, character, sid, assistant_message = await _seed_user_char_session(char_voice="af_michael")

    captured = {}

    async def fake_synthesize_message(content, char_voice, narrator_voice, user_id):
        captured["char_voice"] = char_voice
        captured["narrator_voice"] = narrator_voice
        return "/media/tts/x.wav", False

    monkeypatch.setattr(tts_module, "synthesize_message", fake_synthesize_message)
    await tts_router.speak_message(sid, assistant_message["id"],
                                   {"id": owner["id"], "username": owner["username"]})
    assert captured["char_voice"] == "af_michael"

@pytest.mark.asyncio
async def test_speech_uses_narrator_default_when_nothing_set(db_conn, monkeypatch):
    from backend import tts as tts_module
    from backend.routers import tts as tts_router
    from backend.state import CFG

    owner, other, character, sid, assistant_message = await _seed_user_char_session()

    original_narrator_voice = CFG.get("tts_narrator_voice")
    CFG["tts_narrator_voice"] = "af_default"
    try:
        captured = {}

        async def fake_synthesize_message(content, char_voice, narrator_voice, user_id):
            captured["char_voice"] = char_voice
            captured["narrator_voice"] = narrator_voice
            return "/media/tts/x.wav", False

        monkeypatch.setattr(tts_module, "synthesize_message", fake_synthesize_message)
        await tts_router.speak_message(sid, assistant_message["id"],
                                       {"id": owner["id"], "username": owner["username"]})
        assert captured["char_voice"] == "af_default"
        assert captured["narrator_voice"] == "af_default"
    finally:
        if original_narrator_voice is None:
            CFG.pop("tts_narrator_voice", None)
        else:
            CFG["tts_narrator_voice"] = original_narrator_voice

@pytest.mark.asyncio
async def test_speech_backend_down_maps_502(db_conn, monkeypatch):
    from backend import tts as tts_module
    from backend.routers import tts as tts_router
    from fastapi import HTTPException

    owner, other, character, sid, assistant_message = await _seed_user_char_session()

    async def fake_synthesize_message(content, char_voice, narrator_voice, user_id):
        raise tts_module.TTSUnavailable("engine offline")

    monkeypatch.setattr(tts_module, "synthesize_message", fake_synthesize_message)
    with pytest.raises(HTTPException) as exc_info:
        await tts_router.speak_message(sid, assistant_message["id"],
                                       {"id": owner["id"], "username": owner["username"]})
    assert exc_info.value.status_code == 502

@pytest.mark.asyncio
async def test_put_voices_roundtrip(db_conn):
    from backend.repositories import chat_sessions
    from backend.routers.tts import VoiceOverridesIn, set_session_voices

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    body = VoiceOverridesIn(character_voice="af_bella", narrator_voice="af_sky")
    result = await set_session_voices(sid, body, {"id": owner["id"], "username": owner["username"]})
    assert result == {"ok": True}
    session = await chat_sessions.get(sid)
    assert session["voice_overrides"]["character_voice"] == "af_bella"
    assert session["voice_overrides"]["narrator_voice"] == "af_sky"

@pytest.mark.asyncio
async def test_speech_strips_think_block(db_conn, monkeypatch):
    from backend import tts as tts_module
    from backend.repositories import chat_sessions
    from backend.routers import tts as tts_router

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    message = await chat_sessions.add_message(
        sid, "assistant", '<think>plan the scene</think>She smiles. "Hi."')

    captured = {}

    async def fake_synthesize_message(content, char_voice, narrator_voice, user_id):
        captured["content"] = content
        return "/media/tts/x.wav", False

    monkeypatch.setattr(tts_module, "synthesize_message", fake_synthesize_message)
    await tts_router.speak_message(sid, message["id"],
                                   {"id": owner["id"], "username": owner["username"]})
    assert captured["content"] == 'She smiles. "Hi."'

@pytest.mark.asyncio
async def test_speech_only_think_block_rejected(db_conn):
    from fastapi import HTTPException

    from backend.repositories import chat_sessions
    from backend.routers.tts import speak_message

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    message = await chat_sessions.add_message(sid, "assistant", "<think>plan the scene</think>")
    with pytest.raises(HTTPException) as exc_info:
        await speak_message(sid, message["id"], {"id": owner["id"], "username": owner["username"]})
    assert exc_info.value.status_code == 400

@pytest.mark.asyncio
async def test_speech_unclosed_think_block_rejected(db_conn):
    from fastapi import HTTPException

    from backend.repositories import chat_sessions
    from backend.routers.tts import speak_message

    owner, other, character, sid, assistant_message = await _seed_user_char_session()
    message = await chat_sessions.add_message(sid, "assistant", "<think>partial reasoning")
    with pytest.raises(HTTPException) as exc_info:
        await speak_message(sid, message["id"], {"id": owner["id"], "username": owner["username"]})
    assert exc_info.value.status_code == 400

@pytest.mark.asyncio
async def test_character_voice_roundtrip(db_conn):
    from backend.repositories import characters
    c = await characters.create({"name": "Voice Test", "persona": "a persona", "voice": "af_heart"})
    assert c["voice"] == "af_heart"
    fetched = await characters.get(c["id"])
    assert fetched["voice"] == "af_heart"
    updated = await characters.update(c["id"], {"name": "Voice Test", "persona": "a persona", "voice": None})
    assert updated["voice"] is None

def test_normalize_voice_entries_mixed():
    from backend.routers.tts import normalize_voice_entries
    result = normalize_voice_entries([{"id": "a"}, {"name": "b"}, "c", {}, None, ""])
    assert result == ["a", "b", "c"]

def test_normalize_voice_entries_dict_with_id():
    from backend.routers.tts import normalize_voice_entries
    result = normalize_voice_entries([{"id": "af_alloy", "name": "Alloy"}])
    assert result == ["af_alloy"]

def test_normalize_voice_entries_dict_with_name_only():
    from backend.routers.tts import normalize_voice_entries
    result = normalize_voice_entries([{"name": "Alloy"}])
    assert result == ["Alloy"]

def test_normalize_voice_entries_string_ids():
    from backend.routers.tts import normalize_voice_entries
    result = normalize_voice_entries(["af_alloy", "af_bella", "af_heart"])
    assert result == ["af_alloy", "af_bella", "af_heart"]

def test_normalize_voice_entries_empty():
    from backend.routers.tts import normalize_voice_entries
    result = normalize_voice_entries([])
    assert result == []

def test_normalize_voice_entries_drops_non_string_values():
    from backend.routers.tts import normalize_voice_entries
    result = normalize_voice_entries([{"id": 123}, {"id": None}, 42])
    assert result == []

def test_scrub_api_key_masks_tts_api_key():
    from backend.routers.settings import _scrub_api_key

    scrubbed = _scrub_api_key({"tts_api_key": "sek", "tts_base_url": "http://kokoro:8880/v1"})
    assert "tts_api_key" not in scrubbed
    assert scrubbed["has_tts_api_key"] is True
    assert scrubbed["tts_base_url"] == "http://kokoro:8880/v1"

def test_scrub_api_key_masks_absent_tts_api_key():
    from backend.routers.settings import _scrub_api_key

    scrubbed = _scrub_api_key({"tts_api_key": ""})
    assert "tts_api_key" not in scrubbed
    assert scrubbed["has_tts_api_key"] is False

@pytest.mark.asyncio
async def test_set_user_settings_encrypts_tts_api_key(db_conn):
    from backend import db
    from backend.repositories import users as user_repo
    from sqlalchemy import select

    user = await user_repo.create_user("repo_test_tts_key_user", "s3cret-password")
    await user_repo.set_user_settings(user["id"], {
        "tts_base_url": "http://kokoro:8880/v1",
        "tts_api_key": "sk-tts-secret",
    })

    row = await db._q1(select(db.user_settings.c.value).where(
        (db.user_settings.c.user_id == user["id"]) & (db.user_settings.c.key == "tts_api_key")))
    assert "sk-tts-secret" not in row["value"]

    settings = await user_repo.get_user_settings(user["id"])
    assert settings["tts_base_url"] == "http://kokoro:8880/v1"
    assert settings["tts_api_key"] == "sk-tts-secret"

@pytest.mark.asyncio
async def test_synthesize_message_blocks_on_rebind(db_conn, monkeypatch):
    from backend import ssrf
    from backend import tts as tts_module
    from backend.state import CFG

    CFG["tts_base_url"] = "http://kokoro:8880/v1"
    CFG["tts_api_key"] = ""

    async def fake_resolve_pinned_host(url, is_admin=False):
        raise ValueError("kokoro resolved to a non-public address when pinning the connection")

    monkeypatch.setattr(ssrf, "resolve_pinned_host", fake_resolve_pinned_host)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("httpx.AsyncClient must not be constructed when pinning fails")

    monkeypatch.setattr(tts_module.httpx, "AsyncClient", fail_if_called)

    with pytest.raises(tts_module.TTSUnavailable):
        await tts_module.synthesize_message('She smiles. "Hi."', "af_bella", "af_heart", None)

@pytest.mark.asyncio
async def test_synthesize_message_leaves_no_tmp_files(db_conn, monkeypatch, tmp_path):
    from backend import tts as tts_module
    from backend.state import CFG

    monkeypatch.setattr(tts_module, "MEDIA_DIR", str(tmp_path))
    CFG["tts_base_url"] = "http://kokoro:8880/v1"
    CFG["tts_api_key"] = ""

    wav_bytes = _make_wav(b"\x01\x02" * 10)

    class FakeResponse:
        status_code = 200
        content = wav_bytes

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def build_request(self, *args, **kwargs):
            return object()

        async def send(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(tts_module.httpx, "AsyncClient", lambda **kwargs: FakeAsyncClient())

    url, cached = await tts_module.synthesize_message('She smiles. "Hi."', "af_bella", "af_heart", None)
    assert cached is False
    assert url.startswith("/media/tts/")

    tts_dir = os.path.join(str(tmp_path), "tts")
    files = os.listdir(tts_dir)
    assert all(not name.endswith(".tmp") for name in files)
    assert any(name.endswith(".wav") for name in files)
