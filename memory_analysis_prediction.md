# Memory V2 Analysis & Accuracy Prediction

Date: 2026-07-17 · Branch: `settings-feature` · Status: **V2 live** (`memory_v2: true`)
Extraction model: `deepseek-v4-flash` (settings-table endpoint) · Embeddings: local `nomic-embed-text` (768-dim, shared pgvector index)
Spec: `docs/superpowers/specs/2026-07-16-memory-system-design.md` · Harness: `modules/py/memory_probe_replay.py`

---

## 1. What was measured

All numbers below are from real runs of the probe harness against the production write/read
path (`memory_service.extract_batch` / `retrieve_block`) with real LLM extraction and real
pgvector retrieval — no mocks. A probe passes when every expected keyword appears in the
rendered 600-token memory block and no rejected keyword does.

### 1a. Contradiction handling (10-turn script, trust→betrayal at the Hall)

| Metric | Result |
|---|---|
| Supersede fired on the contradicting batch | ✅ (`old=mffcc… new=mfc9d…`, validity window closed) |
| "How does Mira feel about Doran?" retrieves *current* state | ✅ PASS |
| Unrelated fact recall (compass) | ✅ PASS |

The bi-temporal chain worked on the first real-model run: the stale fact stays retrievable
as history (rendered "(this later changed)"), the successor is what ranks.

### 1b. Participant scoping (10-turn script, secret told in a private scene)

| Metric | Result |
|---|---|
| Secret content recalled when its participant is present | ✅ PASS |
| Secret content excluded when participant absent | ✅ PASS (after fix) |
| **Bug found by this probe** | Reserved (active-state) pool bypassed the participant filter entirely — fixed (`participants_present` now gates active states; pinned stays exempt) |
| **Design gap (open)** | Filter tests *scene presence*, not *witnessing*. The user is present in every scene, so user-attributed meta-facts retrieve everywhere. Harmless in 1:1; must become POV-character filtering before `[as Name]` NPC knowledge isolation |

### 1c. Dedup A/B — the core growth-control claim (120-turn script, 10 distinct facts restated ~12× each)

| Arm | Facts extracted | Rows stored | Merged (reinforced) | Probes (6 narrow + 2 broad) |
|---|---|---|---|---|
| Naive (append-only) | 103 | **103** | 0 | 8/8 PASS |
| Reconciled (ADD/REINFORCE/SUPERSEDE) | 112 | **20** | 92 (82%) | 8/8 PASS |

**5.2× row compression at identical recall.** The reconciler almost never misclassified: 20
adds against 10 true concepts means roughly two rows per concept (paraphrase drift), not
uncontrolled duplication.

**Honest negative result:** naive append did *not* fail any probe at 103 rows. The predicted
duplicate-crowding collapse is real in mechanism (top-k slots demonstrably fill with copies)
but does not bite yet at ~100 rows with `CANDIDATE_K=32` and a 600-token block. The crowding
claim remains unfalsified below ~100 rows; it is a projection above that (see §3).

### 1d. Prompt-layer effectiveness (live turns, RPG mode, DeepSeek non-think)

| Behavior | Result |
|---|---|
| Memory guard vs fabricated shared history ("dragon at Emberfall Keep") | ✅ In-character uncertainty, zero confabulated detail |
| Extraction noise discipline | ✅ Extractor returned "no facts" for OOC/meta turns — no store pollution |
| Director sigil `(╾━╤デ╦︻:[ooc])` | ✅ Honored; correct author-mode reply |
| Plain-text `(OOC:)` mild break attempt ("pizza dough") | ✅ Integrated in-fiction (foreign-tongue reaction), header intact |
| Plain-text `(OOC:)` prompt-extraction attempt | ⚠️ No content leaked, but replied in OOC voice — model safety training outranks the immersion lock. Every such event now logs `WARNING immersion break` (measurable rate in Server Logs) |
| Scene/timestamp header | ✅ Present on all sampled turns (plus `ensure_scene_header` code backstop) |

---

## 2. V1 vs V2 — what actually differs

Both live in the same PostgreSQL + pgvector instance, HNSW cosine index, session-scoped.

| Dimension | V1 (`memory_vectors`) | V2 (`memory_facts`) |
|---|---|---|
| Unit stored | Flat `key_points` prose blob, 1/turn | Typed fact rows (event/state/relationship/world/profile) |
| Write path | 1 LLM call **every turn** | 2 LLM calls per **5 settled turns** (extract + reconcile) — cheaper and flat |
| Dedup | None — every restatement is a new row | ADD/REINFORCE/SUPERSEDE vs top-3 neighbors (measured 82% merge) |
| Contradictions | Both versions stay live, both retrievable | Bi-temporal supersede; stale fact annotated "(this later changed)" |
| Retrieval | Top-**4** KNN, cosine ≤ 0.80, that's all | Top-32 candidates → participants hard filter → retention filter → weighted score → reserved+scored budget |
| Active state (open wound, promise) | No concept — must win a similarity contest to appear | Guaranteed reserved slot, decay-immune while the validity window is open |
| Participant scoping | None — any memory retrievable in any scene | Hard filter (world facts exempt, pinned exempt) |
| Prompt budget | Up to 4 unbounded lines | Hard 600-token ceiling, never grows |
| Confabulation guard | None | Non-overridable "recalled memory is exactly this block" + in-character-uncertainty instruction (measured working) |
| Regen safety | Overwrite keyed by user message id | Settle margin — the open exchange is never extracted |

