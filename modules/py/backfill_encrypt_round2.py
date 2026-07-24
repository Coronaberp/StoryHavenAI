import sys
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import sqlalchemy as sa

from backend import db
from backend import vectors
from backend.state import CFG, log

def _needs_encrypt(v) -> bool:
    return isinstance(v, str) and v != "" and not v.startswith("enc:")

async def _encrypt_table(table, id_cols: list, text_cols: list, dry_run: bool):
    rows = await db._q(sa.select(*[table.c[c] for c in id_cols + text_cols]))
    updated = skipped = 0
    for m in rows:
        changes = {c: db._encrypt_secret(m[c]) for c in text_cols if _needs_encrypt(m[c])}
        if not changes:
            skipped += 1
            continue
        updated += 1
        if dry_run:
            continue
        cond = sa.and_(*[table.c[c] == m[c] for c in id_cols])
        await db._w(sa.update(table).where(cond).values(**changes))
    log.info("[encrypt round2] %s: %d rows, %d encrypted, %d already/empty dry_run=%s",
             table.name, len(rows), updated, skipped, dry_run)

async def main():
    dry_run = "--dry-run" in sys.argv[1:]
    mode = "DRY-RUN" if dry_run else "REAL"
    await db.init()
    vectors._build_tables(int(CFG["embed_dim"]))
    log.info("=== round2 encrypt backfill START (%s) ===", mode)
    try:
        await _encrypt_table(db.lore_secrets, ["id"], ["text"], dry_run)
        await _encrypt_table(db.session_lore_state, ["id"], ["override_content"], dry_run)
        await _encrypt_table(db.localization, ["src_hash", "lang"], ["source", "translated"], dry_run)
        await _encrypt_table(db.lore_links, ["id"], ["label"], dry_run)
        await _encrypt_table(vectors._mem_tbl, ["id"], ["text"], dry_run)
    finally:
        await db.close()
    log.info("=== round2 encrypt backfill COMPLETE (%s) ===", mode)

if __name__ == "__main__":
    asyncio.run(main())
