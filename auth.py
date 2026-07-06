"""Authentication: session cookie helpers, user dependencies, login throttle,
and the public /api/auth routes."""
import time

from fastapi import HTTPException, Request, Response, Depends

import db
from state import COOKIE_NAME, COOKIE_MAX_AGE, auth_router, log
from schemas import LoginIn, PasswordChangeIn

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


def _login_rate_check(ip: str, username: str):
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


@auth_router.post("/register")
async def register(body: LoginIn, request: Request):
    _login_rate_check(_client_ip(request), body.username)
    if len(body.username.strip()) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    existing = await db.get_user_by_username(body.username)
    if existing:
        _login_record_failure(_client_ip(request), body.username)
        raise HTTPException(400, "Username already taken")
    await db.create_user(body.username, body.password, status="pending")
    log.info("registration: username=%s status=pending", body.username)
    return {"ok": True, "pending": True}


@auth_router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    ip = _client_ip(request)
    _login_rate_check(ip, body.username)
    user_row = await db.get_user_by_username(body.username)
    if not user_row or not db.verify_password(body.password, user_row["password_hash"]):
        _login_record_failure(ip, body.username)
        log.warning("login failed: username=%s reason=invalid_credentials", body.username)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    status = user_row.get("status", "active")
    if status == "pending":
        log.warning("login failed: username=%s reason=pending_approval", body.username)
        raise HTTPException(status_code=403, detail="Account pending admin approval")
    if status != "active":
        log.warning("login failed: username=%s reason=account_%s", body.username, status)
        raise HTTPException(status_code=403, detail="Account access denied")
    _login_clear(ip, body.username)
    token = await db.create_auth_session(user_row["id"])
    # request.url.scheme correctly reports "https" behind the Cloudflare tunnel
    # (uvicorn is started with --proxy-headers --forwarded-allow-ips='*', so it
    # trusts X-Forwarded-Proto from cloudflared) and "http" for direct local
    # access — hardcoding Secure=True would silently break login over plain
    # http://localhost:3000.
    _set_session_cookie(response, token, secure=request.url.scheme == "https")
    log.info("login: username=%s user_id=%s", user_row["username"], user_row["id"])
    return {"id": user_row["id"], "username": user_row["username"],
            "is_admin": bool(user_row["is_admin"])}


@auth_router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await db.delete_auth_session(token)
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
        raise HTTPException(400, "Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(400, "New password must be at least 8 characters")
    await db.update_user_password(current_user["id"], body.new_password)
    return {"ok": True}

