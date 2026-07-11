"""Admin routes: user management, flagged endpoints, purge, logs."""
import re
import secrets

from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import standalone_images as standalone_image_repo
from backend.repositories import image_rating_reports as image_rating_report_repo
from backend import imagegen
from backend.state import api, log, _log_buffer, CFG
from backend.auth import get_admin, get_dev, normalize_username
from backend.routers.imagegen import _match_model_request_host
from backend.repositories import flagged_endpoints as flagged_endpoint_repo
from backend.repositories import model_requests as model_request_repo
from backend.repositories import content_reports as content_report_repo
from backend.repositories import password_reset_requests as password_reset_request_repo
from backend.repositories import users as user_repo
from backend.repositories import characters
from backend.repositories import lore
from backend.repositories import admin_notes as admin_note_repo
from backend.schemas import (UserCreateIn, SuspendUserIn, AdminNoteIn, IdentityLabelIn,
                     ImageReportResolveIn, ContentReportResolveIn, DevRoleIn)

_KNOWN_MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth")


def _model_request_slug(name: str) -> str:
    """Same slugify rule the frontend's copy-curl button uses (static/app.js)
    to build the suggested -o filename — kept in lockstep so fulfillment
    detection actually recognizes files downloaded via that command."""
    return re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_") or "model"


