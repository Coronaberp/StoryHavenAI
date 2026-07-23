# StoryHaven AI — V2 Release Notes

Everything new since V1.2, in plain language. V2 is a complete UI rebuild (`new_ui/`, replacing the old vanilla-JS SPA in `legacy_ui/`) shipped together with a full capability bundle — new memory system, better prompting, JWT auth, passkeys, video/inpainting generation, a full translation system, and a large security/reliability pass.

---

## What's new in V2

- **The entire app was rebuilt from scratch** — Tailwind CSS, mobile-first, four responsive tiers (mobile/tablet/desktop/ultrawide), every screen redesigned: Explore, Chats, Workshop, character creation, Forge (image/video generation), Grimoire (lore), Masks (personas), full Admin panel, Settings. The old SPA lives on in `legacy_ui/` for reference only — nothing there is served.
- **A second-generation memory system** — typed, bi-temporal facts extracted from settled turns (not just embedding similarity over raw messages), with participant/retention scoring, a fixed token budget, and a reserved-slot mechanism so pinned/critical facts survive ranking. Ships behind a config flag alongside the original memory system.
- **Session-scoped lore secrets** — lore entries can hold hidden content that's discovered and revealed per-session (not globally), with per-secret reveal tracking and an admin/session override mechanism, surfaced in a new Session Lore panel in the chat header.
- **JWT-based auth** — replaced opaque HttpOnly session cookies with signed access/refresh JWTs (6h/3d), with a full whitelist/rotate/revoke repository layer so a single token can be individually invalidated without logging out every session.
- **Passkey (WebAuthn) sign-in** — fingerprint/face sign-in via the device's own OS-level authenticator, no extra app required. Guided first-time setup, one-tap autofill on the login screen, and a "require passkey to sign in" strict mode as an alternative to a password.
- **TOTP two-factor, fully self-service** — set up, disable, re-enable, and regenerate backup codes from Settings; TOTP setup is now skippable at sign-up (with a clear no-self-reset warning) instead of forced; admins can clear a locked-out user's TOTP.
- **Guest accounts and invite codes** — instant-signup guest tier (randomly generated unchangeable username, no profile customization, can play existing characters but not create new ones, capped trial allowance of story tokens/images/videos, upgradeable to a full account by an admin with everything carried over) and admin-managed invite codes that skip the normal approval wait.
- **Image-to-video and inpainting, for real** — Forge's Video and Inpaint modes are now fully wired end-to-end (mask painting, duration/FPS controls, Wan2.1 first/last-frame video), not the earlier "coming soon" stubs.
- **A GPU priority queue with a thermal gate** — every image/video generation request now queues fairly instead of racing, with a live "forge is cooling down, your spot is held" / "waiting — N ahead of you" status so a busy GPU never just silently stalls a request.
- **Admin LoRA training UI** — full Train/Progress/Test/Jobs tabs: image grid with per-image captions (plus bulk `.txt` import), live progress with a Chart.js loss curve, cost/time estimate before starting, resume-from-checkpoint, and a Test tab to try the trained LoRA immediately without leaving the page.
- **Full admin panel** — overview dashboard (service health, stats, attention banner), Users (role/Dev-role/suspend/reset-password/moderation notes), Moderation (7 queue types: signups, flagged endpoints, password resets, model requests, title requests, image reports, content reports), Server Configuration (endpoints, sampling defaults, host allowlists), Model Preview curation (checkpoints/LoRAs/samplers/schedulers/upscalers with search+refresh per category), Emoji/sticker moderation, and a live Health dashboard (up/down + latency charts, server log viewer).
- **A real community forum and unified comments** — Reddit-style threads with categories/replies/upvotes separate from character comments; comments brought to full parity with the old UI (edit, delete, likes, emoji reactions including custom ones, reply threading, attachments) plus a paper-plane composer with inline emoji/sticker picker.
- **A unified notification inbox** — comments, forum replies, milestones, and (for admins) signups/reports/requests all land in one bell instead of scattered alerts.
- **Full UI translation into 13 languages** — English, Spanish (Spain), Tagalog, Turkish, Simplified Chinese (Singapore), Russian, Portuguese (Portugal), Japanese, Hindi, Tamil, Arabic, Hebrew, and Dutch. Covers every button, label, modal, tooltip, and page header across the entire app (not just chat replies, which already generated directly in a session's chosen language). Arabic/Hebrew get full RTL layout mirroring, not just translated text. An admin-triggered resync tool lets new/changed English copy get translated on demand instead of silently reverting to English.
- **An interactive, forced-action tutorial** — 8 real lessons that make you actually do the thing (create a character, send a message, generate an image) inside the live app via a spotlight-and-click-gate engine, replacing the old passive walkthrough.
- **Autosave everywhere that matters** — character creation, persona drafts, lore entries, and Forge's prompt/settings all autosave every few seconds and restore on reload, so a crashed tab or accidental navigation doesn't lose work.
- **A large security hardening pass** — 6 stored-XSS bugs found and fixed across character/comment/forum/lore rendering, an SSRF DNS-rebinding TOCTOU gap closed, a leaked API key in a settings response fixed, a global-lore admin-bypass fixed, shell-injection in the model-request curl builder fixed, and every plaintext-at-rest secret (lore secrets, memory content, session overrides, the translation cache, admin API keys) now encrypted.
- **A styled confirm dialog everywhere** — every native browser `confirm()`/`prompt()` in the app (delete, sign-out, discard changes, destructive admin actions) replaced with the app's own themed modal, consistently.
- **Performance and correctness fixes from a live-app profiling pass** — admin health's charts/service cards now update in place instead of destroying and rebuilding on every click; the LoRA training progress panel no longer silently freezes when you switch tabs and back during an active run; `GET /api/auth/me` now actually carries a user's saved interface language (previously the whole translation pipeline was wired but never triggered for any real user).

---

## Full feature list

### Accounts & profile
- Sign up & stay logged in (JWT access/refresh tokens, no more re-entering your password every visit)
- New accounts reviewed by an admin before use, or skip the wait with an invite code, or start instantly as a guest
- Guest tier: random unchangeable username, capped trial allowance, no profile customization, upgradeable to full by an admin
- Passkey (fingerprint/face) sign-in, with guided setup and an optional "always require it" strict mode
- Two-factor (TOTP) authentication, fully self-service, skippable at sign-up, admin-recoverable if locked out
- Your own profile page — avatar, banner, bio, join date, social links, custom title badge (admin-approved)
- Fully custom profile design — bring your own HTML/CSS with placeholders for avatar/bio/stats/links/title/required Share-Edit-Comments-Block controls
- Change your password any time
- Browse creators, not just characters — searchable directory with avatar-ring gradients
- Block anyone — mutual comment hiding
- Interface language, one of 13, applied to every button/label/modal across the whole app

### Building characters
- Full character sheet — name, personality, backstory, greeting(s), example dialogue, tags
- Two ways to play — first-person Character mode, or third-person RPG/Game Master mode
- Multiple opening greetings per character
- Avatar & banner upload with built-in cropping, animated GIFs supported
- Autosaving drafts, resumable on reload
- Generate-from-description and card-import creation paths
- Mature-content labeling
- Custom character pages with your own HTML/CSS

### Chat
- Full chat interface rebuild — streaming replies, message actions (copy, inline edit, delete, regenerate, continue)
- Session-scoped lore secrets — discovered and revealed per conversation, with a dedicated reveal panel
- A second-generation typed-fact memory system (behind a config flag) alongside the original
- Reply language per session — pick once at the start of a new chat, locks in, with a script-mismatch safety net
- Dice roll quick-bar for RPG mode
- Inline `/` command suggestions and `{directive}` syntax hints in the composer
- Grouped, collapsible conversation list (Parlance) by character, newest first

### Images & video (Forge)
- Text-to-image and image-to-image generation with a live SSE preview
- Image-to-video generation (Wan2.1), including first/last-frame video
- Inpainting with mask painting
- Standalone Upscale tab with before/after comparison
- A GPU priority queue with a live "waiting — N ahead of you" / thermal-cooldown status
- Model/LoRA/sampler/scheduler pickers with plain-language descriptions and sane defaults
- Community and My Creations galleries as reference-image sources, with search and tag-pill filtering
- Compile tab — GIF and vertical-strip compositing from a set of generated images

### Lore & personas
- Grimoire (lore) — category-grouped entries, list and graph/web views, entry linking, image attachments, client-side search
- Session-scoped hidden lore, discovered and revealed per conversation
- Masks (personas) — create/edit/delete, set a default, autosaving drafts

### Community
- A real forum — threads, categories, replies, upvotes
- Comments at full parity with the old UI — edit, delete, likes, custom emoji reactions, reply threading, attachments
- A unified notification inbox

### Admin panel
- Overview dashboard — service health, stats, attention banner, top users
- Users — role management, Dev-tier grant/revoke, suspend, reset password, moderation notes, identity labels
- Moderation — 7 queue types (signups, flagged endpoints, password resets, model requests, title requests, image reports, content reports)
- Server Configuration — chat/embed endpoints, sampling defaults, host allowlists, resync UI translations on demand
- Model Preview curation — checkpoints/LoRAs/samplers/schedulers/upscalers, per-category search and refresh
- Emoji/sticker moderation
- Live Health dashboard — up/down status and latency-history charts per service, server log viewer with level filter
- LoRA training — full Train/Progress/Test/Jobs workflow, live loss chart, cost estimate, resume-from-checkpoint

### Localization
- 13 supported UI languages, applied across every screen (not just chat)
- Native-name language picker (Español, 简体中文（新加坡）, العربية, etc.)
- RTL layout for Arabic and Hebrew, including mirrored directional icons
- Admin-triggered resync so new or changed English copy gets translated on demand

### Under the hood
- JWT-based auth with per-token whitelist/revoke, replacing opaque session cookies
- Plaintext-at-rest secrets encrypted throughout (lore secrets, memory content, session overrides, translation cache, admin API keys)
- 6 stored-XSS bugs found and fixed across character/comment/forum/lore rendering
- SSRF DNS-rebinding gap closed, leaked-API-key response fixed, shell-injection in the model-request command builder fixed
- Automated test suite covering memory extraction/ranking/storage, chat session repositories, lore links
- A live-app performance profiling pass: fixed real re-render/chart-teardown bottlenecks, found and fixed a systemic translation-cache bug (short echoed strings silently cached as if genuinely translated)
