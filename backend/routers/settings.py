import uuid

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
from backend.schemas import UserSettingsIn, SettingsIn, NsfwAllowedIn, ExperimentalFeaturesIn
from backend.prompt import DIRECTIVE_COMMANDS

def _scrub_api_key(overrides: dict) -> dict:
    out = dict(overrides)
    if "api_key" in out:
        out["has_api_key"] = bool(out.pop("api_key"))
    if "tts_api_key" in out:
        out["has_tts_api_key"] = bool(out.pop("tts_api_key"))
    return out

@api.get("/me/settings")
async def get_my_settings(current_user: dict = Depends(get_current_user)):
    user_settings_row = await user_repo.get_user_settings(current_user["id"])
    overrides = _scrub_api_key(user_settings_row)
    if isinstance(user_settings_row.get("own_chat_proxies"), list):
        overrides["own_chat_proxies"] = _scrub_proxies(user_settings_row["own_chat_proxies"])
    defaults = _scrub_api_key({k: CFG[k] for k in USER_CFG_KEYS if k in CFG})
    return {
        "overrides": overrides, "defaults": defaults, "has_override": bool(overrides),
        "global_chat_proxies": _scrub_proxies(CFG.get("chat_proxies", [])),
        "global_embed_proxies": _scrub_proxies(CFG.get("embed_proxies", [])),
    }

@api.put("/me/settings")
async def put_my_settings(body: UserSettingsIn,
                          current_user: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)

    if "base_url" in data and isinstance(data["base_url"], str) and not data["base_url"].strip():
        del data["base_url"]
    if "tts_base_url" in data and isinstance(data["tts_base_url"], str) and not data["tts_base_url"].strip():
        del data["tts_base_url"]

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
    if data.get("tts_base_url"):
        url = data["tts_base_url"].strip()
        issue = await _resolve_host_ip_issue(url, current_user.get("is_admin", False))
        if issue:
            raise HTTPException(400, f"That TTS endpoint couldn't be verified ({issue}). It has not been saved.")
    if "own_chat_proxies" in data and data["own_chat_proxies"] is not None:
        existing = await user_repo.get_user_settings(current_user["id"])
        existing_by_id = {p.get("id"): p.get("api_key", "") for p in existing.get("own_chat_proxies", [])}
        data["own_chat_proxies"] = [
            {**p, "api_key": p.get("api_key") or existing_by_id.get(p.get("id"), "")}
            for p in data["own_chat_proxies"]
        ]
        active = next((p for p in data["own_chat_proxies"] if p.get("active")), None)
        if active:
            ok, reason, detail = await _validate_chat_endpoint(active["base_url"], active["api_key"],
                                                                current_user.get("is_admin", False))
            if not ok:
                await flagged_endpoint_repo.create(current_user["id"], active["base_url"], active["api_key"] or "",
                                                   reason, detail)
                raise HTTPException(400, f"That endpoint couldn't be verified ({reason}) and has not been saved.")
            data["base_url"] = active["base_url"]
            data["api_key"] = active["api_key"]
            data["chat_model"] = active.get("model") or ""
        else:
            data["base_url"] = None
            data["api_key"] = None
            data["chat_model"] = None
    if data:
        await user_repo.set_user_settings(current_user["id"], data)
        log.info("settings: per-user endpoint override changed by=%s", current_user["username"])
    saved = await user_repo.get_user_settings(current_user["id"])
    overrides = _scrub_api_key(saved)
    if isinstance(saved.get("own_chat_proxies"), list):
        overrides["own_chat_proxies"] = _scrub_proxies(saved["own_chat_proxies"])
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

@api.put("/me/experimental-features")
async def put_my_experimental_features(body: ExperimentalFeaturesIn,
                                       current_user: dict = Depends(get_current_user)):
    user = await user_repo.set_user_experimental_features_enabled(current_user["id"], body.enabled)
    log.info("experimental features preference set: username=%s enabled=%s",
             current_user["username"], bool(user["experimental_features_enabled"]))
    return {"experimental_features_enabled": bool(user["experimental_features_enabled"])}

@api.get("/config")
async def config(_: dict = Depends(get_current_user)):
    return {"chat_model": CFG["chat_model"], "embed_model": CFG["embed_model"],
            "embed_dim": CFG["embed_dim"], "base_url": CFG["base_url"],
            "enable_thinking": CFG["enable_thinking"],
            "default_language": CFG.get("default_language") or "English",
            "directives": sorted(DIRECTIVE_COMMANDS - {"roll"}),
            "legacy_text_commands_supported": False}

