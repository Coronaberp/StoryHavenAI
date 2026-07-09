"""In-app notifications: the bell-panel feed (comment + milestone alerts)."""
from fastapi import Depends

from backend import db
from backend.state import api
from backend.auth import get_current_user


@api.get("/notifications")
async def get_notifications(unread_only: bool = False,
                            current_user: dict = Depends(get_current_user)):
    return await db.list_notifications(current_user["id"], unread_only=unread_only)


@api.get("/notifications/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    return {"count": await db.unread_notification_count(current_user["id"])}


@api.post("/notifications/{nid}/read")
async def read_notification(nid: str, current_user: dict = Depends(get_current_user)):
    await db.mark_notification_read(nid, current_user["id"])
    return {"ok": True}


@api.post("/notifications/read-all")
async def read_all_notifications(current_user: dict = Depends(get_current_user)):
    await db.mark_all_read(current_user["id"])
    return {"ok": True}


@api.delete("/notifications")
async def clear_all_notifications(current_user: dict = Depends(get_current_user)):
    await db.delete_all_notifications(current_user["id"])
    return {"ok": True}
