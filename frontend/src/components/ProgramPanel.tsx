import { CountryPanel } from "./CountryPanel";

import type {
  ChannelBoardItem,
  CountryNewsPayload,
  CountrySummary,
  DashboardPayload,
  ProgramId,
  ProviderHealth,
  TopicItem,
  Tone,
} from "../types";

type ProgramPanelProps = {
  activeProgram: ProgramId;
  country: CountrySummary | null;
  news: CountryNewsPayload | null;
  topics: TopicItem[];
  socketState: string;
  dashboard: DashboardPayload | null;
  providers: ProviderHealth[];
  onSelectCountry: (iso2: string) => void;
};

const PROGRAM_TITLES: Record<ProgramId, string> = {
  signals: "Sinais",
  chat: "Sala",
  stocks: "Bolsas",
  tv: "TV",
  markets: "Mercados",
  defcon: "DEFCON",
  outbreaks: "Surtos",
};

export function ProgramPanel({
  activeProgram,
  country,
  news,
  topics,
  socketState,
  dashboard,
  providers,
  onSelectCountry,
}: ProgramPanelProps) {
  if (activeProgram === "signals" && country) {
    return <CountryPanel country={country} news={news} topics={topics} socketState={socketState} />;
  }

  return (
    <aside className="program-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Programa ativo</p>
          <h2>{PROGRAM_TITLES[activeProgram]}</h2>
        </div>
        <span className={`socket-pill ${socketState}`}>{socketState === "open" ? "live" : socketState}</span>
      </div>

      {!dashboard ? (
        <section className="panel-section">
          <p className="muted-copy">Carregando painéis e sinais agregados...</p>
        </section>
      ) : null}

      {dashboard ? renderProgramContent(activeProgram, dashboard, providers, onSelectCountry) : null}
    </aside>
  );
}

