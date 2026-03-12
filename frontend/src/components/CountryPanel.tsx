import type { CountryNewsPayload, CountrySummary, TopicItem } from "../types";

type CountryPanelProps = {
  country: CountrySummary | null;
  news: CountryNewsPayload | null;
  topics: TopicItem[];
  socketState: string;
};

export function CountryPanel({ country, news, topics, socketState }: CountryPanelProps) {
  if (!country) {
    return (
      <aside className="country-panel empty-panel">
        <p className="eyebrow">Observatorio global</p>
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
          <p className="eyebrow">Pais ativo</p>
          <h2>{country.name}</h2>
        </div>
        <span className={`socket-pill ${socketState}`}>{socketState === "open" ? "live" : socketState}</span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <span>Noticias 24h</span>
          <strong>{country.newsCount}</strong>
        </article>
        <article className="metric-card">
          <span>Rotas aereas</span>
          <strong>{country.airCount}</strong>
        </article>
        <article className="metric-card">
          <span>Rotas maritimas</span>
          <strong>{country.seaCount}</strong>
        </article>
      </div>

      <section className="panel-section">
        <div className="section-heading">
          <h3>Tendencias locais</h3>
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
          <h3>Noticias recentes</h3>
          <span>{news?.stale ? "cache stale" : "cache fresco"}</span>
        </div>
        {news?.items?.length ? (
          <ul className="news-list">
            {news.items.map((item) => (
              <li key={item.id} className="news-card">
                <a href={item.url} target="_blank" rel="noreferrer">
                  <strong>{item.title}</strong>
                  <span>
                    {item.source} · {formatDate(item.publishedAt)}
                  </span>
                  <small>{item.fallbackScope === "global" ? "fallback global" : "fonte do país"}</small>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-copy">Ainda sem notícias carregadas para este país.</p>
        )}
      </section>
    </aside>
  );
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
