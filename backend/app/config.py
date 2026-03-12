from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _split_csv(value: str | None, fallback: tuple[str, ...]) -> tuple[str, ...]:
    if not value:
        return fallback
    return tuple(part.strip().upper() for part in value.split(",") if part.strip())


@dataclass(slots=True, frozen=True)
class Settings:
    root_dir: Path
    data_dir: Path
    database_path: Path
    shared_country_path: Path
    frontend_dist_path: Path
    allowed_origins: tuple[str, ...]
    news_ttl_minutes: int
    watchlist_refresh_minutes: int
    air_ttl_seconds: int
    sea_ttl_seconds: int
    websocket_push_seconds: int
    news_retention_days: int
    topic_retention_hours: int
    track_retention_minutes: int
    watchlist_countries: tuple[str, ...]
    gdelt_max_records: int
    google_news_locale: str
    opensky_client_id: str | None
    opensky_client_secret: str | None
    opensky_username: str | None
    opensky_password: str | None
    aisstream_api_key: str | None
    x_enabled: bool


def load_settings() -> Settings:
    backend_dir = Path(__file__).resolve().parents[1]
    root_dir = backend_dir.parent
    data_dir = root_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return Settings(
        root_dir=root_dir,
        data_dir=data_dir,
        database_path=Path(os.getenv("WORLD_WATCH_DATABASE_PATH", data_dir / "world_watch.sqlite3")),
        shared_country_path=Path(os.getenv("WORLD_WATCH_COUNTRY_META", root_dir / "shared" / "countries-meta.json")),
        frontend_dist_path=Path(os.getenv("WORLD_WATCH_FRONTEND_DIST", root_dir / "frontend" / "dist")),
        allowed_origins=tuple(
            part.strip()
            for part in os.getenv("WORLD_WATCH_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if part.strip()
        ),
        news_ttl_minutes=int(os.getenv("WORLD_WATCH_NEWS_TTL_MINUTES", "15")),
        watchlist_refresh_minutes=int(os.getenv("WORLD_WATCH_WATCHLIST_REFRESH_MINUTES", "15")),
        air_ttl_seconds=int(os.getenv("WORLD_WATCH_AIR_TTL_SECONDS", "75")),
        sea_ttl_seconds=int(os.getenv("WORLD_WATCH_SEA_TTL_SECONDS", "90")),
        websocket_push_seconds=int(os.getenv("WORLD_WATCH_WEBSOCKET_PUSH_SECONDS", "12")),
        news_retention_days=int(os.getenv("WORLD_WATCH_NEWS_RETENTION_DAYS", "7")),
        topic_retention_hours=int(os.getenv("WORLD_WATCH_TOPIC_RETENTION_HOURS", "24")),
        track_retention_minutes=int(os.getenv("WORLD_WATCH_TRACK_RETENTION_MINUTES", "90")),
        watchlist_countries=_split_csv(os.getenv("WORLD_WATCH_WATCHLIST_COUNTRIES"), ("BR", "US", "GB", "DE", "FR", "CN")),
        gdelt_max_records=int(os.getenv("WORLD_WATCH_GDELT_MAX_RECORDS", "12")),
        google_news_locale=os.getenv("WORLD_WATCH_GOOGLE_NEWS_LOCALE", "pt-BR"),
        opensky_client_id=os.getenv("WORLD_WATCH_OPENSKY_CLIENT_ID"),
        opensky_client_secret=os.getenv("WORLD_WATCH_OPENSKY_CLIENT_SECRET"),
        opensky_username=os.getenv("WORLD_WATCH_OPENSKY_USERNAME"),
        opensky_password=os.getenv("WORLD_WATCH_OPENSKY_PASSWORD"),
        aisstream_api_key=os.getenv("WORLD_WATCH_AISSTREAM_API_KEY"),
        x_enabled=os.getenv("WORLD_WATCH_X_ENABLED", "").lower() in {"1", "true", "yes", "on"},
    )
