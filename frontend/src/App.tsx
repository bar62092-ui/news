import { useEffect, useMemo, useRef, useState } from "react";

import { fetchBootstrap, fetchCountry, fetchCountryNews, fetchCountryTopics, fetchProviders, getWebSocketUrl } from "./api";
import { CountryPanel } from "./components/CountryPanel";
import { MapView } from "./components/MapView";
import { StatusStrip } from "./components/StatusStrip";
import { buildCountryMapData, localizeCountryName } from "./lib/countries";
import type {
  AirItem,
  BootstrapPayload,
  Bbox,
  CountryNewsPayload,
  CountrySummary,
  LiveSnapshot,
  ProviderHealth,
  SeaItem,
  TopicItem,
} from "./types";

const WATCHLIST = ["BR", "US", "GB", "DE", "FR", "CN"];

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountrySummary | null>(null);
  const [newsPayload, setNewsPayload] = useState<CountryNewsPayload | null>(null);
  const [topicItems, setTopicItems] = useState<TopicItem[]>([]);
  const [airItems, setAirItems] = useState<AirItem[]>([]);
  const [seaItems, setSeaItems] = useState<SeaItem[]>([]);
  const [socketState, setSocketState] = useState("connecting");
  const [viewport, setViewport] = useState<Bbox>([-179.9, -60, 179.9, 85]);
  const [zoom, setZoom] = useState(1.3);
  const [errorText, setErrorText] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectTokenRef = useRef(0);
  const [reconnectToken, setReconnectToken] = useState(0);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);
  const isReady = bootstrap !== null;

  const mergedCountries =
    bootstrap?.countries.map((country) => ({
      ...country,
      name: localizeCountryName(country.iso2, country.name),
    })) ?? [];
  const mapData = useMemo(() => buildCountryMapData(mergedCountries, selectedIso2), [mergedCountries, selectedIso2]);
  const selectedMapCountry = mapData.markers.find((country) => country.iso2 === selectedIso2) ?? null;
  const selectedCountryFromBootstrap = mergedCountries.find((country) => country.iso2 === selectedIso2) ?? null;
  const activeCountry = selectedCountry ?? selectedCountryFromBootstrap;
  const selectedBbox = activeCountry?.bbox ?? selectedMapCountry?.bbox ?? null;
  const shouldShowRoutes = zoom >= 3 || Boolean(activeCountry);
  const watchlistCountries = WATCHLIST.map((iso2) => mergedCountries.find((country) => country.iso2 === iso2)).filter(Boolean) as CountrySummary[];

  useEffect(() => {
    let active = true;
    async function loadBootstrap() {
      try {
        const payload = await fetchBootstrap();
        if (!active) {
          return;
        }
        setBootstrap(payload);
        setProviders(payload.providers);
        setViewport(payload.worldBbox);
        setLastSnapshotAt(payload.generatedAt);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar bootstrap");
      }
    }
    void loadBootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedIso2) {
      return;
    }
    const iso2 = selectedIso2;
    let active = true;
    async function loadCountry() {
      try {
        const [country, news, topics] = await Promise.all([
          fetchCountry(iso2),
          fetchCountryNews(iso2),
          fetchCountryTopics(iso2),
        ]);
        if (!active) {
          return;
        }
        const localizedCountry = {
          ...country,
          name: localizeCountryName(country.iso2, country.name),
        };
        setSelectedCountry(localizedCountry);
        setNewsPayload({
          ...news,
          country: news.country
            ? {
                ...news.country,
                name: localizeCountryName(news.country.iso2, news.country.name),
              }
            : news.country,
        });
        setTopicItems(topics.items);
        setBootstrap((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            countries: current.countries.map((item) =>
              item.iso2 === localizedCountry.iso2 ? { ...item, ...localizedCountry } : item,
            ),
          };
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar país");
      }
    }
    void loadCountry();
    return () => {
      active = false;
    };
  }, [selectedIso2]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let cancelled = false;

    const connect = () => {
      setSocketState("connecting");
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (cancelled) {
          return;
        }
        setSocketState("open");
        sendSubscription(socket, viewport, selectedBbox, selectedIso2, shouldShowRoutes);
      });

      socket.addEventListener("message", (event) => {
        if (cancelled) {
          return;
        }
        const payload = JSON.parse(event.data) as LiveSnapshot;
        if (payload.type !== "snapshot") {
          return;
        }
        setLastSnapshotAt(payload.generatedAt);
        if (payload.air?.items) {
          setAirItems(payload.air.items);
        }
        if (payload.sea?.items) {
          setSeaItems(payload.sea.items);
        }
        if (payload.countryIso2 && (payload.air?.items || payload.sea?.items)) {
          const nextAirCount = payload.air?.items?.length ?? 0;
          const nextSeaCount = payload.sea?.items?.length ?? 0;
          setSelectedCountry((current) =>
            current && current.iso2 === payload.countryIso2
              ? { ...current, airCount: nextAirCount, seaCount: nextSeaCount }
              : current,
          );
          setBootstrap((current) =>
            current
              ? {
                  ...current,
                  countries: current.countries.map((item) =>
                    item.iso2 === payload.countryIso2 ? { ...item, airCount: nextAirCount, seaCount: nextSeaCount } : item,
                  ),
                }
              : current,
          );
        }
        if (payload.news) {
          setNewsPayload((current) => ({
            country: current?.country ?? activeCountry,
            items: payload.news?.items ?? current?.items ?? [],
            stale: payload.news?.stale ?? current?.stale ?? false,
            lastRefreshAt: payload.news?.lastRefreshAt ?? current?.lastRefreshAt ?? null,
            status: payload.news?.status ?? current?.status ?? null,
          }));
        }
        if (payload.topics) {
          setTopicItems(payload.topics);
        }
      });

      socket.addEventListener("close", () => {
        if (cancelled) {
          return;
        }
        setSocketState("closed");
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTokenRef.current += 1;
          setReconnectToken(reconnectTokenRef.current);
        }, 3000);
      });

      socket.addEventListener("error", () => {
        if (cancelled) {
          return;
        }
        setSocketState("closed");
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [isReady, reconnectToken]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    sendSubscription(socket, viewport, selectedBbox, selectedIso2, shouldShowRoutes);
  }, [selectedBbox, selectedIso2, shouldShowRoutes, viewport]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchProviders()
        .then((payload) => setProviders(payload.items))
        .catch(() => {
          // Keep stale provider state on transient failures.
        });
    }, 30000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isReady]);

  return (
    <div className="app-shell">
      <div className="background-glow glow-left" />
      <div className="background-glow glow-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Mapa global de rotas e noticias</p>
          <h1>World Watch</h1>
          <p className="lead-copy">
            Painel 24/7 com pontos por país, rotas aéreas e marítimas por bbox e notícias agregadas com cache degradado.
          </p>
        </div>
        <div className="hero-badges">
          <span className="hero-pill">{shouldShowRoutes ? "rotas ligadas" : "visao global"}</span>
          <span className="hero-pill">{selectedIso2 ? `pais ${selectedIso2}` : "sem pais ativo"}</span>
        </div>
      </header>

      <StatusStrip providers={providers} generatedAt={lastSnapshotAt} socketState={socketState} />

      <section className="watchlist-rail" aria-label="Observatorios prioritarios">
        {watchlistCountries.map((country) => (
          <button
            key={country.iso2}
            className={country.iso2 === selectedIso2 ? "watch-pill active" : "watch-pill"}
            onClick={() => setSelectedIso2(country.iso2)}
            type="button"
          >
            <strong>{country.name}</strong>
            <span>
              {country.newsCount} noticias · {country.airCount + country.seaCount} rotas
            </span>
          </button>
        ))}
      </section>

      {errorText ? <div className="error-banner">{errorText}</div> : null}
      {newsPayload?.stale || socketState !== "open" ? (
        <div className="warning-banner">
          Servindo cache local enquanto as fontes ou o WebSocket se estabilizam. Horario do ultimo snapshot:{" "}
          {lastSnapshotAt ? formatDate(lastSnapshotAt) : "sem dado"}.
        </div>
      ) : null}

      <main className="content-grid">
        <section className="map-shell">
          <div className="map-overlay">
            <div>
              <p className="eyebrow">Camadas ativas</p>
              <strong>{shouldShowRoutes ? "Aereo + maritimo + noticias" : "Noticias e atividade agregada"}</strong>
            </div>
            <span>{shouldShowRoutes ? "zoom detalhado" : "zoom macro"}</span>
          </div>

          <MapView
            countryFeatures={mapData.features}
            countryMarkers={mapData.markers}
            airItems={airItems}
            seaItems={seaItems}
            selectedIso2={selectedIso2}
            selectedBbox={selectedBbox}
            showRoutes={shouldShowRoutes}
            onCountrySelect={(iso2) => setSelectedIso2(iso2)}
            onViewportChange={(nextBbox, nextZoom) => {
              setViewport(nextBbox);
              setZoom(nextZoom);
            }}
          />
        </section>

        <CountryPanel country={activeCountry} news={newsPayload} topics={topicItems} socketState={socketState} />
      </main>
    </div>
  );
}

function sendSubscription(
  socket: WebSocket,
  viewport: Bbox,
  countryBbox: Bbox | null,
  selectedIso2: string | null,
  showRoutes: boolean,
): void {
  const layers = showRoutes ? ["air", "sea", "news"] : ["news"];
  socket.send(
    JSON.stringify({
      bbox: countryBbox ?? viewport,
      countryIso2: selectedIso2,
      layers,
    }),
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
