"""Authentication: JWT access/refresh tokens (whitelisted in the DB), user
dependencies, login throttle, and the public /api/auth routes."""
import re
import secrets
import time

import jwt
import pyotp
from fastapi import HTTPException, Request, Response, Depends

from backend import db
from backend.repositories import notifications as notification_repo
from backend.state import ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, auth_router, log
from backend.schemas import (
    LoginIn, PasswordChangeIn, PasswordResetRequestIn, TotpEnableIn, TotpDisableIn,
    TotpPasswordResetIn, TotpLoginEnforcementIn, TotpProvisionIn, RegisterIn,
)
from backend.ratelimit import SlidingWindow
from backend.repositories import users as user_repo

TOTP_ISSUER = "StoryHaven AI"
JWT_ALG = "HS256"

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def normalize_username(raw: str) -> str:
    """Usernames are letters/numbers/underscore/hyphen only — spaces are
    silently folded to hyphens (so "John Doe" -> "John-Doe" instead of being
    rejected outright) but anything else illegal (commas, punctuation, emoji,
    etc.) is a hard error, not silently stripped."""
    name = re.sub(r"\s+", "-", (raw or "").strip())
    if not name or not _USERNAME_RE.match(name):
        raise HTTPException(400,
            "Usernames can only contain letters, numbers, underscores, and hyphens.")
    return name


def _encode_token(user_id: str, jti: str, token_type: str, ttl: int) -> str:
    now = int(time.time())
    return jwt.encode({
        "sub": user_id, "jti": jti, "type": token_type,
        "iat": now, "exp": now + ttl,
    }, db.get_jwt_secret(), algorithm=JWT_ALG)