function renderProgramContent(
  activeProgram: ProgramId,
  dashboard: DashboardPayload,
  providers: ProviderHealth[],
  onSelectCountry: (iso2: string) => void,
) {
  if (activeProgram === "signals") {
    return (
      <>
        <section className="panel-section">
          <div className="section-heading">
            <h3>Países em foco</h3>
            <span>{dashboard.signals.length} sinais</span>
          </div>
          <div className="signal-list">
            {dashboard.signals.map((signal) => (
              <button className="signal-row" key={signal.iso2} type="button" onClick={() => onSelectCountry(signal.iso2)}>
                <div className="signal-row-head">
                  <strong>{signal.name}</strong>
                  <span className={`tone-pill ${signal.level}`}>{signal.level}</span>
                </div>
                <span>{signal.summary}</span>
                <small>
                  {signal.newsCount} notícias · {signal.airCount + signal.seaCount} rotas · score {signal.score}
                </small>
              </button>
            ))}
          </div>
        </section>
        <section className="panel-section">
          <div className="section-heading">
            <h3>Feed resumido</h3>
            <span>{dashboard.events.length} eventos</span>
          </div>
          <div className="event-list">
            {dashboard.events.slice(0, 5).map((event) => (
              <article className="program-card" key={event.id}>
                <div className="card-topline">
                  <span className={`tone-pill ${event.tone}`}>{event.kind}</span>
                  <span>{formatDate(event.publishedAt)}</span>
                </div>
                <strong>{event.title}</strong>
                <p>{event.summary}</p>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  }

  if (activeProgram === "chat") {
    return (
      <section className="panel-section">
        <div className="section-heading">
          <h3>Sala de situação</h3>
          <span>{dashboard.events.length} entradas</span>
        </div>
        <div className="event-list">
          {dashboard.events.map((event) => (
            <article className="program-card program-card-terminal" key={event.id}>
              <div className="card-topline">
                <span className={`tone-pill ${event.tone}`}>{event.kind}</span>
                <span>{event.source}</span>
              </div>
              <strong>{event.title}</strong>
              <p>{event.summary}</p>
              <small>{formatDate(event.publishedAt)}</small>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (activeProgram === "stocks") {
    return renderMarketBoard("Bolsas globais", dashboard.stocks);
  }

  if (activeProgram === "tv") {
    return (
      <section className="panel-section">
        <div className="section-heading">
          <h3>Rede editorial</h3>
          <span>{dashboard.channels.length} canais</span>
        </div>
        <div className="event-list">
          {dashboard.channels.map((channel) => (
            <ChannelCard channel={channel} key={channel.id} />
          ))}
        </div>
      </section>
    );
  }

  if (activeProgram === "markets") {
    return (
      <>
        {renderMarketBoard("Mercados e macro", dashboard.markets)}
        <section className="panel-section">
          <div className="section-heading">
            <h3>Leitura tática</h3>
            <span>defcon {dashboard.defcon.level}</span>
          </div>
          <article className="program-card">
            <div className="card-topline">
              <span className={`tone-pill ${dashboard.defcon.tone}`}>risco</span>
              <span>{dashboard.defcon.score} pts</span>
            </div>
            <strong>{dashboard.defcon.summary}</strong>
            <p>
              O painel combina pressão de sinais, surtos, mercado e estabilidade das fontes para uma leitura rápida do ambiente.
            </p>
          </article>
        </section>
      </>
    );
  }

  if (activeProgram === "defcon") {
    const failedProviders = providers.filter((provider) => !provider.ok);
    return (
      <>
        <section className="panel-section">
          <div className="defcon-hero">
            <span className={`tone-pill ${dashboard.defcon.tone}`}>defcon {dashboard.defcon.level}</span>
            <strong>{dashboard.defcon.summary}</strong>
            <p>Score global: {dashboard.defcon.score} · atualizado {formatDate(dashboard.defcon.updatedAt)}</p>
          </div>
        </section>
        <section className="panel-section">
          <div className="section-heading">
            <h3>Fontes críticas</h3>
            <span>{failedProviders.length} falhas</span>
          </div>
          <div className="provider-list">
            {(failedProviders.length ? failedProviders : providers.slice(0, 6)).map((provider) => (
              <article className="program-card" key={provider.providerName}>
                <div className="card-topline">
                  <span className={`tone-pill ${provider.ok ? "low" : "high"}`}>{provider.ok ? "ok" : "falha"}</span>
                  <span>{provider.providerName}</span>
                </div>
                <strong>{provider.statusText}</strong>
                <p>{provider.lastSuccessAt ? `Último sucesso: ${formatDate(provider.lastSuccessAt)}` : "Sem sucesso recente"}</p>
              </article>
            ))}
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="panel-section">
      <div className="section-heading">
        <h3>Surtos e alertas</h3>
        <span>{dashboard.outbreaks.length} sinais</span>
      </div>
      <div className="event-list">
        {dashboard.outbreaks.map((item) => (
          <article className="program-card" key={item.id}>
            <div className="card-topline">
              <span className={`tone-pill ${item.tone}`}>surto</span>
              <span>{item.region || item.source}</span>
            </div>
            <strong>{item.title}</strong>
            <p>{item.summary}</p>
            <small>{formatDate(item.publishedAt)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function renderMarketBoard(title: string, items: DashboardPayload["stocks"]) {
  return (
    <section className="panel-section">
      <div className="section-heading">
        <h3>{title}</h3>
        <span>{items.length} ativos</span>
      </div>
      <div className="market-grid">
        {items.map((item) => (
          <article className="market-card" key={item.symbol}>
            <div className="card-topline">
              <span>{item.label}</span>
              <span className={item.trend === "up" ? "trend-up" : item.trend === "down" ? "trend-down" : "trend-flat"}>
                {formatPercent(item.changePercent)}
              </span>
            </div>
            <strong>{formatPrice(item.price, item.currency)}</strong>
            <p>
              {item.source} · {formatDate(item.updatedAt)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ChannelCard({ channel }: { channel: ChannelBoardItem }) {
  return (
    <article className="program-card" key={channel.id}>
      <div className="card-topline">
        <span className={`tone-pill ${channel.status === "no ar" ? "medium" : "low"}`}>{channel.status}</span>
        <span>{channel.source}</span>
      </div>
      <strong>{channel.headline}</strong>
      <p>{channel.summary || `${channel.countryName || "Radar global"} com atualização editorial recente.`}</p>
      <small>{formatDate(channel.publishedAt)}</small>
    </article>
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

function formatPercent(value: number): string {
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value);
  return `${formatted}%`;
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
