import time
import heapq
import asyncio
import itertools
from pathlib import Path

from backend.state import CFG, log

TEMP_FILE = Path("storyhavenai.gputemp")
TEMP_STALE_SECONDS = 30
COOLING_POLL_SECONDS = 5

TIER_PRIORITIES = {"dev": 0, "admin": 1, "full": 2, "guest": 3}


def priority_for(user: dict) -> int:
    if user.get("role") == "dev":
        return TIER_PRIORITIES["dev"]
    if user.get("role") == "admin" or user.get("is_admin"):
        return TIER_PRIORITIES["admin"]
    if (user.get("tier") or "full") == "guest":
        return TIER_PRIORITIES["guest"]
    return TIER_PRIORITIES["full"]


def read_gpu_temp() -> int | None:
    try:
        if time.time() - TEMP_FILE.stat().st_mtime > TEMP_STALE_SECONDS:
            return None
        return int(TEMP_FILE.read_text().strip())
    except (OSError, ValueError):
        return None


class GpuQueue:
    def __init__(self):
        self._waiters: list[tuple[int, int, asyncio.Future]] = []
        self._seq = itertools.count()
        self._busy = False
        self._cooling = False
        self._pump_task: asyncio.Task | None = None

    def _too_hot(self) -> tuple[bool, int | None]:
        temp = read_gpu_temp()
        if temp is None:
            if self._cooling:
                self._cooling = False
                log.warning("gpu_queue: temperature feed lost - thermal gate disabled")
            return False, None
        limit = int(CFG.get("gpu_temp_limit") or 83)
        resume = int(CFG.get("gpu_temp_resume") or 75)
        if self._cooling:
            if temp <= resume:
                self._cooling = False
                log.info("gpu_queue: GPU cooled to %s°C - resuming generation", temp)
        elif temp >= limit:
            self._cooling = True
            log.warning("gpu_queue: GPU at %s°C (limit %s) - holding generation until <= %s°C",
                        temp, limit, resume)
        return self._cooling, temp

    def _pump(self):
        if self._busy or not self._waiters:
            return
        hot, _ = self._too_hot()
        if hot:
            if not self._pump_task or self._pump_task.done():
                self._pump_task = asyncio.create_task(self._pump_later())
            return
        while self._waiters:
            _, _, fut = heapq.heappop(self._waiters)
            if fut.done():
                continue
            self._busy = True
            fut.set_result(None)
            return

    async def _pump_later(self):
        await asyncio.sleep(COOLING_POLL_SECONDS)
        self._pump_task = None
        self._pump()

    async def acquire(self, user: dict):
        fut = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (priority_for(user), next(self._seq), fut))
        self._pump()
        try:
            await fut
        except asyncio.CancelledError:
            if not fut.done():
                fut.cancel()
            else:
                self.release()
            raise
        log.info("gpu_queue: slot granted user=%s queued=%s", user.get("username"), len(self._waiters))

    def release(self):
        self._busy = False
        self._pump()

    def status(self) -> dict:
        cooling, temp = self._cooling, read_gpu_temp()
        return {"queued": sum(1 for _, _, f in self._waiters if not f.done()),
                "busy": self._busy, "gpu_temp": temp, "cooling": cooling}


gpu_queue = GpuQueue()