def _scrub_model_request_hosts(hosts: list) -> list[dict]:
    return [{"host": h.get("host"), "has_api_key": bool(h.get("api_key"))} for h in hosts]

def _scrub_proxies(proxies: list) -> list[dict]:
    return [{"id": p.get("id"), "name": p.get("name"), "base_url": p.get("base_url"),
              "model": p.get("model"), "active": bool(p.get("active")),
              "icon_type": p.get("icon_type") or "favicon", "icon_value": p.get("icon_value") or "",
              "has_api_key": bool(p.get("api_key")), "priority": p.get("priority", 0)} for p in proxies]

def _scrub_provider_configs(configs: dict) -> dict:
    return {provider: {"url": cfg.get("url", ""), "model": cfg.get("model", ""),
                        "has_key": bool(cfg.get("key")),
                        "icon_type": cfg.get("icon_type") or "favicon", "icon_value": cfg.get("icon_value", "")}
            for provider, cfg in (configs or {}).items()}

async def _migrate_legacy_proxy(proxy_key: str, base_field: str, key_field: str, model_field: str):
    if CFG.get(proxy_key):
        return
    base_url = CFG.get(base_field)
    if not base_url:
        return
    profile = {
        "id": str(uuid.uuid4()),
        "name": "Default",
        "base_url": base_url,
        "api_key": CFG.get(key_field) or "",
        "model": CFG.get(model_field) or "",
        "active": True,
        "icon_type": "favicon",
        "icon_value": "",
    }
    CFG[proxy_key] = [profile]
    await global_settings_repo.set_settings({proxy_key: [profile]})
    log.info("settings: migrated legacy %s into a default proxy profile", base_field)

