import asyncio
import json

_subs: dict[str, list[tuple[str | None, asyncio.Queue]]] = {}
_CLOSE_STREAM = object()


def broadcast(sid: str, event_type: str, data: dict) -> None:
    payload = "data: " + json.dumps({"type": event_type, **data}) + "\n\n"
    for _, q in _subs.get(sid, []):
        q.put_nowait(payload)


def disconnect_user(sid: str, user_id: str) -> None:
    for subscriber_user_id, q in _subs.get(sid, []):
        if subscriber_user_id == user_id:
            q.put_nowait(_CLOSE_STREAM)


HEARTBEAT_SECONDS = 20


async def stream(sid: str, user_id: str | None = None):
    q: asyncio.Queue = asyncio.Queue()
    subscriber = (user_id, q)
    _subs.setdefault(sid, []).append(subscriber)
    try:
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if item is _CLOSE_STREAM:
                return
            yield item
    finally:
        subs = _subs.get(sid)
        if subs and subscriber in subs:
            subs.remove(subscriber)
        if subs is not None and not subs:
            _subs.pop(sid, None)
