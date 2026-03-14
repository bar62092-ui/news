export type Bbox = [number, number, number, number];
export type ViewMode = "map" | "chain";
export type ProgramId = "signals" | "chat" | "stocks" | "tv" | "markets" | "defcon" | "outbreaks";
export type Tone = "low" | "medium" | "high" | "critical";

export type CountrySummary = {
  iso2: string;
  iso3: string;
  name: string;
  aliases: string[];
  centroid: [number, number] | null;
  bbox: Bbox | null;
  newsCount: number;
  airCount: number;
  seaCount: number;
  lastNewsRefreshAt: string | null;
  lastNewsStatus: string | null;
  providers?: ProviderHealth[];
};

export type ProviderHealth = {
  providerName: string;
  ok: boolean;
  statusText: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  detail: Record<string, unknown>;
};

export type BootstrapPayload = {
  generatedAt: string;
  worldBbox: Bbox;
  layers: {
    air: boolean;
    sea: boolean;
    news: boolean;
    trends: boolean;
    x: boolean;
  };
  countries: CountrySummary[];
  providers: ProviderHealth[];
};

export type NewsItem = {
  id: number;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  language: string | null;
  topics: string[];
  fallbackScope: string;
  summary: string | null;
  contentText: string | null;
  fetchedAt: string;
};

export type CountryNewsPayload = {
  country: CountrySummary | null;
  items: NewsItem[];
  stale: boolean;
  lastRefreshAt: string | null;
  status: string | null;
};

export type LiveNewsItem = NewsItem & {
  countryIso2: string | null;
  countryName: string | null;
};

export type LiveNewsPayload = {
  generatedAt: string;
  items: LiveNewsItem[];
};

export type TopicItem = {
  label: string;
  score: number;
  sourceCount: number;
  lastSeenAt: string;
};

export type TopicsPayload = {
  country: CountrySummary | null;
  items: TopicItem[];
  xItems: TopicItem[];
  xEnabled: boolean;
};

export type AirItem = {
  id: string;
  callsign: string | null;
  originCountry: string | null;
  countryIso2: string | null;
  lastSeenAt: string;
  position: [number, number];
  track: [number, number][];
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
};

export type SeaItem = {
  id: string;
  name: string;
  countryIso2: string | null;
  lastSeenAt: string;
  position: [number, number];
  track: [number, number][];
  speed: number | null;
  course: number | null;
  status: string | null;
  source: string;
};

export type TrafficSnapshot<T> = {
  bbox: Bbox;
  stale: boolean;
  updatedAt: string;
  items: T[];
};

export type ProvidersPayload = {
  generatedAt: string;
  items: ProviderHealth[];
};

export type LiveSnapshot = {
  type: "snapshot";
  generatedAt: string;
  countryIso2?: string | null;
  bbox?: Bbox;
  layers?: string[];
  air?: Omit<TrafficSnapshot<AirItem>, "bbox">;
  sea?: Omit<TrafficSnapshot<SeaItem>, "bbox">;
  news?: Omit<CountryNewsPayload, "country">;
  topics?: TopicItem[];
};

export type DashboardSignalItem = {
  iso2: string;
  name: string;
  score: number;
  level: Tone;
  newsCount: number;
  airCount: number;
  seaCount: number;
  summary: string;
  lastRefreshAt: string | null;
};

export type DashboardEventItem = {
  id: string;
  kind: "signal" | "outbreak" | "market" | "channel";
  title: string;
  summary: string;
  tone: Tone;
  countryIso2: string | null;
  countryName: string | null;
  source: string;
  publishedAt: string;
  tags: string[];
};

export type MarketBoardItem = {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  updatedAt: string;
  trend: "up" | "down" | "flat";
  board: "stocks" | "markets";
  source: string;
};

export type ChannelBoardItem = {
  id: string;
  source: string;
  headline: string;
  countryIso2: string | null;
  countryName: string | null;
  publishedAt: string;
  status: string;
  summary: string | null;
};

export type OutbreakBoardItem = {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  source: string;
  url: string;
  tone: Tone;
  region: string | null;
};

export type DefconSnapshot = {
  level: number;
  tone: Tone;
  score: number;
  summary: string;
  updatedAt: string;
};

export type InfrastructureSummaryItem = {
  id: string;
  label: string;
  kind: string;
  count: number;
};

export type DashboardPayload = {
  generatedAt: string;
  signals: DashboardSignalItem[];
  events: DashboardEventItem[];
  stocks: MarketBoardItem[];
  markets: MarketBoardItem[];
  channels: ChannelBoardItem[];
  outbreaks: OutbreakBoardItem[];
  defcon: DefconSnapshot;
  infrastructure: InfrastructureSummaryItem[];
};
