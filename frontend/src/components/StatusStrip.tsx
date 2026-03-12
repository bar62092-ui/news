import type { ProviderHealth } from "../types";

type StatusStripProps = {
  providers: ProviderHealth[];
  generatedAt: string | null;
  socketState: string;
};

export function StatusStrip({ providers, generatedAt, socketState }: StatusStripProps) {
  const visibleProviders = providers.slice(0, 8);

  return (
    <section className="status-strip">
      <div className="status-copy">
        <p className="eyebrow">Estado do sistema</p>
        <strong>Fontes e transporte em quase tempo real</strong>
        <span>{generatedAt ? `Ultima sincronizacao ${formatDate(generatedAt)}` : "Aguardando primeiro snapshot"}</span>
      </div>
      <div className="pill-group">
        <span className={`provider-pill socket-${socketState}`}>ws {socketState}</span>
        {visibleProviders.map((provider) => (
          <span className={`provider-pill ${provider.ok ? "ok" : "error"}`} key={provider.providerName}>
            {provider.providerName}
          </span>
        ))}
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
