"""Users/auth/per-user-settings repository: accounts, auth sessions, and
per-user settings overrides."""
from __future__ import annotations
import json
import time
import secrets

from sqlalchemy import select, insert, update, delete, and_, or_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend import db
from backend.db import (
    users, auth_sessions, user_settings, admin_notes, characters, sessions,
    jwt_access_tokens, jwt_refresh_tokens,
    nid, _q, _q1, _w, _scalar,
    _user_row, _char_row, _owner_username,
    _encrypt_secret, _decrypt_secret,
    hash_password, verify_password,
    SESSION_TTL,
)
from backend.state import log


async def any_users() -> bool:
    return (await _scalar(select(func.count()).select_from(users))) > 0


async def whitelist_access_token(jti: str, user_id: str):
    now = time.time()
    await _w(insert(jwt_access_tokens).values(
        jti=jti, user_id=user_id, expires=now + db.ACCESS_TOKEN_TTL, created=now))


async def whitelist_refresh_token(jti: str, user_id: str):
    now = time.time()
    await _w(insert(jwt_refresh_tokens).values(
        jti=jti, user_id=user_id, expires=now + db.REFRESH_TOKEN_TTL, created=now, revoked=0))


async def access_token_valid(jti: str, user_id: str) -> bool:
    row = await _q1(select(jwt_access_tokens.c.expires).where(
        and_(jwt_access_tokens.c.jti == jti, jwt_access_tokens.c.user_id == user_id)))
    return bool(row) and row["expires"] > time.time()


async def get_refresh_token(jti: str, user_id: str) -> dict | None:
    return await _q1(select(jwt_refresh_tokens).where(
        and_(jwt_refresh_tokens.c.jti == jti, jwt_refresh_tokens.c.user_id == user_id)))


async def rotate_refresh_token(jti: str):
    """Marks a refresh token used rather than deleting it, so a replay of
    this same jti (the only way that can happen is a stolen token being
    presented after the legitimate client already rotated it) is recognized
    as theft by /api/auth/refresh instead of just looking like an unknown
    token."""
    await _w(update(jwt_refresh_tokens).where(jwt_refresh_tokens.c.jti == jti).values(revoked=1))


async def revoke_access_token(jti: str):
    await _w(delete(jwt_access_tokens).where(jwt_access_tokens.c.jti == jti))


async def revoke_refresh_token(jti: str):
    """Marks the token revoked rather than deleting the row, so
    get_refresh_token can still distinguish "this token was revoked" from
    "this jti was never issued" — the same reuse-detection concern as
    rotate_refresh_token."""
    await _w(update(jwt_refresh_tokens).where(jwt_refresh_tokens.c.jti == jti).values(revoked=1))


async def refresh_token_valid(jti: str, user_id: str) -> bool:
    row = await _q1(select(jwt_refresh_tokens.c.expires, jwt_refresh_tokens.c.revoked).where(
        and_(jwt_refresh_tokens.c.jti == jti, jwt_refresh_tokens.c.user_id == user_id)))
    return bool(row) and not row["revoked"] and row["expires"] > time.time()


async def revoke_user_tokens(user_id: str, keep_access_jti: str | None = None,
                             keep_refresh_jti: str | None = None):
    """Full logout-everywhere: used on password change and on detected
    refresh-token replay (theft response). Pass keep_access_jti/keep_refresh_jti
    to revoke every session except the one making the current request (e.g. a
    password change shouldn't log the user themselves out)."""
    access_cond = jwt_access_tokens.c.user_id == user_id
    if keep_access_jti:
        access_cond = and_(access_cond, jwt_access_tokens.c.jti != keep_access_jti)
    refresh_cond = jwt_refresh_tokens.c.user_id == user_id
    if keep_refresh_jti:
        refresh_cond = and_(refresh_cond, jwt_refresh_tokens.c.jti != keep_refresh_jti)
    await _w(delete(jwt_access_tokens).where(access_cond))
    await _w(delete(jwt_refresh_tokens).where(refresh_cond))
    log.info("users: JWT tokens revoked user_id=%s kept_current=%s",
             user_id, bool(keep_access_jti or keep_refresh_jti))


