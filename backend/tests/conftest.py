from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.main import create_app
from app.models import AirTrackPoint, NewsItem, ProviderStatus, SeaTrackPoint, TopicCluster, utc_now
from app.providers.news import NewsFetchResult


@pytest.fixture()
def test_settings(tmp_path: Path) -> Settings:
    frontend_dist = tmp_path / "frontend-dist"
    frontend_dist.mkdir(parents=True, exist_ok=True)
    return Settings(
        root_dir=tmp_path,
        data_dir=tmp_path / "data",
        database_path=tmp_path / "data" / "world_watch.sqlite3",
        shared_country_path=tmp_path / "shared" / "countries-meta.json",
        frontend_dist_path=frontend_dist,
        allowed_origins=("http://localhost:5173",),
        news_ttl_minutes=15,
        watchlist_refresh_minutes=60,
        air_ttl_seconds=30,
        sea_ttl_seconds=30,
        websocket_push_seconds=1,
        news_retention_days=7,
        topic_retention_hours=24,
        track_retention_minutes=90,
        watchlist_countries=("BR",),
        gdelt_max_records=12,
        google_news_locale="pt-BR",
        opensky_client_id=None,
        opensky_client_secret=None,
        opensky_username=None,
        opensky_password=None,
        aisstream_api_key=None,
        x_enabled=False,
    )


@pytest.fixture()
def app(test_settings: Settings, monkeypatch: pytest.MonkeyPatch):
    app = create_app(test_settings)
    services = app.state.services

    async def fake_watchlist_loop() -> None:
        return None

    async def fake_fetch_country_news(country, search_terms, limit=12):
        return NewsFetchResult(
            items=[
                NewsItem(
                    title=f"{country.name} logistics routes expand",
                    source="Fixture News",
                    url=f"https://example.com/{country.iso2.lower()}/routes",
                    published_at=utc_now(),
                    language="en",
                    topics=("Routes", "Logistics"),
                    summary="Fixture summary for the first article.",
                    content_text="Fixture paragraph one.\n\nFixture paragraph two.",
                ),
                NewsItem(
                    title=f"{country.name} ports and flights react",
                    source="Fixture Daily",
                    url=f"https://example.com/{country.iso2.lower()}/ports",
                    published_at=utc_now(),
                    language="en",
                    topics=("Ports", "Flights"),
                    summary="Fixture summary for the second article.",
                    content_text="Another fixture paragraph.",
                ),
            ],
            statuses=[
                ProviderStatus(provider_name="fixture-news", ok=True, status_text="ok"),
            ],
        )

    async def fake_fetch_trends(country_iso2, window_hours=6):
        return [
            TopicCluster(label="Routes", score=2.4, source_count=2, last_seen_at=utc_now()),
            TopicCluster(label="Ports", score=1.7, source_count=1, last_seen_at=utc_now()),
        ]

    async def fake_fetch_air(bbox, preferred_country_iso2=None):
        return [
            AirTrackPoint(
                icao24="abc123",
                callsign="WW100",
                origin_country="Brazil",
                country_iso2=preferred_country_iso2 or "BR",
                longitude=-46.63,
                latitude=-23.55,
                altitude=10100,
                velocity=230,
                heading=84,
                observed_at=utc_now(),
            )
        ]

    async def fake_fetch_sea(bbox, preferred_country_iso2=None):
        return [
            SeaTrackPoint(
                mmsi="111000111",
                vessel_name="Fixture Carrier",
                country_iso2=preferred_country_iso2 or "BR",
                longitude=-43.18,
                latitude=-22.9,
                speed=14.2,
                course=92,
                status="Sailing",
                source="fixture",
                observed_at=utc_now(),
            )
        ]

    async def fake_dashboard_payload():
        now = utc_now().isoformat()
        return {
            "generatedAt": now,
            "signals": [
                {
                    "iso2": "BR",
                    "name": "Brasil",
                    "score": 14,
                    "level": "medium",
                    "newsCount": 2,
                    "airCount": 1,
                    "seaCount": 1,
                    "summary": "Topicos: Routes, Ports",
                    "lastRefreshAt": now,
                }
            ],
            "events": [
                {
                    "id": "signal-BR",
                    "kind": "signal",
                    "title": "Brazil logistics routes expand",
                    "summary": "Brasil soma 14 pontos.",
                    "tone": "medium",
                    "countryIso2": "BR",
                    "countryName": "Brasil",
                    "source": "Fixture News",
                    "publishedAt": now,
                    "tags": ["signal"],
                }
            ],
            "stocks": [
                {
                    "symbol": "^BVSP",
                    "label": "Ibovespa",
                    "price": 128430.0,
                    "change": 240.0,
                    "changePercent": 0.19,
                    "currency": "pts",
                    "updatedAt": now,
                    "trend": "up",
                    "board": "stocks",
                    "source": "Fixture",
                }
            ],
            "markets": [
                {
                    "symbol": "CL=F",
                    "label": "Petroleo WTI",
                    "price": 78.5,
                    "change": -0.8,
                    "changePercent": -1.0,
                    "currency": "USD",
                    "updatedAt": now,
                    "trend": "down",
                    "board": "markets",
                    "source": "Fixture",
                }
            ],
            "channels": [
                {
                    "id": "channel-br",
                    "source": "Fixture Daily",
                    "headline": "Brazil ports and flights react",
                    "countryIso2": "BR",
                    "countryName": "Brasil",
                    "publishedAt": now,
                    "status": "no ar",
                    "summary": "Another fixture paragraph.",
                }
            ],
            "outbreaks": [
                {
                    "id": "outbreak-1",
                    "title": "Regional outbreak signal",
                    "summary": "Fixture outbreak summary.",
                    "publishedAt": now,
                    "source": "WHO",
                    "url": "https://example.com/outbreak",
                    "tone": "medium",
                    "region": "Global",
                }
            ],
            "defcon": {
                "level": 4,
                "tone": "medium",
                "score": 48.0,
                "summary": "Fixture defcon summary.",
                "updatedAt": now,
            },
            "infrastructure": [
                {"id": "submarine-cables", "label": "Cabos submarinos", "kind": "route", "count": 5}
            ],
        }

    monkeypatch.setattr(services.news, "start_watchlist_loop", fake_watchlist_loop)
    monkeypatch.setattr(services.news.provider, "fetch_country_news", fake_fetch_country_news)
    monkeypatch.setattr(services.news.trend_provider, "fetch_country_trends", fake_fetch_trends)
    monkeypatch.setattr(services.traffic.air_provider, "fetch_bbox", fake_fetch_air)
    monkeypatch.setattr(services.traffic.sea_provider, "fetch_bbox", fake_fetch_sea)
    monkeypatch.setattr(services.programs, "get_dashboard_payload", fake_dashboard_payload)
    return app
