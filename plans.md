# Feature backlog

Ideas surveyed 2026-07-25 against the actual codebase. Everything listed here was verified as not yet built. Already built and therefore excluded: inpainting, img2vid, session branching, multiplayer groups, SillyTavern card import, lore relationship graphs, OAuth, WebAuthn, tutorials, feature flags, announcements, in-chat image generation, chapter summaries via the summarize endpoint.

## Shipped since the 2026-07-25 survey

### Voice (TTS) — done, 2026-07-28
Dual-voice on-demand playback: narrator voice for actions, character voice for quoted dialogue. Kokoro container as shipped default plus bring-your-own OpenAI-compatible endpoint via the two-tier settings pattern. Creator picks the character voice in the workshop, user can override per session. Server-side segment synthesis, WAV concat, cached under MEDIA_DIR keyed by content and voice hash, `tts` feature flag, live Kokoro container confirmed running. Plus follow-on polish: real picker UI instead of a native `<select>`, split character/narrator default voices, RPG narrator no longer re-deciding a line the player just self-voiced. **STT (whisper mic input) still deferred** — tracked separately below, not part of TTS's scope.

### Discovery & embeds rework (six sequential specs, brainstormed 2026-07-28) — specs 1-4 done
Kicked off by a critique of the share-card (Discord/OG embed) design, which surfaced that the underlying data it wanted (genre, real engagement) didn't exist yet, and that the landing Explore page has no real ranking at all (`_shuffleSample`, literal random shuffle). Sequenced so each spec's data feeds the next:
1. **Genre taxonomy** — done. Single-select `genre` field on characters and groups, fixed 12-option list, plus a `>genre` Explore search-box filter token following the existing `#tag`/`@creator` pill pattern in `explore-characters.js`.
2. **Content likes** — done. Binary like/unlike on characters, groups, and standalone images via `content_likes` table (generalizing `comments`' polymorphic `target_type` pattern).
3. **For You / Featured** — done, then tuned. Landing Explore page now has a personalized "For You" carousel (genre affinity + likes + chat history + follows, `backend/explore_ranking.py`) and a non-personalized "Featured" (likes + 14-day-half-life recency decay), both capped at 6/9/12/18 items across mobile/tablet/desktop/ultrawide. Cold-start users with no signal get the old random shuffle instead of a meaningless ranking. Post-ship tuning: exact chat-history match was originally weighted highest (4.0) in For You's scoring, which just resurfaced your own chat history instead of surfacing discovery — dropped to 0.5 (below every other signal) so it's a nudge, not the dominant factor.
4. **Embed v3** — done, then heavily iterated live against real card screenshots. Component-based share-card rework: six distinct composers in `server.py` (character/profile/group/shared-chat/image/docs) instead of two shared layouts forced onto everything. Iteration highlights: bottom-anchored layout everywhere (content was stacking down from the top and leaving dead space instead of anchoring to the canvas bottom); avatar contain-fit instead of cover-crop (cover+circle-mask was double-cropping non-square pfps); long names shrink-to-fit instead of truncating; profile/image/group/shared-chat cards all show `@handle` + approved custom tag pill + avatar in the same style; chat-mode vs RPG-mode group cards are now visually distinct (flat navy + contact-tile avatars + blue accent + message icon vs the original cinematic split-cast photo hero + gold accent); chat-mode groups and multiplayer sessions get an Oxford-comma "Join the chat with A, B and C." description instead of a plain comma join.
5. **Universal search bar** (brainstorming now, 2026-07-28) — a new global search entry point across characters/groups/creators/images/forum, replacing today's separate per-page search boxes. Design intent: one core, fully customizable component that every existing search bar in the app (Explore's `#tag`/`@creator`/`>genre` pill-token box, forum search, admin lists, etc.) can adopt, each configuring which token types/scopes apply to it rather than reimplementing search UI per page.
6. **Explore page redesign** (not yet brainstormed) — follows once spec 5 exists so it can incorporate For You/Featured, the new global search, and Embed v3's visual language.

## Backlog

### Chapter/act tracking for sessions (P2)
Surfaced during Embed v3's brainstorm: the shared-chat card wanted a "Chapter 14"-style stat, but no chapter/act structure exists anywhere in the schema — sessions are just a flat message stream. Would need creators to have a way to mark chapter/act boundaries, plus a way to query "current chapter" for a session. Not part of Embed v3 — that spec uses real message count in this stat slot instead.

### Seed + dimension storage for generated images (P2)
Also surfaced during Embed v3's brainstorm: the image card's reference mockup showed seed and pixel dimensions, but `standalone_images` stores neither today (only prompts, checkpoint, sampler, steps, CFG). Small addition to the image-generation pipeline to capture and persist both at generation time — not a card-rendering concern, so kept out of Embed v3's scope.

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
