import pytest
from fastapi import HTTPException

from backend import ratelimit


def test_sliding_window_allows_up_to_max_hits():
    w = ratelimit.SlidingWindow(max_hits=3, window=60, message="slow down")
    for _ in range(3):
        w.check_and_record("user-1")


def test_sliding_window_blocks_after_max_hits():
    w = ratelimit.SlidingWindow(max_hits=2, window=60, message="slow down")
    w.check_and_record("user-1")
    w.check_and_record("user-1")
    with pytest.raises(HTTPException) as exc_info:
        w.check_and_record("user-1")
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "slow down"


def test_sliding_window_keys_are_independent():
    w = ratelimit.SlidingWindow(max_hits=1, window=60, message="slow down")
    w.check_and_record("user-1")
    w.check_and_record("user-2")


def test_sliding_window_expires_old_hits(monkeypatch):
    fake_now = [1000.0]
    monkeypatch.setattr(ratelimit.time, "time", lambda: fake_now[0])
    w = ratelimit.SlidingWindow(max_hits=1, window=10, message="slow down")
    w.check_and_record("user-1")
    with pytest.raises(HTTPException):
        w.check("user-1")
    fake_now[0] += 11
    w.check("user-1")


def test_sliding_window_prune_clears_expired_keys(monkeypatch):
    fake_now = [1000.0]
    monkeypatch.setattr(ratelimit.time, "time", lambda: fake_now[0])
    w = ratelimit.SlidingWindow(max_hits=5, window=10, message="slow down")
    w.record("user-1")
    fake_now[0] += 11
    w.prune()
    assert "user-1" not in w._hits


def test_in_flight_blocks_concurrent_same_key():
    f = ratelimit.InFlight("already running")
    f.acquire("job-1")
    with pytest.raises(HTTPException) as exc_info:
        f.acquire("job-1")
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail == "already running"


def test_in_flight_allows_after_release():
    f = ratelimit.InFlight("already running")
    f.acquire("job-1")
    f.release("job-1")
    f.acquire("job-1")


def test_in_flight_independent_keys():
    f = ratelimit.InFlight("already running")
    f.acquire("job-1")
    f.acquire("job-2")


def test_in_flight_release_unknown_key_is_noop():
    f = ratelimit.InFlight("already running")
    f.release("never-acquired")
