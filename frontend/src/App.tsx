import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchBootstrap,
  fetchCountry,
  fetchCountryNews,
  fetchCountryTopics,
  fetchDashboard,
  fetchProviders,
  getWebSocketUrl,
} from "./api";
import { MapView } from "./components/MapView";
import { ProgramPanel } from "./components/ProgramPanel";
import { SignalChainView } from "./components/SignalChainView";
import { buildCountryMapData, localizeCountryName } from "./lib/countries";
import type {
  AirItem,
  BootstrapPayload,
  Bbox,
  CountryNewsPayload,
  CountrySummary,
  DashboardPayload,
  LiveSnapshot,
  ProgramId,
  ProviderHealth,
  SeaItem,
  TopicItem,
  ViewMode,
} from "./types";

type FocusMode = "all" | "air" | "sea" | "news";
type InfrastructureToggle = "cables" | "oil" | "landing" | "datacenters" | "ixps";

const WORLD_BBOX: Bbox = [-179.9, -60, 179.9, 85];
const VIEW_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: "map", label: "O MAPA" },
  { id: "chain", label: "A CADEIA" },
];
const MAP_MODE_OPTIONS: Array<{ id: FocusMode; label: string }> = [
  { id: "all", label: "Tudo" },
  { id: "air", label: "Aéreo" },
  { id: "sea", label: "Marítimo" },
  { id: "news", label: "Notícias" },
];
const PROGRAM_OPTIONS: Array<{ id: ProgramId; label: string; hot?: boolean }> = [
  { id: "signals", label: "SINAIS", hot: true },
  { id: "chat", label: "SALA" },
  { id: "stocks", label: "BOLSAS" },
  { id: "tv", label: "TV" },
  { id: "markets", label: "MERCADOS" },
  { id: "defcon", label: "DEFCON" },
  { id: "outbreaks", label: "SURTOS" },
];

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
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
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [mapMode, setMapMode] = useState<FocusMode>("all");
  const [activeProgram, setActiveProgram] = useState<ProgramId>("signals");
  const [reconnectToken, setReconnectToken] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);
  const [infraVisibility, setInfraVisibility] = useState<Record<InfrastructureToggle, boolean>>({
    cables: true,
    oil: false,
    landing: true,
    datacenters: false,
    ixps: false,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectTokenRef = useRef(0);
  const activeCountryRef = useRef<CountrySummary | null>(null);
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
  const shouldShowRoutes = viewMode === "map" && (zoom >= 2.6 || Boolean(activeCountry));
  const deferredAirItems = useDeferredValue(airItems);
  const deferredSeaItems = useDeferredValue(seaItems);
  const mapConfig = useMemo(() => getMapConfig(mapMode), [mapMode]);
  const subscriptionLayers = useMemo(
    () => buildSubscriptionLayers(mapMode, shouldShowRoutes, selectedIso2),
    [mapMode, selectedIso2, shouldShowRoutes],
  );
  const topSignal = dashboard?.signals[0] ?? null;
  const tickerEvents = dashboard?.events ?? [];
  const visibleProviders = providers.slice(0, 7);

  useEffect(() => {
    activeCountryRef.current = activeCountry;
  }, [activeCountry]);

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      try {
        const [bootstrapPayload, dashboardPayload] = await Promise.all([fetchBootstrap(), fetchDashboard()]);
        if (!active) {
          return;
        }
        setBootstrap(bootstrapPayload);
        setDashboard(localizeDashboardPayload(dashboardPayload));
        setProviders(bootstrapPayload.providers);
        setViewport(bootstrapPayload.worldBbox);
        setLastSnapshotAt(bootstrapPayload.generatedAt);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar o painel inicial");
      }
    }

    void loadInitialData();
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
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar o país");
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
              country: current?.country ?? activeCountryRef.current,
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
      void Promise.all([fetchProviders(), fetchDashboard()])
        .then(([providerPayload, dashboardPayload]) => {
          setProviders(providerPayload.items);
          setDashboard(localizeDashboardPayload(dashboardPayload));
        })
        .catch(() => {
          // Mantém o último estado conhecido em falhas transitórias.
        });
    }, 30000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isReady]);

  function handleSelectCountry(iso2: string): void {
    setSelectedIso2(iso2);
    setActiveProgram("signals");
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

  function toggleInfrastructure(filter: InfrastructureToggle): void {
    setInfraVisibility((current) => ({
      ...current,
      [filter]: !current[filter],
    }));
  }

  return (
    <div className="app-shell">
      <div className="noise-layer" aria-hidden="true" />
      <div className="vignette-layer" aria-hidden="true" />
      <div className="grid-layer" aria-hidden="true" />
      <div className="scanline-beam" aria-hidden="true" />
      <div className="frame-corner top-left" aria-hidden="true" />
      <div className="frame-corner top-right" aria-hidden="true" />
      <div className="frame-corner bottom-left" aria-hidden="true" />
      <div className="frame-corner bottom-right" aria-hidden="true" />

      <header className="top-bar">
        <div className="brand-block">
          <p className="eyebrow">Signal chain</p>
          <h1>World Watch</h1>
          <p className="brand-copy">Monitor global em português com rotas, sinais, surtos, mercados e notícias inline.</p>
        </div>

        <nav className="view-tabs" aria-label="Modo de visualização">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={viewMode === option.id ? "view-tab active" : "view-tab"}
              onClick={() => setViewMode(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </nav>

        <div className="top-meta">
          <div className="top-meta-copy">
            <span className={`live-indicator ${socketState === "open" ? "open" : "closed"}`}>{socketState === "open" ? "live" : "reconectando"}</span>
            <strong>{topSignal ? `${topSignal.name} em destaque` : "Radar global ativo"}</strong>
            <span>{lastSnapshotAt ? `Último snapshot ${formatDate(lastSnapshotAt)}` : "Aguardando snapshot"}</span>
          </div>
          <div className="top-provider-row">
            {visibleProviders.map((provider) => (
              <span className={`status-chip ${provider.ok ? "ok" : "error"}`} key={provider.providerName}>
                {provider.providerName}
              </span>
            ))}
          </div>
        </div>
      </header>

      {errorText ? <div className="alert-banner error">{errorText}</div> : null}
      {newsPayload?.stale || socketState !== "open" ? (
        <div className="alert-banner warning">
          Servindo cache local enquanto as fontes estabilizam. Último snapshot: {lastSnapshotAt ? formatDate(lastSnapshotAt) : "sem dado"}.
        </div>
      ) : null}

      <main className="monitor-layout">
        <aside className="program-dock" aria-label="Programas">
          {PROGRAM_OPTIONS.map((program, index) => (
            <button
              key={program.id}
              className={activeProgram === program.id ? "dock-button active" : "dock-button"}
              onClick={() => setActiveProgram(program.id)}
              type="button"
            >
              <span className="dock-index">{index + 1}</span>
              <span className="dock-label">{program.label}</span>
              <span className="dock-count">{programCount(program.id, dashboard)}</span>
              {program.hot ? <span className="dock-hot">HOT</span> : null}
            </button>
          ))}
        </aside>

        <section className="stage-shell">
          {viewMode === "map" ? (
            <div className="map-stage">
              <div className="overlay-card stage-card-left">
                <p className="eyebrow">Camada ativa</p>
                <strong>{mapModeLabel(mapMode)}</strong>
                <span>{activeCountry ? activeCountry.name : "Visão global"}</span>
              </div>

              <div className="overlay-card stage-card-right">
                <div className="overlay-group">
                  {MAP_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      className={mapMode === option.id ? "mini-toggle active" : "mini-toggle"}
                      onClick={() => setMapMode(option.id)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="overlay-group">
                  <button className={infraVisibility.cables ? "mini-toggle active" : "mini-toggle"} onClick={() => toggleInfrastructure("cables")} type="button">
                    Cabos
                  </button>
                  <button className={infraVisibility.oil ? "mini-toggle active" : "mini-toggle"} onClick={() => toggleInfrastructure("oil")} type="button">
                    Petróleo
                  </button>
                  <button className={infraVisibility.landing ? "mini-toggle active" : "mini-toggle"} onClick={() => toggleInfrastructure("landing")} type="button">
                    Landing
                  </button>
                  <button
                    className={infraVisibility.datacenters ? "mini-toggle active" : "mini-toggle"}
                    onClick={() => toggleInfrastructure("datacenters")}
                    type="button"
                  >
                    DC
                  </button>
                  <button className={infraVisibility.ixps ? "mini-toggle active" : "mini-toggle"} onClick={() => toggleInfrastructure("ixps")} type="button">
                    IXP
                  </button>
                </div>
              </div>

              <div className="mini-signal-board">
                <div className="section-heading">
                  <h3>Sinais</h3>
                  <span>{dashboard?.signals.length ?? 0}</span>
                </div>
                <div className="mini-signal-list">
                  {(dashboard?.signals.slice(0, 4) ?? []).map((signal) => (
                    <button
                      className={signal.iso2 === selectedIso2 ? "mini-signal-row active" : "mini-signal-row"}
                      key={signal.iso2}
                      onClick={() => handleSelectCountry(signal.iso2)}
                      type="button"
                    >
                      <div className="card-topline">
                        <strong>{signal.name}</strong>
                        <span className={`tone-pill ${signal.level}`}>{signal.level}</span>
                      </div>
                      <span>{signal.score} pontos</span>
                    </button>
                  ))}
                  <button className="mini-signal-row reset-row" onClick={handleResetWorldView} type="button">
                    Resetar visão global
                  </button>
                </div>
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
                showAirLayer={shouldShowRoutes && mapConfig.showAir}
                showSeaLayer={shouldShowRoutes && mapConfig.showSea}
                showCableRoutes={infraVisibility.cables}
                showOilRoutes={infraVisibility.oil}
                showLandingStations={infraVisibility.landing}
                showDatacenters={infraVisibility.datacenters}
                showIxps={infraVisibility.ixps}
                onCountrySelect={handleSelectCountry}
                onViewportChange={(nextBbox, nextZoom) => {
                  setViewport(nextBbox);
                  setZoom(nextZoom);
                }}
              />
            </div>
          ) : (
            <SignalChainView dashboard={dashboard} onSelectCountry={handleSelectCountry} selectedIso2={selectedIso2} />
          )}
        </section>

        <ProgramPanel
          activeProgram={activeProgram}
          country={activeCountry}
          news={newsPayload}
          topics={topicItems}
          socketState={socketState}
          dashboard={dashboard}
          providers={providers}
          onSelectCountry={handleSelectCountry}
        />
      </main>

      <footer className="ticker-bar" aria-label="Fluxo ao vivo">
        <span className="ticker-label">LIVE</span>
        <div className="ticker-track">
          {tickerEvents.map((event) => (
            <span className="ticker-item" key={event.id}>
              {event.title} · {event.source}
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

function getMapConfig(focusMode: FocusMode): { showAir: boolean; showSea: boolean } {
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

function programCount(program: ProgramId, dashboard: DashboardPayload | null): number | string {
  if (!dashboard) {
    return "--";
  }
  switch (program) {
    case "signals":
      return dashboard.signals.length;
    case "chat":
      return dashboard.events.length;
    case "stocks":
      return dashboard.stocks.length;
    case "tv":
      return dashboard.channels.length;
    case "markets":
      return dashboard.markets.length;
    case "defcon":
      return dashboard.defcon.level;
    case "outbreaks":
      return dashboard.outbreaks.length;
  }
}

function mapModeLabel(mapMode: FocusMode): string {
  const item = MAP_MODE_OPTIONS.find((option) => option.id === mapMode);
  return item?.label ?? "Tudo";
}

function localizeDashboardPayload(payload: DashboardPayload): DashboardPayload {
  return {
    ...payload,
    signals: payload.signals.map((signal) => ({
      ...signal,
      name: localizeCountryName(signal.iso2, signal.name),
    })),
    events: payload.events.map((event) => ({
      ...event,
      countryName: event.countryIso2 ? localizeCountryName(event.countryIso2, event.countryName || event.countryIso2) : event.countryName,
    })),
    channels: payload.channels.map((channel) => ({
      ...channel,
      countryName: channel.countryIso2 ? localizeCountryName(channel.countryIso2, channel.countryName || channel.countryIso2) : channel.countryName,
    })),
  };
}
