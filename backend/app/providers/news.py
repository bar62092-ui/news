from __future__ import annotations

import asyncio
import email.utils
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape

import httpx
from bs4 import BeautifulSoup

from ..models import CountryRecord, NewsItem, ProviderStatus, isoformat, utc_now


@dataclass(slots=True, frozen=True)
class NewsFetchResult:
    items: list[NewsItem]
    statuses: list[ProviderStatus]


def _parse_gdelt_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def _truncate_text(value: str, limit: int = 1000) -> str:
    compact = _normalize_text(value)
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _extract_html_text(value: str | None) -> str | None:
    if not value:
        return None
    soup = BeautifulSoup(value, "html.parser")
    text = _normalize_text(soup.get_text(" ", strip=True))
    return text or None


def _extract_meta_description(soup: BeautifulSoup) -> str | None:
    for selector in (
        {"attrs": {"name": "description"}},
        {"attrs": {"property": "og:description"}},
        {"attrs": {"name": "twitter:description"}},
    ):
        tag = soup.find("meta", **selector)
        content = tag.get("content") if tag else None
        if content:
            return _truncate_text(unescape(content))
    return None


def _extract_article_text(html_text: str) -> tuple[str | None, str | None]:
    soup = BeautifulSoup(html_text, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "header", "footer", "nav", "form", "aside"]):
        tag.decompose()

    summary = _extract_meta_description(soup)
    container = soup.find("article") or soup.find("main") or soup.body
    if container is None:
        return summary, None

    paragraphs: list[str] = []
    for paragraph in container.find_all("p"):
        text = _normalize_text(paragraph.get_text(" ", strip=True))
        if len(text) >= 70:
            paragraphs.append(text)
        if len(paragraphs) >= 6:
            break

    if not paragraphs:
        lines = [line.strip() for line in container.get_text("\n", strip=True).splitlines()]
        paragraphs = [line for line in lines if len(line) >= 90][:4]

    content_text = "\n\n".join(paragraphs) if paragraphs else None
    if summary is None and paragraphs:
        summary = _truncate_text(paragraphs[0], limit=260)
    return summary, _truncate_text(content_text, limit=2400) if content_text else None


async def _enrich_with_article_body(client: httpx.AsyncClient, item: NewsItem) -> NewsItem:
    if item.content_text and item.summary:
        return item
    try:
        response = await client.get(item.url, timeout=httpx.Timeout(12.0, connect=8.0))
        response.raise_for_status()
    except Exception:  # noqa: BLE001
        return item
    summary, content_text = _extract_article_text(response.text)
    return NewsItem(
        title=item.title,
        source=item.source,
        url=item.url,
        published_at=item.published_at,
        language=item.language,
        topics=item.topics,
        fallback_scope=item.fallback_scope,
        summary=item.summary or summary,
        content_text=item.content_text or content_text,
    )


class GdeltNewsProvider:
    provider_name = "gdelt"

    def __init__(self, client: httpx.AsyncClient, max_records: int) -> None:
        self.client = client
        self.max_records = max_records

    async def fetch_country_news(self, country: CountryRecord, search_terms: tuple[str, ...], limit: int = 10) -> list[NewsItem]:
        term = search_terms[0] if search_terms else country.name
        params = {
            "query": f'"{term}"',
            "mode": "ArtList",
            "format": "json",
            "sort": "DateDesc",
            "maxrecords": str(min(limit, self.max_records)),
        }
        response = await self.client.get("https://api.gdeltproject.org/api/v2/doc/doc", params=params)
        response.raise_for_status()
        payload = response.json()
        articles = payload.get("articles", [])
        items: list[NewsItem] = []
        for article in articles:
            title = _normalize_text(str(article.get("title", "") or ""))
            url = str(article.get("url", "") or "").strip()
            if not title or not url:
                continue
            published_at = _parse_gdelt_datetime(article.get("seendate")) or utc_now()
            source = str(article.get("sourceCommonName") or article.get("domain") or "GDELT")
            items.append(
                NewsItem(
                    title=title,
                    source=source,
                    url=url,
                    published_at=published_at,
                    language=article.get("language"),
                    fallback_scope="country",
                    summary=None,
                    content_text=None,
                )
            )
        return items


