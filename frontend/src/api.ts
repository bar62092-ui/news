import type {
  BootstrapPayload,
  Bbox,
  CountryNewsPayload,
  CountrySummary,
  LiveNewsPayload,
  ProvidersPayload,
  TopicsPayload,
  TrafficSnapshot,
  AirItem,
  SeaItem,
  DashboardPayload,
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getWebSocketUrl(): string {
  const target = new URL(API_BASE_URL || window.location.origin);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.pathname = "/ws/live";
  target.search = "";
  return target.toString();
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  return getJson<BootstrapPayload>("/api/bootstrap");
}

export async function fetchCountry(iso2: string): Promise<CountrySummary> {
  return getJson<CountrySummary>(`/api/countries/${iso2}`);
}

export async function fetchCountryNews(iso2: string): Promise<CountryNewsPayload> {
  return getJson<CountryNewsPayload>(`/api/countries/${iso2}/news?limit=20`);
}

export async function fetchLiveNews(limit = 60): Promise<LiveNewsPayload> {
  return getJson<LiveNewsPayload>(`/api/news/live?limit=${limit}`);
}

export async function fetchCountryTopics(iso2: string): Promise<TopicsPayload> {
  return getJson<TopicsPayload>(`/api/countries/${iso2}/topics`);
}

export async function fetchAirTraffic(bbox: Bbox): Promise<TrafficSnapshot<AirItem>> {
  return getJson<TrafficSnapshot<AirItem>>(`/api/traffic/air?bbox=${bbox.join(",")}`);
}

export async function fetchSeaTraffic(bbox: Bbox): Promise<TrafficSnapshot<SeaItem>> {
  return getJson<TrafficSnapshot<SeaItem>>(`/api/traffic/sea?bbox=${bbox.join(",")}`);
}

export async function fetchProviders(): Promise<ProvidersPayload> {
  return getJson<ProvidersPayload>("/api/providers");
}

export async function fetchDashboard(): Promise<DashboardPayload> {
  return getJson<DashboardPayload>("/api/dashboard");
}
