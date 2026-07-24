from fastapi import Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_admin
from backend.repositories import notifications as notification_repo
from backend.state import api, log

class AnnounceIn(BaseModel):
    title: str
    body: str = ""
    link: str = ""

@api.post("/admin/announce")
async def admin_announce(payload: AnnounceIn, current_user: dict = Depends(get_admin)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    sent = await notification_repo.notify_all_users(
        "announcement", title, payload.body.strip(), payload.link.strip(), include_devs=True)
    log.info("admin: announcement sent by=%s sent=%d", current_user["username"], sent)
    return {"sent": sent}
