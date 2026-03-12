export type Bbox = [number, number, number, number];

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
