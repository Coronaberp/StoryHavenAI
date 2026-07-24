# TTS Voice Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On-demand dual-voice speech for assistant messages: narration in a narrator voice, quoted dialogue in the character voice, synthesized server-side via kokoro (or any OpenAI-compatible TTS), cached per message.

**Architecture:** New stateless `backend/tts.py` (segmentation, WAV concat, cache, endpoint resolution) + `backend/routers/tts.py` (speech/preview/voices/voice-override endpoints, feature-flag gated) + one new `voice` column on characters, one `voice_overrides` column on sessions + a kokoro container in the sillytavern stack + speaker-button UI in chat, voice pickers in session settings and the character workshop.

**Tech Stack:** FastAPI, SQLAlchemy Core, httpx, stdlib `wave`, kokoro-fastapi (OpenAI-compatible `/v1/audio/speech`), vanilla JS.

**Spec:** `docs/superpowers/specs/2026-07-25-tts-voice-design.md`. One deliberate deviation: endpoint resolution lives in `backend/tts.py` (not `chat_service.py`) so the TTS router imports one module; same two-tier logic.

## Global Constraints

- Zero comments/docstrings in any file (project rule).
- No em dashes or semicolons in user-facing UI strings, all through `t()`.
- Every mutating endpoint logs `log.info` on success; every caught exception logs before turning into an HTTPException (`from backend.state import log`).
- Absolute imports: `from backend.x import y`, never bare `import x` for siblings.
- Repositories are plain function modules, no classes for stateless code.
- Feature flag key is `tts`; dev role bypasses flags automatically via `require_feature_enabled`.
- This checkout is the live app. No worktrees. Edits to `.py` live-reload the container. **Do not run `git stash`/`git reset`/`git checkout <paths>`.**
- Tests run on the host, NOT via `podman exec` (broken): one-time setup in Task 0, then `set -a; . ./.env.dev; set +a; <venv>/bin/python3 -m pytest backend/tests/test_tts.py -q`. conftest wraps tests in rolled-back transactions against live Postgres on 127.0.0.1:5433.
- Commits: plain messages, no Claude attribution of any kind.

---

### Task 0: Host test venv (one-time setup, no commit)

**Files:** none in repo (creates `/var/home/staygold/testvenv-storyhaven/`)

- [ ] **Step 1: Create the venv and install deps**

```bash
/home/staygold/.local/bin/python3.12 -m venv /var/home/staygold/testvenv-storyhaven
/var/home/staygold/testvenv-storyhaven/bin/pip install -q -r /var/home/staygold/ai-frontend/requirements.txt pytest pytest-asyncio
```

- [ ] **Step 2: Smoke-run the existing suite subset**

```bash
cd /var/home/staygold/ai-frontend
set -a; . ./.env.dev; set +a
/var/home/staygold/testvenv-storyhaven/bin/python3 -m pytest backend/tests/test_retrieval.py -q
```
Expected: PASS (all green). If ConnectError-type failures appear in other files later, those are the known container-hostname env failures, not code bugs.

---

### Task 1: Speech segmentation (`segment_speech`)

**Files:**
- Create: `backend/tts.py`
- Test: `backend/tests/test_tts.py`

**Interfaces:**
- Produces: `segment_speech(text: str) -> list[tuple[str, str]]` where the first tuple item is `"narration"` or `"dialogue"`, order preserved, no empty segments.

- [ ] **Step 1: Write the failing tests**

```python
import pytest

from backend.tts import segment_speech

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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /var/home/staygold/ai-frontend
set -a; . ./.env.dev; set +a
/var/home/staygold/testvenv-storyhaven/bin/python3 -m pytest backend/tests/test_tts.py -q
```
Expected: FAIL, `ModuleNotFoundError` or `ImportError: cannot import name 'segment_speech'`.

- [ ] **Step 3: Implement**

```python
import re

_DIALOGUE_RE = re.compile(r'"([^"]*)"|“([^”]*)”')

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
    if tail[0] in ('"', "“"):
        inner = tail[1:].strip()
        if inner:
            segments.append(("dialogue", inner))
        return segments
    segments.append(("narration", tail))
    return segments
```

- [ ] **Step 4: Run to verify pass**

