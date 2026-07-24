# TTS voice playback design

Date: 2026-07-25
Status: approved pending user review

## Summary

On-demand dual-voice speech for assistant messages. A speaker button on each assistant message synthesizes the reply server-side and plays it: narration in a narrator voice, quoted dialogue in the character's voice. Kokoro is the shipped default engine, any OpenAI-compatible TTS endpoint can replace it via settings. STT is explicitly out of scope for this iteration.

## Decisions already made

- TTS only, no mic input yet.
- On-demand per-message button, no auto-play.
- Kokoro container as default plus bring-your-own endpoint (two-tier, same as chat/embed).
- Creator assigns the character voice in the workshop, user can override per session.
- Dual voice: narration segments use the narrator voice, quoted spans use the character voice.
- Approach A: server-side synthesis and concatenation, cached per message.

## Infrastructure

New service `kokoro` in ~/.sillytavern/compose.yaml: image ghcr.io/remsky/kokoro-fastapi-cpu, network sillytavern_net, reachable at http://kokoro:8880/v1. CPU mode first because VRAM headroom is currently the scarce resource (16GB card at ~13GB resident, and low VRAM already degraded Firefox rendering once). Switching to the -gpu image later is a one-line change. Healthcheck on /health matching the llamacpp services.

## Configuration

Follows the existing two-tier settings pattern:

- `TTS_BASE_URL` env var seeds `CFG["tts_base_url"]` (global, admin-editable via PUT /api/settings). Default http://kokoro:8880/v1 in the compose env for story-game.
- `tts_api_key` global, write-only like the other API keys.
- `tts_base_url` and `tts_api_key` added to USER_CFG_KEYS so a user override wins for that user. A per-user API key applies only together with that user's own URL, same rule as chat.
- `CFG["tts_narrator_voice"]` global default narrator voice, default af_heart.
- `tts_enabled` exposed through PUBLIC_CFG_KEYS, derived: true when the resolved tts_base_url is non-empty. Empty URL hides all TTS UI.
- Endpoint resolution in a `_tts_endpoint(user)` helper in backend/chat_service.py next to `_endpoints()`, SSRF-validated through backend/ssrf.py exactly like chat and embed URLs.

## Data model

- `characters.voice` text nullable: kokoro voice id chosen by the creator, e.g. af_bella. Empty means the global narrator voice doubles as the character voice.
- `chat_sessions.voice_overrides` JSON nullable: `{"character_voice": str|null, "narrator_voice": str|null}`. Set via PUT /api/sessions/{sid}/voices (ownership-checked). Null fields fall through to character voice / global narrator voice.
- No new tables. Synthesized audio is a disk cache, not a DB record.

## Voice listing

GET /api/tts/voices proxies the TTS server's /v1/audio/voices (kokoro exposes this), cached in memory for a few minutes, same proxy pattern as imagegen_options does for ComfyUI. Used by the workshop voice picker and the session override UI. If the endpoint 404s (non-kokoro backend), return an empty list and the UI falls back to a free-text voice id field.

## Synthesis service

`backend/tts.py`, plain functions, no classes (stateless transforms):

- `segment_speech(text) -> list[tuple[role, text]]`: splits message content into narration and dialogue runs. Dialogue = spans inside straight or curly double quotes; everything else narration. Unclosed quote = rest of text is dialogue. Empty/whitespace segments dropped. Thinking blocks and mood tags are already absent from the text handed in (stripped at store time).
- `synthesize_message(content, char_voice, narrator_voice, endpoint) -> path`: cache key sha256(content + char_voice + narrator_voice + model/backend URL host). On miss: one POST per segment to {base}/v1/audio/speech with response_format wav, concatenate PCM frames via the wave stdlib module (single backend, uniform sample rate; mismatched params raise, no resampling), write MEDIA_DIR/tts/{hash}.wav atomically (tmp then rename). Returns the media path served by the existing /media mount.
- Size guard: reject content over 4000 characters with a 413 and a clear message instead of a minutes-long synthesis.

Router `backend/routers/tts.py`:

- POST /api/sessions/{sid}/messages/{mid}/speech: ownership via _own_session, message must be an assistant message in that session, rate-limited via backend/ratelimit.py, resolves voices (session override, then character voice, then narrator default), calls synthesize_message, returns {"url": "/media/tts/....wav", "cached": bool}.
- GET /api/tts/voices as above.
- POST /api/tts/preview: body {"voice": str}, synthesizes a fixed sample sentence, rate-limited, not cached, for the workshop preview button.
- PUT /api/sessions/{sid}/voices: body {"character_voice": str|null, "narrator_voice": str|null}, ownership-checked, logged.
- Logging per the standing rule: log.info on each synthesis (session id, message id, segment count, cached or not, duration ms), log.warning on TTS backend failure mapped to a 502 with a user-safe message, log.info on voice override changes. No content in logs.

## Frontend

- chat.js: speaker icon in the assistant message action row, shown only when tts_enabled. Click: button spinner, POST speech endpoint, play returned URL through one shared Audio instance managed by ChatStateManager (starting another message stops the current one, re-click toggles pause/resume). Errors surface via errorToast.
- Session settings modal: two dropdowns (character voice, narrator voice) populated from /api/tts/voices, "default" option = null. Saves via PUT /api/sessions/{sid}/voices.
- workshop-characters-form.js: voice dropdown plus a preview button that synthesizes a fixed sample sentence through a lightweight POST /api/tts/preview (rate-limited, same size guard, not cached under a message).
- All strings through t(), PROSE_STYLE_GUARD-compliant.

## Error handling

- TTS backend down or non-200: 502 "The voice engine is not responding right now." Logged with status and host, no URL in the user-facing message.
- Invalid voice id: kokoro returns 400; surface as "That voice is not available on the current engine."
- Concat parameter mismatch: 500, logged as an error, indicates a misconfigured multi-model backend.
- Media dir write failure: propagate as 500 after log.error.

## Testing

backend/tests/test_tts.py:

- segment_speech: plain narration, plain dialogue, mixed, curly quotes, unclosed quote, adjacent quotes, empty input.
- Cache key stability and sensitivity (content, either voice, host each change the key).
- WAV concatenation on synthetic in-memory fixtures, including the mismatch-raises case.
- Router: auth required, ownership enforced, user-message rejected, size guard 413, backend-down 502, happy path with mocked HTTP returning tiny WAVs, cached second call does not re-call HTTP.

## Out of scope

STT mic input, auto-play, streaming synthesis, per-message voice styling tags, multiplayer per-participant voices (multiplayer messages use the same character/narrator resolution as solo for now).
