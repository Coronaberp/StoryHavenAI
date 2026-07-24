import json
import time

from sqlalchemy import and_, select, insert, update as sa_update, delete as sa_delete

from backend.db import (
    standalone_images, users, messages, sessions, characters,
    _q, _q1, _w, _scalar, nid, _decrypt_secret, _preview, _THINK_RE,
)
from backend.state import log

def _standalone_row(r) -> dict:
    d = dict(r)
    d["is_public"] = bool(d.get("is_public"))
    d["is_explicit"] = bool(d.get("is_explicit"))
    d["human_reviewed"] = bool(d.get("human_reviewed"))
    d["classified"] = bool(d.get("classified"))
    d["is_img2img"] = bool(d.get("is_img2img"))
    try:
        d["loras"] = json.loads(d.get("loras") or "[]")
    except (json.JSONDecodeError, TypeError) as e:
        log.warning(f"standalone_images: corrupt loras json id={d.get('id')} error={e}")
        d["loras"] = []
    d["checkpoint"] = d.get("checkpoint") or ""
    d["sampler"] = d.get("sampler") or ""
    d["scheduler"] = d.get("scheduler") or ""
    d["steps"] = d.get("steps") or 20
    d["media_type"] = d.get("media_type") or "image"
    d["source_image_id"] = d.get("source_image_id")
    d["fps"] = d.get("fps") or 0
    d["frame_count"] = d.get("frame_count") or 0
    d["duration_s"] = d.get("duration_s") or 0
    return d

async def list_all_for_user(user_id: str) -> list[dict]:
    j = (messages.join(sessions, sessions.c.id == messages.c.session_id)
         .join(characters, characters.c.id == sessions.c.char_id, isouter=True))
    stmt = (select(
                messages.c.id.label("mid"),
                messages.c.session_id.label("sid"),
                messages.c.image.label("image"),
                messages.c.ts.label("ts"),
                messages.c.content.label("content"),
                messages.c.image_positive.label("image_positive"),
                messages.c.image_negative.label("image_negative"),
                messages.c.image_ts.label("image_ts"),
                messages.c.image_is_explicit.label("image_is_explicit"),
                sessions.c.char_id.label("char_id"),
                sessions.c.title.label("session_title"),
                characters.c.name.label("char_name"),
                characters.c.avatar.label("char_avatar"),
                characters.c.is_explicit.label("is_explicit"),
                characters.c.owner_id.label("char_owner_id"))
            .select_from(j)
            .where(and_(sessions.c.user_id == user_id,
                        messages.c.image.isnot(None),
                        messages.c.image != ""))
            .order_by(messages.c.ts.desc()))
    rows = await _q(stmt)
    for r in rows:
        content = _decrypt_secret(r.pop("content", "") or "")
        r["session_title"] = _decrypt_secret(r.get("session_title") or "")
        r["char_name"] = _decrypt_secret(r.get("char_name") or "")
        r["scene_full"] = _THINK_RE.sub("", content).strip()
        r["scene"] = _preview(content, 160)
        r["is_explicit"] = bool(r.get("is_explicit")) or bool(r.pop("image_is_explicit", 0))
    return rows

async def create(user_id: str, image: str, positive: str, negative: str,
                 checkpoint: str = "", loras: list | None = None,
                 is_explicit: bool = False, sampler: str = "",
                 scheduler: str = "", steps: int = 20,
                 is_img2img: bool = False, cfg: float = 7.0,
                 upscaler: str = "", media_type: str = "image",
                 source_image_id: str | None = None, fps: int = 0,
                 frame_count: int = 0, duration_s: float = 0.0,
                 classified: bool = False) -> dict:
    iid = nid("si")
    created = time.time()
    loras_json = json.dumps(loras or [])
    await _w(insert(standalone_images).values(
        id=iid, user_id=user_id, image=image, positive=positive,
        negative=negative, created=created, checkpoint=checkpoint, loras=loras_json,
        sampler=sampler, scheduler=scheduler, steps=steps, cfg=cfg, upscaler=upscaler,
        is_explicit=1 if is_explicit else 0, is_img2img=1 if is_img2img else 0,
        media_type=media_type, source_image_id=source_image_id,
        fps=fps, frame_count=frame_count, duration_s=duration_s,
        classified=1 if classified else 0))
    log.info(f"standalone_images: created id={iid} user_id={user_id} media_type={media_type}")
    return {"id": iid, "image": image, "positive": positive, "negative": negative,
            "created": created, "is_public": False, "is_explicit": bool(is_explicit),
            "human_reviewed": False, "classified": bool(classified),
            "checkpoint": checkpoint, "loras": loras or [], "sampler": sampler,
            "scheduler": scheduler, "steps": steps, "is_img2img": bool(is_img2img),
            "cfg": cfg, "upscaler": upscaler, "media_type": media_type,
            "source_image_id": source_image_id, "fps": fps,
            "frame_count": frame_count, "duration_s": duration_s}

