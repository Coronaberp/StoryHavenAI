"""Character repository — encapsulates CRUD for the `characters` table."""
from __future__ import annotations
import json
import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, and_, or_, func

from backend.db import (
    characters, sessions, lore, messages, users,
    nid, _q, _q1, _w, _scalar, _user_row,
    _encrypt_secret, _decrypt_secret, _encrypt_json_list, _decrypt_json_list, _loads,
    engine,
)
from backend.state import log


def _char_row(row) -> dict:
    d = dict(row)
    d["name"] = _decrypt_secret(d.get("name") or "")
    d["creator"] = _decrypt_secret(d.get("creator") or "")
    d["tags"] = _decrypt_json_list(d.get("tags"))
    d["persona"] = _decrypt_secret(d.get("persona") or "")
    d["scenario"] = _decrypt_secret(d.get("scenario") or "")
    d["greeting"] = _decrypt_secret(d.get("greeting") or "")
    d["dialogue"] = _decrypt_secret(d.get("dialogue") or "")
    d["system_prompt"] = _decrypt_secret(d.get("system_prompt") or "")
    d["description"] = _decrypt_secret(d.get("description") or "")
    d["alt_greetings"] = _decrypt_json_list(d.get("alt_greetings"))
    d["assets"] = _loads(d.get("assets"), {})
    d["is_public"] = bool(d.get("is_public"))
    d["can_be_persona"] = bool(d.get("can_be_persona"))
    d["allow_download"] = bool(d.get("allow_download"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["is_draft"] = bool(d.get("is_draft"))
    return d


async def create(data: dict) -> dict:
    cid = nid("c")
    mode = data.get("mode", "character")
    if mode not in ("character", "rpg"):
        mode = "character"
    await _w(insert(characters).values(
        id=cid,
        name=_encrypt_secret(data.get("name") or "Unnamed"),
        persona=_encrypt_secret(data.get("persona") or ""),
        scenario=_encrypt_secret(data.get("scenario") or ""),
        greeting=_encrypt_secret(data.get("greeting") or ""),
        dialogue=_encrypt_secret(data.get("dialogue") or ""),
        system_prompt=_encrypt_secret(data.get("system_prompt") or ""),
        tags=_encrypt_json_list(data.get("tags") or []),
        creator=_encrypt_secret(data.get("creator") or "you"),
        avatar=data.get("avatar") or "",
        alt_greetings=_encrypt_json_list(data.get("alt_greetings") or []),
        mode=mode,
        assets=json.dumps(data.get("assets") or {}),
        owner_id=data.get("owner_id"),
        is_public=int(bool(data.get("is_public", False))),
        presentation_html=data.get("presentation_html") or "",
        can_be_persona=int(bool(data.get("can_be_persona", False))),
        allow_download=int(bool(data.get("allow_download", False))),
        description=_encrypt_secret(data.get("description") or ""),
        is_explicit=int(bool(data.get("is_explicit", False))),
        is_draft=int(bool(data.get("is_draft", False))),
        created=time.time()))
    log.info("characters: created id=%s owner=%s mode=%s draft=%s",
              cid, data.get("owner_id"), mode, bool(data.get("is_draft")))
    return await get(cid)


async def get(cid: str) -> dict | None:
    row = await _q1(select(characters).where(characters.c.id == cid))
    if not row:
        return None
    c = _char_row(row)
    c["chats"] = await _scalar(
        select(func.count()).select_from(sessions).where(sessions.c.char_id == cid))
    c["owner_username"] = await owner_username(c.get("owner_id"))
    return c


async def owner_username(owner_id: str | None) -> str | None:
    if not owner_id:
        return None
    return await _scalar(select(users.c.username).where(users.c.id == owner_id))


async def list_public_users(q: str | None = None) -> list[dict]:
    """Public creator directory. Lists every active user as a potential
    creator to browse — publishing a character or filling in a profile isn't
    required, `public_characters` is just 0 for those who haven't. Excludes
    only deactivated/non-active accounts (see `users.status`); admins are
    left in since an admin can be a genuine, prolific creator in their own
    right (e.g. one with several public characters) — excluding the role
    would just hide real content from the directory. Supports q against
    username/display_name."""
    counts = await _q(select(characters.c.owner_id, func.count().label("n"))
                      .where(characters.c.is_public == 1)
                      .group_by(characters.c.owner_id))
    pub_counts = {r["owner_id"]: r["n"] for r in counts if r["owner_id"]}
    ql = (q or "").strip().lower()
    out = []
    for r in await _q(select(users).where(users.c.status == "active")):
        u = _user_row(r)
        n = pub_counts.get(u["id"], 0)
        bio = (u.get("bio") or "").strip()
        if ql and ql not in u["username"].lower() and ql not in (u.get("display_name") or "").lower():
            continue
        out.append({
            "id": u["id"],
            "username": u["username"],
            "display_name": u.get("display_name") or "",
            "avatar": u.get("avatar") or "",
            "bio": bio[:180],
            "public_characters": n,
            "banner_img": u.get("banner_img") or "",
            "banner_color": u.get("banner_color") or "",
            "accent_color": u.get("accent_color") or "",
            "is_explicit": bool(u.get("is_explicit")),
        })
    out.sort(key=lambda x: (-x["public_characters"], x["username"]))
    return out


async def list_all(q: str | None = None, user_id: str | None = None,
                    is_admin: bool = False,
                    scope: str | None = None,
                    tags: list[str] | None = None,
                    creator: str | None = None) -> list[dict]:
    """Return characters filtered by scope.

    scope='mine'      → owner's private characters only
    scope='community' → public characters (is_public=1)
    scope='drafts'    → owner's own autosaved-but-not-yet-finished characters only
    scope=None        → public + user's own (legacy / admin uses all)

    Drafts never appear under any other scope — they're a distinct, separate
    bucket (see the "Pending" library tab) until their author actually finishes
    and saves them for real, not half-written characters mixed into everyone's
    normal browsing.
    """
    conditions = []
    if creator:
        cl = creator.strip().lower()
        owner_rows = await _q(select(users.c.id, users.c.username, users.c.display_name))
        owner_ids_match = [
            r["id"] for r in owner_rows
            if (r.get("username") or "").lower() == cl
            or _decrypt_secret(r.get("display_name") or "").lower() == cl]
        if not owner_ids_match:
            return []
        conditions.append(characters.c.owner_id.in_(owner_ids_match))
    if scope == "drafts":
        conditions.append(and_(characters.c.owner_id == (user_id or ""),
                               characters.c.is_draft == 1))
    elif scope == "mine":
        conditions.append(and_(characters.c.owner_id == (user_id or ""),
                               characters.c.is_draft == 0))
    elif scope == "community":
        conditions.append(and_(characters.c.is_public == 1, characters.c.is_draft == 0))
    else:
        conditions.append(characters.c.is_draft == 0)
        if user_id:
            conditions.append(or_(characters.c.is_public == 1,
                                  characters.c.owner_id == user_id))
        else:
            conditions.append(characters.c.is_public == 1)

    # `persona` is encrypted at rest, so it can't be matched with SQL LIKE.
    # Rather than split the match across a SQL pass (name/tags) and a Python
    # pass (persona) — which would miss rows where only persona matches but
    # name/tags don't — the scope filter runs in SQL and the full text match
    # (name + tags + persona) runs in Python on the decrypted rows below.
    chats = (select(func.count()).select_from(sessions)
             .where(sessions.c.char_id == characters.c.id)
             .scalar_subquery().label("chats"))
    stmt = select(characters, chats)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(characters.c.created.desc())
    rows = [_char_row(r) for r in await _q(stmt)]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r["name"].lower()
                or ql in r["persona"].lower() or ql in json.dumps(r["tags"]).lower()]
    if tags:
        want = {tg.strip().lower() for tg in tags if tg.strip()}
        if want:
            rows = [r for r in rows
                    if want & {str(tg).lower() for tg in (r.get("tags") or [])}]
    owner_ids = {c["owner_id"] for c in rows if c.get("owner_id")}
    usernames: dict[str, str] = {}
    if owner_ids:
        urows = await _q(select(users.c.id, users.c.username)
                         .where(users.c.id.in_(list(owner_ids))))
        usernames = {r["id"]: r["username"] for r in urows}
    for c in rows:
        c["owner_username"] = usernames.get(c.get("owner_id"))
    return rows


async def update(cid: str, data: dict) -> dict | None:
    c = await get(cid)
    if not c:
        log.warning("characters: update failed, id=%s not found", cid)
        return None
    mode = data.get("mode", c["mode"])
    if mode not in ("character", "rpg"):
        mode = "character"
    # owner_id is preserved — only the original creator keeps ownership
    owner_id = c.get("owner_id")
    is_public = int(bool(data.get("is_public", c.get("is_public", False))))
    await _w(sa_update(characters).where(characters.c.id == cid).values(
        name=_encrypt_secret(data.get("name") or c["name"]),
        persona=_encrypt_secret(data.get("persona", c["persona"]) or ""),
        scenario=_encrypt_secret(data.get("scenario", c["scenario"]) or ""),
        greeting=_encrypt_secret(data.get("greeting", c["greeting"]) or ""),
        dialogue=_encrypt_secret(data.get("dialogue", c["dialogue"]) or ""),
        system_prompt=_encrypt_secret(data.get("system_prompt", c.get("system_prompt", "")) or ""),
        tags=_encrypt_json_list(data.get("tags", c["tags"])),
        creator=_encrypt_secret(data.get("creator", c["creator"])),
        avatar=data.get("avatar", c["avatar"]),
        alt_greetings=_encrypt_json_list(data.get("alt_greetings", c["alt_greetings"])),
        mode=mode,
        assets=json.dumps(data.get("assets", c["assets"]) or {}),
        owner_id=owner_id,
        is_public=is_public,
        presentation_html=data.get("presentation_html", c.get("presentation_html", "")),
        can_be_persona=int(bool(data.get("can_be_persona", c.get("can_be_persona", False)))),
        allow_download=int(bool(data.get("allow_download", c.get("allow_download", False)))),
        description=_encrypt_secret(data.get("description", c.get("description", "")) or ""),
        is_explicit=int(bool(data.get("is_explicit", c.get("is_explicit", False)))),
        is_draft=int(bool(data.get("is_draft", c.get("is_draft", False))))))
    log.info("characters: updated id=%s", cid)
    return await get(cid)


async def delete(cid: str) -> list[str]:
    """Delete character and all related data. Returns list of deleted session ids."""
    sids = [r["id"] for r in await _q(
        select(sessions.c.id).where(sessions.c.char_id == cid))]
    async with engine().begin() as conn:
        if sids:
            await conn.execute(sa_delete(messages).where(messages.c.session_id.in_(sids)))
        await conn.execute(sa_delete(sessions).where(sessions.c.char_id == cid))
        await conn.execute(sa_delete(lore).where(lore.c.char_id == cid))
        await conn.execute(sa_delete(characters).where(characters.c.id == cid))
    log.info("characters: deleted id=%s sessions_removed=%d", cid, len(sids))
    return sids


async def set_explicit(cid: str, explicit: bool):
    await _w(sa_update(characters).where(characters.c.id == cid).values(is_explicit=1 if explicit else 0))
    log.info("characters: set_explicit id=%s explicit=%s", cid, explicit)
