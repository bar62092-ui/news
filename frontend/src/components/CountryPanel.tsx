import { useEffect, useState } from "react";

import type { CountryNewsPayload, CountrySummary, TopicItem } from "../types";

type CountryPanelProps = {
  country: CountrySummary | null;
  news: CountryNewsPayload | null;
  topics: TopicItem[];
  socketState: string;
};

export function CountryPanel({ country, news, topics, socketState }: CountryPanelProps) {
  const [openNewsId, setOpenNewsId] = useState<number | null>(null);
  const signalCount = country ? country.newsCount + country.airCount + country.seaCount : 0;

  useEffect(() => {
    setOpenNewsId(news?.items?.[0]?.id ?? null);
  }, [country?.iso2, news?.items]);

  if (!country) {
    return (
      <aside className="country-panel empty-panel">
        <p className="eyebrow">Observatório global</p>
        <h2>Escolha um país no mapa</h2>
        <p>
          Os pontos indicam países com notícias, trilhas e coletas recentes. Em zoom global o painel funciona como centro de
          triagem; ao selecionar um país o mapa aproxima e puxa rotas do bbox ativo.
        </p>
      </aside>
    );
  }

  return (
    <aside className="country-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">País ativo</p>
          <h2>{country.name}</h2>
        </div>
        <span className={`socket-pill ${socketState}`}>{socketState === "open" ? "live" : socketState}</span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <span>Notícias 24h</span>
          <strong>{country.newsCount}</strong>
        </article>
        <article className="metric-card">
          <span>Rotas aéreas</span>
          <strong>{country.airCount}</strong>
        </article>
        <article className="metric-card">
          <span>Rotas marítimas</span>
          <strong>{country.seaCount}</strong>
        </article>
        <article className="metric-card">
          <span>Sinal total</span>
          <strong>{signalCount}</strong>
        </article>
      </div>

      <section className="panel-section">
        <div className="section-heading">
          <h3>Tendências locais</h3>
          <span>{topics.length} clusters</span>
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
            <p className="muted-copy">Sem clusters suficientes ainda. O backend recalcula isso a partir das manchetes recentes.</p>
          )}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-heading">
          <h3>Notícias recentes</h3>
          <span>{news?.stale ? "cache stale" : "cache fresco"}</span>
        </div>
        {news?.items?.length ? (
          <ul className="news-list">
            {news.items.map((item) => {
              const isOpen = item.id === openNewsId;
              const paragraphs = splitParagraphs(item.contentText || item.summary);
              return (
                <li key={item.id} className={isOpen ? "news-card open" : "news-card"}>
                  <button className="news-toggle" type="button" onClick={() => setOpenNewsId(isOpen ? null : item.id)}>
                    <strong>{item.title}</strong>
                    <span>
                      {item.source} · {formatDate(item.publishedAt)}
                    </span>
                    <small>{item.fallbackScope === "global" ? "fallback global" : "fonte do país"}</small>
                  </button>
                  {isOpen ? (
                    <div className="news-body">
                      {item.summary ? <p className="news-summary">{item.summary}</p> : null}
                      {paragraphs.length ? (
                        paragraphs.map((paragraph, index) => <p key={`${item.id}-${index}`}>{paragraph}</p>)
                      ) : (
                        <p className="muted-copy">Sem corpo extraído ainda para esta matéria.</p>
                      )}
                      <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
                        Fonte original
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted-copy">Ainda sem notícias carregadas para este país.</p>
        )}
      </section>
    </aside>
  );
}

function splitParagraphs(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 5);
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
