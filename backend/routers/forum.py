"""Reddit-lite community forum: threads with title/body, replies handled by
the existing comments system (target_type="thread")."""
from fastapi import HTTPException, Depends

from backend import db
from backend.state import api, log
from backend.auth import get_current_user, get_current_user_optional
from backend.schemas import ForumThreadIn
from backend.ratelimit import SlidingWindow

_THREAD_LIMIT = SlidingWindow(
    10, 300, "You're posting too fast — please wait a moment and try again")


@api.get("/forum/threads")
async def list_forum_threads(sort: str = "new", category: str = "",
                             current_user: dict | None = Depends(get_current_user_optional)):
    viewer_id = current_user["id"] if current_user else None
    hidden = await db.hidden_user_ids(viewer_id) if viewer_id else set()
    return await db.list_forum_threads(hidden, sort=sort, category=category, viewer_id=viewer_id)


@api.post("/forum/threads")
async def create_forum_thread(body: ForumThreadIn, current_user: dict = Depends(get_current_user)):
    _THREAD_LIMIT.check_and_record(current_user["id"])
    title = (body.title or "").strip()[:200]
    content = (body.content or "").strip()[:10000]
    if not title or not content:
        raise HTTPException(400, "title and content are required")
    tid = await db.create_forum_thread(current_user["id"], title, content, body.category)
    log.info("forum: thread created id=%s by=%s title=%r", tid, current_user["username"], title)
    return await db.get_forum_thread(tid, current_user["id"])


@api.get("/forum/threads/{tid}")
async def get_forum_thread_route(tid: str, current_user: dict | None = Depends(get_current_user_optional)):
    viewer_id = current_user["id"] if current_user else None
    th = await db.get_forum_thread(tid, viewer_id)
    if not th:
        raise HTTPException(404, "thread not found")
    if viewer_id and th["author_id"] != viewer_id and await db.is_block_between(th["author_id"], viewer_id):
        raise HTTPException(404, "thread not found")
    return th


@api.delete("/forum/threads/{tid}")
async def delete_forum_thread_route(tid: str, current_user: dict = Depends(get_current_user)):
    th = await db.get_forum_thread(tid)
    if not th:
        raise HTTPException(404, "thread not found")
    if th["author_id"] != current_user["id"] and not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    await db.delete_forum_thread(tid)
    log.info("forum: thread deleted id=%s by=%s", tid, current_user["username"])
    return {"deleted": True}


@api.post("/forum/threads/{tid}/like")
async def like_forum_thread_route(tid: str, current_user: dict = Depends(get_current_user)):
    if not await db.get_forum_thread(tid):
        raise HTTPException(404, "thread not found")
    await db.like_forum_thread(tid, current_user["id"])
    return await db.get_forum_thread(tid, current_user["id"])


@api.post("/forum/threads/{tid}/unlike")
async def unlike_forum_thread_route(tid: str, current_user: dict = Depends(get_current_user)):
    await db.unlike_forum_thread(tid, current_user["id"])
    return await db.get_forum_thread(tid, current_user["id"])
