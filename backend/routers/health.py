import time
import asyncio

import httpx
import sqlalchemy as sa
from fastapi import Depends

from backend import db
from backend import llm
from backend import modal_provision
from backend.repositories import health as health_repo
from backend.repositories import lora_training as lora_training_repo
from backend.state import api, CFG, VISION_CLASSIFY, log, PROCESS_START_TIME
from backend.auth import get_admin, get_current_user

SERVICES = ("database", "chat_llm", "embed_llm", "comfyui", "image_classify_llm", "modal")

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

async def _check_modal() -> tuple[bool, float | None, str]:

    active = await lora_training_repo.list_jobs()
    if not any(j["status"] in ("queued", "provisioning", "training") for j in active):
        return True, None, ""
    url, secret = CFG.get("modal_checkpoint_url"), CFG.get("modal_shared_secret")
    if not url or not secret:
        return False, None, "a job is in progress but Modal was never successfully deployed for it"
    t0 = time.monotonic()
    try:
        alive = await modal_provision._is_alive(url, secret)
        latency_ms = (time.monotonic() - t0) * 1000
        return alive, latency_ms, ("" if alive else "a job is in progress but the deployed app isn't responding "
                                                    "(stopped from the Modal dashboard?)")
    except Exception as e:
        return False, None, str(e)

_CHECKS = {
    "database": _check_database,
    "chat_llm": _check_chat_llm,
    "embed_llm": _check_embed_llm,
    "comfyui": _check_comfyui,
    "image_classify_llm": _check_image_classify_llm,
    "modal": _check_modal,
}

_CHECK_TIMEOUT_SECONDS = 5.0

async def _run_check_bounded(name: str, fn) -> tuple[bool, float | None, str]:
    try:
        return await asyncio.wait_for(fn(), timeout=_CHECK_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return False, None, f"timed out after {_CHECK_TIMEOUT_SECONDS:.0f}s"

async def run_all_checks_and_record() -> dict[str, tuple[bool, float | None, str]]:

    names = list(_CHECKS.keys())
    results = await asyncio.gather(*(_run_check_bounded(name, _CHECKS[name]) for name in names))
    out = {name: result for name, result in zip(names, results)}

    async def _record(name, ok, latency_ms, error):
        try:
            await health_repo.record_ping(name, ok, latency_ms, error)
        except Exception:
            log.exception("service-health: failed to record ping for %s", name)

    await asyncio.gather(*(_record(name, *out[name]) for name in names))
    return out

async def health_ping_loop():
    while True:
        try:
            await run_all_checks_and_record()
            await health_repo.prune_old_pings(older_than_days=7)
        except Exception:
            log.exception("service-health: background ping loop failed")
        await asyncio.sleep(5 * 60)

@api.get("/media-gen-status")
async def media_gen_status(_: dict = Depends(get_current_user)):
    if (CFG.get("image_provider") or "comfyui") != "comfyui":
        return {"available": True}
    ping = await health_repo.latest_ping("comfyui")
    available = True if ping is None else bool(ping["ok"])
    return {"available": available}

@api.post("/admin/service-health/refresh")
async def admin_service_health_refresh(_: dict = Depends(get_admin)):
    results = await run_all_checks_and_record()
    services = [{"name": name, "ok": results[name][0],
                 "latency_ms": results[name][1], "error": results[name][2]}
                for name in SERVICES]
    log.info("service-health: manual refresh ran %d checks", len(services))
    return {"services": services}

@api.get("/admin/service-health")
async def admin_service_health(hours: float = 24, _: dict = Depends(get_admin)):

    limit = min(int(hours * 60 / 5) + 5, 3000)
    since = time.time() - hours * 3600
    live = {}
    for name in SERVICES:
        ping = await health_repo.latest_ping(name)
        if ping is None:
            live[name] = (False, None, "no data yet")
        else:
            live[name] = (bool(ping["ok"]), ping.get("latency_ms"), ping.get("error") or "")
    history_results, uptime_results = await asyncio.gather(
        asyncio.gather(*(health_repo.history(name, limit=limit, since=since) for name in SERVICES)),
        asyncio.gather(*(health_repo.uptime_pct(name, hours=24) for name in SERVICES)),
    )
    services = []
    for name, history, uptime_24h in zip(SERVICES, history_results, uptime_results):
        ok, latency_ms, error = live[name]
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