@api.get("/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    if current_user.get("is_admin"):
        await _migrate_legacy_proxy("chat_proxies", "base_url", "api_key", "chat_model")
        await _migrate_legacy_proxy("embed_proxies", "embed_base_url", "embed_api_key", "embed_model")
    out = {k: CFG[k] for k in PUBLIC_CFG_KEYS if k in CFG}
    out["model_request_hosts"] = _scrub_model_request_hosts(out.get("model_request_hosts", []))
    out["chat_proxies"] = _scrub_proxies(out.get("chat_proxies", []))
    out["embed_proxies"] = _scrub_proxies(out.get("embed_proxies", []))
    out["has_api_key"] = bool(CFG.get("api_key"))
    out["has_embed_api_key"] = bool(CFG.get("embed_api_key"))
    out["has_modal_shared_secret"] = bool(CFG.get("modal_shared_secret"))
    out["has_giphy_api_key"] = bool(CFG.get("giphy_api_key"))
    out["has_tenor_api_key"] = bool(CFG.get("tenor_api_key"))
    out["has_klipy_api_key"] = bool(CFG.get("klipy_api_key"))
    out["has_image_provider_key"] = bool(CFG.get("image_provider_key"))
    out["has_video_provider_key"] = bool(CFG.get("video_provider_key"))
    out["image_provider_configs"] = _scrub_provider_configs(CFG.get("image_provider_configs", {}))
    out["video_provider_configs"] = _scrub_provider_configs(CFG.get("video_provider_configs", {}))
    out["has_tts_api_key"] = bool(CFG.get("tts_api_key"))
    return out

@api.put("/settings")
async def put_settings(body: SettingsIn, current_user: dict = Depends(get_admin)):
    data = body.model_dump(exclude_none=True)
    if "image_provider" in data and data["image_provider"] not in ("comfyui", "openai", "stability", "novelai", "a1111"):
        raise HTTPException(400, "image_provider must be one of comfyui, openai, stability, novelai, a1111")
    if "video_provider" in data and data["video_provider"] not in ("comfyui", "gemini_veo", "qwen_wan", "openrouter"):
        raise HTTPException(400, "video_provider must be one of comfyui, gemini_veo, qwen_wan, openrouter")
    if "gif_provider" in data and data["gif_provider"] not in ("giphy", "tenor", "klipy"):
        raise HTTPException(400, "gif_provider must be one of giphy, tenor, klipy")
    changed_dim = "embed_dim" in data and data["embed_dim"] != CFG["embed_dim"]
    persist = {}
    _str_keys = {"chat_model", "embed_model", "base_url", "api_key", "embed_api_key", "embed_base_url",
                "modal_train_url", "modal_shared_secret", "modal_checkpoint_url",
                "gif_provider", "giphy_api_key", "tenor_api_key", "klipy_api_key", "klipy_customer_id",
                "image_provider", "image_provider_url", "image_provider_key", "image_provider_model",
                "video_provider", "video_provider_url", "video_provider_key", "video_provider_model",
                "tts_base_url", "tts_api_key", "tts_narrator_voice"}
    if "model_request_hosts" in data:
        existing_by_host = {e.get("host"): e.get("api_key", "")
                            for e in CFG.get("model_request_hosts", [])}
        data["model_request_hosts"] = [
            {"host": h["host"], "api_key": h.get("api_key") or existing_by_host.get(h["host"], "")}
            for h in data["model_request_hosts"]
        ]
    for proxy_key, base_field, key_field, model_field in (
        ("chat_proxies", "base_url", "api_key", "chat_model"),
        ("embed_proxies", "embed_base_url", "embed_api_key", "embed_model"),
    ):
        if proxy_key not in data:
            continue
        existing_by_id = {p.get("id"): p.get("api_key", "") for p in CFG.get(proxy_key, [])}
        data[proxy_key] = [
            {**p, "api_key": p.get("api_key") or existing_by_id.get(p.get("id"), "")}
            for p in data[proxy_key]
        ]
        active = next((p for p in data[proxy_key] if p.get("active")), None)
        if active:
            data[base_field] = active["base_url"]
            data[key_field] = active["api_key"]
            data[model_field] = active.get("model") or ""
    for configs_key, provider_field, url_field, key_field, model_field in (
        ("image_provider_configs", "image_provider", "image_provider_url", "image_provider_key", "image_provider_model"),
        ("video_provider_configs", "video_provider", "video_provider_url", "video_provider_key", "video_provider_model"),
    ):
        if configs_key not in data:
            continue
        existing_configs = CFG.get(configs_key, {})
        merged = {}
        for provider, cfg in data[configs_key].items():
            existing = existing_configs.get(provider, {})
            merged[provider] = {
                "url": cfg.get("url", ""),
                "model": cfg.get("model", ""),
                "key": cfg.get("key") or existing.get("key", ""),
                "icon_type": cfg.get("icon_type") or "favicon",
                "icon_value": cfg.get("icon_value", ""),
            }
        data[configs_key] = merged
        active_provider = data.get(provider_field, CFG.get(provider_field, "comfyui"))
        active_config = merged.get(active_provider, {})
        data[url_field] = active_config.get("url", "")
        data[key_field] = active_config.get("key", "")
        data[model_field] = active_config.get("model", "")
    for k, v in data.items():
        if isinstance(v, str) and k in _str_keys:
            v = v.strip()
            if not v and k in ("chat_model", "embed_model", "base_url", "embed_base_url", "tts_base_url"):
                continue
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
    out["chat_proxies"] = _scrub_proxies(out.get("chat_proxies", []))
    out["embed_proxies"] = _scrub_proxies(out.get("embed_proxies", []))
    out["has_api_key"] = bool(CFG.get("api_key"))
    out["has_embed_api_key"] = bool(CFG.get("embed_api_key"))
    out["has_modal_shared_secret"] = bool(CFG.get("modal_shared_secret"))
    out["has_giphy_api_key"] = bool(CFG.get("giphy_api_key"))
    out["has_tenor_api_key"] = bool(CFG.get("tenor_api_key"))
    out["has_klipy_api_key"] = bool(CFG.get("klipy_api_key"))
    out["has_image_provider_key"] = bool(CFG.get("image_provider_key"))
    out["has_video_provider_key"] = bool(CFG.get("video_provider_key"))
    out["image_provider_configs"] = _scrub_provider_configs(CFG.get("image_provider_configs", {}))
    out["video_provider_configs"] = _scrub_provider_configs(CFG.get("video_provider_configs", {}))
    out["has_tts_api_key"] = bool(CFG.get("tts_api_key"))
    out["reindexed"] = changed_dim
    return out

@api.get("/models")
async def models(base_url: str | None = None, api_key: str | None = None,
                 current_user: dict = Depends(get_current_user)):

    if base_url:
        issue = await _resolve_host_ip_issue(base_url, current_user.get("is_admin", False))
        if issue:
            raise HTTPException(400, f"refusing to query that endpoint: {issue}")
    try:
        return {"models": await llm.list_models(base_url=base_url, api_key=api_key, pin_host=bool(base_url),
                                                is_admin=current_user.get("is_admin", False))}
    except Exception as e:
        raise HTTPException(502, f"could not reach model server: {e}")

