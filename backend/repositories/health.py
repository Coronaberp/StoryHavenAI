"""Service health pings: liveness/latency samples for each dependency
(llama.cpp chat/embed, ComfyUI, Postgres, Modal, ...) polled by the admin
health-history panel and its background sampler in routers/health.py."""
from __future__ import annotations
import time

from sqlalchemy import and_, delete, func, insert, select

from backend import db
from backend.db import service_health_pings, nid, _q, _q1, _w
from backend.state import log


async def record_ping(service: str, ok: bool, latency_ms: float | None,
                      error: str = "") -> None:
    previous = await latest_ping(service)
    await _w(insert(service_health_pings).values(
        id=nid("hp"), service=service, ok=1 if ok else 0,
        latency_ms=latency_ms, error=error or "", created=time.time()))
    if previous is not None and bool(previous["ok"]) != ok:
        status = "healthy" if ok else "unhealthy"
        if ok:
            log.info(f"health_repo: service={service} status changed to {status}")
        else:
            log.warning(f"health_repo: service={service} status changed to {status}")


async def prune_old_pings(older_than_days: int = 7) -> None:
    cutoff = time.time() - older_than_days * 86400
    async with db._engine.begin() as conn:
        result = await conn.execute(delete(service_health_pings).where(service_health_pings.c.created < cutoff))
    if result.rowcount:
        log.info("health_repo: pruned %d ping(s) older than %d day(s)", result.rowcount, older_than_days)


async def latest_ping(service: str) -> dict | None:
    stmt = (select(service_health_pings).where(service_health_pings.c.service == service)
            .order_by(service_health_pings.c.created.desc()).limit(1))
    return await _q1(stmt)


async def history(service: str, limit: int = 60, since: float | None = None) -> list[dict]:
    conditions = [service_health_pings.c.service == service]
    if since is not None:
        conditions.append(service_health_pings.c.created >= since)
    stmt = (select(service_health_pings).where(and_(*conditions))
            .order_by(service_health_pings.c.created.desc()).limit(limit))
    rows = await _q(stmt)
    rows.reverse()
    return rows


async def uptime_pct(service: str, hours: int = 24) -> float | None:
    since = time.time() - hours * 3600
    stmt = select(func.count(), func.sum(service_health_pings.c.ok)).where(and_(
        service_health_pings.c.service == service,
        service_health_pings.c.created >= since))
    async with db._engine.begin() as conn:
        total, ok_sum = (await conn.execute(stmt)).fetchone()
    if not total:
        return None
    return round(100.0 * (ok_sum or 0) / total, 2)
