# 1700-turn memory_v2 stress test — measured results

Real run against the live app's configured DeepSeek chat endpoint and local embed
endpoint, no mocking. 1700 turns of a two-character roleplay conversation were fed
through `memory_service.extract_batch` in batches of 5 (340 batches), with 13 facts
planted at known turns and probed later at turn distances ranging from 15 to 700.

**Result: 3/13 probes passed (23%), 10/13 failed (77%).**

The failure rate does **not** correlate cleanly with turn distance the way a pure
decay model would predict — probes failed as early as 30 turns after planting, while
a probe 700 turns out passed. Sorted by distance:

| distance (turns) | result | expected fact |
|---|---|---|
| 15  | PASS | forearm |
| 30  | FAIL | Emberglass shattered |
| 70  | PASS | scar over his left eye |
| 90  | FAIL | Sable Reach |
| 120 | FAIL | secret passage |
| 180 | FAIL | Moon Court oath |
| 250 | FAIL | Emberglass |
| 300 | FAIL | treasure map fragment |
| 350 | FAIL | Thornhollow |
| 400 | FAIL | Thessaly |
| 500 | FAIL | Corwin |
| 600 | FAIL | Mira |
| 700 | PASS | Voss |

**Root cause, from inspecting the actual retrieved blocks**: the "Ongoing & pinned"
section of the packed context is dominated by a fixed set of ~13 generic, repeatedly
-reinforced observations (e.g. "Alice repeatedly asks about X across multiple days",
"the conversation is repeating") that never expire and get high retention scores from
reinforcement. These crowd the token budget and outrank the specific one-off planted
facts (named NPCs, places, objects) in the ranked/scored portion of the block. This
means degradation here is a **signal-to-noise / ranking problem in a repetitive
conversation**, not primarily a decay/distance problem — the system doesn't cleanly
"forget" older facts so much as get **overwhelmed by generic filler facts winning the
ranking competition** for the scored 40% of the token budget, even against wildly
different turn distances.

This replaces the earlier reasoned-from-code estimate (which projected retrieval
degradation starting somewhere in the several-hundred-turn range, based purely on
the decay half-life formula) — the real number is a **77% failure rate across the
whole distance range tested (15-700 turns)**, and the effective cause is different
from what the decay math alone predicted.

## Methodology note — this run required a manual recovery step

The original single-shot 1700-turn extraction run (`podman exec ... memory_probe_replay.py
... --keep`) genuinely completed all 1700 turns of extraction successfully (confirmed via
Postgres `created_ts` timestamps on the resulting `memory_facts` rows, climbing continuously
from 19:17 to 21:07 UTC), but the process was killed (most likely OOM on the shared container)
before its **stdout could flush its buffered log output** — Python fully block-buffers stdout
when it isn't attached to a terminal, so a large tail of log lines (roughly turns 755 onward)
and the final probe-evaluation results were lost even though the underlying extraction data
was already durably committed to Postgres. This initially looked like a crash at turn 755; it
was not — the log file just stopped reflecting reality. `modules/py/memory_probe_replay.py`
has been extended with `--resume-session`/`--resume-turn` for future runs, though it was not
needed for scoring — since extraction had already reached turn 1700, only the probe-evaluation
phase needed to be re-run, which `modules/py/memory_probe_scripts/score_only.py` does by
calling `memory_service.retrieve_block` per probe against the already-populated session,
without repeating any extraction. That script is a throwaway (not part of the plan's committed
deliverable) but is left alongside the stress script for reproducibility.

One data-quality caveat: an earlier (mistaken) `--resume-session --resume-turn 750` attempt,
made while the process's true state was still unclear, re-processed turns 750-880 a second
time before being caught and killed. This inflated reinforcement counts for facts touched in
that 130-turn window but does not affect which facts existed or the probe results above, which
were scored against the final state at turn 1700.

## Full run output

```
Extraction phase (340 batches, turns 5-1700): see git history / operator log for
the complete run; representative summary line format:
memory extract done: session=sb35c6458b6b3 turn=<N> facts=<F> added=<A> reinforced=<R> superseded=<S> lore_updates=0

Probe-evaluation phase (score_only.py, run against the completed session):

PASS: 'How is the wound on your arm healing?'
FAIL: "Can we trust the scout who's been guarding the caravan with us?" missing=['Thessaly'] leaked=['Emberglass', 'Voss']
FAIL: 'Remind me what the fortress town above the bay was called again.' missing=['Sable Reach']
FAIL: "Have you forgotten your promise to the innkeeper's daughter?" leaked=['Voss', 'Emberglass']
FAIL: "Is the artifact you're carrying in the locked case still safe?" leaked=['Mira']
PASS: 'Is the warlord who threatened us still a danger to the trade routes?'
FAIL: 'Could we use that hidden way out of the tavern again if we needed to escape?' missing=['secret passage'] leaked=['Voss', 'Mira']
FAIL: 'Do you still think about the advisor who betrayed you?' missing=['Corwin'] leaked=['Emberglass']
FAIL: 'Has the plague in that village to the south gotten any better?' missing=['Thornhollow']
FAIL: 'Do you still have that torn map piece we took off the dead scout?' missing=['treasure map fragment'] leaked=['Voss']
FAIL: 'Is there any way around the oath you swore to the Moon Court?' leaked=['Mira']
PASS: 'Does the new scar near your eye still hurt?'
FAIL: 'Is the artifact shard still intact after the fight at the vault door?' leaked=['scar over his left eye']

totals: probes=13 probes_failed=10 session=sb35c6458b6b3
```
