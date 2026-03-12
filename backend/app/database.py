from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS countries (
    iso2 TEXT PRIMARY KEY,
    iso3 TEXT NOT NULL,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    centroid_json TEXT,
    bbox_json TEXT,
    last_news_refresh_at TEXT,
    last_news_status TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country_iso2 TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    language TEXT,
    topics_json TEXT NOT NULL DEFAULT '[]',
    fallback_scope TEXT NOT NULL DEFAULT 'country',
    summary TEXT,
    content_text TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(country_iso2, url)
);

CREATE INDEX IF NOT EXISTS idx_news_country_published ON news_items (country_iso2, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_items (published_at DESC);

CREATE TABLE IF NOT EXISTS topic_clusters (
    country_iso2 TEXT NOT NULL,
    label TEXT NOT NULL,
    score REAL NOT NULL,
    source_count INTEGER NOT NULL,
    last_seen_at TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (country_iso2, label)
);

CREATE INDEX IF NOT EXISTS idx_topics_country ON topic_clusters (country_iso2, score DESC);

CREATE TABLE IF NOT EXISTS air_track_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    icao24 TEXT NOT NULL,
    callsign TEXT,
    origin_country TEXT,
    country_iso2 TEXT,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    altitude REAL,
    velocity REAL,
    heading REAL,
    observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_air_recent ON air_track_points (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_air_country ON air_track_points (country_iso2, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_air_aircraft ON air_track_points (icao24, observed_at DESC);

CREATE TABLE IF NOT EXISTS sea_track_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mmsi TEXT NOT NULL,
    vessel_name TEXT,
    country_iso2 TEXT,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    speed REAL,
    course REAL,
    status TEXT,
    source TEXT NOT NULL,
    observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sea_recent ON sea_track_points (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sea_country ON sea_track_points (country_iso2, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sea_vessel ON sea_track_points (mmsi, observed_at DESC);

CREATE TABLE IF NOT EXISTS provider_health (
    provider_name TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    status_text TEXT NOT NULL,
    last_success_at TEXT,
    last_error_at TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}'
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL;")
        connection.execute("PRAGMA foreign_keys=ON;")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA_SQL)
            self._ensure_column(connection, "news_items", "summary", "TEXT")
            self._ensure_column(connection, "news_items", "content_text", "TEXT")
            connection.commit()

    def _ensure_column(self, connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
        rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        known_columns = {row["name"] for row in rows}
        if column_name not in known_columns:
            connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
