from __future__ import annotations
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, or_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend import db
from backend.db import (
    comments, comment_likes, comment_reactions, characters,
    nid, _q, _q1, _w, _scalar, _encrypt_secret, _decrypt_secret,
)
from backend.db import users
from backend.state import log

_MAX_REACTION_EMOJI_LEN = 8

def _shape_comment(r, like_counts, liked_me, reaction_counts=None, my_reactions=None, reaction_supers=None) -> dict:
    return {
        "id": r["id"], "target_type": r["target_type"], "target_id": r["target_id"],
        "author_id": r["author_id"], "parent_id": r["parent_id"],
        "content": _decrypt_secret(r.get("content") or ""), "created": r["created"],
        "edited_at": r.get("edited_at"),
        "image": r.get("image") or "", "image_is_explicit": bool(r.get("image_is_explicit")),
        "attachment_kind": r.get("attachment_kind") or ("image" if r.get("image") else ""),
        "author_username": r["username"],
        "author_display_name": _decrypt_secret(r.get("display_name") or ""),
        "author_avatar": r.get("avatar") or "",
        "like_count": like_counts.get(r["id"], 0),
        "liked_by_me": r["id"] in liked_me,
        "reactions": (reaction_counts or {}).get(r["id"], {}),
        "my_reactions": (my_reactions or {}).get(r["id"], []),
        "reaction_supers": (reaction_supers or {}).get(r["id"], {}),
        "replies": [], "reply_count": 0,
    }

async def create(target_type: str, target_id: str, author_id: str,
                 parent_id: str | None, content: str, image: str = "",
                 attachment_kind: str = "") -> str:
    cid = nid("cm")
    await _w(insert(comments).values(
        id=cid, target_type=target_type, target_id=target_id,
        author_id=author_id, parent_id=parent_id,
        content=_encrypt_secret(content or ""), image=(image or None),
        attachment_kind=(attachment_kind or None),
        created=time.time()))
    log.info("comments: comment created id=%s author=%s target=%s:%s",
             cid, author_id, target_type, target_id)
    return cid

async def set_explicit(cid: str):
    await _w(sa_update(comments).where(comments.c.id == cid).values(image_is_explicit=1))
    log.info("comments: comment id=%s flagged explicit", cid)

async def update(cid: str, content: str) -> float:
    edited_at = time.time()
    await _w(sa_update(comments).where(comments.c.id == cid).values(
        content=_encrypt_secret(content or ""), edited_at=edited_at))
    log.info("comments: comment id=%s edited", cid)
    return edited_at

async def get(cid: str) -> dict | None:
    r = await _q1(select(comments).where(comments.c.id == cid))
    if r:
        r["content"] = _decrypt_secret(r.get("content") or "")
    return r

async def _like_maps(ids, viewer_id):
    like_counts, liked_me = {}, set()
    if not ids:
        return like_counts, liked_me
    lc = await _q(select(comment_likes.c.comment_id, func.count().label("n"))
                  .where(comment_likes.c.comment_id.in_(ids))
                  .group_by(comment_likes.c.comment_id))
    like_counts = {r["comment_id"]: r["n"] for r in lc}
    if viewer_id:
        lm = await _q(select(comment_likes.c.comment_id).where(and_(
            comment_likes.c.comment_id.in_(ids),
            comment_likes.c.user_id == viewer_id)))
        liked_me = {r["comment_id"] for r in lm}
    return like_counts, liked_me

async def _reaction_maps(ids, viewer_id):
    counts, mine, supers = {}, {}, {}
    if not ids:
        return counts, mine, supers
    rows = await _q(select(comment_reactions.c.comment_id, comment_reactions.c.emoji,
                           func.count().label("n"),
                           func.max(comment_reactions.c.is_super).label("has_super"))
                    .where(comment_reactions.c.comment_id.in_(ids))
                    .group_by(comment_reactions.c.comment_id, comment_reactions.c.emoji))
    for r in rows:
        counts.setdefault(r["comment_id"], {})[r["emoji"]] = r["n"]
        supers.setdefault(r["comment_id"], {})[r["emoji"]] = bool(r["has_super"])
    if viewer_id:
        mrows = await _q(select(comment_reactions.c.comment_id, comment_reactions.c.emoji)
                         .where(and_(comment_reactions.c.comment_id.in_(ids),
                                     comment_reactions.c.user_id == viewer_id)))
        for r in mrows:
            mine.setdefault(r["comment_id"], []).append(r["emoji"])
    return counts, mine, supers

async def list_for_target(target_type: str, target_id: str,
                          viewer_id: str | None = None, blocked: set | None = None) -> list[dict]:
    blocked = blocked or set()
    j = comments.join(users, users.c.id == comments.c.author_id)
    stmt = (select(comments, users.c.username, users.c.display_name, users.c.avatar)
            .select_from(j)
            .where(and_(comments.c.target_type == target_type,
                        comments.c.target_id == target_id))
            .order_by(comments.c.created.asc()))
    rows = [r for r in await _q(stmt) if r["author_id"] not in blocked]
    ids = [r["id"] for r in rows]
    like_counts, liked_me = await _like_maps(ids, viewer_id)
    reaction_counts, my_reactions, reaction_supers = await _reaction_maps(ids, viewer_id)
    by_id = {r["id"]: r for r in rows}
    shaped = {r["id"]: _shape_comment(r, like_counts, liked_me, reaction_counts, my_reactions, reaction_supers)
              for r in rows}

    def root_id(r):
        seen = set()
        while r["parent_id"] and r["parent_id"] in by_id and r["id"] not in seen:
            seen.add(r["id"])
            r = by_id[r["parent_id"]]
        return r["id"]

    top = []
    for r in rows:
        s = shaped[r["id"]]
        if not r["parent_id"] or r["parent_id"] not in by_id:
            top.append(s)
        else:
            shaped[root_id(by_id[r["parent_id"]])]["replies"].append(s)
    for s in shaped.values():
        s["reply_count"] = len(s["replies"])
    top.reverse()
    return top

