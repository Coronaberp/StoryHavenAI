"""Localization cache: every translated string (UI chrome, scenarios,
persona/character text) is stored once per (source-hash, language) so the
same text is never sent to the LLM twice — see db.py's own comment block
above the original functions this wraps."""
from __future__ import annotations
import time

from sqlalchemy import and_, select

from backend import db
from backend.db import localization, _q, pg_insert, _encrypt_secret, _decrypt_secret
from backend.state import log


async def get(hashes: list[str], lang: str) -> dict:
    """Return {src_hash: translated} for the hashes already cached in `lang`."""
    if not hashes:
        return {}
    out = {}
    for i in range(0, len(hashes), 500):
        chunk = hashes[i:i + 500]
        rows = await _q(select(localization.c.src_hash, localization.c.translated)
                        .where(and_(localization.c.lang == lang,
                                    localization.c.src_hash.in_(chunk))))
        for r in rows:
            out[r["src_hash"]] = _decrypt_secret(r["translated"])
    return out


async def set(items: list[tuple], lang: str, kind: str = "content"):
    """items: [(src_hash, source, translated), ...] — write-through cache insert."""
    now = time.time()
    async with db._engine.begin() as conn:
        for h, src, tr in items:
            stmt = pg_insert(localization).values(
                src_hash=h, lang=lang, kind=kind, source=_encrypt_secret(src),
                translated=_encrypt_secret(tr), created=now)
            stmt = stmt.on_conflict_do_update(
                index_elements=["src_hash", "lang"],
                set_={"translated": stmt.excluded.translated})
            await conn.execute(stmt)
    log.info("localization: cached %d string(s) lang=%s kind=%s", len(items), lang, kind)
