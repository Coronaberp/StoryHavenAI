"""One-time backfill: encrypt every user-authored text field at rest.

For each covered column, any row whose RAW stored value is non-empty and does
NOT already start with "enc:" is encrypted in place. Values already prefixed
"enc:" are left untouched (re-encrypting would corrupt them). The check is made
on the raw stored value before any decryption.

Covers both fields encrypted since before this script (legacy plaintext rows
never backfilled) and fields newly wired to encryption.

Run inside the story-game container:

    ./venv/bin/python3 backfill_encrypt.py [table]

Progress streams live via `podman logs -f story-game`.
"""
import sys
import asyncio

import sqlalchemy as sa

import db
from state import log

# (table, key_column, [encrypted text columns])
TARGETS = [
    (db.characters, "id",
     ["name", "creator", "tags", "persona", "scenario", "greeting", "dialogue",
      "system_prompt", "alt_greetings", "description"]),
    (db.personas, "id", ["name", "description"]),
    (db.lore, "id",
     ["name", "keys", "content", "appearance_tags", "appearance_tags_negative"]),
    (db.messages, "seq", ["content"]),
    (db.comments, "id", ["content"]),
    (db.users, "id", ["bio", "display_name"]),
    (db.sessions, "id",
     ["title", "author_note", "glossary", "style_prompt", "user_name",
      "char_doing", "char_location", "known_names"]),
    (db.notifications, "id", ["title", "body"]),
    (db.model_requests, "id", ["note"]),
    (db.flagged_endpoints, "id", ["reason", "detail"]),
]


def _needs_encrypt(v) -> bool:
    return isinstance(v, str) and v != "" and not v.startswith("enc:")


async def _backfill(table, key_col: str, cols: list[str], dry_run: bool):
    label = table.name
    rows = await db._q(sa.select(table))
    log.info("[encrypt %s] %d rows, columns=%s dry_run=%s",
             label, len(rows), cols, dry_run)
    stats = {c: {"already": 0, "new": 0, "empty": 0} for c in cols}
    for r in rows:
        rid = r[key_col]
        updates = {}
        for c in cols:
            raw = r.get(c)
            if raw is None or raw == "":
                stats[c]["empty"] += 1
            elif isinstance(raw, str) and raw.startswith("enc:"):
                stats[c]["already"] += 1
            elif isinstance(raw, str):
                stats[c]["new"] += 1
                updates[c] = db._encrypt_secret(raw)
            else:
                stats[c]["empty"] += 1
        if updates and not dry_run:
            await db._w(sa.update(table)
                        .where(table.c[key_col] == rid).values(**updates))
        if updates:
            log.info("[encrypt %s] %s=%s encrypted %s",
                     label, key_col, rid, list(updates.keys()))
    for c in cols:
        s = stats[c]
        log.info("[encrypt %s.%s] already_encrypted=%d newly_encrypted=%d empty=%d",
                 label, c, s["already"], s["new"], s["empty"])
    return {"table": label, "stats": stats}


async def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    only = [a for a in args if not a.startswith("-")]
    await db.init()
    mode = "DRY-RUN" if dry_run else "REAL"
    log.info("=== encrypt backfill START (%s only=%s) ===", mode, only or "all")
    results = []
    try:
        for table, key_col, cols in TARGETS:
            if only and table.name not in only:
                continue
            results.append(await _backfill(table, key_col, cols, dry_run))
    finally:
        await db.close()
    log.info("=== encrypt backfill COMPLETE (%s) ===", mode)
    for r in results:
        log.info("SUMMARY %s %s", r["table"], r["stats"])


if __name__ == "__main__":
    asyncio.run(main())
