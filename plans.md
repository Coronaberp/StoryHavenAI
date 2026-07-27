# Feature backlog

Ideas surveyed 2026-07-25 against the actual codebase. Everything listed here was verified as not yet built. Already built and therefore excluded: inpainting, img2vid, session branching, multiplayer groups, SillyTavern card import, lore relationship graphs, OAuth, WebAuthn, tutorials, feature flags, announcements, in-chat image generation, chapter summaries via the summarize endpoint.

## In progress

### Voice (TTS)
Being designed now. Dual-voice on-demand playback: narrator voice for actions, character voice for quoted dialogue. Kokoro container as shipped default plus bring-your-own OpenAI-compatible endpoint via the two-tier settings pattern. Creator picks the character voice in the workshop, user can override per session. Server-side segment synthesis, WAV concat, cached under MEDIA_DIR keyed by content and voice hash. STT (whisper mic input) deferred to a follow-up.

### Discovery & embeds rework (six sequential specs, brainstormed 2026-07-28)
Kicked off by a critique of the share-card (Discord/OG embed) design, which surfaced that the underlying data it wanted (genre, real engagement) didn't exist yet, and that the landing Explore page has no real ranking at all (`_shuffleSample`, literal random shuffle). Sequenced so each spec's data feeds the next:
1. **Genre taxonomy** (spec written) — new single-select `genre` field on characters and groups, fixed list, plus a `>genre` Explore search-box filter token following the existing `#tag`/`@creator` pill pattern in `explore-characters.js`.
2. **Content likes** (spec written) — binary like/unlike on characters, groups, and standalone images via a new `content_likes` table (generalizing `comments`' existing polymorphic `target_type` pattern), a "My Likes" list in Settings (`settings-blocks.js`'s pattern), no creator notification.
3. **For You / Featured** (spec written) — replaces the landing Explore page's random shuffle with a personalized "For You" ranking (genre affinity + likes + chat history + follows) and a non-personalized "Featured" (likes + recency, same for everyone). Depends on specs 1 and 2.
4. **Embed v3** — component-based share-card rework (per-content-type composition instead of one shared layout forced onto everything), artwork-forward, shrunk brand watermark, gold reserved for accents only. Currently paused mid-brainstorm pending specs 1-3's data. Character/Profile currently share one PIL composer (`_compose_profile_card`) and Group/Shared-chat share another (`_compose_group_card`) in `server.py` — this splits both pairs into real per-type designs. Docs card (`docs-og.png`) goes from a static pre-rendered image to dynamic, auth-aware rendering.
5. **Universal search bar** (not yet brainstormed) — a new global search entry point across characters/groups/creators/images/forum, replacing today's separate per-page search boxes.
6. **Explore page redesign** (not yet brainstormed) — follows once specs 3-5 exist so it can incorporate For You/Featured, the new global search, and Embed v3's visual language.

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
