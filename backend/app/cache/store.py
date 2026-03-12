from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(slots=True)
class CacheState:
    refreshed_at: datetime

    def is_fresh(self, ttl_seconds: int, now: datetime) -> bool:
        return now - self.refreshed_at <= timedelta(seconds=ttl_seconds)


class RequestCache:
    def __init__(self) -> None:
        self._entries: dict[str, CacheState] = {}

    def is_fresh(self, key: str, ttl_seconds: int, now: datetime) -> bool:
        state = self._entries.get(key)
        return state.is_fresh(ttl_seconds, now) if state else False

    def mark(self, key: str, now: datetime) -> None:
        self._entries[key] = CacheState(refreshed_at=now)
