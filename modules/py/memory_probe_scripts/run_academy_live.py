import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend import db
from backend import llm
from backend import memory_service
from backend import retrieval
from backend import vectors
from backend.prompt import build_system
from backend.repositories import characters
from backend.repositories import chat_sessions
from backend.repositories import memory_facts
from backend.repositories import personas
from backend.repositories import settings as global_settings
from backend.repositories import users
from backend.state import CFG, apply_llm_config

CHAR_ID = "cf19fbf4f821f"
PERSONA_ID = "pd2b64496e99b"
OWNER_USERNAME = "zukaarimoto"
BATCH_SIZE = 5
NUM_TURNS = 50

MILESTONES = {
    5: "A Demon Kingdom patrol was just sighted deep inside human territory, farther west than any crossing in a decade. Tension is rising.",
    9: "War has just been declared between the Human Kingdom and the Demon Kingdom, triggered by an assassinated envoy. The fragile peace that held for a generation is over.",
    14: "The academy is adjusting to wartime footing: drills shift to combat readiness, recruiters walk the halls, prices rise.",
    20: "Diane Bluerose has just returned from Heavengard: her family, House Bluerose, opposed the war behind closed doors and lost. She has been stripped of her title as second princess by royal decree. She is now simply Diane, a commoner student.",
    30: "The war is escalating on the eastern front. Diane trains harder than ever despite losing her title.",
    45: "It has been many days since the war began. Reflect on how much has changed at the academy.",
}


async def gen(messages, params=None, retries=3):
    for attempt in range(retries):
        text = ""
        async for channel, chunk in llm.chat_stream(messages, CFG["chat_model"], params or {}):
            if channel == "content":
                text += chunk
        text = text.strip()
        if text:
            return text
    raise RuntimeError(f"empty generation after {retries} attempts")


def _identity_line(persona):
    pronoun = {"Male": "he/him", "Female": "she/her"}.get(persona.get("gender"), "they/them")
    return (f"The player character's name is {persona['name']} ({pronoun}), NEVER any other name. "
            f"{persona['name']}'s description: {persona.get('description', '')}")


async def gen_user_line(history, milestone, persona):
    identity = _identity_line(persona)
    sys_prompt = (
        f"{identity}\n"
        f"You are writing {persona['name']}'s next turn in an ongoing roleplay at Sunspire Academy. "
        f"Write exactly ONE short in-character beat for {persona['name']} and nobody else, in this "
        "exact format on separate lines:\n"
        "*a brief action*\n"
        '"a line of dialogue"\n'
        f"Never call {persona['name']} by any name other than {persona['name']}. Never write for any "
        "other character. Do not summarize or explain, output only the two lines above."
    )
    if milestone:
        sys_prompt += f"\nCurrent story context to be aware of: {milestone}"
    messages = [{"role": "system", "content": sys_prompt}] + history[-4:]
    messages.append({"role": "user", "content": f"Write {persona['name']}'s next beat now, in the exact format shown."})
    return await gen(messages, {"temperature": 0.85, "max_tokens": 150})


async def main():
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
    char_name = char["name"]
    persona = await personas.get(PERSONA_ID)
    if not persona:
        raise SystemExit(f"persona {PERSONA_ID!r} not found")
    USER_NAME = persona["name"]

    sid = await chat_sessions.create(CHAR_ID, PERSONA_ID, "50-turn live LLM-generated lore-update test",
                                     USER_NAME, user_id=owner["id"])
    print(f"created session={sid} char={CHAR_ID} persona={PERSONA_ID} ({USER_NAME}) owner={OWNER_USERNAME}", flush=True)

    history = []
    if char.get("greeting"):
        await chat_sessions.add_message(sid, "assistant", char["greeting"])
        history.append({"role": "assistant", "content": char["greeting"]})
        print("posted real character greeting as message 1", flush=True)

    def fixed_present(char_name_, user_name, known_names, recent):
        return [user_name, char_name_] + list(known_names)
    memory_service.present_participants = fixed_present

    prev_session = {"id": sid, "known_names": "[]", "char_doing": None, "char_location": None}
    totals = {"facts": 0, "added": 0, "reinforced": 0, "superseded": 0, "lore_updates_applied": 0}
    batch = []

    for turn in range(1, NUM_TURNS + 1):
        milestone = MILESTONES.get(turn)
        user_line = await gen_user_line(history, milestone, persona)
        history.append({"role": "user", "content": user_line})
        um = await chat_sessions.add_message(sid, "user", user_line, user_name=USER_NAME)
        print(f"[{turn}] USER: {user_line[:100]}", flush=True)

        system = build_system(char, persona, USER_NAME, mode=char.get("mode", "character"),
                              language="English", full=True)
        system += f"\n\n{_identity_line(persona)}"
        if milestone:
            system += f"\n\nStory direction for this reply: {milestone}"
        reply_messages = [{"role": "system", "content": system}] + history[-10:]
        reply = await gen(reply_messages, {"temperature": 0.9, "max_tokens": 1200})
        history.append({"role": "assistant", "content": reply})
        am = await chat_sessions.add_message(sid, "assistant", reply)
        print(f"[{turn}] ASSISTANT: {reply[:100]}", flush=True)

        batch.append(({"id": um["id"], "role": "user", "content": user_line},
                      {"id": am["id"], "role": "assistant", "content": reply}))

        if len(batch) == BATCH_SIZE:
            stats = await memory_service.extract_batch(
                sid, CHAR_ID, char_name, USER_NAME, batch, turn, "English", CFG["chat_model"],
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
            batch = []

    probes = [
        {"query": "Is there still peace between the Human Kingdom and the Demon Kingdom?",
         "expect": ["war"], "reject": [], "present": [USER_NAME, char_name]},
        {"query": "Is Diane still a princess of the Human Kingdom?",
         "expect": ["title"], "reject": [], "present": [USER_NAME, char_name]},
    ]
    msgs = [{"id": "q", "role": "user", "content": "probe"}] * NUM_TURNS
    failures = 0
    for probe in probes:
        keyword_entries, _ = await retrieval.retrieve(CHAR_ID, sid, probe["query"], "")
        session = {"id": sid, "known_names": json.dumps(probe.get("present", []))}
        block, used, meta_lore_lines, meta_memory_lines = await memory_service.retrieve_block(
            session, {"id": CHAR_ID, "name": char_name}, USER_NAME,
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
