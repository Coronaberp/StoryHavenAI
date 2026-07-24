import base64
import hashlib
import secrets
import time

import httpx
from fastapi import HTTPException, Depends, Request
from fastapi.responses import RedirectResponse

from backend.state import api, auth_router, log
from backend.auth import get_admin, get_current_user, _free_guest_username, _issue_tokens, _set_auth_cookies
from backend.oauth_registry import PROVIDER_REGISTRY, extract_user_id
from backend.repositories import oauth_providers as provider_repo
from backend.repositories import oauth_identities as identity_repo
from backend.repositories import oauth_pending as pending_repo
from backend.repositories import users as user_repo
from backend.repositories import webauthn_credentials as webauthn_credential_repo
from backend.schemas import OauthProvidersPutIn

@api.get("/admin/oauth-providers")
async def admin_list_oauth_providers(current_user: dict = Depends(get_admin)):
    configured = {row["provider"]: row for row in await provider_repo.list_all()}
    out = []
    for name, entry in PROVIDER_REGISTRY.items():
        row = configured.get(name)
        out.append({
            "provider": name,
            "label": entry["label"],
            "protocol": entry["protocol"],
            "client_id": row["client_id"] if row else "",
            "has_client_secret": bool(row and row["client_secret"]),
            "enabled": bool(row and row["enabled"]),
        })
    return {"providers": out}

@api.put("/admin/oauth-providers")
async def admin_put_oauth_providers(body: OauthProvidersPutIn,
                                    current_user: dict = Depends(get_admin)):
    unknown = set(body.providers) - set(PROVIDER_REGISTRY)
    if unknown:
        raise HTTPException(400, f"Unknown provider(s): {', '.join(sorted(unknown))}")
    for name, provider_config in body.providers.items():
        await provider_repo.upsert(name, provider_config.client_id,
                                   provider_config.client_secret, provider_config.enabled)
    log.info("admin: oauth providers updated by=%s providers=%s",
             current_user["username"], ",".join(sorted(body.providers)))
    return {"ok": True}

OAUTH_STATE_TTL_SECONDS = 300
SUPPORTED_PROTOCOLS = {"oauth2"}

@auth_router.get("/oauth/providers")
async def list_public_oauth_providers():
    rows = await provider_repo.list_enabled()
    return {"providers": [
        {"provider": r["provider"], "label": PROVIDER_REGISTRY[r["provider"]]["label"]}
        for r in rows if r["provider"] in PROVIDER_REGISTRY
        and PROVIDER_REGISTRY[r["provider"]]["protocol"] in SUPPORTED_PROTOCOLS]}

def _origin(request: Request) -> str:
    port = f":{request.url.port}" if request.url.port else ""
    return f"{request.url.scheme}://{request.url.hostname}{port}"

def _callback_url(request: Request, provider: str) -> str:
    return f"{_origin(request)}/api/auth/oauth/{provider}/callback"

async def _start_oauth_flow(request: Request, provider: str, mode: str,
                            user_id: str | None) -> RedirectResponse:
    entry = PROVIDER_REGISTRY.get(provider)
    if not entry:
        raise HTTPException(404, "Unknown provider")
    if entry["protocol"] not in SUPPORTED_PROTOCOLS:
        log.warning("oauth: start refused, protocol not implemented provider=%s protocol=%s",
                    provider, entry["protocol"])
        raise HTTPException(404, "Provider not supported")
    configured = await provider_repo.get(provider)
    if not configured or not configured["enabled"] or not configured["client_id"] or not configured["client_secret"]:
        raise HTTPException(404, "Provider not configured")
    state = secrets.token_urlsafe(32)
    code_verifier = None
    params = {
        "client_id": configured["client_id"],
        "redirect_uri": _callback_url(request, provider),
        "state": state,
        "scope": entry["scope"],
        "response_type": "code",
    }
    if entry.get("pkce"):
        code_verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()).decode().rstrip("=")
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
    await pending_repo.create(state, provider, mode, user_id, code_verifier)
    query = str(httpx.QueryParams(params))
    log.info("oauth: start provider=%s mode=%s", provider, mode)
    return RedirectResponse(url=f"{entry['authorize_url']}?{query}", status_code=307)

@auth_router.get("/oauth/{provider}/start")
async def start_oauth(request: Request, provider: str):
    return await _start_oauth_flow(request, provider, "login", None)

async def _exchange_code_for_token(request: Request, provider: str, entry: dict, code: str,
                                   code_verifier: str | None) -> str:
    configured = await provider_repo.get(provider)
    data = {
        "code": code,
        "redirect_uri": _callback_url(request, provider),
        "grant_type": "authorization_code",
    }
    basic_auth = None
    if entry.get("token_basic_auth"):
        basic_auth = (configured["client_id"], configured["client_secret"])
    else:
        data["client_id"] = configured["client_id"]
        data["client_secret"] = configured["client_secret"]
    if code_verifier:
        data["code_verifier"] = code_verifier
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(entry["token_url"], data=data, auth=basic_auth,
                                 headers={"Accept": "application/json"})
        resp.raise_for_status()
        payload = resp.json()
    return payload["access_token"]

