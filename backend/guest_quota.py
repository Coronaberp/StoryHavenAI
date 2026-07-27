from fastapi import HTTPException

from backend.repositories import users as user_repo
from backend.state import log

GUEST_TOKEN_LIMIT = 1_000_000
GUEST_IMAGE_LIMIT = 400
GUEST_VIDEO_LIMIT = 8

_LIMITS = {
    "tokens": (GUEST_TOKEN_LIMIT, "guest_tokens_used",
               "You've used your guest allowance of 1,000,000 story tokens. "
               "Ask an admin to upgrade your account to keep going."),
    "images": (GUEST_IMAGE_LIMIT, "guest_images_used",
               "You've used your guest allowance of 400 generated images. "
               "Ask an admin to upgrade your account to keep going."),
    "videos": (GUEST_VIDEO_LIMIT, "guest_videos_used",
               "You've used your guest allowance of 8 generated videos. "
               "Ask an admin to upgrade your account to keep going."),
}

def is_guest(user: dict) -> bool:
    return user.get("role") == "guest"

def check(user: dict, kind: str) -> None:
    if not is_guest(user):
        return
    limit, field, message = _LIMITS[kind]
    if int(user.get(field) or 0) >= limit:
        log.info("guest quota exhausted: user=%s kind=%s", user.get("username"), kind)
        raise HTTPException(403, message)

async def reserve(user: dict, kind: str, amount: int = 1) -> None:
    if not is_guest(user) or amount <= 0:
        return
    limit, field, message = _LIMITS[kind]
    granted = await user_repo.reserve_guest_usage(user["id"], field, amount, limit)
    if not granted:
        log.info("guest quota exhausted: user=%s kind=%s amount=%s", user.get("username"), kind, amount)
        raise HTTPException(403, message)
    user[field] = int(user.get(field) or 0) + amount

async def refund(user: dict, kind: str, amount: int) -> None:
    if not is_guest(user) or amount <= 0:
        return
    _, field, _ = _LIMITS[kind]
    await user_repo.refund_guest_usage(user["id"], field, amount)
    user[field] = max(int(user.get(field) or 0) - amount, 0)

async def record(user: dict, kind: str, amount: int = 1) -> None:
    if not is_guest(user) or amount <= 0:
        return
    _, field, _ = _LIMITS[kind]
    await user_repo.add_guest_usage(user["id"], field, amount)

def estimate_tokens(*texts: str) -> int:
    return sum(len(t or "") // 4 + 1 for t in texts)

def require_full(user: dict, action: str) -> None:
    if not is_guest(user):
        return
    log.info("guest blocked action: user=%s action=%s", user.get("username"), action)
    raise HTTPException(403, f"Guest accounts can't {action}. "
                             "Ask an admin to upgrade your account.")
