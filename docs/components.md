# Component versions

Tracks the version of each major StoryHaven AI subsystem independently, since they don't all move together. A version bump here means a real rework shipped, not a patch. The linked architecture guides describe the current implementation; release reports preserve the history.

## v2.1 release line

| Component | Version | Status | Notes |
|---|---|---|---|
| Memory | v2.1 | Shipped | Typed-fact extraction (`event`/`state`/`relationship`/`world`/`profile`), decay-weighted retention ranking, lore-override integration. See `docs/ai/memory_design.md` for the full pipeline. |
| Administration | v2.1 | Shipped | Mobile-first admin shell rework (sidebar/switcher), RBAC capability-based permissions replacing the old flat permission matrix, new Dev-only tab (test-run copy-command, translation resync + pending-status, model procurement fetch with manual fallback). |
| Embeds | v3 | In progress | Component-based share-card rework replacing the two shared PIL composers (`_compose_profile_card`, `_compose_group_card`) with six real per-type designs. Design spec approved; genre taxonomy and content likes (its data dependencies) are implemented and merged; For You/Featured and the card rendering itself are mid-implementation. |
| UI | v2 | Shipped | `new_ui/` (Tailwind, mobile-first) fully replaced the legacy vanilla-JS `static/` SPA as the live app. |
| Chat | v2 | Shipped | Multiplayer turn-lock rework: composer never disables, any participant can send at any time, global Stop-generating, per-user typing indicators (multiple simultaneous typers), persona-claim guards against the AI narrating for a player's own character. |

## Dependencies between in-progress components

Embeds v3 depends on two smaller specs that ship as part of its v3 line rather than getting their own top-level version number: genre taxonomy (a new field on characters/groups) and content likes (binary like/unlike on characters/groups/images). Both are implemented; For You/Featured (the Explore page ranking rework, same v3 sequence) and the embed card rendering itself are still in progress.

## Format

Add a new row when a component's next version actually ships (design approved, implementation merged and live-verified) — not when a spec is merely written. "In progress" is for a version whose spec is approved and implementation has started; leave a component out of this table entirely if no version bump is currently planned.