---

## 3. Predicted accuracy at the 1.7k-turn target

Predictions extrapolate from the measured 120-turn data and the mechanics above; they are
**projections, not measurements** (see caveats). "Single-cue recall" = user references one
past fact; "scene assembly" = block must cover several distinct facts at once; "contradiction
consistency" = character never asserts the superseded version.

### Projected store size at 1,700 turns

| | V1 | V2 naive (hypothetical) | V2 reconciled (shipped) |
|---|---|---|---|
| Rows | ~1,400–1,700 (linear, 1/turn) | ~1,450 (linear) | **~250–350** (sublinear — bounded by distinct facts; measured 20 rows/120 turns on a fact-dense script) |

### Projected accuracy

| Capability | V1 predicted | V2 predicted | Basis |
|---|---|---|---|
| Single-cue recall (recognition-driven) | ~70–85% | **~95%** | Both arms passed all narrow probes at 100 rows; V1 degrades from k=4 slots consumed by near-dupes of *other* recurring facts plus the 0.80 distance cutoff dropping paraphrases; V2's 32-candidate pool over a ~10× smaller, mostly-distinct store keeps headroom to 1.7k |
| Multi-fact scene assembly | ~25–40% | **~80–90%** | V1's k=4 mathematically caps coverage at 4 lines, and duplicates of the most-repeated concept claim them (at ~160 rows/concept parity this is structural, not incidental); V2 fits ~15–25 distinct facts in the 600-token block and measured 100% broad-probe coverage at 103-row scale |
| Contradiction consistency (the product metric) | ~50% (coin flip — both versions retrievable, ranking decides) | **~90%** | V2 measured 1/1 supersede + correct retrieval; residual risk is reconciler miss rate over long horizons, mitigated by the "(this later changed)" annotation and (future) memory-page editing |
| Active-state persistence (wound at turn 400 still true at turn 900) | **~0–10%** (must coincidentally win a k=4 similarity contest 500 turns later) | **~100% by construction** | Reserved slot + decay immunity while the window is open; failure mode shifts to missed *resolution* detection (stale-open states — demotion valve specced, not yet built) |
| Confabulation rate (invented shared history) | High (no guard; card text often *instructs* NPC memory) | **Low** | Guard measured working on first adversarial probe; enforced every turn, both modes |
| Cost per turn at turn 1,700 vs turn 100 | Flat (1 call/turn) | **Flat and ~60% cheaper** (2 calls/5 turns), retrieval compute negligible at both scales (pgvector HNSW over ≤2k rows) |

### Why the V2 numbers are believable — and where they'd be wrong

The load-bearing measured facts are the **82% merge rate** and **zero probe regressions at
5.2× compression**. If those hold at 1.7k turns, the candidate pool stays small and distinct,
and every downstream number follows. They would *not* hold if: (a) real chat is far less
fact-repetitive than the synthetic script, making merge rate irrelevant (then naive and
reconciled converge — no harm); (b) the reconciler starts REINFORCE-ing facts that are
actually *different* at scale (silent information loss — the probe suite would catch keyword
disappearance; rerun it per-release); or (c) extraction quality drops on messy real prose
(mixed OOC, multilingual — the replay-real-sessions test in the spec exists for exactly
this and has not been run yet).

### Caveats (read before trusting the table)

- Sample sizes are small: one model, synthetic scripts, single runs, n=1 contradiction case.
- The crowding collapse that justifies dedup was **not observed** at ≤103 rows — V1's
  projected scene-assembly failure rests on its k=4 arithmetic, not on a measured V2-naive
  failure. A 500+ turn script (or replaying a real long session) would settle it.
- 1.7k-turn behavior is extrapolated; nothing was run past 120 turns.
- POV-vs-presence gap (§1b) means NPC knowledge isolation is **not** currently promised.
- Retention decay is implemented but effectively untested at range (no script spans enough
  turns for RETENTION_FLOOR to trigger except the unit tests).

---

## 4. Recommended next falsifications (in value order)

1. Replay a real long session from the production DB through the write path; hand-probe.
   Catches extraction failure shapes synthetic scripts can't (messy prose, language mixing).
2. 500-turn generated script with 30+ facts to actually observe (or refute) naive crowding
   and V2's behavior as retention decay starts filtering.
3. Adversarial reconciler suite: near-miss pairs that *look* like restatements but differ in
   one load-bearing detail ("stabbed in the left/right shoulder") — measures wrongful-merge
   rate, the main silent-loss risk in §3.
4. Multi-injury/promise overload script — exercises reserved-pool compression and the
   scored-slot floor under extreme-RP load.
