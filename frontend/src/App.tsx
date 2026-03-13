import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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

type FocusMode = "all" | "air" | "sea" | "news";

const WATCHLIST = ["BR", "US", "GB", "DE", "FR", "CN"];
const WORLD_BBOX: Bbox = [-179.9, -60, 179.9, 85];
const MODE_OPTIONS: Array<{ id: FocusMode; label: string; summary: string }> = [
  { id: "all", label: "MAPA", summary: "Aereo + maritimo + noticias" },
  { id: "air", label: "AEREO", summary: "Rotas aereas e atividade de voo" },
  { id: "sea", label: "MARITIMO", summary: "Rotas maritimas e atividade naval" },
  { id: "news", label: "NOTICIAS", summary: "Noticias e tendencias por pais" },
];

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
  const [viewport, setViewport] = useState<Bbox>(WORLD_BBOX);
  const [zoom, setZoom] = useState(1.3);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<FocusMode>("all");
  const [reconnectToken, setReconnectToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectTokenRef = useRef(0);
  const isReady = bootstrap !== null;
  const worldBbox = bootstrap?.worldBbox ?? WORLD_BBOX;

  const mergedCountries = useMemo(
    () =>
      bootstrap?.countries.map((country) => ({
        ...country,
        name: localizeCountryName(country.iso2, country.name),
      })) ?? [],
    [bootstrap],
  );
  const mapData = useMemo(() => buildCountryMapData(mergedCountries, selectedIso2), [mergedCountries, selectedIso2]);
  const selectedMapCountry = useMemo(
    () => mapData.markers.find((country) => country.iso2 === selectedIso2) ?? null,
    [mapData.markers, selectedIso2],
  );
  const selectedCountryFromBootstrap = useMemo(
    () => mergedCountries.find((country) => country.iso2 === selectedIso2) ?? null,
    [mergedCountries, selectedIso2],
  );
  const activeCountry = selectedCountry ?? selectedCountryFromBootstrap;
  const selectedBbox = activeCountry?.bbox ?? selectedMapCountry?.bbox ?? null;
  const shouldShowRoutes = zoom >= 3 || Boolean(activeCountry);
  const watchlistCountries = useMemo(
    () => WATCHLIST.map((iso2) => mergedCountries.find((country) => country.iso2 === iso2)).filter(Boolean) as CountrySummary[],
    [mergedCountries],
  );
  const topSignalCountry = useMemo(
    () => [...watchlistCountries].sort((left, right) => signalValue(right) - signalValue(left))[0] ?? null,
    [watchlistCountries],
  );
  const deferredAirItems = useDeferredValue(airItems);
  const deferredSeaItems = useDeferredValue(seaItems);

  const modeConfig = useMemo(() => getModeConfig(focusMode), [focusMode]);
  const subscriptionLayers = useMemo(
    () => buildSubscriptionLayers(focusMode, shouldShowRoutes, selectedIso2),
    [focusMode, selectedIso2, shouldShowRoutes],
  );

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
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar pais");
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
        sendSubscription(socket, viewport, selectedBbox, selectedIso2, subscriptionLayers);
      });

      socket.addEventListener("message", (event) => {
        if (cancelled) {
          return;
        }
        const payload = JSON.parse(event.data) as LiveSnapshot;
        if (payload.type !== "snapshot") {
          return;
        }

        startTransition(() => {
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

            setSelectedCountry((current) => {
              if (!current || current.iso2 !== payload.countryIso2) {
                return current;
              }
              if (current.airCount === nextAirCount && current.seaCount === nextSeaCount) {
                return current;
              }
              return { ...current, airCount: nextAirCount, seaCount: nextSeaCount };
            });

            setBootstrap((current) => {
              if (!current) {
                return current;
              }
              let changed = false;
              const nextCountries = current.countries.map((item) => {
                if (item.iso2 !== payload.countryIso2) {
                  return item;
                }
                if (item.airCount === nextAirCount && item.seaCount === nextSeaCount) {
                  return item;
                }
                changed = true;
                return { ...item, airCount: nextAirCount, seaCount: nextSeaCount };
              });
              return changed ? { ...current, countries: nextCountries } : current;
            });
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
    sendSubscription(socket, viewport, selectedBbox, selectedIso2, subscriptionLayers);
  }, [selectedBbox, selectedIso2, subscriptionLayers, viewport]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchProviders()
        .then((payload) => setProviders(payload.items))
        .catch(() => {
          // Mantem o ultimo estado conhecido em falhas transitarias.
        });
    }, 30000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isReady]);

  function handleSelectCountry(iso2: string): void {
    setSelectedIso2(iso2);
  }

  function handleResetWorldView(): void {
    setSelectedIso2(null);
    setSelectedCountry(null);
    setNewsPayload(null);
    setTopicItems([]);
    setAirItems([]);
    setSeaItems([]);
    setViewport(worldBbox);
    setZoom(1.3);
    setResetToken((current) => current + 1);
  }

  return (
    <div className="app-shell">
      <div className="background-glow glow-left" />
      <div className="background-glow glow-right" />

      <header className="app-header">
        <section className="brand-card">
          <p className="eyebrow">Monitor global de rotas e noticias</p>
          <h1>World Watch</h1>
          <p className="lead-copy">
            Painel em quase tempo real com paises, rotas aereas, rotas maritimas e noticias agregadas.
          </p>
          <div className="brand-meta">
            <span className="hero-pill">{socketState === "open" ? "live" : "reconectando"}</span>
            <span className="hero-pill">{selectedIso2 ? `pais ${selectedIso2}` : "mundo"}</span>
          </div>
        </section>

        <section className="header-main">
          <nav className="mode-bar" aria-label="Modos de leitura">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={focusMode === option.id ? "mode-button active" : "mode-button"}
                type="button"
                onClick={() => setFocusMode(option.id)}
              >
                <strong>{option.label}</strong>
                <span>{option.summary}</span>
              </button>
            ))}
          </nav>

          <StatusStrip providers={providers} generatedAt={lastSnapshotAt} socketState={socketState} />
        </section>
      </header>

      {errorText ? <div className="error-banner">{errorText}</div> : null}
      {newsPayload?.stale || socketState !== "open" ? (
        <div className="warning-banner">
          Servindo cache local enquanto as fontes ou o WebSocket se estabilizam. Ultimo snapshot:{" "}
          {lastSnapshotAt ? formatDate(lastSnapshotAt) : "sem dado"}.
        </div>
      ) : null}

      <main className="monitor-grid">
        <aside className="left-rail">
          <section className="side-card">
            <div className="rail-header">
              <div>
                <p className="eyebrow">Sinais</p>
                <strong>Paises monitorados</strong>
              </div>
              <span>{topSignalCountry ? `top ${topSignalCountry.iso2}` : "sem lider"}</span>
            </div>

            <div className="watchlist-rail" aria-label="Observatorios prioritarios">
              {watchlistCountries.map((country) => (
                <button
                  key={country.iso2}
                  className={country.iso2 === selectedIso2 ? "watch-pill active" : "watch-pill"}
                  onClick={() => handleSelectCountry(country.iso2)}
                  type="button"
                >
                  <div className="watch-pill-head">
                    <strong>{country.name}</strong>
                    <small className={`signal-chip ${signalTone(country)}`}>{signalLabel(country)}</small>
                  </div>
                  <span>
                    {country.newsCount} noticias · {country.airCount + country.seaCount} rotas · sinal {signalValue(country)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="side-card">
            <div className="section-heading">
              <h3>Acoes rapidas</h3>
              <span>{MODE_OPTIONS.find((item) => item.id === focusMode)?.label ?? "MAPA"}</span>
            </div>
            <div className="action-grid">
              <button className="action-button" type="button" onClick={handleResetWorldView}>
                Mundo
              </button>
              <button className="action-button" type="button" onClick={() => handleSelectCountry("BR")}>
                Brasil
              </button>
              <button className="action-button" type="button" onClick={() => handleSelectCountry("US")}>
                EUA
              </button>
              {topSignalCountry ? (
                <button className="action-button action-button-strong" type="button" onClick={() => handleSelectCountry(topSignalCountry.iso2)}>
                  Top sinal
                </button>
              ) : null}
            </div>
          </section>
        </aside>

        <section className="map-shell">
          <div className="map-overlay">
            <div>
              <p className="eyebrow">Camada ativa</p>
              <strong>{MODE_OPTIONS.find((item) => item.id === focusMode)?.summary ?? "Mapa global"}</strong>
            </div>
            <span>{activeCountry ? activeCountry.name : "Visao global"}</span>
          </div>

          <MapView
            countryFeatures={mapData.features}
            countryMarkers={mapData.markers}
            airItems={deferredAirItems}
            seaItems={deferredSeaItems}
            selectedIso2={selectedIso2}
            selectedBbox={selectedBbox}
            worldBbox={worldBbox}
            resetToken={resetToken}
            showAirLayer={shouldShowRoutes && modeConfig.showAir}
            showSeaLayer={shouldShowRoutes && modeConfig.showSea}
            onCountrySelect={handleSelectCountry}
            onViewportChange={(nextBbox, nextZoom) => {
              setViewport(nextBbox);
              setZoom(nextZoom);
            }}
          />
        </section>

        <CountryPanel country={activeCountry} news={newsPayload} topics={topicItems} socketState={socketState} />
      </main>

      <footer className="ticker-bar" aria-label="Fluxo ao vivo">
        <span className="ticker-label">live</span>
        <div className="ticker-track">
          {watchlistCountries.map((country) => (
            <span className="ticker-item" key={country.iso2}>
              {country.name}: {country.newsCount} noticias · {country.airCount + country.seaCount} rotas · sinal {signalValue(country)}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

function buildSubscriptionLayers(focusMode: FocusMode, shouldShowRoutes: boolean, selectedIso2: string | null): string[] {
  const layers: string[] = [];

  if (shouldShowRoutes && (focusMode === "all" || focusMode === "air")) {
    layers.push("air");
  }
  if (shouldShowRoutes && (focusMode === "all" || focusMode === "sea")) {
    layers.push("sea");
  }
  if (selectedIso2 && (focusMode === "all" || focusMode === "news")) {
    layers.push("news");
  }

  if (!layers.length) {
    layers.push("news");
  }

  return layers;
}

function getModeConfig(focusMode: FocusMode): { showAir: boolean; showSea: boolean } {
  if (focusMode === "air") {
    return { showAir: true, showSea: false };
  }
  if (focusMode === "sea") {
    return { showAir: false, showSea: true };
  }
  if (focusMode === "news") {
    return { showAir: false, showSea: false };
  }
  return { showAir: true, showSea: true };
}

function sendSubscription(
  socket: WebSocket,
  viewport: Bbox,
  countryBbox: Bbox | null,
  selectedIso2: string | null,
  layers: string[],
): void {
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

function signalValue(country: CountrySummary): number {
  return country.newsCount + country.airCount + country.seaCount;
}

function signalLabel(country: CountrySummary): string {
  const score = signalValue(country);
  if (score >= 160) {
    return "critico";
  }
  if (score >= 70) {
    return "alto";
  }
  if (score >= 25) {
    return "moderado";
  }
  return "baixo";
}

function signalTone(country: CountrySummary): string {
  const score = signalValue(country);
  if (score >= 160) {
    return "critical";
  }
  if (score >= 70) {
    return "high";
  }
  if (score >= 25) {
    return "medium";
  }
  return "low";
}
