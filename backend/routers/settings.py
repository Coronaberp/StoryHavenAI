"""Per-user settings, global settings (admin), config, and models routes."""
from fastapi import HTTPException, Depends

from backend import db
from backend.repositories import notifications as notification_repo
from backend import vectors
from backend import llm
from backend.state import api, CFG, PUBLIC_CFG_KEYS, USER_CFG_KEYS, apply_llm_config, log
from backend.auth import get_current_user, get_admin
from backend.ssrf import _validate_chat_endpoint, _resolve_host_ip_issue
from backend.repositories import flagged_endpoints as flagged_endpoint_repo
from backend.repositories import users as user_repo
from backend.repositories import settings as global_settings_repo
from backend.schemas import UserSettingsIn, SettingsIn, NsfwAllowedIn

def _scrub_api_key(overrides: dict) -> dict:
    """api_key is write-only by design — never echo the plaintext value back
    over the wire, even to the owning user (it's still in the response body/
    devtools otherwise). Replace it with a has_api_key boolean instead."""
    out = dict(overrides)
    if "api_key" in out:
        out["has_api_key"] = bool(out.pop("api_key"))
    return out


@api.get("/me/settings")
async def get_my_settings(current_user: dict = Depends(get_current_user)):
    overrides = _scrub_api_key(await user_repo.get_user_settings(current_user["id"]))
    defaults = {k: CFG[k] for k in USER_CFG_KEYS if k in CFG}
    return {"overrides": overrides, "defaults": defaults, "has_override": bool(overrides)}


