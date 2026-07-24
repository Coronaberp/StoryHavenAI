from __future__ import annotations
import time

from sqlalchemy import select, insert, delete as sa_delete, and_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend import db
from backend.db import (
    forum_threads, thread_likes, comments, users,
    nid, _q, _q1, _w, _encrypt_secret, _decrypt_secret,
)
from backend.state import log

def _shape_thread(r, scores, my_votes, reply_counts) -> dict:
    return {
        "id": r["id"], "author_id": r["author_id"],
        "title": _decrypt_secret(r.get("title") or ""),
        "content": _decrypt_secret(r.get("content") or ""),
        "category": r.get("category") or "", "created": r["created"],
        "pinned": bool(r.get("pinned")),
        "author_username": r["username"],
        "author_display_name": _decrypt_secret(r.get("display_name") or ""),
        "author_avatar": r.get("avatar") or "",
        "score": scores.get(r["id"], 0),
        "my_vote": my_votes.get(r["id"], 0),
        "reply_count": reply_counts.get(r["id"], 0),
    }

async def create(author_id: str, title: str, content: str, category: str = "") -> str:
    tid = nid("th")
    await _w(insert(forum_threads).values(
        id=tid, author_id=author_id, title=_encrypt_secret(title or ""),
        content=_encrypt_secret(content or ""), category=(category or "").strip()[:40],
        created=time.time()))
    log.info("forum: thread created id=%s author=%s", tid, author_id)
    return tid

async def delete(tid: str):
    async with db._engine.begin() as conn:
        await conn.execute(sa_delete(comments).where(and_(
            comments.c.target_type == "thread", comments.c.target_id == tid)))
        await conn.execute(sa_delete(thread_likes).where(thread_likes.c.thread_id == tid))
        await conn.execute(sa_delete(forum_threads).where(forum_threads.c.id == tid))
    log.info("forum: thread deleted id=%s", tid)

async def _vote_maps(ids, viewer_id):
    scores, my_votes = {}, {}
    if not ids:
        return scores, my_votes
    sc = await _q(select(thread_likes.c.thread_id, func.sum(thread_likes.c.value).label("n"))
                  .where(thread_likes.c.thread_id.in_(ids))
                  .group_by(thread_likes.c.thread_id))
    scores = {r["thread_id"]: r["n"] or 0 for r in sc}
    if viewer_id:
        mv = await _q(select(thread_likes.c.thread_id, thread_likes.c.value).where(and_(
            thread_likes.c.thread_id.in_(ids), thread_likes.c.user_id == viewer_id)))
        my_votes = {r["thread_id"]: r["value"] for r in mv}
    return scores, my_votes

async def _reply_counts(ids):
    if not ids:
        return {}
    rows = await _q(select(comments.c.target_id, func.count().label("n"))
                    .where(and_(comments.c.target_type == "thread", comments.c.target_id.in_(ids)))
                    .group_by(comments.c.target_id))
    return {r["target_id"]: r["n"] for r in rows}

async def list_all(hidden_ids: set, sort: str = "new", category: str = "",
                   limit: int = 50, offset: int = 0, viewer_id: str | None = None) -> list[dict]:
    j = forum_threads.join(users, users.c.id == forum_threads.c.author_id)
    conds = []
    if category:
        conds.append(forum_threads.c.category == category)
    stmt = select(forum_threads, users.c.username, users.c.display_name, users.c.avatar).select_from(j)
    if conds:
        stmt = stmt.where(and_(*conds))
    rows = [r for r in await _q(stmt) if r["author_id"] not in hidden_ids]
    ids = [r["id"] for r in rows]
    scores, my_votes = await _vote_maps(ids, viewer_id)
    reply_counts = await _reply_counts(ids)
    shaped = [_shape_thread(r, scores, my_votes, reply_counts) for r in rows]
    if sort == "top":
        shaped.sort(key=lambda t: (t["pinned"], t["score"], t["created"]), reverse=True)
    else:
        shaped.sort(key=lambda t: (t["pinned"], t["created"]), reverse=True)
    return shaped[offset:offset + limit]

async def get(tid: str, viewer_id: str | None = None) -> dict | None:
    j = forum_threads.join(users, users.c.id == forum_threads.c.author_id)
    r = await _q1(select(forum_threads, users.c.username, users.c.display_name, users.c.avatar)
                  .select_from(j).where(forum_threads.c.id == tid))
    if not r:
        return None
    scores, my_votes = await _vote_maps([tid], viewer_id)
    reply_counts = await _reply_counts([tid])
    return _shape_thread(r, scores, my_votes, reply_counts)

async def vote(tid: str, user_id: str, value: int):
    stmt = pg_insert(thread_likes).values(thread_id=tid, user_id=user_id, value=value)
    stmt = stmt.on_conflict_do_update(
        index_elements=[thread_likes.c.thread_id, thread_likes.c.user_id],
        set_={"value": value})
    await _w(stmt)
    log.info("forum: thread id=%s voted by=%s value=%s", tid, user_id, value)

async def unvote(tid: str, user_id: str):
    await _w(sa_delete(thread_likes).where(and_(
        thread_likes.c.thread_id == tid, thread_likes.c.user_id == user_id)))
    log.info("forum: thread id=%s vote removed by=%s", tid, user_id)
