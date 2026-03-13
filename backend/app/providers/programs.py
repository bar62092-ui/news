from __future__ import annotations

import asyncio
import email.utils
import math
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from typing import Any

import httpx
from bs4 import BeautifulSoup

from ..cache.store import RequestCache
from ..models import ProviderStatus, utc_now
from ..repository import WorldWatchRepository

QUOTE_SPECS: tuple[dict[str, str], ...] = (
    {"board": "stocks", "symbol": "^GSPC", "label": "S&P 500", "currency": "pts"},
    {"board": "stocks", "symbol": "^IXIC", "label": "Nasdaq", "currency": "pts"},
    {"board": "stocks", "symbol": "^BVSP", "label": "Ibovespa", "currency": "pts"},
    {"board": "markets", "symbol": "CL=F", "label": "Petróleo WTI", "currency": "USD"},
    {"board": "markets", "symbol": "GC=F", "label": "Ouro", "currency": "USD"},
    {"board": "markets", "symbol": "DX-Y.NYB", "label": "Dólar Index", "currency": "pts"},
    {"board": "markets", "symbol": "BTC-USD", "label": "Bitcoin", "currency": "USD"},
)

INFRASTRUCTURE_SUMMARY: tuple[dict[str, Any], ...] = (
    {"id": "submarine-cables", "label": "Cabos submarinos", "kind": "route", "count": 5},
    {"id": "oil-routes", "label": "Rotas de petróleo", "kind": "route", "count": 4},
    {"id": "landing-stations", "label": "Landing stations", "kind": "hub", "count": 6},
    {"id": "datacenters", "label": "Datacenters", "kind": "hub", "count": 6},
    {"id": "ixps", "label": "IXPs", "kind": "hub", "count": 6},
)

OUTBREAK_QUERY = '"disease outbreak" OR outbreak OR epidemic OR cholera OR ebola site:who.int when:30d'


@dataclass(slots=True, frozen=True)
class QuoteSnapshot:
    board: str
    symbol: str
    label: str
    price: float
    change: float
    change_percent: float
    currency: str
    updated_at: datetime
    source: str = "Yahoo Finance"

    def to_dict(self) -> dict[str, Any]:
        trend = "flat"
        if self.change_percent > 0.05:
            trend = "up"
        elif self.change_percent < -0.05:
            trend = "down"
        return {
            "symbol": self.symbol,
            "label": self.label,
            "price": round(self.price, 2),
            "change": round(self.change, 2),
            "changePercent": round(self.change_percent, 3),
            "currency": self.currency,
            "updatedAt": self.updated_at.isoformat(),
            "trend": trend,
            "board": self.board,
            "source": self.source,
        }


@dataclass(slots=True, frozen=True)
class OutbreakSignal:
    signal_id: str
    title: str
    summary: str
    published_at: datetime
    source: str
    url: str
    tone: str
    region: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.signal_id,
            "title": self.title,
            "summary": self.summary,
            "publishedAt": self.published_at.isoformat(),
            "source": self.source,
            "url": self.url,
            "tone": self.tone,
            "region": self.region,
        }


