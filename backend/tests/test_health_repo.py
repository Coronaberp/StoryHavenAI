import time

import pytest

from backend.repositories import health as health_repo

pytestmark = pytest.mark.asyncio

async def test_record_and_latest_ping(db_conn):
    assert await health_repo.latest_ping("test-service") is None

    await health_repo.record_ping("test-service", True, 12.5)
    latest = await health_repo.latest_ping("test-service")
    assert latest["ok"] == 1
    assert latest["latency_ms"] == 12.5
    assert latest["error"] == ""

    await health_repo.record_ping("test-service", False, None, "connection refused")
    latest = await health_repo.latest_ping("test-service")
    assert latest["ok"] == 0
    assert latest["error"] == "connection refused"

async def test_history_returns_oldest_first(db_conn):
    for ok in (True, True, False):
        await health_repo.record_ping("history-service", ok, 1.0)
    history = await health_repo.history("history-service", limit=10)
    assert len(history) == 3
    assert [h["ok"] for h in history] == [1, 1, 0]

async def test_history_respects_since(db_conn):
    await health_repo.record_ping("since-service", True, 1.0)
    future_cutoff = time.time() + 3600
    history = await health_repo.history("since-service", limit=10, since=future_cutoff)
    assert history == []

async def test_uptime_pct(db_conn):
    assert await health_repo.uptime_pct("uptime-service") is None
    await health_repo.record_ping("uptime-service", True, 1.0)
    await health_repo.record_ping("uptime-service", True, 1.0)
    await health_repo.record_ping("uptime-service", False, None, "err")
    pct = await health_repo.uptime_pct("uptime-service", hours=24)
    assert pct == pytest.approx(66.67, abs=0.01)

async def test_prune_old_pings_keeps_recent(db_conn):
    await health_repo.record_ping("prune-service", True, 1.0)
    await health_repo.prune_old_pings(older_than_days=7)
    assert await health_repo.latest_ping("prune-service") is not None
