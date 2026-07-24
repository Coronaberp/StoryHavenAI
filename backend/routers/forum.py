from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import forum as forum_thread_repo
from backend.state import api, log
from backend.auth import get_current_user, get_current_user_optional
from backend.feature_flags import require_feature_enabled
from backend.schemas import ForumThreadIn, ForumVoteIn
from backend.ratelimit import SlidingWindow

_THREAD_LIMIT = SlidingWindow(
    10, 300, "You're posting too fast — please wait a moment and try again")

@api.get("/forum/threads")
async def list_forum_threads(sort: str = "new", category: str = "",
                             current_user: dict | None = Depends(get_current_user_optional)):
    viewer_id = current_user["id"] if current_user else None
    hidden = await db.hidden_user_ids(viewer_id) if viewer_id else set()
    return await forum_thread_repo.list_all(hidden, sort=sort, category=category, viewer_id=viewer_id)

@api.post("/forum/threads")
async def create_forum_thread(body: ForumThreadIn, current_user: dict = Depends(get_current_user),
                              _feature_ok: None = Depends(require_feature_enabled("forum"))):
    _THREAD_LIMIT.check_and_record(current_user["id"])
    title = (body.title or "").strip()[:200]
    content = (body.content or "").strip()[:10000]
    if not title or not content:
        raise HTTPException(400, "title and content are required")
    tid = await forum_thread_repo.create(current_user["id"], title, content, body.category)
    log.info("forum: thread created id=%s by=%s title=%r", tid, current_user["username"], title)
    return await forum_thread_repo.get(tid, current_user["id"])

@api.get("/forum/threads/{tid}")
async def get_forum_thread_route(tid: str, current_user: dict | None = Depends(get_current_user_optional)):
    viewer_id = current_user["id"] if current_user else None
    th = await forum_thread_repo.get(tid, viewer_id)
    if not th:
        raise HTTPException(404, "thread not found")
    if viewer_id and th["author_id"] != viewer_id and await db.is_block_between(th["author_id"], viewer_id):
        raise HTTPException(404, "thread not found")
    return th

@api.delete("/forum/threads/{tid}")
async def delete_forum_thread_route(tid: str, current_user: dict = Depends(get_current_user)):
    th = await forum_thread_repo.get(tid)
    if not th:
        raise HTTPException(404, "thread not found")
    if th["author_id"] != current_user["id"] and not current_user["is_admin"]:
        raise HTTPException(403, "Not authorized")
    await forum_thread_repo.delete(tid)
    log.info("forum: thread deleted id=%s by=%s", tid, current_user["username"])
    return {"deleted": True}

@api.post("/forum/threads/{tid}/vote")
async def vote_forum_thread_route(tid: str, body: ForumVoteIn, current_user: dict = Depends(get_current_user)):
    if body.value not in (1, -1):
        raise HTTPException(400, "value must be 1 or -1")
    th = await forum_thread_repo.get(tid)
    if not th:
        raise HTTPException(404, "thread not found")
    if th["author_id"] == current_user["id"]:
        raise HTTPException(403, "You can't vote on your own thread")
    await forum_thread_repo.vote(tid, current_user["id"], body.value)
    log.info("forum: thread voted id=%s by=%s value=%s", tid, current_user["username"], body.value)
    return await forum_thread_repo.get(tid, current_user["id"])

@api.post("/forum/threads/{tid}/unvote")
async def unvote_forum_thread_route(tid: str, current_user: dict = Depends(get_current_user)):
    await forum_thread_repo.unvote(tid, current_user["id"])
    log.info("forum: thread vote removed id=%s by=%s", tid, current_user["username"])
    return await forum_thread_repo.get(tid, current_user["id"])
