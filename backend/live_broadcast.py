import asyncio
import json

_subs: dict[str, list[asyncio.Queue]] = {}


def broadcast(sid: str, event_type: str, data: dict) -> None:
    payload = "data: " + json.dumps({"type": event_type, **data}) + "\n\n"
    for q in _subs.get(sid, []):
        q.put_nowait(payload)


HEARTBEAT_SECONDS = 20


async def stream(sid: str):
    q: asyncio.Queue = asyncio.Queue()
    _subs.setdefault(sid, []).append(q)
    try:
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                continue
            yield item
    finally:
        subs = _subs.get(sid)
        if subs and q in subs:
            subs.remove(q)
        if subs is not None and not subs:
            _subs.pop(sid, None)
