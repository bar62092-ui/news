from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

BBox = tuple[float, float, float, float]
Point = tuple[float, float]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@dataclass(slots=True, frozen=True)
class CountryRecord:
    iso2: str
    iso3: str
    name: str
    aliases: tuple[str, ...] = ()
    centroid: Point | None = None
    bbox: BBox | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "iso2": self.iso2,
            "iso3": self.iso3,
            "name": self.name,
            "aliases": list(self.aliases),
            "centroid": list(self.centroid) if self.centroid else None,
            "bbox": list(self.bbox) if self.bbox else None,
        }


@dataclass(slots=True, frozen=True)
class NewsItem:
    title: str
    source: str
    url: str
    published_at: datetime
    language: str | None = None
    topics: tuple[str, ...] = ()
    fallback_scope: str = "country"

    def to_dict(self, item_id: int | None = None) -> dict[str, Any]:
        payload = {
            "title": self.title,
            "source": self.source,
            "url": self.url,
            "publishedAt": isoformat(self.published_at),
            "language": self.language,
            "topics": list(self.topics),
            "fallbackScope": self.fallback_scope,
        }
        if item_id is not None:
            payload["id"] = item_id
        return payload


@dataclass(slots=True, frozen=True)
class TopicCluster:
    label: str
    score: float
    source_count: int
    last_seen_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "score": round(self.score, 3),
            "sourceCount": self.source_count,
            "lastSeenAt": isoformat(self.last_seen_at),
        }


@dataclass(slots=True, frozen=True)
class AirTrackPoint:
    icao24: str
    longitude: float
    latitude: float
    observed_at: datetime
    callsign: str | None = None
    origin_country: str | None = None
    country_iso2: str | None = None
    altitude: float | None = None
    velocity: float | None = None
    heading: float | None = None


@dataclass(slots=True, frozen=True)
class SeaTrackPoint:
    mmsi: str
    longitude: float
    latitude: float
    observed_at: datetime
    vessel_name: str | None = None
    country_iso2: str | None = None
    speed: float | None = None
    course: float | None = None
    status: str | None = None
    source: str = "aisstream"


@dataclass(slots=True, frozen=True)
class ProviderStatus:
    provider_name: str
    ok: bool
    status_text: str
    checked_at: datetime = field(default_factory=utc_now)
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True, frozen=True)
class LiveSubscription:
    bbox: BBox
    layers: tuple[str, ...] = ("air", "sea", "news")
    country_iso2: str | None = None
