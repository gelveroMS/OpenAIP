"use client";

import { useEffect, useMemo, useTransition } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LguOverviewVM } from "@/lib/domain/landing-content";
import { cn } from "@/lib/ui/utils";
import { buildDashboardScopeHref } from "./map-scope-query";

const DEFAULT_MARKER_ICON = {
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
};

// Next.js + Leaflet marker compatibility.
L.Icon.Default.mergeOptions(DEFAULT_MARKER_ICON);

type LguMapPanelLeafletProps = {
  map: LguOverviewVM["map"];
  className?: string;
  onReady?: () => void;
};

type FitMapToMarkersProps = {
  markers: LguOverviewVM["map"]["markers"];
  fallbackCenter: LguOverviewVM["map"]["center"];
  fallbackZoom: number;
};

function FitMapToMarkers({ markers, fallbackCenter, fallbackZoom }: FitMapToMarkersProps) {
  const mapInstance = useMap();

  useEffect(() => {
    if (!markers.length) {
      mapInstance.setView(fallbackCenter, fallbackZoom);
      return;
    }

    if (markers.length === 1) {
      const marker = markers[0];
      mapInstance.setView([marker.lat, marker.lng], Math.max(fallbackZoom, 14));
      return;
    }

    const bounds = L.latLngBounds(markers.map((marker) => [marker.lat, marker.lng] as [number, number]));
    mapInstance.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
  }, [fallbackCenter, fallbackZoom, mapInstance, markers]);

  return null;
}

export default function LguMapPanelLeaflet({
  map,
  className,
  onReady,
}: LguMapPanelLeafletProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const mainMarkerId = useMemo(
    () => map.markers.find((marker) => marker.kind === "main")?.id ?? null,
    [map.markers]
  );

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-xl border border-slate-200", className)}>
      <MapContainer
        center={map.center}
        zoom={map.zoom}
        scrollWheelZoom={false}
        className="h-full w-full"
        aria-label="LGU budget map"
        whenReady={() => onReady?.()}
      >
        <FitMapToMarkers
          markers={map.markers}
          fallbackCenter={map.center}
          fallbackZoom={map.zoom}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {map.markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.lat, marker.lng]}
            eventHandlers={{
              click: () => {
                if (!marker.isSelectable) return;

                const href = buildDashboardScopeHref({
                  pathname,
                  searchParams: new URLSearchParams(searchParams.toString()),
                  scopeType: marker.scopeType,
                  scopeId: marker.scopeId,
                  preferLatestFiscalYear: true,
                });

                if (!href) return;
                startNavigation(() => {
                  router.push(href, { scroll: false });
                });
              },
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              permanent={marker.id === mainMarkerId}
              opacity={0.96}
            >
              {marker.label}
            </Tooltip>
            <Popup>
              <div className="space-y-1">
                <p className="text-sm font-semibold">{marker.label}</p>
                {marker.valueLabel ? <p className="text-xs text-slate-600">{marker.valueLabel}</p> : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-[500] grid place-items-center bg-white/45 backdrop-blur-[1px] transition-opacity duration-200",
          isNavigating ? "opacity-100" : "opacity-0"
        )}
        aria-hidden={!isNavigating}
      >
        <div
          className="inline-flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm"
          role="status"
          aria-live="polite"
          aria-label="Loading map data"
        >
          <div className="relative flex h-12 w-12 items-center justify-center">
            <span
              className="absolute inset-0 rounded-full border-2 border-[#144679]/15 border-t-[#144679] animate-spin"
              aria-hidden="true"
            />
            <Image
              src="/brand/logo3.svg"
              alt=""
              width={30}
              height={30}
              className="relative z-10 h-8 w-8"
            />
          </div>
          <span className="text-[11px] font-medium text-slate-700">Loading map data...</span>
        </div>
      </div>
    </div>
  );
}
