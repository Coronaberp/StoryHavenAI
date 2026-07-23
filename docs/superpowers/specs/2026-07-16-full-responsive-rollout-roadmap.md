# Full Responsive Rollout Roadmap (Tablet / Desktop / Ultrawide, All Screens)

## Goal

The 2026-07-16 tablet-tier spec fixed shared nav chrome (`#tabletRail`) and the generic `.card-grid` auto-fill rule for all four tiers. It explicitly excluded per-screen internal layout. Every routed screen in `new_ui` still renders the same single-column, mobile-first markup at every viewport above 768px — just stretched wider, with no layout adapted to the extra space. This roadmap sequences the fix across all ~30 routed screens.

## Screen batches

Used to scope each phase's work into tractable specs/agent dispatch, not a phasing axis itself:

| Batch | Screens |
|---|---|
| Browse | Compendium, Pantheon, Artisans, Pinacotheca, Symposium, Symposium-thread, character, artisan-profile |
| Create/Chat | Parlance (ChatView), Sanctum-Create, Forge, Grimoire, Masks |
| Account | Dossier, Settings, Settings-Appearance, Settings-Model, Settings-Account, Settings-Blocks |
| Admin | Admin, Admin-Users, Admin-Moderation, Admin-Previews, Admin-Train, Admin-Emojis, Admin-Config, Admin-Health |
| Auth | Login, Register, Onboard |

## Phases (the actual sequencing axis)

### Phase 1 — Tablet (768–1023px)

Pattern: **constrained two-up / capped column.** Card grids already auto-fill via the existing `.card-grid` rule — no change needed there. Single-purpose screens (Chat, Forge, Settings, Auth) currently stay full-bleed single-column; at this tier they gain a centered content column (~600–680px cap) instead of stretching edge-to-edge. Admin's card-stacked tables become real `<table>` layouts at this width.

### Phase 2 — Desktop (1024–1535px)

Pattern: **split-view.** Screens with a natural primary/secondary relationship (Chat: transcript+composer vs. session info rail; Forge: canvas vs. options panel; Sanctum-Create: form vs. live card preview) get a real two-pane layout. Tablet stays single-column-but-wider from Phase 1 — this is desktop-only.

### Phase 3 — Ultrawide (≥1536px)

Pattern: **cap and center, don't multiply.** Extends the existing `#main` 1600px max-width decision to screen-local wide elements (split-view panes get capped widths, not stretched). Per-screen decision whether freed width earns a third visible element (e.g. Chat: transcript/composer/info rail all at once) or stays centered dead space.

## Sequencing within each phase

Each phase runs Browse → Create/Chat → Account → Admin → Auth, one batch at a time, each batch gets its own implementation plan and is dispatched via **parallel agents** (`superpowers:dispatching-parallel-agents`) since screens within a batch don't share state and can be built independently. Each batch is verified (Playwright viewport checks) and committed before the next batch starts.

## Out of scope

- No new color/type tokens — reuses `themes.css` and existing component classes throughout.
- No breakpoint changes — same 4-tier scale as the nav spec.

## Status

**Shared chrome (`#tabletRail`, `#sidebar`, `#bottomNav`, `.card-grid`) is now solid across all four tiers** — the 2026-07-16 nav spec's `.card-grid` auto-fill rule turned out to have never actually shipped (still hardcoded 2-column) and was fixed as part of Phase 1/Browse. Several additional shared-chrome bugs surfaced during Phase 1/Browse execution and were fixed in the same branch since they blocked every tablet screen, not just Browse's: the desktop sidebar's Compendium/Sanctum/My Dossier now expand as a real inline accordion instead of opening the mobile modal-sheet menu; the fixed notif bell/privacy toggle no longer overlaps in-flow page-header buttons on tablet/desktop and instead lives at the bottom of the tablet rail (with the notifications panel's positioning made direction-aware to match); the tablet rail's avatar no longer requires scrolling to reach and opens the My Dossier modal instead of jumping straight to Settings; the tablet rail's active-tab marker now matches the mobile bottom nav's bookmark/ribbon shape instead of a plain bar. Full detail in `2026-07-16-tablet-browse-batch.md`'s Status section. This means Phase 2 (desktop) and Phase 3 (ultrawide) can build on a working shared-chrome baseline rather than re-discovering these bugs.

**Phase 1 (Tablet) is complete across all 5 batches:**

- **Browse** — `.content-col` applied to Symposium, Symposium-thread, CharacterView, ArtisanProfileView; `.card-grid` fixed to auto-fill (see plan doc for shared-chrome fixes above).
- **Create/Chat** — `.content-col` applied to Sanctum-Create, Forge, Grimoire, Masks. Forge additionally got a real two-column split (options left, smaller sticky preview + Recent-generations right) and a combined mode/arch-chips row, per direct design feedback — ahead of Phase 2's split-view work, since the single-column-but-capped layout looked visibly unbalanced once built. Chat/Parlance deliberately excluded (chromeless immersive layout — belongs to Phase 2).
- **Account** — `.content-col` applied to the placeholder Dossier route (via `renderPlaceholder()`) and all 5 Settings screens.
- **Admin** — `.content-col` applied to all 8 Admin screens (Overview, Users, Moderation, Previews, Train, Emojis, Config, Health). Real `<table>` conversion for the card-stacked rows deliberately deferred, same reasoning as Chat.
- **Auth** — no work needed. Login/Register/Onboard (`auth-scene.js`) already have their own `max-w-[320px] mx-auto` cap baked into the form, independent of viewport — verified correct at 800px without changes.

Plans: `2026-07-16-tablet-browse-batch.md`, `2026-07-16-tablet-create-chat-batch.md`, `2026-07-16-tablet-account-batch.md`, `2026-07-16-tablet-admin-batch.md`.

**Process note for Phase 2/3:** dispatching many parallel agents against files sharing one git working tree causes real race conditions on `git add`/`git commit` — several Admin-batch agents' commits ended up cross-contaminated (one file's change landing in another's commit, a file's staged change getting swept into a concurrent commit) before self-correcting. All were caught and fixed by the agents themselves or by a post-batch audit (rendered every screen via Playwright, confirmed exactly one `.content-col` per screen, confirmed unrelated pre-existing uncommitted work in each file survived untouched). Future batches should budget time for this kind of audit after parallel dispatch, not just trust individual agent self-reports.

Phase 2 (Desktop) and Phase 3 (Ultrawide) get their own specs written just-in-time, following the same batch/pattern structure, when started.
