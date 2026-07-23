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
