import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CountryFeature, CountryMarker } from "../lib/countries";
import type { Bbox } from "../types";

type MapViewProps = {
  countryFeatures: CountryFeature[];
  countryMarkers: CountryMarker[];
  selectedIso2: string | null;
  selectedBbox: Bbox | null;
  worldBbox: Bbox;
  resetToken: number;
  onCountrySelect: (iso2: string) => void;
};

type Size = {
  width: number;
  height: number;
};

export function MapView({
  countryFeatures,
  countryMarkers,
  selectedIso2,
  onCountrySelect,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 1280, height: 720 });
  const featureCollection = useMemo(
    () =>
      ({
        type: "FeatureCollection",
        features: countryFeatures,
      }) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountryFeature["properties"]>,
    [countryFeatures],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const nextWidth = Math.max(320, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(260, Math.floor(entry.contentRect.height));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const projection = useMemo(() => {
    const nextProjection = geoNaturalEarth1();
    nextProjection.fitExtent(
      [
        [28, 22],
        [Math.max(29, size.width - 28), Math.max(23, size.height - 22)],
      ],
      featureCollection,
    );
    return nextProjection;
  }, [featureCollection, size.height, size.width]);

  const pathGenerator = useMemo(() => geoPath(projection), [projection]);
  const graticulePath = useMemo(() => pathGenerator(geoGraticule10()) ?? "", [pathGenerator]);
  const renderedMarkers = useMemo(
    () =>
      countryMarkers
        .map((marker) => {
          const position = projection(marker.position);
          if (!position) {
            return null;
          }
          return {
            ...marker,
            screenX: position[0],
            screenY: position[1],
          };
        })
        .filter(Boolean) as Array<
        CountryMarker & {
          screenX: number;
          screenY: number;
        }
      >,
    [countryMarkers, projection],
  );

  return (
    <div className="map-canvas" ref={containerRef}>
      <svg
        aria-label="Mapa mundi de noticias por pais"
        className="world-svg"
        role="img"
        viewBox={`0 0 ${size.width} ${size.height}`}
      >
        <rect className="world-sea" height={size.height} width={size.width} x={0} y={0} />
        <path className="world-graticule" d={graticulePath} />

        <g className="world-countries">
          {countryFeatures.map((feature) => {
            const path = pathGenerator(feature);
            if (!path) {
              return null;
            }
            const activity = feature.properties.activity;
            const isSelected = feature.properties.iso2 === selectedIso2;
            const className = isSelected
              ? "country-shape selected"
              : activity > 0
                ? "country-shape active"
                : "country-shape idle";
            return (
              <path
                className={className}
                d={path}
                key={feature.properties.iso2}
                onClick={() => onCountrySelect(feature.properties.iso2)}
              >
                <title>
                  {feature.properties.name}: {feature.properties.newsCount} noticias
                </title>
              </path>
            );
          })}
        </g>

        <g className="world-signals">
          {renderedMarkers.map((marker) => {
            const radius = Math.max(4, Math.min(12, 4 + marker.activity * 0.12));
            return (
              <g
                className={marker.iso2 === selectedIso2 ? "signal-node selected" : "signal-node"}
                key={marker.iso2}
                onClick={() => onCountrySelect(marker.iso2)}
                transform={`translate(${marker.screenX} ${marker.screenY})`}
              >
                <circle className="signal-halo" r={radius * 2.4} />
                <circle className="signal-core" r={radius} />
                <title>
                  {marker.name}: {marker.newsCount} noticias
                </title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
