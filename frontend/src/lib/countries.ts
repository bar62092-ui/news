import { geoBounds, geoCentroid } from "d3-geo";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import ptLocale from "i18n-iso-countries/langs/pt.json";
import countriesAtlas from "world-atlas/countries-110m.json";
import { feature } from "topojson-client";

import type { CountrySummary } from "../types";

isoCountries.registerLocale(enLocale);
isoCountries.registerLocale(ptLocale);

type CountryProperties = {
  iso2: string;
  name: string;
  selected: 0 | 1;
  activity: number;
  newsCount: number;
  airCount: number;
  seaCount: number;
};

export type CountryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountryProperties>;

export type CountryMarker = {
  iso2: string;
  name: string;
  position: [number, number];
  activity: number;
  newsCount: number;
  airCount: number;
  seaCount: number;
  selected: boolean;
};

type AtlasTopology = {
  type: string;
  objects: {
    countries: unknown;
  };
};

export function buildCountryMapData(countries: CountrySummary[], selectedIso2: string | null): {
  features: CountryFeature[];
  markers: CountryMarker[];
} {
  const summaryByIso2 = new Map(countries.map((country) => [country.iso2, country]));
  const topology = countriesAtlas as AtlasTopology;
  const collection = feature(topology as never, topology.objects.countries as never) as unknown as GeoJSON.FeatureCollection<
    GeoJSON.Polygon | GeoJSON.MultiPolygon
  >;

  const features: CountryFeature[] = [];
  const markers: CountryMarker[] = [];

  for (const entry of collection.features) {
    const rawId = String(entry.id ?? "").padStart(3, "0");
    const iso2 = ((isoCountries as unknown as { numericToAlpha2?: (value: string) => string | undefined }).numericToAlpha2?.(rawId) ||
      "") as string;
    if (!iso2) {
      continue;
    }
    const summary = summaryByIso2.get(iso2);
    if (!summary) {
      continue;
    }
    const centroid = summary.centroid ?? castPoint(geoCentroid(entry));
    const bounds = summary.bbox ?? flattenBounds(geoBounds(entry));
    const activity = summary.newsCount + summary.airCount + summary.seaCount;

    features.push({
      type: "Feature",
      id: iso2,
      geometry: entry.geometry,
      properties: {
        iso2,
        name: summary.name,
        selected: iso2 === selectedIso2 ? 1 : 0,
        activity,
        newsCount: summary.newsCount,
        airCount: summary.airCount,
        seaCount: summary.seaCount,
      },
      bbox: bounds,
    });

    markers.push({
      iso2,
      name: summary.name,
      position: centroid,
      activity,
      newsCount: summary.newsCount,
      airCount: summary.airCount,
      seaCount: summary.seaCount,
      selected: iso2 === selectedIso2,
    });
  }

  markers.sort((left, right) => right.activity - left.activity || left.name.localeCompare(right.name));
  return { features, markers };
}

export function localizeCountryName(iso2: string, fallback: string): string {
  return isoCountries.getName(iso2, "pt") || fallback;
}

function castPoint(raw: [number, number]): [number, number] {
  return [Number(raw[0]), Number(raw[1])];
}

function flattenBounds(raw: [[number, number], [number, number]]): [number, number, number, number] {
  return [Number(raw[0][0]), Number(raw[0][1]), Number(raw[1][0]), Number(raw[1][1])];
}
