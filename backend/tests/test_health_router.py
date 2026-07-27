import asyncio

import pytest

from backend.routers import health as health_router

pytestmark = pytest.mark.asyncio

async def test_run_check_bounded_returns_result_when_fast():
    async def fast_check():
        return True, 12.5, ""

    ok, latency_ms, error = await health_router._run_check_bounded("test", fast_check)
    assert ok is True
    assert latency_ms == 12.5
    assert error == ""

async def test_run_check_bounded_times_out_slow_check(monkeypatch):
    monkeypatch.setattr(health_router, "_CHECK_TIMEOUT_SECONDS", 0.05)

    async def hanging_check():
        await asyncio.sleep(1)
        return True, 1.0, ""

    ok, latency_ms, error = await health_router._run_check_bounded("test", hanging_check)
    assert ok is False
    assert latency_ms is None
    assert "timed out" in error

async def test_service_health_get_does_not_run_live_checks(db_conn, monkeypatch):
    from backend.routers import health as health_router

    async def must_not_run():
        raise AssertionError("live checks ran on GET")

    monkeypatch.setattr(health_router, "run_all_checks_and_record", must_not_run)
    result = await health_router.admin_service_health(hours=1, _={"id": "a", "is_admin": True})
    assert "services" in result


async def test_service_health_refresh_runs_live_checks(db_conn, monkeypatch):
    from backend.routers import health as health_router

    calls = []

    async def fake_checks():
        calls.append(1)
        return {name: (True, 5.0, "") for name in health_router.SERVICES}

    monkeypatch.setattr(health_router, "run_all_checks_and_record", fake_checks)
    result = await health_router.admin_service_health_refresh(_={"id": "a", "is_admin": True})
    assert calls == [1]
    assert {s["name"] for s in result["services"]} == set(health_router.SERVICES)

async def test_media_gen_status_available_with_hosted_provider(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG

    monkeypatch.setitem(CFG, "image_provider", "stability")

    async def must_not_read(name):
        raise AssertionError("comfyui ping read with hosted provider active")

    monkeypatch.setattr(health_router.health_repo, "latest_ping", must_not_read)
    result = await health_router.media_gen_status(_={"id": "u"})
    assert result == {"available": True}


async def test_media_gen_status_still_uses_ping_for_comfyui(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG

    monkeypatch.setitem(CFG, "image_provider", "comfyui")

    async def fake_ping(name):
        return {"ok": 0}

    monkeypatch.setattr(health_router.health_repo, "latest_ping", fake_ping)
    result = await health_router.media_gen_status(_={"id": "u"})
    assert result == {"available": False}

async def test_admin_model_latency_returns_configured_proxies_sorted_by_priority(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG

    monkeypatch.setitem(CFG, "chat_proxies", [
        {"name": "Second", "base_url": "http://b", "priority": 1,
         "icon_type": "favicon", "icon_value": ""},
        {"name": "First", "base_url": "http://a", "priority": 0,
         "icon_type": "svg", "icon_value": "<svg></svg>"},
    ])
    result = await health_router.admin_model_latency(hours=24, _={"id": "a", "is_admin": True})
    names = [m["name"] for m in result["models"]]
    assert names == ["First", "Second"]
    assert result["models"][0]["icon_type"] == "svg"
    assert result["models"][0]["icon_value"] == "<svg></svg>"

async def test_admin_model_latency_includes_recorded_history(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG
    from backend.repositories import health as health_repo

    monkeypatch.setitem(CFG, "chat_proxies", [
        {"name": "Only One", "base_url": "http://a", "priority": 0,
         "icon_type": "favicon", "icon_value": ""},
    ])
    await health_repo.record_ping("model:Only One", True, 1234.5, "")
    result = await health_router.admin_model_latency(hours=24, _={"id": "a", "is_admin": True})
    model = result["models"][0]
    assert model["latest_latency_ms"] == 1234.5
    assert model["avg_latency_ms"] == 1234.5
    assert model["success_pct"] == 100.0
    assert len(model["latency_history"]) == 1
    assert model["latency_history"][0]["ms"] == 1234.5

async def test_admin_model_latency_with_no_history_returns_nulls(db_conn, monkeypatch):
    from backend.routers import health as health_router
    from backend.state import CFG

    monkeypatch.setitem(CFG, "chat_proxies", [
        {"name": "Untested", "base_url": "http://a", "priority": 0,
         "icon_type": "favicon", "icon_value": ""},
    ])
    result = await health_router.admin_model_latency(hours=24, _={"id": "a", "is_admin": True})
    model = result["models"][0]
    assert model["latest_latency_ms"] is None
    assert model["avg_latency_ms"] is None
    assert model["latency_history"] == []
