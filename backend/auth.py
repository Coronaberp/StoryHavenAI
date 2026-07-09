"""Authentication: session cookie helpers, user dependencies, login throttle,
and the public /api/auth routes."""
import re
import time

from fastapi import HTTPException, Request, Response, Depends

from backend import db
from backend.state import COOKIE_NAME, COOKIE_MAX_AGE, auth_router, log
from backend.schemas import LoginIn, PasswordChangeIn, PasswordResetRequestIn
from backend.ratelimit import SlidingWindow

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


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await db.get_session_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return user


async def get_current_user_optional(request: Request) -> dict | None:
    """Same as get_current_user but returns None instead of 401 — for the
    handful of read-only public/community endpoints that anonymous visitors
    (the /explore mode) may hit without ever having signed in."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    return await db.get_session_user(token)


async def get_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _set_session_cookie(response: Response, token: str, secure: bool = True):
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


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


@auth_router.post("/register")
async def register(body: LoginIn, request: Request):
    ip = _client_ip(request)
    _REGISTRATIONS.check(ip)
    _REGISTRATIONS.record(ip)
    username = normalize_username(body.username)
    _login_rate_check(ip, username)
    if len(username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    existing = await db.get_user_by_username(username)
    if existing:
        _login_record_failure(_client_ip(request), username)
        raise HTTPException(400, "Username already taken")
    await db.create_user(username, body.password, status="pending")
    await db.notify_admins(
        "admin_signup", f"New signup: {username}",
        f"{username} registered and is awaiting approval.", "/admin")
    log.info("registration: username=%s status=pending", username)
    return {"ok": True, "pending": True}


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
    user_row = await db.get_user_by_username(body.username)
    if user_row:
        await db.create_password_reset_request(user_row["id"], user_row["username"])
        await db.notify_admins(
            "admin_reset", f"Password reset: {user_row['username']}",
            f"{user_row['username']} requested a password reset.", "/admin")
        log.info("password reset requested: username=%s", user_row["username"])
    return {"ok": True, "message": _RESET_GENERIC}


@auth_router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    ip = _client_ip(request)
    username = normalize_username(body.username)
    _login_rate_check(ip, username)
    user_row = await db.get_user_by_username(username)
    if not user_row or not db.verify_password(body.password, user_row["password_hash"]):
        _login_record_failure(ip, username)
        log.warning("login failed: username=%s reason=invalid_credentials", username)
        raise HTTPException(status_code=401, detail="Invalid username or password")
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
    token = await db.create_auth_session(user_row["id"])
    # request.url.scheme correctly reports "https" behind the Cloudflare tunnel
    # (uvicorn is started with --proxy-headers --forwarded-allow-ips='*', so it
    # trusts X-Forwarded-Proto from cloudflared) and "http" for direct local
    # access — hardcoding Secure=True would silently break login over plain
    # http://localhost:3000.
    _set_session_cookie(response, token, secure=request.url.scheme == "https")
    log.info("login: username=%s user_id=%s", user_row["username"], user_row["id"])
    return {"id": user_row["id"], "username": user_row["username"],
            "is_admin": bool(user_row["is_admin"]),
            "nsfw_allowed": bool(user_row.get("nsfw_allowed"))}


@auth_router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        user = await db.get_session_user(token)
        await db.delete_auth_session(token)
        if user:
            log.info("logout: username=%s user_id=%s", user["username"], user["id"])
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@auth_router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return current_user


@auth_router.put("/password")
async def change_password(body: PasswordChangeIn, request: Request,
                          current_user: dict = Depends(get_current_user)):
    user_row = await db.get_user_by_username(current_user["username"])
    if not db.verify_password(body.old_password, user_row["password_hash"]):
        log.warning("password change failed: username=%s reason=wrong_current", current_user["username"])
        raise HTTPException(400, "Current password is incorrect")
    await db.update_user_password(current_user["id"], body.new_password)
    await db.delete_other_user_sessions(
        current_user["id"], keep_token=request.cookies.get(COOKIE_NAME))
    log.info("password changed: username=%s user_id=%s", current_user["username"], current_user["id"])
    return {"ok": True}

