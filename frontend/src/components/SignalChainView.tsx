import type { DashboardPayload } from "../types";

type SignalChainViewProps = {
  dashboard: DashboardPayload | null;
  selectedIso2: string | null;
  onSelectCountry: (iso2: string) => void;
};

export function SignalChainView({ dashboard, selectedIso2, onSelectCountry }: SignalChainViewProps) {
  if (!dashboard) {
    return (
      <section className="chain-view">
        <div className="chain-empty">Carregando cadeia de sinais...</div>
      </section>
    );
  }

  const topSignal = dashboard.signals[0] ?? null;
  const sharpestMove = [...dashboard.markets, ...dashboard.stocks].sort(
    (left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent),
  )[0];
  const criticalOutbreaks = dashboard.outbreaks.filter((item) => item.tone === "critical" || item.tone === "high").length;

  return (
    <section className="chain-view">
      <div className="chain-summary-grid">
        <article className="chain-card">
          <span>DEFCON</span>
          <strong>{dashboard.defcon.level}</strong>
          <p>{dashboard.defcon.summary}</p>
        </article>
        <article className="chain-card">
          <span>Top sinal</span>
          <strong>{topSignal?.name || "Sem dado"}</strong>
          <p>{topSignal ? `${topSignal.score} pontos ativos` : "Aguardando sinais"}</p>
        </article>
        <article className="chain-card">
          <span>Mercado</span>
          <strong>{sharpestMove?.label || "Sem dado"}</strong>
          <p>{sharpestMove ? `${formatPercent(sharpestMove.changePercent)} no radar` : "Sem variação recente"}</p>
        </article>
        <article className="chain-card">
          <span>Surtos</span>
          <strong>{criticalOutbreaks}</strong>
          <p>Alertas com pressão alta ou crítica.</p>
        </article>
      </div>

      <div className="chain-columns">
        <section className="chain-stream">
          <div className="section-heading">
            <h3>Fluxo ao vivo</h3>
            <span>{dashboard.events.length} eventos</span>
          </div>
          <div className="chain-event-list">
            {dashboard.events.map((event) => (
              <article className="chain-event" key={event.id}>
                <div className="card-topline">
                  <span className={`tone-pill ${event.tone}`}>{event.kind}</span>
                  <span>{formatDate(event.publishedAt)}</span>
                </div>
                <strong>{event.title}</strong>
                <p>{event.summary}</p>
                <small>{event.source}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="chain-side">
          <div className="section-heading">
            <h3>Países e sinais</h3>
            <span>{dashboard.signals.length} países</span>
          </div>
          <div className="chain-signal-grid">
            {dashboard.signals.map((signal) => (
              <button
                className={signal.iso2 === selectedIso2 ? "chain-signal-card active" : "chain-signal-card"}
                key={signal.iso2}
                onClick={() => onSelectCountry(signal.iso2)}
                type="button"
              >
                <div className="card-topline">
                  <span>{signal.name}</span>
                  <span className={`tone-pill ${signal.level}`}>{signal.level}</span>
                </div>
                <strong>{signal.score}</strong>
                <p>{signal.summary}</p>
              </button>
            ))}
          </div>

          <div className="section-heading">
            <h3>Bolsas</h3>
            <span>{dashboard.stocks.length} ativos</span>
          </div>
          <div className="chain-market-list">
            {dashboard.stocks.map((stock) => (
              <article className="chain-market-row" key={stock.symbol}>
                <strong>{stock.label}</strong>
                <span className={stock.trend === "up" ? "trend-up" : stock.trend === "down" ? "trend-down" : "trend-flat"}>
                  {formatPercent(stock.changePercent)}
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function formatDate(value: string): string {
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