async def create_user(username: str, password: str, is_admin: bool = False,
                       status: str = "active", totp_secret: str | None = None,
                       totp_backup_codes: list[str] | None = None,
                       totp_enabled: bool = False, totp_login_required: bool = False,
                       invite_code_id: str | None = None, tier: str = "full") -> dict:
    uid = nid("u")
    await _w(insert(users).values(
        id=uid, username=username.strip().lower(),
        password_hash=hash_password(password), is_admin=int(is_admin),
        status=status, created=time.time(), invite_code_id=invite_code_id, tier=tier,
        totp_secret=_encrypt_secret(totp_secret) if totp_secret else None,
        totp_backup_codes=_encrypt_secret(json.dumps(totp_backup_codes)) if totp_backup_codes else None,
        totp_enabled=int(totp_enabled), totp_login_required=int(totp_login_required)))
    log.info(f"user created id={uid} is_admin={is_admin} status={status} totp_enabled={totp_enabled}")
    return await get_user_by_id(uid)


async def set_totp_secret(uid: str, secret: str | None, backup_codes: list[str] | None = None):
    values = {"totp_secret": _encrypt_secret(secret) if secret else None}
    if secret is None:
        values["totp_backup_codes"] = None
    elif backup_codes is not None:
        values["totp_backup_codes"] = _encrypt_secret(json.dumps(backup_codes))
    await _w(update(users).where(users.c.id == uid).values(**values))
    log.info(f"user totp_secret set id={uid} has_secret={bool(secret)}")


async def get_totp_secret(uid: str) -> str | None:
    row = await _q1(select(users.c.totp_secret).where(users.c.id == uid))
    if not row or not row["totp_secret"]:
        return None
    return _decrypt_secret(row["totp_secret"])


async def get_totp_backup_codes(uid: str) -> list[str]:
    row = await _q1(select(users.c.totp_backup_codes).where(users.c.id == uid))
    if not row or not row["totp_backup_codes"]:
        return []
    try:
        return json.loads(_decrypt_secret(row["totp_backup_codes"]))
    except Exception:
        return []


async def set_totp_enabled(uid: str, enabled: bool):
    values = {"totp_enabled": int(enabled)}
    if not enabled:
        values["totp_login_required"] = 0
    await _w(update(users).where(users.c.id == uid).values(**values))
    log.info(f"user totp_enabled changed id={uid} enabled={enabled}")


async def set_totp_login_required(uid: str, required: bool):
    await _w(update(users).where(users.c.id == uid).values(totp_login_required=int(required)))


async def set_tier(uid: str, tier: str):
    await _w(update(users).where(users.c.id == uid).values(tier=tier))
    log.info("users: tier=%s uid=%s", tier, uid)


async def add_guest_usage(uid: str, field: str, amount: int):
    column = users.c[field]
    await _w(update(users).where(users.c.id == uid).values({field: column + amount}))


async def set_passkey_required(uid: str, required: bool):
    await _w(update(users).where(users.c.id == uid).values(passkey_required=int(required)))
    log.info("users: passkey_required=%s uid=%s", required, uid)
    log.info(f"user totp_login_required changed id={uid} required={required}")


async def consume_totp_backup_code(uid: str, code: str) -> bool:
    row = await _q1(select(users.c.totp_backup_codes).where(users.c.id == uid))
    if not row or not row["totp_backup_codes"]:
        return False
    try:
        codes = json.loads(_decrypt_secret(row["totp_backup_codes"]))
    except Exception:
        return False
    if code not in codes:
        return False
    codes.remove(code)
    await _w(update(users).where(users.c.id == uid).values(
        totp_backup_codes=_encrypt_secret(json.dumps(codes))))
    log.info(f"user totp backup code consumed id={uid} remaining={len(codes)}")
    return True


async def get_user_by_id(uid: str) -> dict | None:
    row = await _q1(select(users).where(users.c.id == uid))
    return _user_row(row) if row else None


async def set_user_nsfw_allowed(uid: str, allowed: bool) -> dict | None:
    await _w(update(users).where(users.c.id == uid).values(
        nsfw_allowed=int(bool(allowed))))
    log.info(f"user nsfw_allowed changed id={uid} allowed={bool(allowed)}")
    return await get_user_by_id(uid)


