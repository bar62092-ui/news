from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import timedelta
from typing import Protocol

from ..models import TopicCluster, utc_now
from ..repository import WorldWatchRepository

TOKEN_RE = re.compile(r"[A-Za-zÀ-ÿ0-9]{4,}")
STOPWORDS = {
    "about",
    "after",
    "antes",
    "brasil",
    "como",
    "com",
    "contra",
    "depois",
    "desde",
    "during",
    "from",
    "have",
    "para",
    "pela",
    "pelo",
    "that",
    "this",
    "with",
    "will",
    "what",
    "when",
    "where",
    "porque",
    "sobre",
    "their",
    "there",
    "under",
}


class TrendProvider(Protocol):
    async def fetch_country_trends(self, country_iso2: str, window_hours: int = 6) -> list[TopicCluster]:
        ...


class NewsClusterTrendProvider:
    def __init__(self, repository: WorldWatchRepository) -> None:
        self.repository = repository

    async def fetch_country_trends(self, country_iso2: str, window_hours: int = 6) -> list[TopicCluster]:
        since = utc_now() - timedelta(hours=window_hours)
        news_items = self.repository.list_news_since(country_iso2, since)
        phrase_counts: Counter[str] = Counter()
        source_tracker: dict[str, set[str]] = defaultdict(set)
        latest_seen: dict[str, object] = {}

        for item in news_items:
            tokens = [token.lower() for token in TOKEN_RE.findall(item.title)]
            tokens = [token for token in tokens if token not in STOPWORDS and not token.isdigit()]
            phrases = set(tokens[:6])
            phrases.update(" ".join(pair) for pair in zip(tokens, tokens[1:]) if pair[0] != pair[1])
            for phrase in phrases:
                if len(phrase) < 4:
                    continue
                phrase_counts[phrase] += 1
                source_tracker[phrase].add(item.source)
                latest_seen[phrase] = max(item.published_at, latest_seen.get(phrase, item.published_at))

        topics: list[TopicCluster] = []
        for label, count in phrase_counts.most_common(12):
            source_count = len(source_tracker[label])
            score = float(count) + (source_count * 0.35)
            topics.append(
                TopicCluster(
                    label=label.title(),
                    score=score,
                    source_count=source_count,
                    last_seen_at=latest_seen[label],
                )
            )
        return topics[:8]


class XTrendProvider:
    async def fetch_country_trends(self, country_iso2: str, window_hours: int = 6) -> list[TopicCluster]:
        return []
