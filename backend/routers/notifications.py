"""In-app notifications: the bell-panel feed (comment + milestone alerts)."""
from fastapi import Depends

from backend.repositories import notifications as notification_repo
from backend.state import api, log
from backend.auth import get_current_user


@api.get("/notifications")
async def get_notifications(unread_only: bool = False,
                            current_user: dict = Depends(get_current_user)):
    return await notification_repo.list_for_user(current_user["id"], unread_only=unread_only)


@api.get("/notifications/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    return {"count": await notification_repo.unread_count(current_user["id"])}


@api.post("/notifications/{nid}/read")
async def read_notification(nid: str, current_user: dict = Depends(get_current_user)):
    await notification_repo.mark_read(nid, current_user["id"])
    log.info("notifications: marked read id=%s by=%s", nid, current_user["id"])
    return {"ok": True}


@api.post("/notifications/read-all")
async def read_all_notifications(current_user: dict = Depends(get_current_user)):
    await notification_repo.mark_all_read(current_user["id"])
    log.info("notifications: marked all read by=%s", current_user["id"])
    return {"ok": True}


@api.delete("/notifications")
async def clear_all_notifications(current_user: dict = Depends(get_current_user)):
    await notification_repo.delete_all(current_user["id"])
    log.info("notifications: cleared all by=%s", current_user["id"])
    return {"ok": True}
