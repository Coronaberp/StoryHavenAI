"""Admin service-health dashboard: live dependency checks + uptime history.

Each dependency (database, chat LLM, embed LLM, ComfyUI) is pinged on demand
when an admin opens the panel, and also on a periodic background loop (started
in server.py's lifespan) so the uptime-% and sparkline have data even when no
admin is looking. Pings are recorded in db.service_health_pings and pruned
after a week.
"""
import time
import asyncio

import httpx
import sqlalchemy as sa
from fastapi import Depends

from backend import db
from backend import llm
from backend.state import api, CFG, VISION_CLASSIFY, log, PROCESS_START_TIME
from backend.auth import get_admin

SERVICES = ("database", "chat_llm", "embed_llm", "comfyui", "image_classify_llm")


async def _check_database() -> tuple[bool, float | None, str]:
    t0 = time.monotonic()
    try:
        async with db._engine.begin() as conn:
            await conn.execute(sa.text("SELECT 1"))
        return True, (time.monotonic() - t0) * 1000, ""
    except Exception as e:
        return False, None, str(e)


async def _check_chat_llm() -> tuple[bool, float | None, str]:
    t0 = time.monotonic()
    try:
        await llm.list_models(CFG["base_url"], CFG.get("api_key") or None)
        return True, (time.monotonic() - t0) * 1000, ""
    except Exception as e:
        return False, None, str(e)


async def _check_embed_llm() -> tuple[bool, float | None, str]:
    t0 = time.monotonic()
    try:
        await llm.embed("health check", CFG["embed_model"])
        return True, (time.monotonic() - t0) * 1000, ""
    except Exception as e:
        return False, None, str(e)


async def _check_image_classify_llm() -> tuple[bool, float | None, str]:
    # The dedicated vision endpoint used for NSFW auto-classification
    # (VISION_CLASSIFY) is deliberately decoupled from the general chat
    # endpoint above — CFG["base_url"] can be overlaid to an unrelated cloud
    # text-only API, so this checks the actual Gemma vision model directly.
    t0 = time.monotonic()
    try:
        await llm.list_models(VISION_CLASSIFY["base_url"], VISION_CLASSIFY["api_key"] or None)
        return True, (time.monotonic() - t0) * 1000, ""
    except Exception as e:
        return False, None, str(e)


async def _check_comfyui() -> tuple[bool, float | None, str]:
    root = (CFG.get("comfyui_url") or "").rstrip("/")
    if not root:
        return False, None, "no comfyui_url configured"
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{root}/system_stats")
            r.raise_for_status()
        return True, (time.monotonic() - t0) * 1000, ""
    except Exception as e:
        return False, None, str(e)


_CHECKS = {
    "database": _check_database,
    "chat_llm": _check_chat_llm,
    "embed_llm": _check_embed_llm,
    "comfyui": _check_comfyui,
    "image_classify_llm": _check_image_classify_llm,
}


async def run_all_checks_and_record() -> dict[str, tuple[bool, float | None, str]]:
    out = {}
    for name, fn in _CHECKS.items():
        ok, latency_ms, error = await fn()
        out[name] = (ok, latency_ms, error)
        try:
            await db.record_health_ping(name, ok, latency_ms, error)
        except Exception:
            log.exception("service-health: failed to record ping for %s", name)
    return out


async def health_ping_loop():
    while True:
        try:
            await run_all_checks_and_record()
            await db.prune_health_pings(older_than_days=7)
        except Exception:
            log.exception("service-health: background ping loop failed")
        await asyncio.sleep(5 * 60)


@api.get("/admin/service-health")
async def admin_service_health(hours: float = 24, _: dict = Depends(get_admin)):
    # Ping cadence is one per 5 minutes (see the background loop below), so
    # cap how many rows a wide range can pull back — 7 days at that cadence
    # is ~2016 rows, comfortably under this limit.
    limit = min(int(hours * 60 / 5) + 5, 3000)
    since = time.time() - hours * 3600
    live = await run_all_checks_and_record()
    services = []
    for name in SERVICES:
        ok, latency_ms, error = live[name]
        history = await db.health_history(name, limit=limit, since=since)
        uptime_24h = await db.health_uptime_pct(name, hours=24)
        latencies = [h["latency_ms"] for h in history if h["latency_ms"] is not None]
        avg_latency_ms = round(sum(latencies) / len(latencies), 1) if latencies else None
        services.append({
            "name": name,
            "ok": ok,
            "latency_ms": round(latency_ms, 1) if latency_ms is not None else None,
            "avg_latency_ms": avg_latency_ms,
            "error": error,
            "checked_at": time.time(),
            "uptime_pct_24h": uptime_24h,
            "history": [bool(h["ok"]) for h in history],
            "latency_history": [
                {"t": h["created"], "ok": bool(h["ok"]),
                 "ms": round(h["latency_ms"], 1) if h["latency_ms"] is not None else None}
                for h in history
            ],
        })
    return {
        "process_uptime_seconds": round(time.time() - PROCESS_START_TIME, 1),
        "services": services,
    }