def _decode_token(token: str, expected_type: str) -> dict | None:
    try:
        claims = jwt.decode(token, db.get_jwt_secret(), algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    if claims.get("type") != expected_type:
        return None
    return claims


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[len("Bearer "):].strip()
    return None


async def _issue_tokens(user_id: str) -> dict:
    access_jti = secrets.token_hex(16)
    refresh_jti = secrets.token_hex(16)
    access_token = _encode_token(user_id, access_jti, "access", db.ACCESS_TOKEN_TTL)
    refresh_token = _encode_token(user_id, refresh_jti, "refresh", db.REFRESH_TOKEN_TTL)
    await user_repo.whitelist_access_token(access_jti, user_id)
    await user_repo.whitelist_refresh_token(refresh_jti, user_id)
    return {
        "access_token": access_token, "access_jti": access_jti,
        "refresh_token": refresh_token, "refresh_jti": refresh_jti,
    }


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str,
                       secure: bool = True):
    response.set_cookie(
        key=ACCESS_COOKIE_NAME, value=access_token, max_age=db.ACCESS_TOKEN_TTL,
        httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie(
        key=REFRESH_COOKIE_NAME, value=refresh_token, max_age=db.REFRESH_TOKEN_TTL,
        httponly=True, secure=secure, samesite="lax", path="/api/auth")


def _clear_auth_cookies(response: Response):
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/")
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api/auth")


async def _resolve_access_claims(request: Request) -> dict | None:
    token = _bearer_token(request) or request.cookies.get(ACCESS_COOKIE_NAME)
    if not token:
        return None
    claims = _decode_token(token, "access")
    if not claims:
        return None
    if not await user_repo.access_token_valid(claims["jti"], claims["sub"]):
        return None
    return claims


async def get_current_user(request: Request) -> dict:
    claims = await _resolve_access_claims(request)
    if not claims:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await user_repo.get_user_by_id(claims["sub"])
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return user


async def get_current_user_optional(request: Request) -> dict | None:
    """Same as get_current_user but returns None instead of 401 — for the
    handful of read-only public/community endpoints that anonymous visitors
    (the /explore mode) may hit without ever having signed in."""
    claims = await _resolve_access_claims(request)
    if not claims:
        return None
    user = await user_repo.get_user_by_id(claims["sub"])
    if not user or user.get("status") != "active":
        return None
    return user


async def get_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def get_dev(current_user: dict = Depends(get_admin)) -> dict:
    """The Dev tier: one step above admin, for the platform's own operator.
    Sees raw model-request download material (curl commands, API keys) that
    even other admins don't, and can grant/revoke Dev status on other admins."""
    if current_user.get("role") != "dev":
        raise HTTPException(status_code=403, detail="Dev access required")
    return current_user


# Simple dependency-free login throttle: failed attempts per (client_ip, username)
# with timestamps, rejected after _LOGIN_MAX_ATTEMPTS within _LOGIN_WINDOW seconds.
# Cleared on a successful login; stale entries pruned by the session-cleanup loop.
_FAILED_LOGINS: dict[tuple[str, str], list[float]] = {}
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW = 300


def _client_ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers --forwarded-allow-ips='*', so it already
    # rewrites request.client.host from cloudflared's X-Forwarded-For — this is
    # the real client IP, not the tunnel's. No manual header parsing needed here.
    return request.client.host if request.client else "unknown"


# Per-IP-only spray guard (any username): looser than the per-(ip,username) limit
# above so a shared NAT/household with several real users mistyping passwords isn't
# blocked, but an actual password-spray across many usernames from one IP is.
_LOGIN_IP_SPRAY = SlidingWindow(
    20, 300, "Too many failed attempts from your network — try again in a few minutes")

# Per-IP registration throttle (any outcome — success or validation failure counts),
# so one IP can't mass-create pending accounts. Generous enough for a shared office/
# household to sign up a few people; tight enough to stop automated spam.
_REGISTRATIONS = SlidingWindow(
    5, 3600, "Too many sign-ups from your network — try again later")

# Per-(ip,username) TOTP attempt guard: a 6-digit code has a far smaller search
# space than a password, so it needs its own tight limit even though the request
# already passed password verification.
_TOTP_ATTEMPTS = SlidingWindow(
    8, 300, "Too many verification code attempts — try again in a few minutes")

# Per-IP guard on secret generation ahead of registration — nothing is persisted
# by /totp/provision itself, but it's still cheap to hammer, so it gets its own
# throttle rather than riding on _REGISTRATIONS (which only counts actual signups).
_TOTP_PROVISIONS = SlidingWindow(
    5, 3600, "Too many verification setups from your network — try again later")


def _login_rate_check(ip: str, username: str):
    _LOGIN_IP_SPRAY.check(ip)
    key = (ip, username.lower())
    now = time.time()
    attempts = [t for t in _FAILED_LOGINS.get(key, []) if now - t < _LOGIN_WINDOW]
    if attempts:
        _FAILED_LOGINS[key] = attempts
    else:
        _FAILED_LOGINS.pop(key, None)
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many failed attempts — try again in a few minutes")


def _login_record_failure(ip: str, username: str):
    _FAILED_LOGINS.setdefault((ip, username.lower()), []).append(time.time())
    _LOGIN_IP_SPRAY.record(ip)


def _login_clear(ip: str, username: str):
    _FAILED_LOGINS.pop((ip, username.lower()), None)


def _prune_login_attempts():
    now = time.time()
    for key in list(_FAILED_LOGINS):
        fresh = [t for t in _FAILED_LOGINS[key] if now - t < _LOGIN_WINDOW]
        if fresh:
            _FAILED_LOGINS[key] = fresh
        else:
            del _FAILED_LOGINS[key]
    _LOGIN_IP_SPRAY.prune()
    _REGISTRATIONS.prune()
    _TOTP_ATTEMPTS.prune()
    _TOTP_PROVISIONS.prune()


def _totp_label(raw: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", (raw or "").strip())
    return cleaned[:32] or "account"


@auth_router.post("/totp/provision")
async def totp_provision(body: TotpProvisionIn, request: Request):
    ip = _client_ip(request)
    _TOTP_PROVISIONS.check(ip)
    _TOTP_PROVISIONS.record(ip)
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=normalize_username(body.username), issuer_name=TOTP_ISSUER)
    log.info("totp provisioned for pending registration: username=%s", normalize_username(body.username))
    return {"secret": secret, "otpauth_uri": uri}


@auth_router.post("/register")
async def register(body: RegisterIn, request: Request):
    ip = _client_ip(request)
    _REGISTRATIONS.check(ip)
    _REGISTRATIONS.record(ip)
    username = normalize_username(body.username)
    _login_rate_check(ip, username)
    if len(username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    existing = await user_repo.get_user_by_username(username)
    if existing:
        _login_record_failure(ip, username)
        raise HTTPException(400, "Username already taken")
    _TOTP_ATTEMPTS.check(f"{ip}:{username}")
    try:
        totp_ok = pyotp.TOTP(body.totp_secret).verify(body.totp_code, valid_window=1)
    except Exception:
        log.warning("registration failed: username=%s reason=malformed_totp_secret", username)
        raise HTTPException(400, "Authenticator setup expired — restart the onboarding flow")
    if not totp_ok:
        _TOTP_ATTEMPTS.record(f"{ip}:{username}")
        log.warning("registration failed: username=%s reason=invalid_totp", username)
        raise HTTPException(400, "Invalid verification code — check your authenticator app and try again")
    backup_codes = _generate_backup_codes()
    await user_repo.create_user(
        username, body.password, status="pending",
        totp_secret=body.totp_secret, totp_backup_codes=backup_codes,
        totp_enabled=True, totp_login_required=True)
    await notification_repo.notify_admins(
        "admin_signup", f"New signup: {username}",
        f"{username} registered and is awaiting approval.", "/admin")
    log.info("registration: username=%s status=pending totp_enabled=True", username)
    return {"ok": True, "pending": True, "backup_codes": backup_codes}


_RESET_REQUESTS: dict[str, list[float]] = {}
_RESET_MAX_ATTEMPTS = 5
_RESET_WINDOW = 300

_RESET_GENERIC = "If that account exists, an admin will review your request."


def _reset_rate_check(ip: str):
    now = time.time()
    attempts = [t for t in _RESET_REQUESTS.get(ip, []) if now - t < _RESET_WINDOW]
    if attempts:
        _RESET_REQUESTS[ip] = attempts
    else:
        _RESET_REQUESTS.pop(ip, None)
    if len(attempts) >= _RESET_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many requests — try again in a few minutes")


def _reset_record(ip: str):
    _RESET_REQUESTS.setdefault(ip, []).append(time.time())


@auth_router.post("/request-password-reset")
async def request_password_reset(body: PasswordResetRequestIn, request: Request):
    ip = _client_ip(request)
    _reset_rate_check(ip)
    _reset_record(ip)
    user_row = await user_repo.get_user_by_username(body.username)
    if user_row:
        await db.create_password_reset_request(user_row["id"], user_row["username"])
        await notification_repo.notify_admins(
            "admin_reset", f"Password reset: {user_row['username']}",
            f"{user_row['username']} requested a password reset.", "/admin")
        log.info("password reset requested: username=%s", user_row["username"])
    return {"ok": True, "message": _RESET_GENERIC}


async def _verify_totp(user_row: dict, code: str | None) -> bool:
    if not code:
        return False
    secret = db._decrypt_secret(user_row.get("totp_secret") or "")
    if secret and pyotp.TOTP(secret).verify(code, valid_window=1):
        return True
    return await user_repo.consume_totp_backup_code(user_row["id"], code.strip())


_TOTP_RESET_GENERIC = "Two-factor recovery is not available for this account, or the code was invalid."


@auth_router.post("/password-reset/totp")
async def totp_password_reset(body: TotpPasswordResetIn, request: Request):
    """Self-service account recovery: proving control of a TOTP device/backup
    code resets the password directly, no admin approval needed — distinct
    from /request-password-reset (admin-mediated, for accounts without TOTP)."""
    ip = _client_ip(request)
    username = normalize_username(body.username)
    _reset_rate_check(ip)
    _TOTP_ATTEMPTS.check(f"{ip}:{username}")
    user_row = await user_repo.get_user_by_username(username)
    if not user_row or not user_row.get("totp_enabled"):
        _reset_record(ip)
        _TOTP_ATTEMPTS.record(f"{ip}:{username}")
        log.warning("totp password reset failed: username=%s reason=no_totp", username)
        raise HTTPException(400, _TOTP_RESET_GENERIC)
    if not await _verify_totp(user_row, body.code):
        _reset_record(ip)
        _TOTP_ATTEMPTS.record(f"{ip}:{username}")
        log.warning("totp password reset failed: username=%s reason=invalid_code", username)
        raise HTTPException(400, _TOTP_RESET_GENERIC)
    await user_repo.update_user_password(user_row["id"], body.new_password)
    await user_repo.revoke_user_tokens(user_row["id"])
    log.info("password reset via totp: username=%s user_id=%s", username, user_row["id"])
    return {"ok": True}


@auth_router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    ip = _client_ip(request)
    username = normalize_username(body.username)
    _login_rate_check(ip, username)
    user_row = await user_repo.get_user_by_username(username)
    if not user_row or not db.verify_password(body.password, user_row["password_hash"]):
        _login_record_failure(ip, username)
        log.warning("login failed: username=%s reason=invalid_credentials", username)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if user_row.get("totp_login_required"):
        _TOTP_ATTEMPTS.check(f"{ip}:{username}")
        if not body.totp_code:
            raise HTTPException(status_code=401, detail={"code": "totp_required"})
        if not await _verify_totp(user_row, body.totp_code):
            _TOTP_ATTEMPTS.record(f"{ip}:{username}")
            log.warning("login failed: username=%s reason=invalid_totp", username)
            raise HTTPException(status_code=401, detail={"code": "totp_invalid"})
    status = user_row.get("status", "active")
    if status == "pending":
        log.warning("login failed: username=%s reason=pending_approval", username)
        raise HTTPException(status_code=403, detail="Account pending admin approval")
    if status == "suspended":
        log.warning("login failed: username=%s reason=suspended", username)
        raise HTTPException(status_code=403, detail={
            "code": "suspended",
            "reason": db._decrypt_secret(user_row.get("suspension_reason") or "") or None})
    if status != "active":
        log.warning("login failed: username=%s reason=account_%s", username, status)
        raise HTTPException(status_code=403, detail="Account access denied")
    _login_clear(ip, username)
    tokens = await _issue_tokens(user_row["id"])
    # request.url.scheme correctly reports "https" behind the Cloudflare tunnel
    # (uvicorn is started with --proxy-headers --forwarded-allow-ips='*', so it
    # trusts X-Forwarded-Proto from cloudflared) and "http" for direct local
    # access — hardcoding Secure=True would silently break login over plain
    # http://localhost:3000.
    _set_auth_cookies(response, tokens["access_token"], tokens["refresh_token"],
                       secure=request.url.scheme == "https")
    log.info("login: username=%s user_id=%s", user_row["username"], user_row["id"])
    return {"id": user_row["id"], "username": user_row["username"],
            "is_admin": bool(user_row["is_admin"]),
            "nsfw_allowed": bool(user_row.get("nsfw_allowed")),
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "token_type": "bearer",
            "expires_in": db.ACCESS_TOKEN_TTL}


@auth_router.post("/refresh")
async def refresh(request: Request, response: Response):
    """Rotates the refresh token on every call, not just the access token:
    the presented jti is marked used (never deleted) and a brand new refresh
    jti is issued in its place. If that same now-used jti is ever presented
    again — the only way that happens is a stolen token being replayed
    alongside (or after) the legitimate client's own rotation — it's treated
    as theft: every token for the account, access and refresh alike, is
    revoked immediately rather than just rejecting the one request."""
    token = _bearer_token(request) or request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    claims = _decode_token(token, "refresh")
    if not claims:
        raise HTTPException(status_code=401, detail="Refresh token expired or invalid")
    row = await user_repo.get_refresh_token(claims["jti"], claims["sub"])
    if not row:
        raise HTTPException(status_code=401, detail="Refresh token expired or invalid")
    if row["revoked"]:
        await user_repo.revoke_user_tokens(claims["sub"])
        _clear_auth_cookies(response)
        log.error("refresh token reuse detected — all sessions revoked user_id=%s", claims["sub"])
        raise HTTPException(status_code=401, detail={
            "code": "token_reuse_detected",
            "message": "This refresh token was already used. All sessions for this "
                       "account have been revoked as a precaution — please log in again."})
    if row["expires"] < time.time():
        raise HTTPException(status_code=401, detail="Refresh token expired or invalid")
    user = await user_repo.get_user_by_id(claims["sub"])
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=401, detail="Account no longer active")
    await user_repo.rotate_refresh_token(claims["jti"])
    tokens = await _issue_tokens(user["id"])
    _set_auth_cookies(response, tokens["access_token"], tokens["refresh_token"],
                       secure=request.url.scheme == "https")
    log.info("tokens refreshed (refresh rotated): user_id=%s", user["id"])
    return {"access_token": tokens["access_token"], "refresh_token": tokens["refresh_token"],
            "token_type": "bearer", "expires_in": db.ACCESS_TOKEN_TTL}


@auth_router.post("/logout")
async def logout(request: Request, response: Response):
    access_token = _bearer_token(request) or request.cookies.get(ACCESS_COOKIE_NAME)
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    user_id = None
    access_claims = _decode_token(access_token, "access") if access_token else None
    if access_claims:
        user_id = access_claims["sub"]
        await user_repo.revoke_access_token(access_claims["jti"])
    refresh_claims = _decode_token(refresh_token, "refresh") if refresh_token else None
    if refresh_claims:
        user_id = user_id or refresh_claims["sub"]
        await user_repo.revoke_refresh_token(refresh_claims["jti"])
    if user_id:
        log.info("logout: user_id=%s", user_id)
    _clear_auth_cookies(response)
    return {"ok": True}


@auth_router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return current_user


@auth_router.put("/password")
async def change_password(body: PasswordChangeIn, request: Request,
                          current_user: dict = Depends(get_current_user)):
    user_row = await user_repo.get_user_by_username(current_user["username"])
    if not db.verify_password(body.old_password, user_row["password_hash"]):
        log.warning("password change failed: username=%s reason=wrong_current", current_user["username"])
        raise HTTPException(400, "Current password is incorrect")
    await user_repo.update_user_password(current_user["id"], body.new_password)
    access_claims = await _resolve_access_claims(request)
    refresh_token = _bearer_token(request) or request.cookies.get(REFRESH_COOKIE_NAME)
    refresh_claims = _decode_token(refresh_token, "refresh") if refresh_token else None
    await user_repo.revoke_user_tokens(
        current_user["id"],
        keep_access_jti=access_claims["jti"] if access_claims else None,
        keep_refresh_jti=refresh_claims["jti"] if refresh_claims else None)
    log.info("password changed: username=%s user_id=%s", current_user["username"], current_user["id"])
    return {"ok": True}


def _generate_backup_codes(count: int = 8) -> list[str]:
    return [secrets.token_hex(4) for _ in range(count)]


@auth_router.post("/totp/setup")
async def totp_setup(current_user: dict = Depends(get_current_user)):
    if current_user.get("totp_enabled"):
        raise HTTPException(400, "TOTP is already configured for this account")
    secret = pyotp.random_base32()
    await user_repo.set_totp_secret(current_user["id"], secret)
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=current_user["username"], issuer_name=TOTP_ISSUER)
    log.info("totp setup started: username=%s user_id=%s", current_user["username"], current_user["id"])
    return {"secret": secret, "otpauth_uri": uri}