class GoogleNewsRssProvider:
    provider_name = "google-news-rss"

    def __init__(self, client: httpx.AsyncClient, locale: str) -> None:
        self.client = client
        self.locale = locale
        self.country_code = "BR"
        self.ceid = "BR:pt-419"

    async def fetch_country_news(self, country: CountryRecord, search_terms: tuple[str, ...], limit: int = 10) -> list[NewsItem]:
        query = f'"{search_terms[0] if search_terms else country.name}" when:1d'
        url = self._build_search_url(query)
        response = await self.client.get(url)
        response.raise_for_status()
        return self._parse_feed(response.text, limit=limit, fallback_scope="country")

    async def fetch_global_fallback(self, limit: int = 8) -> list[NewsItem]:
        response = await self.client.get(self._build_top_url())
        response.raise_for_status()
        return self._parse_feed(response.text, limit=limit, fallback_scope="global")

    def _build_search_url(self, query: str) -> str:
        encoded = urllib.parse.quote_plus(query)
        return (
            f"https://news.google.com/rss/search?q={encoded}"
            f"&hl={urllib.parse.quote(self.locale)}&gl={self.country_code}&ceid={urllib.parse.quote(self.ceid)}"
        )

    def _build_top_url(self) -> str:
        return f"https://news.google.com/rss?hl={urllib.parse.quote(self.locale)}&gl={self.country_code}&ceid={urllib.parse.quote(self.ceid)}"

    def _parse_feed(self, xml_text: str, limit: int, fallback_scope: str) -> list[NewsItem]:
        root = ET.fromstring(xml_text)
        items: list[NewsItem] = []
        for node in root.findall(".//item"):
            title_text = _normalize_text(node.findtext("title", default=""))
            link = node.findtext("link", default="").strip()
            if not title_text or not link:
                continue
            source = node.findtext("source", default="Google News").strip() or "Google News"
            if " - " in title_text:
                title_text = title_text.rsplit(" - ", 1)[0].strip()
            published_at = email.utils.parsedate_to_datetime(node.findtext("pubDate", default="")) if node.findtext("pubDate") else utc_now()
            if published_at.tzinfo is None:
                published_at = published_at.replace(tzinfo=timezone.utc)
            description_text = _extract_html_text(node.findtext("description", default=""))
            items.append(
                NewsItem(
                    title=title_text,
                    source=source,
                    url=link,
                    published_at=published_at.astimezone(timezone.utc),
                    language=None,
                    fallback_scope=fallback_scope,
                    summary=_truncate_text(description_text, limit=260) if description_text else None,
                    content_text=_truncate_text(description_text, limit=1200) if description_text else None,
                )
            )
            if len(items) >= limit:
                break
        return items


class CombinedNewsProvider:
    def __init__(self, gdelt: GdeltNewsProvider, rss: GoogleNewsRssProvider) -> None:
        self.gdelt = gdelt
        self.rss = rss

    async def fetch_country_news(self, country: CountryRecord, search_terms: tuple[str, ...], limit: int = 12) -> NewsFetchResult:
        merged: list[NewsItem] = []
        statuses: list[ProviderStatus] = []
        for provider, call in (
            (self.gdelt, self.gdelt.fetch_country_news(country, search_terms, limit=limit)),
            (self.rss, self.rss.fetch_country_news(country, search_terms, limit=limit)),
        ):
            try:
                fetched = await call
            except Exception as exc:  # noqa: BLE001
                statuses.append(
                    ProviderStatus(
                        provider_name=provider.provider_name,
                        ok=False,
                        status_text="Falha na coleta",
                        detail={"error": str(exc), "country": country.iso2},
                    )
                )
                continue
            statuses.append(
                ProviderStatus(
                    provider_name=provider.provider_name,
                    ok=True,
                    status_text="Atualizado",
                    detail={"country": country.iso2, "items": len(fetched)},
                )
            )
            merged.extend(fetched)

        merged = dedupe_news(merged)
        if not merged:
            try:
                fallback = await self.rss.fetch_global_fallback(limit=limit)
            except Exception as exc:  # noqa: BLE001
                statuses.append(
                    ProviderStatus(
                        provider_name="google-news-rss:fallback",
                        ok=False,
                        status_text="Fallback indisponivel",
                        detail={"error": str(exc), "country": country.iso2},
                    )
                )
            else:
                statuses.append(
                    ProviderStatus(
                        provider_name="google-news-rss:fallback",
                        ok=True,
                        status_text="Fallback global",
                        detail={"country": country.iso2, "items": len(fallback)},
                    )
                )
                merged = dedupe_news(fallback)
        enriched = await self._enrich_items(merged[:limit])
        return NewsFetchResult(items=enriched, statuses=statuses)

    async def _enrich_items(self, items: list[NewsItem]) -> list[NewsItem]:
        if not items:
            return items
        tasks = [_enrich_with_article_body(self.rss.client, item) for item in items]
        return await asyncio.gather(*tasks)


def dedupe_news(items: list[NewsItem]) -> list[NewsItem]:
    seen: set[str] = set()
    deduped: list[NewsItem] = []
    ordered = sorted(items, key=lambda item: isoformat(item.published_at) or "", reverse=True)
    for item in ordered:
        key = item.url.strip().lower() or item.title.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped
