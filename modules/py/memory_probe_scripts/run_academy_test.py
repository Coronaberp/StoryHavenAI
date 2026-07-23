import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend import db
from backend import memory_service
from backend import retrieval
from backend import vectors
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import memory_facts
from backend.repositories import settings as global_settings
from backend.repositories import users
from backend.state import CFG, apply_llm_config

CHAR_ID = "cf19fbf4f821f"
CHAR_NAME = "Magic Academy RPG"
USER_NAME = "Alice"
OWNER_USERNAME = "zukaarimoto"
BATCH_SIZE = 5


def _batches(turns):
    pairs = [({"id": f"u{i}", "role": "user", "content": t["user"]},
              {"id": f"a{i}", "role": "assistant", "content": t["assistant"]})
             for i, t in enumerate(turns)]
    usable = len(pairs) - len(pairs) % BATCH_SIZE
    for start in range(0, usable, BATCH_SIZE):
        yield pairs[start:start + BATCH_SIZE], start + BATCH_SIZE


async def main():
    script = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    await db.init()
    saved = await global_settings.all_settings()
    for key, value in saved.items():
        if key in CFG and value is not None:
            CFG[key] = value
    apply_llm_config()
    await vectors.ensure_indexes(CFG["embed_dim"])
    await memory_facts.ensure_tables(CFG["embed_dim"])
    owner = await users.get_user_by_username(OWNER_USERNAME)
    if not owner:
        raise SystemExit(f"owner {OWNER_USERNAME!r} not found")

    char = await characters.get(CHAR_ID)
    sid = await chat_sessions.create(CHAR_ID, None, "50-turn lore-update epic test",
                                     USER_NAME, user_id=owner["id"])
    print(f"created session={sid} char={CHAR_ID} owner={OWNER_USERNAME}", flush=True)
    if char.get("greeting"):
        await chat_sessions.add_message(sid, "assistant", char["greeting"])
        print("posted real character greeting as message 1", flush=True)

    def fixed_present(char_name, user_name, known_names, recent):
        return [user_name, char_name] + list(known_names)
    memory_service.present_participants = fixed_present

    prev_session = {"id": sid, "known_names": "[]", "char_doing": None, "char_location": None}
    totals = {"facts": 0, "added": 0, "reinforced": 0, "superseded": 0, "lore_updates_applied": 0}
    for batch, turn in _batches(script["turns"]):
        for user_msg, assistant_msg in batch:
            await chat_sessions.add_message(sid, "user", user_msg["content"], user_name=USER_NAME)
            await chat_sessions.add_message(sid, "assistant", assistant_msg["content"])
        stats = await memory_service.extract_batch(
            sid, CHAR_ID, CHAR_NAME, USER_NAME, batch, turn, "English", CFG["chat_model"],
            prev_session)
        for key in totals:
            totals[key] += stats[key]
        print(f"turn {turn}: {stats}", flush=True)
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
        keyword_entries, _ = await retrieval.retrieve(CHAR_ID, sid, probe["query"], "")
        session = {"id": sid, "known_names": json.dumps(probe.get("present", []))}
        block, used, meta_lore_lines, meta_memory_lines = await memory_service.retrieve_block(
            session, {"id": CHAR_ID, "name": CHAR_NAME}, USER_NAME,
            probe["query"], msgs, CFG, keyword_entries)
        lowered = block.lower()
        missing = [e for e in probe.get("expect", []) if e.lower() not in lowered]
        leaked = [r for r in probe.get("reject", []) if r.lower() in lowered]
        ok = not missing and not leaked
        failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}: {probe['query']!r}"
              + (f" missing={missing}" if missing else "")
              + (f" leaked={leaked}" if leaked else ""), flush=True)
        if not ok:
            print(f"  block was:\n{block}\n", flush=True)

    print(f"totals: {totals} probes_failed={failures} session={sid}", flush=True)
    await db.close()
    return failures


if __name__ == "__main__":
    sys.exit(1 if asyncio.run(main()) else 0)