async def get_view(cid: str, viewer_id: str | None = None) -> dict | None:
    j = comments.join(users, users.c.id == comments.c.author_id)
    r = await _q1(select(comments, users.c.username, users.c.display_name,
                         users.c.avatar).select_from(j).where(comments.c.id == cid))
    if not r:
        return None
    like_counts, liked_me = await _like_maps([cid], viewer_id)
    reaction_counts, my_reactions, reaction_supers = await _reaction_maps([cid], viewer_id)
    return _shape_comment(r, like_counts, liked_me, reaction_counts, my_reactions, reaction_supers)

async def _descendant_ids(cid: str, target_type: str, target_id: str) -> list[str]:
    rows = await _q(select(comments.c.id, comments.c.parent_id).where(and_(
        comments.c.target_type == target_type, comments.c.target_id == target_id)))
    children = {}
    for r in rows:
        children.setdefault(r["parent_id"], []).append(r["id"])
    out, stack = [], [cid]
    while stack:
        x = stack.pop()
        out.append(x)
        stack.extend(children.get(x, []))
    return out

async def delete(cid: str):
    c = await _q1(select(comments).where(comments.c.id == cid))
    if not c:
        log.warning("comments: delete failed, comment not found id=%s", cid)
        return
    ids = await _descendant_ids(cid, c["target_type"], c["target_id"])
    async with db._engine.begin() as conn:
        await conn.execute(sa_delete(comment_likes).where(comment_likes.c.comment_id.in_(ids)))
        await conn.execute(sa_delete(comment_reactions).where(comment_reactions.c.comment_id.in_(ids)))
        await conn.execute(sa_delete(comments).where(comments.c.id.in_(ids)))
    log.info("comments: comment id=%s deleted with %d descendant(s)", cid, len(ids) - 1)

async def like(cid: str, user_id: str):
    async with db._engine.begin() as conn:
        exists = (await conn.execute(select(comment_likes).where(and_(
            comment_likes.c.comment_id == cid,
            comment_likes.c.user_id == user_id)))).fetchone()
        if not exists:
            await conn.execute(insert(comment_likes).values(
                comment_id=cid, user_id=user_id))
    log.info("comments: comment id=%s liked by=%s", cid, user_id)

async def unlike(cid: str, user_id: str):
    await _w(sa_delete(comment_likes).where(and_(
        comment_likes.c.comment_id == cid, comment_likes.c.user_id == user_id)))
    log.info("comments: comment id=%s unliked by=%s", cid, user_id)

async def like_count(cid: str) -> int:
    return await _scalar(select(func.count()).select_from(comment_likes)
                         .where(comment_likes.c.comment_id == cid)) or 0

async def react(cid: str, user_id: str, emoji: str, is_super: bool = False):
    emoji = (emoji or "").strip()[:_MAX_REACTION_EMOJI_LEN]
    if not emoji:
        return
    stmt = pg_insert(comment_reactions).values(
        comment_id=cid, user_id=user_id, emoji=emoji, is_super=1 if is_super else 0)
    stmt = stmt.on_conflict_do_update(
        index_elements=["comment_id", "user_id", "emoji"],
        set_={"is_super": stmt.excluded.is_super})
    await _w(stmt)
    log.info("comments: comment id=%s reacted by=%s emoji=%s super=%s", cid, user_id, emoji, is_super)

async def unreact(cid: str, user_id: str, emoji: str):
    await _w(sa_delete(comment_reactions).where(and_(
        comment_reactions.c.comment_id == cid, comment_reactions.c.user_id == user_id,
        comment_reactions.c.emoji == emoji)))
    log.info("comments: comment id=%s unreacted by=%s emoji=%s", cid, user_id, emoji)

async def delete_by_author_on_owner(author_id: str, owner_id: str,
                                    owner_username: str) -> int:
    char_ids = [r["id"] for r in await _q(
        select(characters.c.id).where(characters.c.owner_id == owner_id))]
    cond = or_(
        and_(comments.c.target_type == "character",
             comments.c.target_id.in_(char_ids or ["__none__"])),
        and_(comments.c.target_type == "user",
             comments.c.target_id == owner_username))
    rows = await _q(select(comments.c.id).where(
        and_(comments.c.author_id == author_id, cond)))
    ids = [r["id"] for r in rows]
    if not ids:
        return 0
    async with db._engine.begin() as conn:
        await conn.execute(sa_delete(comment_likes).where(comment_likes.c.comment_id.in_(ids)))
        await conn.execute(sa_delete(comments).where(comments.c.id.in_(ids)))
    log.info("comments: deleted %d comment(s) by author=%s on owner=%s",
             len(ids), author_id, owner_id)
    return len(ids)