def _alnum_only(s: str) -> str:
    """Letters/digits only, no separators at all — used just for the fuzzy
    fulfillment comparison below. The real downloaded filename essentially
    never uses the same word-separator convention as the request's slugified
    display name (e.g. request slug "miao_miao_harem" vs. an actual file
    like "MiaoMiaoHaremAnimaV1.safetensors" -> "miaomiaoharemanimav1") — an
    underscore-preserving substring check fails on that mismatch alone even
    though the names are obviously the same model, so both sides are
    stripped down to bare alphanumerics before comparing."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


async def _fulfilled_model_slugs(request_type: str) -> set[str]:
    """Bare filenames (no extension) currently visible to ComfyUI for a given
    request type — used to auto-detect a manually-downloaded model without
    needing the dev to click a separate "mark as done" button. A "checkpoint"
    request can end up satisfied by either a standard all-in-one checkpoint
    (checkpoints/, CheckpointLoaderSimple) or an Anima-style UNET-only model
    (diffusion_models/, UNETLoader) — the request itself doesn't say which
    architecture the download turned out to be, so both lists are checked."""
    base_url = CFG["comfyui_url"]
    try:
        if request_type in ("checkpoint", "anima"):
            names = await imagegen.list_checkpoints(base_url) + await imagegen.list_anima_unets(base_url)
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
async def admin_list_users(_: dict = Depends(get_admin)):
    return await user_repo.list_users()


@api.get("/admin/model-requests")
async def admin_list_model_requests(current_user: dict = Depends(get_admin)):
    rows = [r for r in await model_request_repo.list(pending_only=False)
            if r["status"] in ("pending", "approved")]
    is_dev = current_user.get("role") == "dev"
    fulfilled_cache: dict[str, set[str]] = {}
    for r in rows:
        # Only the platform dev sees the actual curl/API-key material — that's
        # genuinely sensitive. Whether a request has already been downloaded
        # is not: gating it behind is_dev too meant every other admin always
        # saw approved-and-installed requests as still "pending", forever,
        # since fulfillment was never even checked for them.
        match = _match_model_request_host(r["source_url"]) if is_dev else None
        r["resolved_api_key"] = match["api_key"] if match and match.get("api_key") else None
        vae_match = _match_model_request_host(r["vae_url"]) if is_dev and r.get("vae_url") else None
        r["resolved_vae_api_key"] = vae_match["api_key"] if vae_match and vae_match.get("api_key") else None
        te_match = (_match_model_request_host(r["text_encoder_url"])
                   if is_dev and r.get("text_encoder_url") else None)
        r["resolved_text_encoder_api_key"] = (te_match["api_key"]
                                              if te_match and te_match.get("api_key") else None)
        r["fulfilled"] = False
        if r["status"] == "approved" and r["request_type"] in ("checkpoint", "lora", "upscaler", "anima"):
            if r["request_type"] not in fulfilled_cache:
                fulfilled_cache[r["request_type"]] = await _fulfilled_model_slugs(r["request_type"])
            # Alnum-only substring match, not exact — the real downloaded
            # filename essentially never matches the request's slugified
            # display name using the same word-separator convention (version
            # suffixes, publisher prefixes, underscores vs. none at all —
            # see _alnum_only), which left genuinely installed models stuck
            # showing as unfulfilled forever.
            req_norm = _alnum_only(r["model_name"])
            r["fulfilled"] = any(req_norm in _alnum_only(slug) or _alnum_only(slug) in req_norm
                                 for slug in fulfilled_cache[r["request_type"]])
    return rows


@api.post("/admin/model-requests/{rid}/approve")
async def admin_approve_model_request(rid: str, current_user: dict = Depends(get_admin)):
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
async def admin_reject_model_request(rid: str, current_user: dict = Depends(get_admin)):
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    await model_request_repo.set_status(rid, "rejected")
    log.info("admin: rejected model request by=%s model=%s url=%s",
             current_user["username"], r["model_name"], r["source_url"])
    return {"status": "rejected"}


@api.post("/admin/model-requests/{rid}/complete")
async def admin_complete_model_request(rid: str, current_user: dict = Depends(get_admin)):
    """Marks an approved request as implemented — a genuinely distinct terminal
    status from "rejected" (which the admin UI's "Done" button used to reuse,
    mislabeling every actually-installed model as REJECTED in every history
    view, including the requester's own "my requests" list)."""
    r = await model_request_repo.get(rid)
    if not r:
        raise HTTPException(404, "not found")
    await model_request_repo.set_status(rid, "implemented")
    log.info("admin: marked model request implemented by=%s model=%s",
             current_user["username"], r["model_name"])
    return {"status": "implemented"}


@api.get("/admin/image-reports")
async def admin_list_image_reports(_: dict = Depends(get_admin)):
    return await image_rating_report_repo.list(pending_only=True)


@api.post("/admin/image-reports/{report_id}/resolve")
async def admin_resolve_image_report(report_id: str, body: ImageReportResolveIn,
                                     current_user: dict = Depends(get_admin)):
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
async def admin_list_content_reports(_: dict = Depends(get_admin)):
    return await content_report_repo.list(pending_only=True)


@api.post("/admin/content-reports/{report_id}/resolve")
async def admin_resolve_content_report(report_id: str, body: ContentReportResolveIn,
                                       current_user: dict = Depends(get_admin)):
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
async def admin_create_user(body: UserCreateIn, current_user: dict = Depends(get_admin)):
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
async def admin_delete_user(uid: str, current_user: dict = Depends(get_admin)):
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
async def admin_reset_password(uid: str, body: UserCreateIn, current_user: dict = Depends(get_admin)):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    await user_repo.update_user_password(uid, body.password)
    await user_repo.delete_other_user_sessions(uid)
    log.info("admin: password reset by=%s target=%s", current_user["username"], target["username"])
    return {"ok": True}


@api.put("/admin/users/{uid}/role")
async def admin_update_role(uid: str, body: UserCreateIn, current_user: dict = Depends(get_admin)):
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot change your own role")
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    # A Dev-tier account is protected from demotion by any other admin — it's
    # a normal admin account in every other respect, just never demotable by
    # someone else. Demoting to non-admin implies losing Dev too (Dev requires
    # is_admin), so that's the one case this blocks; role="dev" -> role="user"
    # (still admin, no longer Dev) is a separate action, see /dev-role below.
    if not body.is_admin and target.get("role") == "dev":
        raise HTTPException(400, "This account cannot be demoted")
    await user_repo.update_user_role(uid, body.is_admin)
    log.info("admin: role changed by=%s target=%s admin=%s", current_user["username"], target["username"], body.is_admin)
    return await user_repo.get_user_by_id(uid)


@api.put("/admin/users/{uid}/dev-role")
async def admin_update_dev_role(uid: str, body: DevRoleIn, current_user: dict = Depends(get_dev)):
    """Grant/revoke the Dev tier — only an existing Dev can do this, so a
    regular admin can never self-escalate to Dev."""
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
async def admin_approve_user(uid: str, current_user: dict = Depends(get_admin)):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await user_repo.update_user_status(uid, "active")
    log.info("admin: user approved by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)


@api.post("/admin/users/{uid}/deny")
async def admin_deny_user(uid: str, current_user: dict = Depends(get_admin)):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    if uid == current_user["id"]:
        raise HTTPException(400, "Cannot deny your own account")
    await user_repo.delete_user(uid)
    log.info("admin: user denied by=%s target=%s", current_user["username"], target["username"])
    return {"denied": True}


@api.post("/admin/users/{uid}/suspend")
async def admin_suspend_user(uid: str, body: SuspendUserIn, current_user: dict = Depends(get_admin)):
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
async def admin_unsuspend_user(uid: str, current_user: dict = Depends(get_admin)):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    await user_repo.unsuspend_user(uid)
    log.info("admin: user unsuspended by=%s target=%s", current_user["username"], target["username"])
    return await user_repo.get_user_by_id(uid)


@api.get("/admin/users/{uid}/notes")
async def admin_list_user_notes(uid: str, _: dict = Depends(get_admin)):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    return await admin_note_repo.list_for_user(uid)


@api.post("/admin/users/{uid}/notes")
async def admin_add_user_note(uid: str, body: AdminNoteIn, current_user: dict = Depends(get_admin)):
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
async def admin_delete_user_note(note_id: str, current_user: dict = Depends(get_admin)):
    await admin_note_repo.delete(note_id)
    log.info("admin: note deleted by=%s note=%s", current_user["username"], note_id)
    return {"deleted": True}


@api.put("/admin/users/{uid}/identity")
async def admin_set_identity_label(uid: str, body: IdentityLabelIn, current_user: dict = Depends(get_admin)):
    target = await user_repo.get_user_by_id(uid)
    if not target:
        raise HTTPException(404, "User not found")
    label = (body.label or "").strip()[:40] or None
    await user_repo.set_identity_label(uid, label)
    log.info("admin: identity label set by=%s target=%s", current_user["username"], target["username"])
    return {"identity_label": label}


@api.get("/admin/flagged-endpoints")
async def admin_list_flagged_endpoints(_: dict = Depends(get_admin)):
    return await flagged_endpoint_repo.list(pending_only=True)


@api.post("/admin/flagged-endpoints/{fid}/block")
async def admin_block_flagged_endpoint(fid: str, current_user: dict = Depends(get_admin)):
    entry = await flagged_endpoint_repo.get(fid)
    if not entry:
        raise HTTPException(404, "not found")
    await flagged_endpoint_repo.set_status(fid, "blocked")
    log.info("admin: blocked flagged endpoint by=%s user=%s url=%s",
             current_user["username"], entry["user_id"], entry["url"])
    return {"status": "blocked"}


@api.post("/admin/flagged-endpoints/{fid}/allow")
async def admin_allow_flagged_endpoint(fid: str, current_user: dict = Depends(get_admin)):
    """Approves the endpoint despite it failing automatic verification (e.g. a
    self-hosted server on a legitimately private IP) and applies it to the
    requesting user's settings now, on the admin's authority."""
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
async def admin_list_password_reset_requests(_: dict = Depends(get_admin)):
    return await password_reset_request_repo.list(pending_only=True)


@api.post("/admin/password-reset-requests/{rid}/approve")
async def admin_approve_password_reset(rid: str, current_user: dict = Depends(get_admin)):
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
    await user_repo.delete_other_user_sessions(req["user_id"])
    await password_reset_request_repo.set_status(rid, "approved")
    log.info("admin: password reset approved by=%s target=%s",
             current_user["username"], target["username"])
    return {"ok": True, "username": target["username"], "password": new_password}


@api.post("/admin/password-reset-requests/{rid}/deny")
async def admin_deny_password_reset(rid: str, current_user: dict = Depends(get_admin)):
    req = await password_reset_request_repo.get(rid)
    if not req:
        raise HTTPException(404, "not found")
    await password_reset_request_repo.set_status(rid, "denied")
    log.info("admin: password reset denied by=%s target=%s",
             current_user["username"], req["username"])
    return {"ok": True}


@api.get("/admin/title-requests")
async def admin_list_title_requests(_: dict = Depends(get_admin)):
    return await content_report_repo.list_title_requests()


@api.post("/admin/title-requests/{uid}/approve")
async def admin_approve_title_request(uid: str, current_user: dict = Depends(get_admin)):
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
async def admin_reject_title_request(uid: str, current_user: dict = Depends(get_admin)):
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
async def admin_logs(level: str = "INFO", limit: int = 200, _: dict = Depends(get_admin)):
    """Recent server activity for debugging. Only ever contains what this app
    explicitly logs — IDs, roles, counts — never chat/character content, API
    keys, or endpoint URLs. See the _RingBufferHandler comment above for why
    raw request logs are deliberately excluded."""
    floor = _LOG_LEVELS.get(level.upper(), 20)
    entries = [e for e in _log_buffer.buffer if _LOG_LEVELS.get(e["level"], 20) >= floor]
    return {"logs": entries[-max(1, min(limit, 500)):]}

