# Memory & Lore — audit, then a real plan

Three passes today: (1) audited memory + lore as they exist, (2) you asked pointed follow-ups that surfaced a real design gap, (3) that turned into a full design spec for unifying them properly. This report reflects where things landed after all three.

**Spec:** `docs/superpowers/specs/2026-07-20-memory-lore-unification-design.md` — read that for the actual implementation-ready design. This doc is the narrative version: what's true today, what's wrong with it, and what the plan fixes.

---

## Where things stand right now (as of this morning, before the new plan)

Legacy memory (v1) was already made unreachable earlier today per direct instruction — `chat_service.py` hardcodes `memory_v2 = True`, `session_lore.py`'s v2 gates were removed. But **the v1 code itself still exists**: `retrieval.remember()`, `_extract_turn_signal`, `vectors.store_memory`/`search_memory` are dead weight, not deleted. And separately, lore and memory_v2 have always been two independent systems that just happen to render into adjacent sections of the same prompt — nothing ranks them together, nothing lets one influence the other.

## The question that mattered: do relationships work?

**No.** Confirmed directly in code: `lore_links` (the A-relates-to-B data, stored and shown in the UI) is never read by any retrieval or memory code — grepped every retrieval-adjacent file, the only reference is the router's own `_attach_links()`, which exists purely to decorate the API response for the UI panel. Matching lore entry A never pulls in linked entry B. It's real data that the model never sees.

## The question that mattered more: what happens when lore changes?

This is the one that actually reshaped the plan. Lore is authoritative and editable — a creator can rewrite "the government rules the city" to "the government was overthrown" at any time. Memory facts are derived from conversation and decay over time. Naively merging them as equal citizens in one ranked pool creates two real problems:

1. A stale memory fact from before a lore edit could outrank the updated lore purely on embedding distance — the model sees both, with nothing telling it which is current.
2. Lore would get scored by the same age-based decay memory facts use, which is backwards — canonical world truth shouldn't fade just because no one mentioned it recently.

And then you pushed further: memory shouldn't just defer to lore — **memory should be able to update lore**. If the player overthrows the government mid-story, the story itself should start reflecting that, not just carry a floating "note" alongside lore that still says the old regime is in charge.

## The design that resolves this

Full detail in the spec; summary here:

- **Lore joins memory_v2's candidate pool** — same KNN retrieval, same ranking, same token budget, one unified prompt section instead of two separate ones. Lore candidates are scored as non-decaying (`retention() == 1.0` unconditionally) so they never fade just from being unmentioned.
- **Relationship traversal, finally wired.** Matching a lore entry now pulls in its directly-linked entries (one hop, `lore_links`) as candidates too, carrying the relationship label. This closes the gap from the first question above.
- **Memory can update lore, safely.** When batched fact-extraction detects a story event that contradicts or supersedes an existing lore entry, it proposes an update and applies it as a **session-scoped override** — reusing the override mechanism `session_lore.py` already has. The player's own story now sees "the government was overthrown"; the shared lorebook every other session/character reads is untouched. This was the key call: mutating the *shared* lore entry directly was on the table and explicitly rejected — one bad LLM inference permanently corrupting a lorebook other people rely on is not an acceptable trade for this feature.
- **v1 memory gets deleted, not just bypassed** — `remember()`, `_extract_turn_signal`, the legacy vector store functions, the dead prompt branch, all removed. Char-state (doing/location/known-names), which only existed inside legacy's per-turn call, folds into memory_v2's existing batched extraction instead — one accepted trade-off: the character-state panel now updates every 5 exchanges instead of every turn, in exchange for deleting a redundant LLM call that ran every single turn.
- **Test coverage gets built in, not bolted on after.** The prior audit's biggest complaint about memory_v2 was zero tests on the ranking/packing logic. The spec calls for unit tests on the new merge/decay/expansion/update-detection logic from the start.

## What's still open (deliberately, for the implementation plan to resolve)

1. Whether lore-update detection runs against every drafted fact per batch, or is filtered to fact types/importance likely to actually matter (avoiding noise/cost on every trivial exchange).
2. How the unified prompt section visually distinguishes "established world fact" from "something that happened" — likely reusing the same `## Ongoing & pinned` / `## Recalled from earlier` subheading pattern the token-budget packer already has, rather than inventing new structure.
3. Which legacy config keys (`top_k_memory`, `mem_max_dist`, etc.) become fully dead versus need repurposing, before deleting them from settings.

## Next step

Spec is written and committed. Once you've reviewed `docs/superpowers/specs/2026-07-20-memory-lore-unification-design.md`, the next move is `writing-plans` to turn it into an actual implementation plan.

---

## Update: implementation complete, measured against a real 1700-turn conversation

All 16 tasks of `docs/superpowers/plans/2026-07-20-memory-lore-unification.md` are done and
individually reviewed. v1 memory (`remember()`, `_extract_turn_signal`, the legacy vector-store
functions) is fully deleted, not just bypassed. Lore is a ranked, non-decaying participant in
memory_v2's pool; `lore_links` one-hop relationship expansion is wired up; story events can
propose session-scoped lore overrides via the same batched extraction call.

The open question from this report's original draft — "what's the effective turn count before
semantic retrieval degrades?" — was answered empirically, not by further reasoning from the
decay formula. Full writeup: `modules/py/memory_probe_replay_report.md`.

**Real result: 3/13 planted-fact probes passed (23%) across turn distances from 15 to 700.**
This is worse, and differently-shaped, than the original reasoned-from-code estimate predicted.
The failure isn't primarily decay-driven — a probe at 700-turn distance passed while one at
90-turn distance failed. The actual cause, visible directly in the retrieved context blocks: a
handful of generic, frequently-reinforced "ongoing behavior" facts (e.g. repeated-question
observations) dominate the token budget's scored portion and outrank specific one-off planted
facts (named NPCs, places, objects), regardless of how recently either was mentioned. In a
conversation with a lot of repetitive small talk, the ranking's reinforcement signal actively
works against surfacing rarer, more specific facts — the system doesn't so much "forget" as get
crowded out by its own noise.

This points at a real follow-up (not scoped into this plan): either de-weighting reinforcement
for low-specificity/high-frequency facts, or giving named-entity facts a ranking floor so they
can't be fully crowded out by generic reinforced ones.
