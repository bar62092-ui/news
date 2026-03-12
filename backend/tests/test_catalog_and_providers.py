from __future__ import annotations

from datetime import timedelta

from app.country_catalog import CountryCatalog
from app.models import NewsItem, utc_now
from app.providers.news import dedupe_news


def test_country_catalog_matches_common_aliases(tmp_path):
    catalog = CountryCatalog(tmp_path / "missing.json")
    assert catalog.match_name_to_iso2("United States of America") == "US"
    assert catalog.match_name_to_iso2("Russia") == "RU"
    assert catalog.match_name_to_iso2("Viet Nam") == "VN"


def test_dedupe_news_removes_duplicate_urls():
    now = utc_now()
    items = [
        NewsItem(title="Alpha", source="A", url="https://example.com/story", published_at=now - timedelta(minutes=5)),
        NewsItem(title="Alpha newer", source="B", url="https://example.com/story", published_at=now),
        NewsItem(title="Beta", source="C", url="https://example.com/beta", published_at=now - timedelta(minutes=2)),
    ]

    deduped = dedupe_news(items)

    assert len(deduped) == 2
    assert deduped[0].title == "Alpha newer"