Same command. Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/tts.py backend/tests/test_tts.py
git commit -m "Add speech segmentation: quoted spans become dialogue, the rest narrator"
```

---

### Task 2: WAV concat, cache key, synthesis

**Files:**
- Modify: `backend/tts.py`
- Test: `backend/tests/test_tts.py`

**Interfaces:**
- Consumes: `segment_speech` from Task 1.
- Produces:
  - `concat_wavs(blobs: list[bytes]) -> bytes` (raises `ValueError` on mismatched channel/width/rate)
  - `speech_cache_key(content: str, char_voice: str, narrator_voice: str, endpoint_host: str) -> str` (sha256 hex)
  - `async resolve_endpoint(user_id: str | None) -> tuple[str, str]` (base url without trailing slash, api key)
  - `async synthesize_message(content, char_voice, narrator_voice, user_id) -> tuple[str, bool]` returning (`/media/tts/<hash>.wav`, cached_hit) and raising `TTSUnavailable` (new exception) on backend failure
  - `MAX_TTS_CHARS = 4000`

- [ ] **Step 1: Write the failing tests (append to test_tts.py)**

```python
import hashlib
import io
import wave

from backend.tts import concat_wavs, speech_cache_key

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
    import pytest as _pytest
    with _pytest.raises(ValueError):
        concat_wavs([a, b])

def test_speech_cache_key_sensitivity():
    base = speech_cache_key("hi", "af_bella", "af_heart", "kokoro:8880")
    assert base == speech_cache_key("hi", "af_bella", "af_heart", "kokoro:8880")
    assert base != speech_cache_key("hi!", "af_bella", "af_heart", "kokoro:8880")
    assert base != speech_cache_key("hi", "af_sky", "af_heart", "kokoro:8880")
    assert base != speech_cache_key("hi", "af_bella", "af_sky", "kokoro:8880")
    assert base != speech_cache_key("hi", "af_bella", "af_heart", "other:1")
    assert len(base) == 64
```

- [ ] **Step 2: Run to verify failure**

Expected: FAIL with ImportError on `concat_wavs`.

- [ ] **Step 3: Implement (append to backend/tts.py)**

```python
import hashlib
import io
import os
import wave

import httpx

from backend import db
from backend.state import CFG, MEDIA_DIR, log

MAX_TTS_CHARS = 4000
TTS_TIMEOUT_SECONDS = 120

class TTSUnavailable(Exception):
    pass

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

def speech_cache_key(content: str, char_voice: str, narrator_voice: str, endpoint_host: str) -> str:
    material = "\x00".join([content, char_voice, narrator_voice, endpoint_host])
    return hashlib.sha256(material.encode()).hexdigest()

async def resolve_endpoint(user_id: str | None) -> tuple[str, str]:
    overrides = await db.get_user_settings(user_id) if user_id else {}
    user_url = (overrides.get("tts_base_url") or "").strip()
    if user_url:
        return user_url.rstrip("/"), (overrides.get("tts_api_key") or "").strip()
    return (CFG.get("tts_base_url") or "").strip().rstrip("/"), (CFG.get("tts_api_key") or "").strip()

async def _synth_segment(client: httpx.AsyncClient, base_url: str, api_key: str, text: str, voice: str) -> bytes:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    response = await client.post(f"{base_url}/audio/speech", headers=headers,
                                 json={"model": "kokoro", "input": text, "voice": voice,
                                       "response_format": "wav"})
    if response.status_code != 200:
        raise TTSUnavailable(f"tts backend returned {response.status_code}")
    return response.content

async def synthesize_message(content: str, char_voice: str, narrator_voice: str,
                             user_id: str | None) -> tuple[str, bool]:
    base_url, api_key = await resolve_endpoint(user_id)
    if not base_url:
        raise TTSUnavailable("no tts endpoint configured")
    host = httpx.URL(base_url).host or base_url
    key = speech_cache_key(content, char_voice, narrator_voice, host)
    rel_path = f"tts/{key}.wav"
    abs_path = os.path.join(MEDIA_DIR, rel_path)
    if os.path.exists(abs_path):
        return f"/media/{rel_path}", True
    segments = segment_speech(content)
    if not segments:
        raise TTSUnavailable("nothing to speak")
    blobs = []
    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT_SECONDS) as client:
            for role, text in segments:
                voice = char_voice if role == "dialogue" else narrator_voice
                blobs.append(await _synth_segment(client, base_url, api_key, text, voice))
    except httpx.HTTPError as exc:
        raise TTSUnavailable(f"tts backend unreachable: {type(exc).__name__}") from exc
    audio = concat_wavs(blobs)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    tmp_path = abs_path + ".tmp"
    with open(tmp_path, "wb") as f:
        f.write(audio)
    os.replace(tmp_path, abs_path)
    return f"/media/{rel_path}", False
