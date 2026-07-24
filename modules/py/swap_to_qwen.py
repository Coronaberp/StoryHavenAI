import sys
import json
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import db
from backend import vectors
from backend import llm
from backend.retrieval import index_lore
from backend.repositories import settings as settings_repo
from backend.repositories import memory_facts
from backend.state import CFG, log

NEW_MODEL = "Qwen3-Embedding-0.6B"
NEW_DIM = 1024
DUMP_PATH = str(Path(__file__).resolve().parent / "_memfacts_dump.json")


async def main():
    await db.init()
    saved = await settings_repo.all_settings()
    for key, value in saved.items():
        if key in CFG and value is not None:
            CFG[key] = value
    vectors.connect()
    memory_facts.build_tables(CFG["embed_dim"])
    await vectors.ensure_indexes(CFG["embed_dim"])

    fact_rows = await db._q(db.select(memory_facts._tbl))
    dumped = []
    for row in fact_rows:
        record = dict(row)
        record["_plaintext"] = db._decrypt_secret(record.get("text") or "")
        dumped.append(record)
    insurance = [{key: value for key, value in record.items()
                  if key not in ("embedding", "_plaintext")} for record in dumped]
    with open(DUMP_PATH, "w") as handle:
        json.dump(insurance, handle, default=str)
    log.info("swap_to_qwen: dumped %d memory facts (insurance -> %s) before reset",
             len(dumped), DUMP_PATH)

    await settings_repo.set_settings({"embed_model": NEW_MODEL, "embed_dim": NEW_DIM})
    CFG["embed_model"] = NEW_MODEL
    CFG["embed_dim"] = NEW_DIM

    await vectors.reset_indexes(NEW_DIM)
    memory_facts.build_tables(NEW_DIM)
    log.info("swap_to_qwen: vector tables reset to dim=%d", NEW_DIM)

    lore_rows = await db._q(db.select(db.lore))
    for index, row in enumerate(lore_rows):
        content = db._decrypt_secret(row["content"] or "")
        name = db._decrypt_secret(row["name"] or "")
        await index_lore(row["id"], row["char_id"], content, name, row["category"])
        if (index + 1) % 100 == 0:
            log.info("swap_to_qwen: re-embedded %d/%d lore entries", index + 1, len(lore_rows))
    log.info("swap_to_qwen: re-embedded %d lore entries", len(lore_rows))

    restored = 0
    for record in dumped:
        try:
            vec = await llm.embed(record["_plaintext"], CFG["embed_model"])
            values = {key: value for key, value in record.items()
                      if not key.startswith("_") and key != "embedding"}
            values["embedding"] = list(vec)
            await db._w(memory_facts._tbl.insert().values(**values))
            restored += 1
        except Exception as error:
            log.error("swap_to_qwen: failed to restore memory fact id=%s: %s: %s",
                      record.get("id"), type(error).__name__, error)
    log.info("swap_to_qwen: restored %d/%d memory facts with %d-dim embeddings",
             restored, len(dumped), NEW_DIM)

    await db.close()
    print(f"DONE: lore_reembedded={len(lore_rows)} memory_restored={restored} dim={NEW_DIM}")


if __name__ == "__main__":
    asyncio.run(main())