@api.put("/me/settings")
async def put_my_settings(body: UserSettingsIn,
                          current_user: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    # Strip an empty base_url so it doesn't shadow the global one
    if "base_url" in data and isinstance(data["base_url"], str) and not data["base_url"].strip():
        del data["base_url"]
    # Bring-your-own chat endpoint only ever takes effect after it passes the
    # SSRF guard — a failure doesn't just error, it's logged for admin review.
    # base_url can be None here (clearing the override, e.g. "use own
    # endpoint" toggled off) rather than a string to validate — only run the
    # guard when there's an actual URL being set.
    if data.get("base_url"):
        url = data["base_url"].strip()
        key = data.get("api_key") or (await user_repo.get_user_settings(current_user["id"])).get("api_key")
        ok, reason, detail = await _validate_chat_endpoint(url, key, current_user.get("is_admin", False))
        if not ok:
            await flagged_endpoint_repo.create(current_user["id"], url, key or "", reason, detail)
            await notification_repo.notify_admins(
                "admin_flagged_endpoint",
                f"Flagged endpoint: {current_user['username']}",
                f"{current_user['username']}'s endpoint {url} failed verification ({reason}).",
                "/admin", related_id=f"{current_user['id']}:{url}",
                exclude_user_id=current_user["id"])
            raise HTTPException(400, f"That endpoint couldn't be verified ({reason}) and has been "
                                      "flagged for admin review. It has not been saved.")
    if data:
        await user_repo.set_user_settings(current_user["id"], data)
        log.info("settings: per-user endpoint override changed by=%s", current_user["username"])
    overrides = _scrub_api_key(await user_repo.get_user_settings(current_user["id"]))
    return {"overrides": overrides, "has_override": bool(overrides)}


@api.delete("/me/settings")
async def delete_my_settings(current_user: dict = Depends(get_current_user)):
    await user_repo.clear_user_settings(current_user["id"])
    log.info("settings: per-user endpoint override cleared by=%s", current_user["username"])
    return {"cleared": True}


@api.put("/me/nsfw")
async def put_my_nsfw(body: NsfwAllowedIn,
                      current_user: dict = Depends(get_current_user)):
    user = await user_repo.set_user_nsfw_allowed(current_user["id"], body.allowed)
    log.info("nsfw preference set: username=%s allowed=%s", current_user["username"], bool(user["nsfw_allowed"]))
    return {"nsfw_allowed": bool(user["nsfw_allowed"])}


# ----------------------------------------------------------------------------
# Global settings (admin only)
# ----------------------------------------------------------------------------
@api.get("/config")
async def config(_: dict = Depends(get_current_user)):
    return {"chat_model": CFG["chat_model"], "embed_model": CFG["embed_model"],
            "embed_dim": CFG["embed_dim"], "base_url": CFG["base_url"],
            "enable_thinking": CFG["enable_thinking"],
            "default_language": CFG.get("default_language") or "English"}


def _scrub_model_request_hosts(hosts: list) -> list[dict]:
    return [{"host": h.get("host"), "has_api_key": bool(h.get("api_key"))} for h in hosts]


@api.get("/settings")
async def get_settings(_: dict = Depends(get_current_user)):
    out = {k: CFG[k] for k in PUBLIC_CFG_KEYS if k in CFG}
    out["model_request_hosts"] = _scrub_model_request_hosts(out.get("model_request_hosts", []))
    out["has_api_key"] = bool(CFG.get("api_key"))
    out["has_embed_api_key"] = bool(CFG.get("embed_api_key"))
    out["has_modal_shared_secret"] = bool(CFG.get("modal_shared_secret"))
    return out


@api.put("/settings")
async def put_settings(body: SettingsIn, current_user: dict = Depends(get_admin)):
    data = body.model_dump(exclude_none=True)
    changed_dim = "embed_dim" in data and data["embed_dim"] != CFG["embed_dim"]
    persist = {}
    _str_keys = {"chat_model", "embed_model", "base_url", "api_key", "embed_api_key", "embed_base_url",
                "modal_train_url", "modal_shared_secret", "modal_checkpoint_url"}
    if "model_request_hosts" in data:
        existing_by_host = {e.get("host"): e.get("api_key", "")
                            for e in CFG.get("model_request_hosts", [])}
        data["model_request_hosts"] = [
            {"host": h["host"], "api_key": h.get("api_key") or existing_by_host.get(h["host"], "")}
            for h in data["model_request_hosts"]
        ]
    for k, v in data.items():
        if isinstance(v, str) and k in _str_keys:
            v = v.strip()
            if not v and k in ("chat_model", "embed_model", "base_url", "embed_base_url"):
                continue  # never overwrite with empty string — would break the LLM client
        if k == "embed_base_url" and isinstance(v, str) and v:
            v = llm._mk_root_embed(v)
        CFG[k] = v
        persist[k] = v
    await global_settings_repo.set_settings(persist)
    apply_llm_config()
    log.info("admin: global settings changed by=%s keys=%s", current_user["username"],
             ",".join(sorted(persist.keys())) or "(none)")
    if changed_dim:
        try:
            await vectors.reset_indexes(CFG["embed_dim"])
        except Exception as e:
            log.warning("admin: embed reindex failed after dim change by=%s: %s: %s",
                        current_user["username"], type(e).__name__, e)
    out = {k: CFG[k] for k in PUBLIC_CFG_KEYS if k in CFG}
    out["model_request_hosts"] = _scrub_model_request_hosts(out.get("model_request_hosts", []))
    out["has_api_key"] = bool(CFG.get("api_key"))
    out["has_embed_api_key"] = bool(CFG.get("embed_api_key"))
    out["has_modal_shared_secret"] = bool(CFG.get("modal_shared_secret"))
    out["reindexed"] = changed_dim
    return out


@api.get("/models")
async def models(base_url: str | None = None, api_key: str | None = None,
                 current_user: dict = Depends(get_current_user)):
    # This convenience "test connection" endpoint must carry the same SSRF
    # guard as PUT /me/settings — otherwise it's a bypass of that guard,
    # letting any logged-in user probe the internal network via base_url.
    # Admins are exempt (same as everywhere else this guard runs) since
    # they're trusted to point at internal infra like llamacpp-chat.
    if base_url:
        issue = await _resolve_host_ip_issue(base_url, current_user.get("is_admin", False))
        if issue:
            raise HTTPException(400, f"refusing to query that endpoint: {issue}")
    try:
        return {"models": await llm.list_models(base_url=base_url, api_key=api_key)}
    except Exception as e:
        raise HTTPException(502, f"could not reach model server: {e}")

