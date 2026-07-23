import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import db
from backend import memory_service
from backend import vectors
from backend.memory_extraction import ReconcileDecision
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import memory_facts
from backend.repositories import settings as global_settings
from backend.repositories import users
from backend.state import CFG, apply_llm_config

CHAR_NAME = "Kael"
USER_NAME = "Alice"
OWNER_USERNAME = "zukaarimoto"


def _batches(turns, start_turn=0):
    pairs = [({"id": f"u{i}", "role": "user", "content": t["user"]},
              {"id": f"a{i}", "role": "assistant", "content": t["assistant"]})
             for i, t in enumerate(turns)]
    usable = len(pairs) - len(pairs) % memory_service.BATCH_SIZE
    for start in range(0, usable, memory_service.BATCH_SIZE):
        turn = start + memory_service.BATCH_SIZE
        if turn <= start_turn:
            continue
        yield pairs[start:start + memory_service.BATCH_SIZE], turn


async def _run(script_path: str, naive: bool, keep: bool, resume_session: str = None, resume_turn: int = 0):
    script = json.loads(Path(script_path).read_text(encoding="utf-8"))
    await db.init()
    saved = await global_settings.all_settings()
    for key, value in saved.items():
        if key in CFG and value is not None:
            CFG[key] = value
    apply_llm_config()
    await vectors.ensure_indexes(CFG["embed_dim"])
    print(f"using chat endpoint {CFG['base_url']} model {CFG['chat_model']}")
    await memory_facts.ensure_tables(CFG["embed_dim"])
    owner = await users.get_user_by_username(OWNER_USERNAME)
    if not owner:
        raise SystemExit(f"owner account {OWNER_USERNAME!r} not found")
    if resume_session:
        sid = resume_session
        existing = await chat_sessions.get(sid)
        if not existing:
            raise SystemExit(f"resume session {sid} not found")
        char_id = existing["char_id"]
        prev_session = {
            "id": sid,
            "known_names": existing.get("known_names") or "[]",
            "char_doing": existing.get("char_doing"),
            "char_location": existing.get("char_location"),
        }
        print(f"resuming session {sid} from turn {resume_turn}")
    else:
        char = await characters.create({
            "name": CHAR_NAME, "creator": OWNER_USERNAME, "owner_id": owner["id"],
            "persona": "A weary mercenary escort on a long overland journey.",
            "mode": "character",
        })
        char_id = char["id"]
        sid = await chat_sessions.create(char_id, None, "1700-turn memory stress probe",
                                         USER_NAME, user_id=owner["id"])
        prev_session = {"id": sid, "known_names": "[]", "char_doing": None, "char_location": None}
        print(f"created char={char_id} session={sid} owner={OWNER_USERNAME}")
    if naive:
        async def all_add(drafts, neighbors, model, base_url=None, api_key=None):
            return [ReconcileDecision(index=i, action="add") for i in range(len(drafts))]
        memory_service.run_reconcile = all_add

    def fixed_present(char_name, user_name, known_names, recent):
        return [user_name, char_name] + list(known_names)

    memory_service.present_participants = fixed_present
    totals = {"facts": 0, "added": 0, "reinforced": 0, "superseded": 0}
    for batch, turn in _batches(script["turns"], resume_turn):
        for user_msg, assistant_msg in batch:
            await chat_sessions.add_message(sid, "user", user_msg["content"], user_name=USER_NAME)
            await chat_sessions.add_message(sid, "assistant", assistant_msg["content"])
        stats = await memory_service.extract_batch(
            sid, char_id, CHAR_NAME, USER_NAME, batch, turn, "English", CFG["chat_model"],
            prev_session)
        for key in totals:
            totals[key] += stats[key]
        print(f"turn {turn}: {stats}")
        updated = await chat_sessions.get(sid)
        if updated:
            prev_session = {
                "id": sid,
                "known_names": updated.get("known_names") or "[]",
                "char_doing": updated.get("char_doing"),
                "char_location": updated.get("char_location"),
            }
    msgs = [{"id": "q", "role": "user", "content": "probe"}] * len(script["turns"])
    failures = 0
    for probe in script["probes"]:
        session = {"id": sid, "known_names": json.dumps(probe.get("present", []))}
        block, used, meta_lore_lines, meta_memory_lines = await memory_service.retrieve_block(
            session, {"id": char_id, "name": CHAR_NAME}, USER_NAME,
            probe["query"], msgs, CFG, [])
        lowered = block.lower()
        missing = [e for e in probe.get("expect", []) if e.lower() not in lowered]
        leaked = [r for r in probe.get("reject", []) if r.lower() in lowered]
        ok = not missing and not leaked
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}: {probe['query']!r}"
              + (f" missing={missing}" if missing else "")
              + (f" leaked={leaked}" if leaked else ""))
        if not ok:
            print(f"  block was:\n{block}\n")
    print(f"totals: {totals} probes_failed={failures} session={sid}")
    if not keep:
        await memory_facts.purge_session(sid)
    await db.close()
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("script")
    ap.add_argument("--naive", action="store_true")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--resume-session")
    ap.add_argument("--resume-turn", type=int, default=0)
    args = ap.parse_args()
    failures = asyncio.run(_run(args.script, args.naive, args.keep, args.resume_session, args.resume_turn))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