```

- [ ] **Step 4: Run to verify pass**

Expected: all test_tts.py tests pass (synthesize_message is exercised in Task 4's router tests with mocked HTTP).

- [ ] **Step 5: Commit**

```bash
git add backend/tts.py backend/tests/test_tts.py
git commit -m "Add TTS synthesis core: wav concat, cache key, two-tier endpoint resolution, per-segment kokoro calls"
```

---

### Task 3: Schema and repository support

**Files:**
- Modify: `backend/db.py` (characters table ~line 144, sessions table ~line 258)
- Modify: `backend/repositories/chat_sessions.py`
- Modify: `backend/routers/characters.py` (create/update payload passthrough)
- Test: `backend/tests/test_tts.py` (repo section), existing `backend/tests/test_characters_repo.py` untouched

**Interfaces:**
- Produces:
  - `characters.voice` Text nullable column, round-tripped through character create/update/get
  - `sessions.voice_overrides` Text NOT NULL server_default `'{}'`
  - `chat_sessions.set_voice_overrides(sid: str, overrides: dict) -> None`
  - `chat_sessions.get(sid)` result includes `voice_overrides` as a parsed dict

- [ ] **Step 1: Write the failing repo tests (append to test_tts.py)**

```python
import pytest

from backend.repositories import chat_sessions

@pytest.mark.asyncio
async def test_voice_overrides_roundtrip(db_conn, seeded_user, seeded_character):
    sid = await chat_sessions.create(seeded_character["id"], user_id=seeded_user["id"])
    session = await chat_sessions.get(sid)
    assert session["voice_overrides"] == {}
    await chat_sessions.set_voice_overrides(sid, {"character_voice": "af_bella", "narrator_voice": None})
    session = await chat_sessions.get(sid)
    assert session["voice_overrides"]["character_voice"] == "af_bella"
    assert session["voice_overrides"]["narrator_voice"] is None
```

Before writing, open `backend/tests/test_chat_sessions_repo.py` and copy its actual fixture names and `chat_sessions.create(...)` signature (they exist there today). Adjust the test above to those exact names. Do not invent fixtures.

- [ ] **Step 2: Run to verify failure**

Expected: FAIL, `voice_overrides` KeyError or AttributeError on `set_voice_overrides`.

- [ ] **Step 3: Implement**

In `backend/db.py` characters table, after the `assets` column line:

```python
    sa.Column("voice", sa.Text),
```

In `backend/db.py` sessions table, after the `source_group_id` line:

```python
    sa.Column("voice_overrides", sa.Text, nullable=False, server_default=text("'{}'")),
```

In `backend/repositories/chat_sessions.py`: find `get(sid)` and every select that builds the session dict, add `voice_overrides` parsed with `json.loads(row["voice_overrides"] or "{}")` matching how `glossary` is already parsed in the same module (copy that exact pattern). Add:

```python
async def set_voice_overrides(sid: str, overrides: dict) -> None:
    allowed = {"character_voice", "narrator_voice"}
    clean = {k: (overrides.get(k) or None) for k in allowed}
    await _w(update(sessions).where(sessions.c.id == sid)
             .values(voice_overrides=json.dumps(clean)))
    log.info("chat_sessions: voice overrides set sid=%s", sid)