class MonitorProgramsProvider:
    def __init__(
        self,
        client: httpx.AsyncClient,
        repository: WorldWatchRepository,
        google_news_locale: str,
        watchlist_countries: tuple[str, ...],
    ) -> None:
        self.client = client
        self.repository = repository
        self.google_news_locale = google_news_locale
        self.watchlist_countries = watchlist_countries
        self._quote_cache = RequestCache()
        self._outbreak_cache = RequestCache()
        self._quote_items: list[QuoteSnapshot] = []
        self._outbreak_items: list[OutbreakSignal] = []
        self._quote_lock = asyncio.Lock()
        self._outbreak_lock = asyncio.Lock()

    async def get_dashboard_payload(self) -> dict[str, Any]:
        quotes = await self._get_quotes()
        outbreaks = await self._get_outbreaks()
        signals = self._build_signal_board()
        channels = self._build_channel_board(signals)
        events = self._build_event_feed(signals, channels, outbreaks, quotes)
        defcon = self._build_defcon(signals, outbreaks, quotes)
        stocks = [quote.to_dict() for quote in quotes if quote.board == "stocks"]
        markets = [quote.to_dict() for quote in quotes if quote.board == "markets"]
        return {
            "generatedAt": utc_now().isoformat(),
            "signals": signals,
            "events": events,
            "stocks": stocks,
            "markets": markets,
            "channels": channels,
            "outbreaks": [item.to_dict() for item in outbreaks],
            "defcon": defcon,
            "infrastructure": list(INFRASTRUCTURE_SUMMARY),
        }

    async def _get_quotes(self) -> list[QuoteSnapshot]:
        cache_key = "quote-board"
        if self._quote_cache.is_fresh(cache_key, 180, utc_now()) and self._quote_items:
            return self._quote_items
        async with self._quote_lock:
            if self._quote_cache.is_fresh(cache_key, 180, utc_now()) and self._quote_items:
                return self._quote_items
            try:
                tasks = [self._fetch_quote(spec) for spec in QUOTE_SPECS]
                items = [item for item in await asyncio.gather(*tasks) if item is not None]
                if not items:
                    raise RuntimeError("Sem cotações retornadas")
            except Exception as exc:  # noqa: BLE001
                items = self._quote_items or self._sample_quotes()
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name="yahoo-finance",
                        ok=bool(self._quote_items),
                        status_text="Fallback de mercados" if self._quote_items else "Falha nas cotações",
                        detail={"error": str(exc), "fallback": True},
                    )
                )
            else:
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name="yahoo-finance",
                        ok=True,
                        status_text="Mercados atualizados",
                        detail={"items": len(items)},
                    )
                )
            self._quote_items = items
            self._quote_cache.mark(cache_key, utc_now())
            return items

    async def _get_outbreaks(self) -> list[OutbreakSignal]:
        cache_key = "outbreak-board"
        if self._outbreak_cache.is_fresh(cache_key, 900, utc_now()) and self._outbreak_items:
            return self._outbreak_items
        async with self._outbreak_lock:
            if self._outbreak_cache.is_fresh(cache_key, 900, utc_now()) and self._outbreak_items:
                return self._outbreak_items
            try:
                items = await self._fetch_outbreaks()
                if not items:
                    raise RuntimeError("Sem surtos retornados")
            except Exception as exc:  # noqa: BLE001
                items = self._outbreak_items or self._sample_outbreaks()
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name="who-outbreaks",
                        ok=bool(self._outbreak_items),
                        status_text="Fallback de surtos" if self._outbreak_items else "Falha ao coletar surtos",
                        detail={"error": str(exc), "fallback": True},
                    )
                )
            else:
                self.repository.update_provider_health(
                    ProviderStatus(
                        provider_name="who-outbreaks",
                        ok=True,
                        status_text="Surtos atualizados",
                        detail={"items": len(items)},
                    )
                )
            self._outbreak_items = items
            self._outbreak_cache.mark(cache_key, utc_now())
            return items

    async def _fetch_quote(self, spec: dict[str, str]) -> QuoteSnapshot | None:
        symbol = urllib.parse.quote(spec["symbol"], safe="")
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=5m&range=1d"
        response = await self.client.get(url)
        response.raise_for_status()
        payload = response.json()
        result = ((payload.get("chart") or {}).get("result") or [None])[0]
        if result is None:
            return None
        meta = result.get("meta") or {}
        indicators = ((result.get("indicators") or {}).get("quote") or [{}])[0]
        closes = [value for value in indicators.get("close") or [] if value is not None]
        price = float(meta.get("regularMarketPrice") or (closes[-1] if closes else 0.0))
        previous_close = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price or 1.0)
        updated_at = _timestamp_to_datetime(meta.get("regularMarketTime")) or utc_now()
        change = price - previous_close
        change_percent = 0.0 if math.isclose(previous_close, 0.0) else (change / previous_close) * 100.0
        return QuoteSnapshot(
            board=spec["board"],
            symbol=spec["symbol"],
            label=spec["label"],
            price=price,
            change=change,
            change_percent=change_percent,
            currency=spec["currency"],
            updated_at=updated_at,
        )

    async def _fetch_outbreaks(self) -> list[OutbreakSignal]:
        url = self._build_google_news_url(OUTBREAK_QUERY)
        response = await self.client.get(url)
        response.raise_for_status()
        root = ET.fromstring(response.text)
        items: list[OutbreakSignal] = []
        for node in root.findall(".//item"):
            title = _normalize_text(node.findtext("title", default=""))
            link = _normalize_text(node.findtext("link", default=""))
            if not title or not link:
                continue
            source = _normalize_text(node.findtext("source", default="WHO / Google News") or "WHO / Google News")
            description = _html_to_text(node.findtext("description", default=""))
            if " - " in title:
                title = title.rsplit(" - ", 1)[0].strip()
            combined = f"{title} {description}".lower()
            tone = _tone_from_outbreak_text(combined)
            items.append(
                OutbreakSignal(
                    signal_id=f"outbreak-{len(items) + 1}",
                    title=title,
                    summary=_truncate(description or "Monitoramento de surtos e alertas sanitários recentes.", 220),
                    published_at=_parse_feed_datetime(node.findtext("pubDate", default="")) or utc_now(),
                    source=source,
                    url=link,
                    tone=tone,
                    region=_infer_region(title, description),
                )
            )
            if len(items) >= 8:
                break
        return items

    def _build_google_news_url(self, query: str) -> str:
        encoded = urllib.parse.quote_plus(query)
        return f"https://news.google.com/rss/search?q={encoded}&hl={urllib.parse.quote(self.google_news_locale)}&gl=BR&ceid=BR:pt-419"

    def _build_signal_board(self) -> list[dict[str, Any]]:
        summaries = self.repository.list_country_summaries()
        by_iso2 = {item["iso2"]: item for item in summaries}
        ordered: list[dict[str, Any]] = []
        for iso2 in self.watchlist_countries:
            country = by_iso2.get(iso2)
            if country:
                ordered.append(country)
        for country in sorted(summaries, key=_signal_score, reverse=True):
            if country["iso2"] not in {item["iso2"] for item in ordered}:
                ordered.append(country)

        signal_items: list[dict[str, Any]] = []
        for country in ordered[:10]:
            score = _signal_score(country)
            topics = self.repository.list_topics(country["iso2"])[:2]
            headline = self.repository.list_news(country["iso2"], limit=1)
            summary = "Monitoramento ativo"
            if topics:
                summary = f"Tópicos: {', '.join(topic['label'] for topic in topics)}"
            elif headline:
                summary = headline[0]["title"]
            signal_items.append(
                {
                    "iso2": country["iso2"],
                    "name": country["name"],
                    "score": score,
                    "level": _tone_from_score(score),
                    "newsCount": country["newsCount"],
                    "airCount": country["airCount"],
                    "seaCount": country["seaCount"],
                    "summary": summary,
                    "lastRefreshAt": country["lastNewsRefreshAt"],
                }
            )
        return signal_items

    def _build_channel_board(self, signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for signal in signals[:8]:
            news_items = self.repository.list_news(signal["iso2"], limit=2)
            for news in news_items[:1]:
                items.append(
                    {
                        "id": f"channel-{signal['iso2']}-{news['id']}",
                        "source": news["source"],
                        "headline": news["title"],
                        "countryIso2": signal["iso2"],
                        "countryName": signal["name"],
                        "publishedAt": news["publishedAt"],
                        "status": "no ar" if _is_recent(news["publishedAt"], minutes=120) else "arquivo",
                        "summary": news["summary"],
                    }
                )
        items.sort(key=lambda item: item["publishedAt"], reverse=True)
        return items[:8]

    def _build_event_feed(
        self,
        signals: list[dict[str, Any]],
        channels: list[dict[str, Any]],
        outbreaks: list[OutbreakSignal],
        quotes: list[QuoteSnapshot],
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []

        for signal in signals[:6]:
            news_items = self.repository.list_news(signal["iso2"], limit=1)
            latest = news_items[0] if news_items else None
            events.append(
                {
                    "id": f"signal-{signal['iso2']}",
                    "kind": "signal",
                    "title": latest["title"] if latest else f"{signal['name']} sob monitoramento",
                    "summary": f"{signal['name']} soma {signal['score']} pontos com {signal['newsCount']} notícias, {signal['airCount']} rotas aéreas e {signal['seaCount']} rotas marítimas.",
                    "tone": signal["level"],
                    "countryIso2": signal["iso2"],
                    "countryName": signal["name"],
                    "source": latest["source"] if latest else "World Watch",
                    "publishedAt": latest["publishedAt"] if latest else utc_now().isoformat(),
                    "tags": [signal["level"], "sinal"],
                }
            )

        for outbreak in outbreaks[:3]:
            events.append(
                {
                    "id": outbreak.signal_id,
                    "kind": "outbreak",
                    "title": outbreak.title,
                    "summary": outbreak.summary,
                    "tone": outbreak.tone,
                    "countryIso2": None,
                    "countryName": outbreak.region,
                    "source": outbreak.source,
                    "publishedAt": outbreak.published_at.isoformat(),
                    "tags": ["surto", outbreak.tone],
                }
            )

        negative_quotes = sorted(quotes, key=lambda item: item.change_percent)[:2]
        for quote in negative_quotes:
            if quote.change_percent >= -0.25:
                continue
            events.append(
                {
                    "id": f"market-{quote.symbol}",
                    "kind": "market",
                    "title": f"{quote.label} em movimento",
                    "summary": f"{quote.label} varia {quote.change_percent:.2f}% e reforça leitura de estresse global.",
                    "tone": "high" if quote.change_percent <= -1.0 else "medium",
                    "countryIso2": None,
                    "countryName": None,
                    "source": quote.source,
                    "publishedAt": quote.updated_at.isoformat(),
                    "tags": ["mercados", quote.symbol],
                }
            )

        for channel in channels[:2]:
            events.append(
                {
                    "id": channel["id"],
                    "kind": "channel",
                    "title": channel["headline"],
                    "summary": channel["summary"] or f"{channel['source']} atualizou {channel['countryName'] or 'o radar global'}.",
                    "tone": "low",
                    "countryIso2": channel["countryIso2"],
                    "countryName": channel["countryName"],
                    "source": channel["source"],
                    "publishedAt": channel["publishedAt"],
                    "tags": ["tv", channel["status"]],
                }
            )

        events.sort(key=lambda item: item["publishedAt"], reverse=True)
        return events[:12]

    def _build_defcon(
        self,
        signals: list[dict[str, Any]],
        outbreaks: list[OutbreakSignal],
        quotes: list[QuoteSnapshot],
    ) -> dict[str, Any]:
        signal_pressure = sum(min(item["score"], 100) for item in signals[:5]) * 0.12
        outbreak_pressure = sum({"critical": 18, "high": 11, "medium": 6, "low": 3}[item.tone] for item in outbreaks[:4])
        market_pressure = sum(max(0.0, -item.change_percent) for item in quotes if item.board == "markets") * 4.5
        provider_pressure = len([provider for provider in self.repository.list_provider_health() if not provider["ok"]]) * 5
        score = min(100.0, signal_pressure + outbreak_pressure + market_pressure + provider_pressure)
        if score >= 84:
            level = 2
            tone = "critical"
            summary = "Fluxo global em nível crítico, com múltiplas frentes acesas."
        elif score >= 64:
            level = 3
            tone = "high"
            summary = "Pressão elevada em sinais, surtos e risco macro."
        elif score >= 42:
            level = 4
            tone = "medium"
            summary = "Alerta moderado, com ruído distribuído e atenção contínua."
        else:
            level = 5
            tone = "low"
            summary = "Postura estável, sem ruptura sistêmica no momento."
        return {
            "level": level,
            "tone": tone,
            "score": round(score, 2),
            "summary": summary,
            "updatedAt": utc_now().isoformat(),
        }

    def _sample_quotes(self) -> list[QuoteSnapshot]:
        now = utc_now()
        return [
            QuoteSnapshot(board="stocks", symbol="^GSPC", label="S&P 500", price=5291.4, change=-18.2, change_percent=-0.34, currency="pts", updated_at=now),
            QuoteSnapshot(board="stocks", symbol="^IXIC", label="Nasdaq", price=18622.8, change=52.4, change_percent=0.28, currency="pts", updated_at=now),
            QuoteSnapshot(board="stocks", symbol="^BVSP", label="Ibovespa", price=128430.0, change=-420.0, change_percent=-0.33, currency="pts", updated_at=now),
            QuoteSnapshot(board="markets", symbol="CL=F", label="Petróleo WTI", price=78.5, change=0.66, change_percent=0.85, currency="USD", updated_at=now),
            QuoteSnapshot(board="markets", symbol="GC=F", label="Ouro", price=2167.2, change=14.4, change_percent=0.67, currency="USD", updated_at=now),
            QuoteSnapshot(board="markets", symbol="BTC-USD", label="Bitcoin", price=68200.0, change=-490.0, change_percent=-0.71, currency="USD", updated_at=now),
        ]

    def _sample_outbreaks(self) -> list[OutbreakSignal]:
        now = utc_now()
        return [
            OutbreakSignal(
                signal_id="outbreak-sample-1",
                title="WHO updates outbreak monitoring for cholera clusters",
                summary="Monitoramento de surtos com pressão sanitária em múltiplos pontos da rede.",
                published_at=now,
                source="WHO",
                url="https://www.who.int/",
                tone="high",
                region="África Oriental",
            ),
            OutbreakSignal(
                signal_id="outbreak-sample-2",
                title="Regional alert tracks respiratory disease transmission",
                summary="Transmissão sob observação com impacto moderado no radar global.",
                published_at=now,
                source="WHO",
                url="https://www.who.int/",
                tone="medium",
                region="Sudeste Asiático",
            ),
        ]


def _timestamp_to_datetime(value: Any) -> datetime | None:
    if value in {None, ""}:
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (TypeError, ValueError):
        return None


def _parse_feed_datetime(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _html_to_text(value: str | None) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "html.parser")
    return _normalize_text(unescape(soup.get_text(" ", strip=True)))


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").split())


def _truncate(value: str, limit: int) -> str:
    compact = _normalize_text(value)
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _infer_region(title: str, summary: str) -> str | None:
    combined = f"{title} {summary}".lower()
    for token, label in (
        ("africa", "África"),
        ("asia", "Ásia"),
        ("europe", "Europa"),
        ("brazil", "Brasil"),
        ("latin america", "América Latina"),
        ("middle east", "Oriente Médio"),
    ):
        if token in combined:
            return label
    return None


def _is_recent(value: str | None, minutes: int) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return False
    return (utc_now() - parsed).total_seconds() <= minutes * 60


def _signal_score(country: dict[str, Any]) -> int:
    return int(country["newsCount"]) + int(country["airCount"]) + int(country["seaCount"])


def _tone_from_score(score: int) -> str:
    if score >= 150:
        return "critical"
    if score >= 70:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def _tone_from_outbreak_text(value: str) -> str:
    if any(token in value for token in ("ebola", "pandemic", "hemorrhagic", "mpox")):
        return "critical"
    if any(token in value for token in ("cholera", "measles", "bird flu", "avian influenza", "outbreak")):
        return "high"
    if any(token in value for token in ("respiratory", "virus", "disease", "transmission")):
        return "medium"
    return "low"