async def _fetch_identity(provider: str, entry: dict, access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(entry["userinfo_url"],
                                headers={"Authorization": f"Bearer {access_token}"})
        resp.raise_for_status()
        return resp.json()

_LOGIN_ERROR_REDIRECT = "/login?oauth_error=1"
_LINK_ERROR_REDIRECT = "/settings-account?oauth_error=1"
_LINK_SUCCESS_REDIRECT = "/settings-account?oauth_linked=1"
_LOGIN_SUCCESS_REDIRECT = "/"

@auth_router.get("/oauth/{provider}/callback")
async def oauth_callback(request: Request, provider: str, code: str, state: str):
    entry = PROVIDER_REGISTRY.get(provider)
    if not entry:
        raise HTTPException(404, "Unknown provider")
    pending = await pending_repo.consume(state)
    if not pending or pending["provider"] != provider:
        log.warning("oauth: callback with unknown/expired state provider=%s", provider)
        return RedirectResponse(url=_LOGIN_ERROR_REDIRECT, status_code=302)
    error_redirect = _LINK_ERROR_REDIRECT if pending["mode"] == "link" else _LOGIN_ERROR_REDIRECT
    if time.time() - pending["created"] > OAUTH_STATE_TTL_SECONDS:
        log.warning("oauth: callback with expired state provider=%s", provider)
        return RedirectResponse(url=error_redirect, status_code=302)

    try:
        access_token = await _exchange_code_for_token(
            request, provider, entry, code, pending["code_verifier"])
        payload = await _fetch_identity(provider, entry, access_token)
    except Exception as e:
        log.error("oauth: callback failed provider=%s: %s: %s", provider, type(e).__name__, e)
        return RedirectResponse(url=error_redirect, status_code=302)

    provider_user_id = extract_user_id(provider, payload)
    if not provider_user_id:
        log.error("oauth: no user id in callback payload provider=%s", provider)
        return RedirectResponse(url=error_redirect, status_code=302)
    display_name = ""
    field = entry.get("display_name_field")
    if field:
        value = payload
        for part in field.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        display_name = str(value) if value else ""

    if pending["mode"] == "link":
        existing = await identity_repo.get_by_provider_identity(provider, provider_user_id)
        if existing and existing["user_id"] != pending["user_id"]:
            log.warning("oauth: link failed, identity already linked to another user provider=%s", provider)
            return RedirectResponse(url=_LINK_ERROR_REDIRECT, status_code=302)
        if not existing:
            await identity_repo.create(provider, provider_user_id, pending["user_id"], display_name)
        log.info("oauth: linked provider=%s user=%s", provider, pending["user_id"])
        return RedirectResponse(url=_LINK_SUCCESS_REDIRECT, status_code=302)

    identity = await identity_repo.get_by_provider_identity(provider, provider_user_id)
    if identity:
        user = await user_repo.get_user_by_id(identity["user_id"])
        if not user or user.get("status") != "active":
            log.warning("oauth: login blocked, account not active provider=%s user=%s",
                        provider, identity["user_id"])
            return RedirectResponse(url=_LOGIN_ERROR_REDIRECT, status_code=302)
        if user.get("passkey_required"):
            log.warning("oauth: login blocked, account requires passkey provider=%s user=%s",
                        provider, identity["user_id"])
            return RedirectResponse(url=_LOGIN_ERROR_REDIRECT, status_code=302)
    else:
        username = await _free_guest_username()
        random_password = secrets.token_urlsafe(32)
        user = await user_repo.create_user(username, random_password, status="active", tier="guest")
        await identity_repo.create(provider, provider_user_id, user["id"], display_name)
        log.info("oauth: created guest account provider=%s user=%s", provider, user["id"])

    tokens = await _issue_tokens(user["id"])
    redirect = RedirectResponse(url=_LOGIN_SUCCESS_REDIRECT, status_code=302)
    _set_auth_cookies(redirect, tokens["access_token"], tokens["refresh_token"],
                      secure=request.url.scheme == "https")
    log.info("oauth: login provider=%s user=%s", provider, user["id"])
    return redirect

@auth_router.get("/oauth/{provider}/start-link")
async def start_oauth_link(request: Request, provider: str, current_user: dict = Depends(get_current_user)):
    if not current_user.get("id"):
        raise HTTPException(401, "Not authenticated")
    return await _start_oauth_flow(request, provider, "link", current_user["id"])

@api.get("/me/oauth-identities")
async def list_my_oauth_identities(current_user: dict = Depends(get_current_user)):
    rows = await identity_repo.list_for_user(current_user["id"])
    return [{"id": r["id"], "provider": r["provider"],
             "label": PROVIDER_REGISTRY.get(r["provider"], {}).get("label", r["provider"]),
             "display_name": r["display_name"], "created": r["created"]}
            for r in rows]

@api.delete("/me/oauth-identities/{iid}")
async def unlink_oauth_identity(iid: str, current_user: dict = Depends(get_current_user)):
    identities = await identity_repo.list_for_user(current_user["id"])
    target = next((i for i in identities if i["id"] == iid), None)
    if not target:
        raise HTTPException(404, "Connected account not found")
    if len(identities) <= 1:
        user = await user_repo.get_user_by_id(current_user["id"])
        has_real_password = bool(user) and user.get("tier") != "guest"
        has_passkey = await webauthn_credential_repo.count_for_user(current_user["id"]) > 0
        if not has_real_password and not has_passkey:
            log.warning("oauth: unlink blocked, would lock out account user=%s", current_user["id"])
            raise HTTPException(409, "This is your only way to sign in, so set a password before disconnecting it")
    if not await identity_repo.delete(iid, current_user["id"]):
        raise HTTPException(404, "Connected account not found")
    return {"deleted": True}
