import { GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl, { NavigationControl } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CountryFeature, CountryMarker } from "../lib/countries";
import { INFRASTRUCTURE_HUBS, INFRASTRUCTURE_ROUTES } from "../lib/infrastructure";
import type { AirItem, Bbox, SeaItem } from "../types";

type MapViewProps = {
  countryFeatures: CountryFeature[];
  countryMarkers: CountryMarker[];
  airItems: AirItem[];
  seaItems: SeaItem[];
  selectedIso2: string | null;
  selectedBbox: Bbox | null;
  worldBbox: Bbox;
  resetToken: number;
  showAirLayer: boolean;
  showSeaLayer: boolean;
  showCableRoutes: boolean;
  showOilRoutes: boolean;
  showLandingStations: boolean;
  showDatacenters: boolean;
  showIxps: boolean;
  onCountrySelect: (iso2: string) => void;
  onViewportChange: (bbox: Bbox, zoom: number) => void;
};

const MAP_STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    },
  },
  layers: [
    {
      id: "carto-base",
      type: "raster",
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 19,
    },
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#06090d",
        "background-opacity": 0.16,
      },
    },
  ],
};

const MAX_RENDERED_AIR_ROUTES = 180;
const MAX_RENDERED_SEA_ROUTES = 60;
const MAX_INTERACTION_AIR_POINTS = 48;
const MAX_INTERACTION_SEA_POINTS = 18;