async def set_user_experimental_features_enabled(uid: str, enabled: bool) -> dict | None:
    await _w(update(users).where(users.c.id == uid).values(
        experimental_features_enabled=int(bool(enabled))))
    log.info(f"user experimental_features_enabled changed id={uid} enabled={bool(enabled)}")
    return await get_user_by_id(uid)


async def update_user_profile(uid: str, data: dict):
    """Profile fields only — never auth/role fields."""
    allowed = {k: data[k] for k in ("display_name", "bio", "avatar", "banner_color",
                                    "accent_color", "banner_img", "chat_background_img", "social_links",
                                    "profile_html", "card_html", "is_explicit",
                                    "title", "title_status") if k in data}
    if not allowed:
        return
    if "social_links" in allowed:
        allowed["social_links"] = json.dumps(allowed["social_links"] or {})
    if "bio" in allowed:
        allowed["bio"] = _encrypt_secret(allowed["bio"] or "")
    if "display_name" in allowed:
        allowed["display_name"] = _encrypt_secret(allowed["display_name"] or "")
    if "profile_html" in allowed:
        allowed["profile_html"] = _encrypt_secret(allowed["profile_html"] or "")
    if "card_html" in allowed:
        allowed["card_html"] = _encrypt_secret(allowed["card_html"] or "")
    await _w(update(users).where(users.c.id == uid).values(**allowed))
    log.info(f"user profile updated id={uid} fields={sorted(allowed.keys())}")


async def public_characters_by_owner(uid: str) -> list[dict]:
    chats = (select(func.count()).select_from(sessions)
             .where(sessions.c.char_id == characters.c.id)
             .scalar_subquery().label("chats"))
    stmt = (select(characters, chats)
            .where(and_(characters.c.owner_id == uid, characters.c.is_public == 1))
            .order_by(characters.c.created.desc()))
    return [_char_row(row) for row in await _q(stmt)]


async def get_user_by_username(username: str) -> dict | None:
    """Returns the full row including password_hash for login verification."""
    return await _q1(select(users).where(users.c.username == username.strip().lower()))


async def list_users() -> list[dict]:
    rows = await _q(select(users).order_by(users.c.created.asc()))
    out = []
    for r in rows:
        d = _user_row(r)
        d["identity_label"] = _decrypt_secret(r.get("identity_label") or "") or None
        out.append(d)
    return out


async def set_identity_label(uid: str, label: str | None):
    value = _encrypt_secret(label) if label else None
    await _w(update(users).where(users.c.id == uid).values(identity_label=value))
    log.info(f"user identity_label changed id={uid} set={bool(label)}")


async def update_user_password(uid: str, new_password: str):
    await _w(update(users).where(users.c.id == uid).values(
        password_hash=hash_password(new_password)))
    log.info(f"user password updated id={uid}")


async def update_user_role(uid: str, is_admin: bool):
    await _w(update(users).where(users.c.id == uid).values(is_admin=int(is_admin)))
    log.info(f"user role changed id={uid} is_admin={is_admin}")


async def set_dev_role(uid: str, is_dev: bool):
    """Grants/revokes the Dev tier — a step above admin, replacing what used
    to be a hardcoded username check. Revoking never touches is_admin (a
    former Dev stays a regular admin); granting requires the target to
    already be an admin, enforced by the caller (routers/admin.py)."""
    await _w(update(users).where(users.c.id == uid).values(role="dev" if is_dev else "admin"))
    log.info(f"user dev role changed id={uid} is_dev={is_dev}")


async def set_explicit(uid: str, explicit: bool):
    await _w(update(users).where(users.c.id == uid).values(is_explicit=1 if explicit else 0))
    log.info(f"user set_explicit id={uid} explicit={explicit}")


async def list_admin_user_ids() -> list[str]:
    stmt = select(users.c.id).where(and_(
        users.c.is_admin == 1, users.c.status == "active"))
    return [r["id"] for r in await _q(stmt)]


async def list_active_non_dev_user_ids() -> list[str]:
    stmt = select(users.c.id).where(and_(
        users.c.status == "active", users.c.role != "dev"))
    return [r["id"] for r in await _q(stmt)]


