import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import sqlalchemy as sa

from backend import db
from backend.state import log

def _looks_hashed(entry: str) -> bool:
    if not isinstance(entry, str) or ":" not in entry:
        return False
    salt, _, digest = entry.partition(":")
    return len(salt) == 32 and len(digest) == 64

async def _rows():
    async with db._require_engine().begin() as conn:
        result = await conn.execute(
            sa.select(db.users.c.id, db.users.c.totp_backup_codes)
            .where(db.users.c.totp_backup_codes.isnot(None)))
        return [dict(r._mapping) for r in result]

async def _store(uid: str, hashes: list[str]):
    async with db._require_engine().begin() as conn:
        await conn.execute(sa.update(db.users).where(db.users.c.id == uid)
                           .values(totp_backup_codes=json.dumps(hashes)))

async def main(apply: bool):
    await db.init()
    rows = await _rows()
    converted = already = unreadable = 0
    for row in rows:
        raw = row["totp_backup_codes"]
        try:
            entries = json.loads(db._decrypt_secret(raw))
        except Exception as e:
            unreadable += 1
            log.error("totp backup migration: could not read codes uid=%s: %s", row["id"], e)
            continue
        if not isinstance(entries, list) or not entries:
            unreadable += 1
            continue
        if all(_looks_hashed(entry) for entry in entries):
            already += 1
            continue
        hashes = [entry if _looks_hashed(entry) else db.hash_password(entry) for entry in entries]
        if apply:
            await _store(row["id"], hashes)
        converted += 1
        log.info("totp backup migration: %s uid=%s codes=%d",
                 "hashed" if apply else "would hash", row["id"], len(hashes))
    print(f"rows with codes: {len(rows)}")
    print(f"converted: {converted}")
    print(f"already hashed: {already}")
    print(f"unreadable: {unreadable}")
    print("dry run, nothing written" if not apply else "written")

if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
