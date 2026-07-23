import time
import secrets

from fastapi import HTTPException, Depends, Request, Response
from webauthn import (generate_registration_options, generate_authentication_options,
                      options_to_json, verify_registration_response,
                      verify_authentication_response)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, ResidentKeyRequirement,
                                      UserVerificationRequirement, PublicKeyCredentialDescriptor)

from backend.state import api, auth_router, CFG, log
from backend.auth import get_current_user, _issue_tokens, _set_auth_cookies
from backend.ratelimit import SlidingWindow
from backend.repositories import webauthn_credentials as cred_repo
from backend.repositories import users as user_repo
from backend.schemas import (WebauthnRegisterVerifyIn, WebauthnLoginVerifyIn,
                             PasskeyRequiredIn)

CHALLENGE_TTL = 300
_challenges: dict[str, tuple[bytes, str, str | None, float]] = {}
_LOGIN_CEREMONY_LIMIT = SlidingWindow(
    10, 60, "Too many passkey attempts - please wait a moment and try again")


def _store_challenge(challenge: bytes, purpose: str, user_id: str | None) -> str:
    now = time.time()
    for key in [k for k, v in _challenges.items() if v[3] < now]:
        _challenges.pop(key, None)
    challenge_id = secrets.token_urlsafe(24)
    _challenges[challenge_id] = (challenge, purpose, user_id, now + CHALLENGE_TTL)
    return challenge_id


def _take_challenge(challenge_id: str, purpose: str) -> tuple[bytes, str | None]:
    entry = _challenges.pop(challenge_id or "", None)
    if not entry or entry[1] != purpose or entry[3] < time.time():
        raise HTTPException(400, "Challenge expired - please try again")
    return entry[0], entry[2]


def _rp_id(request: Request) -> str:
    return (CFG.get("webauthn_rp_id") or "").strip() or request.url.hostname


def _expected_origin(request: Request) -> str:
    configured = (CFG.get("webauthn_origin") or "").strip()
    if configured:
        return configured
    port = f":{request.url.port}" if request.url.port else ""
    return f"{request.url.scheme}://{request.url.hostname}{port}"


@api.post("/auth/webauthn/register/options")
async def register_options(request: Request, current_user: dict = Depends(get_current_user)):
    existing = await cred_repo.list_for_user(current_user["id"])
    options = generate_registration_options(
        rp_id=_rp_id(request),
        rp_name="StoryHaven AI",
        user_id=current_user["id"].encode(),
        user_name=current_user["username"],
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["credential_id"]))
            for c in existing],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED))
    challenge_id = _store_challenge(options.challenge, "register", current_user["id"])
    log.info("webauthn: register options issued user=%s", current_user["username"])
    return {"challenge_id": challenge_id, "options": options_to_json(options)}


@api.post("/auth/webauthn/register/verify")
async def register_verify(body: WebauthnRegisterVerifyIn, request: Request,
                          current_user: dict = Depends(get_current_user)):
    challenge, user_id = _take_challenge(body.challenge_id, "register")
    if user_id != current_user["id"]:
        raise HTTPException(400, "Challenge does not belong to this session")
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=_rp_id(request),
            expected_origin=_expected_origin(request),
            require_user_verification=True)
    except Exception as e:
        log.warning("webauthn: registration verify failed user=%s: %s: %s",
                    current_user["username"], type(e).__name__, e)
        raise HTTPException(400, "Passkey registration could not be verified")
    if await cred_repo.get_by_credential_id(bytes_to_base64url(verified.credential_id)):
        raise HTTPException(400, "This passkey is already registered")
    cid = await cred_repo.create(
        current_user["id"],
        bytes_to_base64url(verified.credential_id),
        bytes_to_base64url(verified.credential_public_key),
        verified.sign_count,
        ",".join(body.transports or []),
        str(verified.aaguid or ""),
        (body.nickname or "").strip()[:60])
    return {"id": cid}


@auth_router.post("/webauthn/login/options")
async def login_options(request: Request):
    _LOGIN_CEREMONY_LIMIT.check_and_record(request.client.host if request.client else "unknown")
    options = generate_authentication_options(
        rp_id=_rp_id(request),
        user_verification=UserVerificationRequirement.REQUIRED)
    challenge_id = _store_challenge(options.challenge, "login", None)
    return {"challenge_id": challenge_id, "options": options_to_json(options)}


@auth_router.post("/webauthn/login/verify")
async def login_verify(body: WebauthnLoginVerifyIn, request: Request, response: Response):
    _LOGIN_CEREMONY_LIMIT.check_and_record(request.client.host if request.client else "unknown")
    challenge, _ = _take_challenge(body.challenge_id, "login")
    credential_id = body.credential.get("id") if isinstance(body.credential, dict) else None
    stored = await cred_repo.get_by_credential_id(credential_id or "")
    if not stored:
        log.warning("webauthn: login with unknown credential")
        raise HTTPException(401, "Passkey not recognized")
    user = await user_repo.get_user_by_id(stored["user_id"])
    if not user or user.get("status") != "active":
        raise HTTPException(403, "Account access denied")
    try:
        verified = verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=_rp_id(request),
            expected_origin=_expected_origin(request),
            credential_public_key=base64url_to_bytes(stored["public_key"]),
            credential_current_sign_count=stored["sign_count"],
            require_user_verification=True)
    except Exception as e:
        log.warning("webauthn: login verify failed user=%s: %s: %s",
                    user["username"], type(e).__name__, e)
        raise HTTPException(401, "Passkey could not be verified")
    if verified.new_sign_count and stored["sign_count"] and verified.new_sign_count <= stored["sign_count"]:
        log.warning("webauthn: sign count regression cred=%s user=%s (%s <= %s) - possible clone",
                    stored["id"], user["username"], verified.new_sign_count, stored["sign_count"])
    await cred_repo.mark_used(stored["id"], verified.new_sign_count)
    tokens = await _issue_tokens(user["id"])
    _set_auth_cookies(response, tokens["access_token"], tokens["refresh_token"],
                       secure=request.url.scheme == "https")
    log.info("webauthn: login username=%s user_id=%s cred=%s", user["username"], user["id"], stored["id"])
    return {"id": user["id"], "username": user["username"],
            "is_admin": bool(user.get("is_admin")),
            "nsfw_allowed": bool(user.get("nsfw_allowed")),
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "token_type": "bearer"}


@api.get("/me/passkeys")
async def list_passkeys(current_user: dict = Depends(get_current_user)):
    return [{"id": c["id"], "nickname": c["nickname"], "created": c["created"],
             "last_used": c["last_used"], "transports": c["transports"]}
            for c in await cred_repo.list_for_user(current_user["id"])]


@api.delete("/me/passkeys/{cid}")
async def delete_passkey(cid: str, current_user: dict = Depends(get_current_user)):
    user = await user_repo.get_user_by_id(current_user["id"])
    remaining = await cred_repo.count_for_user(current_user["id"])
    if user.get("passkey_required") and remaining <= 1:
        raise HTTPException(400, "Turn off the passkey requirement before removing your last passkey")
    if not await cred_repo.delete(cid, current_user["id"]):
        raise HTTPException(404, "Passkey not found")
    return {"deleted": True}


@api.put("/me/passkey-required")
async def set_passkey_required(body: PasskeyRequiredIn,
                               current_user: dict = Depends(get_current_user)):
    if body.value and await cred_repo.count_for_user(current_user["id"]) == 0:
        raise HTTPException(400, "Register a passkey first")
    await user_repo.set_passkey_required(current_user["id"], body.value)
    return {"passkey_required": body.value}