```

(using the module's existing `_w`/`update`/`sessions` imports, matching sibling functions).

In `backend/routers/characters.py`: find where `assets` is read from the create and update request payloads and persisted, add `voice` beside it as a plain optional string field (limit 64 chars, strip, empty becomes None), and include `voice` in the character response serializer in the same file.

- [ ] **Step 4: Run new test plus neighbors**

```bash
/var/home/staygold/testvenv-storyhaven/bin/python3 -m pytest backend/tests/test_tts.py backend/tests/test_chat_sessions_repo.py backend/tests/test_characters_repo.py -q
```
Expected: PASS. New columns are created on next container reload by `metadata.create_all(checkfirst)` for fresh tables, but existing tables need the columns added manually once:

```bash
podman exec storyhaven-postgres psql -U postgres -d postgres -c "ALTER TABLE characters ADD COLUMN IF NOT EXISTS voice TEXT; ALTER TABLE sessions ADD COLUMN IF NOT EXISTS voice_overrides TEXT NOT NULL DEFAULT '{}';"
```

(Check `.env.dev` for the real user/db names in DATABASE_URL and substitute.)

- [ ] **Step 5: Commit**

```bash
git add backend/db.py backend/repositories/chat_sessions.py backend/routers/characters.py backend/tests/test_tts.py
git commit -m "Add character voice column and per-session voice overrides"
```

---

### Task 4: Config keys, feature flag, TTS router

**Files:**
- Modify: `backend/state.py` (CFG seed, PUBLIC_CFG_KEYS, USER_CFG_KEYS)
- Modify: `backend/feature_flags.py` (FEATURE_KEYS, FEATURE_IMPACT_DESCRIPTIONS)
- Create: `backend/routers/tts.py`
- Modify: `server.py` (router include, matching how other routers are imported/included)
- Test: `backend/tests/test_tts.py`

**Interfaces:**
- Consumes: `synthesize_message`, `TTSUnavailable`, `MAX_TTS_CHARS`, `resolve_endpoint` (Task 2), `chat_sessions.set_voice_overrides`, `characters.voice` (Task 3), `require_feature_enabled` (existing), `_own_session` from `backend.chat_service` (existing).
- Produces endpoints:
  - `POST /api/sessions/{sid}/messages/{mid}/speech` → `{"url": str, "cached": bool}`
  - `POST /api/tts/preview` body `{"voice": str}` → `{"url": str}`
  - `GET /api/tts/voices` → `{"voices": [str]}`
  - `PUT /api/sessions/{sid}/voices` body `{"character_voice": str|null, "narrator_voice": str|null}` → `{"ok": true}`

- [ ] **Step 1: Config and flag edits**

`backend/state.py`: in the CFG seeding block (where `comfyui_url` etc. are read from env), add:

```python
    "tts_base_url": os.getenv("TTS_BASE_URL", ""),
    "tts_api_key": os.getenv("TTS_API_KEY", ""),
    "tts_narrator_voice": os.getenv("TTS_NARRATOR_VOICE", "af_heart"),
```

Add `"tts_base_url", "tts_narrator_voice"` to `PUBLIC_CFG_KEYS` (the api key stays write-only like the others). Add `"tts_base_url", "tts_api_key"` to `USER_CFG_KEYS`.

`backend/feature_flags.py`: add to `FEATURE_KEYS`:

```python
    "tts": "Voice Playback",
```

and to `FEATURE_IMPACT_DESCRIPTIONS`:

```python
    "tts": "Users will be unable to play spoken audio for messages or preview voices",
```

- [ ] **Step 2: Write failing router tests (append to test_tts.py)**

Copy the app/client fixture pattern from `backend/tests/test_announcements_router.py` (it builds a FastAPI test app around the shared `api` router without importing server.py). Tests, with `backend.tts.synthesize_message` monkeypatched:

```python
@pytest.mark.asyncio
async def test_speech_requires_ownership(...):
    # other user's session id -> 404/403 per _own_session behavior

@pytest.mark.asyncio
async def test_speech_rejects_user_messages(...):
    # mid pointing at a role=user message -> 400

@pytest.mark.asyncio
async def test_speech_size_guard(...):
    # assistant message with 4001 chars -> 413

@pytest.mark.asyncio
async def test_speech_happy_path(...):
    # monkeypatched synthesize_message returns ("/media/tts/x.wav", False)
    # assert response {"url": "/media/tts/x.wav", "cached": False}
    # assert monkeypatch captured char_voice/narrator_voice resolution:
    # session override wins over character voice wins over CFG narrator default