@auth_router.post("/totp/enable")
async def totp_enable(body: TotpEnableIn, current_user: dict = Depends(get_current_user)):
    """Configures TOTP as an account-recovery method (see /password-reset/totp).
    This alone does NOT require a code at login — that's a separate opt-in,
    see /totp/login-enforcement."""
    if current_user.get("totp_enabled"):
        raise HTTPException(400, "TOTP is already configured for this account")
    secret = await user_repo.get_totp_secret(current_user["id"])
    if not secret:
        raise HTTPException(400, "Call /totp/setup first")
    if not pyotp.TOTP(secret).verify(body.code, valid_window=1):
        log.warning("totp enable failed: username=%s reason=invalid_code", current_user["username"])
        raise HTTPException(400, "Invalid verification code")
    backup_codes = _generate_backup_codes()
    await user_repo.set_totp_secret(current_user["id"], secret, backup_codes)
    await user_repo.set_totp_enabled(current_user["id"], True)
    log.info("totp enabled: username=%s user_id=%s", current_user["username"], current_user["id"])
    return {"ok": True, "backup_codes": backup_codes}


@auth_router.post("/totp/disable")
async def totp_disable(body: TotpDisableIn, current_user: dict = Depends(get_current_user)):
    """Removes TOTP entirely — also drops login enforcement, since it can't be
    required once there's no secret left to check it against."""
    user_row = await user_repo.get_user_by_username(current_user["username"])
    if not db.verify_password(body.password, user_row["password_hash"]):
        log.warning("totp disable failed: username=%s reason=wrong_password", current_user["username"])
        raise HTTPException(400, "Password is incorrect")
    if not await _verify_totp(user_row, body.code):
        log.warning("totp disable failed: username=%s reason=invalid_code", current_user["username"])
        raise HTTPException(400, "Invalid verification code")
    await user_repo.set_totp_enabled(current_user["id"], False)
    await user_repo.set_totp_secret(current_user["id"], None)
    log.info("totp disabled: username=%s user_id=%s", current_user["username"], current_user["id"])
    return {"ok": True}


@auth_router.put("/totp/login-enforcement")
async def totp_login_enforcement(body: TotpLoginEnforcementIn,
                                 current_user: dict = Depends(get_current_user)):
    """The explicit second opt-in that actually makes /login demand a TOTP
    code — configuring TOTP via /totp/enable alone only makes it available
    for /password-reset/totp recovery."""
    if not current_user.get("totp_enabled"):
        raise HTTPException(400, "Configure TOTP via /totp/setup and /totp/enable first")
    user_row = await user_repo.get_user_by_username(current_user["username"])
    if not await _verify_totp(user_row, body.code):
        log.warning("totp login-enforcement change failed: username=%s reason=invalid_code",
                    current_user["username"])
        raise HTTPException(400, "Invalid verification code")
    await user_repo.set_totp_login_required(current_user["id"], body.required)
    log.info("totp login enforcement changed: username=%s user_id=%s required=%s",
             current_user["username"], current_user["id"], body.required)
    return {"ok": True, "totp_login_required": body.required}
