from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterable
from pathlib import Path

import pycountry

from .models import CountryRecord

EXTRA_ALIASES: dict[str, tuple[str, ...]] = {
    "BO": ("Bolivia", "Bolivia, Plurinational State of"),
    "CN": ("China", "Mainland China"),
    "CZ": ("Czechia", "Czech Republic"),
    "FM": ("Micronesia", "Micronesia, Federated States of"),
    "GB": ("United Kingdom", "Britain", "UK", "Great Britain"),
    "KR": ("South Korea", "Republic of Korea"),
    "KP": ("North Korea", "DPRK", "Democratic People's Republic of Korea"),
    "LA": ("Laos", "Lao People's Democratic Republic"),
    "MD": ("Moldova", "Republic of Moldova"),
    "RU": ("Russia", "Russian Federation"),
    "SY": ("Syria", "Syrian Arab Republic"),
    "TZ": ("Tanzania", "United Republic of Tanzania"),
    "TW": ("Taiwan", "Taiwan, Province of China"),
    "US": ("United States", "United States of America", "USA"),
    "VE": ("Venezuela", "Bolivarian Republic of Venezuela"),
    "VN": ("Vietnam", "Viet Nam"),
}


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(normalized.lower().strip().split())


class CountryCatalog:
    def __init__(self, metadata_path: Path) -> None:
        overrides = self._load_metadata(metadata_path)
        self._records: dict[str, CountryRecord] = {}
        self._name_lookup: dict[str, str] = {}

        for item in sorted(pycountry.countries, key=lambda country: country.alpha_2):
            iso2 = item.alpha_2.upper()
            iso3 = item.alpha_3.upper()
            names = [item.name]
            for attribute in ("official_name", "common_name"):
                value = getattr(item, attribute, None)
                if value:
                    names.append(value)
            names.extend(EXTRA_ALIASES.get(iso2, ()))
            override = overrides.get(iso2, {})
            names.extend(str(alias) for alias in override.get("aliases", []))
            deduped_aliases = tuple(dict.fromkeys(name.strip() for name in names if name and name.strip()))
            centroid_payload = override.get("centroid")
            bbox_payload = override.get("bbox")
            centroid = (
                (float(centroid_payload[0]), float(centroid_payload[1]))
                if isinstance(centroid_payload, list) and len(centroid_payload) == 2
                else None
            )
            bbox = (
                (
                    float(bbox_payload[0]),
                    float(bbox_payload[1]),
                    float(bbox_payload[2]),
                    float(bbox_payload[3]),
                )
                if isinstance(bbox_payload, list) and len(bbox_payload) == 4
                else None
            )
            record = CountryRecord(
                iso2=iso2,
                iso3=iso3,
                name=str(override.get("name", item.name)),
                aliases=deduped_aliases,
                centroid=centroid,
                bbox=bbox,
            )
            self._records[iso2] = record
            self._index_names(record)

    def list_countries(self) -> list[CountryRecord]:
        return list(self._records.values())

    def get(self, iso2: str) -> CountryRecord | None:
        return self._records.get(iso2.upper())

    def search_terms(self, iso2: str) -> tuple[str, ...]:
        record = self.get(iso2)
        if record is None:
            return ()
        return record.aliases or (record.name,)

    def match_name_to_iso2(self, value: str | None) -> str | None:
        if not value:
            return None
        return self._name_lookup.get(_normalize(value))

    def _index_names(self, record: CountryRecord) -> None:
        values: Iterable[str] = [record.iso2, record.iso3, record.name, *record.aliases]
        for value in values:
            normalized = _normalize(str(value))
            if normalized:
                self._name_lookup[normalized] = record.iso2

    def _load_metadata(self, path: Path) -> dict[str, dict[str, object]]:
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            return {}
        return {str(key).upper(): dict(value) for key, value in payload.items() if isinstance(value, dict)}
