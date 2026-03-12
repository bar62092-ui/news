from __future__ import annotations

import asyncio
from datetime import timedelta

from ..config import Settings
from ..country_catalog import CountryCatalog
from ..models import ProviderStatus, utc_now
from ..providers.news import CombinedNewsProvider
from ..providers.trends import TrendProvider
from ..repository import WorldWatchRepository


class NewsRefreshCoordinator:
    def __init__(
        self,
        repository: WorldWatchRepository,
        catalog: CountryCatalog,
        provider: CombinedNewsProvider,
        trend_provider: TrendProvider,
        settings: Settings,
    ) -> None:
        self.repository = repository
        self.catalog = catalog
        self.provider = provider
        self.trend_provider = trend_provider
        self.settings = settings
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._shutdown = False

    async def start_watchlist_loop(self) -> None:
        while not self._shutdown:
            for iso2 in self.settings.watchlist_countries:
                await self.refresh_country(iso2)
            self.repository.cleanup(
                news_days=self.settings.news_retention_days,
                topic_hours=self.settings.topic_retention_hours,
                track_minutes=self.settings.track_retention_minutes,
            )
            await asyncio.sleep(self.settings.watchlist_refresh_minutes * 60)

    async def stop(self) -> None:
        self._shutdown = True
        tasks = [task for task in self._tasks.values() if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def get_country_news_payload(self, iso2: str, limit: int = 20) -> dict[str, object]:
        iso2 = iso2.upper()
        cached = self.repository.list_news(iso2, limit=limit)
        refresh_state = self.repository.get_country_refresh_state(iso2)
        if not cached:
            await self.refresh_country(iso2)
            cached = self.repository.list_news(iso2, limit=limit)
            refresh_state = self.repository.get_country_refresh_state(iso2)
        elif self._is_stale(refresh_state.get("lastNewsRefreshAt")):
            self.ensure_refresh(iso2)
        return {
            "items": cached,
            "stale": self._is_stale(refresh_state.get("lastNewsRefreshAt")),
            "lastRefreshAt": refresh_state.get("lastNewsRefreshAt"),
            "status": refresh_state.get("lastNewsStatus"),
        }

    async def get_country_topics(self, iso2: str) -> list[dict[str, object]]:
        iso2 = iso2.upper()
        topics = self.repository.list_topics(iso2)
        if not topics:
            await self.refresh_country(iso2)
            topics = self.repository.list_topics(iso2)
        return topics

    def ensure_refresh(self, iso2: str) -> None:
        iso2 = iso2.upper()
        task = self._tasks.get(iso2)
        if task and not task.done():
            return
        self._tasks[iso2] = asyncio.create_task(self.refresh_country(iso2))

    async def refresh_country(self, iso2: str) -> None:
        iso2 = iso2.upper()
        country = self.catalog.get(iso2)
        if country is None:
            return
        try:
            result = await self.provider.fetch_country_news(country, self.catalog.search_terms(iso2))
            refreshed_at = utc_now()
            self.repository.store_news(iso2, result.items, refreshed_at)
            self.repository.set_country_news_refresh(iso2, "updated", refreshed_at)
            for status in result.statuses:
                self.repository.update_provider_health(status)
            topics = await self.trend_provider.fetch_country_trends(iso2, window_hours=6)
            self.repository.replace_topics(iso2, topics, refreshed_at)
            self.repository.update_provider_health(
                ProviderStatus(
                    provider_name="trends:news-cluster",
                    ok=True,
                    status_text="Topicos recalculados",
                    detail={"country": iso2, "topics": len(topics)},
                )
            )
        except Exception as exc:  # noqa: BLE001
            self.repository.set_country_news_refresh(iso2, "stale", utc_now())
            self.repository.update_provider_health(
                ProviderStatus(
                    provider_name="news-refresh",
                    ok=False,
                    status_text="Falha ao atualizar noticias",
                    detail={"country": iso2, "error": str(exc)},
                )
            )

    def _is_stale(self, value: str | None) -> bool:
        from ..models import parse_datetime

        if value is None:
            return True
        parsed = parse_datetime(value)
        if parsed is None:
            return True
        return utc_now() - parsed > timedelta(minutes=self.settings.news_ttl_minutes)
