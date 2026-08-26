"""Small in-memory sliding-window rate limiter for single-instance auth endpoints."""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after: int = 0


class InMemoryAuthRateLimiter:
    """Bounded process-local limiter; distributed guarantees are out of scope."""

    def __init__(self, *, max_keys: int = 4096, now=None) -> None:
        self.max_keys = max(1, int(max_keys))
        self._now = now or time.monotonic
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, *, limit: int, window_seconds: float) -> RateLimitDecision:
        now = float(self._now())
        with self._lock:
            self._prune(now)
            events = self._events.get(key)
            if events is None:
                events = self._new_key(key)
            cutoff = now - float(window_seconds)
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                retry = max(1, int(events[0] + window_seconds - now + 0.999))
                return RateLimitDecision(False, retry)
            return RateLimitDecision(True)

    def record_failure(self, key: str, *, window_seconds: float) -> None:
        now = float(self._now())
        with self._lock:
            self._prune(now)
            self._new_key(key).append(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def _prune(self, now: float) -> None:
        for key, events in list(self._events.items()):
            while events and events[0] <= now - 900:
                events.popleft()
            if not events:
                self._events.pop(key, None)

    def _new_key(self, key: str) -> deque[float]:
        events = self._events.get(key)
        if events is not None:
            return events
        if len(self._events) >= self.max_keys:
            # Evict the least recently active bucket. This is only a memory
            # bound; it must never affect the sliding-window decision for an
            # existing bucket while that bucket remains retained.
            oldest_key = min(
                self._events,
                key=lambda item: self._events[item][-1] if self._events[item] else float("-inf"),
            )
            self._events.pop(oldest_key, None)
        events = deque()
        self._events[key] = events
        return events


__all__ = ["InMemoryAuthRateLimiter", "RateLimitDecision"]
