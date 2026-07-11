"""One-time backfill: re-run NSFW classification against every stored image with
the current (tightened) prompt and overwrite each row's explicit flag in both
directions. Run inside the story-game container:

    ./venv/bin/python3 backfill_nsfw.py

Progress is logged via state.log so it streams live through `podman logs -f story-game`.
"""
import os
import sys
import asyncio

import sqlalchemy as sa

import db
import classify
from state import log, MEDIA_DIR

_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp", ".gif": "image/gif"}


def _resolve(url: str) -> str | None:
    base = (url or "").split("?", 1)[0]
    if not base.startswith("/media/"):
        return None
    return os.path.join(MEDIA_DIR, os.path.basename(base))


def _load(url: str):
    path = _resolve(url)
    if not path or not os.path.exists(path):
        return None, None
    ext = os.path.splitext(path)[1].lower()
    with open(path, "rb") as fh:
        return fh.read(), _MIME.get(ext, "image/png")


async def _classify(url: str) -> bool | None:
    """True/False fresh result, or None if the file couldn't be loaded."""
    data, mime = _load(url)
    if data is None:
        return None
    explicit, _confidence = await classify.classify_image_nsfw(data, mime)
    return explicit


async def _classify_any(urls: list[str]) -> bool | None:
    """Explicit if ANY provided image is explicit. None if none could be loaded."""
    got_one = False
    for u in urls:
        r = await _classify(u)
        if r is None:
            continue
        got_one = True
        if r:
            return True
    return False if got_one else None


async def _backfill_simple(table, image_col: str, flag_col: str):
    label = table.name
    rows = await db._q(sa.select(table).where(
        sa.func.coalesce(table.c[image_col], "") != ""))
    log.info("[backfill %s] %d rows with a %s image", label, len(rows), image_col)
    flagged = unflagged = unchanged = missing = errors = 0
    for r in rows:
        rid = r["id"]
        old = bool(r[flag_col])
        try:
            fresh = await _classify(r[image_col])
        except Exception as e:
            errors += 1
            log.warning("[backfill %s] id=%s classify error: %s", label, rid, e)
            continue
        if fresh is None:
            missing += 1
            log.warning("[backfill %s] id=%s file missing on disk (%s) — skipped",
                        label, rid, r[image_col])
            continue
        if fresh == old:
            unchanged += 1
            log.info("[backfill %s] id=%s unchanged (%s)", label, rid, old)
            continue
        await db._w(sa.update(table).where(table.c.id == rid)
                    .values(**{flag_col: 1 if fresh else 0}))
        if fresh:
            flagged += 1
        else:
            unflagged += 1
        log.info("[backfill %s] id=%s %s -> %s", label, rid, old, fresh)
    log.info("[backfill %s DONE] processed=%d newly_flagged=%d newly_unflagged=%d "
             "unchanged=%d missing=%d errors=%d",
             label, len(rows), flagged, unflagged, unchanged, missing, errors)
    return dict(table=label, processed=len(rows), flagged=flagged,
                unflagged=unflagged, unchanged=unchanged, missing=missing, errors=errors)


async def _backfill_users():
    label = "users"
    rows = await db._q(sa.select(db.users).where(
        (sa.func.coalesce(db.users.c.avatar, "") != "") |
        (sa.func.coalesce(db.users.c.banner_img, "") != "")))
    log.info("[backfill %s] %d rows with an avatar and/or banner", label, len(rows))
    flagged = unflagged = unchanged = missing = errors = 0
    for r in rows:
        rid = r["id"]
        old = bool(r["is_explicit"])
        urls = [u for u in (r["avatar"], r["banner_img"]) if (u or "").strip()]
        try:
            fresh = await _classify_any(urls)
        except Exception as e:
            errors += 1
            log.warning("[backfill %s] id=%s classify error: %s", label, rid, e)
            continue
        if fresh is None:
            missing += 1
            log.warning("[backfill %s] id=%s no image file on disk — skipped", label, rid)
            continue
        if fresh == old:
            unchanged += 1
            log.info("[backfill %s] id=%s unchanged (%s)", label, rid, old)
            continue
        await db._w(sa.update(db.users).where(db.users.c.id == rid)
                    .values(is_explicit=1 if fresh else 0))
        if fresh:
            flagged += 1
        else:
            unflagged += 1
        log.info("[backfill %s] id=%s %s -> %s", label, rid, old, fresh)
    log.info("[backfill %s DONE] processed=%d newly_flagged=%d newly_unflagged=%d "
             "unchanged=%d missing=%d errors=%d",
             label, len(rows), flagged, unflagged, unchanged, missing, errors)
    return dict(table=label, processed=len(rows), flagged=flagged,
                unflagged=unflagged, unchanged=unchanged, missing=missing, errors=errors)


async def _backfill_messages():
    label = "messages"
    rows = await db._q(sa.select(db.messages).where(
        sa.func.coalesce(db.messages.c.image, "") != ""))
    log.info("[backfill %s] %d rows with an image", label, len(rows))
    flagged = unflagged = unchanged = missing = errors = 0
    for r in rows:
        mid = r["id"]
        old = bool(r["image_is_explicit"])
        try:
            fresh = await _classify(r["image"])
        except Exception as e:
            errors += 1
            log.warning("[backfill %s] id=%s classify error: %s", label, mid, e)
            continue
        if fresh is None:
            missing += 1
            log.warning("[backfill %s] id=%s file missing (%s) — skipped", label, mid, r["image"])
            continue
        if fresh == old:
            unchanged += 1
            log.info("[backfill %s] id=%s unchanged (%s)", label, mid, old)
            continue
        await db._w(sa.update(db.messages).where(db.messages.c.id == mid)
                    .values(image_is_explicit=1 if fresh else 0))
        if fresh:
            flagged += 1
        else:
            unflagged += 1
        log.info("[backfill %s] id=%s %s -> %s", label, mid, old, fresh)
    log.info("[backfill %s DONE] processed=%d newly_flagged=%d newly_unflagged=%d "
             "unchanged=%d missing=%d errors=%d",
             label, len(rows), flagged, unflagged, unchanged, missing, errors)
    return dict(table=label, processed=len(rows), flagged=flagged,
                unflagged=unflagged, unchanged=unchanged, missing=missing, errors=errors)


async def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    await db.init()
    log.info("=== NSFW backfill START (only=%s) ===", only or "all")
    results = []
    try:
        if only in (None, "characters"):
            results.append(await _backfill_simple(db.characters, "avatar", "is_explicit"))
        if only in (None, "lore"):
            results.append(await _backfill_simple(db.lore, "image", "is_explicit"))
        if only in (None, "standalone_images"):
            results.append(await _backfill_simple(db.standalone_images, "image", "is_explicit"))
        if only in (None, "users"):
            results.append(await _backfill_users())
        if only in (None, "messages"):
            results.append(await _backfill_messages())
    finally:
        await db.close()
    log.info("=== NSFW backfill COMPLETE ===")
    for r in results:
        log.info("SUMMARY %s", r)


if __name__ == "__main__":
    asyncio.run(main())