async def get(iid: str) -> dict | None:
    row = await _q1(select(standalone_images).where(standalone_images.c.id == iid))
    return _standalone_row(row) if row else None

async def list_for_user(user_id: str) -> list[dict]:
    stmt = (select(standalone_images).where(standalone_images.c.user_id == user_id)
            .order_by(standalone_images.c.created.desc()))
    return [_standalone_row(r) for r in await _q(stmt)]

async def set_public(iid: str, user_id: str, is_public: bool,
                     is_explicit: bool | None = None) -> dict | None:
    row = await _q1(select(standalone_images).where(and_(
        standalone_images.c.id == iid, standalone_images.c.user_id == user_id)))
    if row is None:
        return None

    values = {"is_public": int(is_public)}
    if is_explicit is not None:
        values["is_explicit"] = int(is_explicit)
    await _w(sa_update(standalone_images).where(standalone_images.c.id == iid).values(**values))
    log.info(f"standalone_images: visibility changed id={iid} user_id={user_id} is_public={is_public}")
    out = _standalone_row(row)
    out["is_public"] = is_public
    out["is_explicit"] = bool(is_explicit) if is_explicit is not None else bool(row["is_explicit"])
    return out

async def list_community(hidden_ids: set) -> list[dict]:
    stmt = (select(standalone_images, users.c.username, users.c.display_name,
                   users.c.avatar)
            .select_from(standalone_images.join(
                users, users.c.id == standalone_images.c.user_id))
            .where(standalone_images.c.is_public == 1)
            .order_by(standalone_images.c.created.desc()))
    out = []
    for r in await _q(stmt):
        if r["user_id"] in hidden_ids:
            continue
        d = _standalone_row(r)
        d["owner_username"] = d.pop("username", "")
        d["owner_display_name"] = _decrypt_secret(d.pop("display_name", "") or "") or d.get("owner_username", "")
        d["owner_avatar"] = d.pop("avatar", "") or ""
        out.append(d)
    return out

async def get_public(iid: str) -> dict | None:
    stmt = (select(standalone_images, users.c.username, users.c.display_name,
                   users.c.avatar)
            .select_from(standalone_images.join(
                users, users.c.id == standalone_images.c.user_id))
            .where(and_(standalone_images.c.id == iid,
                        standalone_images.c.is_public == 1)))
    r = await _q1(stmt)
    if r is None:
        return None
    d = _standalone_row(r)
    d["owner_username"] = d.pop("username", "")
    d["owner_display_name"] = _decrypt_secret(d.pop("display_name", "") or "") or d.get("owner_username", "")
    d["owner_avatar"] = d.pop("avatar", "") or ""
    return d

async def set_explicit(iid: str, is_explicit: bool = True,
                       human_reviewed: bool = False):
    vals = {"is_explicit": 1 if is_explicit else 0}
    if human_reviewed:
        vals["human_reviewed"] = 1
    await _w(sa_update(standalone_images).where(standalone_images.c.id == iid).values(**vals))
    log.info(f"standalone_images: explicit flag set id={iid} is_explicit={is_explicit} human_reviewed={human_reviewed}")

async def mark_classified(iid: str):
    await _w(sa_update(standalone_images).where(standalone_images.c.id == iid).values(classified=1))
    log.info(f"standalone_images: classified id={iid}")

async def delete(iid: str, user_id: str) -> str | None:
    image = await _scalar(select(standalone_images.c.image).where(and_(
        standalone_images.c.id == iid, standalone_images.c.user_id == user_id)))
    if image is None:
        log.warning(f"standalone_images: delete failed (not found or not owner) id={iid} user_id={user_id}")
        return None
    await _w(sa_delete(standalone_images).where(standalone_images.c.id == iid))
    log.info(f"standalone_images: deleted id={iid} user_id={user_id}")
    return image
