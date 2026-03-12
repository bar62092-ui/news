from __future__ import annotations

from app.country_catalog import CountryCatalog
from app.database import Database
from app.models import NewsItem, utc_now
from app.providers.trends import NewsClusterTrendProvider
from app.repository import WorldWatchRepository


def test_news_cluster_generates_topic_clusters(tmp_path):
    repository = WorldWatchRepository(Database(tmp_path / "trends.sqlite3"))
    repository.database.initialize()
    catalog = CountryCatalog(tmp_path / "missing.json")
    repository.seed_countries(catalog.list_countries())
    now = utc_now()
    repository.store_news(
        "BR",
        [
            NewsItem(title="Brazil logistics routes expand across ports", source="A", url="https://example.com/1", published_at=now),
            NewsItem(title="Brazil ports push logistics upgrades", source="B", url="https://example.com/2", published_at=now),
        ],
        now,
    )

    provider = NewsClusterTrendProvider(repository)
    topics = __import__("asyncio").run(provider.fetch_country_trends("BR"))

    assert topics
    assert any("Logistics" in topic.label or "Ports" in topic.label for topic in topics)
