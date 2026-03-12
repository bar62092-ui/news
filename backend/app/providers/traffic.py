from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import websockets

from ..country_catalog import CountryCatalog
from ..models import AirTrackPoint, BBox, ProviderStatus, SeaTrackPoint, utc_now


class OpenSkyProvider:
    provider_name = "opensky"

    def __init__(
        self,
        client: httpx.AsyncClient,
        catalog: CountryCatalog,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        self.client = client
        self.catalog = catalog
        self.username = username
        self.password = password

    async def fetch_bbox(self, bbox: BBox, preferred_country_iso2: str | None = None) -> list[AirTrackPoint]:
        params = {
            "lamin": bbox[1],
            "lomin": bbox[0],
            "lamax": bbox[3],
            "lomax": bbox[2],
        }
        auth = (self.username, self.password) if self.username and self.password else None
        response = await self.client.get("https://opensky-network.org/api/states/all", params=params, auth=auth)
        response.raise_for_status()
        payload = response.json()
        states = payload.get("states") or []
        items: list[AirTrackPoint] = []
        for row in states:
            if len(row) < 11 or row[5] is None or row[6] is None:
                continue
            origin_country = str(row[2]).strip() if row[2] else None
            country_iso2 = self.catalog.match_name_to_iso2(origin_country) or preferred_country_iso2
            observed_timestamp = row[4] or row[3]
            observed_at = datetime.fromtimestamp(float(observed_timestamp), tz=timezone.utc) if observed_timestamp else utc_now()
            items.append(
                AirTrackPoint(
                    icao24=str(row[0]).strip(),
                    callsign=str(row[1]).strip() if row[1] else None,
                    origin_country=origin_country,
                    country_iso2=country_iso2,
                    longitude=float(row[5]),
                    latitude=float(row[6]),
                    altitude=float(row[7]) if row[7] is not None else None,
                    velocity=float(row[9]) if row[9] is not None else None,
                    heading=float(row[10]) if row[10] is not None else None,
                    observed_at=observed_at,
                )
            )
        return items or self.sample_bbox(bbox, preferred_country_iso2=preferred_country_iso2)

    def sample_bbox(self, bbox: BBox, preferred_country_iso2: str | None = None) -> list[AirTrackPoint]:
        center_lon = (bbox[0] + bbox[2]) / 2
        center_lat = (bbox[1] + bbox[3]) / 2
        offsets = [(-1.0, 0.8), (-0.3, -0.2), (0.7, 0.45)]
        items: list[AirTrackPoint] = []
        now = utc_now()
        for index, (lon_offset, lat_offset) in enumerate(offsets, start=1):
            items.append(
                AirTrackPoint(
                    icao24=f"fallback-air-{index}",
                    callsign=f"WW{100 + index}",
                    origin_country=preferred_country_iso2,
                    country_iso2=preferred_country_iso2,
                    longitude=center_lon + lon_offset,
                    latitude=center_lat + lat_offset,
                    altitude=9600 + (index * 850),
                    velocity=205 + (index * 12),
                    heading=68 + (index * 18),
                    observed_at=now + timedelta(seconds=index),
                )
            )
            items.append(
                AirTrackPoint(
                    icao24=f"fallback-air-{index}",
                    callsign=f"WW{100 + index}",
                    origin_country=preferred_country_iso2,
                    country_iso2=preferred_country_iso2,
                    longitude=center_lon + (lon_offset * 0.6),
                    latitude=center_lat + (lat_offset * 0.6),
                    altitude=9200 + (index * 800),
                    velocity=198 + (index * 10),
                    heading=68 + (index * 18),
                    observed_at=now - timedelta(minutes=4) + timedelta(seconds=index),
                )
            )
        return items


class AisStreamProvider:
    provider_name = "aisstream"

    def __init__(self, api_key: str | None) -> None:
        self.api_key = api_key

    async def fetch_bbox(self, bbox: BBox, preferred_country_iso2: str | None = None) -> list[SeaTrackPoint]:
        if not self.api_key:
            return self.sample_bbox(bbox, preferred_country_iso2=preferred_country_iso2)
        uri = "wss://stream.aisstream.io/v0/stream"
        subscription = {
            "APIKey": self.api_key,
            "BoundingBoxes": [[[bbox[1], bbox[0]], [bbox[3], bbox[2]]]],
            "FilterMessageTypes": [
                "PositionReport",
                "StandardClassBPositionReport",
                "ExtendedClassBPositionReport",
            ],
        }
        tracks: list[SeaTrackPoint] = []
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as socket:
                await socket.send(json.dumps(subscription))
                deadline = utc_now() + timedelta(seconds=3)
                while utc_now() < deadline and len(tracks) < 12:
                    timeout = max((deadline - utc_now()).total_seconds(), 0.2)
                    raw = await asyncio.wait_for(socket.recv(), timeout=timeout)
                    payload = json.loads(raw)
                    item = self._parse_message(payload, preferred_country_iso2=preferred_country_iso2)
                    if item is not None:
                        tracks.append(item)
        except Exception:  # noqa: BLE001
            return self.sample_bbox(bbox, preferred_country_iso2=preferred_country_iso2)
        return tracks or self.sample_bbox(bbox, preferred_country_iso2=preferred_country_iso2)

    def _parse_message(self, payload: dict[str, Any], preferred_country_iso2: str | None = None) -> SeaTrackPoint | None:
        metadata = payload.get("MetaData") or {}
        message = payload.get("Message") or {}
        inner = None
        for key in ("PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"):
            if key in message:
                inner = message[key]
                break
        if inner is None:
            return None
        longitude = metadata.get("longitude") or inner.get("Longitude")
        latitude = metadata.get("latitude") or inner.get("Latitude")
        mmsi = metadata.get("MMSI") or inner.get("UserID")
        if longitude is None or latitude is None or mmsi is None:
            return None
        timestamp = metadata.get("time_utc")
        observed_at = _parse_maybe_datetime(timestamp) or utc_now()
        return SeaTrackPoint(
            mmsi=str(mmsi),
            vessel_name=metadata.get("ShipName"),
            country_iso2=preferred_country_iso2,
            longitude=float(longitude),
            latitude=float(latitude),
            speed=float(inner["Sog"]) if inner.get("Sog") is not None else None,
            course=float(inner["Cog"]) if inner.get("Cog") is not None else None,
            status=str(inner.get("NavigationalStatus")) if inner.get("NavigationalStatus") is not None else None,
            source="aisstream",
            observed_at=observed_at,
        )

    def sample_bbox(self, bbox: BBox, preferred_country_iso2: str | None = None) -> list[SeaTrackPoint]:
        center_lon = (bbox[0] + bbox[2]) / 2
        center_lat = (bbox[1] + bbox[3]) / 2
        offsets = [(-0.9, -0.3), (0.6, 0.5), (1.1, -0.4)]
        tracks: list[SeaTrackPoint] = []
        now = utc_now()
        for index, (lon_offset, lat_offset) in enumerate(offsets, start=1):
            tracks.append(
                SeaTrackPoint(
                    mmsi=f"sample-{index}",
                    vessel_name=f"Fallback Vessel {index}",
                    country_iso2=preferred_country_iso2,
                    longitude=center_lon + lon_offset,
                    latitude=center_lat + lat_offset,
                    speed=13.0 + index,
                    course=85.0 + (index * 7),
                    status="Fallback",
                    source="sample",
                    observed_at=now + timedelta(seconds=index),
                )
            )
            tracks.append(
                SeaTrackPoint(
                    mmsi=f"sample-{index}",
                    vessel_name=f"Fallback Vessel {index}",
                    country_iso2=preferred_country_iso2,
                    longitude=center_lon + (lon_offset * 0.55),
                    latitude=center_lat + (lat_offset * 0.55),
                    speed=12.0 + index,
                    course=81.0 + (index * 8),
                    status="Fallback",
                    source="sample",
                    observed_at=now - timedelta(minutes=7) + timedelta(seconds=index),
                )
            )
        return tracks


def _parse_maybe_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def aggregate_aircraft(points: list[AirTrackPoint]) -> list[dict[str, Any]]:
    grouped: dict[str, list[AirTrackPoint]] = defaultdict(list)
    for point in points:
        grouped[point.icao24].append(point)
    payload: list[dict[str, Any]] = []
    for icao24, items in grouped.items():
        sorted_items = sorted(items, key=lambda item: item.observed_at)
        latest = sorted_items[-1]
        payload.append(
            {
                "id": icao24,
                "callsign": latest.callsign,
                "originCountry": latest.origin_country,
                "countryIso2": latest.country_iso2,
                "lastSeenAt": latest.observed_at.isoformat(),
                "position": [latest.longitude, latest.latitude],
                "track": [[item.longitude, item.latitude] for item in sorted_items[-10:]],
                "altitude": latest.altitude,
                "velocity": latest.velocity,
                "heading": latest.heading,
            }
        )
    payload.sort(key=lambda item: item["lastSeenAt"], reverse=True)
    return payload


def aggregate_vessels(points: list[SeaTrackPoint]) -> list[dict[str, Any]]:
    grouped: dict[str, list[SeaTrackPoint]] = defaultdict(list)
    for point in points:
        grouped[point.mmsi].append(point)
    payload: list[dict[str, Any]] = []
    for mmsi, items in grouped.items():
        sorted_items = sorted(items, key=lambda item: item.observed_at)
        latest = sorted_items[-1]
        payload.append(
            {
                "id": mmsi,
                "name": latest.vessel_name or mmsi,
                "countryIso2": latest.country_iso2,
                "lastSeenAt": latest.observed_at.isoformat(),
                "position": [latest.longitude, latest.latitude],
                "track": [[item.longitude, item.latitude] for item in sorted_items[-10:]],
                "speed": latest.speed,
                "course": latest.course,
                "status": latest.status,
                "source": latest.source,
            }
        )
    payload.sort(key=lambda item: item["lastSeenAt"], reverse=True)
    return payload
