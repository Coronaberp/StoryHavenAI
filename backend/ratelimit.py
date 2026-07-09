"""In-memory sliding-window and in-flight rate limiters shared across routes."""
import time

from fastapi import HTTPException


class SlidingWindow:
    def __init__(self, max_hits: int, window: float, message: str):
        self.max_hits = max_hits
        self.window = window
        self.message = message
        self._hits: dict = {}

    def _fresh(self, key) -> list:
        now = time.time()
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        if hits:
            self._hits[key] = hits
        else:
            self._hits.pop(key, None)
        return hits

    def check(self, key):
        if len(self._fresh(key)) >= self.max_hits:
            raise HTTPException(429, self.message)

    def record(self, key):
        self._hits.setdefault(key, []).append(time.time())

    def check_and_record(self, key):
        self.check(key)
        self.record(key)

    def prune(self):
        for key in list(self._hits):
            self._fresh(key)


class InFlight:
    def __init__(self, message: str):
        self.message = message
        self._active: set = set()

    def acquire(self, key):
        if key in self._active:
            raise HTTPException(429, self.message)
        self._active.add(key)

    def release(self, key):
        self._active.discard(key)
