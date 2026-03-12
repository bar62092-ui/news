import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl, { GeoJSONSource, NavigationControl } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { AirItem, Bbox, SeaItem } from "../types";
import type { CountryFeature, CountryMarker } from "../lib/countries";

type MapViewProps = {
  countryFeatures: CountryFeature[];
  countryMarkers: CountryMarker[];
  airItems: AirItem[];
  seaItems: SeaItem[];
  selectedIso2: string | null;
  selectedBbox: Bbox | null;
  showRoutes: boolean;
  onCountrySelect: (iso2: string) => void;
  onViewportChange: (bbox: Bbox, zoom: number) => void;
};

const MAP_STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#07131d",
      },
    },
  ],
};

export function MapView({
  countryFeatures,
  countryMarkers,
  airItems,
  seaItems,
  selectedIso2,
  selectedBbox,
  showRoutes,
  onCountrySelect,
  onViewportChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE as never,
      center: [0, 18],
      zoom: 1.3,
      minZoom: 1,
      maxZoom: 8,
      renderWorldCopies: false,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay);

    map.on("load", () => {
      map.addSource("countries", {
        type: "geojson",
        data: buildFeatureCollection(countryFeatures) as never,
      });
      map.addLayer({
        id: "country-fills",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], 1],
            "#ffb75d",
            ["step", ["get", "activity"], "#0f2334", 1, "#184b67", 4, "#2c7da0", 10, "#5cd4c0"],
          ],
          "fill-opacity": 0.72,
        },
      });
      map.addLayer({
        id: "country-lines",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "#8adbe2",
          "line-opacity": 0.35,
          "line-width": ["case", ["==", ["get", "selected"], 1], 1.5, 0.6],
        },
      });

      map.on("mouseenter", "country-fills", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "country-fills", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "country-fills", (event) => {
        const iso2 = event.features?.[0]?.properties?.iso2;
        if (typeof iso2 === "string" && iso2) {
          onCountrySelect(iso2);
        }
      });

      notifyViewport(map, onViewportChange);
    });

    map.on("moveend", () => {
      notifyViewport(map, onViewportChange);
    });

    return () => {
      overlayRef.current?.finalize();
      overlayRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [countryFeatures, onCountrySelect, onViewportChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }
    const source = map.getSource("countries") as GeoJSONSource | undefined;
    if (source) {
      source.setData(buildFeatureCollection(countryFeatures) as never);
    }
  }, [countryFeatures]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    const layers: any[] = [
      new ScatterplotLayer<CountryMarker>({
        id: "country-markers",
        data: countryMarkers,
        pickable: true,
        stroked: true,
        radiusUnits: "pixels",
        getPosition: (item) => item.position,
        getRadius: (item) => Math.max(4, Math.min(18, 6 + item.activity * 0.25)),
        getFillColor: (item) => (item.selected ? [255, 194, 121, 220] : [98, 205, 218, 170]),
        getLineColor: () => [8, 18, 29, 255],
        lineWidthUnits: "pixels",
        getLineWidth: (item) => (item.selected ? 2 : 1),
        onClick: (info) => {
          const item = info.object;
          if (item) {
            onCountrySelect(item.iso2);
          }
        },
      }),
    ];

    if (showRoutes) {
      layers.push(
        new PathLayer<AirItem>({
          id: "air-paths",
          data: airItems,
          getPath: (item) => item.track,
          getColor: () => [255, 123, 69, 190],
          getWidth: 2,
          widthUnits: "pixels",
          opacity: 0.82,
        }),
      );
      layers.push(
        new ScatterplotLayer<AirItem>({
          id: "air-points",
          data: airItems,
          radiusUnits: "pixels",
          getPosition: (item) => item.position,
          getRadius: 3.5,
          getFillColor: () => [255, 165, 122, 255],
        }),
      );
      layers.push(
        new PathLayer<SeaItem>({
          id: "sea-paths",
          data: seaItems,
          getPath: (item) => item.track,
          getColor: () => [76, 181, 245, 190],
          getWidth: 2,
          widthUnits: "pixels",
          opacity: 0.72,
        }),
      );
      layers.push(
        new ScatterplotLayer<SeaItem>({
          id: "sea-points",
          data: seaItems,
          radiusUnits: "pixels",
          getPosition: (item) => item.position,
          getRadius: 4,
          getFillColor: (item) => (item.source === "sample" ? [190, 222, 255, 220] : [72, 176, 255, 255]),
        }),
      );
    }

    overlay.setProps({ layers });
  }, [airItems, countryMarkers, onCountrySelect, seaItems, showRoutes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedBbox) {
      return;
    }
    const currentZoom = map.getZoom();
    if (selectedIso2 && currentZoom < 3.2) {
      map.fitBounds(
        [
          [selectedBbox[0], selectedBbox[1]],
          [selectedBbox[2], selectedBbox[3]],
        ],
        {
          padding: 48,
          duration: 900,
          maxZoom: 4.1,
        },
      );
    }
  }, [selectedBbox, selectedIso2]);

  return <div className="map-canvas" ref={containerRef} aria-label="Mapa global de rotas e países" />;
}

function buildFeatureCollection(features: CountryFeature[]): GeoJSON.FeatureCollection<GeoJSON.Geometry, CountryFeature["properties"]> {
  return {
    type: "FeatureCollection",
    features,
  };
}

function notifyViewport(map: maplibregl.Map, onViewportChange: (bbox: Bbox, zoom: number) => void): void {
  const bounds = map.getBounds();
  onViewportChange([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], map.getZoom());
}
