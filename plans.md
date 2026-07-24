# Feature backlog

Ideas surveyed 2026-07-25 against the actual codebase. Everything listed here was verified as not yet built. Already built and therefore excluded: inpainting, img2vid, session branching, multiplayer groups, SillyTavern card import, lore relationship graphs, OAuth, WebAuthn, tutorials, feature flags, announcements, in-chat image generation, chapter summaries via the summarize endpoint.

## In progress

### Voice (TTS)
Being designed now. Dual-voice on-demand playback: narrator voice for actions, character voice for quoted dialogue. Kokoro container as shipped default plus bring-your-own OpenAI-compatible endpoint via the two-tier settings pattern. Creator picks the character voice in the workshop, user can override per session. Server-side segment synthesis, WAV concat, cached under MEDIA_DIR keyed by content and voice hash. STT (whisper mic input) deferred to a follow-up.

## Backlog

### Proactive characters
Characters message you first after a period of inactivity, grounded in the session's memory facts so the opener references real story state. Delivery through the existing notifications router and UI. Needs: an inactivity scheduler (the background cleanup task in server.py is a pattern to follow), an opt-in per session, a generation path that reuses build_system with a "reach out" instruction, and rate caps so it never spams.

### Semantic chat search
Search your own past sessions by meaning rather than keywords. The pgvector infrastructure and embed pipeline already run for memory and lore, messages are just not indexed. Needs: a message_vectors table (HNSW, same engine), embedding on message persist (or a backfill script in modules/py matching the existing backfill pattern), a search endpoint scoped to the requesting user's sessions, and a search UI in the chats list. Mind the encryption-at-rest posture: vectors leak content similarity, same tradeoff already accepted for memory vectors.

### Story export
Compile a session or branch into a formatted story: HTML first (matches the no-build-tool philosophy), EPUB later if wanted. Chapter recaps via the existing summarize endpoint, scene images inline where in-chat generations happened, thinking blocks and mood tags stripped, persona and character names styled. A new backend/routers/export.py returning a downloadable file, plus an export button in the session menu.

### STT voice input (follow-up to TTS)
Mic push-to-talk in the chat composer, whisper (or faster-whisper) container, roughly 1GB VRAM or CPU mode. Do after TTS ships so the audio UX patterns exist.

### Character expression sprite packs
Auto-generate a mood sprite set for a character from its portrait via ComfyUI img2img with expression prompts, feeding the existing visual-novel mood/stage system (assets.sprites is already wired end to end). Turns the mood feature from manual-upload-only into one click.

### Admin analytics dashboard
Chats per day, model latency, memory extraction health, image gen volume. Chart.js per your standing preference. admin-health.js exists but check what it already covers before scoping this, it may partially overlap.
