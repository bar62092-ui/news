from __future__ import annotations

import asyncio
from datetime import timedelta

from ..cache.store import RequestCache
from ..models import BBox, ProviderStatus, utc_now
from ..providers.traffic import AisStreamProvider, OpenSkyProvider, aggregate_aircraft, aggregate_vessels
from ..repository import WorldWatchRepository


def _bbox_key(bbox: BBox) -> str:
    return ",".join(f"{value:.2f}" for value in bbox)


class TrafficCoordinator:
    def __init__(
        self,
        repository: WorldWatchRepository,
        air_provider: OpenSkyProvider,
        sea_provider: AisStreamProvider,
        air_ttl_seconds: int,
        sea_ttl_seconds: int,
    ) -> None:
        self.repository = repository
        self.air_provider = air_provider
        self.sea_provider = sea_provider
        self.air_ttl_seconds = air_ttl_seconds
        self.sea_ttl_seconds = sea_ttl_seconds
        self._air_cache = RequestCache()
        self._sea_cache = RequestCache()
        self._locks: dict[str, asyncio.Lock] = {}

    async def get_air_snapshot(self, bbox: BBox) -> dict[str, object]:
        key = f"air:{_bbox_key(bbox)}"
        await self._refresh_air_if_needed(key, bbox)
        since = utc_now() - timedelta(minutes=90)
        items = self.repository.list_air_tracks(bbox, since)
        stale = not self._air_cache.is_fresh(key, self.air_ttl_seconds, utc_now())
        return {
            "stale": stale,
            "updatedAt": utc_now().isoformat(),
            "items": aggregate_aircraft(items),
        }

    async def get_sea_snapshot(self, bbox: BBox) -> dict[str, object]:
        key = f"sea:{_bbox_key(bbox)}"
        await self._refresh_sea_if_needed(key, bbox)
        since = utc_now() - timedelta(minutes=90)
        items = self.repository.list_sea_tracks(bbox, since)
        stale = not self._sea_cache.is_fresh(key, self.sea_ttl_seconds, utc_now())
        return {
            "stale": stale,
            "updatedAt": utc_now().isoformat(),
            "items": aggregate_vessels(items),
        }

    async def _refresh_air_if_needed(self, key: str, bbox: BBox) -> None:
        now = utc_now()
        if self._air_cache.is_fresh(key, self.air_ttl_seconds, now):
            return
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if self._air_cache.is_fresh(key, self.air_ttl_seconds, utc_now()):
                return
            try:
                items = await self.air_provider.fetch_bbox(bbox)
            except Exception as exc:  # noqa: BLE001
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name=self.air_provider.provider_name,
                        ok=False,
                        status_text="Falha na coleta aerea",
                        detail={"bbox": list(bbox), "error": str(exc)},
                    )
                )
            else:
                self.repository.store_air_tracks(items)
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name=self.air_provider.provider_name,
                        ok=True,
                        status_text="Rotas aereas atualizadas",
                        detail={"bbox": list(bbox), "items": len(items)},
                    )
                )
                self._air_cache.mark(key, utc_now())

    async def _refresh_sea_if_needed(self, key: str, bbox: BBox) -> None:
        now = utc_now()
        if self._sea_cache.is_fresh(key, self.sea_ttl_seconds, now):
            return
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if self._sea_cache.is_fresh(key, self.sea_ttl_seconds, utc_now()):
                return
            try:
                items = await self.sea_provider.fetch_bbox(bbox)
            except Exception as exc:  # noqa: BLE001
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name=self.sea_provider.provider_name,
                        ok=False,
                        status_text="Falha na coleta maritima",
                        detail={"bbox": list(bbox), "error": str(exc)},
                    )
                )
            else:
                self.repository.store_sea_tracks(items)
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name=self.sea_provider.provider_name,
                        ok=True,
                        status_text="Rotas maritimas atualizadas",
                        detail={"bbox": list(bbox), "items": len(items)},
                    )
                )
                self._sea_cache.mark(key, utc_now())
