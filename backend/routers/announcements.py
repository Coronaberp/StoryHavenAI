import json
import re
import time

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import llm
from backend.auth import get_current_user, require_permission
from backend.repositories import notifications as notification_repo
from backend.repositories import settings as settings_repo
from backend.repositories import users as user_repo
from backend.schemas import SiteBannerIn, AdminToneGenerateIn, AdminTargetedNotifyIn
from backend.state import api, log, CFG

class AnnounceIn(BaseModel):
    title: str
    body: str = ""
    link: str = ""

@api.post("/admin/announce")
async def admin_announce(payload: AnnounceIn, current_user: dict = Depends(require_permission("site_announcements", "write"))):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    sent = await notification_repo.notify_all_users(
        "announcement", title, payload.body.strip(), payload.link.strip(), include_devs=True)
    log.info("admin: announcement sent by=%s sent=%d", current_user["username"], sent)
    return {"sent": sent}

def _chat_fallback_profiles_default() -> list[dict]:
    proxies = CFG.get("chat_proxies") or []
    if not proxies:
        return [{"name": "default", "base_url": CFG["base_url"], "api_key": CFG["api_key"], "model": CFG["chat_model"]}]
    return sorted(proxies, key=lambda p: p.get("priority", 0))

@api.post("/admin/notifications/generate-tone")
async def admin_generate_toned_notification(payload: AdminToneGenerateIn, current_user: dict = Depends(require_permission("site_announcements", "write"))):
    context = payload.context.strip()
    if not context:
        raise HTTPException(400, "Context is required")
    tone = payload.tone.strip() or "plain and direct"
    prompt = (
        "You are rewriting a plain-text note from a platform admin into a short message to send "
        f"to one or more users. Tone to write it in: {tone}. Keep any concrete instructions or facts "
        "from the original text intact and stated plainly — only the tone/wording should change, not "
        "the substance. Do not use extended thinking or a <think> block for this — it's a short, "
        "simple rewrite. Respond immediately with ONLY the final message text, no reasoning or "
        "meta-commentary.\n\n"
        "Admin's plain-text note:\n" + context
    )
    messages = [{"role": "user", "content": prompt}]

    def _strip_thinking(raw: str) -> str:
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
        raw = re.sub(r"<thought>.*?</thought>", "", raw, flags=re.DOTALL)
        raw = re.sub(r"<think>.*$", "", raw, flags=re.DOTALL)
        raw = re.sub(r"<thought>.*$", "", raw, flags=re.DOTALL)
        return raw.strip()

    async def gen():
        params = {"max_tokens": 500, "chat_template_kwargs": {"thinking": False, "enable_thinking": False}}
        profiles = _chat_fallback_profiles_default()
        last_error = None
        for profile in profiles:
            raw = ""
            try:
                async for channel, content in llm.chat_stream(
                        messages, profile["model"], params, parse_think=True,
                        base_url=profile["base_url"], api_key=profile.get("api_key") or None):
                    if channel == "content":
                        raw += content
                        yield "data: " + json.dumps({"type": "delta"}) + "\n\n"
            except Exception as e:
                last_error = e
                log.warning("admin: toned notification generation failed profile=%s by=%s: %s",
                            profile.get("name"), current_user["username"], e)
                continue
            text = _strip_thinking(raw)
            if text:
                log.info("admin: generated toned notification text by=%s profile=%s len=%d",
                          current_user["username"], profile.get("name"), len(text))
                yield "data: " + json.dumps({"type": "done", "text": text}) + "\n\n"
                return
            log.warning("admin: toned notification profile=%s by=%s returned only thinking, trying next",
                        profile.get("name"), current_user["username"])
        message = str(last_error) if last_error else "The model got stuck reasoning and never produced a final answer — try again."
        yield "data: " + json.dumps({"type": "error", "message": message}) + "\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

@api.post("/admin/notifications/send-targeted")
async def admin_send_targeted_notification(payload: AdminTargetedNotifyIn, current_user: dict = Depends(require_permission("site_announcements", "write"))):
    text = payload.text.strip()
    title = payload.title.strip() or "A message from the admins"
    if not text:
        raise HTTPException(400, "Message text is required")
    usernames = [u.strip() for u in payload.usernames if u.strip()]
    if not usernames:
        raise HTTPException(400, "At least one username is required")
    sent = 0
    failed = []
    for uname in usernames:
        user = await user_repo.get_user_by_username(uname)
        if not user:
            failed.append(uname)
            continue
        await notification_repo.create(user["id"], "admin_message", title, text, link=payload.link.strip())
        sent += 1
    log.info("admin: targeted notification sent by=%s sent=%d failed=%d",
             current_user["username"], sent, len(failed))
    return {"sent": sent, "failed": failed}

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
async def set_site_banner(payload: SiteBannerIn, current_user: dict = Depends(require_permission("site_announcements", "execute"))):
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
async def clear_site_banner(current_user: dict = Depends(require_permission("site_announcements", "execute"))):
    await settings_repo.set_settings({"site_banner": None})
    log.info("admin: site banner cleared by=%s", current_user["username"])
    return {"ok": True}
