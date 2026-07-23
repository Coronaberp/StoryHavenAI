"""One-time backfill: encrypt memory_facts.text at rest.

memory_facts lives outside db.py's static metadata (its table is built at
runtime against the configured EMBED_DIM), so it was missed by
backfill_encrypt.py's TARGETS list and shipped storing extracted memory text
in plaintext. Any row whose raw stored value is non-empty and does NOT
already start with "enc:" is encrypted in place; rows already prefixed
"enc:" are left untouched.

Run inside the story-game container:

    ./venv/bin/python3 modules/py/backfill_encrypt_memory_facts.py [--dry-run]

Progress streams live via `podman logs -f story-game`.
"""
import sys
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import sqlalchemy as sa

from backend import db
from backend.repositories import memory_facts
from backend.state import CFG, log


def _needs_encrypt(v) -> bool:
    return isinstance(v, str) and v != "" and not v.startswith("enc:")


async def _backfill(dry_run: bool):
    memory_facts.build_tables(int(CFG["embed_dim"]))
    tbl = memory_facts._tbl
    rows = await db._q(sa.select(tbl.c.id, tbl.c.text))
    log.info("[encrypt memory_facts] %d rows dry_run=%s", len(rows), dry_run)
    already = new = empty = 0
    for r in rows:
        raw = r.get("text")
        if raw is None or raw == "":
            empty += 1
            continue
        if not _needs_encrypt(raw):
            already += 1
            continue
        new += 1
        if not dry_run:
            await db._w(sa.update(tbl).where(tbl.c.id == r["id"])
                        .values(text=db._encrypt_secret(raw)))
        log.info("[encrypt memory_facts] id=%s encrypted", r["id"])
    log.info("[encrypt memory_facts.text] already_encrypted=%d newly_encrypted=%d empty=%d",
             already, new, empty)


async def main():
    dry_run = "--dry-run" in sys.argv[1:]
    mode = "DRY-RUN" if dry_run else "REAL"
    await db.init()
    log.info("=== memory_facts encrypt backfill START (%s) ===", mode)
    try:
        await _backfill(dry_run)
    finally:
        await db.close()
    log.info("=== memory_facts encrypt backfill COMPLETE (%s) ===", mode)


if __name__ == "__main__":
    asyncio.run(main())
