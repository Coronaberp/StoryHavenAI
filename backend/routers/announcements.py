import time

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_admin, get_current_user
from backend.repositories import notifications as notification_repo
from backend.repositories import settings as settings_repo
from backend.schemas import SiteBannerIn
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

async def _active_banner():
    data = (await settings_repo.all_settings()).get("site_banner")
    if not data:
        return None
    if data.get("ends_at") and time.time() > data["ends_at"]:
        return None
    return data

@api.get("/site-banner")
async def get_site_banner(current_user: dict = Depends(get_current_user)):
    return await _active_banner()

@api.put("/admin/site-banner")
async def set_site_banner(payload: SiteBannerIn, current_user: dict = Depends(get_admin)):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    data = {
        "message": message,
        "banner_type": payload.banner_type,
        "ends_at": payload.ends_at,
        "created_by": current_user["username"],
        "created_at": time.time(),
    }
    await settings_repo.set_settings({"site_banner": data})
    log.info("admin: site banner set by=%s type=%s ends_at=%s", current_user["username"], payload.banner_type, payload.ends_at)
    return data

@api.delete("/admin/site-banner")
async def clear_site_banner(current_user: dict = Depends(get_admin)):
    await settings_repo.set_settings({"site_banner": None})
    log.info("admin: site banner cleared by=%s", current_user["username"])
    return {"ok": True}
