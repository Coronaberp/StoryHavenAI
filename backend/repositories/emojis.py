"""Custom emoji/sticker uploads — user-generated small images referenced by
:shortcode: in comments, or attached whole as a "sticker"."""
from __future__ import annotations
import re
import time

from sqlalchemy import select, update as sa_update, delete as sa_delete, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.db import custom_emojis, users, nid, _q, _q1, _w
from backend.state import log

_SHORTCODE_RE = re.compile(r"^[a-z0-9_]{2,32}$")


def _shape_custom_emoji(row: dict, admin_view: bool = False) -> dict:
    """The true uploaded file always stays in `image`; the public-facing dict
    swaps it for the blurred static preview while is_explicit is set and a
    preview exists, so every existing display path (picker, :shortcode:
    rendering, sticker attachments) shows the safe stand-in with no caller-
    side changes. admin_view=True (the admin management panel) always gets
    the real file, since reviewing *is* looking at the actual content."""
    d = dict(row)
    if not admin_view and d.get("is_explicit") and d.get("preview_image"):
        d["image"] = d["preview_image"]
    return d


async def create(shortcode: str, image: str, kind: str, uploader_id: str,
                 is_explicit: bool = False, preview_image: str | None = None) -> dict | None:
    """Returns None for an invalid shortcode OR one already owned by a
    different uploader — since any user can upload these, a plain upsert
    would let anyone silently overwrite someone else's existing :shortcode:
    (replacing content already used across many messages). Only the
    original uploader can update their own shortcode's image/kind.

    is_explicit=True + preview_image is used for animated GIFs, which the
    NSFW classifier can't reliably judge (see chat_service.classify_image_nsfw)
    — rather than trust an always-negative verdict, they're stored pre-flagged
    with a blurred static-frame stand-in pending an admin's manual review;
    see _shape_custom_emoji for how that's served in place of `image`."""
    shortcode = shortcode.strip().lower()
    if not _SHORTCODE_RE.match(shortcode):
        log.warning("emojis: create rejected, invalid shortcode uploader=%s", uploader_id)
        return None
    existing = await _q1(select(custom_emojis).where(custom_emojis.c.shortcode == shortcode))
    if existing and existing["uploader_id"] != uploader_id:
        log.warning("emojis: create rejected, shortcode=%s already claimed by another user", shortcode)
        return None
    eid = existing["id"] if existing else nid("emo")
    explicit_val = 1 if is_explicit else 0
    stmt = pg_insert(custom_emojis).values(
        id=eid, shortcode=shortcode, image=image, kind=kind, uploader_id=uploader_id,
        created=time.time(), is_explicit=explicit_val, preview_image=preview_image)
    stmt = stmt.on_conflict_do_update(
        index_elements=["shortcode"],
        set_={"image": stmt.excluded.image, "kind": stmt.excluded.kind,
              "is_explicit": explicit_val, "preview_image": preview_image})
    await _w(stmt)
    log.info("emojis: emoji created/updated id=%s shortcode=%s uploader=%s kind=%s",
             eid, shortcode, uploader_id, kind)
    return await _q1(select(custom_emojis).where(custom_emojis.c.shortcode == shortcode))


async def set_explicit(eid: str):
    await _w(sa_update(custom_emojis).where(custom_emojis.c.id == eid).values(is_explicit=1))
    log.info("emojis: emoji id=%s flagged explicit", eid)


async def approve(eid: str):
    """Admin confirms a pending (usually GIF) upload is actually SFW — clears
    the flag and the now-unneeded preview so the real file is served again."""
    await _w(sa_update(custom_emojis).where(custom_emojis.c.id == eid)
             .values(is_explicit=0, preview_image=None))
    log.info("emojis: emoji id=%s approved", eid)


async def update(eid: str, shortcode: str | None, kind: str | None) -> dict | None:
    """Admin-only rename/retype. Preserves the same shortcode-uniqueness
    constraint as create() — returns None if the new shortcode is invalid
    or already claimed by a different emoji."""
    row = await _q1(select(custom_emojis).where(custom_emojis.c.id == eid))
    if not row:
        log.warning("emojis: update failed, emoji not found id=%s", eid)
        return None
    values = {}
    if shortcode is not None:
        shortcode = shortcode.strip().lower()
        if not _SHORTCODE_RE.match(shortcode):
            log.warning("emojis: update rejected, invalid shortcode id=%s", eid)
            return None
        existing = await _q1(select(custom_emojis).where(custom_emojis.c.shortcode == shortcode))
        if existing and existing["id"] != eid:
            log.warning("emojis: update rejected, shortcode=%s already claimed id=%s", shortcode, eid)
            return None
        values["shortcode"] = shortcode
    if kind is not None:
        values["kind"] = kind
    if values:
        await _w(sa_update(custom_emojis).where(custom_emojis.c.id == eid).values(**values))
        log.info("emojis: emoji id=%s updated fields=%s", eid, list(values))
    return await _q1(select(custom_emojis).where(custom_emojis.c.id == eid))


async def list_all(kind: str | None = None, admin_view: bool = False) -> list[dict]:
    if admin_view:
        j = custom_emojis.join(users, users.c.id == custom_emojis.c.uploader_id, isouter=True)
        stmt = (select(custom_emojis, users.c.username.label("uploader_username"))
                .select_from(j).order_by(custom_emojis.c.shortcode.asc()))
    else:
        stmt = select(custom_emojis).order_by(custom_emojis.c.shortcode.asc())
    if kind:
        stmt = stmt.where(custom_emojis.c.kind == kind)
    return [_shape_custom_emoji(r, admin_view) for r in await _q(stmt)]


async def get(eid: str, admin_view: bool = False) -> dict | None:
    row = await _q1(select(custom_emojis).where(custom_emojis.c.id == eid))
    return _shape_custom_emoji(row, admin_view) if row else None


async def get_sticker_by_image(image: str) -> dict | None:
    """Used to validate a comment's sticker attachment actually is one — the
    image path alone (an emo_... filename) isn't proof, since it's just a
    client-supplied string; this confirms a real sticker row backs it."""
    row = await _q1(select(custom_emojis).where(and_(
        custom_emojis.c.image == image, custom_emojis.c.kind == "sticker")))
    return dict(row) if row else None


async def delete(eid: str):
    await _w(sa_delete(custom_emojis).where(custom_emojis.c.id == eid))
    log.info("emojis: emoji id=%s deleted", eid)
