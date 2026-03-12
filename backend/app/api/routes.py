from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..collectors.news import NewsRefreshCoordinator
from ..collectors.traffic import TrafficCoordinator
from ..config import Settings
from ..country_catalog import CountryCatalog
from ..database import Database
from ..models import BBox, LiveSubscription, utc_now
from ..providers.news import CombinedNewsProvider, GdeltNewsProvider, GoogleNewsRssProvider
from ..providers.traffic import AisStreamProvider, OpenSkyProvider
from ..providers.trends import NewsClusterTrendProvider, XTrendProvider
from ..repository import WorldWatchRepository

WORLD_BBOX: BBox = (-179.9, -60.0, 179.9, 85.0)


@dataclass(slots=True)
class AppServices:
    settings: Settings
    catalog: CountryCatalog
    repository: WorldWatchRepository
    http_client: httpx.AsyncClient
    news: NewsRefreshCoordinator
    traffic: TrafficCoordinator
    x_trends: XTrendProvider
    watchlist_task: asyncio.Task[None] | None = None


def build_services(settings: Settings) -> AppServices:
    database = Database(settings.database_path)
    database.initialize()
    repository = WorldWatchRepository(database)
    catalog = CountryCatalog(settings.shared_country_path)
    repository.seed_countries(catalog.list_countries())
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=10.0),
        headers={"User-Agent": "world-watch/0.1"},
        follow_redirects=True,
    )
    news_provider = CombinedNewsProvider(
        gdelt=GdeltNewsProvider(client, max_records=settings.gdelt_max_records),
        rss=GoogleNewsRssProvider(client, locale=settings.google_news_locale),
    )
    news = NewsRefreshCoordinator(
        repository=repository,
        catalog=catalog,
        provider=news_provider,
        trend_provider=NewsClusterTrendProvider(repository),
        settings=settings,
    )
    traffic = TrafficCoordinator(
        repository=repository,
        air_provider=OpenSkyProvider(
            client=client,
            catalog=catalog,
            username=settings.opensky_username,
            password=settings.opensky_password,
        ),
        sea_provider=AisStreamProvider(api_key=settings.aisstream_api_key),
        air_ttl_seconds=settings.air_ttl_seconds,
        sea_ttl_seconds=settings.sea_ttl_seconds,
    )
    return AppServices(
        settings=settings,
        catalog=catalog,
        repository=repository,
        http_client=client,
        news=news,
        traffic=traffic,
        x_trends=XTrendProvider(),
    )


def create_api_router(services: AppServices) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/bootstrap")
    async def get_bootstrap() -> dict[str, Any]:
        return {
            "generatedAt": utc_now().isoformat(),
            "worldBbox": list(WORLD_BBOX),
            "layers": {
                "air": True,
                "sea": True,
                "news": True,
                "trends": True,
                "x": services.settings.x_enabled,
            },
            "countries": services.repository.list_country_summaries(),
            "providers": services.repository.list_provider_health(),
        }

    @router.get("/countries/{iso2}")
    async def get_country(iso2: str) -> dict[str, Any]:
        summary = services.repository.get_country_summary(iso2)
        if summary is None:
            raise HTTPException(status_code=404, detail="Country not found")
        summary["providers"] = services.repository.list_provider_health()
        return summary

    @router.get("/countries/{iso2}/news")
    async def get_country_news(iso2: str, limit: int = 20) -> dict[str, Any]:
        country = services.catalog.get(iso2)
        if country is None:
            raise HTTPException(status_code=404, detail="Country not found")
        limit = max(1, min(limit, 50))
        summary = services.repository.get_country_summary(iso2)
        payload = await services.news.get_country_news_payload(iso2, limit=limit)
        return {
            "country": summary,
            "items": payload["items"],
            "stale": payload["stale"],
            "lastRefreshAt": payload["lastRefreshAt"],
            "status": payload["status"],
        }

    @router.get("/countries/{iso2}/topics")
    async def get_country_topics(iso2: str) -> dict[str, Any]:
        country = services.catalog.get(iso2)
        if country is None:
            raise HTTPException(status_code=404, detail="Country not found")
        topics = await services.news.get_country_topics(iso2)
        x_topics = await services.x_trends.fetch_country_trends(iso2)
        return {
            "country": services.repository.get_country_summary(iso2),
            "items": topics,
            "xItems": [topic.to_dict() for topic in x_topics],
            "xEnabled": services.settings.x_enabled,
        }

    @router.get("/traffic/air")
    async def get_air_traffic(bbox: str, countryIso2: str | None = None) -> dict[str, Any]:
        parsed = _parse_bbox_query(bbox)
        payload = await services.traffic.get_air_snapshot(parsed, preferred_country_iso2=countryIso2.upper() if countryIso2 else None)
        return {
            "bbox": list(parsed),
            **payload,
        }

    @router.get("/traffic/sea")
    async def get_sea_traffic(bbox: str, countryIso2: str | None = None) -> dict[str, Any]:
        parsed = _parse_bbox_query(bbox)
        payload = await services.traffic.get_sea_snapshot(parsed, preferred_country_iso2=countryIso2.upper() if countryIso2 else None)
        return {
            "bbox": list(parsed),
            **payload,
        }

    @router.get("/providers")
    async def get_provider_health() -> dict[str, Any]:
        return {
            "generatedAt": utc_now().isoformat(),
            "items": services.repository.list_provider_health(),
        }

    @router.get("/healthz")
    async def get_health() -> dict[str, Any]:
        return {
            "ok": True,
            "generatedAt": utc_now().isoformat(),
        }

    return router


