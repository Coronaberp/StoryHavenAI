import io
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

@pytest.mark.asyncio
async def test_character_voice_roundtrip(db_conn):
    from backend.repositories import characters
    c = await characters.create({"name": "Voice Test", "persona": "a persona", "voice": "af_heart"})
    assert c["voice"] == "af_heart"
    fetched = await characters.get(c["id"])
    assert fetched["voice"] == "af_heart"
    updated = await characters.update(c["id"], {"name": "Voice Test", "persona": "a persona", "voice": None})
    assert updated["voice"] is None
