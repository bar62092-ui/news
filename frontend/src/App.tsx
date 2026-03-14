import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactElement } from "react";

import { fetchBootstrap, fetchCountryNews, fetchCountryTopics, fetchLiveNews } from "./api";
import { MapView } from "./components/MapView";
import { buildCountryMapData, localizeCountryName } from "./lib/countries";
import type {
  BootstrapPayload,
  CountryNewsPayload,
  LiveNewsItem,
  LiveNewsPayload,
  ProviderHealth,
  TopicItem,
} from "./types";

const WORLD_BBOX = [-179.9, -60, 179.9, 85] as const;
type PanelMode = "central" | "pais";

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [liveNews, setLiveNews] = useState<LiveNewsPayload | null>(null);
  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);
  const [countryNews, setCountryNews] = useState<CountryNewsPayload | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>("central");
  const [openNewsId, setOpenNewsId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [panelTop, setPanelTop] = useState(156);
  const headerRef = useRef<HTMLElement | null>(null);

  const localizedCountries = useMemo(
    () =>
      bootstrap?.countries.map((country) => ({
        ...country,
        name: localizeCountryName(country.iso2, country.name),
      })) ?? [],
    [bootstrap],
  );
  const deferredCountries = useDeferredValue(localizedCountries);
  const mapData = useMemo(() => buildCountryMapData(deferredCountries, selectedIso2), [deferredCountries, selectedIso2]);
  const activeCountry = useMemo(
    () => localizedCountries.find((country) => country.iso2 === selectedIso2) ?? null,
    [localizedCountries, selectedIso2],
  );
  const activeCountries = useMemo(
    () =>
      [...localizedCountries]
        .filter((country) => country.newsCount > 0)
        .sort((left, right) => right.newsCount - left.newsCount || left.name.localeCompare(right.name))
        .slice(0, 10),
    [localizedCountries],
  );
  const selectedBbox = activeCountry?.bbox ?? null;
  const worldBbox = bootstrap?.worldBbox ?? [...WORLD_BBOX];
  const totalSignalCountries = mapData.markers.length;
  const totalNewsCount = localizedCountries.reduce((accumulator, country) => accumulator + country.newsCount, 0);
  const activeProviderCount = providers.filter((provider) => provider.ok).length;
  const visibleProviders = providers.slice(0, 5);
  const localizedLiveNews = useMemo(() => localizeLiveNews(liveNews), [liveNews]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorld() {
      try {
        const [bootstrapPayload, livePayload] = await Promise.all([fetchBootstrap(), fetchLiveNews(70)]);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setBootstrap(localizeBootstrap(bootstrapPayload));
          setProviders(bootstrapPayload.providers);
          setLiveNews(livePayload);
          setErrorText(null);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar o mapa global");
      }
    }

    void loadWorld();
    const interval = window.setInterval(() => {
      void loadWorld();
    }, 45000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }

    const updatePanelTop = () => {
      const nextTop = Math.ceil(header.getBoundingClientRect().height) + 28;
      setPanelTop(nextTop);
    };

    updatePanelTop();
    const resizeObserver = new ResizeObserver(() => {
      updatePanelTop();
    });
    resizeObserver.observe(header);
    window.addEventListener("resize", updatePanelTop);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePanelTop);
    };
  }, []);

  useEffect(() => {
    if (!selectedIso2) {
      setCountryNews(null);
      setTopics([]);
      return;
    }

    let cancelled = false;
    const iso2 = selectedIso2;

    async function loadCountry() {
      try {
        const [newsPayload, topicsPayload] = await Promise.all([
          fetchCountryNews(iso2),
          fetchCountryTopics(iso2),
        ]);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setCountryNews({
            ...newsPayload,
            country: newsPayload.country
              ? {
                  ...newsPayload.country,
                  name: localizeCountryName(newsPayload.country.iso2, newsPayload.country.name),
                }
              : null,
          });
          setTopics(topicsPayload.items);
          setOpenNewsId(newsPayload.items[0]?.id ?? null);
          setErrorText(null);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar o pais selecionado");
      }
    }

    void loadCountry();
    return () => {
      cancelled = true;
    };
  }, [selectedIso2]);

  function handleSelectCountry(iso2: string): void {
    setSelectedIso2(iso2);
    setPanelMode("pais");
  }

  function handleShowWorld(): void {
    setSelectedIso2(null);
    setPanelMode("central");
    setCountryNews(null);
    setTopics([]);
    setOpenNewsId(null);
    setResetToken((current) => current + 1);
  }

  return (
    <div className="app-shell live-map-shell" style={{ ["--panel-top" as string]: `${panelTop}px` }}>
      <div className="map-stage">
        <MapView
          countryFeatures={mapData.features}
          countryMarkers={mapData.markers}
          selectedIso2={selectedIso2}
          selectedBbox={selectedBbox}
          worldBbox={worldBbox}
          resetToken={resetToken}
          onCountrySelect={handleSelectCountry}
        />
      </div>

      <header className="hud-panel hud-top" ref={headerRef}>
        <div className="brand-block">
          <p className="eyebrow">Monitor global de noticias</p>
          <h1>World Watch</h1>
          <p className="brand-copy">
            Mapa mundi em tempo quase real com sinal por pais. Abertura leve, mapa em tela inteira e leitura direta do fluxo de noticias.
          </p>
        </div>

        <div className="hero-metrics">
          <article className="hero-metric">
            <span>Paises com sinal</span>
            <strong>{totalSignalCountries}</strong>
          </article>
          <article className="hero-metric">
            <span>Noticias 24h</span>
            <strong>{totalNewsCount}</strong>
          </article>
          <article className="hero-metric">
            <span>Fontes ok</span>
            <strong>{activeProviderCount}</strong>
          </article>
        </div>

        <div className="header-actions">
          <div className="provider-strip">
            {visibleProviders.map((provider) => (
              <span className={provider.ok ? "status-chip ok" : "status-chip error"} key={provider.providerName}>
                {provider.providerName}
              </span>
            ))}
          </div>
          <div className="action-row">
            <button
              className={panelMode === "central" ? "action-chip active" : "action-chip"}
              onClick={() => setPanelMode("central")}
              type="button"
            >
              Central de noticias
            </button>
            <button
              className={panelMode === "pais" ? "action-chip active" : "action-chip"}
              disabled={!activeCountry}
              onClick={() => setPanelMode("pais")}
              type="button"
            >
              Pais ativo
            </button>
            <button className="action-chip" onClick={handleShowWorld} type="button">
              Mundo
            </button>
          </div>
          <p className="status-copy">
            {localizedLiveNews?.generatedAt ? `Atualizado ${formatDate(localizedLiveNews.generatedAt)}` : "Preparando feed global"}
          </p>
        </div>
      </header>

      <aside className="hud-panel hud-left">
        <section className="panel-section compact">
          <div className="section-heading">
            <h2>Paises em destaque</h2>
            <span>{activeCountries.length}</span>
          </div>
          <div className="country-pills">
            {activeCountries.length ? (
              activeCountries.map((country) => (
                <button
                  className={country.iso2 === selectedIso2 ? "country-pill active" : "country-pill"}
                  key={country.iso2}
                  onClick={() => handleSelectCountry(country.iso2)}
                  type="button"
                >
                  <strong>{country.name}</strong>
                  <span>{country.newsCount} noticias</span>
                </button>
              ))
            ) : (
              <p className="muted-copy">Aguardando paises com noticias recentes.</p>
            )}
          </div>
        </section>

        <section className="panel-section compact">
          <div className="section-heading">
            <h2>Leitura do mapa</h2>
          </div>
          <ul className="mini-list">
            <li>O brilho laranja marca paises com noticias recentes.</li>
            <li>Clique no pais ou no sinal para abrir o painel detalhado.</li>
            <li>A central lateral traz o fluxo global sem sair do site.</li>
          </ul>
        </section>
      </aside>

      <aside className="hud-panel hud-right">
        <div className="panel-header sticky">
          <div>
            <p className="eyebrow">{panelMode === "central" ? "Feed global" : "Pais selecionado"}</p>
            <h2>{panelMode === "central" ? "Central de noticias" : activeCountry?.name ?? "Nenhum pais ativo"}</h2>
          </div>
          {panelMode === "pais" && activeCountry ? <span className="status-chip ok">{activeCountry.newsCount} noticias</span> : null}
        </div>

        {errorText ? <div className="alert-banner error">{errorText}</div> : null}

        {panelMode === "central" ? (
          <section className="panel-section panel-scroll">
            {localizedLiveNews?.items?.length ? (
              <ul className="news-list">
                {localizedLiveNews.items.map((item) => (
                  <li className="news-card compact" key={`hub-${item.id}-${item.countryIso2 || "xx"}`}>
                    <button className="news-toggle" onClick={() => setOpenNewsId(item.id)} type="button">
                      <div className="news-meta-row">
                        <span className="country-badge" onClick={(event) => handleCountryBadgeClick(event, item, handleSelectCountry)} role="presentation">
                          {item.countryName || "Radar global"}
                        </span>
                        <span>{formatDate(item.publishedAt)}</span>
                      </div>
                      <strong>{item.title}</strong>
                      <span>
                        {item.source}
                        {item.fallbackScope === "global" ? " · fallback global" : ""}
                      </span>
                    </button>
                    {openNewsId === item.id ? (
                      <div className="news-body">
                        {renderParagraphs(item.contentText || item.summary)}
                        <a className="source-link" href={item.url} rel="noreferrer" target="_blank">
                          Abrir fonte original
                        </a>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">O fluxo global ainda nao recebeu noticias suficientes.</p>
            )}
          </section>
        ) : activeCountry ? (
          <>
            <section className="panel-section compact">
              <div className="metric-inline-grid">
                <article className="metric-tile">
                  <span>Noticias</span>
                  <strong>{activeCountry.newsCount}</strong>
                </article>
                <article className="metric-tile">
                  <span>Atualizacao</span>
                  <strong>{formatShortDate(activeCountry.lastNewsRefreshAt)}</strong>
                </article>
              </div>
            </section>

            <section className="panel-section compact">
              <div className="section-heading">
                <h2>Tendencias</h2>
                <span>{topics.length}</span>
              </div>
              <div className="topic-list">
                {topics.length ? (
                  topics.map((topic) => (
                    <span className="topic-chip" key={topic.label}>
                      {topic.label}
                      <small>{topic.sourceCount} fontes</small>
                    </span>
                  ))
                ) : (
                  <p className="muted-copy">Sem clusters suficientes ainda para este pais.</p>
                )}
              </div>
            </section>

            <section className="panel-section panel-scroll">
              {countryNews?.items?.length ? (
                <ul className="news-list">
                  {countryNews.items.map((item) => (
                    <li className={openNewsId === item.id ? "news-card open" : "news-card"} key={`country-${item.id}`}>
                      <button className="news-toggle" onClick={() => setOpenNewsId(openNewsId === item.id ? null : item.id)} type="button">
                        <strong>{item.title}</strong>
                        <span>
                          {item.source} · {formatDate(item.publishedAt)}
                        </span>
                      </button>
                      {openNewsId === item.id ? (
                        <div className="news-body">
                          {renderParagraphs(item.contentText || item.summary)}
                          <a className="source-link" href={item.url} rel="noreferrer" target="_blank">
                            Abrir fonte original
                          </a>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">Ainda sem noticias suficientes para este pais.</p>
              )}
            </section>
          </>
        ) : (
          <section className="panel-section panel-scroll">
            <p className="muted-copy">Selecione um pais no mapa ou na lista lateral para abrir o detalhe local.</p>
          </section>
        )}
      </aside>

      <footer className="hud-panel hud-bottom">
        <div className="ticker-strip">
          <span className="ticker-label">LIVE</span>
          {(activeCountries.length ? activeCountries : localizedCountries.slice(0, 6)).map((country) => (
            <button className="ticker-item" key={`ticker-${country.iso2}`} onClick={() => handleSelectCountry(country.iso2)} type="button">
              {country.name}: {country.newsCount} noticias
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}

function localizeBootstrap(payload: BootstrapPayload): BootstrapPayload {
  return {
    ...payload,
    countries: payload.countries.map((country) => ({
      ...country,
      name: localizeCountryName(country.iso2, country.name),
    })),
  };
}

function localizeLiveNews(payload: LiveNewsPayload | null): LiveNewsPayload | null {
  if (!payload) {
    return null;
  }
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      countryName: item.countryIso2 ? localizeCountryName(item.countryIso2, item.countryName || item.countryIso2) : item.countryName,
    })),
  };
}

function renderParagraphs(value: string | null | undefined): ReactElement {
  const paragraphs = (value || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!paragraphs.length) {
    return <p className="muted-copy">Sem corpo extraido ainda para esta materia.</p>;
  }

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
      ))}
    </>
  );
}

function handleCountryBadgeClick(
  event: MouseEvent<HTMLSpanElement>,
  item: LiveNewsItem,
  onSelectCountry: (iso2: string) => void,
): void {
  if (!item.countryIso2) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  onSelectCountry(item.countryIso2);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "sem data";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) {
    return "sem dado";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