def mount_frontend(app: FastAPI, dist_path: Path) -> None:
    assets_path = dist_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="world-watch-assets")

    @app.get("/")
    async def index():
        index_file = dist_path / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
        return {"message": "Frontend nao gerado ainda. Rode o Vite em /frontend."}


async def websocket_live(websocket: WebSocket, services: AppServices) -> None:
    await websocket.accept()
    subscription = LiveSubscription(bbox=WORLD_BBOX)
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=services.settings.websocket_push_seconds)
                subscription = _parse_live_subscription(message)
            except TimeoutError:
                pass
            except ValueError:
                await websocket.send_json({"type": "error", "message": "Payload invalido"})
                continue

            payload: dict[str, Any] = {
                "type": "snapshot",
                "generatedAt": utc_now().isoformat(),
                "countryIso2": subscription.country_iso2,
                "bbox": list(subscription.bbox),
                "layers": list(subscription.layers),
            }
            if "air" in subscription.layers:
                payload["air"] = await services.traffic.get_air_snapshot(
                    subscription.bbox,
                    preferred_country_iso2=subscription.country_iso2,
                )
            if "sea" in subscription.layers:
                payload["sea"] = await services.traffic.get_sea_snapshot(
                    subscription.bbox,
                    preferred_country_iso2=subscription.country_iso2,
                )
            if subscription.country_iso2 and "news" in subscription.layers:
                payload["news"] = await services.news.get_country_news_payload(subscription.country_iso2, limit=10)
                payload["topics"] = await services.news.get_country_topics(subscription.country_iso2)
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        return


def _parse_bbox_query(raw_bbox: str) -> BBox:
    try:
        parts = [float(part) for part in raw_bbox.split(",")]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid bbox") from exc
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail="Invalid bbox")
    min_lon, min_lat, max_lon, max_lat = parts
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=422, detail="Invalid bbox")
    return min_lon, min_lat, max_lon, max_lat


def _parse_live_subscription(payload: dict[str, Any]) -> LiveSubscription:
    bbox = payload.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError("bbox")
    parsed_bbox = tuple(float(value) for value in bbox)
    country_iso2 = str(payload.get("countryIso2")).upper() if payload.get("countryIso2") else None
    layers_value = payload.get("layers") or ["air", "sea", "news"]
    layers = tuple(str(layer) for layer in layers_value if str(layer) in {"air", "sea", "news"})
    return LiveSubscription(
        bbox=parsed_bbox,  # type: ignore[arg-type]
        layers=layers or ("air", "sea", "news"),
        country_iso2=country_iso2,
    )
