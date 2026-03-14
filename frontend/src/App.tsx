import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

import { fetchBootstrap, fetchCountryNews, fetchCountryTopics, fetchDashboard, fetchLiveNews } from "./api";
import { localizeCountryName } from "./lib/countries";
import type {
  BootstrapPayload,
  CountryNewsPayload,
  DashboardPayload,
  DashboardSignalItem,
  LiveNewsItem,
  LiveNewsPayload,
  MarketBoardItem,
  OutbreakBoardItem,
  ProviderHealth,
  TopicItem,
  Tone,
} from "./types";

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [liveNews, setLiveNews] = useState<LiveNewsPayload | null>(null);
  const [selectedIso2, setSelectedIso2] = useState<string | null>(null);
  const [countryNews, setCountryNews] = useState<CountryNewsPayload | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [openFeedId, setOpenFeedId] = useState<number | null>(null);
  const [openContextId, setOpenContextId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const deferredDashboard = useDeferredValue(dashboard);
  const localizedCountries = useMemo(
    () =>
      bootstrap?.countries.map((country) => ({
        ...country,
        name: localizeCountryName(country.iso2, country.name),
      })) ?? [],
    [bootstrap],
  );
  const selectedCountry = useMemo(
    () => localizedCountries.find((country) => country.iso2 === selectedIso2) ?? null,
    [localizedCountries, selectedIso2],
  );
  const selectedSignal = useMemo(
    () => deferredDashboard?.signals.find((signal) => signal.iso2 === selectedIso2) ?? null,
    [deferredDashboard, selectedIso2],
  );
  const totalSignalCountries = deferredDashboard?.signals.length ?? localizedCountries.filter((country) => country.newsCount > 0).length;
  const totalNewsCount = localizedCountries.reduce((total, country) => total + country.newsCount, 0);
  const activeProviderCount = providers.filter((provider) => provider.ok).length;
  const defconAlerts = deferredDashboard?.defcon.alerts?.length ? deferredDashboard.defcon.alerts : deferredDashboard?.events.slice(0, 5) ?? [];

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const [bootstrapPayload, dashboardPayload, livePayload] = await Promise.all([
          fetchBootstrap(),
          fetchDashboard(),
          fetchLiveNews(80),
        ]);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setBootstrap(bootstrapPayload);
          setDashboard(dashboardPayload);
          setProviders(bootstrapPayload.providers);
          setLiveNews(livePayload);
          setErrorText(null);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar o painel");
      }
    }

    void loadDashboard();
    const interval = window.setInterval(() => {
      void loadDashboard();
    }, 45000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedIso2 && deferredDashboard?.signals?.length) {
      setSelectedIso2(deferredDashboard.signals[0].iso2);
    }
  }, [deferredDashboard, selectedIso2]);

  useEffect(() => {
    if (!selectedIso2) {
      setCountryNews(null);
      setTopics([]);
      return;
    }

    let cancelled = false;
    const iso2 = selectedIso2;

    async function loadCountryContext() {
      try {
        const [newsPayload, topicsPayload] = await Promise.all([fetchCountryNews(iso2), fetchCountryTopics(iso2)]);
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setCountryNews(newsPayload);
          setTopics(topicsPayload.items);
          setOpenContextId(newsPayload.items[0]?.id ?? null);
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : "Falha ao carregar o contexto do pais");
      }
    }

    void loadCountryContext();
    return () => {
      cancelled = true;
    };
  }, [selectedIso2]);

  return (
    <div className="news-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">Monitor global de noticias</p>
          <h1>World Watch</h1>
          <p className="lead-copy">
            Home refeita como central de noticias. Sem mapa. Tudo focado em sinais, DEFCON, surtos e reacao de ativos.
          </p>
        </div>

        <div className="hero-strip">
          <article className="hero-card">
            <span>Paises com sinal</span>
            <strong>{totalSignalCountries}</strong>
          </article>
          <article className="hero-card">
            <span>Noticias 24h</span>
            <strong>{totalNewsCount}</strong>
          </article>
          <article className="hero-card">
            <span>Fontes ok</span>
            <strong>{activeProviderCount}</strong>
          </article>
          <article className={`hero-card defcon-card tone-${resolveDefconTone(deferredDashboard?.defcon.tone, deferredDashboard?.defcon.score)}`}>
            <span>DEFCON {deferredDashboard?.defcon.level ?? "--"}</span>
            <strong>{toneLabel(resolveDefconTone(deferredDashboard?.defcon.tone, deferredDashboard?.defcon.score))}</strong>
            <p>{fixText(deferredDashboard?.defcon.summary || "Aguardando leitura global")}</p>
          </article>
        </div>

        <div className="provider-strip">
          {providers.slice(0, 6).map((provider) => (
            <span className={provider.ok ? "status-chip ok" : "status-chip error"} key={provider.providerName}>
              {fixText(provider.providerName)}
            </span>
          ))}
        </div>
      </header>

      {errorText ? <div className="alert-banner">{errorText}</div> : null}

      <main className="dashboard-grid">
        <section className="panel signals-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Sinais</p>
              <h2>Risco por pais</h2>
            </div>
            <span>{deferredDashboard?.signals.length ?? 0}</span>
          </div>

          <div className="signal-list">
            {deferredDashboard?.signals?.length ? (
              deferredDashboard.signals.map((signal) => {
                const tone = resolveSignalTone(signal);
                return (
                  <button
                    className={signal.iso2 === selectedIso2 ? "signal-card active" : "signal-card"}
                    key={signal.iso2}
                    onClick={() => setSelectedIso2(signal.iso2)}
                    type="button"
                  >
                    <div className="card-topline">
                      <strong>{fixText(localizeCountryName(signal.iso2, signal.name))}</strong>
                      <span className={`tone-pill tone-${tone}`}>{signal.riskLabel || toneLabel(tone)}</span>
                    </div>
                    <p>{fixText(signal.summary)}</p>
                    <small>
                      {signal.newsCount} noticias
                      {signal.historyCount ? ` · ${signal.historyCount} eventos em contexto` : ""}
                    </small>
                    {signal.drivers?.length ? (
                      <div className="driver-strip">
                        {signal.drivers.slice(0, 3).map((driver) => (
                          <span className="driver-chip" key={`${signal.iso2}-${driver}`}>
                            {fixText(driver)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="muted-copy">Aguardando classificacao de sinais.</p>
            )}
          </div>

          <div className="panel-header inline-header">
            <div>
              <p className="eyebrow">DEFCON</p>
              <h2>DEFCON e alertas</h2>
            </div>
          </div>

          <div className="alert-list">
            {defconAlerts.length ? (
              defconAlerts.map((alert) => (
                <article className="alert-card" key={alert.id}>
                  <div className="card-topline">
                    <span className={`tone-pill tone-${resolveSignalTone(alert)}`}>{toneLabel(resolveSignalTone(alert))}</span>
                    <span>{formatDate(alert.publishedAt)}</span>
                  </div>
                  <strong>{fixText(alert.title)}</strong>
                  <p>{fixText(alert.source)}</p>
                </article>
              ))
            ) : (
              <p className="muted-copy">Sem alertas publicados ainda.</p>
            )}
          </div>
        </section>

        <section className="panel center-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Central</p>
              <h2>Fluxo de noticias</h2>
            </div>
            <span>{liveNews?.items.length ?? 0}</span>
          </div>

          <div className="feed-list">
            {liveNews?.items?.length ? (
              liveNews.items.map((item) => (
                <article className={openFeedId === item.id ? "news-card open" : "news-card"} key={`feed-${item.id}-${item.countryIso2 || "xx"}`}>
                  <button className="news-toggle" onClick={() => setOpenFeedId(openFeedId === item.id ? null : item.id)} type="button">
                    <div className="card-topline">
                      <span className="country-pill" onClick={(event) => handleCountryClick(event, item, setSelectedIso2)}>
                        {fixText(item.countryIso2 ? localizeCountryName(item.countryIso2, item.countryName || item.countryIso2) : item.countryName || "Radar global")}
                      </span>
                      <span>{formatDate(item.publishedAt)}</span>
                    </div>
                    <strong>{fixText(item.title)}</strong>
                    <p>{fixText(item.source)}</p>
                  </button>
                  {openFeedId === item.id ? (
                    <div className="news-body">
                      {renderParagraphs(item.contentText || item.summary)}
                      <a className="source-link" href={item.url} rel="noreferrer" target="_blank">
                        Abrir fonte original
                      </a>
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="muted-copy">Aguardando o fluxo principal de noticias.</p>
            )}
          </div>

          <div className="panel-header inline-header">
            <div>
              <p className="eyebrow">Contexto</p>
              <h2>{selectedCountry ? `Sinal em foco: ${selectedCountry.name}` : "Selecione um sinal"}</h2>
            </div>
            {selectedSignal ? <span>{selectedSignal.newsCount} noticias</span> : null}
          </div>

          <section className="context-shell">
            {selectedCountry && countryNews?.items?.length ? (
              <>
                <div className="context-summary">
                  <div className="summary-head">
                    <strong>{selectedCountry.name}</strong>
                    <span className={`tone-pill tone-${selectedSignal ? resolveSignalTone(selectedSignal) : "low"}`}>
                      {selectedSignal ? selectedSignal.riskLabel || toneLabel(resolveSignalTone(selectedSignal)) : "baixo"}
                    </span>
                  </div>
                  <p>{fixText(selectedSignal?.summary || "Sem resumo contextual ainda.")}</p>
                  <div className="topic-list">
                    {topics.slice(0, 6).map((topic) => (
                      <span className="topic-chip" key={topic.label}>
                        {fixText(topic.label)}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="timeline-list">
                  {countryNews.items.map((item) => (
                    <article className={openContextId === item.id ? "timeline-card open" : "timeline-card"} key={`context-${item.id}`}>
                      <button className="timeline-toggle" onClick={() => setOpenContextId(openContextId === item.id ? null : item.id)} type="button">
                        <div className="card-topline">
                          <span>{formatDate(item.publishedAt)}</span>
                          <span>{fixText(item.source)}</span>
                        </div>
                        <strong>{fixText(item.title)}</strong>
                      </button>
                      {openContextId === item.id ? (
                        <div className="timeline-body">
                          {renderParagraphs(item.contentText || item.summary)}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted-copy">Escolha um sinal para montar a linha de contexto dos eventos anteriores.</p>
            )}
          </section>
        </section>

        <aside className="panel side-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Outbreaks</p>
              <h2>Epidemias e doencas</h2>
            </div>
            <span>{deferredDashboard?.outbreaks.length ?? 0}</span>
          </div>

          <div className="stack-list">
            {deferredDashboard?.outbreaks?.length ? (
              deferredDashboard.outbreaks.map((item) => (
                <article className="stack-card" key={item.id}>
                  <div className="card-topline">
                    <span className={`tone-pill tone-${resolveSignalTone(item)}`}>{toneLabel(resolveSignalTone(item))}</span>
                    <span>{formatDate(item.publishedAt)}</span>
                  </div>
                  <strong>{fixText(item.title)}</strong>
                  <p>{fixText(item.summary)}</p>
                  <small>{fixText(item.region || item.source)}</small>
                </article>
              ))
            ) : (
              <p className="muted-copy">Sem alertas de surtos no momento.</p>
            )}
          </div>

          <div className="panel-header inline-header">
            <div>
              <p className="eyebrow">Stocks</p>
              <h2>Ativos reagindo a noticias</h2>
            </div>
          </div>

          <div className="stack-list">
            {renderMarketCards(deferredDashboard?.stocks || [], "stocks")}
            {renderMarketCards(deferredDashboard?.markets || [], "markets")}
          </div>
        </aside>
      </main>
    </div>
  );
}

function renderMarketCards(items: MarketBoardItem[], keyPrefix: string) {
  return items.map((item) => (
    <article className="stack-card market-card" key={`${keyPrefix}-${item.symbol}`}>
      <div className="card-topline">
        <strong>{fixText(item.label)}</strong>
        <span className={item.trend === "up" ? "trend-up" : item.trend === "down" ? "trend-down" : "trend-flat"}>
          {formatPercent(item.changePercent)}
        </span>
      </div>
      <p>{formatPrice(item.price, item.currency)}</p>
      {item.reactionTitle ? (
        <div className="reaction-box">
          <small>{fixText(item.reactionCountryName || item.source)}</small>
          <strong>{fixText(item.reactionTitle)}</strong>
          <span>{item.reactionPublishedAt ? formatDate(item.reactionPublishedAt) : fixText(item.reactionSource || item.source)}</span>
        </div>
      ) : (
        <small>{fixText(item.source)}</small>
      )}
    </article>
  ));
}

function resolveSignalTone(item: { tone?: Tone; level?: Tone; score?: number }): Tone {
  if (item.tone) {
    return item.tone === "critical" && (item.score || 0) >= 150 ? "extreme" : item.tone;
  }
  if (item.level) {
    return item.level === "critical" && (item.score || 0) >= 150 ? "extreme" : item.level;
  }
  return "low";
}

function resolveDefconTone(tone: Tone | undefined, score: number | undefined): Tone {
  if (tone === "critical" && (score || 0) >= 84) {
    return "extreme";
  }
  return tone || "low";
}

function toneLabel(tone: Tone): string {
  if (tone === "extreme") {
    return "extremo";
  }
  if (tone === "critical") {
    return "critico";
  }
  if (tone === "high") {
    return "alto";
  }
  if (tone === "medium") {
    return "moderado";
  }
  return "baixo";
}

function handleCountryClick(
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

function renderParagraphs(value: string | null | undefined) {
  const paragraphs = fixText(value || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!paragraphs.length) {
    return <p className="muted-copy">Sem corpo extraido ainda para esta materia.</p>;
  }

  return paragraphs.map((paragraph, index) => <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>);
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

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value)}%`;
}

function formatPrice(value: number, currency: string): string {
  if (currency === "USD") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)} ${currency}`;
}

function fixText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  if (!/[ÃÂ]/.test(compact)) {
    return compact;
  }
  try {
    return decodeURIComponent(escape(compact));
  } catch {
    return compact
      .replace(/Ã¡/g, "á")
      .replace(/Ã©/g, "é")
      .replace(/Ã­/g, "í")
      .replace(/Ã³/g, "ó")
      .replace(/Ãº/g, "ú")
      .replace(/Ã£/g, "ã")
      .replace(/Ãµ/g, "õ")
      .replace(/Ã§/g, "ç")
      .replace(/Ãª/g, "ê")
      .replace(/Ã´/g, "ô")
      .replace(/Â·/g, "·");
  }
}
