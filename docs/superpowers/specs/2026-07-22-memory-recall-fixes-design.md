# Memory Recall Fixes: Soft Participant Rule + Long-Session Catch-Up

## Problem

A live 44-turn roleplay transcript (Magic Academy RPG) was analyzed against the
running memory implementation and surfaced two recall gaps that are provoked by
this kind of fast-paced, NPC-rotating story rather than by generic edge cases.

1. **Hard participant filter drops unresolved threads.**
   `backend/memory_ranking.py`'s `passes_filters` uses `participants_present` as
   a hard gate: a non-`world`, non-lore fact whose named participants do not
   appear in the recent-text window is excluded from ranking entirely. In the
   transcript, the player's arena-duel challenge to Diane at turn 24 stops being
   eligible for guaranteed recall within about two turns of her name last
   appearing, with no graceful recovery unless she is independently
   re-mentioned. An open, important thread silently becomes unrecallable purely
   because a name went quiet.

2. **The ending of a long session can sit unfiled.**
   `backend/memory_service.py`'s `maybe_extract` only files memory in full
   batches of `BATCH_SIZE = 5` settled exchanges (`SETTLE_MARGIN_EXCHANGES = 1`
   held back). A leftover of 1-4 settled exchanges is never committed to
   long-term memory until it grows to a full batch. During active play the
   trailing exchanges are still visible in the model's recent chat history, so
   this is harmless short-term, but the most dramatic late-session content (the
   transcript's Blood+Curse dual-affinity / Mana Ocean reveal at turns 41-43) is,
   at the moment it matters most, the least durably stored, and in a long session
   it risks never being filed.

## Fix 1: Soft participant rule (score penalty, not a hard cut)

**File:** `backend/memory_ranking.py`.

Stop dropping a fact because its participants are absent from the recent window;
demote it instead, so an important unresolved thread can still earn a spot while
trivia tied to a long-gone character naturally stays low.

- New constant `PARTICIPANT_ABSENCE_PENALTY = 0.5`.
- `passes_filters` keeps **only** the retention-floor check; the
  `participants_present` gate is removed from it:

  ```python
  def passes_filters(fact, present_lower, current_turn, current_location=None):
      return retention(fact, current_turn, current_location) >= RETENTION_FLOOR
  ```

- `score` gains an **optional** `present_lower` parameter (default `None`, kept
  last so existing positional callers are unaffected) and multiplies its final
  weight by `PARTICIPANT_ABSENCE_PENALTY` only when `present_lower` is provided
  and the fact's participants are absent. `present_lower=None` means "no presence
  information supplied" and applies no penalty, so the existing direct callers of
  `score` (e.g. `test_memory_ranking.py`) keep working unchanged:

  ```python
  def score(fact, current_turn, current_location=None, present_lower=None):
      ...  # unchanged weight computation
      base = weight * retention(fact, current_turn, current_location)
      if present_lower is not None and not participants_present(fact, present_lower):
          return base * PARTICIPANT_ABSENCE_PENALTY
      return base
  ```

- `rank` passes `present_lower` into `score` (as the keyword arg, since it now
  comes after `current_location`):

  ```python
  kept = [c for c in candidates if passes_filters(c, present_lower, current_turn, current_location)]
  return sorted(kept, key=lambda c: score(c, current_turn, current_location, present_lower=present_lower), reverse=True)
  ```

`participants_present` is unchanged and still returns `True` for `world` facts,
lore, and facts with no named participants, so none of those are ever penalized.
Pinned/active/lore facts keep `retention == 1.0` and are unaffected by the
penalty relative to each other.

**Behavior change:** a fact whose character is absent is no longer invisible; it
competes at half score against everything else in the scored tier. This is the
real fix — the duel-challenge event went from *impossible* to recall (hard-
excluded the moment Diane's name went quiet) to *recallable when it is
relevant*: when the player re-raises the duel or Diane, the fact's low semantic
distance lifts it into the packed block despite the penalty. Present-participant
facts still generally outrank absent ones (what is happening now should weigh
more), and a low-importance one-off tied to an absent character still ranks low
and is crowded out by the budget — both intended. The penalty demotes; it does
not guarantee an absent fact outranks a present one, and it should not.

## Fix 2: Long-session catch-up sweep

**File:** `backend/memory_service.py`.

Keep the proven full-batch rhythm for normal and short sessions untouched. Once a
session is long enough that a permanently-unfiled trailing batch is a real risk,
also file the leftover partial batch instead of waiting for a full five.

- New constant `CATCHUP_MIN_PAIRS = 15` (three full batches).
- After the existing `while settled - cursor >= BATCH_SIZE` loop, add a single
  partial flush:

  ```python
  if len(pairs) >= CATCHUP_MIN_PAIRS and settled - cursor >= 1:
      batch = pairs[cursor:settled]
      turn = ordinals[batch[-1][0]["id"]]
      batch_id = nid("mebatch")
      await extract_batch(sid, char["id"], char["name"], user_name, batch, turn,
                          language, model, session, chat_base, chat_key,
                          embed_base, embed_key,
                          names_by_id=names_by_id, cast_names=cast_names, batch_id=batch_id)
      await memory_facts.record_batch(sid, batch_id, cursor, settled, turn)
      await memory_facts.set_cursor(sid, settled)
  ```

- Sessions under `CATCHUP_MIN_PAIRS` settled exchanges keep exactly today's
  behavior: no partial batch, no extra extraction calls.
- The partial batch is a normal recorded batch with its own `batch_id`, so the
  regeneration/swipe rollback built earlier (`rollback_from_pair_index`) cleans
  it up correctly if one of its exchanges is later redone. No new rollback logic
  is needed.
- `SETTLE_MARGIN_EXCHANGES` still holds back the single newest exchange, so the
  catch-up never files an exchange the user is actively still writing against.

**Cost/benefit:** extra extraction calls happen only in sessions past ~15
exchanges, and only for the trailing 1-4 exchanges that would otherwise wait.
Short sessions pay nothing. Long sessions keep long-term memory current to within
the one-exchange settle margin, so the ending is essentially always filed.

## Non-goals

- No change to `BATCH_SIZE`, `SETTLE_MARGIN_EXCHANGES`, or the decay/strength
  constants. Fix 2 does not shorten the settle margin globally; it only flushes an
  already-settled trailing remainder in long sessions.
- No change to `participants_present`'s definition, nor to how `world`/lore/
  no-participant facts are treated.
- No new configuration surface. Both constants are module-level, matching the
  existing tuning constants in these two files.
- No retroactive re-ranking of already-stored facts; both fixes act at
  retrieval/extraction time only.

## Testing

`backend/tests/test_memory_ranking.py`:
- A non-`world` fact whose participants are absent from `present` is now RETAINED
  by `rank` (previously excluded), proving the hard gate is gone.
- Given two otherwise-identical candidates, the one whose participant IS present
  ranks above the one whose participant is absent (penalty applied, not fatal).
- Among absent-participant facts, the more relevant (lower `distance`) one still
  ranks higher — the penalty is uniform, so absent facts continue to compete on
  their own merits (the duel-surfaces-when-relevant case).
- `world`/lore/no-participant facts are unaffected by the penalty (score
  identical whether or not `present_lower` contains their participants).
- Retention-floor exclusion still works (a fully-decayed fact is still dropped).

`backend/tests/test_memory_service.py`:
- A long session (18 pairs) files the trailing partial batch: the full batches
  record turns `[5, 10, 15]` and the catch-up records `17`, advancing the cursor
  to `17` so no settled exchange is left unfiled. This also confirms the partial
  batch stamps `turn` on the true user-turn-ordinal scale.
- A short session (8 pairs) with a partial remainder does NOT file it — turns
  `[5]` only, cursor at `5`, identical to today.
- Rollback of a partial catch-up batch needs no new test: it is a normal recorded
  batch (same `record_batch`/`batch_id` shape), already covered end to end by the
  existing `test_rollback_*` cases in `test_memory_facts_repo.py`.
