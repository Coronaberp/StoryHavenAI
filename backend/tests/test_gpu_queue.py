import asyncio

import pytest

from backend import gpu_queue as gq

pytestmark = pytest.mark.asyncio


def _user(name, **kw):
    return {"username": name, **kw}


def test_priority_ordering():
    assert gq.priority_for(_user("d", role="dev")) == 0
    assert gq.priority_for(_user("a", role="admin")) == 1
    assert gq.priority_for(_user("a2", is_admin=True)) == 1
    assert gq.priority_for(_user("u", tier="full")) == 2
    assert gq.priority_for(_user("u2")) == 2
    assert gq.priority_for(_user("g", tier="guest")) == 3


async def test_queue_grants_in_priority_order(monkeypatch):
    monkeypatch.setattr(gq, "read_gpu_temp", lambda: 50)
    queue = gq.GpuQueue()
    order = []

    await queue.acquire(_user("first"))

    async def worker(user):
        await queue.acquire(user)
        order.append(user["username"])
        queue.release()

    tasks = [asyncio.create_task(worker(_user("guest", tier="guest"))),
             asyncio.create_task(worker(_user("user"))),
             asyncio.create_task(worker(_user("dev", role="dev")))]
    await asyncio.sleep(0.05)
    queue.release()
    await asyncio.gather(*tasks)
    assert order == ["dev", "user", "guest"]


async def test_queue_holds_while_hot_and_resumes(monkeypatch):
    temp = {"value": 90}
    monkeypatch.setattr(gq, "read_gpu_temp", lambda: temp["value"])
    monkeypatch.setattr(gq, "COOLING_POLL_SECONDS", 0.05)
    queue = gq.GpuQueue()
    granted = asyncio.Event()

    async def worker():
        await queue.acquire(_user("u"))
        granted.set()
        queue.release()

    task = asyncio.create_task(worker())
    await asyncio.sleep(0.1)
    assert not granted.is_set() and queue.status()["cooling"] is True
    temp["value"] = 70
    await asyncio.wait_for(granted.wait(), timeout=2)
    await task
    assert queue.status()["cooling"] is False


async def test_missing_temp_feed_fails_open(monkeypatch):
    monkeypatch.setattr(gq, "read_gpu_temp", lambda: None)
    queue = gq.GpuQueue()
    await asyncio.wait_for(queue.acquire(_user("u")), timeout=1)
    queue.release()
