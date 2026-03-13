import { GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl, { NavigationControl } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AirItem, Bbox, SeaItem } from "../types";
import type { CountryFeature, CountryMarker } from "../lib/countries";

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
      maxZoom: 8,
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
        getLineWidth: (feature: any) => (feature.properties.selected ? 1.8 : 0.9),
        getLineColor: (feature: any) =>
          feature.properties.selected ? [255, 228, 174, 255] : [155, 231, 239, 210],
        getFillColor: (feature: any) => {
          if (feature.properties.selected) {
            return [255, 183, 93, 225];
          }
          if (feature.properties.activity >= 10) {
            return [72, 216, 203, 170];
          }
          if (feature.properties.activity >= 4) {
            return [39, 136, 168, 160];
          }
          if (feature.properties.activity >= 1) {
            return [31, 93, 123, 145];
          }
          return [22, 55, 77, 132];
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
        getRadius: (item) => Math.max(4, Math.min(18, 6 + item.activity * 0.25)),
        getFillColor: (item) => (item.selected ? [255, 194, 121, 220] : [98, 205, 218, 170]),
        getLineColor: () => [8, 18, 29, 255],
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

    if (showAirLayer && !isInteracting) {
      layers.push(
        new PathLayer<AirItem>({
          id: "air-paths",
          data: renderedAirItems,
          getPath: (item) => item.track,
          getColor: () => [255, 123, 69, 190],
          getWidth: 2,
          widthUnits: "pixels",
          opacity: 0.82,
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
          getRadius: 3.5,
          getFillColor: () => [255, 165, 122, 255],
        }),
      );
    }

    if (showSeaLayer && !isInteracting) {
      layers.push(
        new PathLayer<SeaItem>({
          id: "sea-paths",
          data: renderedSeaItems,
          getPath: (item) => item.track,
          getColor: () => [76, 181, 245, 190],
          getWidth: 2,
          widthUnits: "pixels",
          opacity: 0.72,
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
          getRadius: 4,
          getFillColor: (item) => (item.source === "sample" ? [190, 222, 255, 220] : [72, 176, 255, 255]),
        }),
      );
    }

    overlay.setProps({ layers });
  }, [countryCollection, countryMarkers, isInteracting, renderedAirItems, renderedSeaItems, selectedIso2, showAirLayer, showSeaLayer]);

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