async def delete_user(uid: str):
    async with db._engine.begin() as conn:
        await conn.execute(delete(auth_sessions).where(auth_sessions.c.user_id == uid))
        await conn.execute(delete(jwt_access_tokens).where(jwt_access_tokens.c.user_id == uid))
        await conn.execute(delete(jwt_refresh_tokens).where(jwt_refresh_tokens.c.user_id == uid))
        await conn.execute(delete(user_settings).where(user_settings.c.user_id == uid))
        await conn.execute(delete(admin_notes).where(or_(
            admin_notes.c.user_id == uid, admin_notes.c.author_id == uid)))
        await conn.execute(delete(users).where(users.c.id == uid))
    log.info(f"user deleted id={uid}")


async def create_auth_session(user_id: str) -> str:
    token = secrets.token_hex(32)
    await _w(insert(auth_sessions).values(
        token=token, user_id=user_id, expires=time.time() + SESSION_TTL))
    log.info(f"auth session created user={user_id}")
    return token


async def delete_other_user_sessions(uid: str, keep_token: str | None = None):
    stmt = delete(auth_sessions).where(auth_sessions.c.user_id == uid)
    if keep_token:
        stmt = stmt.where(auth_sessions.c.token != keep_token)
    await _w(stmt)
    log.info(f"other auth sessions revoked user={uid} kept_current={bool(keep_token)}")


async def get_session_user(token: str) -> dict | None:
    stmt = (select(users)
            .select_from(users.join(auth_sessions, users.c.id == auth_sessions.c.user_id))
            .where(and_(auth_sessions.c.token == token,
                        auth_sessions.c.expires > time.time(),
                        users.c.status == "active")))
    row = await _q1(stmt)
    return _user_row(row) if row else None


async def update_user_status(uid: str, status: str):
    await _w(update(users).where(users.c.id == uid).values(status=status))
    log.info(f"user status changed id={uid} status={status}")


async def suspend_user(uid: str, reason: str | None):
    await _w(update(users).where(users.c.id == uid).values(
        status="suspended",
        suspension_reason=_encrypt_secret(reason) if reason else None))
    log.info(f"user suspended id={uid} has_reason={bool(reason)}")


async def unsuspend_user(uid: str):
    await _w(update(users).where(users.c.id == uid).values(
        status="active", suspension_reason=None))
    log.info(f"user unsuspended id={uid}")


async def delete_auth_session(token: str):
    async with db._engine.begin() as conn:
        result = await conn.execute(delete(auth_sessions).where(auth_sessions.c.token == token))
    log.info(f"auth session deleted count={result.rowcount}")


async def cleanup_expired_sessions():
    async with db._engine.begin() as conn:
        result = await conn.execute(delete(auth_sessions).where(auth_sessions.c.expires < time.time()))
    if result.rowcount:
        log.info(f"expired auth sessions cleaned count={result.rowcount}")


async def get_user_settings(user_id: str) -> dict:
    rows = await _q(select(user_settings.c.key, user_settings.c.value)
                    .where(user_settings.c.user_id == user_id))
    out = {}
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value"])
        except Exception:
            log.warning(f"user settings non-JSON value user={user_id} key={r['key']}")
            out[r["key"]] = r["value"]
    if out.get("api_key"):
        out["api_key"] = _decrypt_secret(out["api_key"])
    return out


async def set_user_settings(user_id: str, items: dict):
    """Upsert non-None values; delete the key when value is None."""
    async with db._engine.begin() as conn:
        for k, v in items.items():
            if v is None:
                await conn.execute(delete(user_settings).where(and_(
                    user_settings.c.user_id == user_id, user_settings.c.key == k)))
                continue
            if k == "api_key" and isinstance(v, str) and v:
                v = _encrypt_secret(v)
            stmt = pg_insert(user_settings).values(
                user_id=user_id, key=k, value=json.dumps(v))
            stmt = stmt.on_conflict_do_update(
                index_elements=["user_id", "key"],
                set_={"value": stmt.excluded.value})
            await conn.execute(stmt)
    log.info(f"user settings updated user={user_id} keys={sorted(items.keys())}")


async def clear_user_settings(user_id: str):
    await _w(delete(user_settings).where(user_settings.c.user_id == user_id))
    log.info(f"user settings cleared user={user_id}")
