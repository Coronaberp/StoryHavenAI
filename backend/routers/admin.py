import re
import secrets

import httpx
from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import standalone_images as standalone_image_repo
from backend.repositories import image_rating_reports as image_rating_report_repo
from backend import imagegen
from backend.state import api, log, _log_buffer, CFG
from backend.auth import get_admin, get_dev, normalize_username, require_permission
from backend.routers.imagegen import _match_model_request_host
from backend.ssrf import _resolve_host_ip_issue
from backend.repositories import flagged_endpoints as flagged_endpoint_repo
from backend.repositories import invite_codes as invite_code_repo
from backend.repositories import model_requests as model_request_repo
from backend.repositories import content_reports as content_report_repo
from backend.repositories import password_reset_requests as password_reset_request_repo
from backend.repositories import users as user_repo
from backend.repositories import characters
from backend.repositories import lore
from backend.repositories import admin_notes as admin_note_repo
from backend.schemas import (UserCreateIn, SuspendUserIn, AdminNoteIn, IdentityLabelIn,
                     ImageReportResolveIn, ContentReportResolveIn, DevRoleIn, InviteCodeIn, UserTierIn,
                     ModelRequestHostTestIn)

_KNOWN_MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth")

def _model_request_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_") or "model"

def _alnum_only(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

async def _fulfilled_model_slugs(request_type: str) -> set[str]:
    base_url = CFG["comfyui_url"]
    try:
        if request_type in ("checkpoint", "anima"):
            names = await imagegen.list_checkpoints(base_url) + await imagegen.list_anima_unets(base_url)
        elif request_type == "wan":
            names = await imagegen.list_wan_unets(base_url) + await imagegen.list_wan_clip_models(base_url)
        elif request_type == "lora":
            names = await imagegen.list_loras(base_url)
        elif request_type == "upscaler":
            names = await imagegen.list_upscalers(base_url)
        else:
            names = []
    except Exception as e:
        log.warning("admin: model-request fulfillment check failed for type=%s: %s: %s",
                   request_type, type(e).__name__, e)
        return set()
    slugs = set()
    for n in names:
        base = n.rsplit("/", 1)[-1]
        for ext in _KNOWN_MODEL_EXTS:
            if base.lower().endswith(ext):
                slugs.add(base[:-len(ext)].lower())
                break
    return slugs

@api.get("/admin/users")
async def admin_list_users(_: dict = Depends(require_permission("user_management", "read"))):
    return await user_repo.list_users()

@api.get("/admin/invite-codes")
async def admin_list_invite_codes(current_user: dict = Depends(require_permission("invite_codes", "read"))):
    codes = await invite_code_repo.list_all()
    for c in codes:
        c["redeemed_by"] = await invite_code_repo.redeemer_usernames(c["id"])
    return codes

@api.post("/admin/invite-codes")
async def admin_create_invite_code(body: InviteCodeIn,
                                   current_user: dict = Depends(require_permission("invite_codes", "write"))):
    code = await invite_code_repo.create(current_user["id"], max_uses=body.max_uses,
                                         expires_days=body.expires_days, note=body.note or "",
                                         tier=body.tier)
    log.info("admin: invite code created id=%s by=%s", code["id"], current_user["username"])
    return code

@api.post("/admin/invite-codes/{cid}/disable")
async def admin_disable_invite_code(cid: str, current_user: dict = Depends(require_permission("invite_codes", "write"))):
    if not await invite_code_repo.disable(cid):
        raise HTTPException(404, "invite code not found")
    log.info("admin: invite code disabled id=%s by=%s", cid, current_user["username"])
    return {"disabled": True}

@api.delete("/admin/invite-codes/{cid}")
async def admin_delete_invite_code(cid: str, current_user: dict = Depends(require_permission("invite_codes", "write"))):
    await invite_code_repo.delete(cid)
    log.info("admin: invite code deleted id=%s by=%s", cid, current_user["username"])
    return {"deleted": True}

@api.put("/admin/users/{uid}/tier")
async def admin_set_user_tier(uid: str, body: UserTierIn,
                              current_user: dict = Depends(require_permission("user_management", "write"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "user not found")
    if target.get("role") in ("admin", "dev") or target.get("is_admin"):
        raise HTTPException(400, "Admins are always full tier")
    await user_repo.set_role(uid, "guest" if body.tier == "guest" else "member")
    log.info("admin: tier=%s uid=%s by=%s", body.tier, uid, current_user["username"])
    return {"id": uid, "tier": body.tier}

MODEL_REQUEST_HISTORY_LIMIT = 20

_HOST_TEST_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                 "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

def _looks_bot_gated(status_code: int, headers, text_sample: str) -> bool:
    if "cf-mitigated" in headers:
        return True
    lowered = text_sample.lower()
    if "just a moment" in lowered and "cloudflare" in lowered:
        return True
    if status_code == 403 and ("cf-chl" in lowered or "cloudflare" in lowered):
        return True
    return False

@api.post("/admin/model-request-hosts/test")
async def admin_test_model_request_host(body: ModelRequestHostTestIn, current_user: dict = Depends(require_permission("model_request_approval", "read"))):
    host = (body.host or "").strip().lower()
    if not host:
        raise HTTPException(400, "host is required")
    url = f"https://{host}/"
    issue = await _resolve_host_ip_issue(url, is_admin=False)
    if issue:
        raise HTTPException(400, issue)
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _HOST_TEST_UA})
    except Exception as e:
        log.warning("admin: model request host test failed host=%s by=%s: %s",
                    host, current_user["username"], e)
        return {"reachable": False, "bot_gated": False,
                "detail": f"Couldn't connect: {e}"}
    text_sample = resp.text[:4000] if resp.headers.get("content-type", "").startswith("text/html") else ""
    bot_gated = _looks_bot_gated(resp.status_code, resp.headers, text_sample)
    log.info("admin: tested model request host=%s status=%s bot_gated=%s by=%s",
             host, resp.status_code, bot_gated, current_user["username"])
    return {
        "reachable": True,
        "status_code": resp.status_code,
        "bot_gated": bot_gated,
        "detail": ("This host's front page looks bot-protected (e.g. Cloudflare) — this only tested "
                   "the homepage, not an actual download link, so it doesn't necessarily mean real "
                   "download URLs will fail (some sites gate browsing pages but leave direct file "
                   "links open). If a download from this host fails in practice, that's the real signal.") if bot_gated else "Looks reachable.",
    }

@api.get("/admin/model-requests")
async def admin_list_model_requests(current_user: dict = Depends(require_permission("model_request_approval", "read"))):
    all_rows = await model_request_repo.list(pending_only=False)
    active_rows = [r for r in all_rows if r["status"] in ("pending", "approved")]
    history_rows = [r for r in all_rows if r["status"] in ("implemented", "rejected")][:MODEL_REQUEST_HISTORY_LIMIT]
    rows = active_rows + history_rows
    is_dev = current_user.get("role") == "dev"
    fulfilled_cache: dict[str, set[str]] = {}
    for r in rows:

        match = _match_model_request_host(r["source_url"]) if is_dev else None
        r["resolved_api_key"] = match["api_key"] if match and match.get("api_key") else None
        vae_match = _match_model_request_host(r["vae_url"]) if is_dev and r.get("vae_url") else None
        r["resolved_vae_api_key"] = vae_match["api_key"] if vae_match and vae_match.get("api_key") else None
        te_match = (_match_model_request_host(r["text_encoder_url"])
                   if is_dev and r.get("text_encoder_url") else None)
        r["resolved_text_encoder_api_key"] = (te_match["api_key"]
                                              if te_match and te_match.get("api_key") else None)
        r["fulfilled"] = False
        if r["status"] == "approved" and r["request_type"] in ("checkpoint", "lora", "upscaler", "anima", "wan"):
            if r["request_type"] not in fulfilled_cache:
                fulfilled_cache[r["request_type"]] = await _fulfilled_model_slugs(r["request_type"])

            req_norm = _alnum_only(r["model_name"])
            r["fulfilled"] = any(req_norm in _alnum_only(slug) or _alnum_only(slug) in req_norm
                                 for slug in fulfilled_cache[r["request_type"]])
    return rows

@api.post("/admin/model-requests/{rid}/approve")
async def admin_approve_model_request(rid: str, current_user: dict = Depends(require_permission("model_request_approval", "execute"))):
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    if r["status"] != "pending":
        raise HTTPException(400, "request is not pending")
    await model_request_repo.set_status(rid, "approved")
    log.info("admin: approved model request by=%s model=%s url=%s",
             current_user["username"], r["model_name"], r["source_url"])
    return {"status": "approved"}

@api.post("/admin/model-requests/{rid}/reject")
async def admin_reject_model_request(rid: str, current_user: dict = Depends(require_permission("model_request_approval", "execute"))):
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    await model_request_repo.set_status(rid, "rejected")
    log.info("admin: rejected model request by=%s model=%s url=%s",
             current_user["username"], r["model_name"], r["source_url"])
    return {"status": "rejected"}

@api.post("/admin/model-requests/{rid}/reopen")
async def admin_reopen_model_request(rid: str, current_user: dict = Depends(require_permission("model_request_approval", "execute"))):
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    if r["status"] not in ("implemented", "rejected"):
        raise HTTPException(400, "request is not implemented or rejected")
    await model_request_repo.set_status(rid, "approved")
    log.info("admin: reopened model request by=%s model=%s previous_status=%s",
             current_user["username"], r["model_name"], r["status"])
    return {"status": "approved"}

@api.post("/admin/model-requests/{rid}/complete")
async def admin_complete_model_request(rid: str, current_user: dict = Depends(require_permission("model_request_approval", "execute"))):
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    await model_request_repo.set_status(rid, "implemented")
    log.info("admin: marked model request implemented by=%s model=%s",
             current_user["username"], r["model_name"])
    return {"status": "implemented"}

@api.get("/admin/image-reports")
async def admin_list_image_reports(_: dict = Depends(require_permission("moderation_queue", "read"))):
    return await image_rating_report_repo.list(pending_only=True)

@api.post("/admin/image-reports/{report_id}/resolve")
async def admin_resolve_image_report(report_id: str, body: ImageReportResolveIn,
                                     current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    rep = await image_rating_report_repo.get(report_id)
    if not rep:
        raise HTTPException(404, "not found")
    await standalone_image_repo.set_explicit(rep["image_id"], body.is_explicit, human_reviewed=True)
    await image_rating_report_repo.resolve(report_id, (body.admin_note or "").strip())
    log.info("admin: resolved image report by=%s image=%s is_explicit=%s",
             current_user["username"], rep["image_id"], body.is_explicit)
    return {"status": "resolved", "is_explicit": body.is_explicit}

_CONTENT_REPORT_SETTERS = {
    "avatar": user_repo.set_explicit, "banner": user_repo.set_explicit, "profile": user_repo.set_explicit,
    "character": characters.set_explicit,
    "lore": lore.set_explicit,
}

@api.get("/admin/content-reports")
async def admin_list_content_reports(_: dict = Depends(require_permission("moderation_queue", "read"))):
    return await content_report_repo.list(pending_only=True)

@api.post("/admin/content-reports/{report_id}/resolve")
async def admin_resolve_content_report(report_id: str, body: ContentReportResolveIn,
                                       current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    rep = await content_report_repo.get(report_id)
    if not rep:
        raise HTTPException(404, "not found")
    setter = _CONTENT_REPORT_SETTERS.get(rep["kind"])
    if setter and rep["target_id"]:
        await setter(rep["target_id"], body.is_explicit)
    await content_report_repo.resolve(report_id)
    log.info("admin: resolved content report by=%s report=%s kind=%s is_explicit=%s",
             current_user["username"], report_id, rep["kind"], body.is_explicit)
    return {"status": "resolved", "is_explicit": body.is_explicit}

@api.post("/admin/users")
async def admin_create_user(body: UserCreateIn, current_user: dict = Depends(require_permission("user_management", "write"))):
    username = normalize_username(body.username)
    existing = await user_repo.get_user_by_username(username)
    if existing:
        raise HTTPException(400, "Username already taken")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    created = await user_repo.create_user(username, body.password, is_admin=body.is_admin)
    log.info("admin: user created by=%s new_user=%s admin=%s", current_user["username"], username, body.is_admin)
    return created

@api.delete("/admin/users/{uid}")
async def admin_delete_user(uid: str, current_user: dict = Depends(require_permission("user_management", "execute"))):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot delete your own account")
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("role") == "dev":
        raise HTTPException(400, "This account cannot be deleted")
    await user_repo.delete_user(uid)
    log.info("admin: user deleted by=%s target=%s", current_user["username"], target["username"])
    return {"deleted": True}

@api.put("/admin/users/{uid}/password")
async def admin_reset_password(uid: str, body: UserCreateIn, current_user: dict = Depends(require_permission("user_management", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    await user_repo.update_user_password(uid, body.password)
    await user_repo.revoke_user_tokens(uid)
    log.info("admin: password reset by=%s target=%s", current_user["username"], target["username"])
    return {"ok": True}

@api.put("/admin/users/{uid}/role")
async def admin_update_role(uid: str, body: UserCreateIn, current_user: dict = Depends(require_permission("user_management", "execute"))):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot change your own role")
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")

    if not body.is_admin and target.get("role") == "dev":
        raise HTTPException(400, "This account cannot be demoted")
    await user_repo.update_user_role(uid, body.is_admin)
    log.info("admin: role changed by=%s target=%s admin=%s", current_user["username"], target["username"], body.is_admin)
    return await user_repo.get_user_by_id(uid)

@api.put("/admin/users/{uid}/dev-role")
async def admin_update_dev_role(uid: str, body: DevRoleIn, current_user: dict = Depends(get_dev)):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot change your own Dev status")
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if not target.get("is_admin"):
        raise HTTPException(400, "Only an admin can be made Dev")
    await user_repo.set_dev_role(uid, body.is_dev)
    log.info("admin: dev role changed by=%s target=%s is_dev=%s",
             current_user["username"], target["username"], body.is_dev)
    return await user_repo.get_user_by_id(uid)

@api.post("/admin/users/{uid}/approve")
async def admin_approve_user(uid: str, current_user: dict = Depends(require_permission("user_management", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await user_repo.update_user_status(uid, "active")
    log.info("admin: user approved by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)

@api.post("/admin/users/{uid}/deny")
async def admin_deny_user(uid: str, current_user: dict = Depends(require_permission("user_management", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot deny your own account")
    await user_repo.delete_user(uid)
    log.info("admin: user denied by=%s target=%s", current_user["username"], target["username"])
    return {"denied": True}

@api.post("/admin/users/{uid}/suspend")
async def admin_suspend_user(uid: str, body: SuspendUserIn, current_user: dict = Depends(require_permission("user_management", "execute"))):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot suspend your own account")
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("role") == "dev":
        raise HTTPException(400, "This account cannot be suspended")
    reason = (body.reason or "").strip() or None
    await user_repo.suspend_user(uid, reason)
    log.info("admin: user suspended by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)

@api.post("/admin/users/{uid}/unsuspend")
async def admin_unsuspend_user(uid: str, current_user: dict = Depends(require_permission("user_management", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await user_repo.unsuspend_user(uid)
    log.info("admin: user unsuspended by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)

@api.post("/admin/users/{uid}/totp/clear")
async def admin_clear_user_totp(uid: str, current_user: dict = Depends(require_permission("user_management", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await user_repo.set_totp_secret(uid, None)
    await user_repo.set_totp_enabled(uid, False)
    log.info("admin: totp cleared by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)

@api.get("/admin/users/{uid}/notes")
async def admin_list_user_notes(uid: str, _: dict = Depends(require_permission("user_management", "read"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    return await admin_note_repo.list_for_user(uid)

@api.post("/admin/users/{uid}/notes")
async def admin_add_user_note(uid: str, body: AdminNoteIn, current_user: dict = Depends(require_permission("user_management", "write"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    note = (body.note or "").strip()[:4000]
    if not note:
        raise HTTPException(400, "note is required")
    created = await admin_note_repo.create(uid, current_user["id"], note)
    log.info("admin: note added by=%s target=%s", current_user["username"], target["username"])
    created["author_username"] = current_user["username"]
    return created

@api.delete("/admin/notes/{note_id}")
async def admin_delete_user_note(note_id: str, current_user: dict = Depends(require_permission("user_management", "write"))):
    await admin_note_repo.delete(note_id)
    log.info("admin: note deleted by=%s note=%s", current_user["username"], note_id)
    return {"deleted": True}

@api.put("/admin/users/{uid}/identity")
async def admin_set_identity_label(uid: str, body: IdentityLabelIn, current_user: dict = Depends(require_permission("user_management", "write"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    label = (body.label or "").strip()[:40] or None
    await user_repo.set_identity_label(uid, label)
    log.info("admin: identity label set by=%s target=%s", current_user["username"], target["username"])
    return {"identity_label": label}

@api.get("/admin/flagged-endpoints")
async def admin_list_flagged_endpoints(_: dict = Depends(require_permission("moderation_queue", "read"))):
    return await flagged_endpoint_repo.list(pending_only=True)

@api.post("/admin/flagged-endpoints/{fid}/block")
async def admin_block_flagged_endpoint(fid: str, current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    entry = await flagged_endpoint_repo.get(fid)
    if not entry:
        raise HTTPException(404, "not found")
    await flagged_endpoint_repo.set_status(fid, "blocked")
    log.info("admin: blocked flagged endpoint by=%s user=%s url=%s",
             current_user["username"], entry["user_id"], entry["url"])
    return {"status": "blocked"}

@api.post("/admin/flagged-endpoints/{fid}/allow")
async def admin_allow_flagged_endpoint(fid: str, current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    entry = await flagged_endpoint_repo.get(fid)
    if not entry:
        raise HTTPException(404, "not found")
    data = {"base_url": entry["url"]}
    if entry.get("api_key"):
        data["api_key"] = entry["api_key"]
    await user_repo.set_user_settings(entry["user_id"], data)
    await flagged_endpoint_repo.set_status(fid, "allowed")
    log.info("admin: allowed flagged endpoint by=%s user=%s url=%s",
             current_user["username"], entry["user_id"], entry["url"])
    return {"status": "allowed"}

@api.get("/admin/password-reset-requests")
async def admin_list_password_reset_requests(_: dict = Depends(require_permission("moderation_queue", "read"))):
    return await password_reset_request_repo.list(pending_only=True)

@api.post("/admin/password-reset-requests/{rid}/approve")
async def admin_approve_password_reset(rid: str, current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    req = await password_reset_request_repo.get(rid)
    if not req:
        raise HTTPException(404, "not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Request already resolved")
    target = await user_repo.get_user_by_id(req["user_id"])
    if not target:
        await password_reset_request_repo.set_status(rid, "denied")
        raise HTTPException(404, "User no longer exists")
    new_password = secrets.token_urlsafe(14)
    await user_repo.update_user_password(req["user_id"], new_password)
    await user_repo.revoke_user_tokens(req["user_id"])
    await password_reset_request_repo.set_status(rid, "approved")
    log.info("admin: password reset approved by=%s target=%s",
             current_user["username"], target["username"])
    return {"ok": True, "username": target["username"], "password": new_password}

@api.post("/admin/password-reset-requests/{rid}/deny")
async def admin_deny_password_reset(rid: str, current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    req = await password_reset_request_repo.get(rid)
    if not req:
        raise HTTPException(404, "not found")
    await password_reset_request_repo.set_status(rid, "denied")
    log.info("admin: password reset denied by=%s target=%s",
             current_user["username"], req["username"])
    return {"ok": True}

@api.get("/admin/title-requests")
async def admin_list_title_requests(_: dict = Depends(require_permission("moderation_queue", "read"))):
    return await content_report_repo.list_title_requests()

@api.post("/admin/title-requests/{uid}/approve")
async def admin_approve_title_request(uid: str, current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("title_status") != "pending":
        raise HTTPException(400, "Request already resolved")
    await content_report_repo.set_title_status(uid, "approved")
    log.info("admin: title approved by=%s target=%s title=%s",
             current_user["username"], target["username"], target.get("title"))
    return {"status": "approved"}

@api.post("/admin/title-requests/{uid}/reject")
async def admin_reject_title_request(uid: str, current_user: dict = Depends(require_permission("moderation_queue", "execute"))):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("title_status") != "pending":
        raise HTTPException(400, "Request already resolved")
    await content_report_repo.set_title_status(uid, "rejected")
    log.info("admin: title rejected by=%s target=%s title=%s",
             current_user["username"], target["username"], target.get("title"))
    return {"status": "rejected"}

_LOG_LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}

@api.get("/admin/logs")
async def admin_logs(level: str = "INFO", limit: int = 200, _: dict = Depends(require_permission("server_logs", "read"))):
    floor = _LOG_LEVELS.get(level.upper(), 20)
    entries = [e for e in _log_buffer.buffer if _LOG_LEVELS.get(e["level"], 20) >= floor]
    return {"logs": entries[-max(1, min(limit, 500)):]}

