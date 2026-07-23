import time

from sqlalchemy import select, insert, update as sa_update, delete as sa_delete, or_, and_

from backend.db import lore_links, nid, _q, _w, _encrypt_secret, _decrypt_secret
from backend.state import log

MAX_LABEL_LEN = 60


def _clean_label(label: str | None) -> str:
    return (label or "").strip()[:MAX_LABEL_LEN]


async def set_link(from_id: str, to_id: str, label: str = "") -> None:
    if from_id == to_id:
        return
    clean = _clean_label(label)
    existing = await _q(select(lore_links).where(
        and_(lore_links.c.lore_id_a == from_id, lore_links.c.lore_id_b == to_id)))
    if existing:
        await _w(sa_update(lore_links).where(
            and_(lore_links.c.lore_id_a == from_id, lore_links.c.lore_id_b == to_id)).values(label=_encrypt_secret(clean)))
        log.info("lore_links: relabeled from=%s to=%s", from_id, to_id)
        return
    await _w(insert(lore_links).values(
        id=nid("ll"), lore_id_a=from_id, lore_id_b=to_id, label=_encrypt_secret(clean), created=time.time()))
    log.info("lore_links: linked from=%s to=%s", from_id, to_id)


async def unlink(from_id: str, to_id: str) -> None:
    await _w(sa_delete(lore_links).where(
        and_(lore_links.c.lore_id_a == from_id, lore_links.c.lore_id_b == to_id)))
    log.info("lore_links: unlinked from=%s to=%s", from_id, to_id)


async def outgoing_for(lore_id: str) -> list[dict]:
    rows = await _q(select(lore_links).where(lore_links.c.lore_id_a == lore_id))
    return [{"target_id": r["lore_id_b"], "label": _decrypt_secret(r["label"] or "")} for r in rows]


async def incoming_for(lore_id: str) -> list[dict]:
    rows = await _q(select(lore_links).where(lore_links.c.lore_id_b == lore_id))
    return [{"source_id": r["lore_id_a"], "label": _decrypt_secret(r["label"] or "")} for r in rows]


async def outgoing_for_many(lore_ids: list[str]) -> dict[str, list[dict]]:
    result = {lid: [] for lid in lore_ids}
    if not lore_ids:
        return result
    rows = await _q(select(lore_links).where(lore_links.c.lore_id_a.in_(lore_ids)))
    for r in rows:
        result[r["lore_id_a"]].append({"target_id": r["lore_id_b"], "label": _decrypt_secret(r["label"] or "")})
    return result


async def incoming_for_many(lore_ids: list[str]) -> dict[str, list[dict]]:
    result = {lid: [] for lid in lore_ids}
    if not lore_ids:
        return result
    rows = await _q(select(lore_links).where(lore_links.c.lore_id_b.in_(lore_ids)))
    for r in rows:
        result[r["lore_id_b"]].append({"source_id": r["lore_id_a"], "label": _decrypt_secret(r["label"] or "")})
    return result


async def delete_all_for(lore_id: str) -> None:
    await _w(sa_delete(lore_links).where(
        or_(lore_links.c.lore_id_a == lore_id, lore_links.c.lore_id_b == lore_id)))
    log.info("lore_links: deleted all links for id=%s", lore_id)


async def set_outgoing_links(lore_id: str, links: list[dict]) -> None:
    deduped: dict[str, str] = {}
    for entry in links:
        target_id = entry.get("target_id")
        if not target_id or target_id == lore_id:
            continue
        deduped[target_id] = _clean_label(entry.get("label"))
    current = {r["target_id"]: r["label"] for r in await outgoing_for(lore_id)}
    for target_id in current.keys() - deduped.keys():
        await unlink(lore_id, target_id)
    for target_id, label in deduped.items():
        if current.get(target_id) != label:
            await set_link(lore_id, target_id, label)
