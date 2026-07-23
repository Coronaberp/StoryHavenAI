import asyncio
import json

import pytest

from backend import live_broadcast

pytestmark = pytest.mark.asyncio


async def test_broadcast_fans_out_to_all_subscribers():
    gen_a = live_broadcast.stream("sess-1")
    gen_b = live_broadcast.stream("sess-1")
    task_a = asyncio.ensure_future(gen_a.__anext__())
    task_b = asyncio.ensure_future(gen_b.__anext__())
    await asyncio.sleep(0)
    live_broadcast.broadcast("sess-1", "message", {"content": "hi"})
    payload_a = await asyncio.wait_for(task_a, timeout=1)
    payload_b = await asyncio.wait_for(task_b, timeout=1)
    assert payload_a == payload_b
    assert json.loads(payload_a.removeprefix("data: ").strip())["type"] == "message"
    await gen_a.aclose()
    await gen_b.aclose()


async def test_broadcast_does_not_leak_across_sessions():
    gen = live_broadcast.stream("sess-2")
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)
    live_broadcast.broadcast("sess-other", "message", {"content": "not for you"})
    live_broadcast.broadcast("sess-2", "message", {"content": "for you"})
    payload = await asyncio.wait_for(task, timeout=1)
    assert json.loads(payload.removeprefix("data: ").strip())["content"] == "for you"
    await gen.aclose()


async def test_heartbeat_sent_when_idle(monkeypatch):
    monkeypatch.setattr(live_broadcast, "HEARTBEAT_SECONDS", 0.05)
    gen = live_broadcast.stream("sess-heartbeat")
    payload = await asyncio.wait_for(gen.__anext__(), timeout=1)
    assert payload == ": keep-alive\n\n"
    await gen.aclose()


async def test_subscriber_removed_on_close():
    gen = live_broadcast.stream("sess-3")
    task = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0)
    assert len(live_broadcast._subs["sess-3"]) == 1
    live_broadcast.broadcast("sess-3", "ping", {})
    await asyncio.wait_for(task, timeout=1)
    await gen.aclose()
    await asyncio.sleep(0)
    assert "sess-3" not in live_broadcast._subs