export function MapView({
  countryFeatures,
  countryMarkers,
  airItems,
  seaItems,
  selectedIso2,
  selectedBbox,
  worldBbox,
  resetToken,
  showAirLayer,
  showSeaLayer,
  showCableRoutes,
  showOilRoutes,
  showLandingStations,
  showDatacenters,
  showIxps,
  onCountrySelect,
  onViewportChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const selectCountryRef = useRef(onCountrySelect);
  const viewportChangeRef = useRef(onViewportChange);
  const [isInteracting, setIsInteracting] = useState(false);
  const isInteractingRef = useRef(false);
  const countryCollection = useMemo(() => buildFeatureCollection(countryFeatures), [countryFeatures]);
  const renderedAirItems = useMemo(
    () =>
      showAirLayer
        ? airItems.slice(0, isInteracting ? MAX_INTERACTION_AIR_POINTS : MAX_RENDERED_AIR_ROUTES)
        : [],
    [airItems, isInteracting, showAirLayer],
  );
  const renderedSeaItems = useMemo(
    () =>
      showSeaLayer
        ? seaItems.slice(0, isInteracting ? MAX_INTERACTION_SEA_POINTS : MAX_RENDERED_SEA_ROUTES)
        : [],
    [isInteracting, seaItems, showSeaLayer],
  );

  useEffect(() => {
    selectCountryRef.current = onCountrySelect;
    viewportChangeRef.current = onViewportChange;
  }, [onCountrySelect, onViewportChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE as never,
      center: [0, 18],
      zoom: 1.3,
      minZoom: 1,
      maxZoom: 8.5,
      renderWorldCopies: false,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;
    map.addControl(overlay);

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(container);

    const setInteractionState = (nextValue: boolean) => {
      if (isInteractingRef.current === nextValue) {
        return;
      }
      isInteractingRef.current = nextValue;
      setIsInteracting(nextValue);
    };

    map.on("load", () => {
      map.resize();
      notifyViewport(map, viewportChangeRef.current);
    });

    map.on("movestart", () => {
      setInteractionState(true);
    });
    map.on("moveend", () => {
      setInteractionState(false);
      notifyViewport(map, viewportChangeRef.current);
    });

    return () => {
      resizeObserver.disconnect();
      overlayRef.current?.finalize();
      overlayRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }

    const layers: any[] = [
      new GeoJsonLayer<any>({
        id: "country-polygons",
        data: countryCollection,
        pickable: !isInteracting,
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        getLineWidth: (feature: any) => (feature.properties.selected ? 1.8 : 0.8),
        getLineColor: (feature: any) =>
          feature.properties.selected ? [239, 245, 255, 220] : [82, 111, 146, 132],
        getFillColor: (feature: any) => {
          if (feature.properties.selected) {
            return [86, 113, 145, 152];
          }
          if (feature.properties.activity >= 25) {
            return [25, 50, 66, 110];
          }
          if (feature.properties.activity >= 8) {
            return [20, 40, 54, 96];
          }
          if (feature.properties.activity >= 1) {
            return [15, 28, 40, 86];
          }
          return [10, 19, 28, 74];
        },
        updateTriggers: {
          getLineColor: [selectedIso2],
          getFillColor: [selectedIso2, countryCollection.features.length],
        },
        onHover: (info) => {
          const map = mapRef.current;
          if (!map) {
            return;
          }
          map.getCanvas().style.cursor = info.object ? "pointer" : "";
        },
        onClick: (info) => {
          const feature = info.object;
          if (feature?.properties?.iso2) {
            selectCountryRef.current(feature.properties.iso2);
          }
        },
      }),
      new ScatterplotLayer<CountryMarker>({
        id: "country-markers",
        data: countryMarkers,
        pickable: !isInteracting,
        stroked: !isInteracting,
        radiusUnits: "pixels",
        getPosition: (item) => item.position,
        getRadius: (item) => Math.max(3, Math.min(13, 4.5 + item.activity * 0.18)),
        getFillColor: (item) => (item.selected ? [244, 247, 255, 222] : [107, 196, 255, 176]),
        getLineColor: () => [10, 18, 24, 255],
        lineWidthUnits: "pixels",
        getLineWidth: (item) => (item.selected ? 2 : 1),
        onClick: (info) => {
          const item = info.object;
          if (item) {
            selectCountryRef.current(item.iso2);
          }
        },
      }),
    ];

    if (showCableRoutes) {
      layers.push(
        new PathLayer<any>({
          id: "infra-cables",
          data: INFRASTRUCTURE_ROUTES.filter((item) => item.kind === "cable"),
          getPath: (item) => item.path,
          getColor: () => [93, 171, 245, 136],
          getWidth: 1.6,
          widthUnits: "pixels",
          opacity: 0.5,
        }),
      );
    }

    if (showOilRoutes) {
      layers.push(
        new PathLayer<any>({
          id: "infra-oil",
          data: INFRASTRUCTURE_ROUTES.filter((item) => item.kind === "oil"),
          getPath: (item) => item.path,
          getColor: () => [215, 170, 94, 144],
          getWidth: 1.8,
          widthUnits: "pixels",
          opacity: 0.54,
        }),
      );
    }

    if (showLandingStations) {
      layers.push(buildInfrastructureLayer("infra-landing", "landing", [116, 188, 255, 206]));
    }

    if (showDatacenters) {
      layers.push(buildInfrastructureLayer("infra-datacenters", "datacenter", [125, 224, 166, 204]));
    }

    if (showIxps) {
      layers.push(buildInfrastructureLayer("infra-ixps", "ixp", [239, 188, 113, 204]));
    }

    if (showAirLayer && !isInteracting) {
      layers.push(
        new PathLayer<AirItem>({
          id: "air-paths",
          data: renderedAirItems,
          getPath: (item) => item.track,
          getColor: () => [255, 153, 94, 178],
          getWidth: 1.8,
          widthUnits: "pixels",
          opacity: 0.76,
        }),
      );
    }

    if (showAirLayer) {
      layers.push(
        new ScatterplotLayer<AirItem>({
          id: "air-points",
          data: renderedAirItems,
          radiusUnits: "pixels",
          getPosition: (item) => item.position,
          getRadius: 3.2,
          getFillColor: () => [255, 204, 146, 235],
        }),
      );
    }

    if (showSeaLayer && !isInteracting) {
      layers.push(
        new PathLayer<SeaItem>({
          id: "sea-paths",
          data: renderedSeaItems,
          getPath: (item) => item.track,
          getColor: () => [100, 181, 255, 168],
          getWidth: 1.8,
          widthUnits: "pixels",
          opacity: 0.7,
        }),
      );
    }

    if (showSeaLayer) {
      layers.push(
        new ScatterplotLayer<SeaItem>({
          id: "sea-points",
          data: renderedSeaItems,
          radiusUnits: "pixels",
          getPosition: (item) => item.position,
          getRadius: 3.5,
          getFillColor: (item) => (item.source === "sample" ? [178, 212, 240, 196] : [118, 201, 255, 236]),
        }),
      );
    }

    overlay.setProps({ layers });
  }, [
    countryCollection,
    countryMarkers,
    isInteracting,
    renderedAirItems,
    renderedSeaItems,
    selectedIso2,
    showAirLayer,
    showCableRoutes,
    showDatacenters,
    showIxps,
    showLandingStations,
    showOilRoutes,
    showSeaLayer,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !resetToken) {
      return;
    }
    map.fitBounds(
      [
        [worldBbox[0], worldBbox[1]],
        [worldBbox[2], worldBbox[3]],
      ],
      {
        padding: 32,
        duration: 700,
        maxZoom: 1.6,
      },
    );
  }, [resetToken, worldBbox]);

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
          padding: 72,
          duration: 850,
          maxZoom: 3.4,
        },
      );
    }
  }, [selectedBbox, selectedIso2]);

  return <div className="map-canvas" ref={containerRef} aria-label="Mapa global de rotas e países" />;
}

function buildInfrastructureLayer(id: string, kind: "landing" | "datacenter" | "ixp", color: [number, number, number, number]) {
  return new ScatterplotLayer<any>({
    id,
    data: INFRASTRUCTURE_HUBS.filter((item) => item.kind === kind),
    pickable: false,
    radiusUnits: "pixels",
    getPosition: (item) => item.position,
    getRadius: (item) => 2.5 + item.intensity * 0.45,
    getFillColor: () => color,
    getLineColor: () => [10, 18, 24, 255],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
  });
}

function buildFeatureCollection(
  features: CountryFeature[],
): GeoJSON.FeatureCollection<GeoJSON.Geometry, CountryFeature["properties"]> {
  return {
    type: "FeatureCollection",
    features,
  };
}

function notifyViewport(map: maplibregl.Map, onViewportChange: (bbox: Bbox, zoom: number) => void): void {
  const bounds = map.getBounds();
  onViewportChange([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], map.getZoom());
}
