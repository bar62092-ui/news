from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from .database import Database
from .models import AirTrackPoint, CountryRecord, NewsItem, ProviderStatus, SeaTrackPoint, TopicCluster, isoformat, parse_datetime, utc_now


class WorldWatchRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def seed_countries(self, countries: list[CountryRecord]) -> None:
        rows = [
            (
                country.iso2,
                country.iso3,
                country.name,
                json.dumps(list(country.aliases)),
                json.dumps(list(country.centroid)) if country.centroid else None,
                json.dumps(list(country.bbox)) if country.bbox else None,
            )
            for country in countries
        ]
        with self.database.connect() as connection:
            connection.executemany(
                """
                INSERT INTO countries (iso2, iso3, name, aliases_json, centroid_json, bbox_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(iso2) DO UPDATE SET
                    iso3 = excluded.iso3,
                    name = excluded.name,
                    aliases_json = excluded.aliases_json,
                    centroid_json = COALESCE(excluded.centroid_json, countries.centroid_json),
                    bbox_json = COALESCE(excluded.bbox_json, countries.bbox_json),
                    updated_at = CURRENT_TIMESTAMP
                """,
                rows,
            )
            connection.commit()

    def list_country_summaries(self) -> list[dict[str, Any]]:
        air_cutoff = isoformat(utc_now() - timedelta(minutes=90))
        sea_cutoff = isoformat(utc_now() - timedelta(minutes=90))
        news_cutoff = isoformat(utc_now() - timedelta(days=1))
        with self.database.connect() as connection:
            countries = connection.execute("SELECT * FROM countries ORDER BY name ASC").fetchall()
            air_counts = {
                row["country_iso2"]: int(row["count"])
                for row in connection.execute(
                    """
                    SELECT country_iso2, COUNT(DISTINCT icao24) AS count
                    FROM air_track_points
                    WHERE country_iso2 IS NOT NULL AND observed_at >= ?
                    GROUP BY country_iso2
                    """,
                    (air_cutoff,),
                ).fetchall()
            }
            sea_counts = {
                row["country_iso2"]: int(row["count"])
                for row in connection.execute(
                    """
                    SELECT country_iso2, COUNT(DISTINCT mmsi) AS count
                    FROM sea_track_points
                    WHERE country_iso2 IS NOT NULL AND observed_at >= ?
                    GROUP BY country_iso2
                    """,
                    (sea_cutoff,),
                ).fetchall()
            }
            news_counts = {
                row["country_iso2"]: int(row["count"])
                for row in connection.execute(
                    """
                    SELECT country_iso2, COUNT(*) AS count
                    FROM news_items
                    WHERE published_at >= ?
                    GROUP BY country_iso2
                    """,
                    (news_cutoff,),
                ).fetchall()
            }
        return [self._country_row_to_summary(row, news_counts, air_counts, sea_counts) for row in countries]

    def get_country_summary(self, iso2: str) -> dict[str, Any] | None:
        iso2 = iso2.upper()
        matches = [item for item in self.list_country_summaries() if item["iso2"] == iso2]
        return matches[0] if matches else None

    def get_country_refresh_state(self, iso2: str) -> dict[str, str | None]:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT last_news_refresh_at, last_news_status FROM countries WHERE iso2 = ?",
                (iso2.upper(),),
            ).fetchone()
        if row is None:
            return {"lastNewsRefreshAt": None, "lastNewsStatus": None}
        return {
            "lastNewsRefreshAt": row["last_news_refresh_at"],
            "lastNewsStatus": row["last_news_status"],
        }

    def set_country_news_refresh(self, iso2: str, status: str, refreshed_at: datetime) -> None:
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE countries
                SET last_news_refresh_at = ?, last_news_status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE iso2 = ?
                """,
                (isoformat(refreshed_at), status, iso2.upper()),
            )
            connection.commit()

    def store_news(self, country_iso2: str, items: list[NewsItem], fetched_at: datetime) -> None:
        rows = [
            (
                country_iso2.upper(),
                item.title,
                item.source,
                item.url,
                isoformat(item.published_at),
                item.language,
                json.dumps(list(item.topics)),
                item.fallback_scope,
                item.summary,
                item.content_text,
                isoformat(fetched_at),
            )
            for item in items
        ]
        with self.database.connect() as connection:
            connection.executemany(
                """
                INSERT INTO news_items (
                    country_iso2, title, source, url, published_at, language, topics_json, fallback_scope, summary, content_text, fetched_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(country_iso2, url) DO UPDATE SET
                    title = excluded.title,
                    source = excluded.source,
                    published_at = excluded.published_at,
                    language = excluded.language,
                    topics_json = excluded.topics_json,
                    fallback_scope = excluded.fallback_scope,
                    summary = excluded.summary,
                    content_text = excluded.content_text,
                    fetched_at = excluded.fetched_at
                """,
                rows,
            )
            connection.commit()

    def list_news(self, country_iso2: str, limit: int = 20) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, title, source, url, published_at, language, topics_json, fallback_scope, summary, content_text, fetched_at
                FROM news_items
                WHERE country_iso2 = ?
                ORDER BY published_at DESC, id DESC
                LIMIT ?
                """,
                (country_iso2.upper(), limit),
            ).fetchall()
        return [self._news_row_to_payload(row) for row in rows]

    def list_global_news(self, limit: int = 60) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    news_items.id,
                    news_items.country_iso2,
                    countries.name AS country_name,
                    news_items.title,
                    news_items.source,
                    news_items.url,
                    news_items.published_at,
                    news_items.language,
                    news_items.topics_json,
                    news_items.fallback_scope,
                    news_items.summary,
                    news_items.content_text,
                    news_items.fetched_at
                FROM news_items
                LEFT JOIN countries ON countries.iso2 = news_items.country_iso2
                ORDER BY news_items.published_at DESC, news_items.id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                **self._news_row_to_payload(row),
                "countryIso2": row["country_iso2"],
                "countryName": row["country_name"],
            }
            for row in rows
        ]

    def list_news_since(self, country_iso2: str, since: datetime) -> list[NewsItem]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT title, source, url, published_at, language, topics_json, fallback_scope, summary, content_text
                FROM news_items
                WHERE country_iso2 = ? AND published_at >= ?
                ORDER BY published_at DESC
                """,
                (country_iso2.upper(), isoformat(since)),
            ).fetchall()
        return [
            NewsItem(
                title=row["title"],
                source=row["source"],
                url=row["url"],
                published_at=parse_datetime(row["published_at"]) or utc_now(),
                language=row["language"],
                topics=tuple(json.loads(row["topics_json"] or "[]")),
                fallback_scope=row["fallback_scope"] or "country",
                summary=row["summary"],
                content_text=row["content_text"],
            )
            for row in rows
        ]

    def replace_topics(self, country_iso2: str, topics: list[TopicCluster], computed_at: datetime) -> None:
        with self.database.connect() as connection:
            connection.execute("DELETE FROM topic_clusters WHERE country_iso2 = ?", (country_iso2.upper(),))
            connection.executemany(
                """
                INSERT INTO topic_clusters (country_iso2, label, score, source_count, last_seen_at, computed_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        country_iso2.upper(),
                        topic.label,
                        topic.score,
                        topic.source_count,
                        isoformat(topic.last_seen_at),
                        isoformat(computed_at),
                    )
                    for topic in topics
                ],
            )
            connection.commit()

    def list_topics(self, country_iso2: str) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT label, score, source_count, last_seen_at
                FROM topic_clusters
                WHERE country_iso2 = ?
                ORDER BY score DESC, source_count DESC, label ASC
                """,
                (country_iso2.upper(),),
            ).fetchall()
        return [
            {
                "label": row["label"],
                "score": float(row["score"]),
                "sourceCount": int(row["source_count"]),
                "lastSeenAt": row["last_seen_at"],
            }
            for row in rows
        ]

    def store_air_tracks(self, items: list[AirTrackPoint]) -> None:
        if not items:
            return
        with self.database.connect() as connection:
            connection.executemany(
                """
                INSERT INTO air_track_points (
                    icao24, callsign, origin_country, country_iso2, longitude, latitude, altitude, velocity, heading, observed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item.icao24,
                        item.callsign,
                        item.origin_country,
                        item.country_iso2,
                        item.longitude,
                        item.latitude,
                        item.altitude,
                        item.velocity,
                        item.heading,
                        isoformat(item.observed_at),
                    )
                    for item in items
                ],
            )
            connection.commit()

    def list_air_tracks(self, bbox: tuple[float, float, float, float], since: datetime) -> list[AirTrackPoint]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT icao24, callsign, origin_country, country_iso2, longitude, latitude, altitude, velocity, heading, observed_at
                FROM air_track_points
                WHERE observed_at >= ?
                  AND longitude BETWEEN ? AND ?
                  AND latitude BETWEEN ? AND ?
                ORDER BY observed_at DESC
                """,
                (isoformat(since), bbox[0], bbox[2], bbox[1], bbox[3]),
            ).fetchall()
        return [
            AirTrackPoint(
                icao24=row["icao24"],
                callsign=row["callsign"],
                origin_country=row["origin_country"],
                country_iso2=row["country_iso2"],
                longitude=float(row["longitude"]),
                latitude=float(row["latitude"]),
                altitude=row["altitude"],
                velocity=row["velocity"],
                heading=row["heading"],
                observed_at=parse_datetime(row["observed_at"]) or utc_now(),
            )
            for row in rows
        ]

    def store_sea_tracks(self, items: list[SeaTrackPoint]) -> None:
        if not items:
            return
        with self.database.connect() as connection:
            connection.executemany(
                """
                INSERT INTO sea_track_points (
                    mmsi, vessel_name, country_iso2, longitude, latitude, speed, course, status, source, observed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item.mmsi,
                        item.vessel_name,
                        item.country_iso2,
                        item.longitude,
                        item.latitude,
                        item.speed,
                        item.course,
                        item.status,
                        item.source,
                        isoformat(item.observed_at),
                    )
                    for item in items
                ],
            )
            connection.commit()

    def list_sea_tracks(self, bbox: tuple[float, float, float, float], since: datetime) -> list[SeaTrackPoint]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT mmsi, vessel_name, country_iso2, longitude, latitude, speed, course, status, source, observed_at
                FROM sea_track_points
                WHERE observed_at >= ?
                  AND longitude BETWEEN ? AND ?
                  AND latitude BETWEEN ? AND ?
                ORDER BY observed_at DESC
                """,
                (isoformat(since), bbox[0], bbox[2], bbox[1], bbox[3]),
            ).fetchall()
        return [
            SeaTrackPoint(
                mmsi=row["mmsi"],
                vessel_name=row["vessel_name"],
                country_iso2=row["country_iso2"],
                longitude=float(row["longitude"]),
                latitude=float(row["latitude"]),
                speed=row["speed"],
                course=row["course"],
                status=row["status"],
                source=row["source"],
                observed_at=parse_datetime(row["observed_at"]) or utc_now(),
            )
            for row in rows
        ]

    def update_provider_health(self, status: ProviderStatus) -> None:
        last_success = isoformat(status.checked_at) if status.ok else None
        last_error = isoformat(status.checked_at) if not status.ok else None
        with self.database.connect() as connection:
            existing = connection.execute(
                "SELECT last_success_at, last_error_at FROM provider_health WHERE provider_name = ?",
                (status.provider_name,),
            ).fetchone()
            connection.execute(
                """
                INSERT INTO provider_health (provider_name, ok, status_text, last_success_at, last_error_at, detail_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider_name) DO UPDATE SET
                    ok = excluded.ok,
                    status_text = excluded.status_text,
                    last_success_at = COALESCE(excluded.last_success_at, provider_health.last_success_at),
                    last_error_at = COALESCE(excluded.last_error_at, provider_health.last_error_at),
                    detail_json = excluded.detail_json
                """,
                (
                    status.provider_name,
                    1 if status.ok else 0,
                    status.status_text,
                    last_success or (existing["last_success_at"] if existing else None),
                    last_error or (existing["last_error_at"] if existing else None),
                    json.dumps(status.detail),
                ),
            )
            connection.commit()

    def list_provider_health(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT provider_name, ok, status_text, last_success_at, last_error_at, detail_json
                FROM provider_health
                ORDER BY provider_name ASC
                """
            ).fetchall()
        return [
            {
                "providerName": row["provider_name"],
                "ok": bool(row["ok"]),
                "statusText": row["status_text"],
                "lastSuccessAt": row["last_success_at"],
                "lastErrorAt": row["last_error_at"],
                "detail": json.loads(row["detail_json"] or "{}"),
            }
            for row in rows
        ]

    def cleanup(self, news_days: int, topic_hours: int, track_minutes: int) -> None:
        news_cutoff = isoformat(utc_now() - timedelta(days=news_days))
        topic_cutoff = isoformat(utc_now() - timedelta(hours=topic_hours))
        track_cutoff = isoformat(utc_now() - timedelta(minutes=track_minutes))
        with self.database.connect() as connection:
            connection.execute("DELETE FROM news_items WHERE fetched_at < ?", (news_cutoff,))
            connection.execute("DELETE FROM topic_clusters WHERE computed_at < ?", (topic_cutoff,))
            connection.execute("DELETE FROM air_track_points WHERE observed_at < ?", (track_cutoff,))
            connection.execute("DELETE FROM sea_track_points WHERE observed_at < ?", (track_cutoff,))
            connection.commit()

    def _country_row_to_summary(
        self,
        row: Any,
        news_counts: dict[str, int],
        air_counts: dict[str, int],
        sea_counts: dict[str, int],
    ) -> dict[str, Any]:
        centroid = json.loads(row["centroid_json"]) if row["centroid_json"] else None
        bbox = json.loads(row["bbox_json"]) if row["bbox_json"] else None
        iso2 = row["iso2"]
        return {
            "iso2": iso2,
            "iso3": row["iso3"],
            "name": row["name"],
            "aliases": json.loads(row["aliases_json"] or "[]"),
            "centroid": centroid,
            "bbox": bbox,
            "newsCount": news_counts.get(iso2, 0),
            "airCount": air_counts.get(iso2, 0),
            "seaCount": sea_counts.get(iso2, 0),
            "lastNewsRefreshAt": row["last_news_refresh_at"],
            "lastNewsStatus": row["last_news_status"],
        }

    def _news_row_to_payload(self, row: Any) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "title": row["title"],
            "source": row["source"],
            "url": row["url"],
            "publishedAt": row["published_at"],
            "language": row["language"],
            "topics": json.loads(row["topics_json"] or "[]"),
            "fallbackScope": row["fallback_scope"],
            "summary": row["summary"],
            "contentText": row["content_text"],
            "fetchedAt": row["fetched_at"],
        }