@pytest.mark.asyncio
async def test_speech_backend_down_maps_502(...):
    # monkeypatched synthesize_message raises TTSUnavailable -> 502

@pytest.mark.asyncio
async def test_put_voices_roundtrip(...):
    # PUT then chat_sessions.get shows the override
```

Write these as real tests using the copied fixture pattern with actual seeded rows, mirroring how the announcements router test seeds users. The comments above describe intent only and must not appear in the file.

- [ ] **Step 3: Run to verify failure**

Expected: 404s (routes not registered) or ImportError.

- [ ] **Step 4: Implement `backend/routers/tts.py`**

```python
import time

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from backend import tts
from backend.auth import get_current_user
from backend.chat_service import _own_session
from backend.feature_flags import require_feature_enabled
from backend.ratelimit import SlidingWindow
from backend.repositories import characters as characters_repo
from backend.repositories import chat_sessions
from backend.state import CFG, api, log

_speech_limiter = SlidingWindow(20, 60.0, "Too many voice requests, give it a moment.")
_preview_limiter = SlidingWindow(10, 60.0, "Too many previews, give it a moment.")
_voices_cache: dict = {"at": 0.0, "voices": []}
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

async def _resolve_voices(session: dict) -> tuple[str, str]:
    overrides = session.get("voice_overrides") or {}
    narrator = _clean_voice(overrides.get("narrator_voice")) or CFG.get("tts_narrator_voice") or "af_heart"
    char_voice = _clean_voice(overrides.get("character_voice"))
    if not char_voice:
        character = await characters_repo.get(session["char_id"])
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
    if len(message["content"]) > tts.MAX_TTS_CHARS:
        raise HTTPException(413, "This message is too long to speak.")
    char_voice, narrator_voice = await _resolve_voices(session)
    started = time.time()
    try:
        url, cached = await tts.synthesize_message(message["content"], char_voice,
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

@api.get("/tts/voices")
async def list_voices(current_user: dict = Depends(get_current_user)):
    import httpx
    now = time.time()
    if now - _voices_cache["at"] < _VOICES_CACHE_SECONDS and _voices_cache["voices"]:
        return {"voices": _voices_cache["voices"]}
    base_url, api_key = await tts.resolve_endpoint(current_user["id"])
    if not base_url:
        return {"voices": []}
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{base_url}/audio/voices", headers=headers)
        voices = response.json().get("voices", []) if response.status_code == 200 else []
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("tts: voice list failed: %s", type(exc).__name__)
        voices = []
    _voices_cache.update(at=now, voices=voices)
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
```

Move the `import httpx` to the top of the file with the other imports. In `server.py`, add `tts` to the router import list exactly where sibling routers (e.g. `session_lore`) are imported.

- [ ] **Step 5: Run tests, then live-boot check**

```bash
/var/home/staygold/testvenv-storyhaven/bin/python3 -m pytest backend/tests/test_tts.py -q
curl -s -o /dev/null -w "%{http_code}\n" https://storyhavenai.sillysillysupersillydomain.win/api/health
```
Expected: tests pass; 401 (server up, worker reloaded without ImportError). Also check `podman logs --tail 5 story-game` shows no traceback.

- [ ] **Step 6: Commit**

```bash
git add backend/state.py backend/feature_flags.py backend/routers/tts.py server.py backend/tests/test_tts.py
git commit -m "Add TTS router: speech synthesis, voice preview, voice list proxy, session voice overrides, tts feature flag"
```

---

### Task 5: Kokoro container and env wiring

**Files:**
- Modify: `~/.sillytavern/compose.yaml` (outside repo)

- [ ] **Step 1: Add the service**

After the `llamacpp-embed` service block, same indentation style:

```yaml
  kokoro:
    container_name: kokoro
    image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
    restart: unless-stopped
    networks:
      - sillytavern_net
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O- http://localhost:8880/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 120s
      retries: 3
```

In the `story-game` service's `environment:` list add:

```yaml
      - TTS_BASE_URL=http://kokoro:8880/v1
```

- [ ] **Step 2: Bring up and verify**

```bash
docker compose -f ~/.sillytavern/compose.yaml up -d kokoro
docker compose -f ~/.sillytavern/compose.yaml up -d story-game
podman exec story-game wget -q -O- http://kokoro:8880/v1/audio/voices | head -c 200
```
Expected: JSON containing a voices list (image pull may take a few minutes first time). Then confirm `GET /api/tts/voices` returns the same list through the app (authenticated curl with the claude account).

- [ ] **Step 3: No repo commit** (compose lives outside the repo). Note the change in the final summary to the user.

---

### Task 6: Chat UI speaker button

**Files:**
- Modify: `new_ui/js/chat.js`
- Modify: `new_ui/js/translations.js` (new keys)

**Interfaces:**
- Consumes: `POST /api/sessions/{sid}/messages/{mid}/speech`, `tts_base_url` from the public settings already loaded client-side (grep for how `comfyui_url` or other PUBLIC_CFG values reach the frontend and use the same accessor), `data-feature="tts"` interception by feature-flags.js.
- Produces: `TtsPlayer` class (single shared Audio element), `window.ttsPlayer` singleton.

- [ ] **Step 1: Add TtsPlayer (top-level in chat.js near ChatStateManager)**

```javascript
class TtsPlayer {
  constructor() {
    this.audio = new Audio();
    this.activeButton = null;
    this.audio.addEventListener("ended", () => this._setIdle());
  }
  _setIdle() {
    if (this.activeButton) this.activeButton.classList.remove("speaking", "loading");
    this.activeButton = null;
  }
  stop() {
    this.audio.pause();
    this._setIdle();
  }
  async toggle(button, sid, mid) {
    if (this.activeButton === button && !this.audio.paused) { this.audio.pause(); button.classList.remove("speaking"); return; }
    if (this.activeButton === button && this.audio.paused && this.audio.src) { this.audio.play(); button.classList.add("speaking"); return; }
    this.stop();
    this.activeButton = button;
    button.classList.add("loading");
    try {
      const res = await api(`/api/sessions/${encodeURIComponent(sid)}/messages/${encodeURIComponent(mid)}/speech`, { method: "POST" });
      button.classList.remove("loading");
      if (this.activeButton !== button) return;
      this.audio.src = res.url;
      await this.audio.play();
      button.classList.add("speaking");
    } catch (err) {
      button.classList.remove("loading", "speaking");
      this.activeButton = null;
      errorToast(err.message || t("tts_failed", "Couldn't play the voice right now."));
    }
  }
}
```

Instantiate once beside the other singletons in chat.js and stop playback on session switch (find where the chat view unmounts or the sid changes and call `ttsPlayer.stop()` there).

- [ ] **Step 2: Add the button to the assistant message action row**

Locate the action row builder (grep chat.js for `data-act="reassign"` and the sibling action buttons around it). Add for assistant messages only, gated on TTS being configured (public setting `tts_base_url` non-empty):

```javascript
<button type="button" class="ig-icon-btn tts-btn" data-act="speak" data-feature="tts"
  aria-label="${t("tts_speak", "Play voice")}" data-tooltip="${t("tts_speak", "Play voice")}">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
</button>
```

Wire `data-act="speak"` in the same click dispatch that handles the neighboring actions, calling `ttsPlayer.toggle(buttonEl, this.sid, mid)`.

Add a minimal state style to `new_ui/css/cards.css` (hand-written source, not app.css):

```css
.tts-btn.loading { opacity: .5; pointer-events: none; }
.tts-btn.speaking { color: var(--color-accent); }
```

- [ ] **Step 3: Translations**

Add to translations.js UI_STRINGS following the existing key style: `tts_speak` "Play voice", `tts_failed` "Couldn't play the voice right now." (Remember the standing note: new strings show English for other languages until an admin resync.)

- [ ] **Step 4: Verify live**

`./rebuild.sh --once` if CSS changed, then on the live site: open a chat as the test account, click the speaker on an assistant message, confirm audio plays, second click pauses, clicking another message switches, regenerated message re-synthesizes. Check the admin Server Logs panel shows the `tts: spoke` lines.

- [ ] **Step 5: Commit**

```bash
git add new_ui/js/chat.js new_ui/js/translations.js new_ui/css/cards.css new_ui/css/app.css
git commit -m "Add speaker button with shared audio playback to chat messages"
```

---

### Task 7: Session voice overrides UI + workshop voice picker

**Files:**
- Modify: `new_ui/js/chat.js` or the session settings modal module (grep for where the session settings modal with language/style lives, likely chat-modals equivalent in new_ui)
- Modify: `new_ui/js/workshop-characters-form.js`
- Modify: `new_ui/js/translations.js`

**Interfaces:**
- Consumes: `GET /api/tts/voices`, `PUT /api/sessions/{sid}/voices`, `POST /api/tts/preview`, `characters.voice` field in the character create/update payload (Task 3).

- [ ] **Step 1: Shared voice dropdown helper (new_ui/js/chat.js or a small shared spot both files already load)**

```javascript
async function voiceOptionsHtml(selected) {
  let voices = [];
  try { voices = (await api("/api/tts/voices")).voices || []; } catch {}
  if (!voices.length) return null;
  const opts = voices.map((v) => `<option value="${_attr(v)}"${v === selected ? " selected" : ""}>${_esc(v)}</option>`).join("");
  return `<option value="">${t("tts_voice_default", "Default")}</option>${opts}`;
}
```

If the voices list is empty (non-kokoro backend), render a plain text input instead of a select, per the spec.

- [ ] **Step 2: Session settings modal**

In the session settings modal, add a Voice section with two selects (`character voice`, `narrator voice`) populated via `voiceOptionsHtml(session.voice_overrides?.character_voice)` etc., saving on change:

```javascript
await api(`/api/sessions/${encodeURIComponent(sid)}/voices`, {
  method: "PUT",
  body: JSON.stringify({
    character_voice: charSelect.value || null,
    narrator_voice: narrSelect.value || null,
  }),
});
```

Only render the section when the public `tts_base_url` setting is non-empty.

- [ ] **Step 3: Workshop character form**

In workshop-characters-form.js, beside the existing sprite/stage fields, add a voice select (same helper, selected = the character's `voice`) plus a preview button:

```javascript
<button type="button" class="pe-gen-btn" data-act="voice-preview">${t("tts_preview", "Preview")}</button>
```

Handler:

```javascript
async previewVoice(voice) {
  if (!voice) return;
  try {
    const res = await api("/api/tts/preview", { method: "POST", body: JSON.stringify({ voice }) });
    new Audio(res.url).play();
  } catch (err) {
    errorToast(err.message || t("tts_failed", "Couldn't play the voice right now."));
  }
}
```

Include `voice` in the form's save payload wherever `assets` is included (Task 3 made the backend accept it).

- [ ] **Step 4: Translations**

Add `tts_voice_default` "Default", `tts_preview` "Preview", `tts_character_voice` "Character voice", `tts_narrator_voice` "Narrator voice", section heading `tts_voice_heading` "Voice".

- [ ] **Step 5: Verify live and commit**

Live checks: set a character voice in the workshop and hear the preview, override it in a session, speak a message and confirm the override voice is used, clear the override and confirm fallback to the character voice. JS syntax check with tree-sitter per the harness memory if unsure.

```bash
git add new_ui/js/chat.js new_ui/js/workshop-characters-form.js new_ui/js/translations.js
git commit -m "Add voice pickers: session overrides and workshop character voice with preview"
```

---

### Task 8: Full-suite regression and wrap-up

- [ ] **Step 1: Run the backend suite**

```bash
cd /var/home/staygold/ai-frontend
set -a; . ./.env.dev; set +a
/var/home/staygold/testvenv-storyhaven/bin/python3 -m pytest backend/tests -q --ignore=backend/tests/test_feature_flag_gating.py --ignore=backend/tests/test_server_docs.py
```
Expected: green except the documented container-hostname env failures.

- [ ] **Step 2: Boot verification (live)**

401 from `/api/health` via the public domain, no tracebacks in `podman logs --tail 30 story-game`, admin Server Logs shows tts entries from the manual checks.

- [ ] **Step 3: Feature flag check**

In the admin panel Features tab, toggle Voice Playback off with the test account in another browser: speaker button click must surface the feature-disabled modal (via the existing `data-feature` interception), dev account still works. Toggle back on.
